import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';

const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Retry logic
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
  const key = `rate_limit:user:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 15 * 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50;
  if (requests >= maxRequests) {
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
  ].filter((v, i, a) => a.indexOf(v) === i);

  try {
    if (origin) {
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin được phép', { origin, referer });
        return true;
      }
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app')) {
        logger.info('Domain Vercel được phép', { origin, referer });
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin được phép', { origin, referer, refOrigin });
        return true;
      }
      const hostname = new URL(refOrigin).hostname;
      if (hostname.endsWith('.vercel.app')) {
        logger.info('Referer domain Vercel được phép', { origin, referer, refOrigin });
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

const getSchema = z.object({
  uid: z.string().max(100),
});

const postSchema = z.object({
  id: z.string().max(100),
  email: z.string().email(),
  profilePicture: z.string().url().optional(),
  googleId: z.string().max(100).optional(),
  googleName: z.string().max(255).optional(),
  emailVerified: z.boolean().optional(),
});

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.info(`Yêu cầu tới /api/user từ IP ${ip}, query: ${JSON.stringify(params)}`, { origin, referer });

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

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session không được xác thực hoặc thiếu user ID', { ip, session });
    return NextResponse.json({ detail: 'Chưa xác thực' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'Kiểm tra CSRF không hợp lệ.' }, { status: 403 });
  }

  let parsedParams;
  try {
    parsedParams = getSchema.parse(params);
  } catch (err) {
    logger.warn(`Lỗi xác thực dữ liệu: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Dữ liệu đầu vào không hợp lệ', errors: err.errors }, { status: 400 });
  }

  const { uid } = parsedParams;

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
    logger.error('Thiếu header X-Recaptcha-Token', { ip });
    return NextResponse.json({ detail: 'Thiếu token reCAPTCHA trong header' }, { status: 400 });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
      logger.info('Xác thực reCAPTCHA thành công cho get_user', {
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

  if (uid !== session.user.id) {
    logger.warn(`Truy cập bị từ chối: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Truy cập bị từ chối: UID không hợp lệ' }, { status: 403 });
  }

  try {
    const cacheKey = `user:${uid}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit cho user ${uid}`, { ip });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    logger.info(`Bắt đầu lấy dữ liệu user cho UID: ${uid}`, { ip });
    const user = await withRetry(() =>
      prisma.users.findUnique({
        where: { id: uid },
        select: {
          id: true,
          email: true,
          google_id: true,
          profile_picture: true,
          google_name: true,
          email_verified: true,
          points: true,
          tweet_points: true,
          ai_points: true,
          task_points: true,
          is_creator: true,
          is_ai_rank: true,
          tier: true,
          is_premium: true,
          wallet_address: true,
          last_connected: true,
        },
      })
    );

    if (!user) {
      logger.error(`Không tìm thấy user: ${uid}`, { ip });
      return NextResponse.json({ detail: 'Không tìm thấy người dùng' }, { status: 404 });
    }

    const data = {
      success: true,
      user: {
        id: user.id,
        email: user.email || '',
        googleId: user.google_id || null,
        profilePicture: user.profile_picture || '',
        googleName: user.google_name || '',
        emailVerified: user.email_verified || false,
        points: user.points || 0,
        tweetPoints: user.tweet_points || 0,
        aiPoints: user.ai_points || 0,
        taskPoints: user.task_points || 0,
        isCreator: user.is_creator || false,
        isAiRank: user.is_ai_rank || false,
        tier: user.tier || 'Basic',
        isPremium: user.is_premium || false,
        walletAddress: user.wallet_address || null,
        lastConnected: user.last_connected ? new Date(user.last_connected).toISOString() : null,
      },
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(data));
    logger.info(`Lấy và lưu cache user thành công: ${uid}`, { ip });
    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu user: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Lỗi server: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Yêu cầu tới /api/user từ IP ${ip}`, { origin, referer });

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

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session không được xác thực hoặc thiếu user ID', { ip, session });
    return NextResponse.json({ detail: 'Chưa xác thực' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'Kiểm tra CSRF không hợp lệ.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Body JSON không hợp lệ: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Body JSON không hợp lệ' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = postSchema.parse(body);
  } catch (err) {
    logger.warn(`Lỗi xác thực dữ liệu: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Dữ liệu đầu vào không hợp lệ', errors: err.errors }, { status: 400 });
  }

  const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

  if (session.user.id !== id) {
    logger.warn(`Không được phép: id=${id}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Không được phép' }, { status: 401 });
  }

  try {
    const userData = {
      email,
      google_id: googleId || null,
      profile_picture: profilePicture || '',
      google_name: googleName || '',
      email_verified: emailVerified || false,
      connected: true,
      last_connected: new Date(),
      points: 0,
      tweet_points: 0,
      ai_points: 0,
      task_points: 0,
      is_creator: false,
      is_ai_rank: false,
      tier: 'Basic',
      is_plus: false,
      is_premium: false,
    };

    logger.info(`Bắt đầu tạo/cập nhật user: ${id}`, { ip });
    const updatedUser = await withRetry(() =>
      prisma.users.upsert({
        where: { id },
        update: userData,
        create: {
          ...userData,
          id,
          created_at: new Date(),
          api_key: crypto.randomBytes(32).toString('hex'),
        },
      })
    );

    logger.info(`User được tạo/cập nhật: ${id}`, { ip });
    return NextResponse.json({ success: true, user: updatedUser }, {
      headers: {
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu user: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Lỗi server: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}