import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { createClient } from 'redis';


const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:blockchair:${ip}`;
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

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 10 : 5,
  minTime: process.env.NODE_ENV === 'production' ? 2000 : 2000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  return await axios.get(url, config);
});

const bodySchema = z.object({
  chain: z.enum(['bitcoin', 'ethereum', 'dogecoin'], { message: 'Invalid or unsupported chain' }),
  limit: z.number().int().min(1).max(100).default(100),
});

const BLOCKCHAIR_API_URL = 'https://api.blockchair.com';
const CACHE_DURATION = 15 * 60; // 5 minutes in seconds

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/blockchair from IP ${ip}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { chain, limit } = parsedBody;

  const cacheKey = `blockchair-${chain}-top-holders-${limit}`;
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    logger.info('Serving top holders from cache', { cacheKey, chain });
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

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const response = await fetchWithRateLimit(
            `${BLOCKCHAIR_API_URL}/${chain}/addresses?limit=${limit}&sort=balance`,
            {
              headers: { 'Accept': 'application/json' },
              timeout: 15000,
            }
          );

          if (!response.data?.data) {
            logger.error('Invalid response from Blockchair API', { chain });
            controller.enqueue(JSON.stringify({ success: false, detail: 'Invalid response from Blockchair API' }));
            controller.close();
            return;
          }

          const topHolders = response.data.data.map((holder) => ({
            address: holder.address,
            balance: parseFloat(holder.balance) / (chain === 'ethereum' ? 1e18 : 1e8),
            share: parseFloat(holder.share) || 0,
          }));

          await redisClient.setEx(cacheKey, CACHE_DURATION, JSON.stringify(topHolders));
          logger.info('Top holders fetched and cached from Blockchair', {
            chain,
            count: topHolders.length,
            sample: topHolders.slice(0, 3),
          });

          controller.enqueue(JSON.stringify({ success: true, data: topHolders }));
          controller.close();
        } catch (error) {
          logger.error('Error fetching Blockchair top holders', {
            chain,
            status: error.response?.status,
            message: error.message,
            data: error.response?.data,
          });

          const errorMessage =
            error.response?.status === 429
              ? 'Blockchair API rate limit exceeded. Please try again later.'
              : error.response?.status === 400
              ? 'Invalid request to Blockchair API.'
              : error.response?.data?.error || `Failed to fetch top holders for ${chain}.`;

          controller.enqueue(JSON.stringify({ success: false, detail: errorMessage }));
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