// app/api/coingecko/market_chart/route.js
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
  const key = `rate_limit:coingecko_market_chart:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 100) {
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
  logger.info(`Request to /api/coingecko/market_chart from IP ${ip}, query: ${JSON.stringify(Object.fromEntries(request.nextUrl.searchParams))}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const { id, days = '1', currency = 'usd' } = Object.fromEntries(request.nextUrl.searchParams);

  // Kiểm tra thủ công
  if (!id || typeof id !== 'string' || id.length > 100) {
    logger.warn(`Invalid token ID: ${id}`);
    return NextResponse.json({ detail: 'Invalid token ID' }, { status: 400 });
  }
  if (isNaN(parseFloat(days))) {
    logger.warn(`Invalid days: ${days}`);
    return NextResponse.json({ detail: 'Days must be a number' }, { status: 400 });
  }
  if (!currency || typeof currency !== 'string') {
    logger.warn(`Invalid currency: ${currency}`);
    return NextResponse.json({ detail: 'Currency must be a string' }, { status: 400 });
  }

  let parsedDays = parseFloat(days);
  parsedDays = parsedDays < 1 ? 1 : parsedDays;

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured');
    return NextResponse.json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' }, { status: 500 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart`, {
            params: { vs_currency: currency, days: parsedDays },
            headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
            timeout: 15000,
          });

          const prices = response.data.prices;
          if (!prices || !Array.isArray(prices) || prices.length === 0) {
            logger.error(`Invalid or empty price data for id: ${id}, days: ${parsedDays}`);
            controller.enqueue(JSON.stringify({ detail: 'Invalid or empty price data' }));
            controller.close();
            return;
          }

          let filteredPrices = prices;
          if (parseFloat(days) === 0.5) {
            const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
            filteredPrices = prices.filter(([timestamp]) => timestamp >= twelveHoursAgo);
          }

          const high = Math.max(...filteredPrices.map((price) => price[1]));
          const low = Math.min(...filteredPrices.map((price) => price[1]));

          logger.info(`Successfully fetched market chart for id: ${id}, days: ${parsedDays}, data points: ${filteredPrices.length}`);
          controller.enqueue(JSON.stringify({ prices: filteredPrices, high, low }));
          controller.close();
        } catch (error) {
          logger.error(`Error fetching market chart: ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
            url: `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${currency}&days=${parsedDays}`,
          });
          const status = error.response?.status || 500;
          const detail =
            status === 429
              ? 'CoinGecko API rate limit exceeded, please try again later.'
              : status === 401
              ? 'CoinGecko API authentication failed. Please check your API key and try again later.'
              : status === 404
              ? `Token ID ${id} not found.`
              : `Failed to fetch market chart: ${error.message}`;
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