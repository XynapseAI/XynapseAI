import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
if (!redisClient.isOpen) await redisClient.connect();

const schema = z.object({
  uid: z.string().max(100),
});

// Hàm chuyển đổi BigInt thành chuỗi
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

function isAllowedOrigin(origin, referer) {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ];
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

async function checkRateLimit(ip) {
  const key = `rate_limit:point_history:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 15 * 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (process.env.NODE_ENV === 'development') return true;
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) return false;
  return true;
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const { searchParams } = new URL(request.url);
  const params = Object.fromEntries(searchParams);

  logger.info(`Request to /api/point-history from IP ${ip}`, { params, origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403 });
  }

  let parsedParams;
  try {
    parsedParams = schema.parse(params);
  } catch (err) {
    logger.warn(`Data validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400 });
  }

  const { uid } = parsedParams;
  if (uid !== session.user.id) {
    logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Access denied: Invalid UID' }, { status: 403 });
  }

  try {
    const cacheKey = `pointHistory:${uid}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for point history user ${uid}`, { ip });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    const user = await prisma.users.findUnique({
      where: { id: uid },
      select: { points: true, task_points: true },
    });

    if (!user) {
      logger.error(`User not found: ${uid}`, { ip });
      return NextResponse.json({ detail: 'User not found' }, { status: 404 });
    }

    const completions = await prisma.task_completions.findMany({
      where: { user_id: uid },
      orderBy: { completed_at: 'asc' },
      select: { task_id: true, points_earned: true, completed_at: true },
    });

    const history = completions.reduce((acc, completion) => {
      const date = new Date(completion.completed_at).toLocaleDateString();
      const lastEntry = acc[acc.length - 1];
      if (lastEntry && lastEntry.date === date) {
        lastEntry.taskPoints += completion.points_earned;
      } else {
        acc.push({ date, taskPoints: completion.points_earned });
      }
      return acc;
    }, []);

    const todayTaskPoints = Number(user.task_points || 0); // Convert BigInt to Number
    const yesterdayTaskPoints = history.length > 1 ? history[history.length - 2]?.taskPoints || 0 : 0;
    const taskGrowthValue = ((todayTaskPoints - yesterdayTaskPoints) / (yesterdayTaskPoints || 1)) * 100;
    const taskGrowth = {
      value: taskGrowthValue.toFixed(2),
      color: taskGrowthValue > 0 ? 'neon-green' : taskGrowthValue < 0 ? 'red-400' : 'gray-400',
    };

    const data = {
      success: true,
      history,
      taskPoints: todayTaskPoints,
      taskGrowth,
    };

    await redisClient.setEx(cacheKey, 600, JSON.stringify(serializeBigInt(data)));
    logger.info('Fetched and cached point history successfully', { userId: uid, ip });
    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error('Error fetching point history', { message: error.message, stack: error.stack, ip });
    return NextResponse.json({ detail: `Error fetching point history: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}