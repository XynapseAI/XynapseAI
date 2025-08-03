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

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  null, // Chỉ thêm trong môi trường phát triển
].filter(Boolean);

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken}`);
    return false;
  }
  return true;
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/tasks from IP ${ip}`);

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
    logger.warn('Chưa đăng nhập hoặc thiếu UID', { ip });
    return NextResponse.json({ detail: 'Chưa đăng nhập.' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'CSRF check không hợp lệ.' }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const tasksResult = await query(
            `SELECT id, points, is_daily, max_completions, created_at, updated_at
             FROM tasks
             ORDER BY points ASC`
          );
          const tasks = tasksResult.rows.map(row => ({
            id: row.id,
            points: row.points,
            isDaily: row.is_daily,
            maxCompletions: row.max_completions,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));

          logger.info(`Fetched ${tasks.length} tasks for user: ${session.user.id}`, { ip });
          controller.enqueue(JSON.stringify({ success: true, tasks }));
          controller.close();
        } catch (error) {
          logger.error(`Error fetching tasks: ${error.message}`, { stack: error.stack, ip });
          if (error.message.includes('relation "tasks" does not exist')) {
            controller.enqueue(JSON.stringify({ detail: 'Server error: Table tasks does not exist' }));
          } else {
            controller.enqueue(JSON.stringify({ detail: `Error fetching tasks: ${error.message}` }));
          }
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      },
    }
  );
}