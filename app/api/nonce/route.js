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

    // NEW: Set HTTP-only cookie (secure cho prod, sameSite: 'none' cross-site World App)
    const response = NextResponse.json({ nonce });
    response.cookies.set('siwe', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',  // Cho cross-site World App
      maxAge: ttlSeconds,
      path: '/',
    });

    logger.info('Nonce generated and stored for SIWE (World Mini App)', {
      fullNonce: nonce,
      nonceLength: nonce.length,
      expires: new Date(expires).toISOString(),
      ttlSeconds
    });
    return response;
  } catch (error) {
    logger.error('Nonce generation failed', { error: error.message });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => null);  // Handle no/invalid body
    const { nonce } = body || {};
    if (!nonce) {
      logger.warn('DELETE /api/nonce: Missing or invalid nonce body', { body });
      return NextResponse.json({ error: 'Missing nonce' }, { status: 400 });
    }
    if (!/^[a-f0-9]{32}$/i.test(nonce)) {
      logger.warn('DELETE /api/nonce: Invalid nonce format');
      return NextResponse.json({ error: 'Invalid nonce' }, { status: 400 });
    }
    const client = await getRedisClient();
    const key = `siwe:nonce:${nonce}`;
    const deleted = await client.del(key);
    if (deleted > 0) {
      logger.info('Nonce deleted successfully (post-World auth)', { nonce: nonce.substring(0, 16) + '...' });
      return NextResponse.json({ success: true });
    } else {
      logger.warn('Nonce not found for deletion (already used/expired?)', { nonce: nonce.substring(0, 16) + '...', key });
      return NextResponse.json({ error: 'Nonce not found' }, { status: 404 });
    }
  } catch (error) {
    logger.error('Nonce deletion failed', { error: error.message });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}