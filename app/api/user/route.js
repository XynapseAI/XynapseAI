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

async function withRetry(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Database connection failed, retrying...`, { attempt: i + 1, err: err?.message });
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

  const wildcardPatterns = [
    /^https:\/\/[a-zA-Z0-9-]+\.xynapseai\.net$/, 
    /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/,
  ];

  logger.info('Checking origin', { origin, referer, pathname });

  try {
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        await trackViolation(ip, 'Non-HTTPS origin in production');
        return false;
      }
      if (
        configured.includes(origin) ||
        wildcardPatterns.some((pattern) => pattern.test(origin))
      ) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      await trackViolation(ip, 'Invalid origin');
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        await trackViolation(ip, 'Non-HTTPS referer in production');
        return false;
      }
      if (
        configured.includes(refOrigin) ||
        wildcardPatterns.some((pattern) => pattern.test(refOrigin))
      ) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      await trackViolation(ip, 'Invalid referer');
      return false;
    }

    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    if (!origin && process.env.NODE_ENV === 'production') {
      logger.error('Null origin blocked in production', { pathname });
      await trackViolation(ip, 'Null origin in production');
      return false;
    }

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

async function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function setCSRFToken(ip, userId) {
  const client = await getRedisClient();
  const token = await generateCSRFToken();
  const key = `csrf:${userId || ip}`;
  await client.setEx(key, 15 * 60, token); // CSRF token lives for 15 minutes
  return token;
}

async function checkDoubleSubmitCSRF(request, ip, userId) {
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

  if (process.env.NODE_ENV === 'development') {
    const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
    if (!valid) {
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
    logger.warn('CSRF token not found in Redis', { key: `csrf:${userId || ip}` });
    return false;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
                crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken));
  if (!valid) {
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
  const csp = "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  const headers = {
    'Content-Security-Policy': csp,
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
      maxAge: 15 * 60, // 15 minutes
      path: '/',
    });
  }
  return headers;
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
  logger.info('GET /api/user requested', { ip, pathname });

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
      logger.warn('Rate limit exceeded', { ip });
      return NextResponse.json({ detail: err.message }, { status: 429, headers });
    }

    if (!session || !session.user?.id) {
      await trackViolation(ip, 'Unauthenticated request');
      logger.warn('Unauthenticated GET request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid CSRF token');
      logger.warn('Invalid CSRF token, generating new token');
      return NextResponse.json({ detail: 'Invalid CSRF check. New token generated.' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch (err) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid input data');
      logger.warn('GET validation failed', { ip });
      return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    const { uid } = parsedParams;

    if (uid !== session.user.id) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'UID mismatch');
      logger.warn('Access denied: UID mismatch', { sessionUserId: mask(session.user.id) });
      return NextResponse.json({ detail: 'Access denied: Invalid UID' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Missing reCAPTCHA token');
      logger.warn('Missing reCAPTCHA token header');
      return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        if (score < 0) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          await trackViolation(ip, 'reCAPTCHA score too low');
          logger.warn('reCAPTCHA score too low', { ip, score });
          return NextResponse.json({ detail: 'reCAPTCHA verification failed: score too low' }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        logger.info('reCAPTCHA OK', { ip, score });
      } catch (err) {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        await trackViolation(ip, 'reCAPTCHA verification failed');
        logger.warn('reCAPTCHA failed', { ip, reason: err?.message });
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    } else {
      logger.info('reCAPTCHA bypassed in development');
    }

    try {
      const cacheKey = `user:${uid}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('Cache hit for user', { uid: mask(uid) });
        const parsed = JSON.parse(cached);
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json(parsed, { headers: securityHeaders(newCsrfToken) });
      }

      logger.info('Cache miss, querying DB for user', { uid: mask(uid) });
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
        await trackViolation(ip, 'User not found');
        logger.warn('User not found in DB', { uid: mask(uid) });
        return NextResponse.json({ detail: 'User not found' }, { status: 404, headers: securityHeaders(newCsrfToken) });
      }

      const data = {
        success: true,
        user: {
          id: user.id,
          email: user.email || '',
          googleId: user.google_id || null,
          profilePicture: user.twitter_handles?.profile_picture || user.profile_picture || '',
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
      logger.info('Fetched and cached user', { uid: mask(uid) });
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json(data, { headers: securityHeaders(newCsrfToken) });
    } catch (err) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      logger.error('Error in GET /api/user', { err: err?.message });
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders(newCsrfToken) });
    }
  } catch (err) {
    logger.error('Unexpected error in GET', { err: err?.message });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
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
  logger.info('POST /api/user requested', { ip, pathname });

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
      logger.warn('Rate limit exceeded', { ip });
      return NextResponse.json({ detail: err.message }, { status: 429, headers });
    }

    if (!session || !session.user?.id) {
      await trackViolation(ip, 'Unauthenticated request');
      logger.warn('Unauthenticated POST request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid CSRF token');
      logger.warn('Invalid CSRF token, generating new token');
      return NextResponse.json({ detail: 'Invalid CSRF check. New token generated.' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Missing reCAPTCHA token');
      logger.warn('Missing reCAPTCHA token header');
      return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'post_user', ip);
        if (score < 0.5) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          await trackViolation(ip, 'reCAPTCHA score too low');
          logger.warn('reCAPTCHA score too low', { ip, score });
          return NextResponse.json({ detail: 'reCAPTCHA verification failed: score too low' }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        logger.info('reCAPTCHA OK', { ip, score });
      } catch (err) {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        await trackViolation(ip, 'reCAPTCHA verification failed');
        logger.warn('reCAPTCHA failed', { ip, reason: err?.message });
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    } else {
      logger.info('reCAPTCHA bypassed in development');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid JSON body');
      logger.warn('Invalid JSON body on POST', { ip });
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch (err) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid input data');
      logger.warn('POST validation failed', { ip });
      return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified } = parsedBody;

    if (session.user.id !== id) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Unauthorized user update');
      logger.warn('Not authorized to update this user', { sessionUserId: mask(session.user.id) });
      return NextResponse.json({ detail: 'Not authorized' }, { status: 401, headers: securityHeaders(newCsrfToken) });
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
        logger.warn('Failed to clear cache for user', { id: mask(id), err: err?.message });
      }

      logger.info('User created/updated successfully', { id: mask(id) });
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
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
        { headers: { ...headers, ...securityHeaders(newCsrfToken) } }
      );
    } catch (err) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      logger.error('Error processing POST /api/user', { err: err?.message });
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders(newCsrfToken) });
    }
  } catch (err) {
    logger.error('Unexpected error in POST', { err: err?.message });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
  } finally {
    await prisma.$disconnect();
  }
}