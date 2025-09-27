// app/api/user/route.js
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

let redisClient;
async function getRedisClient() {
  if (redisClient?.isOpen) return redisClient;
  const maxRetries = 3;
  const delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
      redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
      await redisClient.connect();
      if (process.env.NODE_ENV !== 'production') {
        logger.info('Redis connected');
      }
      return redisClient;
    } catch (err) {
      if (i === maxRetries - 1) throw new Error('Failed to connect to Redis');
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Redis connection failed, retrying...`, { attempt: i + 1, err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function getClientIp(request) {
  const xForwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const xRealIp = request.headers.get('x-real-ip')?.trim();
  const vercelIp = request.headers.get('x-vercel-forwarded-for')?.trim();
  return xRealIp || vercelIp || xForwardedFor || 'unknown';
}

const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

async function withRetry(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Operation failed, retrying...`, { attempt: i + 1, err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function checkRateLimit(ip, userId = null) {
  const client = await getRedisClient();
  const windowSeconds = 15 * 60;
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 500 : 300;
  const userMax = process.env.NODE_ENV === 'development' ? 300 : 100;
  const ipCount = Number(await client.incr(ipKey));
  if (ipCount === 1) await client.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    throw new Error('Too many requests from this IP');
  }
  if (userKey) {
    const uCount = Number(await client.incr(userKey));
    if (uCount === 1) await client.expire(userKey, windowSeconds);
    if (uCount > userMax) {
      throw new Error('Too many requests for this user');
    }
  }
}

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (process.env.NODE_ENV === 'development') return true;
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) return false;
  return true;
}

async function isAllowedOrigin(origin, referer) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    return configured.includes(origin) || configured.includes(referer ? new URL(referer).origin : null);
  }

  try {
    if (!origin && !referer) {
      return false; // Strict in prod
    }

    if (origin && origin !== 'null') {
      if (!origin.startsWith('https://')) {
        return false;
      }
      if (configured.includes(origin)) {
        return true;
      }
      return false;
    }

    if (referer) {
      const refOrigin = new URL(referer).origin;
      if (!refOrigin.startsWith('https://')) {
        return false;
      }
      if (configured.includes(refOrigin)) {
        return true;
      }
      return false;
    }

    return false;
  } catch {
    return false;
  }
}

function securityHeaders() {
  return {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
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

async function computeStreak(userId) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const completions = await prisma.task_completions.findMany({
      where: {
        user_id: userId,
        task_id: 'daily_checkin',
        completed_at: { gte: thirtyDaysAgo },
      },
      orderBy: { completed_at: 'desc' },
    });

    let streak = 0;
    let expectedDate = new Date();
    expectedDate.setUTCHours(23, 59, 59, 999);

    for (const comp of completions) {
      const compDate = new Date(comp.completed_at);
      compDate.setUTCHours(23, 59, 59, 999);
      if (compDate.getTime() === expectedDate.getTime()) {
        streak++;
        expectedDate.setDate(expectedDate.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Error computing streak, defaulting to 0', { userId, err: err.message });
    }
    return 0;
  }
}

async function getLast7Days(userId) {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setUTCHours(23, 59, 59, 999);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const completions = await prisma.task_completions.findMany({
      where: {
        user_id: userId,
        task_id: 'daily_checkin',
        completed_at: { gte: sevenDaysAgo, lte: todayEnd },
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
    return last7.reverse(); // Oldest to newest
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Error getting last7Days, defaulting to empty', { userId, err: err.message });
    }
    return new Array(7).fill(false);
  }
}

export async function GET(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  if (process.env.NODE_ENV !== 'production') {
    logger.info('GET /api/user requested', { ip, pathname });
  }

  if (!(await isAllowedOrigin(origin, referer, pathname, ip))) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    if (!session || !userId) {
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch {
      return NextResponse.json({ detail: 'Too many requests' }, { status: 429, headers });
    }

    if (!(await checkCSRF(request, session))) {
      return NextResponse.json({ detail: 'Invalid CSRF token. Please try again.' }, { status: 403, headers });
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch {
      return NextResponse.json({ detail: 'Invalid input data' }, { status: 400, headers });
    }
    const { uid } = parsedParams;

    if (uid !== session.user.id) {
      return NextResponse.json({ detail: 'Access denied: Invalid UID' }, { status: 403, headers });
    }

    // reCAPTCHA optional for GET, low threshold if provided
    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (recaptchaToken && process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        if (score < 0.5) {
          return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score });
        }
      } catch {
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers });
      }
    }

    try {
      const cacheKey = `user:${uid}`;
      const client = await getRedisClient();
      const cached = await client.get(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached), { headers });
      }

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
            twitter_handle: true,
            days_active: true,
            twitter_handles: {
              select: {
                profile_picture: true,
              },
            },
          },
        })
      );

      if (!user) {
        return NextResponse.json({ detail: 'User not found' }, { status: 404, headers });
      }

      // Compute streak and last7Days with error handling
      const streak = await computeStreak(uid);
      const last7Days = await getLast7Days(uid);

      const data = {
        success: true,
        user: {
          id: user.id,
          email: user.email || '',
          googleId: user.google_id || null,
          profilePicture: user.twitter_handles?.[0]?.profile_picture || user.profile_picture || '',
          googleName: user.google_name || '',
          emailVerified: user.email_verified || false,
          points: Number(user.points || 0),
          tweetPoints: Number(user.tweet_points || 0),
          aiPoints: Number(user.ai_points || 0),
          taskPoints: Number(user.task_points || 0),
          isCreator: user.is_creator || false,
          isAiRank: user.is_ai_rank || false,
          tier: user.tier || 'Basic',
          isPremium: user.is_premium || false,
          walletAddress: user.wallet_address || null,
          lastConnected: user.last_connected ? new Date(user.last_connected).toISOString() : null,
          twitterHandle: user.twitter_handle || null,
          daysActive: Number(user.days_active || 0),
          streak,
          last7Days,
        },
      };

      await client.setEx(cacheKey, 300, JSON.stringify(serializeBigInt(data)));
      return NextResponse.json(data, { headers });
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Error fetching user data', { message: err.message, stack: err.stack, ip });
      }
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      logger.error('Unexpected error in /api/user', { message: err.message, ip: getClientIp(request) });
    }
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
  } finally {
    await prisma.$disconnect().catch(() => {}); // Graceful disconnect
  }
}

export async function POST(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  if (process.env.NODE_ENV !== 'production') {
    logger.info('POST /api/user requested', { ip, pathname });
  }

  if (!(await isAllowedOrigin(origin, referer, pathname, ip))) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    if (!session || !userId) {
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch {
      return NextResponse.json({ detail: 'Too many requests' }, { status: 429, headers });
    }

    if (!(await checkCSRF(request, session))) {
      return NextResponse.json({ detail: 'Invalid CSRF token. Please try again.' }, { status: 403, headers });
    }

    // Enforce reCAPTCHA for mutations (POST)
    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ detail: 'Missing reCAPTCHA token' }, { status: 400, headers });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'post_user', ip);
        if (score < 0.1) {
          return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score });
        }
      } catch {
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers });
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch {
      return NextResponse.json({ detail: 'Invalid input data' }, { status: 400, headers });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

    if (session.user.id !== id) {
      return NextResponse.json({ detail: 'Not authorized' }, { status: 401, headers });
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
        twitter_handle: null,
        days_active: 0,
      };

      const plainApiKey = crypto.randomBytes(32).toString('hex');
      const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);

      const updatedUser = await withRetry(() =>
        prisma.users.upsert({
          where: { id },
          update: {
            ...userData,
            api_key_hash,
            api_key_salt,
            api_key_updated_at: new Date(),
          },
          create: {
            ...userData,
            id,
            created_at: new Date(),
            api_key_hash,
            api_key_salt,
            api_key_updated_at: new Date(),
          },
        })
      );

      try {
        const client = await getRedisClient();
        await client.del(`user:${id}`);
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('Failed to clear cache for user', { id: mask(id), err: err?.message });
        }
      }

      headers['X-API-Key'] = plainApiKey;
      return NextResponse.json(
        {
          success: true,
          user: serializeBigInt({
            id: updatedUser.id,
            email: updatedUser.email,
            profile_picture: updatedUser.profile_picture,
            google_name: updatedUser.google_name,
            email_verified: updatedUser.email_verified,
          }),
        },
        { headers }
      );
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Error updating user', { message: err.message, ip });
      }
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      logger.error('Unexpected error in /api/user POST', { message: err.message, ip: getClientIp(request) });
    }
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
  } finally {
    await prisma.$disconnect().catch(() => {}); // Graceful disconnect
  }
}

async function hashApiKey(apiKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(apiKey, salt, 64);
  return {
    api_key_hash: derived.toString('hex'),
    api_key_salt: salt,
  };
}

function mask(value, keep = 6) {
  if (!value) return '';
  return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
}