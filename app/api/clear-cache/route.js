import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "../../../utils/serverLogger";
import { createClient } from "redis";

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
      legacyMode: false,
    });
    redisClient.on("error", (err) => logger.error("Redis Client Error", { error: err.message, stack: err.stack }));
    await redisClient.connect();
    logger.info("Redis connected", { timestamp: new Date().toISOString() });
  }
  return redisClient;
}

// ================= Security Headers =================
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  "https://xynapseai.net",
  "https://www.xynapseai.net",
  "https://xynapse-ai-xynapse-projects.vercel.app",
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/xynapse-ai-[a-z0-9-]+\.vercel\.app$/;

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info("No Origin or Referer (likely SSR or server-to-server), allowing request");
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info("No valid Origin or Referer, allowing for SSR compatibility");
    return true;
  }
  if (allowedOrigins.includes(checkOrigin)) {
    logger.info(`Origin allowed: ${checkOrigin}`);
    return true;
  }
  if (process.env.VERCEL_ENV !== "production" && vercelPreviewRegex.test(checkOrigin)) {
    logger.info(`Origin allowed by Vercel preview regex: ${checkOrigin}`);
    return true;
  }
  logger.error(`CORS error: Origin ${checkOrigin || "null"} not allowed`);
  return false;
}

// ================= Rate Limit =================
async function checkRateLimit(userId, ip) {
  const redisClient = await getRedisClient();
  const rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: `rate_limit:clear-cache:user:${userId}`,
    points: 200,
    duration: 60 * 60,
    execEvenly: false,
    blockDuration: 60,
  });

  try {
    await rateLimiter.consume(userId);
    logger.info(`Rate limit check passed for user ${userId}`, { ip });
    return null;
  } catch (err) {
    const msBeforeReset = err.msBeforeNext || 60 * 60 * 1000;
    logger.warn(`Rate limit exceeded for user ${userId}`, { ip, msBeforeReset });
    return NextResponse.json(
      { success: false, detail: `Too many requests. Please try again in ${Math.ceil(msBeforeReset / 1000)} seconds.` },
      {
        status: 429,
        headers: { ...securityHeaders, "Retry-After": Math.ceil(msBeforeReset / 1000).toString() },
      }
    );
  }
}

// ================= CSRF Check =================
async function checkCSRF(request, session) {
  const csrfToken = request.headers.get("x-csrf-token");
  if (process.env.NODE_ENV === "development") return true;
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn("Invalid CSRF token", { ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown" });
    return false;
  }
  return true;
}

export async function POST(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  logger.info(`Request to /api/clear-cache from IP ${ip}`, { origin, referer });

  // Kiểm tra CORS
  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || "null"} not allowed`);
    return NextResponse.json({ detail: "Not allowed by CORS" }, { status: 403, headers: securityHeaders });
  }

  // Kiểm tra session
  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn("Session not authenticated or missing user ID", { ip, session });
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401, headers: securityHeaders });
  }

  // Kiểm tra rate limit
  const rateLimitResponse = await checkRateLimit(session.user.id, ip);
  if (rateLimitResponse) return rateLimitResponse;

  // Kiểm tra CSRF
  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: "Invalid CSRF token" }, { status: 403, headers: securityHeaders });
  }

  // Xử lý body
  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: "Invalid JSON body" }, { status: 400, headers: securityHeaders });
  }

  const { cacheKeys } = body;
  if (!Array.isArray(cacheKeys) || cacheKeys.length === 0) {
    logger.warn("Missing or invalid cacheKeys parameter", { ip });
    return NextResponse.json({ success: false, detail: "Missing or invalid cacheKeys parameter" }, { status: 400, headers: securityHeaders });
  }

  try {
    const redisClient = await getRedisClient();
    // Kiểm tra xem Redis có sẵn sàng không
    await redisClient.ping();
    // Xóa từng key một cách an toàn
    const deletePromises = cacheKeys.map((key) => redisClient.del(key).catch((err) => {
      logger.error(`Failed to delete cache key ${key}: ${err.message}`, { stack: err.stack });
      return 0;
    }));
    const results = await Promise.all(deletePromises);
    const deletedCount = results.reduce((sum, count) => sum + count, 0);
    logger.info(`Cleared ${deletedCount} cache keys: ${cacheKeys.join(", ")}`, { userId: session.user.id, ip });
    return NextResponse.json({ success: true, message: `Cleared ${deletedCount} cache keys successfully` }, {
      headers: {
        ...securityHeaders,
        "Access-Control-Allow-Origin": origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type,X-CSRF-Token",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  } catch (error) {
    logger.error(`Failed to clear cache: ${error.message}`, { stack: error.stack, userId: session.user.id, ip });
    return NextResponse.json({ success: false, detail: `Failed to clear cache: ${error.message}` }, { status: 500, headers: securityHeaders });
  }
}