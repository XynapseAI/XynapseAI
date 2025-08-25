// app/api/auth/[...nextauth]/route.js
import NextAuth from "next-auth";
import { authOptions } from "./options";
import Bottleneck from "bottleneck";
import { createClient } from "redis";
import { logger } from "@/utils/serverLogger";
import { NextResponse } from "next/server";

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on("error", (err) => logger.error("Redis Client Error", err));
    await redisClient.connect();
    logger.info("Redis connected");
  }
  return redisClient;
}

// ================= Rate Limit =================
async function checkRateLimit(ip) {
  const client = await getRedisClient();
  const key = `rate_limit:auth:${ip}`;
  const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || 60 * 1000);
  const maxRequests = parseInt(process.env.AUTH_RATE_LIMIT_MAX || 30);

  const requests = (await client.get(key)) || 0;
  if (requests >= maxRequests) throw new Error("Too many requests, please try again later!");
  await client.multi().incr(key).expire(key, windowMs / 1000).exec();
}

const limiter = new Bottleneck({ maxConcurrent: 5, minTime: 200 });

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai.vercel.app',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://*.xynapseai.net',
].filter((v, i, a) => a.indexOf(v) === i);

function isAllowedOrigin(origin, referer, pathname) {
  logger.info('Checking origin', { origin, referer, pathname, allowedOrigins });
  try {
    // Allow Google OAuth callback
    if (pathname.includes('/api/auth/callback/google') && referer && referer.startsWith('https://accounts.google.com/')) {
      logger.info('Allowing Google OAuth callback', { referer });
      return true;
    }

    // Check Origin
    if (origin) {
      if (allowedOrigins.includes(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      const hostname = new URL(origin).hostname;
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.vercel.app') ||
        hostname.endsWith('xynapseai.net')
      ) {
        logger.info('Dynamic domain allowed', { origin, hostname });
        return true;
      }
    }

    // Check Referer if Origin is null
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      const hostname = new URL(refOrigin).hostname;
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.vercel.app') ||
        hostname.endsWith('xynapseai.net')
      ) {
        logger.info('Referer dynamic domain allowed', { referer, hostname });
        return true;
      }
    }

    // Allow internal/SSR requests or development mode
    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }

    logger.error('CORS blocked', { origin, referer, pathname });
    return false;
  } catch (err) {
    logger.error('Error in isAllowedOrigin', { error: err.message, origin, referer, pathname });
    return false;
  }
}

// ================= Rate Limit + CORS wrapper =================
const rateLimitedHandler = (handler) =>
  limiter.wrap(async (req, ...args) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    const pathname = req.nextUrl.pathname;

    logger.info(`Auth Request: IP=${ip}, Origin=${origin || "null"}, Referer=${referer || "null"}, Pathname=${pathname}`);

    if (!isAllowedOrigin(origin, referer, pathname)) {
      logger.error(`CORS blocked: Origin=${origin || "null"}, Referer=${referer || "null"}, Pathname=${pathname}`);
      return NextResponse.json({ detail: "CORS Not Allowed" }, { status: 403 });
    }

    try {
      await checkRateLimit(ip);
    } catch (err) {
      return NextResponse.json({ detail: err.message }, { status: 429 });
    }

    const res = await handler(req, ...args);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
    res.headers.set("Access-Control-Allow-Origin", allowOrigin);
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token");
    res.headers.set("Access-Control-Allow-Credentials", "true");

    // Remove Location header for sign-out to prevent unwanted redirect
    if (pathname.includes('/api/auth/signout')) {
      res.headers.delete('Location');
    }

    return res;
  });

// NextAuth Handlers
const { handlers: { GET: OriginalGET, POST: OriginalPOST } } = NextAuth(authOptions);
export const GET = rateLimitedHandler(OriginalGET);
export const POST = rateLimitedHandler(OriginalPOST);

// Close Redis on exit
process.on("SIGTERM", async () => { if (redisClient?.isOpen) await redisClient.quit(); });
process.on("SIGINT", async () => { if (redisClient?.isOpen) await redisClient.quit(); });