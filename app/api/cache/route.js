// app/api/cache/route.js
import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', err));
    await redisClient.connect();
  }
  return redisClient;
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:cache:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = 200; // Tăng giới hạn lên 500 yêu cầu/phút
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  logger.info(`GET request to /api/cache from IP ${ip} with key: ${key}`);

  if (!key || typeof key !== 'string' || key.trim() === '') {
    logger.warn('Missing or invalid key parameter', { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid key parameter' }, { status: 400 });
  }

  try {
    await checkRateLimit(ip);
    const redisClient = await getRedisClient();
    const cached = await redisClient.get(key);
    logger.info(`Cache get: ${key}`, { ip });
    return NextResponse.json(
      { success: true, data: cached ? JSON.parse(cached) : null },
      {
        headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" },
      }
    );
  } catch (error) {
    logger.error(`Redis GET error: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500 });
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`POST request to /api/cache from IP ${ip}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: 'Invalid JSON body' }, { status: 400 });
  }

  const { key, action, data, ttl } = body;

  if (!key || typeof key !== 'string' || key.trim() === '') {
    logger.warn('Missing or invalid key parameter', { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid key parameter' }, { status: 400 });
  }

  if (!action || !['get', 'set'].includes(action)) {
    logger.warn(`Invalid action: ${action}`, { ip });
    return NextResponse.json({ success: false, detail: `Invalid action: ${action}` }, { status: 400 });
  }

  const maxTTL = 48 * 60 * 60; // 48 giờ
  const effectiveTTL = ttl && Number.isInteger(ttl) && ttl > 0 ? Math.min(ttl / 1000, maxTTL) : 60;

  try {
    const redisClient = await getRedisClient();
    if (action === 'get') {
      const cached = await redisClient.get(key);
      logger.info(`Cache get: ${key}`, { ip });
      return NextResponse.json(
        { success: true, data: cached ? JSON.parse(cached) : null },
        {
          headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" },
        }
      );
    } else if (action === 'set') {
      if (!data) {
        logger.warn(`Data is required for set action: ${key}`, { ip });
        return NextResponse.json({ success: false, detail: 'Data is required for set action' }, { status: 400 });
      }
      await redisClient.setEx(key, effectiveTTL, JSON.stringify(data));
      logger.info(`Cache set: ${key}, ttl: ${effectiveTTL}`, { ip });
      return NextResponse.json(
        { success: true },
        {
          headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" },
        }
      );
    }
  } catch (error) {
    logger.error(`Redis POST error: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500 });
  }
}