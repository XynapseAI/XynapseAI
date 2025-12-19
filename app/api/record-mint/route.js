import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import crypto from 'crypto';
import util from 'util';
import cookie from 'cookie';
import { ethers } from 'ethers';
import Bottleneck from 'bottleneck';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { query } from '@/utils/postgres';

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
  const maxRetries = 5;
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
      if (i === maxRetries - 1) {
        logger.error('Failed to connect to Redis after max retries', { err: err?.message });
        if (process.env.NODE_ENV === 'development') {
          logger.warn('Bypassing Redis in development mode');
          return null;
        }
        throw new Error('Failed to connect to Redis');
      }
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

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors *;",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
  'https://base.xynapseai.net',
  'https://warpcast.com',
  'https://farcaster.xyz',
  'https://base.org',
  'https://id.worldcoin.org',
  'https://world.org',
].filter((v, i, a) => a.indexOf(v) === i);

async function isAllowedOrigin(origin, referer, pathname, ip) {
  logger.info('Checking origin for record-mint', { origin, referer, pathname, ip, allowedOrigins });
  try {
    if (origin && allowedOrigins.includes(origin)) {
      logger.info('Origin allowed', { origin });
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
        logger.info('Allowing null origin for trusted app/referer', { referer, refOrigin });
        return true;
      }
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      if (referer.includes('farcaster.xyz') || referer.includes('warpcast.com') || referer.includes('base.org') || referer.includes('worldcoin.org') || referer.includes('world.org')) {
        logger.info('Allowing Farcaster/Warpcast/Base/World referer', { referer });
        return true;
      }
    }
    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }
    logger.error('CORS blocked for record-mint', { origin, referer, pathname });
    await trackViolation(ip, pathname, 'CORS blocked');
    return false;
  } catch (err) {
    logger.error('Error in isAllowedOrigin for record-mint', { error: err.message, origin, referer, pathname });
    await trackViolation(ip, pathname, 'CORS error');
    return false;
  }
}

async function banIP(ip, durationSeconds = 3600) {
  const client = await getRedisClient();
  if (client) {
    await client.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
    logger.info('IP banned', { ip, durationSeconds });
  } else {
    logger.warn('Skipped IP ban due to Redis unavailable', { ip });
  }
}

async function checkIPBan(ip, pathname) {
  const client = await getRedisClient();
  if (!client) {
    logger.warn('Skipped IP ban check due to Redis unavailable', { ip, pathname });
    return;
  }
  const isBanned = await client.get(`banned_ip:${ip}`);
  if (isBanned) {
    logger.error('IP ban detected', { ip, pathname });
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, pathname, reason = 'Unknown') {
  const client = await getRedisClient();
  if (!client) {
    logger.warn('Skipped violation track due to Redis unavailable', { ip, pathname, reason });
    return;
  }
  const key = `violations:${ip}`;
  const maxViolations = 40;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await client.get(key)) || 0;
  if (violations >= maxViolations) {
    await banIP(ip);
    throw new Error('IP banned due to repeated violations.');
  }
  await client.multi().incr(key).expire(key, Math.floor(windowMs / 1000)).exec();
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('Violation recorded', { ip, pathname, reason, violations: violations + 1 });
  }
}

async function getAccountAge(userId) {
  if (!userId) return 0;
  try {
    const result = await query('SELECT created_at FROM users WHERE id = $1', [userId]);
    if (!result.rows[0]) return 0;
    const createdAt = new Date(result.rows[0].created_at);
    return Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
  } catch (err) {
    logger.error('Error in getAccountAge', { error: err.message, userId });
    return 0;
  }
}

async function dynamicRateLimit(ip, userId = null, pathname) {
  if (process.env.NODE_ENV === 'development') {
    logger.info('Bypassing rate limit in development mode', { userId, ip });
    return;
  }
  const client = await getRedisClient();
  if (!client) {
    logger.warn('Skipping rate limit due to Redis unavailable', { userId, ip });
    return;
  }
  const limits = {
    newUser: { points: 1000, duration: 15 * 60 },
    regularUser: { points: 1500, duration: 15 * 60 },
    premiumUser: { points: 2000, duration: 15 * 60 },
  };
  const accountAge = await getAccountAge(userId);
  const isPremium = false;
  const limitType = isPremium ? 'premiumUser' : accountAge < 7 ? 'newUser' : 'regularUser';
  const rateLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: `rate_limit:mint:${userId || ip}`,
    points: limits[limitType].points,
    duration: limits[limitType].duration,
    inmemoryBlockOnConsumed: limits[limitType].points + 1,
  });
  try {
    await rateLimiter.consume(userId || ip, 1);
    logger.info('Rate limit consumed successfully', { userId, ip });
  } catch (err) {
    if (err instanceof Error && err.message.includes('ECONNREFUSED')) {
      logger.error('Redis connection refused in rate limit', { err: err.message });
      return;
    }
    let msBeforeNext = err.msBeforeNext || 120000;
    if (typeof msBeforeNext !== 'number' || isNaN(msBeforeNext)) {
      msBeforeNext = 60000;
      logger.warn('msBeforeNext invalid, using fallback', { msBeforeNext: err.msBeforeNext });
    }
    const secs = Math.ceil(msBeforeNext / 1000);
    logger.error('Rate limit exceeded', { userId, ip, pathname, secs });
    throw new Error(`Rate limit exceeded. Try again in ${secs} seconds.`);
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
  if (!client) {
    logger.warn('Skipping setCSRFToken due to Redis unavailable');
    return generateCSRFToken();
  }
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
    logger.info('Development CSRF bypass used');
    return true;
  }
  if (process.env.NODE_ENV === 'development') {
    logger.info('Bypassing CSRF in development mode');
    return true;
  }
  if (!headerToken || !cookieToken) {
    logger.warn('CSRF tokens missing', {
      headerProvided: !!headerToken,
      cookieProvided: !!cookieToken,
    });
    return false;
  }
  const client = await getRedisClient();
  if (!client) {
    logger.warn('Skipping CSRF check due to Redis unavailable - allowing request');
    return true;
  }
  const storedToken = await client.get(`csrf:${userId || ip}`);
  if (!storedToken) {
    logger.warn('CSRF token not found in Redis', { key: `csrf:${userId || ip}` });
    return false;
  }
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

const limiter = new Bottleneck({ maxConcurrent: 5, minTime: 200 });
const rateLimitedHandler = (handler) =>
  limiter.wrap(async (request) => {
    const pathname = new URL(request.url).pathname;
    const ip = getClientIp(request);
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    logger.info(`Record-mint Request: IP=${ip}, Origin=${origin || 'null'}, Referer=${referer || 'null'}, Pathname=${pathname}`);
    if (!(await isAllowedOrigin(origin, referer, pathname, ip))) {
      return NextResponse.json({ detail: 'CORS Not Allowed' }, { status: 403, headers: securityHeaders });
    }
    try {
      await checkIPBan(ip, pathname);
    } catch (err) {
      logger.warn('IP ban triggered', { message: err.message, ip, pathname });
      return NextResponse.json({ detail: err.message }, { status: 429, headers: securityHeaders });
    }
    try {
      const session = await auth();
      const userId = session?.user?.id || null;
      await dynamicRateLimit(ip, userId, pathname);
      logger.info('Rate limit passed for record-mint', { userId: mask(userId), ip });
    } catch (err) {
      logger.warn('Rate limit triggered', { message: err.message, ip, pathname });
      return NextResponse.json({ detail: err.message }, { status: 429, headers: securityHeaders });
    }
    try {
      const res = await handler(request);
      const newHeaders = new Headers(res.headers || {});
      Object.entries(securityHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      newHeaders.set('Access-Control-Allow-Credentials', 'true');
      let allowOrigin = 'https://xynapseai.net';
      if (origin && allowedOrigins.includes(origin)) {
        allowOrigin = origin;
      } else if (origin === 'null' && referer) {
        const refUrl = new URL(referer);
        allowOrigin = refUrl.origin;
        if (!allowedOrigins.includes(allowOrigin)) {
          allowOrigin = allowedOrigins[0] || 'https://xynapseai.net';
        }
      }
      newHeaders.set('Access-Control-Allow-Origin', allowOrigin);
      newHeaders.set('Access-Control-Allow-Methods', 'POST');
      newHeaders.set('Access-Control-Allow-Headers', 'Content-Type,X-Recaptcha-Token,X-CSRF-Token');
      logger.info('Set CORS origin for record-mint:', { allowOrigin, origin, referer });
      return new NextResponse(res.body, { status: res.status || 200, headers: newHeaders });
    } catch (err) {
      logger.error(`Handler error in record-mint: ${err.message}`, { stack: err.stack, ip, pathname });
      return NextResponse.json({ detail: `Internal Server Error: ${err.message}` }, { status: 500, headers: securityHeaders });
    }
  });

const postSchema = z.object({
  txHash: z.string().min(1, 'txHash is required'),
  uid: z.string().min(1, 'UID is required'),
  walletAddress: z.string().min(42, 'Wallet address is invalid'),
});

const NFT_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
];

const BASE_RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const provider = new ethers.JsonRpcProvider(BASE_RPC);
const CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS || '0x22EE9eE1a5986ff354d34ed19Eb28E65091C7648';

export async function POST(request) {
  return rateLimitedHandler(async (request) => {
    try {
      const session = await auth();
      const userId = session?.user?.id || null;
      if (!session || !userId) {
        await trackViolation(getClientIp(request), request.url, 'Unauthenticated request');
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
      }
      let newCsrfToken;
      const csrfOk = await checkDoubleSubmitCSRF(request, getClientIp(request), userId);
      if (!csrfOk) {
        newCsrfToken = await setCSRFToken(getClientIp(request), userId);
        const headers = { ...securityHeaders };
        if (newCsrfToken) {
          const sameSite = process.env.NODE_ENV === 'production' ? 'none' : 'lax';
          headers['Set-Cookie'] = cookie.serialize('csrf_token', newCsrfToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite,
            maxAge: 15 * 60,
            path: '/',
          });
        }
        return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403, headers });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        newCsrfToken = newCsrfToken || await setCSRFToken(getClientIp(request), userId);
        await trackViolation(getClientIp(request), request.url, 'Invalid JSON body');
        const headers = { ...securityHeaders };
        if (newCsrfToken) {
          const sameSite = process.env.NODE_ENV === 'production' ? 'none' : 'lax';
          headers['Set-Cookie'] = cookie.serialize('csrf_token', newCsrfToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite,
            maxAge: 15 * 60,
            path: '/',
          });
        }
        return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers });
      }

      let parsedBody;
      try {
        parsedBody = postSchema.parse(body);
      } catch {
        newCsrfToken = newCsrfToken || await setCSRFToken(getClientIp(request), userId);
        await trackViolation(getClientIp(request), request.url, 'Invalid input data');
        const headers = { ...securityHeaders };
        if (newCsrfToken) {
          const sameSite = process.env.NODE_ENV === 'production' ? 'none' : 'lax';
          headers['Set-Cookie'] = cookie.serialize('csrf_token', newCsrfToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite,
            maxAge: 15 * 60,
            path: '/',
          });
        }
        return NextResponse.json({ detail: 'Invalid input data' }, { status: 400, headers });
      }

      const { txHash, uid, walletAddress } = parsedBody;
      if (session.user.id !== uid) {
        newCsrfToken = newCsrfToken || await setCSRFToken(getClientIp(request), userId);
        const headers = { ...securityHeaders };
        if (newCsrfToken) {
          const sameSite = process.env.NODE_ENV === 'production' ? 'none' : 'lax';
          headers['Set-Cookie'] = cookie.serialize('csrf_token', newCsrfToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite,
            maxAge: 15 * 60,
            path: '/',
          });
        }
        await trackViolation(getClientIp(request), request.url, 'Unauthorized user update');
        return NextResponse.json({ detail: 'Not authorized' }, { status: 401, headers });
      }

      try {
        if (!txHash || !ethers.isHexString(txHash, 32)) {
          return NextResponse.json({ detail: 'Invalid txHash format' }, { status: 400 });
        }
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt || receipt.status !== 1) {
          return NextResponse.json({ detail: 'Invalid or failed transaction' }, { status: 400 });
        }
        if (receipt.from.toLowerCase() !== walletAddress.toLowerCase()) {
          return NextResponse.json({ detail: 'Transaction not from your wallet' }, { status: 403 });
        }
        const iface = new ethers.Interface(NFT_ABI);
        const tx = await provider.getTransaction(txHash);
        if (tx) {
          const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
          if (decoded.name !== 'mint' || tx.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
            return NextResponse.json({ detail: 'Not a valid mint transaction to contract' }, { status: 400 });
          }
        }
      } catch (rpcErr) {
        logger.error('RPC error verifying tx:', { txHash, error: rpcErr.message });
        return NextResponse.json({ detail: 'Failed to verify transaction on chain' }, { status: 500 });
      }

      try {
        const user = await withRetry(() => prisma.users.findUnique({ where: { id: uid } }));
        if (!user) {
          return NextResponse.json({ detail: 'User not found' }, { status: 404 });
        }
        if (user.has_minted_nft) {
          return NextResponse.json({ detail: 'Already minted' }, { status: 400 });
        }
      } catch (dbErr) {
        logger.error('DB error checking mint status:', { uid, error: dbErr.message });
        return NextResponse.json({ detail: 'Server error checking status' }, { status: 500 });
      }

      try {
        await withRetry(() =>
          prisma.users.update({
            where: { id: uid },
            data: { has_minted_nft: true }
          })
        );
        try {
          const client = await getRedisClient();
          if (client) {
            const cacheKey = user.wallet_address ? `user:${user.wallet_address}` : `user:${uid}`;
            await client.del(cacheKey);
          } else {
            logger.warn('Skipped cache invalidate due to Redis unavailable');
          }
        } catch (cacheErr) {
          if (process.env.NODE_ENV !== 'production') {
            logger.warn('Failed to clear cache for user', { id: mask(uid), err: cacheErr?.message });
          }
        }
      } catch (updateErr) {
        logger.error('DB error updating mint status:', { uid, error: updateErr.message });
        return NextResponse.json({ detail: 'Server error updating status' }, { status: 500 });
      }

      newCsrfToken = newCsrfToken || await setCSRFToken(getClientIp(request), userId);
      const headers = { ...securityHeaders };
      if (newCsrfToken) {
        const sameSite = process.env.NODE_ENV === 'production' ? 'none' : 'lax';
        headers['Set-Cookie'] = cookie.serialize('csrf_token', newCsrfToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite,
          maxAge: 15 * 60,
          path: '/',
        });
      }
      return NextResponse.json(
        { success: true, detail: 'Mint recorded successfully' },
        { headers }
      );
    } catch (error) {
      logger.error('Unexpected error in /api/record-mint POST', { error: error.message, stack: error.stack, ip: getClientIp(request) });
      return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: securityHeaders });
    }
  })(request);
}

process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  logger.info('Redis connection closed on SIGTERM');
});
process.on('SIGINT', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  logger.info('Redis connection closed on SIGINT');
});