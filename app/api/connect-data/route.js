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

// Prisma singleton
const prisma = globalThis.prisma || new PrismaClient({
  errorFormat: 'minimal',
  datasources: { db: { url: process.env.DATABASE_URL || 'postgresql://localhost:5432/db' } },
});
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

// Redis singleton
const redisClient = globalThis.redisClient || createClient({
  url: process.env.REDIS_URL || 'rediss://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
if (!globalThis.redisClient) {
  globalThis.redisClient = redisClient;
  await redisClient.connect();
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
  const windowSeconds = 15 * 60;
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 200 : 100;
  const userMax = process.env.NODE_ENV === 'development' ? 100 : 50;

  const ipCount = Number(await redisClient.incr(ipKey));
  if (ipCount === 1) await redisClient.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    throw new Error('Too many requests from this IP');
  }

  if (userKey) {
    const uCount = Number(await redisClient.incr(userKey));
    if (uCount === 1) await redisClient.expire(userKey, windowSeconds);
    if (uCount > userMax) {
      throw new Error('Too many requests for this user');
    }
  }
}

function isAllowedOrigin(origin) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL,
    'https://www.xynapseai.net',
    'http://localhost:3000'
  ].filter(Boolean);

  logger.debug('Checking origin', { origin });

  if (!origin) {
    if (process.env.NODE_ENV === 'development') {
      logger.warn('No origin, allowing in development mode');
      return true;
    }
    logger.error('Missing origin in production');
    return false;
  }

  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
    logger.warn('Blocked origin: non-HTTPS in production', { origin });
    return false;
  }

  if (configured.includes(origin)) {
    return true;
  }

  logger.error('Invalid origin', { origin });
  return false;
}

function getCorsHeaders(origin) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL,
    'https://www.xynapseai.net',
    'http://localhost:3000'
  ].filter(Boolean);

  const headers = {
    ...securityHeaders(),
    'Vary': 'Origin',
    'Cache-Control': 'private, no-store',
  };

  if (origin && configured.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Recaptcha-Token, X-CSRF-Token';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  try {
    return cookie.parse(raw);
  } catch {
    return {};
  }
}

async function checkDoubleSubmitCSRF(request, session) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['csrf_token'] || '';

  logger.debug('Checking CSRF tokens', {
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

  try {
    if (headerToken.length !== cookieToken.length) {
      logger.warn('CSRF token length mismatch');
      return false;
    }

    const [hmac, payload] = cookieToken.split('.');
    const [userId, nonce, ts] = payload ? Buffer.from(payload, 'base64url').toString().split('|') : [];
    const expectedHmac = crypto.createHmac('sha256', process.env.CSRF_SECRET)
      .update(`${userId}|${nonce}|${ts}`)
      .digest('base64url');

    if (!hmac || !payload || hmac !== expectedHmac || userId !== session.user.id) {
      logger.warn('Invalid CSRF token HMAC or user mismatch');
      return false;
    }

    const tokenAge = Date.now() - parseInt(ts);
    if (tokenAge > 60 * 60 * 1000) {
      logger.warn('CSRF token expired');
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
  } catch (err) {
    logger.warn('CSRF validation error', { err: err?.message });
    return false;
  }
}

function mask(value, keep = 6) {
  if (!value) return '';
  return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function hashApiKey(apiKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(apiKey, salt, 64);
  return {
    api_key_hash: derived.toString('hex'),
    api_key_salt: salt,
  };
}

function securityHeaders() {
  const csp = "default-src 'self'; object-src 'none'; frame-ancestors 'none';";
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Cross-Origin-Resource-Policy': 'same-site',
  };
}

function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const trustedProxies = ['vercel.com', '127.0.0.1'];
  const ip = forwarded?.split(',')[0]?.trim();
  if (ip && trustedProxies.some(proxy => request.headers.get('host')?.includes(proxy))) {
    return ip;
  }
  return request.ip || 'unknown';
}

const getSchema = z.object({
  uid: z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid UID characters').optional(),
});

const postSchema = z.object({
  id: z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid ID characters'),
  email: z.string().email(),
  profilePicture: z.string().url().max(2048).optional(),
  googleId: z.string().max(100).optional(),
  googleName: z.string().max(255).optional(),
  emailVerified: z.boolean().optional(),
});

// ---------- OPTIONS handler ----------
export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  logger.debug('OPTIONS /api/connect-data requested', { origin });

  if (!isAllowedOrigin(origin)) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// ---------- GET handler ----------
export async function GET(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.debug('GET /api/connect-data requested', { ip, origin, query: Object.keys(params) });

  if (!isAllowedOrigin(origin)) {
    logger.warn('CORS origin not allowed for GET', { origin });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json({ detail: err.message }, { status: 429 });
    }

    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated GET request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch (err) {
      logger.warn('GET validation failed', { ip, err: err?.errors ?? err?.message });
      return NextResponse.json({ detail: 'INVALID_INPUT', errors: err.errors }, { status: 400 });
    }

    const { uid } = parsedParams;
    const effectiveUid = uid || session.user.id;

    if (effectiveUid !== session.user.id) {
      logger.warn('Access denied: UID mismatch', { uid: effectiveUid, sessionUserId: mask(session.user.id) });
      return NextResponse.json({ detail: 'ACCESS_DENIED' }, { status: 403 });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      logger.warn('Missing reCAPTCHA token header');
      return NextResponse.json({ detail: 'MISSING_RECAPTCHA_TOKEN' }, { status: 400 });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_connect_data', ip);
        logger.info('reCAPTCHA OK', { ip, score });
      } catch (err) {
        logger.warn('reCAPTCHA failed', { ip, reason: err?.message });
        return NextResponse.json({ detail: 'RECAPTCHA_FAILED' }, { status: 403 });
      }
    } else if (recaptchaToken === 'development-token') {
      logger.info('Development reCAPTCHA bypass used');
    }

    try {
      const cacheKey = `user:${effectiveUid}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('Cache hit for user', { uid: effectiveUid });
        const parsed = JSON.parse(cached);
        return NextResponse.json(parsed, { headers: getCorsHeaders(origin) });
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
        return NextResponse.json({ detail: 'USER_NOT_FOUND' }, { status: 404 });
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
      logger.info('Fetched and cached user', { uid: effectiveUid });
      return NextResponse.json(data, { headers: getCorsHeaders(origin) });
    } catch (err) {
      logger.error('Error in GET /api/connect-data', { err: err?.message, stack: err?.stack });
      return NextResponse.json({ detail: 'INTERNAL_ERROR', error: err?.message }, { status: 500 });
    }
  } catch (err) {
    logger.error('Unexpected error in GET', { err: err?.message, stack: err?.stack });
    return NextResponse.json({ detail: 'INTERNAL_ERROR', error: err?.message }, { status: 500 });
  }
}

// ---------- POST handler ----------
export async function POST(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  logger.debug('POST /api/connect-data requested', { ip, origin });

  if (!isAllowedOrigin(origin)) {
    logger.warn('CORS origin not allowed for POST', { origin });
    return NextResponse.json({ detail: 'NOT_ALLOWED_BY_CORS' }, { status: 403 });
  }

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json({ detail: err.message }, { status: 429 });
    }

    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated POST request', { ip });
      return NextResponse.json({ detail: 'NOT_AUTHENTICATED' }, { status: 401 });
    }

    const csrfOk = await checkDoubleSubmitCSRF(request, session);
    if (!csrfOk) {
      return NextResponse.json({ detail: 'INVALID_CSRF_CHECK' }, { status: 403 });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    const serverSecret = request.headers.get('x-server-secret');
    if (!recaptchaToken && !serverSecret && process.env.NODE_ENV !== 'development') {
      logger.warn('Missing reCAPTCHA token or server secret for POST');
      return NextResponse.json({ detail: 'MISSING_RECAPTCHA_TOKEN' }, { status: 400 });
    }
    if (serverSecret && serverSecret === process.env.SERVER_SECRET) {
      logger.info('Server-to-server request bypass reCAPTCHA');
    } else if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'post_connect_data', ip);
        logger.info('reCAPTCHA OK for POST', { ip, score });
      } catch (err) {
        logger.warn('reCAPTCHA failed for POST', { ip, reason: err?.message });
        return NextResponse.json({ detail: 'RECAPTCHA_FAILED' }, { status: 403 });
      }
    } else if (recaptchaToken === 'development-token') {
      logger.info('Development reCAPTCHA bypass used for POST');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      logger.warn('Invalid JSON body on POST', { ip });
      return NextResponse.json({ detail: 'INVALID_JSON_BODY' }, { status: 400 });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch (err) {
      logger.warn('POST validation failed', { ip, errors: err?.errors ?? err?.message });
      return NextResponse.json({ detail: 'INVALID_INPUT', errors: err.errors }, { status: 400 });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

    if (session.user.id !== id) {
      logger.warn('Not authorized to update this user', { id, sessionUserId: mask(session.user.id) });
      return NextResponse.json({ detail: 'NOT_AUTHORIZED' }, { status: 401 });
    }

    try {
      const userData = {
        email,
        google_id: googleId || null,
        profile_picture: profilePicture || '',
        google_name: googleName || '',
        email_verified: emailVerified || false,
        last_connected: new Date(),
      };

      logger.info('Creating/updating user (safely)', { id: mask(id) });
      const updatedUser = await withRetry(() =>
        prisma.users.upsert({
          where: { id },
          update: userData,
          create: {
            ...userData,
            id,
            created_at: new Date(),
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
          },
        })
      );

      try {
        await redisClient.del(`user:${id}`);
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
        { headers: getCorsHeaders(origin) }
      );
    } catch (err) {
      logger.error('Error processing POST /api/connect-data', { err: err?.message, stack: err?.stack });
      return NextResponse.json({ detail: 'INTERNAL_ERROR', error: err?.message }, { status: 500 });
    }
  } catch (err) {
    logger.error('Unexpected error in POST', { err: err?.message, stack: err?.stack });
    return NextResponse.json({ detail: 'INTERNAL_ERROR', error: err?.message }, { status: 500 });
  }
}