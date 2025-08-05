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
  const key = `rate_limit:task_progress:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 10) {
    throw new Error('Quá nhiều yêu cầu, vui lòng thử lại sau.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
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

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Request to /api/task-progress from IP ${ip}`, { origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
    return NextResponse.json(
      { detail: 'Not allowed by CORS' },
      {
        status: 403,
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

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json(
      { detail: err.message },
      {
        status: 429,
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

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Chưa đăng nhập hoặc thiếu UID', { ip });
    return NextResponse.json(
      { detail: 'Chưa đăng nhập.' },
      {
        status: 401,
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

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json(
      { detail: 'CSRF check không hợp lệ.' },
      {
        status: 403,
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

  let parsedQuery;
  try {
    const querySchema = z.object({
      uid: z.string().max(100, 'UID không hợp lệ'),
    });
    parsedQuery = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json(
      { detail: 'Validation failed', errors: err.errors },
      {
        status: 400,
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

  const { uid } = parsedQuery;
  if (uid !== session.user.id) {
    logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json(
      { detail: 'Access denied: Invalid user ID' },
      {
        status: 403,
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

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
    logger.error('Missing X-Recaptcha-Token header', { ip });
    return NextResponse.json(
      { detail: 'Missing reCAPTCHA token in header' },
      {
        status: 400,
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

  if (process.env.NODE_ENV !== 'development') {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'task_progress', ip);
      logger.info('reCAPTCHA verified for task_progress', { ip, token: recaptchaToken.substring(0, 8) + '...' + score});
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
      return NextResponse.json(
        { detail: `reCAPTCHA verification failed: ${error.message}` },
        {
          status: 403,
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
  } else if (recaptchaToken === 'development-token') {
    logger.info('Skipping reCAPTCHA in development mode', { ip });
  }

  try {
    const cacheKey = `task-progress:${uid}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for task-progress user ${uid}`, { ip });
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

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    logger.info(`Querying task progress for user: ${uid}, date: ${today.toISOString()}`, { ip });

    const result = await Promise.race([
      query(
        `SELECT task_id, completion_count, completed_at
         FROM task_completions
         WHERE user_id = $1 AND completed_at >= $2`,
        [uid, today]
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 10000)),
    ]);

    const progress = result.rows.map((row) => ({
      taskId: row.task_id,
      completionCount: row.completion_count,
      completedAt: row.completed_at,
    }));

    const data = { success: true, progress };
    await redisClient.setEx(cacheKey, 300, JSON.stringify(data));
    logger.info(`Fetched and cached ${progress.length} task progress entries for user: ${uid}`, { ip });

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
    logger.error(`Error fetching task progress: ${error.message}`, { stack: error.stack, ip, uid });
    return NextResponse.json(
      {
        detail:
          error.message.includes('relation "task_completions" does not exist')
            ? 'System error: Table task_completions does not exist'
            : `Failed to fetch task progress: ${error.message}`,
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