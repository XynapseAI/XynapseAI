import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { getRedisClient } from '../../../lib/redis';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { RateLimiterRedis } from 'rate-limiter-flexible';

// Hàm chuyển đổi BigInt thành chuỗi
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: { db: { url: process.env.DATABASE_URL } },
});

async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Database connection failed, retrying after ${delay}ms`, { attempt: i + 1 });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const rateLimiter = new RateLimiterRedis({
  storeClient: await getRedisClient(),
  keyPrefix: 'rate_limit:connect-data',
  points: 500, // Increased to 200 requests
  duration: 15 * 60, // 15 minutes
});

async function checkRateLimit(ip) {
  try {
    await rateLimiter.consume(ip);
  } catch (err) {
    // Calculate remaining time until rate limit resets
    const msBeforeReset = err.msBeforeNext || 15 * 60 * 1000; // Fallback to duration
    return NextResponse.json(
      { detail: 'Too many requests, please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': Math.ceil(msBeforeReset / 1000).toString(), // Seconds until reset
        },
      }
    );
  }
}

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (process.env.NODE_ENV === 'development') return true;
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) return false;
  return true;
}

function isAllowedOrigin(origin, referer) {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:3000/api',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
    'https://*.xynapseai.net',
  ].filter((v, i, a) => a.indexOf(v) === i);

  try {
    if (origin && (allowedOrigins.includes(origin) || new URL(origin).hostname.match(/(\.vercel\.app|xynapseai\.net)$/))) return true;
    if (!origin && referer && allowedOrigins.includes(new URL(referer).origin)) return true;
    if (!origin && !referer) return true;
    if (!origin && process.env.NODE_ENV === 'development') return true;
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, origin, referer });
    return false;
  }
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Request to /api/connect-data from IP ${ip}`, { origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  const rateLimitResponse = await checkRateLimit(ip);
  if (rateLimitResponse) return rateLimitResponse;

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
    logger.error('Missing X-Recaptcha-Token header', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400 });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'connect_data', ip);
      logger.info('reCAPTCHA verification successful for connect_data', { token: recaptchaToken.substring(0, 8) + '...', score, ip });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { token: recaptchaToken.substring(0, 8) + '...', ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403 });
    }
  } else if (recaptchaToken === 'development-token') {
    logger.info('Skipping reCAPTCHA in development mode', { ip });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403 });
  }

  const redisClient = await getRedisClient();
  try {
    const cacheKey = `connect-data:${session.user.id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for connect-data user ${session.user.id}`, { ip });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
          'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    const rankings = await withRetry(() =>
      prisma.users.findMany({
        where: { points: { gt: 0 } },
        orderBy: { points: 'desc' },
        take: 100,
        select: {
          id: true,
          email: true,
          profile_picture: true,
          google_name: true,
          points: true,
          tier: true,
        },
      })
    );

    const serializedRankings = serializeBigInt(rankings);
    const data = { success: true, rankings: serializedRankings };

    await redisClient.multi()
      .setEx(cacheKey, 300, JSON.stringify(data))
      .exec();
    logger.info('Fetched and cached connect-data successfully', { rankingsCount: rankings.length, userId: session.user.id, ip });

    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
        'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error('Error fetching connect-data', { message: error.message, stack: error.stack, userId: session.user.id, ip });
    return NextResponse.json({ detail: `Error fetching leaderboard data: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}