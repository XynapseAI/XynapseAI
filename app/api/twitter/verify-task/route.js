// app\api\twitter\verify-task\route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { PrismaClient } from '@prisma/client';
import { verifyRecaptcha } from '@/utils/verifyRecaptcha';
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
    logger.info('Redis connected');
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  "https://base.xynapseai.net",
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

const schema = z.object({
  taskId: z.string().max(100),
  userId: z.string().max(100),
  recaptchaToken: z.string().max(2048),
});

function sanitizeInput(input, maxLength = 2048) {
  if (typeof input !== 'string') return '';
  return input.substring(0, maxLength);
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  try {
    return cookie.parse(raw);
  } catch {
    return {};
  }
}

function mask(value, keep = 6) {
  if (!value) return '';
  return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
}

async function checkDoubleSubmitCSRF(request, ip, userId) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['csrf_token'] || '';

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
  const storedToken = await client.get(`csrf:${userId || ip}`);
  if (!storedToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token not found in Redis', { key: `csrf:${userId || ip}` });
    }
    return false;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
    crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken));
  if (!valid && process.env.NODE_ENV !== 'production') {
    logger.warn('CSRF token mismatch', {
      headerToken: mask(headerToken),
      cookieToken: mask(cookieToken),
      storedToken: mask(storedToken),
    });
  }
  return valid;
}

async function isAllowedOrigin(origin, referer, pathname) {
  logger.info('Checking origin', { origin, referer, pathname, allowedOrigins });

  try {
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        await trackViolation('unknown', 'Non-HTTPS origin in production');
        return false;
      }
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      await trackViolation('unknown', 'Invalid origin');
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        await trackViolation('unknown', 'Non-HTTPS referer in production');
        return false;
      }
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      await trackViolation('unknown', 'Invalid referer');
      return false;
    }

    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    if (!origin && process.env.NODE_ENV === 'production') {
      logger.error('Null origin blocked in production', { pathname });
      await trackViolation('unknown', 'Null origin in production');
      return false;
    }

    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }

    logger.error('Invalid origin or referer', { origin, referer });
    await trackViolation('unknown', 'Invalid origin or referer');
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, origin, referer, pathname });
    await trackViolation('unknown', 'Error validating origin');
    return false;
  }
}

async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
  logger.info('IP banned', { ip, durationSeconds });
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 50;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid JSON body', 'Invalid input data', 'Access denied: Invalid user ID', 'Missing reCAPTCHA token'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`);
    return;
  }

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:verify_task:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 5 * 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 50 : 10;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
}

async function verifyRecaptchaWithRetry(token, action, ip, retries = 2) {
  token = sanitizeInput(token, 2048);
  for (let i = 0; i < retries; i++) {
    const response = await verifyRecaptcha(token, action, ip);
    if (response.success) {
      return response;
    }
    if (response.needsFallback) {
      return response; // Không retry cho fallback, trả về để frontend xử lý v2
    }
    // Fail khác, retry
    logger.warn(`reCAPTCHA attempt ${i + 1} failed: ${response.error}`, { action, ip });
    if (i === retries - 1) {
      throw new Error(response.error || 'reCAPTCHA verification failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function withRetry(fn, retries = 2, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Operation failed, retrying after ${delay}ms`, { attempt: i + 1, error: err.message });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Function to compute streak
async function computeStreak(userId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setUTCHours(0, 0, 0, 0); // Bắt đầu ngày

  const completions = await prisma.task_completions.findMany({
    where: {
      user_id: userId,
      task_id: 'daily_checkin',
      completed_at: { gte: thirtyDaysAgo },
    },
    orderBy: { completed_at: 'desc' },
  });

  let streak = 0;
  let expectedDate = new Date(); // Today end
  expectedDate.setUTCHours(23, 59, 59, 999);

  for (const comp of completions) {
    const compDate = new Date(comp.completed_at);
    compDate.setUTCHours(23, 59, 59, 999); // End of comp day
    if (compDate.getTime() === expectedDate.getTime()) {
      streak++;
      expectedDate.setDate(expectedDate.getDate() - 1);
      expectedDate.setUTCHours(23, 59, 59, 999);
    } else {
      break;
    }
  }
  return streak;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getLast7Days(userId) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const completions = await prisma.task_completions.findMany({
    where: {
      user_id: userId,
      task_id: 'daily_checkin',
      completed_at: { gte: sevenDaysAgo, lte: today },
    },
  });

  const checked = new Set();
  completions.forEach(comp => {
    const dateStr = new Date(comp.completed_at).toISOString().split('T')[0];
    checked.add(dateStr);
  });

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    last7.push(checked.has(dateStr));
  }
  return last7.reverse(); // Past to today
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info(`Request to /api/twitter/verify-task from IP ${ip}`, { origin, referer });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders });
  }

  const corsHeaders = {
    'Content-Type': 'application/json',
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    ...securityHeaders,
  };

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    logger.error(`Rate limit or IP ban error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429, headers: corsHeaders });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    await trackViolation(ip, 'Session not authenticated');
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers: corsHeaders });
  }

  const csrfOk = await checkDoubleSubmitCSRF(request, ip, session.user.id);
  if (!csrfOk) {
    await trackViolation(ip, 'Invalid CSRF token');
    logger.warn('Invalid CSRF token', { ip });
    return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    await trackViolation(ip, 'Invalid JSON body');
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  let parsedBody;
  try {
    parsedBody = schema.parse(body);
  } catch (err) {
    await trackViolation(ip, 'Invalid input data');
    logger.warn(`Data validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400, headers: corsHeaders });
  }

  const { taskId, userId, recaptchaToken } = parsedBody;
  if (userId !== session.user.id) {
    await trackViolation(ip, 'Access denied: Invalid user ID');
    logger.warn(`Access denied: userId=${userId}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Access denied: Invalid user ID' }, { status: 403, headers: corsHeaders });
  }

  // Enforce reCAPTCHA for critical mutation
  if (process.env.NODE_ENV !== 'development') {
    try {
      logger.info('Attempting reCAPTCHA verification', { token: recaptchaToken.substring(0, 8) + '...', action: 'verify_task', ip });
      const recaptchaResponse = await verifyRecaptchaWithRetry(recaptchaToken, 'verify_task', ip);
if (!recaptchaResponse.success) {
  if (recaptchaResponse.needsFallback) {
    return NextResponse.json({ detail: 'low_score_fallback' }, { status: 403, headers: corsHeaders });
  } else {
    await trackViolation(ip, `reCAPTCHA verification failed: ${recaptchaResponse.error}`);
    return NextResponse.json({ detail: `reCAPTCHA verification failed: ${recaptchaResponse.error}` }, { status: 403, headers: corsHeaders });
  }
}
    } catch (error) {
      await trackViolation(ip, `reCAPTCHA verification failed: ${error.message}`);
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403, headers: corsHeaders });
    }
  }

  try {
    let task;
    if (taskId === 'daily_checkin') {
      task = {
        id: 'daily_checkin',
        description: 'Daily Check-in',
        is_daily: true,
        max_completions: 1,
        task_type: 'daily_checkin',
        target_id: null,
      };
    } else if (taskId === 'follow') {
      task = {
        id: 'follow',
        description: 'Follow @XynapseAI on X (Twitter)',
        is_daily: false,
        max_completions: 1,
        task_type: 'follow',
        target_id: '1927681051373305858',
      };
    } else {
      await trackViolation(ip, `Invalid task ID: ${taskId}`);
      logger.error(`Invalid task ID: ${taskId}`, { ip });
      return NextResponse.json({ detail: 'Invalid task' }, { status: 400, headers: corsHeaders });
    }

    await withRetry(async () => {
      await prisma.tasks.upsert({
        where: { id: task.id },
        update: {},
        create: {
          ...task,
          points: 10, // Default, override for streak
          created_at: new Date(),
        },
      });
      logger.info(`Task ${task.id} ensured in DB`, { ip });
    });

    const twitterHandle = await withRetry(async () => await prisma.twitter_handles.findUnique({ where: { user_id: userId } }));
    if (!twitterHandle && task.task_type !== 'daily_checkin') {
      await trackViolation(ip, 'Twitter account not connected');
      logger.warn(`X (Twitter) account not connected for user ${userId}`, { ip });
      return NextResponse.json({ detail: 'X (Twitter) account not connected' }, { status: 400, headers: corsHeaders });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let whereClause = { user_id: userId, task_id: taskId };
    if (task.is_daily) {
      whereClause.completed_at = { gte: today };
    }
    const existingCompletion = await withRetry(async () =>
      prisma.task_completions.findFirst({
        where: whereClause,
      })
    );

    if (task.is_daily && existingCompletion) {
      logger.info(`Task ${taskId} already completed today for user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Task already completed today' }, { status: 400, headers: corsHeaders });
    }

    if (!task.is_daily && existingCompletion && existingCompletion.completion_count >= task.max_completions) {
      logger.info(`Task ${taskId} max completions reached for user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Maximum completions reached' }, { status: 400, headers: corsHeaders });
    }

    let isTaskValid = false;
    logger.info(`Simulating task verification for ${taskId}...`, { ip });
    await new Promise(resolve => setTimeout(resolve, 3500));

    if (task.task_type === 'follow') {
      isTaskValid = true;
      logger.info(`Simulated follow task verification: userId=${userId}, targetId=${task.target_id}, isFollowing=${isTaskValid}`, { ip });
    } else if (task.task_type === 'daily_checkin') {
      isTaskValid = true;
      logger.info(`Simulated daily check-in task verification: userId=${userId}, isValid=${isTaskValid}`, { ip });
    }

    if (!isTaskValid) {
      await trackViolation(ip, `Task verification failed for task ${taskId}`);
      logger.warn(`Task verification failed for task ${taskId} by user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Task verification failed' }, { status: 400, headers: corsHeaders });
    }

    let points = task.task_type === 'follow' ? 20 : 10; // Default

    if (taskId === 'daily_checkin') {
      // Compute if double points
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const hasYesterday = await prisma.task_completions.findFirst({
        where: {
          user_id: userId,
          task_id: 'daily_checkin',
          completed_at: {
            gte: yesterday,
            lt: today,
          },
        },
      });
      const currentStreak = await computeStreak(userId);
      const newStreak = hasYesterday ? currentStreak + 1 : 1;
      points = newStreak >= 7 ? 20 : 10;
      task.points = points; // Update for response
    }

    await withRetry(async () => {
      await prisma.$transaction(async (tx) => {
        let completionId;
        if (existingCompletion) {
          await tx.task_completions.update({
            where: { id: existingCompletion.id },
            data: {
              completion_count: { increment: 1 },
              points_earned: { increment: points },
              completed_at: new Date(),
            },
          });
          completionId = existingCompletion.id;
        } else {
          const newCompletion = await tx.task_completions.create({
            data: {
              user_id: userId,
              task_id: taskId,
              completion_count: 1,
              points_earned: points,
              completed_at: new Date(),
            },
          });
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          completionId = newCompletion.id;
        }

        const userUpdateData = {
          points: { increment: points },
          task_points: { increment: points },
        };
        if (taskId === 'daily_checkin') {
          userUpdateData.days_active = { increment: 1 };
        }

        await tx.users.update({
          where: { id: userId },
          data: userUpdateData,
        });
      });
    });

    await withRetry(async () => {
      const redisClient = await getRedisClient();
      const cacheKeyProgress = `taskProgress:${userId}`;
      const cacheKeyUser = `user:${userId}`;
      await redisClient.del(cacheKeyProgress);
      await redisClient.del(cacheKeyUser);
    });

    logger.info(`Task ${taskId} verified for user ${userId}, points: ${points}`, { ip });
    return NextResponse.json(
      { success: true, completionCount: existingCompletion ? existingCompletion.completion_count + 1 : 1, pointsEarned: points },
      { headers: corsHeaders }
    );
  } catch (error) {
    const reason = `Error verifying task: ${error.message}`;
    await trackViolation(ip, reason);
    logger.error(`Error verifying task: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Error verifying task: ${error.message}` }, { status: 500, headers: corsHeaders });
  } finally {
    await prisma.$disconnect();
  }
}