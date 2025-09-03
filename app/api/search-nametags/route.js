import { NextResponse } from "next/server";
import { query } from "../../../utils/postgres";
import { logger } from "../../../utils/serverLogger";
import { getRedisClient } from "../../../lib/redis";

// Security Headers
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// List of allowed origins for CORS
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

// Check allowed origin
async function isAllowedOrigin(origin, referer, pathname) {
  logger.info('Checking origin', { origin, referer, pathname, allowedOrigins });

  try {
    // Kiểm tra origin hợp lệ
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

    // Kiểm tra referer nếu không có origin
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

    // Cho phép internal/SSR request
    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    // Chặn null origin trong production
    if (!origin && process.env.NODE_ENV === 'production') {
      logger.error('Null origin blocked in production', { pathname });
      await trackViolation('unknown', 'Null origin in production');
      return false;
    }

    // Cho phép null origin trong development
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

// Ban IP
async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}

// Check IP ban
async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    logger.error(`IP ban detected: ${ip}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

// Track violations
async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 100;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid query', 'Rate limit exceeded'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`);
    return;
  }

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

// Rate limiting with Redis
async function checkRateLimit(ip, endpoint) {
  try {
    const redisClient = await getRedisClient();
    const key = `rate_limit:${endpoint}:${ip}`;
    const requests = parseInt(await redisClient.get(key)) || 0;
    const windowMs = 60 * 1000; // 1 minute window
    const maxRequests = process.env.NODE_ENV === 'production' ? 30 : 100;
    if (requests >= maxRequests) {
      logger.warn(`Rate limit exceeded for IP ${ip} on endpoint ${endpoint}`);
      throw new Error('Too many requests. Please try again later.');
    }
    await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
    logger.info(`Rate limit check passed for IP ${ip}: ${requests + 1}/${maxRequests} requests`);
  } catch (err) {
    logger.error(`Redis error in rate limiting: ${err.message}`, { stack: err.stack });
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Bypassing rate limiting in development due to Redis error');
      return; // Allow in development
    }
    throw err;
  }
}

// Check IP reputation
async function checkIp(ip) {
  try {
    const response = await fetch(`https://ipinfo.io/${ip}/json?token=${process.env.IPINFO_TOKEN}`);
    const data = await response.json();
    const { abuse } = data;
    if (abuse && abuse.score > 50) {
      logger.warn(`Suspicious IP detected: ${ip}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`IP check failed: ${error.message}`);
    return true; // Fail-open to avoid blocking all requests if ipinfo.io is down
  }
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info(`GET request to /api/search-nametags from IP ${ip}`, { origin, referer, timestamp: new Date().toISOString() });

  // CORS check
  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} or Referer ${referer || 'null'} not allowed`);
    return NextResponse.json(
      { success: false, error: 'Not allowed by CORS' },
      { status: 403, headers: securityHeaders }
    );
  }

  const headers = {
    ...securityHeaders,
    'Content-Type': 'application/json',
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  // Check IP ban
  try {
    await checkIPBan(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 403, headers }
    );
  }

  // Check IP reputation
  try {
    const isSafeIp = await checkIp(ip);
    if (!isSafeIp) {
      await trackViolation(ip, 'Suspicious IP');
      return NextResponse.json(
        { success: false, error: 'Suspicious IP detected' },
        { status: 403, headers }
      );
    }
  } catch (err) {
    logger.error(`IP reputation check failed for ${ip}: ${err.message}`);
    // Fail-open to avoid blocking all requests if ipinfo.io is down
  }

  // Rate limiting
  try {
    await checkRateLimit(ip, 'search-nametags');
  } catch (err) {
    await trackViolation(ip, err.message);
    logger.warn(`Rate limit exceeded for search-nametags API: ${err.message}`);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 429, headers }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const searchQuery = searchParams.get("query");

    if (!searchQuery || searchQuery.trim().length < 2) {
      await trackViolation(ip, 'Invalid query');
      return NextResponse.json(
        { success: false, error: "Query must be at least 2 characters long" },
        { status: 400, headers }
      );
    }

    const redisClient = await getRedisClient();
    const cacheKey = `nametags_search_${searchQuery.trim().toLowerCase()}`;
    const cacheTTL = 5 * 60; // Cache for 5 minutes

    // Check Redis cache
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      logger.info("Nametag search cache hit", {
        query: searchQuery,
        cacheKey,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(JSON.parse(cachedData), { headers });
    }

    const searchTerm = `%${searchQuery.trim().toLowerCase()}%`;
    const exactMatch = searchQuery.trim().toLowerCase();
    const startMatch = `${searchQuery.trim().toLowerCase()}%`;

    // Improved SQL query for better search accuracy
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

    const results = await query(searchSql, [searchTerm, exactMatch, startMatch]);

    const responseData = {
      success: true,
      data: results.rows,
      count: results.rows.length,
    };

    // Store in Redis
    await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(responseData));

    logger.info("Nametag search completed", {
      query: searchQuery,
      resultCount: results.rows.length,
      cacheKey,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(responseData, { headers });
  } catch (error) {
    await trackViolation(ip, `Error in nametag search: ${error.message}`);
    logger.error("Error in nametag search:", {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500, headers }
    );
  }
}