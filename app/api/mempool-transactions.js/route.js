import { NextResponse } from 'next/server';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { createClient } from 'redis';
import { logger } from '../../../utils/serverLogger';
import { auth } from '@/lib/auth';

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message, stack: err.stack }));
    try {
      await redisClient.connect();
      logger.info('Redis connected', { timestamp: new Date().toISOString() });
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

// ================= Security Headers =================
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
    baseHeaders['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    baseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
    baseHeaders['Access-Control-Allow-Credentials'] = 'true';
  }
  return baseHeaders;
}

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  ...(process.env.VERCEL_ENV === 'production' ? [] : ['https://*.vercel.app']),
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/.*\.vercel\.app$/;

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info('No Origin or Referer (likely SSR or server-to-server), allowing request');
    return true;
  }
  let checkOrigin;
  try {
    checkOrigin = origin || (referer ? new URL(referer).origin : null);
  } catch (err) {
    logger.warn('Invalid referer URL', { referer, err });
    checkOrigin = null;
  }
  if (!checkOrigin) {
    logger.info('No valid Origin or Referer, allowing for SSR compatibility');
    return true;
  }
  if (allowedOrigins.some((allowed) =>
    allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(checkOrigin) : allowed === checkOrigin
  )) {
    logger.info(`Origin allowed: ${checkOrigin}`);
    return true;
  }
  if (vercelPreviewRegex.test(checkOrigin)) {
    logger.info(`Origin allowed by Vercel preview regex: ${checkOrigin}`);
    return true;
  }
  logger.error(`CORS error: Origin ${checkOrigin || 'null'} not allowed`);
  return false;
}

// ================= IP Ban and Rate Limiting =================
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

// ================= Axios Retry and Rate Limiting =================
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    logger.info(`Retry attempt ${retryCount} for Mempool API`);
    return Math.pow(2, retryCount) * 1000 + Math.random() * 200;
  },
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
});

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 5,
  minTime: process.env.NODE_ENV === 'production' ? 2400 : 1000, // ~25/min
  reservoir: 25,
  reservoirRefreshAmount: 25,
  reservoirRefreshInterval: 60 * 1000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await axios.get(url, {
      ...config,
      headers: {
        ...config.headers,
        'User-Agent': 'Your-App-Name/1.0',
      },
      timeout: 10000,
    });
    return response;
  } catch (error) {
    logger.error(`Axios error: ${error.message}`, { url, status: error.response?.status });
    throw error;
  }
});

// ================= OPTIONS Handler =================
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

// ================= GET Handler =================
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

  const { searchParams } = new URL(request.url);
  const addresses = searchParams.get('addresses')?.split(',').map(addr => addr.trim()) || [];
  const isGeneralQuery = addresses.length === 0;

  try {
    const session = await auth();
    if (!session) {
      logger.warn('Unauthorized access to mempool transactions', { addresses, isGeneralQuery });
      return NextResponse.json(
        { success: false, detail: 'Authentication required' },
        { status: 401, headers }
      );
    }

    const cacheKey = isGeneralQuery ? 'mempool-transactions' : `mempool:transactions:${addresses.join(',')}`;
    const cacheTTL = 5 * 60; // 5 minutes
    const redisClient = await getRedisClient();
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      logger.info(`Cache hit for mempool transactions: ${cacheKey}`);
      return NextResponse.json(JSON.parse(cachedData), { headers });
    }

    let transactions = [];

    if (isGeneralQuery) {
      // Backward compatibility: Fetch general mempool transactions
      logger.warn('General mempool transactions not implemented; returning empty array');
      transactions = [];
    } else {
      // Fetch transactions for specific addresses
      for (const address of addresses) {
        // Validate Bitcoin address (legacy or SegWit)
        if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(address)) {
          logger.warn(`Invalid Bitcoin address: ${address}`);
          await trackViolation(ip, 'Invalid Bitcoin address', 'warn');
          continue;
        }

        try {
          const response = await fetchWithRateLimit(`https://mempool.space/api/address/${address}/txs`, {
            headers: {
              'User-Agent': 'Your-App-Name/1.0',
            },
          });
          transactions.push(...response.data);
          logger.info(`Fetched transactions for address: ${address}`, { txCount: response.data.length });
        } catch (error) {
          logger.error(`Error fetching transactions for address ${address}:`, { error: error.message });
          // Continue with other addresses to avoid failing the entire request
        }
      }
    }

    // Filter out duplicates by txid (if any)
    transactions = Array.from(new Map(transactions.map(tx => [tx.txid, tx])).values());

    await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data: transactions }));
    logger.info(`Fetched and cached mempool transactions: ${cacheKey}`, { txCount: transactions.length });

    return NextResponse.json({ success: true, data: transactions }, { headers });
  } catch (error) {
    logger.error('Mempool API error:', { error: error.message, stack: error.stack });
    await trackViolation(ip, `Mempool API error: ${error.message}`, 'severe');
    return NextResponse.json(
      {
        success: false,
        detail: error.response?.status === 429
          ? 'Mempool API rate limit exceeded. Please try again in a few minutes.'
          : `Failed to fetch data: ${error.message}`,
        data: [],
      },
      { status: error.response?.status || 500, headers }
    );
  }
}