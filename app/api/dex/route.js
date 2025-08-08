// app/api/dex/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { createClient } from 'redis';
import { GECKOTERMINAL_CHAIN_MAPPING } from '../../../utils/constants';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 20,
  minTime: 100,
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  return await axios.get(url, config);
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://app.xynapseai.net',
  'https://xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === 'production') {
  throw new Error('NEXT_PUBLIC_APP_URL must be set in production');
}

const bodySchema = z.object({
  chain: z.enum(Object.keys(GECKOTERMINAL_CHAIN_MAPPING), { message: 'Invalid chain' }),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
});

const CACHE_DURATION = 5 * 60; // 5 minutes in seconds

async function checkRateLimit(userId) {
  const key = `rate_limit:dex:${userId || 'anonymous'}`;
  const requests = Number(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 100) {
    throw new Error('Too many DEX requests for this user. Please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/dex from IP ${ip}`);

  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) {
    logger.warn(`CORS error: Origin ${origin} not allowed`, { ip });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) {
    logger.warn('Unauthorized: No token provided', { ip });
    return NextResponse.json({ detail: 'Unauthorized: No token provided' }, { status: 401 });
  }

  let userId;
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not set');
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch (error) {
    logger.error('JWT verification failed:', { message: error.message, ip });
    return NextResponse.json({ detail: 'Unauthorized: Invalid token' }, { status: 401 });
  }

  try {
    await checkRateLimit(userId);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { chain, tokenAddress } = parsedBody;
  const geckoChain = GECKOTERMINAL_CHAIN_MAPPING[chain];
  if (!geckoChain) {
    logger.warn(`Invalid chain: ${chain}`, { ip });
    return NextResponse.json({ detail: `Invalid chain: ${chain}` }, { status: 400 });
  }

  logger.info('Processing DEX request:', {
    chain,
    tokenAddress: tokenAddress.slice(0, 6) + '...',
    ip,
  });

  const cacheKey = `dex-${geckoChain}-${tokenAddress}`;
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    logger.info('Serving DEX data from cache:', { cacheKey });
    return NextResponse.json(JSON.parse(cachedData), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': `public, max-age=${CACHE_DURATION}`,
      },
    });
  }

  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/${geckoChain}/tokens/${tokenAddress}/pools?page=1`;
    const response = await fetchWithRateLimit(url, {
      headers: { accept: 'application/json' },
      timeout: 10000,
    });

    const data = response.data;
    let pools = data?.data || [];
    pools.sort((a, b) => parseFloat(b.attributes.volume_usd.h24) - parseFloat(a.attributes.volume_usd.h24));
    const topPools = pools.slice(0, 5);

    const tradePromises = topPools.map((pool) =>
      fetchWithRateLimit(
        `https://api.geckoterminal.com/api/v2/networks/${geckoChain}/pools/${pool.attributes.address}/trades?trade_volume_in_usd_greater_than=100`,
        {
          headers: { accept: 'application/json' },
          timeout: 10000,
        }
      ).then((response) => ({
        status: 'fulfilled',
        poolAddress: pool.attributes.address,
        poolName: pool.attributes.name,
        data: response.data?.data || [],
      })).catch((error) => ({
        status: 'rejected',
        poolAddress: pool.attributes.address,
        poolName: pool.attributes.name,
        error: {
          message: error.message,
          status: error.response?.status,
          safeMessage: error.response?.status === 429 ? 'Rate limit exceeded' : 'Failed to fetch trades',
        },
      }))
    );

    const tradeResults = await Promise.allSettled(tradePromises);
    const trades = tradeResults.reduce((acc, result) => {
      if (result.status === 'fulfilled') {
        return acc.concat(
          result.value.data.map((trade) => ({
            ...trade.attributes,
            pool_name: result.value.poolName,
            pool_address: result.value.poolAddress,
          }))
        );
      }
      return acc;
    }, []);

    const validTrades = trades.filter((trade) => {
      const isValid = trade.pool_address && typeof trade.pool_address === 'string' && trade.pool_address.match(/^0x[a-fA-F0-9]{40}$/);
      return isValid;
    });

    const poolTokens = {};
    // Fetch pool token metadata (giả sử fetchPoolTokenMetadata đã được định nghĩa trong MarketTabLogic.jsx)
    const poolTokenPromises = topPools.map((pool) =>
      fetchWithRateLimit(
        `https://api.geckoterminal.com/api/v2/networks/${geckoChain}/pools/${pool.attributes.address}/info`,
        {
          headers: { accept: 'application/json' },
          timeout: 10000,
        }
      ).then((response) => ({
        status: 'fulfilled',
        poolAddress: pool.attributes.address,
        data: response.data?.data || [],
      })).catch((error) => ({
        status: 'rejected',
        poolAddress: pool.attributes.address,
        error: {
          message: error.message,
          status: error.response?.status,
          safeMessage: error.response?.status === 429 ? 'Rate limit exceeded' : 'Failed to fetch pool token metadata',
        },
      }))
    );

    const poolTokenResults = await Promise.allSettled(poolTokenPromises);
    poolTokenResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.data.length > 0) {
        poolTokens[topPools[index].attributes.address] = result.value.data.reduce((acc, token) => {
          acc[token.attributes.address] = {
            symbol: token.attributes.symbol,
            image_url: token.attributes.image_url,
            transaction_score: token.attributes.gt_score_details?.transaction || 0,
            holders: token.attributes.holders || {},
          };
          return acc;
        }, {});
      }
    });

    const responseData = {
      success: true,
      data: { pools: topPools, trades: validTrades, poolTokens },
    };

    await redisClient.setEx(cacheKey, CACHE_DURATION, JSON.stringify(responseData));
    logger.info('DEX data fetched and cached:', { cacheKey, poolCount: topPools.length });

    return NextResponse.json(responseData, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': `public, max-age=${CACHE_DURATION}`,
      },
    });
  } catch (error) {
    logger.error('Error fetching DEX data:', {
      status: error.response?.status,
      detail: error.response?.data || error.message,
      ip,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'GeckoTerminal API rate limit exceeded. Please try again later.'
        : status === 404
        ? `No DEX data found for token ${tokenAddress} on ${chain}.`
        : 'An unexpected error occurred while fetching DEX data';
    return NextResponse.json({ detail }, { status });
  }
}