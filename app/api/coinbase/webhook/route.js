import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { logger } from '../../../../utils/serverLogger';
import { buffer } from 'micro';
import crypto from 'crypto';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
if (!redisClient.isOpen) {
  await redisClient.connect();
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:3000/api',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

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
    logger.error('CORS blocked', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, origin, referer });
    return false;
  }
}

async function checkRateLimit(ip) {
  const key = `rate_limit:coinbase_webhook:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50;
  if (requests >= maxRequests) {
    throw new Error('Too many webhook requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const prisma = new PrismaClient();

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  if (!process.env.COINBASE_COMMERCE_WEBHOOK_SECRET) {
    logger.error('COINBASE_COMMERCE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ detail: 'Server configuration error: Webhook secret missing' }, { status: 500 });
  }

  try {
    const rawBody = await buffer(req);
    const signature = req.headers.get('x-cc-webhook-signature');
    const webhookSecret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;

    // Verify signature
    const hmac = crypto.createHmac('sha256', webhookSecret);
    const expectedSignature = hmac.update(rawBody).digest('hex');
    if (signature !== expectedSignature) {
      logger.error('Invalid webhook signature', { ip });
      return NextResponse.json({ success: false, detail: 'Invalid webhook signature' }, { status: 400 });
    }
    logger.info('Webhook signature verified', { ip });

    const event = JSON.parse(rawBody.toString());
    if (event.type === 'charge:confirmed') {
      const { chargeId, userId } = event.data.metadata;
      const chargeCode = event.data.code;
      const amount = parseFloat(event.data.payments[0].value.local.amount);
      const currency = event.data.payments[0].value.local.currency;

      const payment = await prisma.payment.findUnique({
        where: { chargeId },
      });

      if (!payment) {
        logger.error('Payment not found', { chargeId, userId });
        return NextResponse.json({ success: false, detail: 'Payment not found' }, { status: 400 });
      }

      if (payment.chargeCode !== chargeCode || payment.amount !== amount || payment.currency !== currency) {
        logger.error('Payment mismatch', { chargeId, userId, chargeCode, amount, currency });
        return NextResponse.json({ success: false, detail: 'Payment mismatch' }, { status: 400 });
      }

      await prisma.payment.update({
        where: { chargeId },
        data: { status: 'confirmed', updatedAt: new Date() },
      });

      await prisma.users.update({
        where: { id: userId },
        data: {
          tier: 'Premium',
          is_premium: true,
          premium_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          updated_at: new Date(),
        },
      });

      logger.info('Payment confirmed and user tier updated', { chargeId, userId });
      return NextResponse.json({ success: true });
    }

    logger.info('Webhook event processed', { eventType: event.type, ip });
    return NextResponse.json({ success: true, detail: 'Event processed' });
  } catch (error) {
    logger.error('Error processing webhook', { error: error.message, stack: error.stack, ip });
    return NextResponse.json({ success: false, detail: 'Invalid webhook signature or processing error' }, { status: 400 });
  } finally {
    await prisma.$disconnect();
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function OPTIONS() {
  const headers = new Headers({
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CC-Webhook-Signature',
    'Access-Control-Allow-Credentials': 'true',
  });
  return new NextResponse(null, { status: 204, headers });
}

process.on('SIGTERM', async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGTERM');
  }
});
process.on('SIGINT', async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGINT');
  }
});