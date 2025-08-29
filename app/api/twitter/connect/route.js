// app/api/twitter/connect/route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { TwitterApi } from 'twitter-api-v2';
import { PrismaClient } from '@prisma/client';
import { verifyRecaptcha } from '@/utils/verifyRecaptcha'; // Đảm bảo import đúng

const prisma = new PrismaClient();
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
if (!redisClient.isOpen) await redisClient.connect();

const twitterClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET,
});

function isAllowedOrigin(origin, referer) {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
    ...(process.env.VERCEL_ENV === 'production' ? [] : ['https://*.vercel.app']),
  ];
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info('No Origin or Referer, allowing request for SSR');
    return true;
  }
  const isAllowed = allowedOrigins.some((allowed) =>
    allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(checkOrigin) : allowed === checkOrigin
  );
  logger.info(`Origin check: ${checkOrigin}, Allowed: ${isAllowed}`);
  return isAllowed;
}

async function checkRateLimit(ip) {
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

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  if (!code || !state) {
    // Step 1: Generate OAuth2 URL
    const { url, codeVerifier, state: generatedState } = twitterClient.generateOAuth2AuthLink(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/twitter/connect`,
      { scope: ['tweet.read', 'users.read', 'follows.read', 'offline.access'] }
    );
    await redisClient.setEx(`twitter_oauth:${session.user.id}`, 600, JSON.stringify({ codeVerifier, state: generatedState.toString() }));
    return NextResponse.redirect(url);
  }

  // Step 2: Handle OAuth2 callback
  const cached = await redisClient.get(`twitter_oauth:${session.user.id}`);
  if (!cached) {
    logger.error('OAuth state not found', { ip, userId: session.user.id });
    return NextResponse.json({ detail: 'Invalid or expired OAuth state' }, { status: 400 });
  }
  const { codeVerifier, state: storedState } = JSON.parse(cached);
  if (state !== storedState) {
    logger.error('State mismatch', { ip, userId: session.user.id, receivedState: state, storedState });
    return NextResponse.json({ detail: 'Invalid OAuth state' }, { status: 400 });
  }

  try {
    const { accessToken, refreshToken, expiresIn, client: userClient } = await twitterClient.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/twitter/connect`,
    });

    const twitterUser = await userClient.v2.me({ 'user.fields': ['username'] });
    const twitterHandle = twitterUser.data.username;

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

    await prisma.users.update({
      where: { id: session.user.id },
      data: { twitter_handle: twitterHandle },
    });

    // Xóa tất cả cache Redis liên quan
    await Promise.all([
      redisClient.del(`twitter_oauth:${session.user.id}`),
      redisClient.del(`user:${session.user.id}`),
      redisClient.del(`connect-data:${session.user.id}`),
    ]);
    logger.info('Twitter account connected successfully', { userId: session.user.id, twitterHandle, ip });

    // Thêm header để thông báo client xóa cache IndexedDB
    const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?twitterConnected=true`);
    response.headers.set('X-Clear-IndexedDB', 'true');
    return response;
  } catch (error) {
    logger.error('Error connecting Twitter account', { error: error.message, userId: session.user.id, ip });
    return NextResponse.json({ detail: `Error connecting Twitter: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

async function checkRedisConnection() {
  try {
    await redisClient.ping();
    logger.info('Redis connection successful');
  } catch (err) {
    logger.error('Redis connection failed', { error: err.message });
    throw new Error('Redis connection failed');
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`POST Request to /api/twitter/connect from IP ${ip}`, { origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRedisConnection();
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit or Redis error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  const csrfToken = request.headers.get('x-csrf-token');
  logger.info(`CSRF Token: ${csrfToken}, Session CSRF: ${session.csrfToken}`);
  if (process.env.NODE_ENV !== 'development' && (!csrfToken || csrfToken !== session.csrfToken)) {
    logger.warn('Invalid CSRF token', { ip });
    return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.action !== 'disconnect' || body.uid !== session.user.id) {
    logger.warn(`Invalid action or user ID`, { ip, action: body.action, uid: body.uid });
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400 });
  }

  const recaptchaToken = body.recaptchaToken;
  if (process.env.NODE_ENV !== 'development' && !recaptchaToken) {
    logger.error('Missing reCAPTCHA token', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token' }, { status: 400 });
  }

  if (process.env.NODE_ENV !== 'development') {
    try {
      logger.info('Attempting reCAPTCHA verification', { token: recaptchaToken.substring(0, 8) + '...' });
      const { score } = await verifyRecaptcha(recaptchaToken, 'disconnect_twitter', ip);
      logger.info('reCAPTCHA verification successful for disconnect_twitter', { score, ip });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip, stack: error.stack });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403 });
    }
  }

  try {
    await prisma.$transaction([
      prisma.twitter_handles.delete({ where: { user_id: session.user.id } }),
      prisma.users.update({
        where: { id: session.user.id },
        data: { twitter_handle: null },
      }),
    ]);
    logger.info('Database operations successful', { userId: session.user.id });
    await Promise.all([
      redisClient.del(`user:${session.user.id}`),
      redisClient.del(`connect-data:${session.user.id}`),
    ]);
    logger.info('Twitter account disconnected and Redis caches cleared', { userId: session.user.id, ip });
    return NextResponse.json({ success: true }, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    logger.error(`Error disconnecting Twitter: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Error disconnecting Twitter: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}