// app\api\tasks\route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
if (!redisClient.isOpen) await redisClient.connect();

function isAllowedOrigin(origin, referer) {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://farcaster.xynapseai.net',
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
  const key = `rate_limit:tasks:${ip}`;
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
  logger.info(`Request to /api/tasks from IP ${ip}`, { origin, referer });

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

  try {
    const cacheKey = `tasks:${session.user.id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for tasks user ${session.user.id}`, { ip });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    // Hardcoded 2 simple tasks for production stability
    const tasks = [
      {
        id: 'daily_checkin',
        description: 'Daily Check-in',
        points: 10,
        is_daily: true,
        max_completions: 1,
        task_type: 'daily_checkin',
        target_id: null,
      },
      {
        id: 'follow',
        description: 'Follow @XynapseAI on Twitter',
        points: 20,
        is_daily: false,
        max_completions: 1,
        task_type: 'follow',
        target_id: '1927681051373305858',
      },
    ];

    const data = { success: true, tasks };
    await redisClient.setEx(cacheKey, 600, JSON.stringify(data));
    logger.info('Fetched and cached tasks successfully', { userId: session.user.id, ip });
    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error('Error fetching tasks', { message: error.message, stack: error.stack, ip });
    return NextResponse.json({ detail: `Error fetching tasks: ${error.message}` }, { status: 500 });
  }
}