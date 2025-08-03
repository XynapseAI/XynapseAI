import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';

const prisma = new PrismaClient();

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:connect-data:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 15 * 60 * 1000;
  if (requests >= 100) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  logger.info('CSRF Check', {
    receivedToken: csrfToken,
    sessionToken: session?.csrfToken,
  });
  if (process.env.NODE_ENV === 'development') {
    logger.info('Bypassing CSRF check in development mode');
    return true;
  }
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken || 'none'}`, {
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    });
    return false;
  }
  return true;
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/connect-data from IP ${ip}`);

  const origin = request.headers.get('origin');
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:3000/api',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
  ];
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

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
    logger.error('Missing X-Recaptcha-Token header', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400 });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'connect_data', ip);
      logger.info('reCAPTCHA verification successful for connect_data', {
        token: recaptchaToken.substring(0, 8) + '...',
        score,
        ip,
      });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, {
        token: recaptchaToken.substring(0, 8) + '...',
        ip,
      });
      return NextResponse.json({
        detail: `reCAPTCHA verification failed: ${error.message}`,
        errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
      }, { status: 403 });
    }
  } else if (recaptchaToken === 'development-token') {
    logger.info('Bypassing reCAPTCHA in development mode', { ip });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'CSRF check không hợp lệ.' }, { status: 403 });
  }

  try {
    logger.info(`Fetching connect-data for user: ${session.user.id}`, { ip });
    const [creators, aiRank, rankings] = await Promise.all([
      prisma.users.findMany({
        where: { tweet_points: { gt: 0 } },
        orderBy: { tweet_points: 'desc' },
        take: 10,
        select: {
          id: true,
          email: true,
          profile_picture: true,
          google_name: true,
          tweet_points: true,
          tier: true,
        },
      }),
      prisma.users.findMany({
        where: { ai_points: { gt: 0 } },
        orderBy: { ai_points: 'desc' },
        take: 10,
        select: {
          id: true,
          email: true,
          profile_picture: true,
          google_name: true,
          ai_points: true,
          tier: true,
        },
      }),
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
      }),
    ]);

    const data = {
      success: true,
      creators: creators.map((user) => ({ ...user, isCreator: true, points: user.tweet_points })),
      aiRank: aiRank.map((user) => ({ ...user, isAiRank: true, points: user.ai_points })),
      rankings,
    };

    await redisClient.setEx(`connect-data:${session.user.id}`, 300, JSON.stringify(data));
    logger.info('Fetched and cached connect-data successfully', {
      creatorsCount: creators.length,
      aiRankCount: aiRank.length,
      rankingsCount: rankings.length,
      userId: session.user.id,
      ip,
    });

    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
        'Access-Control-Allow-Origin': process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : (origin || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error('Error fetching connect-data', {
      message: error.message,
      stack: error.stack,
      userId: session.user.id,
      ip,
    });
    return NextResponse.json({ detail: `Error fetching leaderboard data: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}