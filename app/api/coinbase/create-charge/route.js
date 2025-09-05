import { NextResponse } from 'next/server';
import { cookies } from 'next/headers'; // Đảm bảo import đúng
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { logger } from '../../../../utils/serverLogger';
import { requireAuth } from '../../middleware/auth';

// Initialize Prisma client
const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Redis client management
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message, stack: err.stack }));
    redisClient.on('connect', () => logger.info('Redis Client Connected'));
    try {
      await redisClient.connect();
      logger.info('Redis connected (initial)');
    } catch (err) {
      logger.error('Redis initial connect failed', { error: err.message, stack: err.stack });
      throw new Error('Redis connection failed');
    }
  } else if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
      logger.info('Redis reconnected');
    } catch (err) {
      logger.error('Redis reconnect failed', { error: err.message, stack: err.stack });
      throw new Error('Redis connection failed');
    }
  }
  return redisClient;
}

// List of allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:3000/api',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

// Function to check Origin/Referer
function isAllowedOrigin(origin, referer) {
  try {
    if (origin && allowedOrigins.includes(origin)) return true;
    if (origin) {
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app')) return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) return true;
      const hostname = new URL(refOrigin).hostname;
      if (hostname.endsWith('.vercel.app')) return true;
    }
    if (!origin && !referer) return true;
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }
    logger.error('CORS blocked', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, origin, referer });
    return false;
  }
}

// Rate limiting
async function checkRateLimit(ip) {
  try {
    const client = await getRedisClient();
    const key = `rate_limit:coinbase_create:${ip}`;
    const requests = Number(await client.get(key)) || 0;
    const windowMs = 60 * 1000;
    const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 30;
    logger.info('Rate limit check', { ip, requests, maxRequests });
    if (requests >= maxRequests) {
      throw new Error('Too many requests, please try again later.');
    }
    await client.multi()
      .incr(key)
      .expire(key, windowMs / 1000)
      .exec();
    logger.info('Rate limit updated', { ip, newCount: requests + 1 });
  } catch (err) {
    logger.error('Rate limit error', { error: err.message, stack: err.stack, ip });
    throw err;
  }
}

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  logger.info('Received create-charge request', { ip, origin, referer });

  // Kiểm tra CORS
  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403 });
  }

  // Kiểm tra rate limit
  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error('Rate limit check failed', { error: err.message, ip });
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  // Kiểm tra session
  const session = await requireAuth(req);
  if (!(session instanceof Object)) {
    logger.warn('Session validation failed', { ip });
    return session; // 401 nếu không đăng nhập
  }
  logger.info('Session data', { session: JSON.stringify(session) });

  try {
    const { userId, plan, amount, currency } = await req.json();
    logger.info('Request payload', { userId, plan, amount, currency });

    // Validate input
    if (!userId || !plan || !amount || !currency) {
      logger.error('Invalid request payload', { userId, plan, amount, currency });
      return NextResponse.json({ success: false, detail: 'Missing required fields' }, { status: 400 });
    }

    // Kiểm tra userId khớp session
    if (!session.user || !session.user.id || userId !== session.user.id) {
      logger.error('User ID mismatch or invalid session', { userId, sessionUserId: session.user?.id });
      return NextResponse.json({ success: false, detail: 'Unauthorized user' }, { status: 401 });
    }

    // Kiểm tra user tồn tại
    const userExists = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!userExists) {
      logger.error('User not found', { userId });
      return NextResponse.json({ success: false, detail: 'User not found' }, { status: 404 });
    }
    logger.info('User verified', { userId, email: userExists.email });

    // CSRF check
    const csrfToken = req.headers.get('x-csrf-token');
    let cookieCsrfToken;
    try {
      const cookieStore = await cookies(); // Đảm bảo await cookies
      cookieCsrfToken = cookieStore.get('csrf_token')?.value;
    } catch (cookieError) {
      logger.error('Error accessing cookies', { error: cookieError.message, stack: cookieError.stack, ip });
      return NextResponse.json({ success: false, detail: 'Failed to access cookies' }, { status: 500 });
    }
    logger.info('CSRF Token check', { csrfToken, cookieCsrfToken, ip });
    if (!csrfToken || !cookieCsrfToken || csrfToken !== cookieCsrfToken) {
      logger.error('CSRF token validation failed', { csrfToken, cookieCsrfToken, ip });
      return NextResponse.json({ success: false, detail: 'Invalid CSRF token' }, { status: 403 });
    }

    // Validate charge data
    const validCurrencies = ['USD', 'EUR', 'GBP'];
    if (!validCurrencies.includes(currency) || amount <= 0) {
      logger.error('Invalid currency or amount', { currency, amount, userId });
      return NextResponse.json({ success: false, detail: 'Invalid currency or amount' }, { status: 400 });
    }

    // Kiểm tra API key
    if (!process.env.COINBASE_COMMERCE_API_KEY) {
      logger.error('COINBASE_COMMERCE_API_KEY is not set');
      return NextResponse.json({ success: false, detail: 'Server configuration error: API key missing' }, { status: 500 });
    }

    // Tạo charge qua REST API
    const chargeData = {
      name: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan Upgrade`,
      description: `Upgrade to ${plan} plan for user ${userId}`,
      local_price: { amount: amount.toFixed(2), currency },
      metadata: { userId, plan },
      pricing_type: 'fixed_price',
    };

    logger.info('Sending request to Coinbase API', { chargeData });

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
    logger.info('Coinbase API response', { status: response.status, response: charge });

    if (!response.ok) {
      logger.error('Coinbase API error', { status: response.status, message: charge.error?.message || 'Unknown error', userId });
      return NextResponse.json({ success: false, detail: `Coinbase API error: ${charge.error?.message || 'Failed to create charge'}` }, { status: response.status });
    }

    const chargeId = charge.data.id;
    const chargeCode = charge.data.code;
    const hostedUrl = charge.data.hosted_url;

    logger.info('Coinbase charge created', { chargeId, chargeCode, userId });

    // Lưu vào Prisma
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

    // Headers response
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Content-Security-Policy': "default-src 'self'",
      'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
      'Access-Control-Allow-Credentials': 'true',
    });

    return NextResponse.json(
      {
        success: true,
        hostedUrl,
        chargeId,
        chargeCode,
      },
      { headers }
    );
  } catch (error) {
    logger.error('Error creating Coinbase charge', { error: error.message, stack: error.stack, ip });
    return NextResponse.json({ success: false, detail: `Server error: ${error.message}` }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

export async function OPTIONS() {
  const headers = new Headers({
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
    'Access-Control-Allow-Credentials': 'true',
  });
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