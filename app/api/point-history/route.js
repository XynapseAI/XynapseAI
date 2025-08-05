import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:point_history:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 50) {
    throw new Error('Quá nhiều yêu cầu, vui lòng thử lại sau.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const querySchema = z.object({
  uid: z.string().max(100, 'UID không hợp lệ'),
});

async function verifyCsrfToken(request, session) {
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
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken || 'none'}`, {
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
    'https://*.xynapseai.net',
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
  logger.info(`Yêu cầu tới /api/point-history từ IP ${ip}, query: ${JSON.stringify(Object.fromEntries(request.nextUrl.searchParams))}`, { origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Chưa đăng nhập hoặc thiếu UID', { ip });
    return NextResponse.json({ detail: 'Chưa đăng nhập.' }, { status: 401 });
  }

  if (!(await verifyCsrfToken(request, session))) {
    return NextResponse.json({ detail: 'CSRF check không hợp lệ.' }, { status: 403 });
  }

  let parsedQuery;
  try {
    parsedQuery = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  } catch (err) {
    logger.warn(`Lỗi xác thực: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Xác thực thất bại', errors: err.errors }, { status: 400 });
  }

  const { uid } = parsedQuery;
  if (uid !== session.user.id) {
    logger.warn(`Truy cập bị từ chối: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Truy cập bị từ chối: UID không hợp lệ' }, { status: 403 });
  }

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
    logger.error('Thiếu header X-Recaptcha-Token', { ip });
    return NextResponse.json({ detail: 'Thiếu token reCAPTCHA trong header' }, { status: 400 });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'get_point_history', ip);
      logger.info('Xác minh reCAPTCHA thành công cho get_point_history', { token: recaptchaToken.substring(0, 8) + '...', score, ip });
    } catch (error) {
      logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`, { ip, stack: error.stack });
      return NextResponse.json({ detail: `Xác minh reCAPTCHA thất bại: ${error.message}` }, { status: 403 });
    }
  } else if (recaptchaToken === 'development-token') {
    logger.info('Bỏ qua reCAPTCHA trong chế độ phát triển', { ip });
  }

  try {
    const cacheKey = `point-history:${uid}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for point-history user ${uid}`, { ip });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    const userResult = await Promise.race([
      query(
        `SELECT points, tweet_points, ai_points, task_points 
         FROM users 
         WHERE id = $1`,
        [uid]
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 10000)),
    ]);

    if (userResult.rows.length === 0) {
      logger.error(`Không tìm thấy người dùng: ${uid}`, { ip });
      return NextResponse.json(
        { detail: 'Không tìm thấy người dùng' },
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
            'Access-Control-Allow-Credentials': 'true',
          },
        }
      );
    }
    const user = userResult.rows[0];

    const historyResult = await Promise.race([
      query(
        `SELECT date, interaction_type, count, points
         FROM daily_ai_interactions
         WHERE uid = $1
         ORDER BY date DESC
         LIMIT 10`,
        [uid]
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 10000)),
    ]);

    const history = historyResult.rows.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      interactionType: row.interaction_type,
      tweetPoints: user.tweet_points || 0,
      aiPoints: row.points || 0,
      taskPoints: user.task_points || 0,
      totalPoints: (user.tweet_points || 0) + (row.points || 0) + (user.task_points || 0),
    }));

    const data = { success: true, history };
    await redisClient.setEx(cacheKey, 300, JSON.stringify(data));
    logger.info(`Fetched and cached ${history.length} point history entries for user: ${uid}`, { ip });

    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error(`Error fetching point history: ${error.message}`, { stack: error.stack, ip, uid });
    return NextResponse.json(
      {
        detail:
          error.message.includes('relation "users" does not exist')
            ? 'Lỗi server: Bảng users không tồn tại'
            : error.message.includes('relation "daily_ai_interactions" does not exist')
            ? 'Lỗi server: Bảng daily_ai_interactions không tồn tại'
            : `Lỗi khi lấy lịch sử điểm: ${error.message}`,
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }
}