// app/api/csrf-token/route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';
import cookie from 'cookie';
import { RateLimiterRedis } from 'rate-limiter-flexible';

// Redis singleton
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { err }));
    try {
      await redisClient.connect();
      logger.info('Redis connected (initial)');
    } catch (err) {
      logger.error('Redis initial connect failed', { err });
      throw new Error('Redis connection failed');
    }
  } else if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
      logger.info('Redis reconnected');
    } catch (err) {
      logger.error('Redis reconnect failed', { err });
      throw new Error('Redis connection failed');
    }
  }
  return redisClient;
}

// Security headers
const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// List of allowed origins
const allowedOrigins = [
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000'] : []),
  ...(process.env.VERCEL_ENV === 'production' ? [] : [/^https:\/\/([a-z0-9-]+)\.vercel\.app$/]),
].filter((v, i, a) => a.indexOf(v) === i);

// Helpers
function getClientIp(request) {
  const xfwd = request.headers.get('x-forwarded-for');
  if (xfwd) {
    const ip = xfwd.split(',')[0].trim();
    return ip;
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

function isAllowedOrigin(request, origin, referer) {
  if (!origin && !referer) {
    logger.info('No Origin or Referer (likely SSR or server-to-server), allowing request');
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info('No valid Origin or Referer, allowing for compatibility');
    return true;
  }

  if (process.env.NODE_ENV === 'development' && checkOrigin === 'http://localhost:3000') {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (ip === '127.0.0.1' || ip === '::1') {
      logger.info(`Localhost origin allowed: ${checkOrigin}`);
      return true;
    }
    logger.warn(`Localhost origin rejected due to non-local IP: ${ip}`);
    return false;
  }

  const isAllowed = allowedOrigins.some((allowed) =>
    typeof allowed === 'string' ? allowed === checkOrigin : allowed.test(checkOrigin)
  );
  logger.info(`Origin check`, { origin: checkOrigin, allowed: isAllowed });
  return isAllowed;
}

async function checkRateLimit(ip) {
  // Bypass rate limiting in development for debugging
  if (process.env.NODE_ENV === 'development') {
    logger.info('Rate limiting bypassed in development mode', { ip });
    return null;
  }

  const client = await getRedisClient();
  const rateLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: `rate_limit:csrf:`,
    points: 50, // 50 requests per minute in production
    duration: 60, // 1 minute
  });

  try {
    await rateLimiter.consume(ip);
    logger.info('Rate limit check passed', { ip });
    return null;
  } catch (err) {
    const msBeforeReset = err && err.msBeforeNext ? err.msBeforeNext : 60 * 1000;
    logger.warn('Rate limit exceeded for CSRF token request', { ip, msBeforeReset });
    return NextResponse.json(
      { detail: 'Too many requests, please try again later.' },
      {
        status: 429,
        headers: {
          ...securityHeaders,
          'Retry-After': Math.ceil(msBeforeReset / 1000).toString(),
        },
      }
    );
  }
}

// GET handler
export async function GET(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info('GET /api/csrf-token requested', { ip, origin, referer });

  // Check CORS
  if (!isAllowedOrigin(request, origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders });
  }

  // Rate limiting
  const rateLimitResponse = await checkRateLimit(ip);
  if (rateLimitResponse) return rateLimitResponse;

  // Check session
  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers: securityHeaders });
  }

  try {
    // Check Redis for existing CSRF token
    const client = await getRedisClient();
    const cacheKey = `csrf_token:${session.user.id}`;
    let csrfToken = await client.get(cacheKey);

    if (!csrfToken) {
      // Generate new CSRF token
      csrfToken = process.env.NODE_ENV === 'development' ? 'dev-csrf' : crypto.randomBytes(32).toString('hex');
      await client.setEx(cacheKey, 24 * 60 * 60, csrfToken); // Cache for 1 day
      logger.info('New CSRF token generated and cached', { ip, userId: session.user.id, csrfToken: csrfToken.substring(0, 6) + '...' });
    } else {
      logger.info('Using cached CSRF token', { ip, userId: session.user.id, csrfToken: csrfToken.substring(0, 6) + '...' });
    }

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24, // 1 day
    };

    const cookieHeader = cookie.serialize('csrf_token', csrfToken, cookieOptions);
    logger.info('CSRF token set in cookie', { ip, csrfToken: csrfToken.substring(0, 6) + '...' });

    return NextResponse.json(
      { success: true, csrfToken },
      {
        headers: {
          ...securityHeaders,
          'Set-Cookie': cookieHeader,
          'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  } catch (error) {
    logger.error(`Error processing /api/csrf-token: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders });
  }
}

// Cleanup on process termination
process.on('SIGTERM', async () => {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGTERM');
  }
});

process.on('SIGINT', async () => {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGINT');
  }
});