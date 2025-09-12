// app/api/watchlists/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { getRedisClient } from '../../../lib/redis';
import { auth } from '@/lib/auth';
import { query } from '../../../utils/postgres';
import { isAddress } from 'ethers';

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// List of allowed origins for CORS
const allowedOrigins = [
  process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

// Validate Solana address
const isValidSolanaAddress = (address) => {
  return address && address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
};

// Validation schemas
const postSchema = z.object({
  action: z.enum(['add', 'remove'], { message: 'Action must be "add" or "remove"' }),
  wallet_address: z
    .string()
    .nonempty('Wallet address is required')
    .refine(
      (val) => isAddress(val) || isValidSolanaAddress(val),
      { message: 'Wallet address must be a valid EVM or Solana address' }
    ),
  name: z.string().optional(),
});

// Rate limiting with Redis
async function checkRateLimit(ip) {
  try {
    const redisClient = await getRedisClient();
    const key = `rate_limit:watchlists:${ip}`;
    const requests = parseInt(await redisClient.get(key)) || 0;
    const windowMs = 60 * 1000; // 1 minute window
    if (requests >= 10) {
      logger.warn(`Rate limit exceeded for IP ${ip}`);
      throw new Error('Too many requests. Please try again later.');
    }
    await redisClient
      .multi()
      .incr(key)
      .expire(key, windowMs / 1000)
      .exec();
  } catch (err) {
    logger.error(`Redis error in rate limiting: ${err.message}`, { stack: err.stack });
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Bypassing rate limiting in development due to Redis error');
      return; // Allow in development
    }
    throw err;
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 50;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid JSON body', 'Validation error', 'Unauthorized access'].includes(reason)) {
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

// Enhanced CSRF check with Vercel subdomain support and relaxed development mode
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

// GET handler: Fetch watchlists for the authenticated user
export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info(`GET request to /api/watchlists from IP ${ip}`, { origin, referer });

  // CORS check
  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} or Referer ${referer || 'null'} not allowed`);
    return NextResponse.json(
      { error: 'Not allowed by CORS' },
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

  // Rate limiting
  try {
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    logger.warn(`Rate limit exceeded for watchlists API: ${err.message}`);
    return NextResponse.json(
      { success: false, detail: err.message },
      { status: 429, headers }
    );
  }

  // Authentication
  const session = await auth();
  if (!session || !session.user?.id) {
    await trackViolation(ip, 'Unauthorized access');
    logger.warn('Unauthorized access attempt to watchlists API (no session)', { ip, origin, referer });
    return NextResponse.json(
      { success: false, detail: 'Unauthorized: Please log in.' },
      { status: 401, headers }
    );
  }

  try {
    const result = await query(
      `SELECT wallet_address, name FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC`,
      [session.user.id]
    );
    const watchlists = result.rows.map((row) => ({
      wallet_address: row.wallet_address,
      name: row.name || 'Unnamed Wallet',
    }));

    logger.info(`Fetched ${watchlists.length} watchlist entries for user ${session.user.id}`);
    return NextResponse.json(
      { success: true, data: watchlists },
      { status: 200, headers }
    );
  } catch (error) {
    await trackViolation(ip, `Error fetching watchlists: ${error.message}`);
    logger.error(`Error fetching watchlists for user ${session.user.id}: ${error.message}`, { stack: error.stack });
    return NextResponse.json(
      { success: false, detail: `Failed to fetch watchlists: ${error.message}` },
      { status: 500, headers }
    );
  }
}

// POST handler: Add or remove a wallet from the watchlist
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info(`POST request to /api/watchlists from IP ${ip}`, { origin, referer });

  // CORS check
  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} or Referer ${referer || 'null'} not allowed`);
    return NextResponse.json(
      { error: 'Not allowed by CORS' },
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

  // Rate limiting
  try {
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    logger.warn(`Rate limit exceeded for watchlists API: ${err.message}`);
    return NextResponse.json(
      { success: false, detail: err.message },
      { status: 429, headers }
    );
  }

  // Authentication
  const session = await auth();
  if (!session || !session.user?.id) {
    await trackViolation(ip, 'Unauthorized access');
    logger.warn('Unauthorized access attempt to watchlists API (no session)', { ip, origin, referer });
    return NextResponse.json(
      { success: false, detail: 'Unauthorized: Please log in.' },
      { status: 401, headers }
    );
  }

  // Parse and validate request body
  let body;
  try {
    body = await request.json();
  } catch (err) {
    await trackViolation(ip, 'Invalid JSON body');
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json(
      { detail: 'Invalid JSON body' },
      { status: 400, headers }
    );
  }

  let parsedBody;
  try {
    parsedBody = postSchema.parse(body);
  } catch (err) {
    await trackViolation(ip, 'Validation error');
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json(
      { detail: 'Validation failed', errors: err.errors },
      { status: 400, headers }
    );
  }

  const { action, wallet_address, name } = parsedBody;
  const normalizedAddress = isAddress(wallet_address) ? wallet_address.toLowerCase() : wallet_address;

  try {
    if (action === 'add') {
      const existing = await query(
        `SELECT 1 FROM watchlists WHERE user_id = $1 AND wallet_address = $2`,
        [session.user.id, normalizedAddress]
      );
      if (existing.rows.length > 0) {
        await trackViolation(ip, 'Wallet already in watchlist');
        logger.warn(`Wallet ${normalizedAddress} already in watchlist for user ${session.user.id}`);
        return NextResponse.json(
          { success: false, detail: 'Wallet already in watchlist' },
          { status: 400, headers }
        );
      }

      await query(
        `INSERT INTO watchlists (user_id, wallet_address, name, created_at) VALUES ($1, $2, $3, NOW())`,
        [session.user.id, normalizedAddress, name || 'Unnamed Wallet']
      );
      logger.info(`Added wallet ${normalizedAddress} to watchlist for user ${session.user.id}`);
    } else if (action === 'remove') {
      const result = await query(
        `DELETE FROM watchlists WHERE user_id = $1 AND wallet_address = $2`,
        [session.user.id, normalizedAddress]
      );
      if (result.rowCount === 0) {
        await trackViolation(ip, 'Wallet not found in watchlist');
        logger.warn(`Wallet ${normalizedAddress} not found in watchlist for user ${session.user.id}`);
        return NextResponse.json(
          { success: false, detail: 'Wallet not found in watchlist' },
          { status: 404, headers }
        );
      }
      logger.info(`Removed wallet ${normalizedAddress} from watchlist for user ${session.user.id}`);
    }

    const updatedResult = await query(
      `SELECT wallet_address, name FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC`,
      [session.user.id]
    );
    const updatedWatchlists = updatedResult.rows.map((row) => ({
      wallet_address: row.wallet_address,
      name: row.name || 'Unnamed Wallet',
    }));

    logger.info(`Returning updated watchlist with ${updatedWatchlists.length} entries for user ${session.user.id}`);
    return NextResponse.json(
      { success: true, data: updatedWatchlists },
      { status: 200, headers }
    );
  } catch (error) {
    await trackViolation(ip, `Error processing watchlist action: ${error.message}`);
    logger.error(`Error processing watchlist action ${action} for address ${normalizedAddress}: ${error.message}`, {
      stack: error.stack,
    });
    return NextResponse.json(
      { success: false, detail: `Failed to process watchlist action: ${error.message}` },
      { status: 500, headers }
    );
  }
}

// OPTIONS handler for CORS preflight
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