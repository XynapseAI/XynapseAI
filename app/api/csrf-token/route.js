import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { randomBytes } from 'crypto';
import cookie from 'cookie';

// Global Redis client
let redisClient;
async function initRedis() {
  if (redisClient?.isOpen) return redisClient;
  const maxRetries = 3;
  const delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      });
      redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
      await redisClient.connect();
      logger.info('Redis connected for CSRF');
      return redisClient;
    } catch (err) {
      if (i === maxRetries - 1) {
        logger.warn('Redis connect failed permanently, proceeding without Redis');
        return null;  // Fallback no Redis
      }
      logger.warn(`Redis connection failed (attempt ${i + 1}), retrying...`, { err: err?.message });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Allowed origins (added base)
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://base.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

function isAllowedOrigin(origin, referer) {
  try {
    if (origin && allowedOrigins.includes(origin)) return true;
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) return true;
    }
    if (!origin && !referer) return true;
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in dev');
      return true;
    }
    logger.error('CORS blocked', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message });
    return false;
  }
}

async function checkRateLimit(ip) {
  const client = await initRedis();
  if (!client) return;  // Skip rate limit nếu no Redis
  const key = `rate_limit:csrf:${ip}`;
  const requests = Number(await client.get(key)) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 30;
  if (requests >= maxRequests) throw new Error('Too many requests');
  await client.multi().incr(key).expire(key, windowMs / 1000).exec();
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    return NextResponse.json({ detail: 'Not signed in' }, { status: 401 });
  }

  const client = await initRedis();
  try {
    const csrfToken = session.csrfToken || randomBytes(32).toString('hex');
    session.csrfToken = csrfToken;

    // Store in Redis if available
    if (client) {
      const key = `csrf:${session.user.id}`;
      await client.setEx(key, 15 * 60, csrfToken);
    }

    const isProd = process.env.NODE_ENV === 'production';
    const cookieDomain = process.env.COOKIE_DOMAIN || (isProd ? '.xynapseai.net' : undefined);

    const headers = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    });

    // FIXED: Consistent cookie name, httpOnly false (for double-submit), sameSite lax/none, domain from env
    headers.append('Set-Cookie', cookie.serialize('next-auth.csrf-token', csrfToken, {
      httpOnly: false,  // Allow client read
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      domain: cookieDomain,
      path: '/',
      maxAge: 2 * 60 * 60,
    }));

    return NextResponse.json({ success: true, csrfToken }, { headers });
  } catch (error) {
    logger.error(`Error in /api/csrf-token: ${error.message}`, { ip });
    return NextResponse.json({ detail: 'Server error' }, { status: 500 });
  } finally {
    if (redisClient?.isOpen) await redisClient.quit().catch(() => {});  // Graceful close
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
});
process.on('SIGINT', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
});