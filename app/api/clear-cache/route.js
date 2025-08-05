import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { getRedisClient } from '../../../lib/redis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterRedis({
  storeClient: await getRedisClient(),
  keyPrefix: 'rate_limit:clear-cache',
  points: 50,
  duration: 60 * 60,
});

async function checkRateLimit(ip) {
  try {
    await rateLimiter.consume(ip);
  } catch {
    throw new Error('Too many requests, please try again later.');
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

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

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