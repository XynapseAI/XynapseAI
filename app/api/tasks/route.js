import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { auth } from '@/lib/auth';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:tasks:${ip}`;
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
  logger.info(`Request to /api/tasks from IP ${ip}`, { origin, referer });

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
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
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
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
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
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
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
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }

  try {
    const cacheKey = `tasks`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for tasks`, { ip });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    const tasksResult = await Promise.race([
      query(
        `SELECT id, points, is_daily, max_completions, created_at, updated_at
         FROM tasks
         ORDER BY points ASC`
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 10000)),
    ]);

    const tasks = tasksResult.rows.map((row) => ({
      id: row.id,
      points: row.points,
      isDaily: row.is_daily,
      maxCompletions: row.max_completions,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const data = { success: true, tasks };
    await redisClient.setEx(cacheKey, 300, JSON.stringify(data));
    logger.info(`Fetched and cached ${tasks.length} tasks for user: ${session.user.id}`, { ip });

    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error(`Error fetching tasks: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json(
      {
        detail:
          error.message.includes('relation "tasks" does not exist')
            ? 'Server error: Table tasks does not exist'
            : `Error fetching tasks: ${error.message}`,
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }
}