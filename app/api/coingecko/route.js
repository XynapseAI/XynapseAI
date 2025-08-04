// app/api/coingecko/route.js
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
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 2,
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
  if (requests >= 30) { // Giảm giới hạn từ 50 xuống 30 để an toàn
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`, { ip });
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.info(`Rate limit check for IP ${ip}: ${requests + 1}/30`, { ip });
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.info(`Request to /api/coingecko from IP ${ip}, query: ${JSON.stringify(params)}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  const { action = 'market-info', ids, vs_currencies = 'usd', limit, start, query, id, tokenType } = params;
  logger.info(`Parsed action: ${action}, tokenType: ${tokenType}`);

  // Validate parameters
  if (['tickers', 'coin-details'].includes(action) && !id) {
    logger.warn(`Missing id parameter`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing id parameter' }, { status: 400 });
  }
  if (action === 'public-treasury' && !tokenType) {
    logger.warn(`Missing tokenType parameter`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing tokenType parameter' }, { status: 400 });
  }
  if (['tickers', 'coin-details'].includes(action) && !id) {
    logger.warn(`Missing id parameter`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing id parameter' }, { status: 400 });
  }
  if (action === 'market-info' && !ids && !vs_currencies) {
    logger.warn(`Missing ids or vs_currencies parameter`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing ids or vs_currencies parameter' }, { status: 400 });
  }
  if (action === 'search' && !query) {
    logger.warn(`Missing query parameter`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing query parameter' }, { status: 400 });
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
            if (!tokenType) {
              logger.warn(`Missing tokenType parameter`, { ip });
              controller.enqueue(JSON.stringify({ success: false, detail: 'Missing tokenType parameter' }));
              controller.close();
              return;
            }
            cacheKey = `coingecko_public_treasury_${tokenType}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              logger.info(`Returning cached public treasury data for ${tokenType}`, { ip });
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ success: true, data: JSON.parse(cachedData) })));
              controller.close();
              return;
            }

            try {
              logger.info(`Fetching treasury data from CoinGecko for ${tokenType}`, { ip });
              const response = await fetchWithRateLimit(
                `https://api.coingecko.com/api/v3/companies/public_treasury/${tokenType}`,
                { headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY }, timeout: 15000 }
              );
              logger.info(`CoinGecko treasury response for ${tokenType}: ${JSON.stringify(response.data)}`, { ip });
              const data = response.data || { companies: [] };
              if (!data.companies || !Array.isArray(data.companies)) {
                logger.warn(`No valid public treasury data for ${tokenType}: ${JSON.stringify(data)}`, { ip });
                controller.enqueue(JSON.stringify({ success: false, detail: `No valid public treasury data for ${tokenType}`, data: { companies: [] } }));
                controller.close();
                return;
              }
              await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(data));
              logger.info(`Successfully fetched and cached public treasury data for ${tokenType}`, { ip });
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ success: true, data })));
            } catch (error) {
              logger.error(`Failed to fetch public treasury data for ${tokenType}: ${error.message}`, {
                ip,
                status: error.response?.status,
                data: error.response?.data,
              });
              controller.enqueue(JSON.stringify({ success: false, detail: `No treasury data available for ${tokenType}`, data: { companies: [] } }));
            }
            controller.close();
            return;
          } else if (action === 'market-info') {
            cacheKey = `coingecko_market_info_${ids || 'default'}_${selectedCurrency}_${start || 1}_${limit || 30}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              logger.info(`Returning cached market info for vs_currency: ${selectedCurrency}`, { ip });
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
              timeout: 15000,
            });
            data = response.data.map(coin => ({
              ...coin,
              image: coin.image || '/fallback-image.png', // Sửa để lấy đúng trường image
            }));
            await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify({ success: true, data }));
            logger.info(`Successfully fetched and cached market data for vs_currency: ${selectedCurrency}`, { ip });
          } else if (action === 'search') {
            cacheKey = `coingecko_search_${query}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              logger.info(`Returning cached search data for query: ${query}`, { ip });
              controller.enqueue(new TextEncoder().encode(JSON.stringify(JSON.parse(cachedData))));
              controller.close();
              return;
            }

            const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/search', {
              params: { query },
              headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
              timeout: 15000,
            });
            data = response.data.coins.map(coin => ({
              id: coin.id,
              name: coin.name,
              symbol: coin.symbol,
              image: coin.large || coin.thumb || '/fallback-image.png',
              market_cap_rank: coin.market_cap_rank,
            }));
            await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify({ success: true, data }));
            logger.info(`Search successful for query: ${query}, results: ${data.length}`, { ip });
          } else if (action === 'tickers') {
            cacheKey = `coingecko_tickers_${id}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              const parsedCache = JSON.parse(cachedData);
              if (parsedCache.success && Array.isArray(parsedCache.data?.tickers)) {
                logger.info(`Cache hit for ticker data: ${id}`, { ip });
                controller.enqueue(new TextEncoder().encode(JSON.stringify(parsedCache)));
                controller.close();
                return;
              } else {
                logger.warn(`Invalid cached ticker data for ${id}, fetching fresh data`, { ip });
              }
            }

            const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${id}/tickers`, {
              params: { include_exchange_logo: true },
              headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
              timeout: 15000, // Increase timeout to 15s
            });
            logger.info(`Raw CoinGecko response for tickers ${id}:`, JSON.stringify(response.data, null, 2));
            if (!response.data || !Array.isArray(response.data.tickers)) {
              logger.warn(`No valid tickers for ${id}: ${JSON.stringify(response.data)}`, { ip });
              controller.enqueue(
                JSON.stringify({
                  success: false,
                  detail: `No valid ticker data for ${id}`,
                  data: { tickers: [] },
                })
              );
              controller.close();
              return;
            }
            data = { tickers: response.data.tickers };
            await redisClient.setEx(cacheKey, 5 * 60, JSON.stringify({ success: true, data }));
            logger.info(`Successfully fetched and cached ticker data for ${id}, count: ${data.tickers.length}`, { ip });
          } else if (action === 'coin-details') {
            cacheKey = `coingecko_coin_details_${id}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              logger.info(`Returning cached coin details for id: ${id}`, { ip });
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
              timeout: 10000,
            });
            data = response.data;
            await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify({ success: true, data }));
            logger.info(`Successfully fetched and cached coin details for id: ${id}`, { ip });
          } else {
            cacheKey = `coingecko_default_markets_${selectedCurrency}_${start || 1}_${limit || 30}`;
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              logger.info(`Returning cached default market data`, { ip });
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
              timeout: 15000,
            });
            data = response.data;
            await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify({ success: true, data }));
            logger.info(`Successfully fetched and cached default market data, count: ${data.length}`, { ip });
          }
          logger.info(`Response data for action ${action}:`, JSON.stringify(data, null, 2));
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
                    ? `No data found for ${id}.`
                    : `Failed to fetch data: ${error.response?.data?.error || error.message}`,
                data: { tickers: [] }, // Ensure safe default
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