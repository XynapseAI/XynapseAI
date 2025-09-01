import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';
import cookie from 'cookie';

// Khởi tạo Redis
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    tls: process.env.REDIS_URL?.startsWith('rediss://'),
    connectTimeout: 10000,
  },
});

redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message, stack: err?.stack }));
if (!redisClient.isOpen) {
  try {
    await redisClient.connect();
    logger.info('Redis connected for CSRF');
  } catch (err) {
    logger.error('Redis connect failed for CSRF', { err: err?.message, stack: err?.stack });
    throw new Error('Redis connection failed');
  }
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

function isAllowedOrigin(origin, referer) {
  try {
    logger.info('CORS Check for CSRF', { origin, referer, allowedOrigins });
    if (origin) {
      if (allowedOrigins.includes(origin)) {
        return true;
      }
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app') || hostname.endsWith('xynapseai.net')) {
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        return true;
      }
      const hostname = new URL(refOrigin).hostname;
      if (hostname.endsWith('.vercel.app') || hostname.endsWith('xynapseai.net')) {
        return true;
      }
    }
    if (!origin && !referer && process.env.NODE_ENV === 'development') {
      logger.warn('No origin or referer, allowing in development mode');
      return true;
    }
    logger.error('CORS blocked', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, stack: error.stack, origin, referer });
    return false;
  }
}

async function checkRateLimit(ip) {
  const key = `rate_limit:csrf:${ip}`;
  const windowMs = 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 200 : 100;
  const requests = Number(await redisClient.get(key)) || 0;
  logger.info('CSRF Rate Limit Check', { ip, requests });
  if (requests >= maxRequests) {
    logger.warn('Rate limit exceeded for CSRF token request', { ip, requests });
    throw new Error('Too many requests, please try again later');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

function securityHeaders(nonce) {
  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL || 'https://api.xynapseai.net'};
    object-src 'none';
    frame-ancestors 'none';
    base-uri 'self';
    report-uri /csp-report;
  `.replace(/\s+/g, ' ').trim();
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info('GET /api/csrf-token requested', { ip, origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error('CORS error: Origin not allowed', { origin, referer, allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS', errorCode: 'CORS_DENIED' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error('Rate limit error', { err: err.message, stack: err.stack });
    return NextResponse.json({ detail: 'Too many requests', errorCode: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  const session = await auth();
  logger.info('Session Check for CSRF', { sessionExists: !!session, userId: session?.user?.id });
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not signed in', errorCode: 'UNAUTHENTICATED' }, { status: 401 });
  }

  try {
    const nonce = crypto.randomBytes(16).toString('base64');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    await redisClient.setEx(`csrf:${csrfToken}`, 30 * 60, csrfToken);
    logger.info('CSRF Token Generated', { csrfToken: mask(csrfToken) });

    const headers = new Headers({
      ...securityHeaders(nonce),
      'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    });

    headers.append('Set-Cookie', cookie.serialize('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 60,
    }));

    return NextResponse.json({ success: true, csrfToken }, { headers });
  } catch (error) {
    logger.error('Error processing /api/csrf-token', { error: error.message, stack: error.stack, ip });
    return NextResponse.json({ detail: 'Internal server error', errorCode: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}

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