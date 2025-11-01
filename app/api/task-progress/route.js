// app/api/task-progress/route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import cookie from 'cookie';
import crypto from 'crypto';

const prisma = new PrismaClient();
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
    await redisClient.connect();
  }
  return redisClient;
}

const schema = z.object({
  uid: z.string().max(100),
});

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
  const redisClient = await getRedisClient();
  const key = `rate_limit:task_progress:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
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

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  try {
    return cookie.parse(raw);
  } catch {
    return {};
  }
}

async function checkDoubleSubmitCSRF(request, ip, userId) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['next-auth.csrf-token'] || '';
  if (process.env.NODE_ENV !== 'production') {
    logger.info('Checking CSRF tokens', {
      headerToken: headerToken ? 'provided' : 'missing',
      cookieToken: cookieToken ? 'provided' : 'missing',
    });
  }
  if (process.env.NODE_ENV === 'development' && headerToken === 'dev-csrf' && cookieToken === 'dev-csrf') {
    if (process.env.NODE_ENV !== 'production') {
      logger.info('Development CSRF bypass used');
    }
    return true;
  }
  if (!headerToken || !cookieToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF tokens missing', {
        headerProvided: !!headerToken,
        cookieProvided: !!cookieToken,
      });
    }
    return false;
  }
  const client = await getRedisClient();
  const storedToken = await client.get(`csrf:${userId}`);
  if (!storedToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token not found in Redis', { key: `csrf:${userId}` });
    }
    return false;
  }
  // FIX: Check lengths trước để tránh throw RangeError
  if (headerToken.length !== cookieToken.length || cookieToken.length !== storedToken.length) {
    logger.warn('CSRF token length mismatch', {
      headerLength: headerToken.length,
      cookieLength: cookieToken.length,
      storedLength: storedToken.length,
    });
    return false; // Invalid, không throw
  }
  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
                crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken));
  if (!valid && process.env.NODE_ENV !== 'production') {
    logger.warn('CSRF token mismatch', {
      headerToken: headerToken.slice(0, 6) + '••••',
      cookieToken: cookieToken.slice(0, 6) + '••••',
      storedToken: storedToken.slice(0, 6) + '••••',
    });
  }
  return valid;
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const { searchParams } = new URL(request.url);
  const params = Object.fromEntries(searchParams);
  logger.info(`Request to /api/task-progress from IP ${ip}`, { params, origin, referer });
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
  let newCsrfToken;
  if (!(await checkDoubleSubmitCSRF(request, ip, session.user.id))) {
    newCsrfToken = crypto.randomBytes(32).toString('hex');
    const client = await getRedisClient();
    await client.setEx(`csrf:${session.user.id}`, 15 * 60, newCsrfToken);
    logger.warn('Invalid CSRF token, new token issued', { ip });
    return NextResponse.json({ detail: 'Invalid CSRF check. Please refresh.' }, {
      status: 403,
      headers: {
        'Set-Cookie': cookie.serialize('next-auth.csrf-token', newCsrfToken, {
          httpOnly: false,  // FIX: false để client đọc được
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'none',  // Cho cross-origin (Base App)
          domain: process.env.COOKIE_DOMAIN || '.xynapseai.net',  // FIX: Thêm domain cho subdomain
          maxAge: 15 * 60,
          path: '/',
        }),
      }
    });
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
    const cacheKey = `taskProgress:${uid}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for task progress user ${uid}`, { ip });
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
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const completions = await prisma.task_completions.findMany({
      where: { user_id: uid, completed_at: { gte: today } },
      select: { task_id: true, completion_count: true, completed_at: true },
    });
    const progress = completions.reduce((acc, completion) => {
      acc[completion.task_id] = {
        completionCount: completion.completion_count,
        completedAt: completion.completed_at.toISOString(),
      };
      return acc;
    }, {});
    const data = { success: true, progress };
    await redisClient.setEx(cacheKey, 600, JSON.stringify(data));
    logger.info('Fetched and cached task progress successfully', { userId: uid, ip });
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
    logger.error('Error fetching task progress', { message: error.message, stack: error.stack, ip });
    return NextResponse.json({ detail: `Error fetching task progress: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}