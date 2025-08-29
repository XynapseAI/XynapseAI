import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { TwitterApi } from 'twitter-api-v2';
import { PrismaClient } from '@prisma/client';
import { verifyRecaptcha } from '@/utils/verifyRecaptcha';
import { z } from 'zod';

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

const twitterClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET,
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
  ...(process.env.VERCEL_ENV === 'production' ? [] : ['https://*.vercel.app']),
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/.*\.vercel\.app$/;

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info('No Origin or Referer (likely SSR or server-to-server), allowing request');
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info('No valid Origin or Referer, allowing for SSR compatibility');
    return true;
  }
  const isAllowed = allowedOrigins.some((allowed) =>
    allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(checkOrigin) : allowed === checkOrigin
  ) || vercelPreviewRegex.test(checkOrigin);
  logger.info(`Origin check: ${checkOrigin}, Allowed: ${isAllowed}`);
  return isAllowed;
}

async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
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
  const maxViolations = 100;
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

async function verifyRecaptchaWithRetry(token, action, ip, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const { score } = await verifyRecaptcha(token, action, ip);
      logger.info('reCAPTCHA verification successful', { score, action, ip });
      return { score };
    } catch (error) {
      logger.warn(`reCAPTCHA verification attempt ${i + 1} failed: ${error.message}`, { action, ip });
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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

async function refreshTwitterToken(twitterHandle) {
  if (twitterHandle.token_expires_at > new Date()) return twitterHandle.access_token;
  const { accessToken, refreshToken, expiresIn } = await twitterClient.refreshOAuth2Token(twitterHandle.refresh_token);
  await withRetry(async () => {
    await prisma.twitter_handles.update({
      where: { user_id: twitterHandle.user_id },
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000),
        updated_at: new Date(),
      },
    });
  });
  return accessToken;
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Request to /api/twitter/verify-task from IP ${ip}`, { origin, referer });

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
    'Access-Control-Allow-Credentials': 'true',
    ...securityHeaders,
  };

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: corsHeaders });
  }

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

  if (!(await checkCSRF(request, session))) {
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

  if (process.env.NODE_ENV !== 'development') {
    try {
      logger.info('Attempting reCAPTCHA verification', { token: recaptchaToken.substring(0, 8) + '...', action: 'verify_task', ip });
      await verifyRecaptchaWithRetry(recaptchaToken, 'verify_task', ip);
    } catch (error) {
      await trackViolation(ip, `reCAPTCHA verification failed: ${error.message}`);
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403, headers: corsHeaders });
    }
  }

  try {
    const task = await withRetry(async () => await prisma.tasks.findUnique({ where: { id: taskId } }));
    if (!task) {
      await trackViolation(ip, `Task not found: ${taskId}`);
      logger.error(`Task not found: ${taskId}`, { ip });
      return NextResponse.json({ detail: 'Task not found' }, { status: 404, headers: corsHeaders });
    }

    const twitterHandle = await withRetry(async () => await prisma.twitter_handles.findUnique({ where: { user_id: userId } }));
    if (!twitterHandle && task.task_type !== 'daily_checkin') {
      await trackViolation(ip, 'Twitter account not connected');
      logger.warn(`Twitter account not connected for user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Twitter account not connected' }, { status: 400, headers: corsHeaders });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const existingCompletion = await withRetry(async () =>
      prisma.task_completions.findFirst({
        where: {
          user_id: userId,
          task_id: taskId,
          completed_at: { gte: today },
        },
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
    if (task.task_type === 'follow') {
      const accessToken = await refreshTwitterToken(twitterHandle);
      const client = new TwitterApi(accessToken);
      const user = await client.v2.userByUsername(twitterHandle.twitter_handle, { 'user.fields': ['id'] });
      if (!user.data?.id) {
        await trackViolation(ip, `Failed to fetch user ID for ${twitterHandle.twitter_handle}`);
        logger.error(`Failed to fetch user ID for ${twitterHandle.twitter_handle}`, { ip });
        return NextResponse.json({ detail: 'Failed to fetch user ID' }, { status: 400, headers: corsHeaders });
      }
      const userId = user.data.id;
      const following = await client.v2.following(userId, { 'user.fields': ['id'] });
      const followingIds = [];
      for await (const followedUser of following) {
        followingIds.push(followedUser.id);
      }
      isTaskValid = followingIds.includes(task.target_id);
      logger.info(`Follow task verification: userId=${userId}, targetId=${task.target_id}, isFollowing=${isTaskValid}`, { ip });
    } else if (task.task_type === 'retweet') {
      const accessToken = await refreshTwitterToken(twitterHandle);
      const client = new TwitterApi(accessToken);
      const retweets = await client.v2.tweetRetweetedBy(task.target_id, { 'user.fields': ['username'] });
      isTaskValid = retweets.data.some((user) => user.username === twitterHandle.twitter_handle);
      logger.info(`Retweet task verification: tweetId=${task.target_id}, username=${twitterHandle.twitter_handle}, isRetweeted=${isTaskValid}`, { ip });
    } else if (task.task_type === 'daily_checkin') {
      isTaskValid = true;
      logger.info(`Daily check-in task verification: userId=${userId}, isValid=${isTaskValid}`, { ip });
    }

    if (!isTaskValid) {
      await trackViolation(ip, `Task verification failed for task ${taskId}`);
      logger.warn(`Task verification failed for task ${taskId} by user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Task verification failed' }, { status: 400, headers: corsHeaders });
    }

    const completionCount = existingCompletion ? existingCompletion.completion_count + 1 : 1;
    await withRetry(async () => {
      await prisma.$transaction([
        prisma.task_completions.upsert({
          where: { user_id_task_id: { user_id: userId, task_id: taskId } },
          update: { completion_count: completionCount, points_earned: task.points, completed_at: new Date() },
          create: {
            user_id: userId,
            task_id: taskId,
            completion_count: 1,
            points_earned: task.points,
            completed_at: new Date(),
          },
        }),
        prisma.users.update({
          where: { id: userId },
          data: { points: { increment: task.points }, task_points: { increment: task.points } },
        }),
      ]);
    });

    await withRetry(async () => {
      const redisClient = await getRedisClient();
      const cacheKeyProgress = `taskProgress:${userId}`;
      const cacheKeyUser = `user:${userId}`;
      await redisClient.del(cacheKeyProgress);
      await redisClient.del(cacheKeyUser);
    });

    logger.info(`Task ${taskId} verified for user ${userId}, points: ${task.points}`, { ip });
    return NextResponse.json(
      { success: true, completionCount, pointsEarned: task.points },
      { headers: corsHeaders }
    );
  } catch (error) {
    await trackViolation(ip, `Error verifying task: ${error.message}`);
    logger.error(`Error verifying task: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Error verifying task: ${error.message}` }, { status: 500, headers: corsHeaders });
  } finally {
    await prisma.$disconnect();
  }
}