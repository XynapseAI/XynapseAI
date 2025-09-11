import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (redisClient && redisClient.isOpen) return redisClient;

  const maxRetries = 3;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      if (!redisClient) {
        redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
        redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message, stack: err.stack }));
      }
      if (!redisClient.isOpen) {
        await redisClient.connect();
        logger.info('Redis connected', { timestamp: new Date().toISOString() });
      }
      return redisClient;
    } catch (err) {
      attempt++;
      logger.error(`Redis connect attempt ${attempt} failed`, { err });
      if (attempt === maxRetries) {
        throw new Error('Redis connection failed after max retries');
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// ================= Security Headers =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  ...(process.env.VERCEL_ENV === 'production' ? [] : [
    'https://specific-preview.vercel.app', // Replace with specific preview URLs
  ]),
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/.*\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (!origin || origin === 'null') {
    logger.warn('No valid Origin provided', { origin });
    return process.env.VERCEL_ENV !== 'production';
  }
  if (allowedOrigins.some((allowed) =>
    allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(origin) : allowed === origin
  )) {
    logger.info(`Origin allowed: ${origin}`);
    return true;
  }
  if (process.env.VERCEL_ENV !== 'production' && vercelPreviewRegex.test(origin)) {
    logger.info(`Origin allowed by Vercel preview regex: ${origin}`);
    return true;
  }
  logger.error(`CORS error: Origin ${origin} not allowed`);
  return false;
}

function securityHeaders(origin) {
  const baseHeaders = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self';",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
  if (origin && origin !== 'null' && isAllowedOrigin(origin)) {
    baseHeaders['Access-Control-Allow-Origin'] = allowedOrigins.find((allowed) =>
      allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(origin) : allowed === origin
    ) || origin;
    baseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    baseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
    // Only enable if credentials are required
    // baseHeaders['Access-Control-Allow-Credentials'] = 'true';
  }
  return baseHeaders;
}

// ================= Rate Limiting =================
async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:cache:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = 400;
  if (requests >= maxRequests) {
    const ttl = await redisClient.ttl(key) || 60;
    const err = new Error('Too many requests, please try again later.');
    err.ttl = ttl;
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`);
    throw err;
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
  logger.info(`Rate limit check passed for IP ${ip}: ${requests + 1}/${maxRequests} requests`);
}

// ================= OPTIONS Handler =================
export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin });
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }
  return new NextResponse(null, {
    status: 204,
    headers: securityHeaders(origin),
  });
}

// ================= GET Handler =================
export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  logger.info(`GET request to /api/cache from IP ${ip} with key: ${key}`, { origin });

  try {
    if (!isAllowedOrigin(origin)) {
      logger.warn('CORS origin not allowed for GET', { origin, ip });
      return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
    }

    await checkRateLimit(ip);

    if (!key || typeof key !== 'string' || key.trim() === '') {
      logger.warn('Missing or invalid key parameter', { ip });
      return NextResponse.json({ success: false, detail: 'Missing or invalid key parameter' }, { status: 400, headers: securityHeaders(origin) });
    }

    const redisClient = await getRedisClient();
    const cached = await redisClient.get(key);
    logger.info(`Cache get: ${key}`, { ip });
    return NextResponse.json(
      { success: true, data: cached ? JSON.parse(cached) : null },
      { headers: securityHeaders(origin) }
    );
  } catch (error) {
    logger.error(`GET error: ${error.message}`, { stack: error.stack, ip });
    const headers = securityHeaders(origin);
    if (error.message.includes('Too many requests')) {
      return NextResponse.json(
        { success: false, detail: error.message },
        { status: 429, headers: { ...headers, 'Retry-After': error.ttl.toString() } }
      );
    }
    return NextResponse.json(
      { success: false, detail: `Error: ${error.message}` },
      { status: 500, headers }
    );
  }
}

// ================= POST Handler =================
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  logger.info(`POST request to /api/cache from IP ${ip}`, { origin });

  try {
    if (!isAllowedOrigin(origin)) {
      logger.warn('CORS origin not allowed for POST', { origin, ip });
      return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
    }

    await checkRateLimit(ip);

    let body;
    try {
      body = await request.json();
    } catch (err) {
      logger.warn(`Invalid JSON body: ${err.message}`, { ip });
      return NextResponse.json({ success: false, detail: 'Invalid JSON body' }, { status: 400, headers: securityHeaders(origin) });
    }

    const { key, action, data, ttl } = body;

    if (!key || typeof key !== 'string' || key.trim() === '') {
      logger.warn('Missing or invalid key parameter', { ip });
      return NextResponse.json({ success: false, detail: 'Missing or invalid key parameter' }, { status: 400, headers: securityHeaders(origin) });
    }

    if (!action || !['get', 'set'].includes(action)) {
      logger.warn(`Invalid action: ${action}`, { ip });
      return NextResponse.json({ success: false, detail: `Invalid action: ${action}` }, { status: 400, headers: securityHeaders(origin) });
    }

    const maxTTL = 48 * 60 * 60; // 48 hours
    const effectiveTTL = ttl && Number.isInteger(ttl) && ttl > 0 ? Math.min(ttl / 1000, maxTTL) : 60;

    const redisClient = await getRedisClient();
    if (action === 'get') {
      const cached = await redisClient.get(key);
      logger.info(`Cache get: ${key}`, { ip });
      return NextResponse.json(
        { success: true, data: cached ? JSON.parse(cached) : null },
        { headers: securityHeaders(origin) }
      );
    } else if (action === 'set') {
      if (!data) {
        logger.warn(`Data is required for set action: ${key}`, { ip });
        return NextResponse.json({ success: false, detail: 'Data is required for set action' }, { status: 400, headers: securityHeaders(origin) });
      }
      await redisClient.setEx(key, effectiveTTL, JSON.stringify(data));
      logger.info(`Cache set: ${key}, ttl: ${effectiveTTL}`, { ip });
      return NextResponse.json(
        { success: true },
        { headers: securityHeaders(origin) }
      );
    }
  } catch (error) {
    logger.error(`POST error: ${error.message}`, { stack: error.stack, ip });
    const headers = securityHeaders(origin);
    if (error.message.includes('Too many requests')) {
      return NextResponse.json(
        { success: false, detail: error.message },
        { status: 429, headers: { ...headers, 'Retry-After': error.ttl.toString() } }
      );
    }
    return NextResponse.json(
      { success: false, detail: `Error: ${error.message}` },
      { status: 500, headers }
    );
  }
}