import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { logger } from '../../../../utils/serverLogger';
import { buffer } from 'micro';
import crypto from 'crypto';
import { z } from 'zod';

const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: { db: { url: process.env.DATABASE_URL } },
});

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    const redisUrl =
      process.env.NODE_ENV === 'production'
        ? process.env.REDIS_URL || 'rediss://localhost:6379'
        : process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) =>
      logger.error('Redis Client Error', { error: err.message }),
    );
    redisClient.on('connect', () => logger.info('Redis Client Connected'));
    await redisClient.connect();
    logger.info('Redis connected (initial)');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

async function checkRateLimit(ip) {
  const client = await getRedisClient();
  const key = `rate:webhook:${ip}`;
  const windowSeconds = 15 * 60;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50;
  const count = Number(await client.incr(key));
  if (count === 1) await client.expire(key, windowSeconds);
  if (count > maxRequests) {
    throw new Error('Too many webhook requests');
  }
}

async function checkReplay(eventId) {
  const client = await getRedisClient();
  const key = `webhook:event:${eventId}`;
  const exists = await client.get(key);
  if (exists) {
    throw new Error('Replay attack detected');
  }
  await client.setEx(key, 60 * 60 * 24, 'processed'); // keep 24h
}

function securityHeaders() {
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

const metadataSchema = z.object({
  userId: z.string().max(100),
  chargeId: z.string().max(100),
  plan: z.enum(['basic', 'premium', 'pro']).optional(),
});

const eventSchema = z.object({
  id: z.string(),
  type: z.literal('charge:confirmed'),
  data: z.object({
    code: z.string(),
    metadata: metadataSchema,
    payments: z
      .array(
        z.object({
          value: z.object({
            local: z.object({
              amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
              currency: z.enum(['USD', 'EUR', 'GBP']),
            }),
          }),
        }),
      )
      .min(1),
  }),
});

export async function POST(req) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info('Received webhook request', { ip });

  try {
    await checkRateLimit(ip);

    if (!process.env.COINBASE_COMMERCE_WEBHOOK_SECRET) {
      logger.error('Webhook secret not set');
      return NextResponse.json(
        { detail: 'Invalid webhook' },
        { status: 400, headers: securityHeaders() },
      );
    }

    const rawBody = await buffer(req);
    const signature = req.headers.get('x-cc-webhook-signature');
    const webhookSecret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;

    const hmac = crypto.createHmac('sha256', webhookSecret);
    const expectedSignature = hmac.update(rawBody).digest('hex');
    if (signature !== expectedSignature) {
      logger.error('Invalid webhook signature', { ip });
      return NextResponse.json(
        { detail: 'Invalid webhook' },
        { status: 400, headers: securityHeaders() },
      );
    }
    logger.info('Webhook signature verified', { ip });

    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch {
      logger.error('Invalid JSON body', { ip });
      return NextResponse.json(
        { detail: 'Invalid webhook' },
        { status: 400, headers: securityHeaders() },
      );
    }

    if (event.type !== 'charge:confirmed') {
      logger.info('Webhook event ignored', { type: event.type });
      return NextResponse.json(
        { success: true },
        { headers: securityHeaders() },
      );
    }

    let parsedEvent;
    try {
      parsedEvent = eventSchema.parse(event);
    } catch (err) {
      logger.error('Invalid event data', { ip, errors: err.errors });
      return NextResponse.json(
        { detail: 'Invalid webhook' },
        { status: 400, headers: securityHeaders() },
      );
    }

    await checkReplay(parsedEvent.id);

    const { chargeId, userId } = parsedEvent.data.metadata;
    const chargeCode = parsedEvent.data.code;
    const amount = parseFloat(parsedEvent.data.payments[0].value.local.amount);
    const currency = parsedEvent.data.payments[0].value.local.currency;

    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { chargeId },
      });

      if (!payment) {
        logger.error('Payment not found', { chargeId });
        throw new Error('Payment not found');
      }

      if (
        payment.chargeCode !== chargeCode ||
        payment.amount !== amount ||
        payment.currency !== currency
      ) {
        logger.error('Payment mismatch', { chargeId });
        throw new Error('Payment mismatch');
      }

      const plan = parsedEvent.data.metadata.plan || 'basic';
      let expiresAt = null;

      if (plan === 'premium') {
        expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 năm
      } else if (plan === 'pro') {
        expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 1 tháng
      }

      await tx.payment.update({
        where: { chargeId },
        data: { status: 'confirmed', updatedAt: new Date() },
      });

      await tx.users.update({
        where: { id: userId },
        data: {
          tier: plan,
          is_premium: plan !== 'basic',
          premium_expires_at: expiresAt,
          updated_at: new Date(),
        },
      });

      logger.info('Payment confirmed and user tier updated', { chargeId, plan });
    });


    return NextResponse.json(
      { success: true },
      { headers: securityHeaders() },
    );
  } catch (error) {
    logger.error('Error processing webhook', { error: error.message });
    return NextResponse.json(
      { detail: 'Invalid webhook' },
      { status: 400, headers: securityHeaders() },
    );
  } finally {
    await prisma.$disconnect();
  }
}

export const config = {
  api: { bodyParser: false },
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: securityHeaders() });
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
