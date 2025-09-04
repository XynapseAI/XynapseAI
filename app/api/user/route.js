import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';
import util from 'util';
import cookie from 'cookie';

const scrypt = util.promisify(crypto.scrypt);

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
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
    await redisClient.connect();
    logger.info('Redis connected (initial)');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

// ---------- Helpers ----------
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Database connection failed, retrying...`, { attempt: i + 1 });
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

async function trackViolation(ip, reason) {
  const client = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 5;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await client.get(key)) || 0;
  if (violations >= maxViolations) {
    await client.setEx(`banned_ip:${ip}`, 3600, 'banned');
    logger.info('IP banned', { ip, reason });
    throw new Error('IP banned due to repeated violations.');
  }
  await client.multi().incr(key).expire(key, Math.floor(windowMs / 1000)).exec();
  logger.warn('Violation recorded', { ip, reason, violations: violations + 1 });
}

async function isAllowedOrigin(origin, referer, pathname) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);

  logger.info('Checking origin', { origin, referer, pathname, configured });

  try {
    // Kiểm tra origin hợp lệ
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        await trackViolation(ip, 'Non-HTTPS origin in production');
        return false;
      }
      if (configured.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      await trackViolation(ip, 'Invalid origin');
      return false;
    }

    // Kiểm tra referer nếu không có origin
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        await trackViolation(ip, 'Non-HTTPS referer in production');
        return false;
      }
      if (configured.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      await trackViolation(ip, 'Invalid referer');
      return false;
    }

    // Cho phép internal/SSR request
    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    // Chặn null origin trong production
    if (!origin && process.env.NODE_ENV === 'production') {
      logger.error('Null origin blocked in production', { pathname });
      await trackViolation(ip, 'Null origin in production');
      return false;
    }

    // Cho phép null origin trong development
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }

    logger.error('Invalid origin or referer', { origin, referer });
    await trackViolation(ip, 'Invalid origin or referer');
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, origin, referer, pathname });
    await trackViolation(ip, 'Error validating origin');
    return false;
  }
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  try {
    return cookie.parse(raw);
  } catch {
    return {};
  }
}

async function checkDoubleSubmitCSRF(request) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['csrf_token'] || '';

  logger.info('Checking CSRF tokens', {
    headerToken: headerToken ? 'provided' : 'missing',
    cookieToken: cookieToken ? 'provided' : 'missing',
  });

  if (process.env.NODE_ENV === 'development' && headerToken === 'dev-csrf' && cookieToken === 'dev-csrf') {
    logger.info('Development CSRF bypass used');
    return true;
  }

  if (!headerToken || !cookieToken) {
    logger.warn('CSRF tokens missing', {
      headerProvided: !!headerToken,
      cookieProvided: !!cookieToken,
    });
    return false;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
  if (!valid) {
    logger.warn('CSRF token mismatch', {
      headerToken: mask(headerToken),
      cookieToken: mask(cookieToken),
    });
    return false;
  }
  return valid;
}

function mask(value, keep = 6) {
  if (!value) return '';
  return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
}

async function hashApiKey(apiKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(apiKey, salt, 64);
  return {
    api_key_hash: derived.toString('hex'),
    api_key_salt: salt,
  };
}

function securityHeaders() {
  const csp = "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  return {
    'Content-Security-Policy': csp,
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

// ---------- GET handler ----------
export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.info('GET /api/user requested', { ip, origin, referer, query: Object.keys(params) });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.warn('CORS origin not allowed for GET', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      await trackViolation(ip, err.message);
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json({ detail: err.message }, { status: 429, headers });
    }

    if (!session || !session.user?.id) {
      await trackViolation(ip, 'Unauthenticated request');
      logger.warn('Unauthenticated GET request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    const csrfOk = await checkDoubleSubmitCSRF(request);
    if (!csrfOk) {
      await trackViolation(ip, 'Invalid CSRF token');
      return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403, headers });
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch (err) {
      await trackViolation(ip, 'Invalid input data');
      logger.warn('GET validation failed', { ip, err: err?.errors ?? err?.message });
      return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400, headers });
    }
    const { uid } = parsedParams;

    if (uid !== session.user.id) {
      await trackViolation(ip, 'UID mismatch');
      logger.warn('Access denied: UID mismatch', { uid, sessionUserId: mask(session.user.id) });
      return NextResponse.json({ detail: 'Access denied: Invalid UID' }, { status: 403, headers });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      await trackViolation(ip, 'Missing reCAPTCHA token');
      logger.warn('Missing reCAPTCHA token header');
      return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400, headers });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        logger.info('reCAPTCHA OK', { ip, score });
      } catch (err) {
        await trackViolation(ip, 'reCAPTCHA verification failed');
        logger.warn('reCAPTCHA failed', { ip, reason: err?.message });
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers });
      }
    } else if (recaptchaToken === 'development-token') {
      logger.info('Development reCAPTCHA bypass used');
    }

    try {
      const cacheKey = `user:${uid}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('Cache hit for user', { uid });
        const parsed = JSON.parse(cached);
        return NextResponse.json(parsed, { headers });
      }

      logger.info('Cache miss, querying DB for user', { uid });
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
          },
        })
      );

      if (!user) {
        await trackViolation(ip, 'User not found');
        logger.warn('User not found in DB', { uid });
        return NextResponse.json({ detail: 'User not found' }, { status: 404, headers });
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
        },
      };

      await redisClient.setEx(cacheKey, 300, JSON.stringify(serializeBigInt(data)));
      logger.info('Fetched and cached user', { uid });
      return NextResponse.json(data, { headers });
    } catch (err) {
      logger.error('Error in GET /api/user', { err: err?.message });
      return NextResponse.json({ detail: `Server error` }, { status: 500, headers });
    }
  } catch (err) {
    logger.error('Unexpected error in GET', { err: err?.message });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
  } finally {
    await prisma.$disconnect();
  }
}

// ---------- POST handler ----------
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info('POST /api/user requested', { ip, origin, referer });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.warn('CORS origin not allowed for POST', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      await trackViolation(ip, err.message);
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json({ detail: err.message }, { status: 429, headers });
    }

    if (!session || !session.user?.id) {
      await trackViolation(ip, 'Unauthenticated request');
      logger.warn('Unauthenticated POST request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    const csrfOk = await checkDoubleSubmitCSRF(request);
    if (!csrfOk) {
      await trackViolation(ip, 'Invalid CSRF token');
      return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      await trackViolation(ip, 'Invalid JSON body');
      logger.warn('Invalid JSON body on POST', { ip });
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch (err) {
      await trackViolation(ip, 'Invalid input data');
      logger.warn('POST validation failed', { ip, errors: err?.errors ?? err?.message });
      return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400, headers });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

    if (session.user.id !== id) {
      await trackViolation(ip, 'Unauthorized user update');
      logger.warn('Not authorized to update this user', { id, sessionUserId: mask(session.user.id) });
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
      };

      const plainApiKey = crypto.randomBytes(32).toString('hex');
      const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);

      logger.info('Creating/updating user (safely)', { id: mask(id) });
      const updatedUser = await withRetry(() =>
        prisma.users.upsert({
          where: { id },
          update: {
            ...userData,
            api_key_hash,
            api_key_salt,
          },
          create: {
            ...userData,
            id,
            created_at: new Date(),
            api_key_hash,
            api_key_salt,
          },
        })
      );

      try {
        const client = await getRedisClient();
        await client.del(`user:${id}`);
      } catch (err) {
        logger.warn('Failed to clear cache for user', { id, err: err?.message });
      }

      logger.info('User created/updated successfully', { id: mask(id) });
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
      logger.error('Error processing POST /api/user', { err: err?.message });
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
    }
  } catch (err) {
    logger.error('Unexpected error in POST', { err: err?.message });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
  } finally {
    await prisma.$disconnect();
  }
}