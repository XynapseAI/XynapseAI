// app/api/mempool/route.js
import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { z } from 'zod';
import { createClient } from 'redis';

const bodySchema = z.object({
  action: z.literal('tx-details'),
  txHash: z.string().refine((val) => /^[a-fA-F0-9]{64}$/.test(val), { message: 'Invalid Bitcoin transaction hash' }),
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  "https://base.xynapseai.net",
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    await redisClient.connect();
    logger.info('Redis connected for mempool');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected for mempool');
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
    if (!origin && !referer) {
      return true;
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
  const key = `rate_limit:mempool:${ip}`;
  const windowMs = 60 * 1000;
  const maxRequests = 25; // Đồng bộ với mẫu
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
  const nonCriticalReasons = ['Not allowed by CORS', 'Invalid JSON body', 'Validation failed', 'Invalid action'];
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
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }
  return new NextResponse(null, { status: 204, headers: securityHeaders(origin) });
}

// NEW: Fetch BTC price from CoinMarketCap
async function fetchBtcPrice() {
  if (!process.env.COINMARKETCAP_API_KEY) {
    logger.info('CMC API key missing, skipping BTC price fetch');
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const startTime = Date.now();
  logger.info(`Starting CMC fetch for BTC price at ${new Date().toISOString()}`);

  try {
    const response = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?id=1&convert=USD', {
      signal: controller.signal,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY,
        'User-Agent': 'xynapse-bot/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;
    logger.info(`CMC fetch completed in ${duration}ms`, { size: JSON.stringify(data).length });

    if (data.status?.error_code === 0 && data.data['1']?.quote?.USD?.price) {
      return data.data['1'].quote.USD.price;
    } else {
      logger.warn(`CMC returned error: ${data.status?.error_message}`);
      return null;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    logger.error(`CMC fetch failed after ${duration}ms`, { error: error.message, name: error.name });
    return null;
  }
}

// Native fetch with timeout
async function fetchTx(txHash) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const startTime = Date.now();
  logger.info(`Starting fetch for tx ${txHash} at ${new Date().toISOString()}`);

  try {
    const response = await fetch(`https://mempool.space/api/tx/${txHash}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'xynapse-bot/1.0' },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;
    logger.info(`Mempool fetch completed in ${duration}ms`, { txHash, size: JSON.stringify(data).length });

    // NEW: Fetch BTC price and calculate USD values
    const btcPrice = await fetchBtcPrice();
    if (btcPrice) {
      const totalValueBtc = data.vout ? data.vout.reduce((sum, out) => sum + (out.value || 0), 0) / 1e8 : 0;
      data.valueUSD = totalValueBtc * btcPrice;

      const feeBtc = (data.fee || 0) / 1e8;
      data.feeUSD = feeBtc * btcPrice;

      if (data.vout) {
        data.vout.forEach(vout => {
          vout.valueUSD = (vout.value || 0) / 1e8 * btcPrice;
        });
      }

      logger.info(`BTC price integrated: ${btcPrice} USD/BTC, total value USD: ${data.valueUSD}`);
    }

    return { success: true, data };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    logger.error(`Mempool fetch failed after ${duration}ms`, { txHash, error: error.message, name: error.name });
    throw error;
  }
}

export async function POST(request) {
  const startOverall = Date.now();
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`POST request to /api/mempool from IP ${ip}`, { origin, timestamp: new Date().toISOString() });

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'Not allowed by CORS', 'warn');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    if (err.message.includes('Too many requests')) {
      return NextResponse.json({ detail: err.message }, { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } });
    }
    await trackViolation(ip, err.message, 'severe');
    return NextResponse.json({ detail: err.message }, { status: 429, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    await trackViolation(ip, 'Invalid JSON body', 'warn');
    logger.error('Invalid JSON body', { error: err.message });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    await trackViolation(ip, 'Validation failed', 'warn');
    logger.warn('Validation failed', { errors: err.errors });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400, headers });
  }

  const { action, txHash } = parsedBody;
  if (action !== 'tx-details') {
    await trackViolation(ip, 'Invalid action', 'warn');
    return NextResponse.json({ detail: 'Invalid action' }, { status: 400, headers });
  }

  try {
    const redis = await getRedisClient();
    const cacheKey = `explorer:tx:bitcoin:${txHash.toLowerCase()}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for tx-details: ${cacheKey}`);
      const result = JSON.parse(cached);
      const overallDuration = Date.now() - startOverall;
      logger.info(`Full API handler completed in ${overallDuration}ms (cache hit)`, { txHash });

      const res = NextResponse.json(result, { headers });
      const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
      res.headers.set('Access-Control-Allow-Origin', allowOrigin);
      return res;
    }

    const result = await fetchTx(txHash);
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
    logger.info(`Cached tx-details: ${cacheKey}`);

    const overallDuration = Date.now() - startOverall;
    logger.info(`Full API handler completed in ${overallDuration}ms`, { txHash });

    const res = NextResponse.json(result, { headers });
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    return res;
  } catch (error) {
    const overallDuration = Date.now() - startOverall;
    logger.error(`Full API error after ${overallDuration}ms`, { txHash, error: error.message, stack: error.stack });
    await trackViolation(ip, error.message, 'severe');
    const detail = error.name === 'AbortError' ? 'Request timeout - network slow, retry?' : (error.message.includes('not found') ? 'Transaction not found' : 'API error');
    return NextResponse.json({ detail }, { status: 500, headers });
  }
}