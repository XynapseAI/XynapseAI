// app/api/mempool-transactions/route.js
import { NextResponse } from 'next/server';
import { createClient } from 'redis';
import { logger } from '../../../utils/serverLogger';
import { auth } from '@/lib/auth';

// Redis Client
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    await redisClient.connect();
    logger.info('Redis connected');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

// Security Headers (unchanged)
function securityHeaders(origin) {
  const baseHeaders = {
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'; connect-src 'self' https://xynapse-ai.vercel.app;",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };
  if (origin && origin !== 'null') {
    baseHeaders['Access-Control-Allow-Origin'] = origin;
    baseHeaders['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    baseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return baseHeaders;
}

// Allowed Origins (unchanged)
async function isAllowedOrigin(origin, referer, pathname, ip) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    return configured.includes(origin) || configured.includes(referer ? new URL(referer).origin : null);
  }

  try {
    if (!origin && !referer) {
      await trackViolation(ip, 'Missing origin and referer in production');
      return false; 
    }

    if (origin && origin !== 'null') {
      if (!origin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS origin in production');
        return false;
      }
      if (configured.includes(origin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid origin');
      return false;
    }

    if (referer) {
      const refOrigin = new URL(referer).origin;
      if (!refOrigin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS referer in production');
        return false;
      }
      if (configured.includes(refOrigin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid referer');
      return false;
    }

    await trackViolation(ip, 'Invalid origin or referer');
    return false;
  } catch {
    await trackViolation(ip, 'Error validating origin');
    return false;
  }
}

// IP Ban and Rate Limiting (unchanged)
async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    logger.error(`IP ban detected: ${ip}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown', severity = 'severe') {
  const nonCriticalReasons = ['CORS blocked', 'Invalid Bitcoin address'];
  if (nonCriticalReasons.includes(reason) || severity === 'warn') {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}`);
    return;
  }
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 20;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;
  if (violations >= maxViolations) {
    await banIP(ip);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:mempool:${ip}`;
  const windowMs = 60 * 1000;
  const maxRequests = 25;
  const requests = parseInt(await redisClient.get(key)) || 0;
  if (requests >= maxRequests) {
    const ttl = await redisClient.ttl(key);
    const err = new Error('Too many requests, please try again later.');
    err.ttl = ttl || 60;
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`);
    throw err;
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.info(`Rate limit check passed for IP ${ip}: ${requests + 1}/${maxRequests} requests`);
}

// OPTIONS Handler
export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!isAllowedOrigin(origin, referer)) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin, referer });
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }
  return new NextResponse(null, {
    status: 204,
    headers: securityHeaders(origin),
  });
}

// GET Handler
export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Request to /api/mempool-transactions from IP ${ip}`, { origin, timestamp: new Date().toISOString() });

  // Check CORS
  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked', 'warn');
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  // Check IP ban and rate limit
  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    if (err.message.includes('Too many requests')) {
      logger.warn(`Rate limit error for IP ${ip}: ${err.message}`);
      return NextResponse.json(
        { success: false, detail: err.message },
        { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
      );
    }
    await trackViolation(ip, err.message, 'severe');
    return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers });
  }

  try {
    const session = await auth();
    if (!session) {
      logger.warn('Unauthorized access to mempool transactions');
      return NextResponse.json(
        { success: false, detail: 'Authentication required' },
        { status: 401, headers }
      );
    }

    // Tối ưu: Parse query params để filter động
    const url = new URL(request.url);
    let maxAgeSeconds = parseInt(url.searchParams.get('maxAge')) || (2 * 60 * 60); // Mặc định 2h như file cũ
    const maxAllowedAge = 7 * 24 * 60 * 60; // Max 7 ngày
    if (maxAgeSeconds > maxAllowedAge) {
      maxAgeSeconds = maxAllowedAge;
    }
    logger.info(`Using maxAgeSeconds: ${maxAgeSeconds} for request`);

    const cacheKey = 'mempool-transactions';
    const redisClient = await getRedisClient();
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      let parsed = JSON.parse(cachedData);
      const now = Math.floor(Date.now() / 1000);
      // Filter theo maxAge động thay vì fixed
      parsed.data = parsed.data
        .filter((tx) => tx.timestamp >= now - maxAgeSeconds)
        .sort((a, b) => b.timestamp - a.timestamp);
      logger.info(`Cache hit for mempool transactions: ${cacheKey}`, { transactionCount: parsed.data.length, maxAgeSeconds });
      return NextResponse.json(parsed, { headers });
    }

    // If no cache, return empty response (WebSocket server should populate Redis)
    logger.warn('No cached mempool transactions found');
    return NextResponse.json(
      { success: true, data: [] },
      { status: 200, headers }
    );
  } catch (error) {
    logger.error('Mempool API error:', { error: error.message, stack: error.stack });
    await trackViolation(ip, `Mempool API error: ${error.message}`, 'severe');
    return NextResponse.json(
      {
        success: false,
        detail: `Failed to fetch data: ${error.message}`,
        data: [],
      },
      { status: 500, headers }
    );
  }
}