// app/api/record-mint/route.js
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';
import util from 'util';
import cookie from 'cookie';
import { ethers } from 'ethers';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const scrypt = util.promisify(crypto.scrypt);

const prisma = new PrismaClient({
  errorFormat: 'minimal',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

let redisClient;
async function getRedisClient() {
  if (redisClient?.isOpen) return redisClient;
  const maxRetries = 3;
  const delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
      redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
      await redisClient.connect();
      if (process.env.NODE_ENV !== 'production') {
        logger.info('Redis connected');
      }
      return redisClient;
    } catch (err) {
      if (i === maxRetries - 1) throw new Error('Failed to connect to Redis');
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Redis connection failed, retrying...`, { attempt: i + 1, err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function getClientIp(request) {
  const xForwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const xRealIp = request.headers.get('x-real-ip')?.trim();
  const vercelIp = request.headers.get('x-vercel-forwarded-for')?.trim();
  return xRealIp || vercelIp || xForwardedFor || 'unknown';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

async function withRetry(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Database connection failed, retrying...`, { attempt: i + 1, err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function checkRateLimit(ip, userId = null) {
  const client = await getRedisClient();
  const windowSeconds = 15 * 60;
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 500 : 300;
  const userMax = process.env.NODE_ENV === 'development' ? 300 : 100;
  const ipCount = Number(await client.incr(ipKey));
  if (ipCount === 1) await client.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    throw new Error('Too many requests from this IP');
  }
  if (userKey) {
    const uCount = Number(await client.incr(userKey));
    if (uCount === 1) await client.expire(userKey, windowSeconds);
    if (uCount > userMax) {
      throw new Error('Too many requests for this user');
    }
  }
}

async function trackViolation(ip, pathname, reason) {
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
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('Violation recorded', { ip, pathname, reason, violations: violations + 1 });
  }
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
      logger.info("Origin allowed", { origin });
      return true;
    }
    // Handle Origin: "null" (string) from WebViews/apps
    if (origin === 'null' && referer) {
      const refOrigin = new URL(referer).origin;
      // Allow if referer from trusted apps or own domains
      if (
        allowedOrigins.includes(refOrigin) ||
        referer.includes('farcaster.xyz') ||
        referer.includes('warpcast.com') ||
        referer.includes('base.org') ||
        referer.includes('worldcoin.org') || referer.includes('world.org') 
      ) {
        logger.info("Allowing null origin for trusted app/referer", { referer, refOrigin });
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        logger.info("Referer origin allowed", { referer, refOrigin });
        return true;
      }
      // Allow Farcaster/Warpcast/Base/World referer
      if (referer.includes('farcaster.xyz') || referer.includes('warpcast.com') || referer.includes('base.org') || referer.includes('worldcoin.org') || referer.includes('world.org')) {
        logger.info("Allowing Farcaster/Warpcast/Base/World referer", { referer });
        return true;
      }
    }
    if (!origin && !referer) {
      logger.info("Allowing internal/SSR request");
      return true;
    }
    if (!origin && process.env.NODE_ENV === "development") {
      logger.warn("Origin is null, allowing in development mode");
      return true;
    }
    logger.error("CORS blocked", { origin, referer, pathname });
    await trackViolation(ip, pathname, "CORS blocked");
    return false;
  } catch (err) {
    logger.error("Error in isAllowedOrigin", { error: err.message, origin, referer, pathname });
    await trackViolation(ip, pathname, "CORS error");
    return false;
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

async function setCSRFToken(ip, userId) {
  const client = await getRedisClient();
  const token = await generateCSRFToken();
  const key = `csrf:${userId || ip}`;
  await client.setEx(key, 15 * 60, token);
  return token;
}

async function checkDoubleSubmitCSRF(request, ip, userId) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['csrf_token'] || '';

  if (process.env.NODE_ENV === 'development' && headerToken === 'dev-csrf' && cookieToken === 'dev-csrf') {
    if (process.env.NODE_ENV !== 'production') {
      logger.info('Development CSRF bypass used');
    }
    return true;
  }

  if (!headerToken || !cookieToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF tokens missing', {
        headerProvided: !!headerToken,
        cookieProvided: !!cookieToken,
      });
    }
    return false;
  }

  const client = await getRedisClient();
  const storedToken = await client.get(`csrf:${userId || ip}`);
  if (!storedToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token not found in Redis', { key: `csrf:${userId || ip}` });
    }
    return false;
  }

  // FIXED: Add debug log for lengths
  logger.info('CSRF token lengths', { header: headerToken.length, cookie: cookieToken.length, stored: storedToken.length });

  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
    crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken));
  if (!valid && process.env.NODE_ENV !== 'production') {
    logger.warn('CSRF token mismatch', {
      headerToken: mask(headerToken),
      cookieToken: mask(cookieToken),
      storedToken: mask(storedToken),
    });
  }
  return valid;
}

function mask(value, keep = 6) {
  if (!value) return '';
  return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
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
    "frame-ancestors *",  // CHANGED: Allow * for app iframe compatibility
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
      httpOnly: false,  // CHANGED: false for webview/app compatibility (allows JS read)
      secure: isProd,
      sameSite: sameSite,
      maxAge: 15 * 60,
      path: '/',
      ...(cookieDomain && { domain: cookieDomain }),
    });
  }
  return headers;
}

// Schema for POST body
const postSchema = z.object({
  txHash: z.string().min(1, 'txHash is required'),
  uid: z.string().min(1, 'UID is required'),
  walletAddress: z.string().min(42, 'Wallet address is invalid'),
});

// NFT ABI for verification
const NFT_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
];

// Provider setup
const BASE_RPC = process.env.BASE_RPC || 'https://mainnet.base.org';  // CHANGED: Mainnet RPC
const provider = new ethers.JsonRpcProvider(BASE_RPC);
const CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS || "0x22EE9eE1a5986ff354d34ed19Eb28E65091C7648";

export async function POST(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  if (process.env.NODE_ENV !== 'production') {
    logger.info('POST /api/record-mint requested', { ip, pathname });
  }

  if (!(await isAllowedOrigin(origin, referer, pathname, ip))) {
    await trackViolation(ip, pathname, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  // Handle null origin in CORS headers
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
    const session = await auth();
    const userId = session?.user?.id || null;

    if (!session || !userId) {
      await trackViolation(ip, pathname, 'Unauthenticated request');
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      await trackViolation(ip, pathname, err.message);
      return NextResponse.json({ detail: 'Too many requests' }, { status: 429, headers });
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      return NextResponse.json({ 
        detail: 'Invalid CSRF token. Please try again.',
        csrfToken: newCsrfToken  // ADDED: Return token for client to use in next request
      }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, pathname, 'Missing reCAPTCHA token');
      return NextResponse.json({ 
        detail: 'Missing reCAPTCHA token',
        ...(newCsrfToken && { csrfToken: newCsrfToken })  // ADDED: Return if set
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'record_mint', ip);
        if (!recaptchaResponse.success) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          if (recaptchaResponse.needsFallback) {
            return NextResponse.json({ 
              detail: 'low_score_fallback',
              ...(newCsrfToken && { csrfToken: newCsrfToken })
            }, { status: 403, headers: securityHeaders(newCsrfToken) });
          }
          await trackViolation(ip, pathname, `reCAPTCHA verification failed: ${recaptchaResponse.error}`);
          return NextResponse.json({ 
            detail: `reCAPTCHA verification failed: ${recaptchaResponse.error}`,
            ...(newCsrfToken && { csrfToken: newCsrfToken })
          }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score: recaptchaResponse.score });
        }
      } catch (error) {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        await trackViolation(ip, pathname, `reCAPTCHA verification error: ${error.message}`);
        return NextResponse.json({ 
          detail: `reCAPTCHA verification failed: ${error.message}`,
          ...(newCsrfToken && { csrfToken: newCsrfToken })
        }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, pathname, 'Invalid JSON body');
      return NextResponse.json({ 
        detail: 'Invalid JSON body',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    let parsedBody;
    try {
      parsedBody = postSchema.parse(body);
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, pathname, 'Invalid input data');
      return NextResponse.json({ 
        detail: 'Invalid input data',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const { txHash, uid, walletAddress } = parsedBody;

    if (session.user.id !== uid) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, pathname, 'Unauthorized user update');
      return NextResponse.json({ 
        detail: 'Not authorized',
        ...(newCsrfToken && { csrfToken: newCsrfToken })
      }, { status: 401, headers: securityHeaders(newCsrfToken) });
    }

    // Verify txHash is valid and a mint from walletAddress
    try {
      // FIXED: Validate txHash format first to avoid null params
      if (!txHash || !ethers.isHexString(txHash, 32)) {
        return NextResponse.json({ detail: 'Invalid txHash format' }, { status: 400, headers: securityHeaders(newCsrfToken) });
      }

      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt || receipt.status !== 1) {
        return NextResponse.json({ detail: 'Invalid or failed transaction' }, { status: 400, headers: securityHeaders(newCsrfToken) });
      }

      if (receipt.from.toLowerCase() !== walletAddress.toLowerCase()) {
        return NextResponse.json({ detail: 'Transaction not from your wallet' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }

      // Verify it's a mint call (optional, but secure)
      const iface = new ethers.Interface(NFT_ABI);
      const tx = await provider.getTransaction(txHash);
      if (tx) {
        const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
        if (decoded.name !== 'mint' || tx.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
          return NextResponse.json({ detail: 'Not a valid mint transaction to contract' }, { status: 400, headers: securityHeaders(newCsrfToken) });
        }
      }
    } catch (rpcErr) {
      logger.error('RPC error verifying tx:', { txHash, error: rpcErr.message });
      return NextResponse.json({ detail: 'Failed to verify transaction on chain' }, { status: 500, headers: securityHeaders(newCsrfToken) });
    }

    // Check if already minted
    try {
      const user = await withRetry(() => prisma.users.findUnique({ where: { id: uid } }));
      if (!user) {
        return NextResponse.json({ detail: 'User not found' }, { status: 404, headers: securityHeaders(newCsrfToken) });
      }
      if (user.has_minted_nft) {
        return NextResponse.json({ detail: 'Already minted' }, { status: 400, headers: securityHeaders(newCsrfToken) });
      }
    } catch (dbErr) {
      logger.error('DB error checking mint status:', { uid, error: dbErr.message });
      return NextResponse.json({ detail: 'Server error checking status' }, { status: 500, headers: securityHeaders(newCsrfToken) });
    }

    // Update user
    try {
      await withRetry(() =>
        prisma.users.update({
          where: { id: uid },
          data: { has_minted_nft: true }
        })
      );

      // Invalidate cache
      try {
        const client = await getRedisClient();
        const cacheKey = user.wallet_address ? `user:${user.wallet_address}` : `user:${uid}`;
        await client.del(cacheKey);
      } catch (cacheErr) {
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('Failed to clear cache for user', { id: mask(uid), err: cacheErr?.message });
        }
      }
    } catch (updateErr) {
      logger.error('DB error updating mint status:', { uid, error: updateErr.message });
      return NextResponse.json({ detail: 'Server error updating status' }, { status: 500, headers: securityHeaders(newCsrfToken) });
    }

    newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
    return NextResponse.json(
      { success: true, detail: 'Mint recorded successfully' },
      { headers: securityHeaders(newCsrfToken) }
    );
  } catch (error) {
    logger.error('Unexpected error in /api/record-mint POST', { error: error.message, stack: error.stack, ip });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders() });
  }
}