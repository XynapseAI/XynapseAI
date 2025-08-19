// app/api/twitter/verify-task/route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { TwitterApi } from 'twitter-api-v2';
import { PrismaClient } from '@prisma/client';
import { verifyRecaptcha } from '@/utils/verifyRecaptcha';
import { z } from 'zod';

const prisma = new PrismaClient();
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
if (!redisClient.isOpen) await redisClient.connect();

const twitterClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET,
});

const schema = z.object({
  taskId: z.string().max(50),
  userId: z.string().max(100),
  recaptchaToken: z.string(),
});

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

async function refreshTwitterToken(twitterHandle) {
  if (twitterHandle.token_expires_at > new Date()) return twitterHandle.access_token;
  const { accessToken, refreshToken, expiresIn } = await twitterClient.refreshOAuth2Token(twitterHandle.refresh_token);
  await prisma.twitter_handles.update({
    where: { user_id: twitterHandle.user_id },
    data: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000),
      updated_at: new Date(),
    },
  });
  return accessToken;
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Request to /api/twitter/verify-task from IP ${ip}`, { origin, referer });

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

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = schema.parse(body);
  } catch (err) {
    logger.warn(`Data validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400 });
  }

  const { taskId, userId, recaptchaToken } = parsedBody;
  if (userId !== session.user.id) {
    logger.warn(`Access denied: userId=${userId}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Access denied: Invalid user ID' }, { status: 403 });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'verify_task', ip);
      logger.info('reCAPTCHA verification successful', { score, ip });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403 });
    }
  }

  try {
    const task = await prisma.tasks.findUnique({ where: { id: taskId } });
    if (!task) {
      logger.error(`Task not found: ${taskId}`, { ip });
      return NextResponse.json({ detail: 'Task not found' }, { status: 404 });
    }

    const twitterHandle = await prisma.twitter_handles.findUnique({ where: { user_id: userId } });
    if (!twitterHandle && task.task_type !== 'daily_checkin') {
      logger.warn(`Twitter account not connected for user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Twitter account not connected' }, { status: 400 });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const existingCompletion = await prisma.task_completions.findFirst({
      where: {
        user_id: userId,
        task_id: taskId,
        completed_at: { gte: today },
      },
    });

    if (task.is_daily && existingCompletion) {
      logger.info(`Task ${taskId} already completed today for user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Task already completed today' }, { status: 400 });
    }

    if (!task.is_daily && existingCompletion && existingCompletion.completion_count >= task.max_completions) {
      logger.info(`Task ${taskId} max completions reached for user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Maximum completions reached' }, { status: 400 });
    }

    let isTaskValid = false;
    if (task.task_type === 'follow') {
      const accessToken = await refreshTwitterToken(twitterHandle);
      const client = new TwitterApi(accessToken);
      // Get user ID from username
      const user = await client.v2.userByUsername(twitterHandle.twitter_handle, { 'user.fields': ['id'] });
      if (!user.data?.id) {
        logger.error(`Failed to fetch user ID for ${twitterHandle.twitter_handle}`, { ip });
        return NextResponse.json({ detail: 'Failed to fetch user ID' }, { status: 400 });
      }
      const userId = user.data.id;
      // Check following status
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
      isTaskValid = true; // No Twitter verification needed
      logger.info(`Daily check-in task verification: userId=${userId}, isValid=${isTaskValid}`, { ip });
    }

    if (!isTaskValid) {
      logger.warn(`Task verification failed for task ${taskId} by user ${userId}`, { ip });
      return NextResponse.json({ detail: 'Task verification failed' }, { status: 400 });
    }

    const completionCount = existingCompletion ? existingCompletion.completion_count + 1 : 1;
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

    const cacheKeyProgress = `taskProgress:${userId}`;
    const cacheKeyUser = `user:${userId}`;
    await redisClient.del(cacheKeyProgress);
    await redisClient.del(cacheKeyUser);

    logger.info(`Task ${taskId} verified for user ${userId}, points: ${task.points}`, { ip });
    return NextResponse.json(
      { success: true, completionCount, pointsEarned: task.points },
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  } catch (error) {
    logger.error(`Error verifying task: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Error verifying task: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}