// app/api/verify-wallet/route.js
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Simple in-memory rate limit for dev
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const key = ip || 'anonymous';
  const record = rateLimitMap.get(key) || { count: 0, resetTime: now + 15 * 60 * 1000 };

  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + 15 * 60 * 1000;
  }

  if (record.count >= 5) return true;

  record.count++;
  rateLimitMap.set(key, record);
  return false;
}

export async function POST(request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') ||
               request.headers.get('x-vercel-forwarded-for') ||
               'unknown';

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { success: false, detail: 'Too many requests. Please wait 15 minutes and try again.' },
        { status: 429 }
      );
    }

    const csrfToken = request.headers.get('x-csrf-token');
    if (!csrfToken) {
      return NextResponse.json(
        { success: false, detail: 'Missing CSRF token' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { uid, walletAddress, signature, message, nonce, recaptchaToken } = body; // UPDATED: Add nonce

    if (!uid || !walletAddress || !signature || !message || !nonce) { // UPDATED: Check nonce
      return NextResponse.json(
        { success: false, detail: 'Missing required fields' },
        { status: 400 }
      );
    }

    const session = await auth();
    if (!session || !session.user || session.user.id !== uid) {
      return NextResponse.json(
        { success: false, detail: 'Unauthorized: User ID mismatch' },
        { status: 401 }
      );
    }

    const skipRecaptcha = process.env.SKIP_RECAPTCHA === 'true';

    if (!skipRecaptcha && process.env.NODE_ENV !== 'development') {
      if (!recaptchaToken || typeof recaptchaToken !== 'string') {
        return NextResponse.json(
          { success: false, detail: 'Missing reCAPTCHA token' },
          { status: 400 }
        );
      }

      try {
        const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'verify_wallet', ip);
        if (!recaptchaResponse.success) {
          if (recaptchaResponse.needsFallback) {
            return NextResponse.json(
              { success: false, detail: 'low_score_fallback' },
              { status: 403 }
            );
          }
          return NextResponse.json(
            { success: false, detail: 'reCAPTCHA verification failed' },
            { status: 403 }
          );
        }
      } catch (error) {
        console.error('reCAPTCHA verification error:', error);
        return NextResponse.json(
          { success: false, detail: 'reCAPTCHA verification failed' },
          { status: 403 }
        );
      }
    } else {
      console.log('reCAPTCHA skipped for verify-wallet');
    }

    // Verify signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json(
        { success: false, detail: 'Invalid signature' },
        { status: 400 }
      );
    }

    // UPDATED: Check timestamp expiration (5 minutes)
    const timestampMatch = message.match(/Timestamp:\s*(\d+)/);
    if (!timestampMatch) {
      return NextResponse.json(
        { success: false, detail: 'Invalid message format' },
        { status: 400 }
      );
    }
    const timestamp = parseInt(timestampMatch[1]);
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      return NextResponse.json(
        { success: false, detail: 'Signature expired' },
        { status: 400 }
      );
    }

    // UPDATED: Basic nonce check (ensure it's present and matches message format for now; for full anti-replay, store used nonces in DB)
    const nonceMatch = message.match(/Nonce:\s*([a-f0-9\-]+)/i);
    if (!nonceMatch || nonceMatch[1] !== nonce) {
      return NextResponse.json(
        { success: false, detail: 'Invalid nonce' },
        { status: 400 }
      );
    }

    const existingUser = await prisma.users.findUnique({ where: { id: uid } });
    if (existingUser?.wallet_address && existingUser.wallet_address !== walletAddress.toLowerCase()) {
      return NextResponse.json(
        { success: false, detail: 'Wallet already linked to another address. Disconnect first.' },
        { status: 400 }
      );
    }

    const user = await prisma.users.update({
      where: { id: uid },
      data: {
        wallet_address: walletAddress.toLowerCase(),
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        walletAddress: user.wallet_address,
      },
    });

  } catch (error) {
    console.error('Verify wallet error:', error);
    return NextResponse.json(
      { success: false, detail: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}