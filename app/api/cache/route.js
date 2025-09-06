// app/api/cache/route.js
import { NextResponse } from 'next/server';
import { createClient } from 'redis';
import { logger } from '../../../utils/serverLogger';

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

const allowedOrigins = [
  process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

let redisClient;
async function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', err));
    redisClient.on('reconnecting', () => logger.info('Redis client reconnecting'));
    await redisClient.connect();
  }
  return redisClient;
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:cache:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = 300; // Giảm xuống 100 yêu cầu/phút
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient
    .multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 50;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid JSON body', 'Validation error'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`);
    return;
  }

  if (violations >= maxViolations) {
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

async function isAllowedOrigin(origin, referer, pathname) {
  logger.info('Checking origin', { origin, referer, pathname, allowedOrigins });

  try {
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        await trackViolation('unknown', 'Non-HTTPS origin in production');
        return false;
      }
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      await trackViolation('unknown', 'Invalid origin');
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        await trackViolation('unknown', 'Non-HTTPS referer in production');
        return false;
      }
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      await trackViolation('unknown', 'Invalid referer');
      return false;
    }

    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    if (!origin && process.env.NODE_ENV === 'production') {
      logger.error('Null origin blocked in production', { pathname });
      await trackViolation('unknown', 'Null origin in production');
      return false;
    }

    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }

    logger.error('Invalid origin or referer', { origin, referer });
    await trackViolation('unknown', 'Invalid origin or referer');
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, origin, referer, pathname });
    await trackViolation('unknown', 'Error validating origin');
    return false;
  }
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  logger.info(`GET request to /api/cache from IP ${ip} with key: ${key}`);

  // Kiểm tra CORS
  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} or Referer ${referer || 'null'} not allowed`);
    return NextResponse.json(
      { success: false, detail: 'Not allowed by CORS' },
      { status: 403, headers: securityHeaders }
    );
  }

  const headers = {
    ...securityHeaders,
    'Content-Type': 'application/json',
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  if (!key || typeof key !== 'string' || key.trim() === '') {
    await trackViolation(ip, 'Invalid key');
    logger.warn('Missing or invalid key parameter', { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid key parameter' }, { status: 400, headers });
  }

  try {
    await checkRateLimit(ip);
    const redisClient = await getRedisClient();
    let cached;
    try {
      cached = await redisClient.get(key);
    } catch (error) {
      logger.error(`Redis GET error for key ${key}: ${error.message}`, { stack: error.stack, ip });
      return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500, headers });
    }

    let parsedData = null;
    if (cached) {
      try {
        parsedData = JSON.parse(cached);
      } catch (error) {
        logger.error(`JSON parse error for key ${key}: ${error.message}`, { stack: error.stack, ip });
        // Xóa dữ liệu không hợp lệ khỏi Redis
        await redisClient.del(key);
      }
    }

    logger.info(`Cache get: ${key}`, { ip, found: !!parsedData });
    return NextResponse.json({ success: true, data: parsedData }, { headers });
  } catch (error) {
    logger.error(`Redis GET error: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500, headers });
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info(`POST request to /api/cache from IP ${ip}`);

  // Kiểm tra CORS
  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} or Referer ${referer || 'null'} not allowed`);
    return NextResponse.json(
      { success: false, detail: 'Not allowed by CORS' },
      { status: 403, headers: securityHeaders }
    );
  }

  const headers = {
    ...securityHeaders,
    'Content-Type': 'application/json',
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, 'Rate limit exceeded');
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    await trackViolation(ip, 'Invalid JSON body');
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: 'Invalid JSON body' }, { status: 400, headers });
  }

  const { key, action, data, ttl } = body;

  if (!key || typeof key !== 'string' || key.trim() === '') {
    await trackViolation(ip, 'Invalid key');
    logger.warn('Missing or invalid key parameter', { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid key parameter' }, { status: 400, headers });
  }

  if (!action || !['get', 'set'].includes(action)) {
    await trackViolation(ip, `Invalid action: ${action}`);
    logger.warn(`Invalid action: ${action}`, { ip });
    return NextResponse.json({ success: false, detail: `Invalid action: ${action}` }, { status: 400, headers });
  }

  const maxTTL = 48 * 60 * 60; // 48 giờ
  const effectiveTTL = ttl && Number.isInteger(ttl) && ttl > 0 ? Math.min(ttl / 1000, maxTTL) : 60;

  try {
    const redisClient = await getRedisClient();
    if (action === 'get') {
      let cached;
      try {
        cached = await redisClient.get(key);
      } catch (error) {
        logger.error(`Redis GET error for key ${key}: ${error.message}`, { stack: error.stack, ip });
        return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500, headers });
      }

      let parsedData = null;
      if (cached) {
        try {
          parsedData = JSON.parse(cached);
        } catch (error) {
          logger.error(`JSON parse error for key ${key}: ${error.message}`, { stack: error.stack, ip });
          await redisClient.del(key);
        }
      }

      // Kiểm tra fallback nếu không có dữ liệu
      if (!parsedData && key.endsWith('-fallback')) {
        logger.info(`No data for fallback key: ${key}`, { ip });
        return NextResponse.json({ success: true, data: null }, { headers });
      } else if (!parsedData) {
        const fallbackKey = `${key}-fallback`;
        try {
          const fallbackCached = await redisClient.get(fallbackKey);
          if (fallbackCached) {
            try {
              parsedData = JSON.parse(fallbackCached);
              logger.info(`Cache get: ${fallbackKey} (fallback)`, { ip });
            } catch (error) {
              logger.error(`JSON parse error for fallback key ${fallbackKey}: ${error.message}`, { stack: error.stack, ip });
              await redisClient.del(fallbackKey);
            }
          }
        } catch (error) {
          logger.error(`Redis GET error for fallback key ${fallbackKey}: ${error.message}`, { stack: error.stack, ip });
        }
      }

      logger.info(`Cache get: ${key}`, { ip, found: !!parsedData });
      return NextResponse.json({ success: true, data: parsedData }, { headers });
    } else if (action === 'set') {
      if (!data) {
        await trackViolation(ip, 'Data required for set action');
        logger.warn(`Data is required for set action: ${key}`, { ip });
        return NextResponse.json({ success: false, detail: 'Data is required for set action' }, { status: 400, headers });
      }
      try {
        await redisClient.setEx(key, effectiveTTL, JSON.stringify(data));
      } catch (error) {
        logger.error(`Redis SET error for key ${key}: ${error.message}`, { stack: error.stack, ip });
        return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500, headers });
      }
      logger.info(`Cache set: ${key}, ttl: ${effectiveTTL}`, { ip });
      return NextResponse.json({ success: true }, { headers });
    }
  } catch (error) {
    logger.error(`Redis POST error: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500, headers });
  }
}

export async function OPTIONS() {
  const headers = {
    ...securityHeaders,
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
  return NextResponse.json({}, { status: 200, headers });
}