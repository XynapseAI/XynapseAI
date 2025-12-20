// app/api/clear-cache/route.js
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "../../../utils/serverLogger";
import { createClient } from "redis";
import { RateLimiterRedis } from "rate-limiter-flexible";

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });
    redisClient.on("error", (err) =>
      logger.error("Redis Client Error", { error: err.message, stack: err.stack })
    );
    await redisClient.connect();
    logger.info("Redis connected", { timestamp: new Date().toISOString() });
  }
  return redisClient;
}

// ================= Security Headers =================
const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
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
  "https://base.xynapseai.net",
  "https://xynapse-ai-xynapse-projects.vercel.app",
].filter(Boolean);

const vercelPreviewRegex = /^https:\/\/xynapse-ai-[a-z0-9-]+\.vercel\.app$/;

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info("No Origin or Referer (likely internal request), allowing");
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) return true;

  if (allowedOrigins.includes(checkOrigin)) {
    logger.info(`Origin allowed: ${checkOrigin}`);
    return true;
  }
  if (process.env.VERCEL_ENV !== "production" && vercelPreviewRegex.test(checkOrigin)) {
    logger.info(`Origin allowed (Vercel preview): ${checkOrigin}`);
    return true;
  }
  logger.warn(`CORS blocked: ${checkOrigin}`);
  return false;
}

// ================= Rate Limit =================
async function checkRateLimit(userId, ip) {
  const redisClient = await getRedisClient();
  const rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: `rate_limit:clear-cache:user:${userId}`,
    points: 200, // 200 requests
    duration: 3600, // per hour
    blockDuration: 60, // block 1 minute if exceeded
  });

  try {
    await rateLimiter.consume(userId);
    return null;
  } catch (err) {
    const secsBeforeReset = Math.ceil(err.msBeforeNext / 1000) || 3600;
    logger.warn(`Rate limit exceeded for user ${userId}`, { ip, secsBeforeReset });
    return NextResponse.json(
      {
        success: false,
        detail: `Too many requests. Please try again in ${secsBeforeReset} seconds.`,
      },
      {
        status: 429,
        headers: {
          ...securityHeaders,
          "Retry-After": secsBeforeReset.toString(),
        },
      }
    );
  }
}

// ================= CSRF Check =================
async function checkCSRF(request, session) {
  if (process.env.NODE_ENV === "development") return true;

  const csrfToken = request.headers.get("x-csrf-token");
  if (!csrfToken || csrfToken !== session?.csrfToken) {
    logger.warn("Invalid or missing CSRF token", {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
    });
    return false;
  }
  return true;
}

// ================= POST Handler =================
export async function POST(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  logger.info(`POST /api/clear-cache from IP ${ip}`, { origin, referer });

  // CORS check
  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json(
      { success: false, detail: "Not allowed by CORS" },
      { status: 403, headers: securityHeaders }
    );
  }

  // Authentication
  const session = await auth();
  if (!session?.user?.id) {
    logger.warn("Unauthenticated request to clear-cache", { ip });
    return NextResponse.json(
      { success: false, detail: "Not authenticated" },
      { status: 401, headers: securityHeaders }
    );
  }

  // Rate limit
  const rateLimitResponse = await checkRateLimit(session.user.id, ip);
  if (rateLimitResponse) return rateLimitResponse;

  // CSRF check
  if (!(await checkCSRF(request, session))) {
    return NextResponse.json(
      { success: false, detail: "Invalid CSRF token" },
      { status: 403, headers: securityHeaders }
    );
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn("Invalid JSON body", { ip, error: err.message });
    return NextResponse.json(
      { success: false, detail: "Invalid JSON body" },
      { status: 400, headers: securityHeaders }
    );
  }

  const { cacheKeys } = body;
  if (!Array.isArray(cacheKeys) || cacheKeys.length === 0) {
    logger.warn("Missing or invalid cacheKeys", { ip });
    return NextResponse.json(
      { success: false, detail: "Missing or invalid cacheKeys parameter" },
      { status: 400, headers: securityHeaders }
    );
  }

  // Clear cache in Redis
  try {
    const redisClient = await getRedisClient();
    const deletePromises = cacheKeys.map((key) =>
      redisClient.del(key).catch((err) => {
        logger.error(`Failed to delete key ${key}`, { error: err.message });
        return 0;
      })
    );
    const results = await Promise.all(deletePromises);
    const deletedCount = results.reduce((sum, count) => sum + count, 0);

    logger.info(`Cleared ${deletedCount} cache keys`, {
      userId: session.user.id,
      ip,
      keys: cacheKeys,
    });

    return NextResponse.json(
      { success: true, message: `Cleared ${deletedCount} cache keys successfully` },
      {
        headers: {
          ...securityHeaders,
          "Access-Control-Allow-Origin":
            origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type,X-CSRF-Token",
          "Access-Control-Allow-Credentials": "true",
        },
      }
    );
  } catch (error) {
    logger.error("Failed to clear cache", {
      error: error.message,
      stack: error.stack,
      userId: session.user.id,
      ip,
    });
    return NextResponse.json(
      { success: false, detail: "Internal server error while clearing cache" },
      { status: 500, headers: securityHeaders }
    );
  }
}

// Optional: Allow preflight
export async function OPTIONS(request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (isAllowedOrigin(origin, referer)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...securityHeaders,
        "Access-Control-Allow-Origin":
          origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type,X-CSRF-Token",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }
  return new NextResponse(null, { status: 403 });
}