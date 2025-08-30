import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
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

// Redis client
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
await redisClient.connect();

// ---------- Helpers ----------
async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Database connection failed, retrying...`, { attempt: i + 1 });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function checkRateLimit(ip, userId) {
  const windowSeconds = 15 * 60; // 15 minutes
  const ipKey = `rate:ip:${ip}:generate-api-key`;
  const userKey = userId ? `rate:user:${userId}:generate-api-key` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 10 : 5; // Hạn chế số lần tạo API key
  const userMax = process.env.NODE_ENV === 'development' ? 5 : 3;

  const ipCount = Number(await redisClient.incr(ipKey));
  if (ipCount === 1) await redisClient.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    throw new Error('Too many API key generation requests from this IP');
  }

  if (userKey) {
    const uCount = Number(await redisClient.incr(userKey));
    if (uCount === 1) await redisClient.expire(userKey, windowSeconds);
    if (uCount > userMax) {
      throw new Error('Too many API key generation requests for this user');
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

  logger.info('Checking origin', { origin, referer });

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
      return false;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        return false;
      }
      if (
        configured.includes(refOrigin) ||
        refOrigin.endsWith('xynapseai.net') ||
        refOrigin.endsWith('.vercel.app')
      ) {
        return true;
      }
    }
    if (!origin && !referer) {
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') return true;
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message });
    return false;
  }
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  try {
    return cookie.parse(raw);
  } catch (err) {
    return {};
  }
}

async function checkDoubleSubmitCSRF(request) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['csrf_token'] || '';
  if (
    process.env.NODE_ENV === 'development' &&
    headerToken === 'dev-csrf' &&
    cookieToken === 'dev-csrf'
  ) {
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
  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
  if (!valid) {
    logger.warn('CSRF token mismatch');
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

function securityHeaders(origin) {
  const csp =
    "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
}

// ---------- POST handler ----------
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info('POST /api/generate-api-key requested', { ip, origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.warn('CORS origin not allowed for POST', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    // Rate limiting
    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json({ detail: err.message }, { status: 429 });
    }

    // Authentication check
    if (!session || !session.user?.id) {
      logger.warn('Unauthenticated POST request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }

    // CSRF check
    const csrfOk = await checkDoubleSubmitCSRF(request);
    if (!csrfOk) {
      return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403 });
    }

    // reCAPTCHA verification
    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      logger.warn('Missing reCAPTCHA token header');
      return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400 });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'generate_api_key', ip);
        logger.info('reCAPTCHA OK', { ip, score });
      } catch (err) {
        logger.warn('reCAPTCHA failed', { ip, reason: err?.message });
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403 });
      }
    } else if (recaptchaToken === 'development-token') {
      logger.info('Development reCAPTCHA bypass used');
    }

    try {
      // Generate new API key
      const plainApiKey = crypto.randomBytes(32).toString('hex');
      const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);

      // Update user with new API key hash and salt
      await withRetry(() =>
        prisma.users.update({
          where: { id: userId },
          data: {
            api_key_hash,
            api_key_salt,
            updated_at: new Date(),
          },
        })
      );

      // Invalidate cache
      try {
        await redisClient.del(`user:${userId}`);
      } catch (err) {
        logger.warn('Failed to clear cache for user', { id: userId, err: err?.message });
      }

      logger.info('API key generated successfully', { userId: mask(userId) });
      const headers = {
        ...securityHeaders(origin),
        'Access-Control-Allow-Origin':
          origin ||
          (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      };

      return NextResponse.json(
        {
          success: true,
          apiKey: plainApiKey,
          message: 'Please store this API key securely. It will not be shown again.',
        },
        { headers }
      );
    } catch (err) {
      logger.error('Error processing POST /api/generate-api-key', { err: err?.message });
      return NextResponse.json({ detail: 'Server error' }, { status: 500 });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    logger.error('Unexpected error in POST', { err: err?.message });
    return NextResponse.json({ detail: 'Server error' }, { status: 500 });
  }
}