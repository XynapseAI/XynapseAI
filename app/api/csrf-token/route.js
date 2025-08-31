import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';
import cookie from 'cookie';

// Redis singleton
const redisClient = globalThis.redisClient || createClient({
  url: process.env.REDIS_URL || 'rediss://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
if (!globalThis.redisClient) {
  globalThis.redisClient = redisClient;
  await redisClient.connect();
}

// List of allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'https://www.xynapseai.net',
  'http://localhost:3000'
].filter(Boolean);

// Generate CSRF token
function generateCsrfToken(userId) {
  if (!process.env.CSRF_SECRET) {
    throw new Error('CSRF_SECRET not configured');
  }
  const nonce = crypto.randomBytes(16).toString('base64url');
  const ts = Date.now().toString();
  const payload = `${userId}|${nonce}|${ts}`;
  const hmac = crypto.createHmac('sha256', process.env.CSRF_SECRET)
    .update(payload)
    .digest('base64url');
  return `${hmac}.${Buffer.from(payload).toString('base64url')}`;
}

// Check Origin
function isAllowedOrigin(origin, host) {
  logger.debug('Checking origin', { origin, host });

  if (!origin) {
    if (process.env.NODE_ENV === 'development') {
      logger.warn('No origin, allowing in development mode');
      return true;
    }
    const hostUrl = `http${process.env.NODE_ENV === 'production' ? 's' : ''}://${host}`;
    if (allowedOrigins.includes(hostUrl)) {
      logger.debug('No origin, but same-origin request', { host });
      return true;
    }
    logger.error('Missing origin in production and not same-origin', { host });
    return false;
  }

  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
    logger.warn('Blocked origin: non-HTTPS in production', { origin });
    return false;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  logger.error('Invalid origin', { origin });
  return false;
}

// CORS headers
function getCorsHeaders(origin) {
  const headers = {
    'Content-Security-Policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none';",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Vary': 'Origin',
    'Cache-Control': 'private, no-store',
  };

  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF-Token';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

// Rate limiting
async function checkRateLimit(ip) {
  const key = `rate_limit:csrf:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 200 : 100;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

// Get client IP
function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const vercelIp = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip');
  const ip = forwarded?.split(',')[0]?.trim() || vercelIp || request.ip || 'unknown';
  logger.debug('Resolved client IP', { ip, forwarded, vercelIp, requestIp: request.ip });
  return ip;
}

// OPTIONS handler
export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  logger.debug('OPTIONS /api/csrf-token requested', { origin, host });

  if (!isAllowedOrigin(origin, host)) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin, host });
    return NextResponse.json({ detail: 'NOT_ALLOWED_BY_CORS' }, { status: 403 });
  }

  return NextResponse.json({}, { headers: getCorsHeaders(origin, host) });
}

// GET handler
export async function GET(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  logger.debug('GET /api/csrf-token requested', { ip, origin, host });

  if (!isAllowedOrigin(origin, host)) {
    logger.warn('CORS origin not allowed for GET', { origin, host });
    return NextResponse.json({ detail: 'NOT_ALLOWED_BY_CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.warn('Rate limit exceeded', { ip, error: err.message });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'NOT_AUTHENTICATED' }, { status: 401 });
  }

  try {
    const csrfToken = generateCsrfToken(session.user.id);
    const headers = new Headers(getCorsHeaders(origin, host));
    headers.append('Set-Cookie', cookie.serialize('csrf_token', csrfToken, {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api',
      maxAge: 60 * 60,
    }));

    return NextResponse.json({ success: true, csrfToken }, { headers });
  } catch (error) {
    logger.error('Error processing /api/csrf-token', { error: error.message, stack: error.stack, ip });
    return NextResponse.json({ detail: 'INTERNAL_ERROR', error: error.message }, { status: 500 });
  }
}