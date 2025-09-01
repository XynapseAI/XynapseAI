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
import { encrypt, decrypt } from '../../../utils/encryption';

const scrypt = util.promisify(crypto.scrypt);

// Khởi tạo Prisma
let prisma;
if (!global.__prisma) {
  global.__prisma = new PrismaClient({
    errorFormat: 'minimal',
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
}
prisma = global.__prisma;

// Khởi tạo Redis
let redisClient;
async function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      password: process.env.REDIS_AUTH,
      socket: {
        tls: process.env.NODE_ENV === 'production',
        connectTimeout: 10000, // Thêm timeout
      },
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message, stack: err?.stack }));
    try {
      await redisClient.connect();
      logger.info('Redis connected');
    } catch (err) {
      logger.error('Redis connect failed', { err: err?.message, stack: err?.stack });
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
      logger.error('Database retry failed', { attempt: i + 1, error: err.message, stack: err.stack });
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Rate Limiting
async function checkRateLimit(ip, userId) {
  const client = await getRedisClient();
  const windowSeconds = 5 * 60; // Giảm window để debug
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 1000 : 500; // Tăng giới hạn
  const userMax = process.env.NODE_ENV === 'development' ? 500 : 300;

  const ipCount = Number(await client.incr(ipKey));
  logger.info('Rate Limit Check', { ip, ipCount, userId, userKey });
  if (ipCount === 1) await client.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    logger.warn('Rate limit exceeded for IP', { ip, ipCount });
    throw new Error('Too many requests from this IP');
  }

  if (userKey) {
    const uCount = Number(await client.incr(userKey));
    logger.info('User Rate Limit Check', { userId, uCount });
    if (uCount === 1) await client.expire(userKey, windowSeconds);
    if (uCount > userMax) {
      logger.warn('Rate limit exceeded for user', { userId, uCount });
      throw new Error('Too many requests for this user');
    }
  }
}

function isAllowedOrigin(origin, referer) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL,
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);

  logger.info('CORS Check', { origin, referer, configured });

  try {
    if (origin) {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        return false;
      }
      const originUrl = new URL(origin);
      if (
        configured.includes(origin) ||
        originUrl.hostname.endsWith('.vercel.app') ||
        originUrl.hostname.endsWith('xynapseai.net')
      ) {
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        return false;
      }
      if (
        configured.includes(refOrigin) ||
        refOrigin.endsWith('.vercel.app') ||
        refOrigin.endsWith('xynapseai.net')
      ) {
        return true;
      }
    }
    if (!origin && !referer && process.env.NODE_ENV === 'development') {
      logger.warn('No origin or referer, allowing in development mode');
      return true;
    }
    logger.error('Invalid origin or referer', { origin, referer });
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, stack: err?.stack });
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
  logger.info('CSRF Validation', { headerToken: mask(headerToken), cookieToken: mask(cookieToken) });

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

  const client = await getRedisClient();
  const storedToken = await client.get(`csrf:${cookieToken}`);
  logger.info('CSRF Redis Check', { storedToken: mask(storedToken), headerToken: mask(headerToken) });
  if (!storedToken || storedToken !== headerToken) {
    logger.warn('CSRF token invalid or expired', { headerToken: mask(headerToken), cookieToken: mask(cookieToken) });
    return false;
  }

  return true;
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
    api_key_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  };
}

function securityHeaders(nonce) {
  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL || 'https://api.xynapseai.net'};
    object-src 'none';
    frame-ancestors 'none';
    base-uri 'self';
    report-uri /csp-report;
  `.replace(/\s+/g, ' ').trim();
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

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.info('GET /api/connect-data requested', { ip, origin, referer, query: Object.keys(params) });

  if (!isAllowedOrigin(origin, referer)) {
    logger.warn('CORS origin not allowed for GET', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS', errorCode: 'CORS_DENIED' }, { status: 403 });
  }

  try {
    const nonce = crypto.randomBytes(16).toString('base64');
    const session = await auth();
    const userId = session?.user?.id || null;
    logger.info('Session Data', { userId, sessionExists: !!session });

    try {
      await checkRateLimit(ip, userId);
    } catch {
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json({ detail: 'Too many requests', errorCode: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
    }

    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated GET request', { ip });
      return NextResponse.json({ detail: 'Not authenticated', errorCode: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const csrfOk = await checkDoubleSubmitCSRF(request);
    if (!csrfOk) {
      logger.warn('CSRF check failed', { ip });
      return NextResponse.json({ detail: 'Invalid CSRF token', errorCode: 'CSRF_INVALID' }, { status: 403 });
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch (err) {
      logger.warn('GET validation failed', { ip, errors: err?.errors });
      return NextResponse.json({ detail: 'Invalid input data', errorCode: 'INVALID_INPUT' }, { status: 400 });
    }

    const { uid } = parsedParams;
    const effectiveUid = uid || session.user.id;

    if (effectiveUid !== session.user.id) {
      logger.warn('Access denied: UID mismatch', {
        uid: effectiveUid,
        sessionUserId: mask(session.user.id),
      });
      return NextResponse.json({ detail: 'Access denied', errorCode: 'UID_MISMATCH' }, { status: 403 });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      logger.warn('Missing reCAPTCHA token header', { ip });
      return NextResponse.json({ detail: 'Missing reCAPTCHA token', errorCode: 'RECAPTCHA_MISSING' }, { status: 400 });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        logger.info('reCAPTCHA Verification', { ip, score });
        if (score < 0.3) { // Giảm threshold để debug
          logger.warn('reCAPTCHA score too low', { ip, score });
          return NextResponse.json({ detail: 'reCAPTCHA verification failed', errorCode: 'RECAPTCHA_FAILED' }, { status: 403 });
        }
      } catch (err) {
        logger.warn('reCAPTCHA failed', { ip, reason: err?.message, stack: err?.stack });
        return NextResponse.json({ detail: 'reCAPTCHA verification failed', errorCode: 'RECAPTCHA_ERROR' }, { status: 403 });
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
        const headers = {
          ...securityHeaders(nonce),
          'Access-Control-Allow-Origin':
            origin ||
            (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        };
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
            api_key_expires_at: true,
          },
        })
      );

      if (!user) {
        logger.warn('User not found in DB', { uid: effectiveUid });
        return NextResponse.json({ detail: 'User not found', errorCode: 'USER_NOT_FOUND' }, { status: 404 });
      }

      const decryptedUser = {
        ...user,
        email: user.email ? await decrypt(user.email) || '' : '',
        google_id: user.google_id ? await decrypt(user.google_id) || null : null,
        wallet_address: user.wallet_address ? await decrypt(user.wallet_address) || null : null,
      };

      if (user.api_key_expires_at && new Date() > user.api_key_expires_at) {
        logger.warn('API key expired', { uid: effectiveUid });
        return NextResponse.json({ detail: 'API key expired', errorCode: 'API_KEY_EXPIRED' }, { status: 403 });
      }

      const data = {
        success: true,
        user: {
          id: decryptedUser.id,
          email: decryptedUser.email || '',
          googleId: decryptedUser.google_id || null,
          profilePicture: decryptedUser.profile_picture || '',
          googleName: decryptedUser.google_name || '',
          emailVerified: decryptedUser.email_verified || false,
          points: Number(decryptedUser.points || 0),
          tweetPoints: Number(decryptedUser.tweet_points || 0),
          aiPoints: Number(decryptedUser.ai_points || 0),
          taskPoints: Number(decryptedUser.task_points || 0),
          isCreator: decryptedUser.is_creator || false,
          isAiRank: decryptedUser.is_ai_rank || false,
          tier: decryptedUser.tier || 'Basic',
          isPremium: decryptedUser.is_premium || false,
          walletAddress: decryptedUser.wallet_address || null,
          lastConnected: decryptedUser.last_connected ? new Date(decryptedUser.last_connected).toISOString() : null,
          twitterHandle: decryptedUser.twitter_handle || null,
        },
      };

      await client.setEx(cacheKey, 300, JSON.stringify(serializeBigInt(data)));
      logger.info('Fetched and cached user', { uid: effectiveUid });
      const headers = {
        ...securityHeaders(nonce),
        'Access-Control-Allow-Origin':
          origin ||
          (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      };
      return NextResponse.json(data, { headers });
    } catch (err) {
      logger.error('Error in GET /api/connect-data', { err: err.message, stack: err.stack });
      return NextResponse.json({ detail: 'Internal server error', errorCode: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
    }
  } catch (err) {
    logger.error('Unexpected error in GET', { err: err.message, stack: err.stack });
    return NextResponse.json({ detail: 'Internal server error', errorCode: 'UNEXPECTED_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info('POST /api/connect-data requested', { ip, origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.warn('CORS origin not allowed for POST', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS', errorCode: 'CORS_DENIED' }, { status: 403 });
  }

  try {
    const nonce = crypto.randomBytes(16).toString('base64');
    const session = await auth();
    const userId = session?.user?.id || null;
    logger.info('Session Data', { userId, sessionExists: !!session });

    try {
      await checkRateLimit(ip, userId);
    } catch {
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json({ detail: 'Too many requests', errorCode: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
    }

    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated POST request', { ip });
      return NextResponse.json({ detail: 'Not authenticated', errorCode: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const csrfOk = await checkDoubleSubmitCSRF(request);
    if (!csrfOk) {
      logger.warn('CSRF check failed', { ip });
      return NextResponse.json({ detail: 'Invalid CSRF token', errorCode: 'CSRF_INVALID' }, { status: 403 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      logger.warn('Invalid JSON body on POST', { ip });
      return NextResponse.json({ detail: 'Invalid JSON body', errorCode: 'INVALID_JSON' }, { status: 400 });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch (err) {
      logger.warn('POST validation failed', { ip, errors: err?.errors });
      return NextResponse.json({ detail: 'Invalid input data', errorCode: 'INVALID_INPUT' }, { status: 400 });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

    if (session.user.id !== id) {
      logger.warn('Not authorized to update this user', { id, sessionUserId: mask(session.user.id) });
      return NextResponse.json({ detail: 'Not authorized', errorCode: 'UNAUTHORIZED' }, { status: 401 });
    }

    try {
      const encryptedEmail = await encrypt(email);
      const encryptedGoogleId = googleId ? await encrypt(googleId) : null;

      const userData = {
        email: encryptedEmail,
        google_id: encryptedGoogleId,
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
      const { api_key_hash, api_key_salt, api_key_expires_at } = await hashApiKey(plainApiKey);

      logger.info('Creating/updating user', { id: mask(id) });
      const updatedUser = await withRetry(() =>
        prisma.users.upsert({
          where: { id },
          update: {
            ...userData,
            api_key_hash,
            api_key_salt,
            api_key_expires_at,
          },
          create: {
            ...userData,
            id,
            created_at: new Date(),
            api_key_hash,
            api_key_salt,
            api_key_expires_at,
          },
        })
      );

      const client = await getRedisClient();
      try {
        await client.del(`user:${id}`);
        const newCsrfToken = crypto.randomBytes(32).toString('hex');
        await client.setEx(`csrf:${newCsrfToken}`, 30 * 60, newCsrfToken);
        await client.del(`csrf:${cookies['csrf_token']}`);
      } catch (err) {
        logger.warn('Failed to clear cache or update CSRF', { id, err: err?.message });
      }

      logger.info('User created/updated successfully', { id: mask(id) });
      const headers = {
        ...securityHeaders(nonce),
        'Access-Control-Allow-Origin':
          origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
        'Set-Cookie': cookie.serialize('csrf_token', newCsrfToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: 30 * 60,
        }),
      };
      return NextResponse.json(
        {
          success: true,
          user: serializeBigInt({
            id: updatedUser.id,
            email: await decrypt(updatedUser.email),
            profile_picture: updatedUser.profile_picture,
            google_name: updatedUser.google_name,
            email_verified: updatedUser.email_verified,
          }),
        },
        { headers }
      );
    } catch (err) {
      logger.error('Error in POST /api/connect-data', { err: err.message, stack: err.stack });
      return NextResponse.json({ detail: 'Internal server error', errorCode: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
    }
  } catch (err) {
    logger.error('Unexpected error in POST', { err: err.message, stack: err.stack });
    return NextResponse.json({ detail: 'Internal server error', errorCode: 'UNEXPECTED_ERROR' }, { status: 500 });
  }
}