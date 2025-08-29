import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { TwitterApi } from 'twitter-api-v2';
import { PrismaClient } from '@prisma/client';
import { verifyRecaptcha } from '@/utils/verifyRecaptcha';

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
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
  'https://api.twitter.com',
  'https://x.com',
  ...(process.env.VERCEL_ENV === 'production' ? [] : ['https://*.vercel.app']),
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/.*\.vercel\.app$/;

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info('No Origin or Referer (likely Twitter OAuth callback or SSR), allowing request');
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info('No valid Origin or Referer, allowing for Twitter OAuth callback compatibility');
    return true;
  }
  const isAllowed = allowedOrigins.some((allowed) =>
    allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(checkOrigin) : allowed === checkOrigin
  ) || vercelPreviewRegex.test(checkOrigin);
  logger.info(`Origin check: ${checkOrigin}, Allowed: ${isAllowed}`);
  return isAllowed;
}

async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 100;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid JSON body', 'Invalid action or user ID', 'Missing reCAPTCHA token'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`);
    return;
  }

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:twitter_connect:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 15 * 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

async function verifyRecaptchaWithRetry(token, action, ip, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const { score } = await verifyRecaptcha(token, action, ip);
      logger.info('reCAPTCHA verification successful', { score, action, ip });
      return { score };
    } catch (error) {
      logger.warn(`reCAPTCHA verification attempt ${i + 1} failed: ${error.message}`, { action, ip });
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
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  logger.info(`Processing Twitter connect request`, {
    ip,
    origin,
    referer,
    code: code ? '[present]' : '[missing]',
    state: state ? '[present]' : '[missing]',
  });

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || 'https://xynapseai.net',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
    'Access-Control-Allow-Credentials': 'true',
    ...securityHeaders,
  };

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: corsHeaders });
  }

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

  if (!code || !state) {
    const { url, codeVerifier, state: generatedState } = twitterClient.generateOAuth2AuthLink(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/twitter/connect`,
      { scope: ['tweet.read', 'users.read', 'follows.read', 'offline.access'] }
    );
    await withRetry(async () => {
      const redisClient = await getRedisClient();
      await redisClient.setEx(`twitter_oauth:${session.user.id}`, 600, JSON.stringify({ codeVerifier, state: generatedState.toString() }));
    });
    return NextResponse.redirect(url);
  }

  const cached = await withRetry(async () => {
    const redisClient = await getRedisClient();
    return await redisClient.get(`twitter_oauth:${session.user.id}`);
  });
  if (!cached) {
    await trackViolation(ip, 'OAuth state not found');
    logger.error('OAuth state not found', { ip, userId: session.user.id });
    return NextResponse.json({ detail: 'Invalid or expired OAuth state' }, { status: 400, headers: corsHeaders });
  }
  const { codeVerifier, state: storedState } = JSON.parse(cached);
  if (state !== storedState) {
    await trackViolation(ip, 'State mismatch');
    logger.error('State mismatch', { ip, userId: session.user.id, receivedState: state, storedState });
    return NextResponse.json({ detail: 'Invalid OAuth state' }, { status: 400, headers: corsHeaders });
  }

  try {
    const { accessToken, refreshToken, expiresIn, client: userClient } = await twitterClient.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/twitter/connect`,
    });

    const twitterUser = await userClient.v2.me({ 'user.fields': ['username'] });
    const twitterHandle = twitterUser.data.username;

    await withRetry(async () => {
      await prisma.twitter_handles.upsert({
        where: { user_id: session.user.id },
        update: {
          twitter_handle: twitterHandle,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: new Date(Date.now() + expiresIn * 1000),
          updated_at: new Date(),
        },
        create: {
          user_id: session.user.id,
          twitter_handle: twitterHandle,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: new Date(Date.now() + expiresIn * 1000),
          created_at: new Date(),
        },
      });
    });

    await withRetry(async () => {
      await prisma.users.update({
        where: { id: session.user.id },
        data: { twitter_handle: twitterHandle },
      });
    });

    await withRetry(async () => {
      const redisClient = await getRedisClient();
      await Promise.all([
        redisClient.del(`twitter_oauth:${session.user.id}`),
        redisClient.del(`user:${session.user.id}`),
        redisClient.del(`connect-data:${session.user.id}`),
      ]);
    });
    logger.info('Twitter account connected successfully', { userId: session.user.id, twitterHandle, ip });

    const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?twitterConnected=true`);
    response.headers.set('X-Clear-IndexedDB', 'true');
    Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  } catch (error) {
    await trackViolation(ip, `Error connecting Twitter: ${error.message}`);
    logger.error('Error connecting Twitter account', { error: error.message, userId: session.user.id, ip });
    return NextResponse.json({ detail: `Error connecting Twitter: ${error.message}` }, { status: 500, headers: corsHeaders });
  } finally {
    await prisma.$disconnect();
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`POST Request to /api/twitter/connect from IP ${ip}`, { origin, referer });

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || 'https://xynapseai.net',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
    'Access-Control-Allow-Credentials': 'true',
    ...securityHeaders,
  };

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: corsHeaders });
  }

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
  logger.info(`CSRF Token: ${csrfToken}, Session CSRF: ${session.csrfToken}`);
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

  if (body.action !== 'disconnect' || body.uid !== session.user.id) {
    await trackViolation(ip, 'Invalid action or user ID');
    logger.warn(`Invalid action or user ID`, { ip, action: body.action, uid: body.uid });
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400, headers: corsHeaders });
  }

  const recaptchaToken = body.recaptchaToken;
  if (process.env.NODE_ENV !== 'development' && !recaptchaToken) {
    await trackViolation(ip, 'Missing reCAPTCHA token');
    logger.error('Missing reCAPTCHA token', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token' }, { status: 400, headers: corsHeaders });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      logger.info('Attempting reCAPTCHA verification', { token: recaptchaToken.substring(0, 8) + '...', action: 'disconnect_twitter', ip });
      await verifyRecaptchaWithRetry(recaptchaToken, 'disconnect_twitter', ip);
    } catch (error) {
      await trackViolation(ip, `reCAPTCHA verification failed: ${error.message}`);
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip, stack: error.stack });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403, headers: corsHeaders });
    }
  }

  try {
    await withRetry(async () => {
      await prisma.$transaction([
        prisma.twitter_handles.delete({ where: { user_id: session.user.id } }),
        prisma.users.update({
          where: { id: session.user.id },
          data: { twitter_handle: null },
        }),
      ]);
    });
    logger.info('Database operations successful', { userId: session.user.id });

    await withRetry(async () => {
      const redisClient = await getRedisClient();
      await Promise.all([
        redisClient.del(`user:${session.user.id}`),
        redisClient.del(`connect-data:${session.user.id}`),
      ]);
    });
    logger.info('Twitter account disconnected and Redis caches cleared', { userId: session.user.id, ip });
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    await trackViolation(ip, `Error disconnecting Twitter: ${error.message}`);
    logger.error(`Error disconnecting Twitter: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Error disconnecting Twitter: ${error.message}` }, { status: 500, headers: corsHeaders });
  } finally {
    await prisma.$disconnect();
  }
}