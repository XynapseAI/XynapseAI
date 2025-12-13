// app/api/cache/route.js
import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', err));
    await redisClient.connect();
  }
  return redisClient;
}

// ================= Security =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://base.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

function isAllowedOrigin(origin, referer) {
  try {
    if (origin && (allowedOrigins.includes(origin) || new URL(origin).hostname.endsWith('xynapseai.net'))) {
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('xynapseai.net')) {
        return true;
      }
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function securityHeaders(origin) {
  const baseHeaders = {
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };
  if (origin && origin !== 'null') {
    baseHeaders['Access-Control-Allow-Origin'] = origin;
    baseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    baseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return baseHeaders;
}

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
  const nonCriticalReasons = ['Missing or invalid key parameter', 'Invalid action', 'Data is required for set action', 'Invalid JSON body'];
  if (nonCriticalReasons.includes(reason) || severity === 'warn') {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}`);
    return;
  }
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 10;
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
  const key = `rate_limit:cache:${ip}`;
  const maxRequests = 300; // Đồng bộ với mẫu, giảm từ 500 để an toàn hơn
  const windowMs = 60 * 1000;
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

export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }
  return new NextResponse(null, { status: 204, headers: securityHeaders(origin) });
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`GET request to /api/cache from IP ${ip}`);

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked', 'warn');
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (!key || typeof key !== 'string' || key.trim() === '') {
    await trackViolation(ip, 'Missing or invalid key parameter', 'warn');
    logger.warn('Missing or invalid key parameter', { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid key parameter' }, { status: 400, headers });
  }

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
    const redisClient = await getRedisClient();
    const cached = await redisClient.get(key);
    logger.info(`Cache get: ${key}`, { ip });
    return NextResponse.json(
      { success: true, data: cached ? JSON.parse(cached) : null },
      { headers }
    );
  } catch (error) {
    if (error.message.includes('Too many requests')) {
      return NextResponse.json({ success: false, detail: error.message }, { status: 429, headers: { ...headers, 'Retry-After': error.ttl.toString() } });
    }
    logger.error(`Redis GET error: ${error.message}`, { stack: error.stack, ip });
    await trackViolation(ip, `Redis error: ${error.message}`, 'severe');
    return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500, headers });
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`POST request to /api/cache from IP ${ip}`);

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked', 'warn');
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    if (err.message.includes('Too many requests')) {
      return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } });
    }
    await trackViolation(ip, err.message, 'severe');
    return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    await trackViolation(ip, 'Invalid JSON body', 'warn');
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: 'Invalid JSON body' }, { status: 400, headers });
  }

  const { key, action, data, ttl } = body;

  if (!key || typeof key !== 'string' || key.trim() === '') {
    await trackViolation(ip, 'Missing or invalid key parameter', 'warn');
    logger.warn('Missing or invalid key parameter', { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid key parameter' }, { status: 400, headers });
  }

  if (!action || !['get', 'set'].includes(action)) {
    await trackViolation(ip, `Invalid action: ${action}`, 'warn');
    logger.warn(`Invalid action: ${action}`, { ip });
    return NextResponse.json({ success: false, detail: `Invalid action: ${action}` }, { status: 400, headers });
  }

  const maxTTL = 48 * 60 * 60; // 48 giờ
  const effectiveTTL = ttl && Number.isInteger(ttl) && ttl > 0 ? Math.min(ttl / 1000, maxTTL) : 60;

  try {
    const redisClient = await getRedisClient();
    if (action === 'get') {
      const cached = await redisClient.get(key);
      logger.info(`Cache get: ${key}`, { ip });
      return NextResponse.json(
        { success: true, data: cached ? JSON.parse(cached) : null },
        { headers }
      );
    } else if (action === 'set') {
      if (!data) {
        await trackViolation(ip, 'Data is required for set action', 'warn');
        logger.warn(`Data is required for set action: ${key}`, { ip });
        return NextResponse.json({ success: false, detail: 'Data is required for set action' }, { status: 400, headers });
      }
      await redisClient.setEx(key, effectiveTTL, JSON.stringify(data));
      logger.info(`Cache set: ${key}, ttl: ${effectiveTTL}`, { ip });
      return NextResponse.json({ success: true }, { headers });
    }
  } catch (error) {
    logger.error(`Redis POST error: ${error.message}`, { stack: error.stack, ip });
    await trackViolation(ip, `Redis error: ${error.message}`, 'severe');
    return NextResponse.json({ success: false, detail: `Redis error: ${error.message}` }, { status: 500, headers });
  }
}