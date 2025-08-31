import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { randomBytes } from 'crypto';
import cookie from 'cookie';

// Initialize Redis client
let redisClient;
async function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
    try {
      await redisClient.connect();
      logger.info('Redis connected for CSRF token');
    } catch (err) {
      logger.error('Redis connection failed', { err: err?.message });
      throw new Error('Redis connection failed');
    }
  }
  return redisClient;
}

// List of allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

// Function to check Origin/Referer
function isAllowedOrigin(origin, referer) {
  try {
    if (origin && allowedOrigins.includes(origin)) {
      return true;
    }
    const hostname = origin ? new URL(origin).hostname : referer ? new URL(referer).hostname : null;
    if (hostname && (hostname.endsWith('.vercel.app') || hostname.endsWith('xynapseai.net'))) {
      return true;
    }
    if (!origin && !referer && process.env.NODE_ENV === 'development') {
      logger.warn('No origin or referer, allowing in development mode');
      return true;
    }
    logger.error('CORS blocked', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, origin, referer });
    return false;
  }
}

// Rate limiting
async function checkRateLimit(ip) {
  const client = await getRedisClient();
  const key = `rate_limit:csrf:${ip}`;
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50;

  const requests = Number(await client.get(key)) || 0;
  if (requests >= maxRequests) {
    logger.warn('Rate limit exceeded for CSRF token request', { ip, requests });
    throw new Error('Too many requests, please try again later.');
  }

  await client.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
  logger.info('Rate limit check passed', { ip, requests: requests + 1 });
}

// Security headers
function securityHeaders(origin) {
  const csp = "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info('GET /api/csrf-token requested', { ip, origin, referer });

  // Check CORS
  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  // Check rate limit
  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  // Check authentication
  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not signed in' }, { status: 401 });
  }

  try {
    const client = await getRedisClient();
    const userId = session.user.id;
    const csrfKey = `csrf:${userId}`;

    // Try to get existing CSRF token from Redis
    let csrfToken = await client.get(csrfKey);
    if (!csrfToken) {
      // Generate new CSRF token
      csrfToken = randomBytes(32).toString('hex');
      await client.setEx(csrfKey, 2 * 60 * 60, csrfToken); // Store for 2 hours
      logger.info('Generated new CSRF token', { userId, csrfTokenLength: csrfToken.length });
    } else {
      logger.info('Reusing existing CSRF token from Redis', { userId, csrfTokenLength: csrfToken.length });
    }

    // Set CSRF token in cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 2 * 60 * 60, // 2 hours
    };
    const csrfCookie = cookie.serialize('csrf_token', csrfToken, cookieOptions);
    logger.info('Setting CSRF cookie', { userId, cookieOptions });

    // Prepare response headers
    const headers = new Headers(securityHeaders(origin));
    headers.append('Set-Cookie', csrfCookie);

    return NextResponse.json({ success: true, csrfToken }, { headers });
  } catch (error) {
    logger.error('Error processing /api/csrf-token', { error: error.message, ip, stack: error.stack });
    return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500 });
  }
}

// Handle process termination
process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGTERM');
  }
});

process.on('SIGINT', async () => {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGINT');
  }
});