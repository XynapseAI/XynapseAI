import { NextResponse } from 'next/server';
import { query } from '../../../utils/postgres';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';
import util from 'util';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const scrypt = util.promisify(crypto.scrypt);

function validateEnvVars() {
  const requiredVars = ['DATABASE_URL', 'REDIS_URL', 'NEXT_PUBLIC_APP_URL'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  logger.info('All required environment variables validated');
}

validateEnvVars();

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
  try {
    await client.connect();
    logger.info('Redis connected');
    return client;
  } catch (err) {
    logger.error('Redis connect failed', { err });
    throw new Error('Redis connection failed');
  }
}

const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
  );
};

async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Database connection failed, retrying...`, { attempt: i + 1 });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function checkRateLimit(ip, endpoint) {
  let client;
  try {
    client = await getRedisClient();
    const windowSeconds = 15 * 60;
    const maxRequests = process.env.NODE_ENV === 'development' ? 500 : 300;
    const key = `rate_limit:${endpoint}:${ip}`;
    const count = Number(await client.incr(key));
    if (count === 1) await client.expire(key, windowSeconds);
    if (count > maxRequests) {
      const ttl = await client.ttl(key);
      throw Object.assign(new Error('Too many requests'), { ttl });
    }
    logger.info(`Rate limit check passed for IP ${ip}: ${count}/${maxRequests} requests`);
  } finally {
    if (client) {
      await client.quit().catch(err => logger.warn('Redis disconnect failed', { err: err?.message }));
    }
  }
}

async function checkIPBan(ip) {
  let client;
  try {
    client = await getRedisClient();
    const isBanned = await client.get(`banned_ip:${ip}`);
    if (isBanned) {
      logger.error(`IP ban detected: ${ip}`);
      throw new Error('IP temporarily banned due to excessive violations.');
    }
  } finally {
    if (client) {
      await client.quit().catch(err => logger.warn('Redis disconnect failed', { err: err?.message }));
    }
  }
}

async function trackViolation(ip, reason, severity = 'warn') {
  if (severity === 'warn') {
    logger.warn('Violation recorded (warning)', { ip, reason });
    return;
  }
  let client;
  try {
    client = await getRedisClient();
    const key = `violations:${ip}`;
    const maxViolations = 20;
    const windowMs = 15 * 60 * 1000;
    const violations = parseInt(await client.get(key)) || 0;
    if (violations >= maxViolations) {
      await client.setEx(`banned_ip:${ip}`, 600, 'banned');
      logger.info('IP banned', { ip, reason });
      throw new Error('IP banned due to repeated violations.');
    }
    await client.multi().incr(key).expire(key, Math.floor(windowMs / 1000)).exec();
    logger.warn('Violation recorded (severe)', { ip, reason, violations: violations + 1 });
  } finally {
    if (client) {
      await client.quit().catch(err => logger.warn('Redis disconnect failed', { err: err?.message }));
    }
  }
}

async function isAllowedOrigin(origin, referer, pathname) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://farcaster.xynapseai.net',
    "https://base.xynapseai.net",
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);

  logger.info('Checking origin', { origin, referer, pathname, configured });

  try {
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        return false;
      }
      if (configured.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      logger.warn('Invalid origin', { origin });
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        return false;
      }
      if (configured.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      logger.warn('Invalid referer', { referer });
      return false;
    }

    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    if (!origin && process.env.NODE_ENV === 'production') {
      logger.warn('Null origin blocked in production', { pathname });
      return false;
    }

    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Null origin allowed in development');
      return true;
    }

    logger.warn('Invalid origin or referer', { origin, referer });
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, origin, referer, pathname });
    return false;
  }
}

async function checkIp(ip) {
  try {
    const response = await fetch(`https://ipinfo.io/${ip}/json?token=${process.env.IPINFO_TOKEN}`);
    const data = await response.json();
    const { abuse } = data;
    if (abuse && abuse.score > 80) {
      logger.warn(`Suspicious IP detected: ${ip}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`IP check failed: ${error.message}`);
    return true; // Fail-open to avoid blocking all requests if ipinfo.io is down
  }
}

function securityHeaders(origin) {
  const csp =
    "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  const headers = {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Content-Type': 'application/json',
  };
  if (origin && origin !== 'null') {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const pathname = new URL(request.url).pathname;
  const referer = request.headers.get('referer');

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  return new NextResponse(null, {
    status: 204,
    headers: securityHeaders(origin),
  });
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info(`GET request to /api/search-nametags from IP ${ip}`, { origin, referer, timestamp: new Date().toISOString() });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked', 'warn');
    logger.error(`CORS error: Origin ${origin || 'null'} or Referer ${referer || 'null'} not allowed`);
    return NextResponse.json(
      { success: false, error: 'Not allowed by CORS' },
      { status: 403, headers: securityHeaders(origin) }
    );
  }

  const headers = securityHeaders(origin);

  try {
    await checkIPBan(ip);
  } catch (err) {
    await trackViolation(ip, err.message, 'severe');
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 403, headers }
    );
  }

  try {
    const isSafeIp = await checkIp(ip);
    if (!isSafeIp) {
      await trackViolation(ip, 'Suspicious IP', 'severe');
      return NextResponse.json(
        { success: false, error: 'Suspicious IP detected' },
        { status: 403, headers }
      );
    }
  } catch (err) {
    logger.error(`IP reputation check failed for ${ip}: ${err.message}`);
  }

  try {
    await checkRateLimit(ip, 'search-nametags');
  } catch (err) {
    await trackViolation(ip, err.message, 'warn');
    logger.warn(`Rate limit exceeded for search-nametags API: ${err.message}`);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
    );
  }

  let redisClient;
  try {
    const { searchParams } = new URL(request.url);
    const searchQuery = searchParams.get('query');

    if (!searchQuery || searchQuery.trim().length < 2) {
      await trackViolation(ip, 'Invalid query', 'warn');
      return NextResponse.json(
        { success: false, error: 'Query must be at least 2 characters long' },
        { status: 400, headers }
      );
    }

    redisClient = await getRedisClient();
    const cacheKey = `nametags_search_${searchQuery.trim().toLowerCase()}`;
    const cacheTTL = 7200; // 2 hours

    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      logger.info('Nametag search cache hit', { query: searchQuery, cacheKey });
      return NextResponse.json(JSON.parse(cachedData), { headers });
    }

    const searchTerm = `%${searchQuery.trim().toLowerCase()}%`;
    const exactMatch = searchQuery.trim().toLowerCase();
    const startMatch = `${searchQuery.trim().toLowerCase()}%`;

    const searchSql = `
      SELECT address, nametag, image, description, subcategory
      FROM nametags 
      WHERE LOWER(nametag) LIKE $1 
         OR LOWER(description) LIKE $1 
         OR LOWER(address) LIKE $1
         OR LOWER(subcategory) LIKE $1
      ORDER BY 
        CASE 
          WHEN LOWER(nametag) = $2 THEN 1
          WHEN LOWER(nametag) LIKE $3 THEN 2
          WHEN LOWER(address) LIKE $3 THEN 3
          WHEN LOWER(description) LIKE $1 THEN 4
          WHEN LOWER(subcategory) LIKE $1 THEN 5
          ELSE 6
        END,
        nametag ASC
      LIMIT 20
    `;

    const results = await withRetry(() => query(searchSql, [searchTerm, exactMatch, startMatch]));

    const responseData = {
      success: true,
      data: results.rows,
      count: results.rows.length,
    };

    await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(serializeBigInt(responseData)));
    logger.info('Nametag search completed', { query: searchQuery, resultCount: results.rows.length, cacheKey });

    return NextResponse.json(responseData, { headers });
  } catch (error) {
    const isSystemError = error.message.includes('Redis') || error.message.includes('Database') || error.message === 'Internal server error';
    await trackViolation(ip, `Error in nametag search: ${error.message}`, isSystemError ? 'warn' : 'severe');
    logger.error(`Error in nametag search:`, { error: error.message, stack: error.stack });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers }
    );
  } finally {
    if (redisClient) {
      await redisClient.quit().catch(err => logger.warn('Redis disconnect failed', { err: err?.message }));
    }
  }
}