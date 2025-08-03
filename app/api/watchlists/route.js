import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { auth } from '@/lib/auth';
import { isAddress } from 'ethers';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:watchlists:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 15 * 60 * 1000;
  if (requests >= 200) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const isValidSolanaAddress = (address) => {
  return address && address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
};

const bodySchema = z.object({
  action: z.enum(['add', 'remove'], { message: 'Invalid action' }),
  wallet_address: z.string().refine(
    (val, ctx) => {
      if (ctx.data.action === 'add') {
        return isAddress(val) || isValidSolanaAddress(val);
      }
      return !!val;
    },
    { message: 'Invalid EVM or Solana address for add, or missing address for remove' }
  ),
  name: z.string().trim().max(50, 'Wallet name must be a string with maximum 50 characters').optional(),
}).refine(
  (data) => (data.action === 'add' ? !!data.wallet_address : true),
  { message: 'Wallet address is required for add', path: ['wallet_address'] }
);

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
];

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken}`, { ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' });
    return false;
  }
  return true;
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/watchlists (GET) from IP ${ip}`);

  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) {
    logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const result = await query(
            `SELECT wallet_address, name, created_at FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
            [session.user.id]
          );
          logger.info(`Fetched watchlists for user ${session.user.id}: ${result.rows.length} wallets`, { ip });
          controller.enqueue(JSON.stringify({ success: true, data: result.rows }));
          controller.close();
        } catch (dbError) {
          logger.error(`Database query error: ${dbError.message}`, { stack: dbError.stack, ip });
          controller.enqueue(JSON.stringify({ detail: `Server error: ${dbError.message}` }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
      },
    }
  );
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/watchlists (POST) from IP ${ip}`);

  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) {
    logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'CSRF check không hợp lệ.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400 });
  }

  const { action, wallet_address, name } = parsedBody;
  const isEVMAddress = isAddress(wallet_address);
  const normalizedAddress = isEVMAddress ? wallet_address.toLowerCase() : wallet_address;

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          if (action === 'add') {
            const countResult = await query(`SELECT COUNT(*) FROM watchlists WHERE user_id = $1`, [session.user.id]);
            if (parseInt(countResult.rows[0].count) >= 5) {
              logger.warn(`Watchlist limit reached for user ${session.user.id}`, { ip });
              controller.enqueue(JSON.stringify({ detail: 'Maximum 5 wallets allowed in watchlist' }));
              controller.close();
              return;
            }

            await query(
              `INSERT INTO watchlists (user_id, wallet_address, name) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT unique_user_wallet DO NOTHING`,
              [session.user.id, normalizedAddress, name || 'Unnamed Wallet']
            );

            const result = await query(
              `SELECT wallet_address, name, created_at FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
              [session.user.id]
            );
            logger.info(`Added wallet ${normalizedAddress} for user ${session.user.id} with name ${name || 'Unnamed Wallet'}`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data: result.rows }));
            controller.close();
          } else if (action === 'remove') {
            await query(
              `DELETE FROM watchlists WHERE user_id = $1 AND wallet_address = $2`,
              [session.user.id, normalizedAddress]
            );

            const result = await query(
              `SELECT wallet_address, name, created_at FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
              [session.user.id]
            );
            logger.info(`Removed wallet ${normalizedAddress} for user ${session.user.id}`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data: result.rows }));
            controller.close();
          } else {
            logger.warn(`Invalid action: ${action}`, { ip });
            controller.enqueue(JSON.stringify({ detail: 'Invalid action' }));
            controller.close();
          }
        } catch (dbError) {
          logger.error(`Database error: ${dbError.message}`, { stack: dbError.stack, ip });
          controller.enqueue(JSON.stringify({ detail: `Server error: ${dbError.message}` }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
      },
    }
  );
}