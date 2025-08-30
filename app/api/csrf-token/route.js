import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { randomBytes } from 'crypto';

// Initialize Redis client
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
if (!redisClient.isOpen) {
  await redisClient.connect();
}

// List of allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:3000/api',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

// Function to check Origin/Referer
function isAllowedOrigin(origin, referer) {
  try {
    if (origin) {
      if (allowedOrigins.includes(origin)) {
        return true;
      }
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app')) {
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        return true;
      }
      const hostname = new URL(refOrigin).hostname;
      if (hostname.endsWith('.vercel.app')) {
        return true;
      }
    }
    if (!origin && !referer) {
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }
    logger.error('CORS blocked', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, origin, referer });
    return false;
  }
}

async function checkRateLimit(ip) {
  const key = `rate_limit:csrf:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50;
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
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // Check CORS
  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip, session });
    return NextResponse.json({ detail: 'Not signed in' }, { status: 401 });
  }

  try {
    // Use existing CSRF token from session or generate new one
    const csrfToken = session.csrfToken || randomBytes(32).toString('hex');

    // Save CSRF token to session
    session.csrfToken = csrfToken;

    // Chuẩn bị headers cho response
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Content-Security-Policy': "default-src 'self'",
      'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    });

    // Thêm cookie csrf_token
    headers.append('Set-Cookie', cookie.serialize('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 2 * 60 * 60, // 2 hours, đồng bộ với session
    }));

    return NextResponse.json({ success: true, csrfToken }, { headers });
  } catch (error) {
    logger.error(`Error processing /api/csrf-token: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500 });
  }
}

// Close Redis connection on termination
process.on('SIGTERM', async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGTERM');
  }
});
process.on('SIGINT', async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGINT');
  }
});