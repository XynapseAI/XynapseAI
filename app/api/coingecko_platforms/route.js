import { NextResponse } from 'next/server';
import axios from 'axios';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:coingecko_platforms:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 50) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/coingecko_platforms from IP ${ip}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 429 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const response = await axios.get('https://api.coingecko.com/api/v3/asset_platforms', {
            headers: {
              accept: 'application/json',
              ...(process.env.COINGECKO_API_KEY && { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }),
            },
          });

          logger.info(`Successfully fetched ${response.data.length} platforms from CoinGecko`);
          controller.enqueue(JSON.stringify(response.data));
          controller.close();
        } catch (error) {
          logger.error('Error fetching CoinGecko platforms:', {
            status: error.response?.status,
            message: error.response?.data || error.message,
          });
          controller.enqueue(JSON.stringify({
            error: error.response?.data?.error || 'Failed to fetch asset platforms',
          }));
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