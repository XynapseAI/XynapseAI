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
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken}`);
    return false;
  }
  return true;
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Yêu cầu tới /api/point-history từ IP ${ip}, query: ${JSON.stringify(Object.fromEntries(request.nextUrl.searchParams))}`);

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
  if (!recaptchaToken) {
    logger.error('Thiếu header X-Recaptcha-Token', { ip });
    return NextResponse.json({ detail: 'Thiếu token reCAPTCHA trong header' }, { status: 400 });
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'get_point_history', ip);
    logger.info('Xác minh reCAPTCHA thành công cho get_point_history', { token: recaptchaToken.substring(0, 8) + '...', ip });
  } catch (error) {
    logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`, { ip, stack: error.stack });
    return NextResponse.json({ detail: `Xác minh reCAPTCHA thất bại: ${error.message}` }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const userResult = await query(
            `SELECT points, tweet_points, ai_points, task_points 
             FROM users 
             WHERE id = $1`,
            [uid]
          );
          if (userResult.rows.length === 0) {
            logger.error(`Không tìm thấy người dùng: ${uid}`, { ip });
            controller.enqueue(JSON.stringify({ detail: 'Không tìm thấy người dùng' }));
            controller.close();
            return;
          }
          const user = userResult.rows[0];

          const historyResult = await query(
            `SELECT date, interaction_type, count, points
             FROM daily_ai_interactions
             WHERE uid = $1
             ORDER BY date DESC
             LIMIT 10`,
            [uid]
          );
          const history = historyResult.rows.map((row) => ({
            date: row.date.toISOString().split('T')[0],
            interactionType: row.interaction_type,
            tweetPoints: user.tweet_points || 0,
            aiPoints: row.points || 0,
            taskPoints: user.task_points || 0,
            totalPoints: (user.tweet_points || 0) + (row.points || 0) + (user.task_points || 0),
          }));

          logger.info(`Lấy ${history.length} mục lịch sử điểm cho người dùng: ${uid}`, { ip });
          controller.enqueue(JSON.stringify({ success: true, history }));
          controller.close();
        } catch (error) {
          logger.error(`Lỗi khi lấy lịch sử điểm: ${error.message}`, { stack: error.stack, ip, uid });
          if (error.message.includes('relation "users" does not exist')) {
            controller.enqueue(JSON.stringify({ detail: 'Lỗi server: Bảng users không tồn tại' }));
          } else if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
            controller.enqueue(JSON.stringify({ detail: 'Lỗi server: Bảng daily_ai_interactions không tồn tại' }));
          } else {
            controller.enqueue(JSON.stringify({ detail: `Lỗi khi lấy lịch sử điểm: ${error.message}` }));
          }
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
      },
    }
  );
}