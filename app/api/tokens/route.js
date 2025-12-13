// app/api/tokens/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { query } from '../../../utils/postgres';
import { createClient } from 'redis';

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    await redisClient.connect();
    logger.info('Redis connected for tokens');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected for tokens');
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
    baseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    baseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return baseHeaders;
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:tokens:${ip}`;
  const windowMs = 60 * 1000;
  const maxRequests = 100;
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
  const nonCriticalReasons = ['Chain is required', 'Either contractAddress or symbol must be provided', 'CoinGecko ID is required', 'Symbol is required', 'Name is required', 'Image URL is required'];
  if (nonCriticalReasons.includes(reason) || severity === 'warn') {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}`);
    return;
  }
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 50;
  const windowMs = 15 * 60 * 1000;
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

// Map chain IDs to chain names used in detail_platforms
const chainIdToName = {
  '1': 'ethereum',
  '56': 'bsc',
  '10': 'optimism',
  '130': 'unichain',
  '137': 'polygon',
  '5000': 'mantle',
  '42161': 'arbitrum',
  '43114': 'avalanche',
  '59144': 'linea',
  '534352': 'scroll',
  '7777777': 'zora',
  'solana': 'solana',
  'tron': 'tron',
};

const getSchema = z.object({
  contractAddress: z.string().optional(),
  symbol: z.string().optional(),
  chain: z.string().nonempty('Chain is required'),
}).refine((data) => data.contractAddress || data.symbol, {
  message: 'Either contractAddress or symbol must be provided',
});

const postSchema = z.object({
  action: z.literal('update'),
  coingecko_id: z.string().nonempty('CoinGecko ID is required'),
  symbol: z.string().nonempty('Symbol is required'),
  name: z.string().nonempty('Name is required'),
  image: z.string().nonempty('Image URL is required'),
  chain: z.string().nonempty('Chain is required'),
  contractAddress: z.string().optional(),
});

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`GET request to /api/tokens from IP ${ip}`, { origin, timestamp: new Date().toISOString() });

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'Not allowed by CORS', 'warn');
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

  const { searchParams } = new URL(request.url);
  const contractAddress = searchParams.get('contractAddress');
  const symbol = searchParams.get('symbol');
  const chain = searchParams.get('chain');

  try {
    const parsedParams = getSchema.parse({ contractAddress, symbol, chain });

    const chainName = chainIdToName[chain] || chain;
    logger.info(`Querying tokens for chain: ${chainName}`);

    let result;

    if (parsedParams.contractAddress) {
      result = await query(
        `SELECT image
         FROM tokens
         WHERE (detail_platforms->'${chainName}'->>'contract_address' = $1
                OR detail_platforms->''->>'contract_address' = $1)`,
        [parsedParams.contractAddress.toLowerCase()]
      );
    } else if (parsedParams.symbol) {
      result = await query(
        `SELECT image
         FROM tokens
         WHERE symbol = $1
           AND (detail_platforms->'${chainName}'->>'contract_address' IS NOT NULL
                OR detail_platforms->''->>'contract_address' IS NOT NULL)`,
        [parsedParams.symbol.toLowerCase()]
      );
    }

    if (result.rows.length > 0 && result.rows[0].image) {
      logger.info(`Found image for ${contractAddress || symbol}: ${result.rows[0].image}`);
      return NextResponse.json({
        success: true,
        data: { image: result.rows[0].image },
      }, { headers });
    }

    await trackViolation(ip, 'Token image not found in database', 'warn');
    logger.warn(`No image found for ${contractAddress || symbol} on chain ${chainName}`);
    return NextResponse.json({
      success: false,
      error: 'Token image not found in database',
    }, { status: 404, headers });
  } catch (err) {
    if (err instanceof z.ZodError) {
      await trackViolation(ip, err.errors[0].message, 'warn');
      return NextResponse.json({
        success: false,
        error: err.errors[0].message,
      }, { status: 400, headers });
    }
    logger.error('Error fetching token image:', err.message);
    await trackViolation(ip, `Failed to fetch token image: ${err.message}`, 'severe');
    return NextResponse.json({
      success: false,
      error: `Failed to fetch token image: ${err.message}`,
    }, { status: 500, headers });
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`POST request to /api/tokens from IP ${ip}`, { origin, timestamp: new Date().toISOString() });

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'Not allowed by CORS', 'warn');
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

  try {
    const body = await request.json();
    const parsedBody = postSchema.parse(body);

    const { coingecko_id, symbol, name, image, chain, contractAddress } = parsedBody;
    const chainName = chainIdToName[chain] || chain;

    // Prepare detail_platforms JSON
    const detail_platforms = contractAddress
      ? {
          [chainName]: {
            contract_address: contractAddress.toLowerCase(),
            decimal_place: null,
            geckoterminal_url: `https://www.geckoterminal.com/${chainName}/tokens/${contractAddress.toLowerCase()}`,
          },
        }
      : { '': { contract_address: '', decimal_place: null } };

    // Insert or update token in database
    const result = await query(
      `INSERT INTO tokens (coingecko_id, symbol, name, image, detail_platforms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (coingecko_id)
       DO UPDATE SET
         symbol = EXCLUDED.symbol,
         name = EXCLUDED.name,
         image = EXCLUDED.image,
         detail_platforms = EXCLUDED.detail_platforms,
         updated_at = CURRENT_TIMESTAMP
       RETURNING image`,
      [coingecko_id.toLowerCase(), symbol.toLowerCase(), name, image, detail_platforms]
    );

    logger.info(`Updated token ${symbol} for chain ${chainName} in database`);
    return NextResponse.json({
      success: true,
      data: { image: result.rows[0].image },
    }, { headers });
  } catch (err) {
    if (err instanceof z.ZodError) {
      await trackViolation(ip, err.errors[0].message, 'warn');
      return NextResponse.json({
        success: false,
        error: err.errors[0].message,
      }, { status: 400, headers });
    }
    logger.error('Error updating token:', err.message);
    await trackViolation(ip, `Failed to update token: ${err.message}`, 'severe');
    return NextResponse.json({
      success: false,
      error: `Failed to update token: ${err.message}`,
    }, { status: 500, headers });
  }
}