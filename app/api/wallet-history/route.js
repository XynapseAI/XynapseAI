import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { auth } from '@/lib/auth';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:wallet_history:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 10) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const bodySchema = z.object({
  uid: z.string().nonempty('User ID is required'),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Wallet address must be a valid EVM address'),
  action: z.enum(['wallet-balances', 'transactions'], { message: 'Invalid action' }),
  data: z.array(z.any(), { message: 'Data must be an array' }),
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  "https://base.xynapseai.net",
];

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken}`, { ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' });
    return false;
  }
  return true;
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/wallet-history from IP ${ip}`);

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
    logger.error(`Authentication error: No session or UID`, { ip });
    return NextResponse.json({ detail: 'Unauthorized: Please log in.' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'Invalid CSRF token.' }, { status: 403 });
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
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { uid, walletAddress, action, data } = parsedBody;

  if (uid !== session.user.id) {
    logger.warn(`Unauthorized: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Invalid UID' }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const result = await query(
            `INSERT INTO wallet_histories (user_id, wallet_address, action, data, created_at)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [uid, walletAddress, action, data, new Date()]
          );
          const walletHistoryId = result.rows[0].id;
          const walletHistory = {
            id: walletHistoryId,
            userId: uid,
            walletAddress,
            action,
            data,
            createdAt: new Date(),
          };
          logger.info(`Wallet history saved for user ${uid}, address ${walletAddress}, action ${action}`, { ip });
          controller.enqueue(JSON.stringify({ success: true, walletHistory }));
          controller.close();
        } catch (error) {
          logger.error(`Error saving wallet history: ${error.message}`, { stack: error.stack, ip });
          controller.enqueue(JSON.stringify({ detail: `Failed to save wallet history: ${error.message}` }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      },
    }
  );
}