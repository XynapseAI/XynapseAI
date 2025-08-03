import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';;
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { ethers } from 'ethers';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import jwt from 'jsonwebtoken';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:verify_wallet:${ip}`;
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

const bodySchema = z.object({
  action: z.enum(['verify-wallet', 'disconnect-wallet'], { message: 'Invalid action' }),
  uid: z.string().max(100, 'Invalid UID'),
  recaptchaToken: z.string({ message: 'Invalid reCAPTCHA token' }),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address').optional(),
  signature: z.string().optional(),
  message: z.string().optional(),
}).refine(
  (data) => (data.action === 'verify-wallet' ? !!data.walletAddress && !!data.signature && !!data.message : true),
  { message: 'Missing wallet address, signature, or message for verify-wallet', path: ['walletAddress', 'signature', 'message'] }
);

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken}`, { ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' });
    return false;
  }
  return true;
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
];

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/verify-wallet from IP ${ip}`);

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
    return NextResponse.json({ detail: 'Not signed in' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'CSRF check không hợp lệ.' }, { status: 403 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid Authorization header', { ip });
    return NextResponse.json({ detail: 'Missing or invalid JWT' }, { status: 401 });
  }

  const token = authHeader.split(' ')[1];
  try {
    if (!process.env.JWT_SECRET) {
      logger.error('JWT_SECRET is not configured');
      return NextResponse.json({ detail: 'Server configuration error: Missing JWT_SECRET' }, { status: 500 });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.userId !== session.user.id) {
      logger.warn(`JWT userId mismatch: jwtUserId=${decoded.userId}, sessionUserId=${session.user.id}`, { ip });
      return NextResponse.json({ detail: 'Invalid JWT' }, { status: 401 });
    }
    logger.info('JWT verified successfully', { userId: decoded.userId, ip });
  } catch (error) {
    logger.error(`JWT verification failed: ${error.message}`, { token: token.substring(0, 8) + '...', ip });
    return NextResponse.json({ detail: `Invalid JWT: ${error.message}` }, { status: 401 });
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

  const { action, uid, recaptchaToken, walletAddress, signature, message } = parsedBody;

  try {
    await verifyRecaptcha(recaptchaToken, action, ip);
    logger.info(`reCAPTCHA verified successfully for ${action}`, { ip });
  } catch (error) {
    logger.error(`reCAPTCHA verification error: ${error.message}`, { ip });
    return NextResponse.json({ detail: `reCAPTCHA verification error: ${error.message}` }, { status: 403 });
  }

  if (uid !== session.user.id) {
    logger.warn(`Unauthorized: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Invalid UID' }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          if (action === 'verify-wallet') {
            const normalizedAddress = walletAddress.toLowerCase();
            const recoveredAddress = ethers.verifyMessage(message, signature);
            if (recoveredAddress.toLowerCase() !== normalizedAddress) {
              logger.warn('Invalid wallet signature', { recoveredAddress, walletAddress, ip });
              controller.enqueue(JSON.stringify({ detail: 'Invalid signature' }));
              controller.close();
              return;
            }

            await query(
              `UPDATE users
               SET wallet_address = $1, last_connected = $2
               WHERE id = $3`,
              [normalizedAddress, new Date(), session.user.id]
            );

            await query(
              `INSERT INTO wallet_histories (user_id, wallet_address, action, data, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [session.user.id, normalizedAddress, 'connect', { signature, message }, new Date()]
            );

            const userResult = await query(
              `SELECT id, twitter_handle, twitter_access_token, discord_access_token, wallet_address, task_points, points, last_connected
               FROM users
               WHERE id = $1`,
              [session.user.id]
            );
            const user = userResult.rows[0];
            logger.info(`Wallet verified for user: ${uid}`, { walletAddress: normalizedAddress, ip });
            controller.enqueue(JSON.stringify({ success: true, user }));
            controller.close();
          } else if (action === 'disconnect-wallet') {
            const userResult = await query(
              `SELECT wallet_address
               FROM users
               WHERE id = $1`,
              [session.user.id]
            );
            const user = userResult.rows[0];

            await query(
              `UPDATE users
               SET wallet_address = NULL, last_connected = $1
               WHERE id = $2`,
              [new Date(), session.user.id]
            );

            await query(
              `INSERT INTO wallet_histories (user_id, wallet_address, action, data, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [session.user.id, user.wallet_address || 'unknown', 'disconnect', {}, new Date()]
            );

            const updatedUserResult = await query(
              `SELECT id, twitter_handle, twitter_access_token, discord_access_token, wallet_address, task_points, points, last_connected
               FROM users
               WHERE id = $1`,
              [session.user.id]
            );
            const updatedUser = updatedUserResult.rows[0];
            logger.info(`Wallet disconnected for user: ${uid}`, { ip });
            controller.enqueue(JSON.stringify({ success: true, user: updatedUser }));
            controller.close();
          } else {
            logger.warn(`Invalid action: ${action}`, { ip });
            controller.enqueue(JSON.stringify({ detail: 'Invalid action' }));
            controller.close();
          }
        } catch (error) {
          logger.error(`Error processing request: ${error.message}`, { stack: error.stack, ip });
          controller.enqueue(JSON.stringify({ detail: `Server error: ${error.message}` }));
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Recaptcha-Token',
      },
    }
  );
}