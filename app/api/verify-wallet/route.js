// app/api/verify-wallet/route.js
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../../utils/serverLogger';
import crypto from 'crypto';
import cookie from 'cookie';
import { createClient } from 'redis';

const prisma = new PrismaClient();

// Simple in-memory rate limit for dev
const rateLimitMap = new Map();

let redisClient;
async function getRedisClient() {
  if (redisClient?.isOpen) return redisClient;
  try {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
    await redisClient.connect();
    if (process.env.NODE_ENV !== 'production') {
      logger.info('Redis connected');
    }
    return redisClient;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Redis connect failed, using in-memory for CSRF');
    }
    return null; // Fallback to in-memory later if needed
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

async function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function setCSRFToken(userId, ip) {  // FIXED: Prioritize userId, fallback ip
  const token = await generateCSRFToken();
  const key = `csrf:${userId || ip}`;
  const client = await getRedisClient();
  if (client) {
    await client.setEx(key, 15 * 60, token);
  } else {
    // Fallback in-memory (simple, not persistent)
    rateLimitMap.set(key, { token, expires: Date.now() + 15 * 60 * 1000 });
  }
  return token;
}

async function checkDoubleSubmitCSRF(request, userId, ip) {  // FIXED: Require userId (from session)
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

  if (!userId) {
    logger.error('CSRF check requires userId');
    return false;
  }

  const client = await getRedisClient();
  const storedKey = `csrf:${userId}`;
  const storedToken = client ? await client.get(storedKey) : null;
  if (!storedToken) {
    // Fallback check in-memory
    const memRecord = rateLimitMap.get(storedKey);
    if (!memRecord || Date.now() > memRecord.expires) {
      logger.warn('CSRF token expired/not found', { key: storedKey });
      return false;
    }
    storedToken = memRecord.token;
  }

  logger.info('CSRF token lengths', { header: headerToken.length, cookie: cookieToken.length, stored: storedToken.length });

  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
    crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken));
  if (!valid) {
    logger.warn('CSRF token mismatch');
  }
  return valid;
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
  'https://base.xynapseai.net',
  'https://id.worldcoin.org',
  'https://world.org',
].filter(Boolean);

async function isAllowedOrigin(origin, referer, pathname, ip) {
  logger.info("Checking origin", { origin, referer, pathname, allowedOrigins });
  try {
    if (origin && allowedOrigins.includes(origin)) {
      return true;
    }
    if (origin === 'null' && referer) {
      const refOrigin = new URL(referer).origin;
      if (
        allowedOrigins.includes(refOrigin) ||
        referer.includes('farcaster.xyz') ||
        referer.includes('warpcast.com') ||
        referer.includes('base.org') ||
        referer.includes('worldcoin.org') || referer.includes('world.org')
      ) {
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) ||
          referer.includes('farcaster.xyz') || referer.includes('warpcast.com') ||
          referer.includes('base.org') || referer.includes('worldcoin.org') || referer.includes('world.org')) {
        return true;
      }
    }
    if (!origin && !referer) return true;
    if (!origin && process.env.NODE_ENV === "development") return true;
    logger.error("CORS blocked", { origin, referer, pathname });
    return false;
  } catch (err) {
    logger.error("Error in isAllowedOrigin", { error: err.message });
    return false;
  }
}

async function trackViolation(ip, pathname, reason) {
  const key = `violations:${ip}`;
  let record = rateLimitMap.get(key) || { count: 0, resetTime: Date.now() + 15 * 60 * 1000 };
  if (Date.now() > record.resetTime) {
    record = { count: 1, resetTime: Date.now() + 15 * 60 * 1000 };
  } else {
    record.count++;
  }
  rateLimitMap.set(key, record);
  if (record.count >= 5) {
    rateLimitMap.set(`banned_ip:${ip}`, { banned: true, until: Date.now() + 3600 * 1000 });
    logger.info('IP banned', { ip, reason });
  }
  logger.warn('Violation recorded', { ip, pathname, reason, violations: record.count });
}

function securityHeaders(csrfToken = null) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const isProd = process.env.NODE_ENV === 'production';
  const cookieDomain = isProd ? '.xynapseai.net' : undefined;
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors *",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');

  const headers = {
    'Content-Security-Policy': csp,
    'Content-Security-Policy-Nonce': nonce,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
  if (csrfToken) {
    const sameSite = isProd ? 'none' : 'lax';
    headers['Set-Cookie'] = cookie.serialize('csrf_token', csrfToken, {
      httpOnly: false,
      secure: isProd,
      sameSite: sameSite,
      maxAge: 15 * 60,
      path: '/',
      ...(cookieDomain && { domain: cookieDomain }),
    });
  }
  return headers;
}

function isRateLimited(ip) {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  // Check ban
  const banKey = `banned_ip:${ip || 'anonymous'}`;
  const banRecord = rateLimitMap.get(banKey);
  if (banRecord && Date.now() < banRecord.until) {
    return true;
  }

  const now = Date.now();
  const key = `verify_wallet:${ip || 'anonymous'}`;
  const windowMs = 60 * 60 * 1000; 
  const maxAttempts = 60;     

  let record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    rateLimitMap.set(key, record);
    return false;
  }

  if (record.count >= maxAttempts) {
    return true;
  }

  record.count++;
  rateLimitMap.set(key, record);
  return false;
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             request.headers.get('x-real-ip') ||
             request.headers.get('x-vercel-forwarded-for') ||
             'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;

  if (!(await isAllowedOrigin(origin, referer, pathname, ip))) {
    await trackViolation(ip, pathname, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  // CORS headers cho response
  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
    ...(origin === 'null' && referer && {
      'Access-Control-Allow-Origin': new URL(referer).origin,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    // FIXED: Get session FIRST to have userId for CSRF
    const session = await auth();
    const userId = session?.user?.id;
    if (!session || !userId) {
      await trackViolation(ip, pathname, 'Unauthenticated');
      return NextResponse.json({ 
        success: false, 
        detail: 'Not authenticated' 
      }, { status: 401, headers });
    }

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { success: false, detail: 'Too many requests. Please wait 15 minutes and try again.' },
        { status: 429, headers }
      );
    }

    let newCsrfToken;
    // FIXED: Check CSRF with userId (not null)
    const csrfOk = await checkDoubleSubmitCSRF(request, userId, ip);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(userId, ip);  // FIXED: Use userId
      return NextResponse.json({ 
        success: false, 
        detail: 'Invalid CSRF token. Please try again.',
        csrfToken: newCsrfToken
      }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    // FIXED: Parse body AFTER session (to validate uid)
    const body = await request.json();
    const { uid, walletAddress, signature, message, nonce, recaptchaToken } = body;

    if (!uid || !walletAddress || !signature || !message || !nonce) {
      newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
      return NextResponse.json({ 
        success: false, 
        detail: 'Missing required fields',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    // FIXED: Validate uid early (after session)
    if (userId !== uid) {
      newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
      await trackViolation(ip, pathname, 'UID mismatch');
      return NextResponse.json({ 
        success: false, 
        detail: 'Unauthorized: User ID mismatch',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 401, headers: securityHeaders(newCsrfToken) });
    }

    const skipRecaptcha = process.env.SKIP_RECAPTCHA === 'true';

    if (!skipRecaptcha && process.env.NODE_ENV !== 'development') {
      if (!recaptchaToken || typeof recaptchaToken !== 'string') {
        newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
        await trackViolation(ip, pathname, 'Missing reCAPTCHA');
        return NextResponse.json({ 
          success: false, 
          detail: 'Missing reCAPTCHA token',
          ...(newCsrfToken && { csrfToken: newCsrfToken })
        }, { status: 400, headers: securityHeaders(newCsrfToken) });
      }

      try {
        const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'verify_wallet', ip);
        if (!recaptchaResponse.success) {
          newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
          if (recaptchaResponse.needsFallback) {
            return NextResponse.json({ 
              success: false, 
              detail: 'low_score_fallback',
              ...(newCsrfToken && { csrfToken: newCsrfToken })
            }, { status: 403, headers: securityHeaders(newCsrfToken) });
          }
          await trackViolation(ip, pathname, 'reCAPTCHA failed');
          return NextResponse.json({ 
            success: false, 
            detail: 'reCAPTCHA verification failed',
            ...(newCsrfToken && { csrfToken: newCsrfToken })
          }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
      } catch (error) {
        newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
        await trackViolation(ip, pathname, 'reCAPTCHA error');
        return NextResponse.json({ 
          success: false, 
          detail: 'reCAPTCHA verification failed',
          ...(newCsrfToken && { csrfToken: newCsrfToken })
        }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    } else {
      console.log('reCAPTCHA skipped for verify-wallet');
    }

    // Verify signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
      return NextResponse.json({ 
        success: false, 
        detail: 'Invalid signature',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    // Check timestamp expiration (5 minutes)
    const timestampMatch = message.match(/Timestamp:\s*(\d+)/);
    if (!timestampMatch) {
      newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
      return NextResponse.json({ 
        success: false, 
        detail: 'Invalid message format',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    const timestamp = parseInt(timestampMatch[1]);
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
      return NextResponse.json({ 
        success: false, 
        detail: 'Signature expired',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    // Basic nonce check (ensure it's present and matches message format for now; for full anti-replay, store used nonces in DB)
    const nonceMatch = message.match(/Nonce:\s*([a-f0-9\-]+)/i);
    if (!nonceMatch || nonceMatch[1] !== nonce) {
      newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
      return NextResponse.json({ 
        success: false, 
        detail: 'Invalid nonce',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const existingUser = await prisma.users.findUnique({ where: { id: uid } });
    if (existingUser?.wallet_address && existingUser.wallet_address !== walletAddress.toLowerCase()) {
      newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
      return NextResponse.json({ 
        success: false, 
        detail: 'Wallet already linked to another address. Disconnect first.',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const user = await prisma.users.update({
      where: { id: uid },
      data: {
        wallet_address: walletAddress.toLowerCase(),
      },
    });

    newCsrfToken = newCsrfToken || await setCSRFToken(userId, ip);
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        walletAddress: user.wallet_address,
      },
    }, { headers: securityHeaders(newCsrfToken) });

  } catch (error) {
    logger.error('Verify wallet error:', error);
    return NextResponse.json(
      { success: false, detail: error.message || 'Internal server error' },
      { status: 500, headers: securityHeaders() }
    );
  } finally {
    await prisma.$disconnect();
  }
}