// app/api/coingecko/chains/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';
import { logger } from '../../../../utils/serverLogger';
import axiosRetry from 'axios-retry';
import NodeCache from 'node-cache';
import { createClient } from 'redis';

// Fallback chains in case the API fails
const FALLBACK_CHAINS = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    shortname: 'ETH',
    image: { thumb: '/fallback-image.png', small: '/fallback-image.png', large: '/fallback-image.png' },
  },
  {
    id: 'binance-smart-chain',
    name: 'BNB Chain',
    chainId: 56,
    shortname: 'BNB',
    image: { thumb: '/fallback-image.png', small: '/fallback-image.png', large: '/fallback-image.png' },
  },
  {
    id: 'polygon-pos',
    name: 'Polygon',
    chainId: 137,
    shortname: 'MATIC',
    image: { thumb: '/fallback-image.png', small: '/fallback-image.png', large: '/fallback-image.png' },
  },
  {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    shortname: 'BASE',
    image: { thumb: '/fallback-image.png', small: '/fallback-image.png', large: '/fallback-image.png' },
  },
];

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:coingecko_chains:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 60) { // Increase rate limit to 60
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

axiosRetry(axios, {
  retries: 5, // Increase retries to 5
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 2000 + Math.random() * 200, // Increase delay
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
});

const cache = new NodeCache({ stdTTL: 48 * 3600 }); // Cache for 48 hours

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
      JSON.stringify({ success: true, data: cachedData }),
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

  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
      timeout: 20000, // Increase timeout
    });

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Invalid or empty chain data from CoinGecko');
    }

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

    return new NextResponse(
      JSON.stringify({ success: true, data: chains }),
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
    cache.set(cacheKey, FALLBACK_CHAINS);
    return new NextResponse(
      JSON.stringify({ success: true, data: FALLBACK_CHAINS }),
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
}