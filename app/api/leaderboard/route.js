// app/api/leaderboard/route.js
// app\api\leaderboard\route.js
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/utils/serverLogger';
import { createClient } from 'redis';
import { PrismaClient } from '@prisma/client';
import { verifyRecaptcha } from '@/utils/verifyRecaptcha';
import cookie from 'cookie';  // Thêm import này
import crypto from 'crypto';

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

async function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

const securityHeadersBase = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function securityHeaders(csrfToken = null) {
  const headers = { ...securityHeadersBase };
  if (csrfToken) {
    headers['Set-Cookie'] = cookie.serialize('next-auth.csrf-token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',  // For Base App cross-origin
      maxAge: 15 * 60,
      path: '/',
    });
  }
  return headers;
}

function sanitizeInput(input, maxLength = 2048) {
  if (typeof input !== 'string') return '';
  return input.substring(0, maxLength);
}

async function isAllowedOrigin(origin, referer, pathname) {
  logger.info('Checking origin', { origin, referer, pathname, allowedOrigins });

  try {
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        return false;
      }
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        return false;
      }
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      return false;
    }

    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    if (!origin && process.env.NODE_ENV === 'production') {
      logger.error('Null origin blocked in production', { origin });
      return false;
    }

    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }

    logger.error('Invalid origin or referer', { origin, referer });
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, origin, referer, pathname });
    return false;
  }
}

// Di chuyển checkRateLimit sau CSRF để fail không count
async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:leaderboard:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 15 * 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 50 : 10;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
}

// Thêm functions cho double-submit CSRF (copy từ /api/user)
function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  try {
    return cookie.parse(raw);
  } catch {
    return {};
  }
}

async function checkDoubleSubmitCSRF(request, ip, userId) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['next-auth.csrf-token'] || '';  // Fixed: correct cookie name

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

  const client = await getRedisClient();
  const storedToken = await client.get(`csrf:${userId}`);
  if (!storedToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token not found in Redis', { key: `csrf:${userId}` });
    }
    return false;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
                crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken));
  if (!valid && process.env.NODE_ENV !== 'production') {
    logger.warn('CSRF token mismatch', {
      headerToken: headerToken.slice(0, 6) + '••••',
      cookieToken: cookieToken.slice(0, 6) + '••••',
      storedToken: storedToken.slice(0, 6) + '••••',
    });
  }
  return valid;
}

async function verifyRecaptchaWithRetry(token, action, ip, retries = 2) {
  token = sanitizeInput(token, 2048);
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

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  logger.info(`Request to /api/leaderboard from IP ${ip}`, { origin, referer });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const corsHeaders = {
    'Content-Type': 'application/json',
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    ...securityHeadersBase,
  };

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers: corsHeaders });
  }

  // Check CSRF trước rate limit
  let newCsrfToken;
  if (!(await checkDoubleSubmitCSRF(request, ip, session.user.id))) {
    newCsrfToken = await generateCSRFToken();
    const client = await getRedisClient();
    await client.setEx(`csrf:${session.user.id}`, 15 * 60, newCsrfToken);
    logger.warn('Invalid CSRF token, new token issued', { ip });
    return NextResponse.json({ detail: 'Invalid CSRF check. Please refresh.' }, { 
      status: 403, 
      headers: { ...corsHeaders, ...securityHeaders(newCsrfToken) }  // Fixed: now securityHeaders accepts param
    });
  }

  // Bây giờ mới check rate limit (chỉ count valid request)
  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429, headers: corsHeaders });
  }

  // reCAPTCHA optional (chỉ check nếu gửi token)
  if (process.env.NODE_ENV !== 'development') {
    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (recaptchaToken) {
      try {
        const { score } = await verifyRecaptchaWithRetry(recaptchaToken, 'get_leaderboard', ip);
        if (score < 0.5) {  // Threshold thấp cho read
          return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: corsHeaders });
        }
      } catch (error) {
        logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
        return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403, headers: corsHeaders });
      }
    }
    // Không gửi token → allow (như comment: Removed reCAPTCHA for faster load)
  }

  try {
    const redisClient = await getRedisClient();
    const cacheKey = `leaderboard`;
    let cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for leaderboard`, { ip });
      const data = JSON.parse(cached);
      return NextResponse.json(data, { headers: corsHeaders });
    }

    // Fetch top 50 users by points (descending)
    const rankings = await prisma.users.findMany({
      orderBy: { points: 'desc' },
      take: 50,
      select: {
        id: true,
        google_name: true,
        twitter_handle: true,
        profile_picture: true,
        points: true,
      },
    });

    // Format rankings
    const formattedRankings = rankings.map((user) => ({
      id: user.id,
      googleName: user.google_name || '',
      twitterHandle: user.twitter_handle || null,
      profilePicture: user.profile_picture || '',
      points: Number(user.points || 0),
    }));

    const data = { success: true, rankings: formattedRankings };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(data)); 
    logger.info('Fetched and cached leaderboard successfully', { ip });
    return NextResponse.json(data, { headers: corsHeaders });
  } catch (error) {
    logger.error('Error fetching leaderboard', { message: error.message, stack: error.stack, ip });
    return NextResponse.json({ detail: `Error fetching leaderboard: ${error.message}` }, { status: 500, headers: corsHeaders });
  } finally {
    await prisma.$disconnect();
  }
}