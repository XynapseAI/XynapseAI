import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { auth } from '@/lib/auth';
import { logger } from '../../../../utils/serverLogger';
import { createClient } from 'redis';


const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:jwt:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 20) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/auth/jwt from IP ${ip}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip });
    return NextResponse.json({ detail: 'Not signed in' }, { status: 401 });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.error('JWT_SECRET not configured');
    return NextResponse.json({ detail: 'Server configuration incomplete' }, { status: 500 });
  }

  try {
    const token = jwt.sign(
      {
        userId: session.user.id,
        twitterHandle: session.user.googleName || '', // Adjust based on actual field
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      jwtSecret
    );

    logger.info(`JWT generated for user: ${session.user.id}`, { ip });
    return NextResponse.json({ token }, {
      headers: { 'Content-Security-Policy': "default-src 'self'" },
    });
  } catch (error) {
    logger.error(`Error generating JWT: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500 });
  }
}