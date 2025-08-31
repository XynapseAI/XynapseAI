// app\api\user\route.js
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';
import cookie from 'cookie';

// Prisma singleton
const prisma = globalThis.prisma || new PrismaClient({
  errorFormat: 'minimal',
  datasources: { db: { url: process.env.DATABASE_URL || 'postgresql://localhost:5432/db' } },
});
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

// Redis singleton
let redisClient = globalThis.redisClient;
async function getRedisClient() {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL;
    const isProduction = process.env.NODE_ENV === 'production';
    if (!redisUrl) {
      logger.error('REDIS_URL is not defined in environment variables', { timestamp: new Date().toISOString() });
      throw new Error('Server configuration error: REDIS_URL is required');
    }
    if (isProduction && (!redisUrl.startsWith('rediss://') || !redisUrl.includes('@'))) {
      logger.error('Invalid REDIS_URL: Must use rediss:// protocol with authentication in production', { timestamp: new Date().toISOString() });
      throw new Error('Server configuration error: Invalid REDIS_URL for production');
    }
    if (!isProduction && !redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
      logger.error('Invalid REDIS_URL: Must use redis:// or rediss:// protocol in development', { timestamp: new Date().toISOString() });
      throw new Error('Server configuration error: Invalid REDIS_URL for development');
    }
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message, stack: err.stack, timestamp: new Date().toISOString() }));
    await redisClient.connect();
    logger.info('Redis connected', { timestamp: new Date().toISOString() });
    globalThis.redisClient = redisClient;
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected', { timestamp: new Date().toISOString() });
  }
  return redisClient;
}

// Helpers
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
      logger.warn(`Database connection failed, retrying after ${delay}ms`, { attempt: i + 1, timestamp: new Date().toISOString() });
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

async function checkRateLimit(ip, userId) {
  const redisClient = await getRedisClient();
  const start = Date.now();
  const windowSeconds = 15 * 60;
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 300 : 100;
  const userMax = process.env.NODE_ENV === 'development' ? 200 : 50;

  const ipCount = Number(await redisClient.incr(ipKey));
  if (ipCount === 1) await redisClient.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    logger.warn(`Rate limit exceeded for IP ${ip}`, { timestamp: new Date().toISOString() });
    throw new Error('Too many requests from this IP');
  }

  if (userKey) {
    const uCount = Number(await redisClient.incr(userKey));
    if (uCount === 1) await redisClient.expire(userKey, windowSeconds);
    if (uCount > userMax) {
      logger.warn(`Rate limit exceeded for user ${userId}`, { timestamp: new Date().toISOString() });
      throw new Error('Too many requests for this user');
    }
  }
  logger.debug('Rate limit check latency', { ms: Date.now() - start, timestamp: new Date().toISOString() });
}

function isAllowedOrigin(origin, referer) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL,
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'http://localhost:3000',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
    ...(process.env.NODE_ENV === 'production' ? [] : ['https://[a-z0-9-]+\.vercel\.app']),
  ].filter(Boolean);

  logger.debug('Checking origin', { origin, host, timestamp: new Date().toISOString() });

  if (!origin) {
    if (process.env.NODE_ENV === 'development') {
      logger.warn('No origin, allowing in development mode', { timestamp: new Date().toISOString() });
      return true;
    }
    const hostUrl = `http${process.env.NODE_ENV === 'production' ? 's' : ''}://${host}`;
    if (configured.includes(hostUrl)) {
      logger.debug('No origin, but same-origin request', { host, timestamp: new Date().toISOString() });
      return true;
    }
    logger.error('Missing origin in production and not same-origin', { host, timestamp: new Date().toISOString() });
    return false;
  }

  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
    logger.warn('Blocked origin: non-HTTPS in production', { origin, timestamp: new Date().toISOString() });
    return false;
  }

  const isAllowed = configured.some((allowed) =>
    allowed.includes('[a-z0-9-]+\.vercel\.app')
      ? new RegExp('^https://[a-z0-9-]+\.vercel\.app$').test(origin)
      : allowed === origin
  );
  if (isAllowed) return true;

  logger.error('Invalid origin', { origin, timestamp: new Date().toISOString() });
  return false;
}

function getCorsHeaders(origin) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL,
    'https://www.xynapseai.net',
    'http://localhost:3000',
    ...(process.env.NODE_ENV === 'production' ? [] : ['https://[a-z0-9-]+\.vercel\.app']),
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
  if (request.method !== 'POST') return true;

  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['csrf_token'] || '';

  logger.debug('Checking CSRF tokens', {
    headerToken: headerToken ? 'provided' : 'missing',
    cookieToken: cookieToken ? 'provided' : 'missing',
    timestamp: new Date().toISOString(),
  });

  if (process.env.NODE_ENV === 'development' && headerToken === 'dev-csrf' && cookieToken === 'dev-csrf') {
    logger.info('Development CSRF bypass used', { timestamp: new Date().toISOString() });
    return true;
  }

  if (!headerToken || !cookieToken) {
    logger.warn('CSRF tokens missing', {
      headerProvided: !!headerToken,
      cookieProvided: !!cookieToken,
      timestamp: new Date().toISOString(),
    });
    return false;
  }

  try {
    if (headerToken.length !== cookieToken.length) {
      logger.warn('CSRF token length mismatch', { timestamp: new Date().toISOString() });
      return false;
    }

    const [hmac, payload] = cookieToken.split('.');
    if (!hmac || !payload) {
      logger.warn('Invalid CSRF token format', { timestamp: new Date().toISOString() });
      return false;
    }

    const [userId, nonce, ts] = Buffer.from(payload, 'base64url').toString().split('|');
    if (!userId || !nonce || !ts) {
      logger.warn('Invalid CSRF token payload', { timestamp: new Date().toISOString() });
      return false;
    }

    if (!process.env.CSRF_SECRET) {
      logger.error('CSRF_SECRET not configured', { timestamp: new Date().toISOString() });
      throw new Error('Server configuration error');
    }

    const expectedHmac = crypto.createHmac('sha256', process.env.CSRF_SECRET)
      .update(`${userId}|${nonce}|${ts}`)
      .digest('base64url');

    if (hmac !== expectedHmac || userId !== session.user.id) {
      logger.warn('Invalid CSRF token HMAC or user mismatch', { userId, sessionUserId: session.user.id, timestamp: new Date().toISOString() });
      return false;
    }

    const tokenAge = Date.now() - parseInt(ts);
    if (tokenAge > 60 * 60 * 1000) {
      logger.warn('CSRF token expired', { timestamp: new Date().toISOString() });
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
  } catch (err) {
    logger.warn('CSRF validation error', { err: err?.message, timestamp: new Date().toISOString() });
    return false;
  }
}

function mask(value, keep = 6) {
  if (!value) return '';
  return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
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
  const vercelIp = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip');
  const ip = forwarded?.split(',')[0]?.trim() || vercelIp || 'unknown';
  if (!ip || ip === 'unknown' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^[0-9a-f:]+$/i.test(ip)) {
    logger.warn('Invalid or missing IP address', { forwarded, vercelIp, timestamp: new Date().toISOString() });
    return 'unknown';
  }
  logger.debug('Resolved client IP', { ip, forwarded, vercelIp, timestamp: new Date().toISOString() });
  return ip;
}

const getSchema = z.object({
  uid: z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid UID characters'),
});

const postSchema = z.object({
  id: z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid ID characters'),
  email: z.string().email(),
  profilePicture: z.string().url().max(2048).optional(),
  googleId: z.string().max(100).optional(),
  googleName: z.string().max(255).optional(),
  emailVerified: z.boolean().optional(),
});

// OPTIONS handler
export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  logger.debug('OPTIONS /api/user requested', { origin, host, timestamp: new Date().toISOString() });

  if (!isAllowedOrigin(origin, host)) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin, host, timestamp: new Date().toISOString() });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// GET handler
export async function GET(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.debug('GET /api/user requested', { ip, origin, host, query: Object.keys(params), timestamp: new Date().toISOString() });

  if (!isAllowedOrigin(origin, host)) {
    logger.warn('CORS origin not allowed for GET', { origin, host, timestamp: new Date().toISOString() });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch {
      logger.warn('Rate limit exceeded', { ip, userId, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Request limit exceeded' }, { status: 429, headers: getCorsHeaders(origin) });
    }

    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated GET request', { ip, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers: getCorsHeaders(origin) });
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch (err) {
      logger.warn('GET validation failed', { ip, errors: err?.errors, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Invalid input', errors: err.errors }, { status: 400, headers: getCorsHeaders(origin) });
    }
    const { uid } = parsedParams;

    if (uid !== session.user.id) {
      logger.warn('Access denied: UID mismatch', { uid, sessionUserId: mask(session.user.id), timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Access denied' }, { status: 403, headers: getCorsHeaders(origin) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      logger.warn('Missing reCAPTCHA token header', { timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Missing reCAPTCHA token' }, { status: 400, headers: getCorsHeaders(origin) });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        logger.info('reCAPTCHA OK', { ip, score, timestamp: new Date().toISOString() });
      } catch (err) {
        logger.warn('reCAPTCHA failed', { ip, reason: err?.message, timestamp: new Date().toISOString() });
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: getCorsHeaders(origin) });
      }
    } else if (recaptchaToken === 'development-token') {
      logger.info('Development reCAPTCHA bypass used', { timestamp: new Date().toISOString() });
    }

    try {
      const redisClient = await getRedisClient();
      const cacheKey = `user:${uid}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('Cache hit for user', { uid, timestamp: new Date().toISOString() });
        const parsed = JSON.parse(cached);
        return NextResponse.json(parsed, { headers: getCorsHeaders(origin) });
      }

      logger.info('Cache miss, querying DB for user', { uid, timestamp: new Date().toISOString() });
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
        logger.warn('User not found in DB', { uid, timestamp: new Date().toISOString() });
        return NextResponse.json({ detail: 'User not found' }, { status: 404, headers: getCorsHeaders(origin) });
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

      await redisClient.setEx(cacheKey, 600, JSON.stringify(serializeBigInt(data)));
      logger.info('Fetched and cached user', { uid, timestamp: new Date().toISOString() });
      return NextResponse.json(data, { headers: getCorsHeaders(origin) });
    } catch (err) {
      logger.error('Error in GET /api/user', { error: err?.message, stack: err?.stack, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Internal server error' }, { status: 500, headers: getCorsHeaders(origin) });
    }
  } catch (err) {
    logger.error('Unexpected error in GET', { error: err?.message, stack: err?.stack, timestamp: new Date().toISOString() });
    return NextResponse.json({ detail: 'Internal server error' }, { status: 500, headers: getCorsHeaders(origin) });
  }
}

// POST handler
export async function POST(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  logger.debug('POST /api/user requested', { ip, origin, host, timestamp: new Date().toISOString() });

  if (!isAllowedOrigin(origin, host)) {
    logger.warn('CORS origin not allowed for POST', { origin, host, timestamp: new Date().toISOString() });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch {
      logger.warn('Rate limit exceeded', { ip, userId, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Request limit exceeded' }, { status: 429, headers: getCorsHeaders(origin) });
    }

    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated POST request', { ip, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers: getCorsHeaders(origin) });
    }

    const csrfOk = await checkDoubleSubmitCSRF(request, session);
    if (!csrfOk) {
      logger.warn('Invalid CSRF check', { ip, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Invalid CSRF check' }, { status: 403, headers: getCorsHeaders(origin) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    const serverSecret = request.headers.get('x-server-secret');
    if (!recaptchaToken && !serverSecret && process.env.NODE_ENV !== 'development') {
      logger.warn('Missing reCAPTCHA token or server secret for POST', { timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Missing reCAPTCHA token or server secret' }, { status: 400, headers: getCorsHeaders(origin) });
    }
    if (serverSecret && serverSecret === process.env.SERVER_SECRET) {
      logger.info('Server-to-server request bypass reCAPTCHA', { timestamp: new Date().toISOString() });
    } else if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'post_user', ip);
        logger.info('reCAPTCHA OK for POST', { ip, score, timestamp: new Date().toISOString() });
      } catch (err) {
        logger.warn('reCAPTCHA failed for POST', { ip, reason: err?.message, timestamp: new Date().toISOString() });
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: getCorsHeaders(origin) });
      }
    } else if (recaptchaToken === 'development-token') {
      logger.info('Development reCAPTCHA bypass used for POST', { timestamp: new Date().toISOString() });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      logger.warn('Invalid JSON body on POST', { ip, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: getCorsHeaders(origin) });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch (err) {
      logger.warn('POST validation failed', { ip, errors: err?.errors, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Invalid input', errors: err.errors }, { status: 400, headers: getCorsHeaders(origin) });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

    if (session.user.id !== id) {
      logger.warn('Not authorized to update this user', { id: mask(id), sessionUserId: mask(session.user.id), timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Not authorized' }, { status: 401, headers: getCorsHeaders(origin) });
    }

    try {
      const redisClient = await getRedisClient();
      const userData = {
        email,
        google_id: googleId || null,
        profile_picture: profilePicture || '',
        google_name: googleName || '',
        email_verified: emailVerified || false,
        last_connected: new Date(),
      };

      logger.info('Creating/updating user', { id: mask(id), timestamp: new Date().toISOString() });
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
        logger.warn('Failed to clear cache for user', { id, error: err?.message, timestamp: new Date().toISOString() });
      }

      logger.info('User created/updated successfully', { id: mask(id), timestamp: new Date().toISOString() });
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
      logger.error('Error processing POST /api/user', { error: err?.message, stack: err?.stack, timestamp: new Date().toISOString() });
      return NextResponse.json({ detail: 'Internal server error' }, { status: 500, headers: getCorsHeaders(origin) });
    }
  } catch (err) {
    logger.error('Unexpected error in POST', { error: err?.message, stack: err?.stack, timestamp: new Date().toISOString() });
    return NextResponse.json({ detail: 'Internal server error' }, { status: 500, headers: getCorsHeaders(origin) });
  }
}