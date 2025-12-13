// app/api/cluster/route.js
import { NextResponse } from 'next/server';
import { detectClustersServer } from '../../../utils/serverClustering';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

// Danh sách các nguồn gốc (origins) được phép truy cập API
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
      logger.log('Localhost request - skipping violation check');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function securityHeaders(origin) {
  const baseHeaders = {
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self';",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };
  if (origin && origin !== 'null') {
    baseHeaders['Access-Control-Allow-Origin'] = origin;
    baseHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    baseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return baseHeaders;
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:cluster:${ip}`;
  const maxRequests = 50; // Thấp hơn vì clustering nặng
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
  logger.info(`Rate limit check passed for IP ${ip}: ${requests + 1}/${maxRequests}`);
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
  const nonCriticalReasons = ['CORS blocked', 'Invalid input: nodes and edges must be arrays.'];
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

export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!isAllowedOrigin(origin, referer)) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin, referer });
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }
  return new NextResponse(null, { status: 204, headers: securityHeaders(origin) });
}

/**
 * Xử lý yêu cầu POST tới /api/cluster
 */
export async function POST(request) {
  const startOverall = Date.now();
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '::1';
  logger.info(`POST request to /api/cluster from IP ${ip}`, { origin, timestamp: new Date().toISOString() });

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked', 'warn');
    logger.warn(`[Violation] Blocked request from Origin: ${origin || 'None'} and Referer: ${referer || 'None'} at IP: ${ip}`);
    return NextResponse.json({ success: false, error: 'Forbidden Origin' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    if (err.message.includes('Too many requests')) {
      return NextResponse.json({ success: false, error: err.message }, { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } });
    }
    await trackViolation(ip, err.message, 'severe');
    return NextResponse.json({ success: false, error: err.message }, { status: 429, headers });
  }

  // 2. Tải các thư viện nặng (Dynamic Import)
  let tf = null;
  let IsolationForest = null;

  try {
    const tfModule = await import('@tensorflow/tfjs');
    tf = tfModule;
    logger.log('TF.js loaded successfully');
  } catch (tfErr) {
    logger.warn("TF.js load failed:", tfErr.message);
  }

  try {
    const ifModule = await import('ml-isolation-forest');
    IsolationForest = ifModule.IsolationForest || ifModule.default?.IsolationForest || ifModule.default;
    logger.log('Isolation Forest loaded successfully');
  } catch (ifErr) {
    logger.warn("Isolation Forest load failed:", ifErr.message);
  }

  // 3. Xử lý yêu cầu chính
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      await trackViolation(ip, 'Invalid JSON body', 'warn');
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400, headers });
    }

    const { nodes, edges, options } = body;

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      await trackViolation(ip, 'Invalid input: nodes and edges must be arrays.', 'warn');
      return NextResponse.json({ success: false, error: 'Invalid input: nodes and edges must be arrays.' }, { status: 400, headers });
    }

    const clusters = await detectClustersServer(
      nodes,
      edges,
      options,
      tf,
      IsolationForest
    );

    const timeElapsed = Date.now() - startOverall;
    logger.log(`Clustering completed successfully after ${timeElapsed}ms`);

    return NextResponse.json({
      success: true,
      clusters,
      time: timeElapsed
    }, { headers });

  } catch (error) {
    const timeElapsed = Date.now() - startOverall;
    logger.error(`Clustering error after ${timeElapsed}ms`, {
      error: error.message,
      stack: error.stack
    });
    await trackViolation(ip, error.message, 'severe');

    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500, headers });
  }
}