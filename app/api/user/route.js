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
  datasources: { db: { url: process.env.DATABASE_URL } },
});

let redisClient;
async function getRedisClient() {
  if (redisClient && redisClient.isOpen) return redisClient;
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
      if (i === maxRetries - 1) {
        logger.warn('Redis connect failed, proceeding without Redis');
        return null;
      }
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Redis retry ${i + 1} failed`, { err: err?.message });
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

const serializeBigInt = (obj) => JSON.parse(JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value)));

async function withRetry(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`DB retry ${i + 1} failed`, { err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function checkRateLimit(ip, userId = null) {
  const client = await getRedisClient();
  if (!client) return;  // Skip nếu no Redis
  const windowSeconds = 15 * 60;
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 500 : 300;
  const userMax = process.env.NODE_ENV === 'development' ? 300 : 100;
  const ipCount = Number(await client.incr(ipKey));
  if (ipCount === 1) await client.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) throw new Error('Too many requests from IP');
  if (userKey) {
    const uCount = Number(await client.incr(userKey));
    if (uCount === 1) await client.expire(userKey, windowSeconds);
    if (uCount > userMax) throw new Error('Too many requests for user');
  }
}

async function trackViolation(ip, reason) {
  const client = await getRedisClient();
  if (!client) return;
  const key = `violations:${ip}`;
  const maxViolations = 5;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await client.get(key)) || 0;
  if (violations >= maxViolations) {
    await client.setEx(`banned_ip:${ip}`, 3600, 'banned');
    logger.info('IP banned', { ip, reason });
    throw new Error('IP banned');
  }
  await client.multi().incr(key).expire(key, Math.floor(windowMs / 1000)).exec();
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('Violation recorded', { ip, reason, violations: violations + 1 });
  }
}

async function isAllowedOrigin(origin, referer, pathname, ip) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
    'https://base.xynapseai.net',
  ].filter(Boolean);

  if (process.env.NODE_ENV !== 'production') return true;  // Lenient in dev

  try {
    if (!origin && !referer) {
      await trackViolation(ip, 'Missing origin/referer');
      return false;
    }
    const checkOrigin = origin || (referer ? new URL(referer).origin : null);
    if (checkOrigin && configured.includes(checkOrigin)) return true;
    await trackViolation(ip, 'Invalid origin');
    return false;
  } catch {
    await trackViolation(ip, 'Origin check error');
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
  if (client) await client.setEx(key, 15 * 60, token);
  return token;
}

async function checkDoubleSubmitCSRF(request, ip, userId) {
  try {
    const headerToken = request.headers.get('x-csrf-token') || '';
    const cookies = parseCookies(request);
    const cookieToken = cookies['next-auth.csrf-token'] || '';

    if (process.env.NODE_ENV === 'development') {
      if (process.env.NODE_ENV !== 'production') {
        logger.info('Dev CSRF check', { header: !!headerToken, cookie: !!cookieToken });
      }
      if (!headerToken || !cookieToken) {
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('CSRF missing in dev, generating new');
        }
        return false;  // Trigger new token
      }
      // Simple check in dev (no Redis)
      const valid = headerToken === cookieToken;
      if (!valid && process.env.NODE_ENV !== 'production') {
        logger.warn('CSRF mismatch in dev');
      }
      return valid;
    }

    if (!headerToken || !cookieToken) {
      logger.warn('CSRF tokens missing', { header: !!headerToken, cookie: !!cookieToken });
      return false;
    }

    const client = await getRedisClient();
    if (!client) {
      logger.warn('No Redis for CSRF, fallback to header==cookie');
      return headerToken === cookieToken;
    }

    const storedToken = await client.get(`csrf:${userId || ip}`);
    if (!storedToken) {
      logger.warn('CSRF not in Redis');
      return false;
    }

    if (headerToken.length !== cookieToken.length || cookieToken.length !== storedToken.length) {
      logger.warn('CSRF length mismatch', {
        headerLen: headerToken.length,
        cookieLen: cookieToken.length,
        storedLen: storedToken.length,
      });
      return false;
    }

    const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
                  crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken));
    if (!valid) logger.warn('CSRF mismatch');
    return valid;
  } catch (err) {
    logger.error('CSRF check error', { err: err.message });
    return false;
  }
}

// function mask(value, keep = 6) {
//   if (!value) return '';
//   return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
// }

async function hashApiKey(apiKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(apiKey, salt, 64);
  return { api_key_hash: derived.toString('hex'), api_key_salt: salt };
}

function securityHeaders(csrfToken = null) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN || (isProd ? '.xynapseai.net' : undefined);
  const headers = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': isProd ? 'max-age=63072000; includeSubDomains; preload' : '',
  };
  if (csrfToken) {
    headers['Set-Cookie'] = cookie.serialize('next-auth.csrf-token', csrfToken, {
      httpOnly: false,  // Allow client read for double-submit
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      domain: cookieDomain,
      maxAge: 15 * 60,
      path: '/',
    });
  }
  return headers;
}

const getSchema = z.object({ uid: z.string().max(100) });
const postSchema = z.object({
  id: z.string().max(100),
  email: z.string().email(),
  profilePicture: z.string().url().optional(),
  googleId: z.string().max(100).optional(),
  googleName: z.string().max(255).optional(),
  emailVerified: z.boolean().optional(),
  walletAddress: z.string().optional(),
});

async function computeStreak(userId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const completions = await prisma.task_completions.findMany({
    where: { user_id: userId, task_id: 'daily_checkin', completed_at: { gte: thirtyDaysAgo } },
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
    } else break;
  }
  return streak;
}

async function getLast7Days(userId) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setUTCHours(23, 59, 59, 999);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const completions = await prisma.task_completions.findMany({
    where: { user_id: userId, task_id: 'daily_checkin', completed_at: { gte: sevenDaysAgo, lte: todayEnd } },
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

  let headers = {  // FIXED: Use 'let' to allow update
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    ...securityHeaders(),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;
    if (!session || !userId) {
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      return NextResponse.json({ detail: err.message }, { status: 429, headers });
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      if (process.env.NODE_ENV === 'development') {
        // FIXED: Dev lenient - proceed with new token
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('CSRF fail in dev, issuing new token but proceeding');
        }
        headers = { ...headers, ...securityHeaders(newCsrfToken) };
      } else {
        return NextResponse.json({ detail: 'Invalid CSRF. Refresh.' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    }

    let parsedParams;
    try {
      parsedParams = getSchema.parse(params);
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Invalid UID' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    const { uid } = parsedParams;

    if (uid !== session.user.id) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Access denied' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (recaptchaToken && process.env.NODE_ENV !== 'development') {
      try {
        const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        if (!recaptchaResponse.success || (recaptchaResponse.score !== undefined && recaptchaResponse.score < 0.9)) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          return NextResponse.json({ detail: 'reCAPTCHA failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score: recaptchaResponse.score });
        }
      } catch {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json({ detail: 'reCAPTCHA error' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    }

    const walletAddress = session.user.walletAddress;
    const cacheKey = walletAddress ? `user:${walletAddress}` : `user:${uid}`;
    const client = await getRedisClient();
    let cached;
    if (client) {
      try {
        cached = await client.get(cacheKey);
      } catch (err) {
        logger.warn('Cache get error', { err: err.message });
      }
    }
    if (cached) {
      return NextResponse.json(JSON.parse(cached), { headers });
    }

    const user = await withRetry(() =>
      prisma.users.findUnique({
        where: { id: uid },
        select: {
          id: true, email: true, google_id: true, profile_picture: true, google_name: true,
          email_verified: true, wallet_address: true, points: true, tweet_points: true,
          ai_points: true, task_points: true, is_creator: true, is_ai_rank: true,
          tier: true, is_premium: true, last_connected: true, twitter_handle: true,
          days_active: true, twitter_handles: { select: { profile_picture: true } },
        },
      })
    );

    if (!user) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'User not found' }, { status: 404, headers: securityHeaders(newCsrfToken) });
    }

    const streak = await computeStreak(uid);
    const last7Days = await getLast7Days(uid);

    const data = {
      success: true,
      user: {
        id: user.id, email: user.email || '', googleId: user.google_id || null,
        profilePicture: user.twitter_handles?.[0]?.profile_picture || user.profile_picture || '',
        googleName: user.google_name || '', walletAddress: user.wallet_address || null,
        emailVerified: user.email_verified || false, points: Number(user.points || 0),
        tweetPoints: Number(user.tweet_points || 0), aiPoints: Number(user.ai_points || 0),
        taskPoints: Number(user.task_points || 0), isCreator: user.is_creator || false,
        isAiRank: user.is_ai_rank || false, tier: user.tier || 'Basic',
        isPremium: user.is_premium || false, lastConnected: user.last_connected ? new Date(user.last_connected).toISOString() : null,
        twitterHandle: user.twitter_handle || null, daysActive: Number(user.days_active || 0),
        streak, last7Days,
      },
    };

    if (client) {
      try {
        await client.setEx(cacheKey, 300, JSON.stringify(serializeBigInt(data)));
      } catch (err) {
        logger.warn('Cache set error', { err: err.message });
      }
    }

    return NextResponse.json(data, { headers });
  } catch (error) {
    logger.error('Error in /api/user GET', { error: error.message, stack: error.stack });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
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

  let headers = {  // FIXED: let for update
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    ...securityHeaders(),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;
    if (!session || !userId) {
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      return NextResponse.json({ detail: err.message }, { status: 429, headers });
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      if (process.env.NODE_ENV === 'development') {
        logger.warn('CSRF fail in dev POST, issuing new but proceeding');
        headers = { ...headers, ...securityHeaders(newCsrfToken) };
      } else {
        return NextResponse.json({ detail: 'Invalid CSRF' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Missing reCAPTCHA' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    if (process.env.NODE_ENV !== 'development' && recaptchaToken) {
      try {
        const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'post_user', ip);
        if (!recaptchaResponse.success) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          return NextResponse.json({ detail: 'reCAPTCHA failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
      } catch {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json({ detail: 'reCAPTCHA error' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Invalid data' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const { id, email, profilePicture, googleId, googleName, emailVerified, walletAddress } = parsedBody;

    if (session.user.id !== id) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail: 'Unauthorized' }, { status: 401, headers: securityHeaders(newCsrfToken) });
    }

    const userData = {
      email,
      google_id: googleId || null,
      profile_picture: profilePicture || '',
      google_name: googleName || '',
      email_verified: emailVerified || false,
      wallet_address: walletAddress || null,
      connected: true,
      last_connected: new Date(),
      points: 0, tweet_points: 0, ai_points: 0, task_points: 0,
      is_creator: false, is_ai_rank: false, tier: 'Basic',
      is_plus: false, is_premium: false, twitter_handle: null,
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

    const client = await getRedisClient();
    if (client) {
      const cacheKey = updatedUser.wallet_address ? `user:${updatedUser.wallet_address}` : `user:${id}`;
      await client.del(cacheKey).catch(() => {});
    }

    newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
    headers['X-API-Key'] = plainApiKey;
    return NextResponse.json({
      success: true,
      user: serializeBigInt({
        id: updatedUser.id, email: updatedUser.email,
        profile_picture: updatedUser.profile_picture,
        google_name: updatedUser.google_name,
        wallet_address: updatedUser.wallet_address,
        email_verified: updatedUser.email_verified,
      }),
    }, { headers: { ...headers, ...securityHeaders(newCsrfToken) } });
  } catch (error) {
    logger.error('Error in /api/user POST', { error: error.message, stack: error.stack });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (redisClient && redisClient.isOpen) await redisClient.quit();
  if (prisma) await prisma.$disconnect();
});
process.on('SIGINT', async () => {
  if (redisClient && redisClient.isOpen) await redisClient.quit();
  if (prisma) await prisma.$disconnect();
});