// app/api/nonce/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getRedisClient } from '@/utils/redis';
import { logger } from '@/utils/serverLogger';

export async function GET() {
  try {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const nonce = Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');

    const ttlSeconds = process.env.NODE_ENV === 'development' ? 600 : 300;
    const client = await getRedisClient();
    const expires = Date.now() + (ttlSeconds * 1000);
    await client.setEx(`siwe:nonce:${nonce}`, ttlSeconds, JSON.stringify({ expires }));

    const response = NextResponse.json({ nonce });
    response.cookies.set('siwe', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      maxAge: ttlSeconds,
      path: '/',
    });

    logger.info('Nonce generated and stored for SIWE (Base / Farcaster)', {
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
    const body = await request.json().catch(() => null);
    const { nonce } = body || {};
    if (!nonce) {
      logger.warn('DELETE /api/nonce: Missing nonce', { body });
      return NextResponse.json({ error: 'Missing nonce' }, { status: 400 });
    }
    const client = await getRedisClient();
    const deleted = await client.del(`siwe:nonce:${nonce}`);
    if (deleted > 0) {
      logger.info('Nonce deleted successfully', { nonce: nonce.substring(0, 16) + '...' });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Nonce not found' }, { status: 404 });
  } catch (error) {
    logger.error('Nonce deletion failed', { error: error.message });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}