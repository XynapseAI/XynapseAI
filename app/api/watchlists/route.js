// app/api/watchlists/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { getRedisClient } from '../../../lib/redis';
import { auth } from '@/lib/auth';
import { query } from '../../../utils/postgres';
import { isAddress } from 'ethers';

// List of allowed origins for CORS
const allowedOrigins = [
  process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai.vercel.app',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://postgres-production-e852c.up.railway.app',
  'https://xynapseai-production.up.railway.app',
].filter((v, i, a) => a.indexOf(v) === i);

// Rate limiting with Redis
async function checkRateLimit(ip) {
  try {
    const redisClient = await getRedisClient();
    const key = `rate_limit:watchlists:${ip}`;
    const requests = parseInt(await redisClient.get(key)) || 0;
    const windowMs = 60 * 1000; // 1 minute window
    if (requests >= 100) {
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

// Enhanced CSRF check with Vercel subdomain support and relaxed development mode
async function checkCSRF(request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  logger.info('CSRF Check', { origin, referer, host, nodeEnv: process.env.NODE_ENV });

  try {
    // Allow localhost explicitly in development
    if (process.env.NODE_ENV !== 'production' && (origin === 'http://localhost:3000' || referer?.includes('http://localhost:3000'))) {
      logger.info('Allowing localhost request in development mode', { origin, referer });
      return true;
    }

    // Allow requests with matching Origin
    if (origin && allowedOrigins.includes(origin)) {
      logger.info('Origin allowed', { origin, referer });
      return true;
    }

    // Allow Vercel subdomains
    if (origin && new URL(origin).hostname.endsWith('.vercel.app')) {
      logger.info('Vercel domain allowed', { origin, referer });
      return true;
    }

    // Fallback to Referer if Origin is absent
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('.vercel.app')) {
        logger.info('Referer origin allowed', { origin, referer, refOrigin });
        return true;
      }
    }

    // Allow internal/SSR requests in development
    if (!origin && !referer && process.env.NODE_ENV !== 'production') {
      logger.info('Allowing internal/SSR request in development mode', { host });
      return true;
    }

    logger.warn(`CSRF check failed: Invalid or missing Origin/Referer header`, { origin, referer, host });
    return false;
  } catch (error) {
    logger.error('Error in checkCSRF', { error: error.message, origin, referer, host });
    return false;
  }
}

// Validate Solana address
const isValidSolanaAddress = (address) => {
  return address && address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
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

// GET handler: Fetch watchlists for the authenticated user
export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`GET request to /api/watchlists from IP ${ip}`, { origin, referer });

  // CORS check
  if (!(await checkCSRF(request))) {
    logger.error(`CORS error: Origin ${origin || 'null'} or Referer ${referer || 'null'} not allowed`);
    return NextResponse.json(
      { error: 'Invalid or missing Origin/Referer header.' },
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }

  // Rate limiting
  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.warn(`Rate limit exceeded for watchlists API: ${err.message}`);
    return NextResponse.json(
      { success: false, detail: err.message },
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Authentication
  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Unauthorized access attempt to watchlists API (no session)', { ip, origin, referer });
    return NextResponse.json(
      { success: false, detail: 'Unauthorized: Please log in.' },
      { status: 401, headers: { 'Content-Type': 'application/json' } }
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
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  } catch (error) {
    logger.error(`Error fetching watchlists for user ${session.user.id}: ${error.message}`, { stack: error.stack });
    return NextResponse.json(
      { success: false, detail: `Failed to fetch watchlists: ${error.message}` },
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// POST handler: Add or remove a wallet from the watchlist
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`POST request to /api/watchlists from IP ${ip}`, { origin, referer });

  // CORS check
  if (!(await checkCSRF(request))) {
    logger.error(`CORS error: Origin ${origin || 'null'} or Referer ${referer || 'null'} not allowed`);
    return NextResponse.json(
      { error: 'Invalid or missing Origin/Referer header.' },
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }

  // Rate limiting
  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.warn(`Rate limit exceeded for watchlists API: ${err.message}`);
    return NextResponse.json(
      { success: false, detail: err.message },
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Authentication
  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Unauthorized access attempt to watchlists API (no session)', { ip, origin, referer });
    return NextResponse.json(
      { success: false, detail: 'Unauthorized: Please log in.' },
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Parse and validate request body
  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json(
      { detail: 'Invalid JSON body' },
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let parsedBody;
  try {
    parsedBody = postSchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json(
      { detail: 'Validation failed', errors: err.errors },
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { action, wallet_address, name } = parsedBody;
  const normalizedAddress = wallet_address.toLowerCase();

  try {
    if (action === 'add') {
      // Check if wallet already exists in watchlist
      const existing = await query(
        `SELECT 1 FROM watchlists WHERE user_id = $1 AND wallet_address = $2`,
        [session.user.id, normalizedAddress]
      );
      if (existing.rows.length > 0) {
        logger.warn(`Wallet ${normalizedAddress} already in watchlist for user ${session.user.id}`);
        return NextResponse.json(
          { success: false, detail: 'Wallet already in watchlist' },
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Add wallet to watchlist
      await query(
        `INSERT INTO watchlists (user_id, wallet_address, name, created_at) VALUES ($1, $2, $3, NOW())`,
        [session.user.id, normalizedAddress, name || 'Unnamed Wallet']
      );
      logger.info(`Added wallet ${normalizedAddress} to watchlist for user ${session.user.id}`);
    } else if (action === 'remove') {
      // Remove wallet from watchlist
      const result = await query(
        `DELETE FROM watchlists WHERE user_id = $1 AND wallet_address = $2`,
        [session.user.id, normalizedAddress]
      );
      if (result.rowCount === 0) {
        logger.warn(`Wallet ${normalizedAddress} not found in watchlist for user ${session.user.id}`);
        return NextResponse.json(
          { success: false, detail: 'Wallet not found in watchlist' },
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      logger.info(`Removed wallet ${normalizedAddress} from watchlist for user ${session.user.id}`);
    }

    // Fetch updated watchlist
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
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  } catch (error) {
    logger.error(`Error processing watchlist action ${action} for address ${normalizedAddress}: ${error.message}`, {
      stack: error.stack,
    });
    return NextResponse.json(
      { success: false, detail: `Failed to process watchlist action: ${error.message}` },
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// OPTIONS handler for CORS preflight
export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
      },
    }
  );
}