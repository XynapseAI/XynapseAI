// app/api/coingecko/history/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';
import { logger } from '../../../../utils/serverLogger';
import axiosRetry from 'axios-retry';
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:coingecko_history:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 20) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient
    .multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.response?.status === 429,
});

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/coingecko/history from IP ${ip}, query: ${JSON.stringify(Object.fromEntries(request.nextUrl.searchParams))}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const { id, vs_currency = 'usd', days = '30' } = Object.fromEntries(request.nextUrl.searchParams);

  // Kiểm tra thủ công
  if (!id || typeof id !== 'string' || id.length > 100) {
    logger.warn(`Invalid token ID: ${id}`);
    return NextResponse.json({ detail: 'Invalid token ID' }, { status: 400 });
  }
  if (isNaN(parseFloat(days))) {
    logger.warn(`Invalid days: ${days}`);
    return NextResponse.json({ detail: 'Days must be a number' }, { status: 400 });
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
          const endDate = Math.floor(Date.now() / 1000);
          const parsedDays = parseFloat(days);
          const startDate = endDate - parsedDays * 24 * 60 * 60;
          logger.info(`Fetching historical data for token ${id}, vs_currency: ${vs_currency}, days: ${days}`);

          const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range`, {
            params: { vs_currency, from: startDate, to: endDate },
            headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
            timeout: 30000,
          });

          let prices = response.data.prices;
          if (parsedDays === 0.5) {
            prices = prices.filter((_, index) => index % Math.ceil(prices.length / 144) === 0).slice(-144);
          } else if (parsedDays === 1) {
            prices = prices.filter((_, index) => index % Math.ceil(prices.length / 24) === 0).slice(-24);
          }

          logger.info(`Successfully fetched historical data for ${id}, data points: ${prices.length}`);
          controller.enqueue(JSON.stringify({ prices }));
          controller.close();
        } catch (error) {
          logger.error(`Error fetching historical data: ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
          });
          const status = error.response?.status || 500;
          const detail =
            status === 429
              ? 'CoinGecko API rate limit exceeded, please try again later.'
              : status === 404
              ? `Token ID ${id} not found.`
              : `Failed to fetch historical data: ${error.message}`;
          controller.enqueue(JSON.stringify({ detail }));
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