import { NextResponse } from "next/server";
import axios from "axios";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { verifyRecaptcha } from "../../../utils/verifyRecaptcha";
import { logger } from "../../../utils/serverLogger";
import { createClient } from "redis";
import crypto from "crypto";
import cookie from "cookie";
import Bottleneck from "bottleneck";
import { GECKOTERMINAL_CHAIN_MAPPING } from "../../../utils/constants";

// ================= Environment Variable Validation =================
function validateEnvVars() {
  const requiredVars = ['DATABASE_URL', 'REDIS_URL', 'NEXT_PUBLIC_APP_URL'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (process.env.NODE_ENV !== 'production') {
    logger.info('All required environment variables validated');
  }
}

validateEnvVars();

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (redisClient?.isOpen) {
    return redisClient;
  }
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

// ================= Utility Functions =================
function getClientIp(request) {
  const xForwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const xRealIp = request.headers.get('x-real-ip')?.trim();
  const vercelIp = request.headers.get('x-vercel-forwarded-for')?.trim();
  return xRealIp || vercelIp || xForwardedFor || 'unknown';
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

  if (process.env.NODE_ENV !== 'production') {
    logger.info('Checking CSRF tokens', {
      headerToken: headerToken ? 'provided' : 'missing',
      cookieToken: cookieToken ? 'provided' : 'missing',
    });
  }

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

  if (process.env.NODE_ENV === 'development') {
    const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
    if (!valid && process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token mismatch in development', {
        headerToken: mask(headerToken),
        cookieToken: mask(cookieToken),
      });
    }
    return valid;
  }

  const client = await getRedisClient();
  const storedToken = await client.get(`csrf:${userId || ip}`);
  if (!storedToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token not found in Redis', { key: `csrf:${userId || ip}` });
    }
    return false;
  }

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

async function checkRateLimit(ip, userId) {
  const client = await getRedisClient();
  try {
    const windowSeconds = 15 * 60;
    const ipKey = `rate:ip:${ip}`;
    const userKey = userId ? `rate:user:${userId}` : null;
    const ipMax = process.env.NODE_ENV === 'development' ? 1000 : 500;
    const userMax = process.env.NODE_ENV === 'development' ? 500 : 200;

    const ipCount = Number(await client.incr(ipKey));
    if (ipCount === 1) await client.expire(ipKey, windowSeconds);
    if (ipCount > ipMax) {
      const ttl = await client.ttl(ipKey);
      throw Object.assign(new Error('Too many requests from this IP'), { ttl });
    }

    if (userKey) {
      const uCount = Number(await client.incr(userKey));
      if (uCount === 1) await client.expire(userKey, windowSeconds);
      if (uCount > userMax) {
        const ttl = await client.ttl(userKey);
        throw Object.assign(new Error('Too many requests for this user'), { ttl });
      }
    }
  } finally {
    await client.quit().catch(err => {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Redis disconnect failed', { err: err?.message });
      }
    });
  }
}

async function trackViolation(ip, reason, severity = 'warn') {
  if (severity === 'warn') {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Violation recorded (warning)', { ip, reason });
    }
    return;
  }

  const client = await getRedisClient();
  try {
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
      logger.warn('Violation recorded (severe)', { ip, reason, violations: violations + 1 });
    }
  } finally {
    await client.quit().catch(err => {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Redis disconnect failed', { err: err?.message });
      }
    });
  }
}

async function isAllowedOrigin(origin, referer, pathname, ip) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    return configured.includes(origin) || configured.includes(referer ? new URL(referer).origin : null);
  }

  try {
    if (!origin && !referer) {
      await trackViolation(ip, 'Missing origin and referer in production');
      return false;
    }

    if (origin && origin !== 'null') {
      if (!origin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS origin in production');
        return false;
      }
      if (configured.includes(origin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid origin');
      return false;
    }

    if (referer) {
      const refOrigin = new URL(referer).origin;
      if (!refOrigin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS referer in production');
        return false;
      }
      if (configured.includes(refOrigin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid referer');
      return false;
    }

    await trackViolation(ip, 'Invalid origin or referer');
    return false;
  } catch {
    await trackViolation(ip, 'Error validating origin');
    return false;
  }
}

function securityHeaders(csrfToken = null) {
  const csp = "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  const headers = {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
  if (csrfToken) {
    headers['Set-Cookie'] = cookie.serialize('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60,
      path: '/',
    });
  }
  return headers;
}

const bodySchema = z.object({
  chain: z.enum(Object.keys(GECKOTERMINAL_CHAIN_MAPPING), { message: "Invalid chain" }),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token address"),
});

const CACHE_DURATION = 15 * 60;

// ================= Rate Limiter for External API =================
const limiterBottleneck = new Bottleneck({
  maxConcurrent: 15,
  minTime: 100,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  return await axios.get(url, config);
});

export async function OPTIONS(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  if (process.env.NODE_ENV !== 'production') {
    logger.info('POST /api/dex requested', { ip, pathname });
  }

  if (!(await isAllowedOrigin(origin, referer, pathname, ip))) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    if (!session || !userId) {
      await trackViolation(ip, 'Unauthenticated request');
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      await trackViolation(ip, err.message);
      return NextResponse.json(
        { detail: 'Too many requests' },
        { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
      );
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid CSRF token');
      return NextResponse.json({ detail: 'Invalid CSRF token. Please try again.' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token');
    if (!recaptchaToken && process.env.NODE_ENV !== 'development') {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Missing reCAPTCHA token');
      return NextResponse.json({ detail: 'Missing reCAPTCHA token' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'dex_request', ip);
        if (score < 0.7) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          await trackViolation(ip, 'reCAPTCHA score too low');
          return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score });
        }
      } catch {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        await trackViolation(ip, 'reCAPTCHA verification failed');
        return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid JSON body');
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    let parsedBody;
    try {
      parsedBody = bodySchema.parse(body);
    } catch (err) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid input data');
      return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const { chain, tokenAddress } = parsedBody;
    logger.info("Processing DEX request:", { chain, tokenAddress: tokenAddress.slice(0, 6) + "...", ip });

    let redisClient;
    try {
      redisClient = await getRedisClient();
      const cacheKey = `dex-${chain}-${tokenAddress}`;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info("Serving DEX data from cache:", { cacheKey });
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders(newCsrfToken) });
      }

      const url = `https://api.geckoterminal.com/api/v2/networks/${GECKOTERMINAL_CHAIN_MAPPING[chain]}/tokens/${tokenAddress}/pools?page=1`;
      const response = await fetchWithRateLimit(url, {
        headers: { accept: "application/json" },
        timeout: 10000,
      });

      await redisClient.setEx(cacheKey, CACHE_DURATION, JSON.stringify(response.data));
      logger.info("DEX data fetched and cached:", { cacheKey, poolCount: response.data?.data?.length || 0 });

      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json(response.data, { headers: securityHeaders(newCsrfToken) });
    } catch (error) {
      logger.error("Error fetching DEX data:", {
        status: error.response?.status,
        detail: error.response?.data || error.message,
        ip,
      });
      const status = error.response?.status || 500;
      const detail =
        status === 429
          ? "GeckoTerminal API rate limit exceeded. Please try again later."
          : status === 404
          ? `No DEX data found for token ${tokenAddress} on ${chain}.`
          : "An unexpected error occurred while fetching DEX data";

      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ detail }, { status, headers: securityHeaders(newCsrfToken) });
    } finally {
      if (redisClient) {
        await redisClient.quit().catch(err => {
          if (process.env.NODE_ENV !== 'production') {
            logger.warn('Redis disconnect failed in POST', { err: err?.message });
          }
        });
      }
    }
  } catch {
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
  }
}