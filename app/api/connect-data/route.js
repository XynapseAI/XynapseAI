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

// Khởi tạo PrismaClient toàn cục
let prisma = global.__prisma || new PrismaClient({
  errorFormat: 'minimal',
  datasources: { db: { url: process.env.DATABASE_URL } },
});
if (!global.__prisma) global.__prisma = prisma;

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
    try {
      await redisClient.connect();
      logger.info('Redis connected (initial)');
    } catch (err) {
      logger.error('Redis initial connect failed', { err });
      throw new Error('Redis connection failed');
    }
  } else if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
      logger.info('Redis reconnected');
    } catch (err) {
      logger.error('Redis reconnect failed', { err });
      throw new Error('Redis connection failed');
    }
  }
  return redisClient;
}

const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
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

async function checkRateLimit(ip, userId) {
  const client = await getRedisClient();
  const windowSeconds = 15 * 60;
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 1000 : 500; // Tăng giới hạn
  const userMax = process.env.NODE_ENV === 'development' ? 500 : 200; // Tăng giới hạn

  const ipCount = Number(await client.incr(ipKey));
  if (ipCount === 1) await client.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    const ttl = await client.ttl(ipKey);
    throw Object.assign(new Error('Too many requests from this IP'), { ttl });
  }

  if (userKey) {
    const uCount = Number(await client.incr(userKey));
    if (uCount === 1) await client.expire(userKey, windowSeconds);
    if (uCount > userMax) {
      const ttl = await client.ttl(userKey);
      throw Object.assign(new Error('Too many requests for this user'), { ttl });
    }
  }
}

async function trackViolation(ip, reason, severity = 'warn') {
  if (severity === 'warn') {
    logger.warn('Violation recorded (warning)', { ip, reason });
    return;
  }

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
  logger.warn('Violation recorded (severe)', { ip, reason, violations: violations + 1 });
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
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        return false;
      }
      if (configured.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      logger.warn('Invalid origin', { origin });
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        return false;
      }
      if (configured.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      logger.warn('Invalid referer', { referer });
      return false;
    }

    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    if (!origin && process.env.NODE_ENV === 'production') {
      logger.warn('Null origin blocked in production', { pathname });
      return false;
    }

    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }

    logger.warn('Invalid origin or referer', { origin, referer });
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, origin, referer, pathname });
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
  if (
    process.env.NODE_ENV === 'development' &&
    headerToken === 'dev-csrf' &&
    cookieToken === 'dev-csrf'
  ) {
    logger.info('Development CSRF bypass used');
    return true;
  }
  if (!headerToken || !cookieToken) {
    logger.warn('CSRF tokens missing', { headerProvided: !!headerToken, cookieProvided: !!cookieToken });
    return false;
  }
  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
  if (!valid) {
    logger.warn('CSRF token mismatch');
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

function securityHeaders(origin) {
  const csp =
    "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  const headers = {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
  if (origin && origin !== 'null') {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Recaptcha-Token, X-CSRF-Token';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

const getSchema = z.object({
  uid: z.string().max(100).optional(),
});

const postSchema = z.object({
  id: z.string().max(100),
  email: z.string().email(),
  profilePicture: z.string().url().optional(),
  googleId: z.string().max(100).optional(),
  googleName: z.string().max(255).optional(),
  emailVerified: z.boolean().optional(),
});

// ---------- OPTIONS handler ----------
export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const pathname = new URL(request.url).pathname;
  const referer = request.headers.get('referer');
  
  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  return new NextResponse(null, {
    status: 204,
    headers: securityHeaders(origin),
  });
}

// ---------- GET handler ----------
export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.info('GET /api/connect-data requested', { ip, origin, referer, query: Object.keys(params) });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    logger.warn('CORS origin not allowed for GET', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json(
        { detail: err.message },
        { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
      );
    }

    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated GET request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    const csrfOk = await checkDoubleSubmitCSRF(request);
    if (!csrfOk) {
      logger.warn('Invalid CSRF token', { ip });
      return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403, headers });
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch (err) {
      logger.warn('GET validation failed', { ip, err: err?.errors ?? err?.message });
      return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400, headers });
    }

    const { uid } = parsedParams;
    const effectiveUid = uid || session.user.id;

    if (effectiveUid !== session.user.id) {
      logger.warn('Access denied: UID mismatch', { uid: effectiveUid, sessionUserId: mask(session.user.id) });
      return NextResponse.json({ detail: 'Access denied: Invalid UID' }, { status: 403, headers });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      logger.warn('Missing reCAPTCHA token header', { ip });
      return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400, headers });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        logger.info('reCAPTCHA OK', { ip, score });
      } catch (err) {
        logger.warn('reCAPTCHA failed', { ip, reason: err?.message });
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers });
      }
    } else if (recaptchaToken === 'development-token') {
      logger.info('Development reCAPTCHA bypass used');
    }

    try {
      const client = await getRedisClient();
      const cacheKey = `user:${effectiveUid}`;
      const cached = await client.get(cacheKey);
      if (cached) {
        logger.info('Cache hit for user', { uid: effectiveUid });
        const parsed = JSON.parse(cached);
        return NextResponse.json(parsed, { headers });
      }

      logger.info('Cache miss, querying DB for user', { uid: effectiveUid });
      const user = await withRetry(() =>
        prisma.users.findUnique({
          where: { id: effectiveUid },
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
        logger.warn('User not found in DB', { uid: effectiveUid });
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

      await client.setEx(cacheKey, 300, JSON.stringify(serializeBigInt(data)));
      logger.info('Fetched and cached user', { uid: effectiveUid });
      return NextResponse.json(data, { headers });
    } catch (err) {
      logger.error('Error in GET /api/connect-data', { err: err?.message });
      return NextResponse.json({ detail: `Server error` }, { status: 500, headers });
    }
  } catch (err) {
    logger.error('Unexpected error in GET', { err: err?.message });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
  }
}

// ---------- POST handler ----------
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info('POST /api/connect-data requested', { ip, origin, referer });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    logger.warn('CORS origin not allowed for POST', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json(
        { detail: err.message },
        { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
      );
    }

    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated POST request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    const csrfOk = await checkDoubleSubmitCSRF(request);
    if (!csrfOk) {
      logger.warn('Invalid CSRF token', { ip });
      return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      logger.warn('Invalid JSON body on POST', { ip });
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch (err) {
      logger.warn('POST validation failed', { ip, errors: err?.errors ?? err?.message });
      return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400, headers });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

    if (session.user.id !== id) {
      await trackViolation(ip, 'Unauthorized user update', 'severe');
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

      // Kiểm tra xem có cần reset API key không
      const existingUser = await prisma.users.findUnique({ where: { id }, select: { api_key_hash: true } });
      let apiKeyData = {};
      if (!existingUser) {
        const plainApiKey = crypto.randomBytes(32).toString('hex');
        apiKeyData = await hashApiKey(plainApiKey);
      }

      logger.info('Creating/updating user (safely)', { id: mask(id) });
      const updatedUser = await withRetry(() =>
        prisma.users.upsert({
          where: { id },
          update: {
            ...userData,
            ...(Object.keys(apiKeyData).length > 0 && apiKeyData),
          },
          create: {
            ...userData,
            id,
            created_at: new Date(),
            ...apiKeyData,
          },
        })
      );

      const client = await getRedisClient();
      try {
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
      logger.error('Error processing POST /api/connect-data', { err: err?.message });
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
    }
  } catch (err) {
    logger.error('Unexpected error in POST', { err: err?.message });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
  }
}