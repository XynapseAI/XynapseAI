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

function validateEnvVars() {
  const requiredVars = ['DATABASE_URL', 'REDIS_URL', 'NEXT_PUBLIC_APP_URL'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (process.env.NODE_ENV !== 'production') {
    logger.info('All required environment variables validated');
  }
}

validateEnvVars();

let prisma = global.__prisma || new PrismaClient({
  errorFormat: 'minimal',
  datasources: { db: { url: process.env.DATABASE_URL } },
});
if (!global.__prisma) global.__prisma = prisma;

let redisClient;
async function getRedisClient() {
  if (redisClient?.isOpen) {
    return redisClient;
  }
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
    JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
  );
};

async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Database connection failed, retrying...`, { attempt: i + 1, err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function checkRateLimit(ip, userId) {
  const client = await getRedisClient();
  try {
    const windowSeconds = 15 * 60;
    const ipKey = `rate:ip:${ip}`;
    const userKey = userId ? `rate:user:${userId}` : null;
    const ipMax = process.env.NODE_ENV === 'development' ? 1000 : 500;
    const userMax = process.env.NODE_ENV === 'development' ? 500 : 200;

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
  } finally {
    await client.quit().catch(err => {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Redis disconnect failed', { err: err?.message });
      }
    });
  }
}

async function trackViolation(ip, reason, severity = 'warn') {
  if (severity === 'warn') {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Violation recorded (warning)', { ip, reason });
    }
    return;
  }

  const client = await getRedisClient();
  try {
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
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Violation recorded (severe)', { ip, reason, violations: violations + 1 });
    }
  } finally {
    await client.quit().catch(err => {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Redis disconnect failed', { err: err?.message });
      }
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function isAllowedOrigin(origin, referer, pathname, ip) {
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
      await trackViolation(ip, 'Missing origin and referer in production');
      return false;
    }

    if (origin && origin !== 'null') {
      if (!origin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS origin in production');
        return false;
      }
      if (configured.includes(origin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid origin');
      return false;
    }

    if (referer) {
      const refOrigin = new URL(referer).origin;
      if (!refOrigin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS referer in production');
        return false;
      }
      if (configured.includes(refOrigin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid referer');
      return false;
    }

    await trackViolation(ip, 'Invalid origin or referer');
    return false;
  } catch {
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

async function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function setCSRFToken(ip, userId) {
  const client = await getRedisClient();
  const token = await generateCSRFToken();
  const key = `csrf:${userId || ip}`;
  await client.setEx(key, 15 * 60, token);
  return token;
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

  if (process.env.NODE_ENV === 'development') {
    const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
    if (!valid && process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token mismatch in development', {
        headerToken: mask(headerToken),
        cookieToken: mask(cookieToken),
      });
    }
    return valid;
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

function securityHeaders(csrfToken = null) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');

  const headers = {
    'Content-Security-Policy': csp,
    'Content-Security-Policy-Nonce': nonce,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
  if (csrfToken) {
    headers['Set-Cookie'] = cookie.serialize('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60,
      path: '/',
    });
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

export async function OPTIONS(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  if (process.env.NODE_ENV !== 'production') {
    logger.info('GET /api/connect-data requested', { ip, pathname });
  }

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    if (!session || !userId) {
      await trackViolation(ip, 'Unauthenticated request');
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      await trackViolation(ip, err.message);
      return NextResponse.json(
        { detail: 'Too many requests' },
        { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
      );
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Invalid CSRF token. Please try again.' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Invalid input data' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const { uid } = parsedParams;
    const effectiveUid = uid || session.user.id;

    if (effectiveUid !== session.user.id) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Access denied: UID mismatch');
      return NextResponse.json({ detail: 'Access denied: Invalid UID' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    // Made reCAPTCHA optional for faster reads - only enforce low threshold if token provided
    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (recaptchaToken && process.env.NODE_ENV !== 'development') {
      try {
        const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        // Dynamic: Check score only if exists (v3), skip for v2
        if (!recaptchaResponse.success || (recaptchaResponse.score !== null && recaptchaResponse.score < 1.0)) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          await trackViolation(ip, 'reCAPTCHA score too low');
          return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score: recaptchaResponse.score });
        }
      } catch {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        await trackViolation(ip, 'reCAPTCHA verification failed');
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    }

    let redisClient;
    try {
      redisClient = await getRedisClient();
      const cacheKey = `user:${effectiveUid}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json(parsed, { headers: securityHeaders(newCsrfToken) });
      }

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
            twitter_handles: {
              select: {
                profile_picture: true,
              },
            },
          },
        })
      );

      if (!user) {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json({ detail: 'User not found' }, { status: 404, headers: securityHeaders(newCsrfToken) });
      }

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
        },
      };

      await redisClient.setEx(cacheKey, 300, JSON.stringify(serializeBigInt(data)));
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json(data, { headers: securityHeaders(newCsrfToken) });
    } finally {
      if (redisClient) {
        await redisClient.quit().catch(err => {
          if (process.env.NODE_ENV !== 'production') {
            logger.warn('Redis disconnect failed in GET', { err: err?.message });
          }
        });
      }
    }
  } catch {
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
  } finally {
    await prisma.$disconnect();
  }
}

export async function POST(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  if (process.env.NODE_ENV !== 'production') {
    logger.info('POST /api/connect-data requested', { ip, pathname });
  }

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    if (!session || !userId) {
      await trackViolation(ip, 'Unauthenticated request');
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      await trackViolation(ip, err.message);
      return NextResponse.json(
        { detail: 'Too many requests' },
        { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
      );
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid CSRF token');
      return NextResponse.json({ detail: 'Invalid CSRF token. Please try again.' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid JSON body');
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid input data');
      return NextResponse.json({ detail: 'Invalid input data' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

    if (session.user.id !== id) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Unauthorized user update', 'severe');
      return NextResponse.json({ detail: 'Not authorized' }, { status: 401, headers: securityHeaders(newCsrfToken) });
    }

    let redisClient;
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

      const existingUser = await withRetry(() =>
        prisma.users.findUnique({ where: { id }, select: { api_key_hash: true } })
      );
      let apiKeyData = {};
      if (!existingUser) {
        const plainApiKey = crypto.randomBytes(32).toString('hex');
        apiKeyData = await hashApiKey(plainApiKey);
      }

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

      redisClient = await getRedisClient();
      try {
        await redisClient.del(`user:${id}`);
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('Failed to clear cache for user', { id: mask(id), err: err?.message });
        }
      }

      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
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
        { headers: securityHeaders(newCsrfToken) }
      );
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders(newCsrfToken) });
    } finally {
      if (redisClient) {
        await redisClient.quit().catch(err => {
          if (process.env.NODE_ENV !== 'production') {
            logger.warn('Redis disconnect failed in POST', { err: err?.message });
          }
        });
      }
    }
  } catch {
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
  } finally {
    await prisma.$disconnect();
  }
}