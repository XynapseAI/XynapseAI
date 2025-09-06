// app/api/twitter/connect/route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { TwitterApi } from 'twitter-api-v2';
import { PrismaClient } from '@prisma/client';
import { verifyRecaptcha } from '@/utils/verifyRecaptcha';
import { AES } from 'crypto-js';

const prisma = new PrismaClient();
let redisClient;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
    await redisClient.connect();
    logger.info('Redis connected');
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

const twitterClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET,
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
  'https://api.twitter.com',
  'https://x.com',
].filter((v, i, a) => a.indexOf(v) === i);

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function sanitizeInput(input, maxLength = 512) {
  if (typeof input !== 'string') return '';
  return input.substring(0, maxLength);
}

async function isAllowedOrigin(origin, referer, pathname) {
  logger.info('Checking origin', { origin, referer, pathname, allowedOrigins });

  try {
    if (pathname.includes('/api/twitter/connect') && referer?.startsWith('https://api.twitter.com/')) {
      logger.info('Allowing Twitter OAuth callback', { referer });
      return true;
    }

    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        await trackViolation('unknown', 'Non-HTTPS origin in production');
        return false;
      }
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      await trackViolation('unknown', 'Invalid origin');
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        await trackViolation('unknown', 'Non-HTTPS referer in production');
        return false;
      }
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      await trackViolation('unknown', 'Invalid referer');
      return false;
    }

    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    if (!origin && process.env.NODE_ENV === 'production') {
      logger.error('Null origin blocked in production', { pathname });
      await trackViolation('unknown', 'Null origin in production');
      return false;
    }

    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }

    logger.error('Invalid origin or referer', { origin, referer });
    await trackViolation('unknown', 'Invalid origin or referer');
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, origin, referer, pathname });
    await trackViolation('unknown', 'Error validating origin');
    return false;
  }
}

async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${sanitizeInput(ip)}`, durationSeconds, 'banned');
  logger.info('IP banned', { ip, durationSeconds });
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${sanitizeInput(ip)}`);
  if (isBanned) {
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${sanitizeInput(ip)}`;
  const maxViolations = 50;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid JSON body', 'Invalid action or user ID', 'Missing reCAPTCHA token'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`);
    return;
  }

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    logger.error(`IP banned: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:twitter_connect:${sanitizeInput(ip)}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 15 * 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 50 : 10;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
}

async function verifyRecaptchaWithRetry(token, action, ip, retries = 2) {
  token = sanitizeInput(token, 512);
  for (let i = 0; i < retries; i++) {
    try {
      const { score } = await verifyRecaptcha(token, action, ip);
      logger.info('reCAPTCHA verification successful', { score, action, ip });
      return { score };
    } catch (error) {
      logger.warn(`reCAPTCHA attempt ${i + 1} failed: ${error.message}`, { action, ip });
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function withRetry(fn, retries = 2, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Operation failed, retrying after ${delay}ms`, { attempt: i + 1, error: err.message });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  logger.info(`Processing Twitter connect GET request`, {
    ip,
    origin,
    referer,
    code: code ? '[present]' : '[missing]',
    state: state ? '[present]' : '[missing]',
  });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders });
  }

  const corsHeaders = {
    'Content-Type': 'application/json',
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    ...securityHeaders,
  };

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    logger.error(`Rate limit or IP ban error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429, headers: corsHeaders });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    await trackViolation(ip, 'Session not authenticated');
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers: corsHeaders });
  }

  const sanitizedUserId = sanitizeInput(session.user.id);

  if (!code || !state) {
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/twitter/connect`;
    const { url, codeVerifier, state: generatedState } = twitterClient.generateOAuth2AuthLink(
      redirectUri,
      { scope: ['tweet.read', 'users.read', 'follows.read', 'offline.access'] }
    );
    await withRetry(async () => {
      const redisClient = await getRedisClient();
      await redisClient.setEx(`twitter_oauth:${sanitizedUserId}`, 600, JSON.stringify({ codeVerifier, state: generatedState.toString() }));
    });
    return NextResponse.redirect(url);
  }

  const cached = await withRetry(async () => {
    const redisClient = await getRedisClient();
    return await redisClient.get(`twitter_oauth:${sanitizedUserId}`);
  });
  if (!cached) {
    await trackViolation(ip, 'OAuth state not found');
    logger.error('OAuth state not found', { ip, userId: sanitizedUserId });
    return NextResponse.json({ detail: 'Invalid or expired OAuth state' }, { status: 400, headers: corsHeaders });
  }
  const { codeVerifier, state: storedState } = JSON.parse(cached);
  if (sanitizeInput(state, 512) !== storedState) {
    await trackViolation(ip, 'State mismatch');
    logger.error('State mismatch', { ip, userId: sanitizedUserId });
    return NextResponse.json({ detail: 'Invalid OAuth state' }, { status: 400, headers: corsHeaders });
  }

  try {
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/twitter/connect`;
    const { accessToken, refreshToken, expiresIn, client: userClient } = await twitterClient.loginWithOAuth2({
      code: sanitizeInput(code, 512),
      codeVerifier,
      redirectUri,
    });

    const twitterUser = await userClient.v2.me({ 'user.fields': ['username', 'profile_image_url'] });
    const twitterHandle = twitterUser.data.username;
    const twitterProfilePicture = twitterUser.data.profile_image_url;

    if (!process.env.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY environment variable is missing');
    }

    await withRetry(async () => {
      await prisma.twitter_handles.upsert({
        where: { user_id: sanitizedUserId },
        update: {
          twitter_handle: twitterHandle,
          profile_picture: twitterProfilePicture,
          access_token: AES.encrypt(accessToken, process.env.ENCRYPTION_KEY).toString(),
          refresh_token: AES.encrypt(refreshToken, process.env.ENCRYPTION_KEY).toString(),
          token_expires_at: new Date(Date.now() + expiresIn * 1000),
          updated_at: new Date(),
        },
        create: {
          user_id: sanitizedUserId,
          twitter_handle: twitterHandle,
          profile_picture: twitterProfilePicture,
          access_token: AES.encrypt(accessToken, process.env.ENCRYPTION_KEY).toString(),
          refresh_token: AES.encrypt(refreshToken, process.env.ENCRYPTION_KEY).toString(),
          token_expires_at: new Date(Date.now() + expiresIn * 1000),
          created_at: new Date(),
        },
      });
    });

    await withRetry(async () => {
      await prisma.users.update({
        where: { id: sanitizedUserId },
        data: {
          twitter_handle: twitterHandle,
          profile_picture: twitterProfilePicture || userData.profile_picture || '',
        },
      });
    });

    await withRetry(async () => {
      const redisClient = await getRedisClient();
      await Promise.all([
        redisClient.del(`twitter_oauth:${sanitizedUserId}`),
        redisClient.del(`user:${sanitizedUserId}`),
        redisClient.del(`connect-data:${sanitizedUserId}`),
      ]);
    });

    logger.info('Twitter account connected successfully', { userId: sanitizedUserId, twitterHandle, ip });
    const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?twitterConnected=true`);
    response.headers.set('X-Clear-IndexedDB', 'true');
    Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  } catch (error) {
    await trackViolation(ip, `Error connecting Twitter: ${error.message}`);
    logger.error('Error connecting Twitter', { error: error.message, userId: sanitizedUserId, ip });
    return NextResponse.json({ detail: `Error connecting Twitter: ${error.message}` }, { status: 500, headers: corsHeaders });
  } finally {
    await prisma.$disconnect();
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info(`POST Request to /api/twitter/connect from IP ${ip}`, { origin, referer });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders });
  }

  const corsHeaders = {
    'Content-Type': 'application/json',
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    ...securityHeaders,
  };

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    logger.error(`Rate limit or IP ban error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429, headers: corsHeaders });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    await trackViolation(ip, 'Session not authenticated');
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers: corsHeaders });
  }

  const csrfToken = request.headers.get('x-csrf-token');
  if (process.env.NODE_ENV !== 'development' && (!csrfToken || csrfToken !== session.csrfToken)) {
    await trackViolation(ip, 'Invalid CSRF token');
    logger.warn('Invalid CSRF token', { ip });
    return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    await trackViolation(ip, 'Invalid JSON body');
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  const { action, recaptchaToken } = body;
  const sanitizedUserId = sanitizeInput(session.user.id);

  if (action !== 'disconnect' || body.uid !== session.user.id) {
    await trackViolation(ip, 'Invalid action or user ID');
    logger.warn(`Invalid action or user ID`, { ip, action, uid: body.uid });
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400, headers: corsHeaders });
  }

  if (process.env.NODE_ENV !== 'development' && !recaptchaToken) {
    await trackViolation(ip, 'Missing reCAPTCHA token');
    logger.error('Missing reCAPTCHA token', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token' }, { status: 400, headers: corsHeaders });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      await verifyRecaptchaWithRetry(recaptchaToken, 'disconnect_twitter', ip);
    } catch (error) {
      await trackViolation(ip, `reCAPTCHA verification failed: ${error.message}`);
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403, headers: corsHeaders });
    }
  }

  try {
    await withRetry(async () => {
      await prisma.$transaction([
        prisma.twitter_handles.delete({ where: { user_id: sanitizedUserId } }),
        prisma.users.update({
          where: { id: sanitizedUserId },
          data: { twitter_handle: null, profile_picture: '' }, // Reset profile picture on disconnect
        }),
      ]);
    });

    await withRetry(async () => {
      const redisClient = await getRedisClient();
      await Promise.all([
        redisClient.del(`user:${sanitizedUserId}`),
        redisClient.del(`connect-data:${sanitizedUserId}`),
      ]);
    });

    logger.info('Twitter account disconnected', { userId: sanitizedUserId, ip });
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    await trackViolation(ip, `Error disconnecting Twitter: ${error.message}`);
    logger.error(`Error disconnecting Twitter: ${error.message}`, { ip });
    return NextResponse.json({ detail: `Error disconnecting Twitter: ${error.message}` }, { status: 500, headers: corsHeaders });
  } finally {
    await prisma.$disconnect();
  }
}