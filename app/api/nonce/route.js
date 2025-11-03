// app/api/nonce/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getRedisClient } from '@/utils/redis';
import { logger } from '@/utils/serverLogger';

export async function GET() {
  try {
    // Generate nonce server-side: 16 bytes hex = 32 chars (for SIWE compliance)
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const nonce = Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');

    const ttlSeconds = process.env.NODE_ENV === 'development' ? 600 : 300; // 10min dev, 5min prod
    const client = await getRedisClient();
    const expires = Date.now() + (ttlSeconds * 1000);
    await client.setEx(`siwe:nonce:${nonce}`, ttlSeconds, JSON.stringify({ expires }));

    logger.info('Nonce generated and stored for SIWE', {
      fullNonce: nonce,
      nonceLength: nonce.length,
      expires: new Date(expires).toISOString(),
      ttlSeconds
    });
    return NextResponse.json({ nonce });
  } catch (error) {
    logger.error('Nonce generation failed', { error: error.message });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// Giữ DELETE (cleanup nonce on success/fail)
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));  // Graceful parse nếu no body
    const { nonce } = body;
    if (!nonce) {
      logger.warn('DELETE /api/nonce: Missing nonce in body');
      return NextResponse.json({ error: 'Missing nonce' }, { status: 400 });
    }
    const client = await getRedisClient();
    const deleted = await client.del(`siwe:nonce:${nonce}`);
    if (deleted > 0) {
      logger.info('Nonce deleted (SIWE cleanup)', { nonce: nonce.substring(0, 16) + '...' });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Nonce not found' }, { status: 404 });
  } catch (error) {
    logger.error('Nonce deletion failed', { error: error.message });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}