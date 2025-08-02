import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { auth } from '../auth/[...nextauth]/route';
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

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
];

const querySchema = z.object({
  uid: z.string().max(100, 'UID không hợp lệ'),
});

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
  logger.info(`Request to /api/task-progress from IP ${ip}, query: ${JSON.stringify(Object.fromEntries(request.nextUrl.searchParams))}`);

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

  let parsedQuery;
  try {
    parsedQuery = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { uid } = parsedQuery;
  if (uid !== session.user.id) {
    logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Access denied: Invalid user ID' }, { status: 403 });
  }

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken) {
    logger.error('Missing X-Recaptcha-Token header', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400 });
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'task_progress', ip);
    logger.info('reCAPTCHA verified for task_progress', { ip, token: recaptchaToken.substring(0, 8) + '...' });
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
    return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);
          logger.info(`Querying task progress for user: ${uid}, date: ${today.toISOString()}`, { ip });

          const result = await query(
            `SELECT task_id, completion_count, completed_at
             FROM task_completions
             WHERE user_id = $1 AND completed_at >= $2`,
            [uid, today]
          );

          const progress = result.rows.map((row) => ({
            taskId: row.task_id,
            completionCount: row.completion_count,
            completedAt: row.completed_at,
          }));

          logger.info(`Fetched ${progress.length} task progress entries for user: ${uid}`, { ip });
          controller.enqueue(JSON.stringify({ success: true, progress }));
          controller.close();
        } catch (error) {
          logger.error(`Error fetching task progress: ${error.message}`, { stack: error.stack, ip, uid });
          if (error.message.includes('relation "task_completions" does not exist')) {
            controller.enqueue(JSON.stringify({ detail: 'System error: Table task_completions does not exist' }));
          } else {
            controller.enqueue(JSON.stringify({ detail: `Failed to fetch task progress: ${error.message}` }));
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
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
      },
    }
  );
}