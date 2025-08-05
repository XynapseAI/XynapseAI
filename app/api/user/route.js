import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';

const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Retry logic
async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Database connection failed, retrying after ${delay}ms`, { attempt: i + 1 });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:user:${ip}`;
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
  logger.info('Checking CSRF', {
    receivedToken: csrfToken,
    sessionToken: session?.csrfToken,
    userId: session?.user?.id,
  });
  if (process.env.NODE_ENV === 'development') {
    logger.info('Skipping CSRF check in development mode');
    return true;
  }
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token`, {
      receivedToken: csrfToken || 'none',
      sessionToken: session?.csrfToken || 'none',
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    });
    return false;
  }
  logger.info('CSRF check successful', { userId: session.user.id });
  return true;
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
    'https://*.xynapseai.net', // Thêm wildcard cho subdomain
  ].filter((v, i, a) => a.indexOf(v) === i);

  logger.info('Checking origin', { origin, referer, allowedOrigins });
  try {
    if (origin) {
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app') || hostname.endsWith('xynapseai.net')) {
        logger.info('Dynamic domain allowed', { origin, hostname });
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      const hostname = new URL(refOrigin).hostname;
      if (hostname.endsWith('.vercel.app') || hostname.endsWith('xynapseai.net')) {
        logger.info('Referer dynamic domain allowed', { referer, hostname });
        return true;
      }
    }
    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }
    logger.error('Blocked by CORS', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, origin, referer });
    return false;
  }
}

const getSchema = z.object({
  uid: z.string().max(100),
});

const postSchema = z.object({
  id: z.string().max(100),
  email: z.string().email(),
  profilePicture: z.string().url().optional(),
  googleId: z.string().max(100).optional(),
  googleName: z.string().max(255).optional(),
  emailVerified: z.boolean().optional(),
});

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.info(`Request to /api/user from IP ${ip}, query: ${JSON.stringify(params)}`, { origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
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
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403 });
  }

  let parsedParams;
  try {
    parsedParams = getSchema.parse(params);
  } catch (err) {
    logger.warn(`Data validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400 });
  }

  const { uid } = parsedParams;

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
    logger.error('Missing X-Recaptcha-Token header', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400 });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
      logger.info('reCAPTCHA verification successful for get_user', {
        token: recaptchaToken.substring(0, 8) + '...',
        score,
        ip,
      });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, {
        token: recaptchaToken.substring(0, 8) + '...',
        ip,
      });
      return NextResponse.json({
        detail: `reCAPTCHA verification failed: ${error.message}`,
        errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
      }, { status: 403 });
    }
  } else if (recaptchaToken === 'development-token') {
    logger.info('Skipping reCAPTCHA in development mode', { ip });
  }

  if (uid !== session.user.id) {
    logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Access denied: Invalid UID' }, { status: 403 });
  }

  try {
    const cacheKey = `user:${uid}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for user ${uid}`, { ip });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    logger.info(`Starting to fetch user data for UID: ${uid}`, { ip });
    const user = await withRetry(() =>
      prisma.users.findUnique({
        where: { id: uid },
        select: {
          id: true,
          email: true,
          google_id: true,
          profile_picture: true,
          google_name: true,
          email_verified: true,
          points: true,
          tweet_points: true,
          ai_points: true,
          task_points: true,
          is_creator: true,
          is_ai_rank: true,
          tier: true,
          is_premium: true,
          wallet_address: true,
          last_connected: true,
        },
      })
    );

    if (!user) {
      logger.error(`User not found: ${uid}`, { ip });
      return NextResponse.json({ detail: 'User not found' }, { status: 404 });
    }

    const data = {
      success: true,
      user: {
        id: user.id,
        email: user.email || '',
        googleId: user.google_id || null,
        profilePicture: user.profile_picture || '',
        googleName: user.google_name || '',
        emailVerified: user.email_verified || false,
        points: user.points || 0,
        tweetPoints: user.tweet_points || 0,
        aiPoints: user.ai_points || 0,
        taskPoints: user.task_points || 0,
        isCreator: user.is_creator || false,
        isAiRank: user.is_ai_rank || false,
        tier: user.tier || 'Basic',
        isPremium: user.is_premium || false,
        walletAddress: user.wallet_address || null,
        lastConnected: user.last_connected ? new Date(user.last_connected).toISOString() : null,
      },
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(data));
    logger.info(`Successfully fetched and cached user: ${uid}`, { ip });
    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error(`Error processing user request: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Request to /api/user from IP ${ip}`, { origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
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
    logger.warn('Session not authenticated or missing user ID', { ip, session });
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
    parsedBody = postSchema.parse(body);
  } catch (err) {
    logger.warn(`Data validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400 });
  }

  const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

  if (session.user.id !== id) {
    logger.warn(`Not authorized: id=${id}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Not authorized' }, { status: 401 });
  }

  try {
    const userData = {
      email,
      google_id: googleId || null,
      profile_picture: profilePicture || '',
      google_name: googleName || '',
      email_verified: emailVerified || false,
      connected: true,
      last_connected: new Date(),
      points: 0,
      tweet_points: 0,
      ai_points: 0,
      task_points: 0,
      is_creator: false,
      is_ai_rank: false,
      tier: 'Basic',
      is_plus: false,
      is_premium: false,
    };

    logger.info(`Starting to create/update user: ${id}`, { ip });
    const updatedUser = await withRetry(() =>
      prisma.users.upsert({
        where: { id },
        update: userData,
        create: {
          ...userData,
          id,
          created_at: new Date(),
          api_key: crypto.randomBytes(32).toString('hex'),
        },
      })
    );

    logger.info(`User created/updated: ${id}`, { ip });
    return NextResponse.json({ success: true, user: updatedUser }, {
      headers: {
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin, referer) ? origin : (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error(`Error processing user request: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}