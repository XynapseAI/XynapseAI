// app/api/csrf-token/route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { randomBytes } from 'crypto';

// Khởi tạo Redis client một lần và duy trì kết nối
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));

// Kết nối Redis khi server khởi động
if (!redisClient.isOpen) {
  await redisClient.connect();
}

async function checkRateLimit(ip) {
  const key = `rate_limit:csrf:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50; // Tăng giới hạn trong môi trường dev
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:3000/api',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-g7n959r6s-xynapse-projects.vercel.app',
];

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/csrf-token from IP ${ip}`);

  const origin = request.headers.get('origin');
  if (!origin && process.env.NODE_ENV === 'development') {
    logger.warn(`Origin is null, allowing in development mode`, { ip });
  } else if (!origin || !allowedOrigins.includes(origin)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip, session });
    return NextResponse.json({ detail: 'Not signed in' }, { status: 401 });
  }

  try {
    // Sử dụng CSRF token từ session nếu có, hoặc tạo mới
    const csrfToken = session.csrfToken || randomBytes(32).toString('hex');
    logger.info('CSRF token retrieved/generated', { ip, csrfToken: csrfToken.substring(0, 8) + '...' });
    
    // Lưu CSRF token vào session (nếu cần)
    if (!session.csrfToken) {
      session.csrfToken = csrfToken;
      logger.info('CSRF token saved to session', { ip, userId: session.user.id });
    }

    return NextResponse.json({ success: true, csrfToken }, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : (origin || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error(`Error processing /api/csrf-token: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500 });
  }
}

// Đóng kết nối Redis khi cần (không sử dụng config)
process.on('SIGTERM', async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGTERM');
  }
});
process.on('SIGINT', async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGINT');
  }
});