import { NextResponse } from 'next/server';
import axios from 'axios';
import { logger } from '../../../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:coingecko_token:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 50) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 5,
  minTime: process.env.NODE_ENV === 'production' ? 100 : 1000,
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
    if (error.response?.status === 429 && config.retryCount < 3) {
      const delay = Math.pow(2, config.retryCount) * 1000 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRateLimit(url, { ...config, retryCount: config.retryCount + 1 });
    }
    throw error;
  }
});

export async function GET(request, { params }) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { slug } = await params; // Await params to access slug
  logger.info(`Request to /api/coingecko/token/${slug} from IP ${ip}`); // Fixed string interpolation
  if (!slug || typeof slug !== 'string' || slug.trim() === '') {
    logger.warn(`Invalid token slug: ${slug}`, { ip }); // Fixed string interpolation
    return NextResponse.json({ success: false, detail: 'Invalid token slug' }, { status: 400 });
  }
  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip }); // Fixed string interpolation
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }
  const cacheKey = `coingecko_token_${slug}`; // Added quotes
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    logger.info('Returning cached token data', { slug, ip });
    return new NextResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(JSON.stringify({ success: true, data: JSON.parse(cachedData) }));
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" } }
    );
  }
  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured', { ip });
    return NextResponse.json({ success: false, detail: 'Server configuration error: Missing COINGECKO_API_KEY' }, { status: 500 });
  }
  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const response = await fetchWithRateLimit(
            `https://api.coingecko.com/api/v3/coins/${slug}`, // Added backticks
            {
              timeout: 15000,
              params: {
                localization: false,
                tickers: true,
                market_data: true,
                community_data: false,
                developer_data: false,
                sparkline: false,
              },
              retryCount: 0,
            }
          );
          const tokenData = {
            id: response.data.id,
            symbol: response.data.symbol,
            name: response.data.name,
            image: response.data.image?.large || '/fallback-image.png',
            current_price: response.data.market_data?.current_price || {},
            market_cap: response.data.market_data?.market_cap || {},
            market_cap_rank: response.data.market_data?.market_cap_rank || null,
            fully_diluted_valuation: response.data.market_data?.fully_diluted_valuation || null,
            total_volume: response.data.market_data?.total_volume || {},
            high_24h: response.data.market_data?.high_24h || {},
            low_24h: response.data.market_data?.low_24h || null,
            price_change_percentage_1h_in_currency: response.data.market_data?.price_change_percentage_1h_in_currency || null,
            price_change_percentage_24h_in_currency: response.data.market_data?.price_change_percentage_24h_in_currency || null,
            price_change_percentage_7d_in_currency: response.data.market_data?.price_change_percentage_7d_in_currency || null,
            price_change_percentage_30d_in_currency: response.data.market_data?.price_change_percentage_30d_in_currency || null,
            price_change_percentage_90d_in_currency: response.data.market_data?.price_change_percentage_90d_in_currency || null,
            price_change_percentage_1y_in_currency: response.data.market_data?.price_change_percentage_1y_in_currency || null,
            price_change_percentage_24h: response.data.market_data?.price_change_percentage_24h || null,
            circulating_supply: response.data.market_data?.circulating_supply || null,
            total_supply: response.data.market_data?.total_supply || null,
            max_supply: response.data.market_data?.max_supply || null,
            ath: response.data.market_data?.ath || null,
            ath_change_percentage: response.data.market_data?.ath_change_percentage || null,
            atl: response.data.market_data?.atl || null,
            atl_change_percentage: response.data.market_data?.atl_change_percentage || null,
            links: {
              homepage: response.data.links?.homepage || [],
              twitter_screen_name: response.data.links?.twitter_screen_name || null,
              chat_url: response.data.links?.chat_url || [],
              repos_url: response.data.links?.repos_url || { github: [] },
            },
            detail_platforms: response.data.detail_platforms || {},
          };

          await redisClient.setEx(cacheKey, 60, JSON.stringify(tokenData));
          logger.info(`Successfully fetched token data for ${slug}`, {
            id: tokenData.id,
            name: tokenData.name,
            symbol: tokenData.symbol,
            ip,
          });

          controller.enqueue(JSON.stringify({ success: true, data: tokenData }));
          controller.close();
        } catch (error) {
          logger.error(`Error fetching token data for ${slug}: ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
            stack: error.stack,
            ip,
          });
          const status = error.response?.status || 500;
          const detail =
            status === 429
              ? 'Please wait a moment and try again.'
              : status === 404
              ? `Token with slug ${slug} could not be found`
              : `Failed to fetch token data: ${error.message}`;
          controller.enqueue(JSON.stringify({ success: false, detail }));
          controller.close();
        }
      },
    }),
    { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" } }
  );
}