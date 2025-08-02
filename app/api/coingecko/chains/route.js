import { NextResponse } from 'next/server';
import axios from 'axios';
import { logger } from '../../../../utils/serverLogger';
import axiosRetry from 'axios-retry';
import NodeCache from 'node-cache';
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:coingecko_chains:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 20) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.response?.status === 429,
});

const cache = new NodeCache({ stdTTL: 1800 }); // Cache for 30 minutes

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/coingecko/chains from IP ${ip}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const cacheKey = 'coingecko_chains';
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    logger.info('Returning cached CoinGecko chains', {
      count: cachedData.length,
      sample: cachedData.slice(0, 3).map((c) => ({ id: c.id, name: c.name, image: c.image?.thumb })),
    });
    return new NextResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(JSON.stringify({ success: true, data: cachedData }));
          controller.close();
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      }
    );
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured');
    return NextResponse.json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' }, { status: 500 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const response = await axios.get('https://api.coingecko.com/api/v3/asset_platforms', {
            headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
            timeout: 15000,
          });

          const chains = response.data.map((chain) => ({
            id: chain.id,
            name: chain.name,
            chainId: chain.chain_identifier,
            shortname: chain.shortname || chain.name,
            image: chain.image || { thumb: '/fallback-image.png', small: '/fallback-image.png', large: '/fallback-image.png' },
          }));

          cache.set(cacheKey, chains);
          logger.info(`Successfully fetched ${chains.length} chains from CoinGecko`, {
            sample: chains.slice(0, 5).map((c) => ({
              id: c.id,
              name: c.name,
              image: c.image?.large,
            })),
          });

          controller.enqueue(JSON.stringify({ success: true, data: chains }));
          controller.close();
        } catch (error) {
          logger.error(`Error fetching CoinGecko chains: ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
          });
          const status = error.response?.status || 500;
          const detail =
            status === 429
              ? 'CoinGecko API rate limit exceeded, please try again later.'
              : `Failed to fetch chains: ${error.message}`;
          controller.enqueue(JSON.stringify({ detail }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    }
  );
}