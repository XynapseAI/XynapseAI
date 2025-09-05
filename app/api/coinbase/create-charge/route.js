import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { logger } from '../../../../utils/serverLogger';
import { requireAuth } from '../../middleware/auth';
import cookie from 'cookie';
import crypto from 'crypto';
import { z } from 'zod';

const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: { db: { url: process.env.DATABASE_URL } },
});

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    const redisUrl = process.env.NODE_ENV === 'production'
      ? process.env.REDIS_URL || 'rediss://localhost:6379' // Use rediss:// for TLS in production
      : process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    redisClient.on('connect', () => logger.info('Redis Client Connected'));
    await redisClient.connect();
    logger.info('Redis connected (initial)');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

async function isAllowedOrigin(origin, referer, ip, pathname) {
  try {
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked non-HTTPS origin in production', { ip, origin });
        await trackViolation(ip, 'Non-HTTPS origin in production');
        return false;
      }
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin allowed', { ip, origin });
        return true;
      }
      await trackViolation(ip, 'Invalid origin');
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked non-HTTPS referer in production', { ip, referer });
        await trackViolation(ip, 'Non-HTTPS referer in production');
        return false;
      }
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin allowed', { ip, referer, refOrigin });
        return true;
      }
      await trackViolation(ip, 'Invalid referer');
      return false;
    }

    if (!origin && !referer && process.env.NODE_ENV === 'development') {
      logger.info('Allowing internal/SSR request in development', { ip });
      return true;
    }

    logger.error('Blocked null origin in production', { ip, pathname });
    await trackViolation(ip, 'Null origin in production');
    return false;
  } catch (err) {
    logger.error('Error validating origin', { error: err.message, ip, origin, referer });
    await trackViolation(ip, 'Error validating origin');
    return false;
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

async function checkRateLimit(ip, userId = null) {
  const client = await getRedisClient();
  const windowSeconds = 15 * 60;
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 500 : 30;
  const userMax = process.env.NODE_ENV === 'development' ? 300 : 20;

  const ipCount = Number(await client.incr(ipKey));
  if (ipCount === 1) await client.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    throw new Error('Too many requests from this IP');
  }

  if (userKey) {
    const userCount = Number(await client.incr(userKey));
    if (userCount === 1) await client.expire(userKey, windowSeconds);
    if (userCount > userMax) {
      throw new Error('Too many requests for this user');
    }
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

  if (process.env.NODE_ENV === 'development' && headerToken === 'dev-csrf' && cookieToken === 'dev-csrf') {
    logger.info('Development CSRF bypass used');
    return true;
  }

  if (!headerToken || !cookieToken) {
    logger.warn('CSRF tokens missing', { headerProvided: !!headerToken, cookieProvided: !!cookieToken });
    return false;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));

  if (!valid) {
    logger.warn('CSRF token mismatch');
    return false;
  }
  return valid;
}

function securityHeaders(origin) {
  const csp = "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  const headers = {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF-Token';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

const postSchema = z.object({
  userId: z.string().max(100),
  plan: z.enum(['basic', 'premium', 'pro']),
});

const planPricing = {
  basic: { amount: 5.00, currency: 'USD' },
  premium: { amount: 10.00, currency: 'USD' },
  pro: { amount: 20.00, currency: 'USD' },
};

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const pathname = new URL(req.url).pathname;

  logger.info('Received create-charge request', { ip, origin, pathname });

  try {
    if (!(await isAllowedOrigin(origin, referer, ip, pathname))) {
      await trackViolation(ip, 'CORS blocked');
      return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
    }

    await checkRateLimit(ip);

    const session = await requireAuth(req);
    if (!(session instanceof Object)) {
      await trackViolation(ip, 'Unauthenticated request');
      logger.warn('Session validation failed', { ip });
      return session;
    }

    const csrfOk = await checkDoubleSubmitCSRF(req);
    if (!csrfOk) {
      await trackViolation(ip, 'Invalid CSRF token');
      return NextResponse.json({ detail: 'Invalid CSRF check' }, { status: 403, headers: securityHeaders(origin) });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      await trackViolation(ip, 'Invalid JSON body');
      logger.warn('Invalid JSON body', { ip });
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: securityHeaders(origin) });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch (err) {
      await trackViolation(ip, 'Invalid input data');
      logger.warn('POST validation failed', { ip, errors: err.errors });
      return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400, headers: securityHeaders(origin) });
    }

    const { userId, plan } = parsedBody;
    if (!session.user || !session.user.id || userId !== session.user.id) {
      await trackViolation(ip, 'User ID mismatch');
      logger.warn('User ID mismatch', { sessionUserId: session.user?.id ? 'provided' : 'missing' });
      return NextResponse.json({ detail: 'Unauthorized user' }, { status: 401, headers: securityHeaders(origin) });
    }

    const userExists = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!userExists) {
      await trackViolation(ip, 'User not found');
      logger.warn('User not found', { ip });
      return NextResponse.json({ detail: 'User not found' }, { status: 404, headers: securityHeaders(origin) });
    }

    if (!process.env.COINBASE_COMMERCE_API_KEY) {
      logger.error('COINBASE_COMMERCE_API_KEY is not set');
      return NextResponse.json({ detail: 'Server configuration error: API key missing' }, { status: 500, headers: securityHeaders(origin) });
    }

    const { amount, currency } = planPricing[plan];
    const chargeData = {
      name: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan Upgrade`,
      description: `Upgrade to ${plan} plan for user`,
      local_price: { amount: amount.toFixed(2), currency },
      metadata: { userId, plan },
      pricing_type: 'fixed_price',
    };

    logger.info('Sending request to Coinbase API', { plan, amount: amount.toFixed(2), currency });

    const response = await fetch('https://api.commerce.coinbase.com/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CC-Api-Key': process.env.COINBASE_COMMERCE_API_KEY,
        'X-CC-Version': '2018-03-22',
      },
      body: JSON.stringify(chargeData),
    });

    const charge = await response.json();
    if (!response.ok) {
      logger.error('Coinbase API error', { status: response.status, message: charge.error?.message || 'Unknown error' });
      return NextResponse.json({ detail: `Coinbase API error: ${charge.error?.message || 'Failed to create charge'}` }, { status: response.status, headers: securityHeaders(origin) });
    }

    const chargeId = charge.data.id;
    const chargeCode = charge.data.code;
    const hostedUrl = charge.data.hosted_url;

    logger.info('Coinbase charge created', { chargeId });

    await prisma.payment.create({
      data: {
        userId,
        chargeId,
        chargeCode,
        amount: parseFloat(amount.toFixed(2)),
        currency,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(
      { success: true, hostedUrl, chargeId, chargeCode },
      { headers: securityHeaders(origin) }
    );
  } catch (error) {
    logger.error('Error creating Coinbase charge', { error: error.message });
    return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500, headers: securityHeaders(origin) });
  } finally {
    await prisma.$disconnect();
  }
}

export async function OPTIONS() {
  const headers = securityHeaders(process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net');
  return new NextResponse(null, { status: 204, headers });
}

process.on('SIGTERM', async () => {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGTERM');
  }
});

process.on('SIGINT', async () => {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGINT');
  }
});