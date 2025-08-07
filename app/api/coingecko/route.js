import { NextResponse } from 'next/server';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { getRedisClient } from '../../../lib/redis';

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    logger.info(`Retry attempt ${retryCount} for CoinGecko API`);
    return retryCount * 1000;
  },
  retryCondition: (error) => error.response?.status === 429,
});

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 10 : 5,
  minTime: process.env.NODE_ENV === 'production' ? 200 : 1000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await axios.get(url, {
      ...config,
      headers: {
        ...config.headers,
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || '',
      },
      timeout: 20000, // Tăng timeout lên 20s để xử lý độ trễ trên Vercel
    });
    return response;
  } catch (error) {
    throw error;
  }
});

// List of supported CoinGecko currencies
const VALID_CURRENCIES = [
  'usd', 'eur', 'gbp', 'cny', 'jpy', 'krw', 'rub', 'inr', 'brl', 'aud',
  'cad', 'chf', 'hkd', 'sgd', 'twd', 'thb', 'vnd', 'php', 'idr', 'myr',
  'zar', 'mxn', 'pln', 'sek', 'nok', 'dkk', 'czk', 'huf', 'ron', 'try',
  'nzd', 'clp', 'ars', 'cop', 'pen', 'aed', 'sar', 'ils', 'uah', 'egp',
];

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:coingecko:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 50) {
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`, { ip });
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const params = Object.fromEntries(request.nextUrl.searchParams);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  const { action = 'market-info', ids, vs_currencies = 'usd', limit, start, query, id, tokenType } = params;

  // Validate parameters
  if (['tickers', 'coin-details'].includes(action) && (!id || typeof id !== 'string' || id.trim() === '')) {
    logger.warn(`Missing or invalid id parameter: ${id}`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid id parameter' }, { status: 400 });
  }
  if (action === 'public-treasury' && (!tokenType || typeof tokenType !== 'string' || tokenType.trim() === '')) {
    logger.warn(`Missing or invalid tokenType parameter: ${tokenType}`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid tokenType parameter' }, { status: 400 });
  }
  if (action === 'market-info' && !vs_currencies) {
    logger.warn(`Missing vs_currencies parameter`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing vs_currencies parameter' }, { status: 400 });
  }
  if (action === 'search' && (!query || typeof query !== 'string' || query.trim() === '')) {
    logger.warn(`Missing or invalid query parameter: ${query}`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid query parameter' }, { status: 400 });
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured', { ip });
    return NextResponse.json({ success: false, detail: 'Server configuration error: Missing COINGECKO_API_KEY' }, { status: 500 });
  }

  // Filter valid currencies
  const currencies = vs_currencies.split(',').map(c => c.trim().toLowerCase());
  const validCurrencies = currencies.filter(c => VALID_CURRENCIES.includes(c));
  const selectedCurrency = validCurrencies[0] || 'usd';

  if (validCurrencies.length === 0) {
    logger.warn(`No valid currencies provided in vs_currencies: ${vs_currencies}`, { ip });
  }

  const redisClient = await getRedisClient();

  // Streaming response for large datasets
  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          let data;
          let cacheKey;

          if (action === 'public-treasury') {
            cacheKey = `coingecko_public_treasury_${tokenType}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ success: true, data: JSON.parse(cachedData) })));
              controller.close();
              return;
            }

            try {
              const response = await fetchWithRateLimit(
                `https://api.coingecko.com/api/v3/companies/public_treasury/${tokenType}`,
                { headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY }, timeout: 20000 }
              );
              data = response.data || { companies: [] };
              if (!data.companies || !Array.isArray(data.companies)) {
                logger.warn(`No valid public treasury data for ${tokenType}: ${JSON.stringify(data)}`, { ip });
                controller.enqueue(
                  JSON.stringify({
                    success: false,
                    detail: `No valid public treasury data for ${tokenType}`,
                    data: { companies: [] },
                  })
                );
                controller.close();
                return;
              }
              await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(data));
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ success: true, data })));
            } catch (error) {
              logger.error(`Failed to fetch public treasury data for ${tokenType}: ${error.message}`, {
                ip,
                status: error.response?.status,
                data: error.response?.data,
              });
              controller.enqueue(
                JSON.stringify({
                  success: false,
                  detail: `No treasury data available for ${tokenType}`,
                  data: { companies: [] },
                })
              );
            }
            controller.close();
            return;
          } else if (action === 'market-info') {
            cacheKey = `coingecko_market_info_${ids || 'default'}_${selectedCurrency}_${start || 1}_${limit || 30}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(JSON.parse(cachedData))));
              controller.close();
              return;
            }

            const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/coins/markets', {
              params: {
                vs_currency: selectedCurrency,
                ids: ids || undefined,
                order: 'market_cap_desc',
                per_page: limit || 30,
                page: start || 1,
                sparkline: false,
                price_change_percentage: '24h',
              },
              headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
              timeout: 20000,
            });
            data = response.data.map(coin => ({
              ...coin,
              image: coin.image || '/fallback-image.png',
            }));
            await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify({ success: true, data }));
          } else if (action === 'search') {
            cacheKey = `coingecko_search_${query}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(JSON.parse(cachedData))));
              controller.close();
              return;
            }

            const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/search', {
              params: { query },
              headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
              timeout: 20000,
            });
            data = response.data.coins.map(coin => ({
              id: coin.id,
              name: coin.name,
              symbol: coin.symbol,
              image: coin.large || coin.thumb || '/fallback-image.png',
              market_cap_rank: coin.market_cap_rank,
            }));
            await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify({ success: true, data }));
          } else if (action === 'tickers') {
            cacheKey = `coingecko_tickers_${id}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              const parsedCache = JSON.parse(cachedData);
              if (parsedCache.success && Array.isArray(parsedCache.data?.tickers)) {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(parsedCache)));
                controller.close();
                return;
              }
            }

            try {
              const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${id}/tickers`, {
                params: { include_exchange_logo: true },
                headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
                timeout: 20000,
              });
              if (!response.data || !Array.isArray(response.data.tickers)) {
                logger.warn(`No valid tickers for ${id}: ${JSON.stringify(response.data)}`, { ip });
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      success: false,
                      detail: `No valid ticker data for ${id}`,
                      data: { tickers: [] },
                    })
                  )
                );
                controller.close();
                return;
              }
              data = { tickers: response.data.tickers };
              await redisClient.setEx(cacheKey, 5 * 60, JSON.stringify({ success: true, data }));
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ success: true, data })));
            } catch (error) {
              logger.error(`Failed to fetch tickers for ${id}: ${error.message}`, {
                ip,
                status: error.response?.status,
                data: error.response?.data,
              });
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    success: false,
                    detail: error.response?.status === 429
                      ? 'CoinGecko API rate limit exceeded. Please try again in a few minutes.'
                      : error.response?.status === 404
                        ? `No ticker data found for ${id}.`
                        : `Failed to fetch ticker data: ${error.message}`,
                    data: { tickers: [] },
                  })
                )
              );
            }
            controller.close();
            return;
          } else if (action === 'coin-details') {
            cacheKey = `coingecko_coin_details_${id}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(JSON.parse(cachedData))));
              controller.close();
              return;
            }

            const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${id}`, {
              params: {
                localization: false,
                tickers: false,
                market_data: true,
                community_data: false,
                developer_data: false,
                sparkline: false,
                vs_currency: selectedCurrency,
              },
              headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
              timeout: 20000,
            });
            data = response.data;
            await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify({ success: true, data }));
          } else if (action === 'trending') {
            cacheKey = `coingecko_trending_${selectedCurrency}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(JSON.parse(cachedData))));
              controller.close();
              return;
            }

            try {
              const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/search/trending', {
                headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
                timeout: 20000,
              });
              data = response.data.coins.map((coin) => ({
                id: coin.item.id,
                name: coin.item.name,
                symbol: coin.item.symbol,
                thumb: coin.item.thumb || '/fallback-image.png',
                large: coin.item.large || '/fallback-image.png',
                market_cap_rank: coin.item.market_cap_rank,
                price: coin.item.data.price,
                price_change_percentage_24h: coin.item.data.price_change_percentage_24h.usd,
              }));
              await redisClient.setEx(cacheKey, 30 * 60, JSON.stringify({ success: true, data }));
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ success: true, data })));
            } catch (error) {
              logger.error(`Failed to fetch trending tokens: ${error.message}`, {
                ip,
                status: error.response?.status,
                data: error.response?.data,
              });
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    success: false,
                    detail: error.response?.status === 429
                      ? 'CoinGecko API rate limit exceeded. Please try again in a few minutes.'
                      : `Failed to fetch trending tokens: ${error.message}`,
                    data: [],
                  })
                )
              );
            }
            controller.close();
            return;
          } else {
            cacheKey = `coingecko_default_markets_${selectedCurrency}_${start || 1}_${limit || 30}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(JSON.parse(cachedData))));
              controller.close();
              return;
            }

            const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/coins/markets', {
              params: {
                vs_currency: selectedCurrency,
                order: 'market_cap_desc',
                per_page: limit || 30,
                page: start || 1,
                sparkline: false,
                price_change_percentage: '24h',
              },
              headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
              timeout: 20000,
            });
            data = response.data;
            await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify({ success: true, data }));
          }
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ success: true, data })));
          controller.close();
        } catch (error) {
          logger.error(`CoinGecko API error: ${error.message}`, {
            ip,
            status: error.response?.status,
            data: error.response?.data,
          });
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                success: false,
                detail: error.response?.status === 429
                  ? 'CoinGecko API rate limit exceeded. Please try again in a few minutes.'
                  : error.response?.status === 404
                    ? `No data found for ${id || 'unknown'}.`
                    : `Failed to fetch data: ${error.response?.data?.error || error.message}`,
                data: action === 'tickers' ? { tickers: [] } : [],
              })
            )
          );
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
      },
    }
  );
}