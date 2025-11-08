// app/api/user/route.js
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
async function withRetry(fn, retries = 3, delay = 3000) { // FIXED: Increase delay for DB timeout
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.message.includes('timeout') || err.code === 'ECONNRESET') { // FIXED: Detect timeout
        logger.warn(`DB timeout detected, retrying...`, { attempt: i + 1 });
      }
      if (i === retries - 1) throw err;
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Database connection failed, retrying...`, { attempt: i + 1, err: err?.message });
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
async function trackViolation(ip, reason) {
  const client = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 5;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await client.get(key)) || 0;
  if (violations >= maxViolations) {
    await client.setEx(`banned_ip:${ip}`, 3600, 'banned');
    logger.info('IP banned', { ip: mask(ip), reason }); // FIXED: Mask IP in log
    throw new Error('IP banned due to repeated violations.');
  }
  await client.multi().incr(key).expire(key, Math.floor(windowMs / 1000)).exec();
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('Violation recorded', { ip: mask(ip), reason, violations: violations + 1 });
  }
}
function mask(value, keep = 6) { // FIXED: Add mask function
  if (!value) return '';
  return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
}
async function isAllowedOrigin(origin, referer, pathname, ip) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
    'https://base.xynapseai.net', // Add for Base mini app
    'https://warpcast.com', // FIXED: Add for Farcaster mobile
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
// [Other functions unchanged - omitted]
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
  const client = await getRedisClient();
  const storedToken = await client.get(`csrf:${userId || ip}`);
  if (!storedToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token not found in Redis', { key: `csrf:${userId || ip}` });
    }
    return false;
  }
  // FIXED: Add debug log for lengths
  logger.info('CSRF token lengths', { header: headerToken.length, cookie: cookieToken.length, stored: storedToken.length });
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
async function hashApiKey(apiKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(apiKey, salt, 64);
  return {
    api_key_hash: derived.toString('hex'),
    api_key_salt: salt,
  };
}
// FIXED: Conditional sameSite: 'none' only prod (dev 'lax')
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
    const sameSite = process.env.NODE_ENV === 'production' ? 'none' : 'lax';
    headers['Set-Cookie'] = cookie.serialize('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: sameSite,
      maxAge: 15 * 60,
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
  walletAddress: z.string().optional(), // Add for Base
});
// FIXED: Wrap in try-catch for DB error (cause 500), use withRetry
async function computeStreak(userId) {
  try {
    return await withRetry(async () => {
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
    });
  } catch (err) {
    logger.error('computeStreak error', { err: err.message, userId });
    return 0; // Fallback
  }
}
// FIXED: Wrap in try-catch for DB error, use withRetry
async function getLast7Days(userId) {
  try {
    return await withRetry(async () => {
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
      return last7;
    });
  } catch (err) {
    logger.error('getLast7Days error', { err: err.message, userId });
    return Array(7).fill(false); // Fallback
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
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  // FIXED: Handle null origin in CORS headers
  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': new URL(referer).origin.includes('warpcast.com') ? 'https://base.xynapseai.net' : new URL(referer).origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    // CHANGED: Explicit for null origin – use referer if available
    ...(origin === 'null' && referer && {
      'Access-Control-Allow-Origin': new URL(referer).origin,
      'Access-Control-Allow-Methods': 'GET, POST',
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
      return NextResponse.json({ detail: 'Too many requests' }, { status: 429, headers });
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

    if (uid !== session.user.id) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Access denied: Invalid UID' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (recaptchaToken && process.env.NODE_ENV !== 'development') {
      try {
        const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        if (!recaptchaResponse.success || (recaptchaResponse.score !== undefined && recaptchaResponse.score < 0.4)) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score: recaptchaResponse.score });
        }
      } catch {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    }

    try {
      // Cache key prioritizes wallet_address if available
      const walletAddress = session.user.walletAddress;
      const cacheKey = walletAddress ? `user:${walletAddress}` : `user:${uid}`;
      const client = await getRedisClient();
      const cached = await client.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json(parsed, { headers: securityHeaders(newCsrfToken) });
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
            wallet_address: true, // Ensure select wallet
            points: true,
            tweet_points: true,
            ai_points: true,
            task_points: true,
            is_creator: true,
            is_ai_rank: true,
            tier: true,
            is_premium: true,
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
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json({ detail: 'User not found' }, { status: 500, headers: securityHeaders(newCsrfToken) });
      }

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
          walletAddress: user.wallet_address || null, // Add explicitly
          emailVerified: user.email_verified || false,
          points: Number(user.points || 0),
          tweetPoints: Number(user.tweet_points || 0),
          aiPoints: Number(user.ai_points || 0),
          taskPoints: Number(user.task_points || 0),
          isCreator: user.is_creator || false,
          isAiRank: user.is_ai_rank || false,
          tier: user.tier || 'Basic',
          isPremium: user.is_premium || false,
          lastConnected: user.last_connected ? new Date(user.last_connected).toISOString() : null,
          twitterHandle: user.twitter_handle || null,
          daysActive: Number(user.days_active || 0),
          streak,
          last7Days,
        },
      };

      await client.setEx(cacheKey, 300, JSON.stringify(serializeBigInt(data)));
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json(data, { headers: securityHeaders(newCsrfToken) });
    } catch (error) {
      logger.error('Error in /api/user GET', { error: error.message, stack: error.stack, ip });
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders(newCsrfToken) });
    }
  } catch (error) {
    logger.error('Unexpected error in /api/user GET', { error: error.message, stack: error.stack, ip });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
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
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  // FIXED: Handle null origin in CORS headers
  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    // CHANGED: Explicit for null origin – use referer if available
    ...(origin === 'null' && referer && {
      'Access-Control-Allow-Origin': new URL(referer).origin,
      'Access-Control-Allow-Methods': 'GET, POST',
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
      return NextResponse.json({ detail: 'Too many requests' }, { status: 429, headers });
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Invalid CSRF token. Please try again.' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Missing reCAPTCHA token');
      return NextResponse.json({ detail: 'Missing reCAPTCHA token' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'post_user', ip);
        if (!recaptchaResponse.success) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          if (recaptchaResponse.needsFallback) {
            return NextResponse.json({ detail: 'low_score_fallback' }, { status: 403, headers: securityHeaders(newCsrfToken) });
          }
          await trackViolation(ip, `reCAPTCHA verification failed: ${recaptchaResponse.error}`);
          return NextResponse.json({ detail: `reCAPTCHA verification failed: ${recaptchaResponse.error}` }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score: recaptchaResponse.score });
        }
      } catch (error) {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        await trackViolation(ip, `reCAPTCHA verification error: ${error.message}`);
        return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
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

    const { id, email, profilePicture, googleId, googleName, emailVerified, walletAddress } = parsedBody;

    if (session.user.id !== id) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Unauthorized user update');
      return NextResponse.json({ detail: 'Not authorized' }, { status: 401, headers: securityHeaders(newCsrfToken) });
    }

    try {
      const userData = {
        email,
        google_id: googleId || null,
        profile_picture: profilePicture || '',
        google_name: googleName || '',
        email_verified: emailVerified || false,
        wallet_address: walletAddress || null,
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
        const cacheKey = updatedUser.wallet_address ? `user:${updatedUser.wallet_address}` : `user:${id}`;
        await client.del(cacheKey);
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('Failed to clear cache for user', { id: mask(id), err: err?.message });
        }
      }

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
            wallet_address: updatedUser.wallet_address,
            email_verified: updatedUser.email_verified,
          }),
        },
        { headers: { ...headers, ...securityHeaders(newCsrfToken) } }
      );
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders(newCsrfToken) });
    }
  } catch {
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
  }
}