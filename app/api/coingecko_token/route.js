import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:coingecko_token:${ip}`;
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

const querySchema = z.object({
  id: z.string().nonempty('Token ID is required'),
});

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/coingecko_token from IP ${ip}, query: ${JSON.stringify(Object.fromEntries(request.nextUrl.searchParams))}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 429 });
  }

  let parsedParams;
  try {
    parsedParams = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`);
    return NextResponse.json({ error: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { id } = parsedParams;

  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false,
        sparkline: false,
      },
      headers: {
        accept: 'application/json',
        ...(process.env.COINGECKO_API_KEY && { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }),
      },
    });

    logger.info(`Successfully fetched token details for id: ${id}`);
    return NextResponse.json({
      id: response.data.id,
      symbol: response.data.symbol,
      name: response.data.name,
      image: response.data.image?.thumb,
      current_price: response.data.market_data?.current_price?.usd,
      market_cap: response.data.market_data?.market_cap?.usd,
      total_volume: response.data.market_data?.total_volume?.usd,
      high_24h: response.data.market_data?.high_24h?.usd,
      price_change_percentage_24h: response.data.market_data?.price_change_percentage_24h,
      circulating_supply: response.data.market_data?.circulating_supply,
      total_supply: response.data.market_data?.total_supply,
      max_supply: response.data.market_data?.max_supply,
      market_cap_rank: response.data.market_cap_rank,
      platforms: response.data.platforms || {},
    }, {
      headers: { 'Content-Security-Policy': "default-src 'self'" },
    });
  } catch (error) {
    logger.error('Error fetching CoinGecko token:', {
      status: error.response?.status,
      message: error.response?.data || error.message,
    });
    const status = error.response?.status || 500;
    return NextResponse.json({
      error: error.response?.data?.error || 'Failed to fetch token details',
    }, { status });
  }
}