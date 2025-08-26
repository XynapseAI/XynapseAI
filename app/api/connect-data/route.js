import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth";
import { logger } from "../../../utils/serverLogger";
import { createClient } from "redis";
import { verifyRecaptcha } from "../../../utils/verifyRecaptcha";
import { RateLimiterRedis } from "rate-limiter-flexible";
import jwt from "jsonwebtoken";
import { query } from "../../../utils/postgres";

const prisma = new PrismaClient({
  errorFormat: "minimal",
  datasources: { db: { url: process.env.DATABASE_URL } },
});

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

// ================= IP Ban Logic =================
async function banIP(ip, durationSeconds = 3600) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, "banned");
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    throw new Error("IP temporarily banned due to excessive violations.");
  }
}

async function trackViolation(ip) {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 5;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;
  if (violations >= maxViolations) {
    await banIP(ip);
    throw new Error("IP banned due to repeated violations.");
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
}

// ================= Dynamic Rate Limit =================
async function getAccountAge(userId) {
  const result = await query("SELECT created_at FROM users WHERE id = $1", [userId]);
  if (!result.rows[0]) return 0;
  const createdAt = new Date(result.rows[0].created_at);
  return Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
}

async function checkRateLimit(userId, ip) {
  const redisClient = await getRedisClient();
  const isPremium = (await query("SELECT is_premium FROM users WHERE id = $1", [userId])).rows[0]?.is_premium || false;
  const accountAge = await getAccountAge(userId);
  const limits = {
    newUser: { points: 50, duration: 15 * 60 },
    regularUser: { points: 100, duration: 15 * 60 },
    premiumUser: { points: 500, duration: 15 * 60 },
  };
  const limitType = isPremium ? "premiumUser" : accountAge < 7 ? "newUser" : "regularUser";
  const rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: `rate_limit:connect-data:${userId}`,
    ...limits[limitType],
  });
  try {
    await rateLimiter.consume(userId);
  } catch (err) {
    const msBeforeReset = err.msBeforeNext || 15 * 60 * 1000;
    logger.warn(`Rate limit exceeded for user ${userId}`, { ip, msBeforeReset });
    return NextResponse.json(
      { detail: `Too many requests. Please try again in ${Math.ceil(msBeforeReset / 1000)} seconds.` },
      { status: 429, headers: { ...securityHeaders, "Retry-After": Math.ceil(msBeforeReset / 1000).toString() } }
    );
  }
}

// ================= JWT Verification =================
async function verifyJWT(request) {
  const token = request.headers.get("authorization")?.split(" ")[1];
  if (!token) throw new Error("No token provided");
  return jwt.verify(token, process.env.JWT_SECRET);
}

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  "https://xynapseai.net",
  "https://www.xynapseai.net",
  "https://xynapse-ai-xynapse-projects.vercel.app",
].filter((v, i, a) => a.indexOf(v) === i);

function isAllowedOrigin(origin, referer) {
  if (allowedOrigins.includes(origin)) return true;
  if (!origin && referer && allowedOrigins.includes(new URL(referer).origin)) return true;
  if (!origin && !referer) return true;
  if (!origin && process.env.NODE_ENV === "development") return true;
  return false;
}

// ================= CSRF Check =================
async function checkCSRF(request, session) {
  const csrfToken = request.headers.get("x-csrf-token");
  if (process.env.NODE_ENV === "development") return true;
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) return false;
  return true;
}

const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
};

async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Database connection failed, retrying after ${delay}ms`, { attempt: i + 1 });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  logger.info(`Request to /api/connect-data from IP ${ip}`, { origin, referer });

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || "null"} not allowed`);
    return NextResponse.json({ detail: "Not allowed by CORS" }, { status: 403, headers: securityHeaders });
  }

  try {
    await checkIPBan(ip);
    await verifyJWT(request);
  } catch (err) {
    await trackViolation(ip);
    return NextResponse.json({ detail: err.message }, { status: 401, headers: securityHeaders });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn("Session not authenticated or missing user ID", { ip, session });
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401, headers: securityHeaders });
  }

  const rateLimitResponse = await checkRateLimit(session.user.id, ip);
  if (rateLimitResponse) return rateLimitResponse;

  const recaptchaToken = request.headers.get("x-recaptcha-token");
  if (!recaptchaToken && process.env.NODE_ENV !== "development") {
    logger.error("Missing X-Recaptcha-Token header", { ip });
    return NextResponse.json({ detail: "Missing reCAPTCHA token in header" }, { status: 400, headers: securityHeaders });
  }

  if (process.env.NODE_ENV !== "development") {
    try {
      const { score } = await verifyRecaptcha(recaptchaToken, "connect_data", ip);
      logger.info("reCAPTCHA verification successful", { token: recaptchaToken.substring(0, 8) + "...", score, ip });
    } catch (error) {
      await trackViolation(ip);
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { token: recaptchaToken.substring(0, 8) + "...", ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403, headers: securityHeaders });
    }
  } else if (recaptchaToken === "development-token") {
    logger.info("Skipping reCAPTCHA in development mode", { ip });
  }

  if (!(await checkCSRF(request, session))) {
    await trackViolation(ip);
    return NextResponse.json({ detail: "Invalid CSRF check." }, { status: 403, headers: securityHeaders });
  }

  try {
    const cacheKey = `connect-data:${session.user.id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for connect-data user ${session.user.id}`, { ip });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          ...securityHeaders,
          "Access-Control-Allow-Origin": origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type, X-Recaptcha-Token, X-CSRF-Token, Authorization",
          "Access-Control-Allow-Credentials": "true",
        },
      });
    }

    const rankings = await withRetry(() =>
      prisma.users.findMany({
        where: { points: { gt: 0 } },
        orderBy: { points: "desc" },
        take: 100,
        select: {
          id: true,
          email: true,
          profile_picture: true,
          google_name: true,
          points: true,
          tier: true,
          twitter_handle: true,
        },
      })
    );

    const serializedRankings = serializeBigInt(rankings);
    const data = { success: true, rankings: serializedRankings };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(data));
    logger.info("Fetched and cached connect-data successfully", { rankingsCount: rankings.length, userId: session.user.id, ip });

    return NextResponse.json(data, {
      headers: {
        ...securityHeaders,
        "Access-Control-Allow-Origin": origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type, X-Recaptcha-Token, X-CSRF-Token, Authorization",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  } catch (error) {
    logger.error("Error fetching connect-data", { message: error.message, stack: error.stack, userId: session.user.id, ip });
    return NextResponse.json({ detail: `Error fetching leaderboard data: ${error.message}` }, { status: 500, headers: securityHeaders });
  } finally {
    await prisma.$disconnect();
  }
}