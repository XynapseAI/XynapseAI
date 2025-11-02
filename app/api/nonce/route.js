import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getRedisClient } from '@/utils/redis';
import { logger } from '@/utils/serverLogger';
import { RateLimiterRedis } from "rate-limiter-flexible";

// UPDATED: Rate limit cho nonce (loose ở dev)
async function rateLimitNonce(ip) {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Nonce rate limit bypassed in development', { ip });
    return; // Bypass ở dev
  }
  const client = await getRedisClient();
  const rateLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: `rate_limit:nonce:${ip}`,
    points: 50, // Prod: 50/15min
    duration: 15 * 60,
  });
  try {
    await rateLimiter.consume(ip);
    logger.debug('Nonce rate limit passed', { ip });
  } catch (err) {
    logger.warn("Nonce rate limit exceeded", { ip, error: err.message });
    throw new Error(`Too many nonce requests. Try again later.`);
  }
}

export async function GET(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
               request.headers.get("cf-connecting-ip") || 
               request.headers.get("x-real-ip") || 
               "unknown"; // Improved IP detection
    await rateLimitNonce(ip);

    // Generate nonce (giữ nguyên)
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const nonce = Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');

    const ttlSeconds = process.env.NODE_ENV === 'development' ? 600 : 300;
    const client = await getRedisClient();
    const expires = Date.now() + (ttlSeconds * 1000);
    await client.setEx(`siwe:nonce:${nonce}`, ttlSeconds, JSON.stringify({ expires }));

    logger.info('Nonce generated and stored', {
      noncePreview: nonce.substring(0, 8) + '...',
      nonceLength: nonce.length,
      expires: new Date(expires).toISOString(),
      ttlSeconds,
      ip
    });
    return NextResponse.json({ nonce });
  } catch (error) {
    logger.error('Nonce generation failed', { error: error.message });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// UPDATED: DELETE với rate limit (tương tự, bypass dev)
export async function DELETE(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
               request.headers.get("cf-connecting-ip") || 
               request.headers.get("x-real-ip") || 
               "unknown";
    if (process.env.NODE_ENV !== 'development') {
      const rateLimiter = new RateLimiterRedis({
        storeClient: await getRedisClient(),
        keyPrefix: `rate_limit:nonce_del:${ip}`,
        points: 10,
        duration: 15 * 60,
      });
      await rateLimiter.consume(ip);
    }

    const body = await request.json().catch(() => ({}));
    const { nonce } = body;
    if (!nonce) {
      logger.warn('DELETE /api/nonce: Missing nonce in body');
      return NextResponse.json({ error: 'Missing nonce' }, { status: 400 });
    }
    const client = await getRedisClient();
    const deleted = await client.del(`siwe:nonce:${nonce}`);
    if (deleted > 0) {
      logger.info('Nonce deleted', { nonce: nonce.substring(0, 16) + '...' });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Nonce not found' }, { status: 404 });
  } catch (error) {
    logger.error('Nonce deletion failed', { error: error.message });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}