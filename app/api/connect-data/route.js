import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';

const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Retry logic cho kết nối cơ sở dữ liệu
async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Kết nối cơ sở dữ liệu thất bại, thử lại sau ${delay}ms`, { attempt: i + 1 });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Lỗi Redis Client:', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:connect-data:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 15 * 60 * 1000;
  if (requests >= 100) {
    throw new Error('Quá nhiều yêu cầu, vui lòng thử lại sau.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  logger.info('Kiểm tra CSRF', {
    receivedToken: csrfToken,
    sessionToken: session?.csrfToken,
  });
  if (process.env.NODE_ENV === 'development') {
    logger.info('Bỏ qua kiểm tra CSRF trong chế độ phát triển');
    return true;
  }
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`Kiểm tra CSRF thất bại: Token CSRF không hợp lệ: ${csrfToken || 'none'}`, {
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    });
    return false;
  }
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
    'https://*.xynapseai.net', // Thêm wildcard cho subdomain
  ].filter((v, i, a) => a.indexOf(v) === i);

  logger.info('Checking origin', { origin, referer, allowedOrigins });
  try {
    if (origin) {
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin được phép', { origin });
        return true;
      }
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app') || hostname.endsWith('xynapseai.net')) {
        logger.info('Domain động được phép', { origin, hostname });
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin được phép', { referer, refOrigin });
        return true;
      }
      const hostname = new URL(refOrigin).hostname;
      if (hostname.endsWith('.vercel.app') || hostname.endsWith('xynapseai.net')) {
        logger.info('Referer domain động được phép', { referer, hostname });
        return true;
      }
    }
    if (!origin && !referer) {
      logger.info('Cho phép yêu cầu nội bộ/SSR');
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin là null, cho phép trong chế độ phát triển');
      return true;
    }
    logger.error('Bị chặn bởi CORS', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Lỗi trong isAllowedOrigin', { error: error.message, origin, referer });
    return false;
  }
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Yêu cầu tới /api/connect-data từ IP ${ip}`, { origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`Lỗi CORS: Origin ${origin || 'null'} không được phép`, { allowedOrigins });
    return NextResponse.json({ detail: 'Không được phép bởi CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
    logger.error('Thiếu header X-Recaptcha-Token', { ip });
    return NextResponse.json({ detail: 'Thiếu token reCAPTCHA trong header' }, { status: 400 });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'connect_data', ip);
      logger.info('Xác thực reCAPTCHA thành công cho connect_data', {
        token: recaptchaToken.substring(0, 8) + '...',
        score,
        ip,
      });
    } catch (error) {
      logger.error(`Xác thực reCAPTCHA thất bại: ${error.message}`, {
        token: recaptchaToken.substring(0, 8) + '...',
        ip,
      });
      return NextResponse.json({
        detail: `Xác thực reCAPTCHA thất bại: ${error.message}`,
        errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
      }, { status: 403 });
    }
  } else if (recaptchaToken === 'development-token') {
    logger.info('Bỏ qua reCAPTCHA trong chế độ phát triển', { ip });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session không được xác thực hoặc thiếu user ID', { ip, session });
    return NextResponse.json({ detail: 'Chưa xác thực' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'Kiểm tra CSRF không hợp lệ.' }, { status: 403 });
  }

  try {
    logger.info(`Bắt đầu lấy dữ liệu connect-data cho user: ${session.user.id}`, { ip });
    const cacheKey = `connect-data:${session.user.id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit cho connect-data user ${session.user.id}`, { ip });
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

    const [creators, aiRank, rankings] = await withRetry(() =>
      Promise.all([
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
      ])
    );

    const data = {
      success: true,
      creators: creators.map((user) => ({ ...user, isCreator: true, points: user.tweet_points })),
      aiRank: aiRank.map((user) => ({ ...user, isAiRank: true, points: user.ai_points })),
      rankings,
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(data));
    logger.info('Lấy và lưu cache connect-data thành công', {
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
        'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error('Lỗi khi lấy connect-data', {
      message: error.message,
      stack: error.stack,
      userId: session.user.id,
      ip,
    });
    return NextResponse.json({ detail: `Lỗi khi lấy dữ liệu leaderboard: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}