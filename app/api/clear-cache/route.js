// app/api/clear-cache/route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { getRedisClient } from '../../../lib/redis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

async function checkRateLimit(userId, ip) {
  const redisClient = await getRedisClient();
  const rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: `rate_limit:clear-cache:user:${userId}`,
    points: 100, // 50 requests per user per hour
    duration: 60 * 60,
  });

  try {
    await rateLimiter.consume(userId);
    return null;
  } catch (err) {
    const msBeforeReset = err.msBeforeNext || 60 * 60 * 1000;
    logger.warn(`Rate limit exceeded for user ${userId}`, { ip, msBeforeReset });
    return NextResponse.json(
      { success: false, detail: `Too many requests. Please try again in ${Math.ceil(msBeforeReset / 1000)} seconds.` },
      {
        status: 429,
        headers: {
          'Retry-After': Math.ceil(msBeforeReset / 1000).toString(),
        },
      }
    );
  }
}

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (process.env.NODE_ENV === 'development') return true;
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) return false;
  return true;
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/clear-cache from IP ${ip}`);

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  const rateLimitResponse = await checkRateLimit(session.user.id, ip);
  if (rateLimitResponse) return rateLimitResponse;

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: 'Invalid JSON body' }, { status: 400 });
  }

  const { cacheKeys } = body;
  if (!Array.isArray(cacheKeys) || cacheKeys.length === 0) {
    logger.warn('Missing or invalid cacheKeys parameter', { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid cacheKeys parameter' }, { status: 400 });
  }

  try {
    const redisClient = await getRedisClient();
    await redisClient.del(cacheKeys);
    logger.info(`Cleared cache keys: ${cacheKeys.join(', ')}`, { userId: session.user.id, ip });
    return NextResponse.json({ success: true, message: 'Cache cleared successfully' }, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
      },
    });
  } catch (error) {
    logger.error(`Failed to clear cache: ${error.message}`, { stack: error.stack, userId: session.user.id, ip });
    return NextResponse.json({ success: false, detail: `Failed to clear cache: ${error.message}` }, { status: 500 });
  }
}