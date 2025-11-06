// app/api/auth/[...nextauth]/route.js
import NextAuth from "next-auth";
import { authOptions } from "./options";
import Bottleneck from "bottleneck";
import { createClient } from "redis";
import { logger } from "@/utils/serverLogger";
import { NextResponse } from "next/server";
import { RateLimiterRedis } from "rate-limiter-flexible";
import { query } from "@/utils/postgres";
// ================= Redis Client =================
// (Không thay đổi)
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    redisClient.on("error", (err) => logger.error("Redis Client Error", { error: err.message, stack: err.stack }));
    await redisClient.connect();
    logger.info("Redis connected", { timestamp: new Date().toISOString() });
  }
  return redisClient;
}
// ================= Security Headers =================
// (Không thay đổi)
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self';",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};
// ================= Dynamic Rate Limit =================
async function getAccountAge(userId) {
  if (!userId) return 0;
  try {
    const result = await query("SELECT created_at FROM users WHERE id = $1", [userId]);
    if (!result.rows[0]) return 0;
    const createdAt = new Date(result.rows[0].created_at);
    return Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
  } catch (err) {
    logger.error("Error in getAccountAge", { error: err.message, userId });
    return 0;
  }
}
async function dynamicRateLimit(ip, session, pathname) {
  if (
    pathname === "/api/auth/session" ||
    pathname === "/api/auth/providers" ||
    pathname === "/api/auth/signout" ||
    pathname === "/api/auth/csrf" ||
    pathname.startsWith("/api/auth/signin/") ||
    pathname.startsWith("/api/auth/callback/")
  ) return;
  const redisClient = await getRedisClient();
  const userId = session?.user?.id || ip;
  const isPremium = session?.user?.isPremium || false;
  const accountAge = await getAccountAge(userId);
  const limits = {
    newUser: { points: 50, duration: 15 * 60 },
    regularUser: { points: 100, duration: 15 * 60 },
    premiumUser: { points: 500, duration: 15 * 60 },
  };
  const limitType = isPremium ? "premiumUser" : accountAge < 7 ? "newUser" : "regularUser";
  const rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: `rate_limit:auth:${userId}`,
    ...limits[limitType],
  });
  try {
    await rateLimiter.consume(userId);
  } catch (err) {
    logger.error("Rate limit error", { error: err.message, userId, pathname });
    const secs = err?.msBeforeNext ? Math.ceil(err.msBeforeNext / 1000) : 60;
    throw new Error(`Rate limit exceeded. Try again in ${secs} seconds.`);
  }
}
// ================= IP Ban Logic =================
async function banIP(ip, durationSeconds = 3600) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, "banned");
  logger.info("IP banned", { ip, durationSeconds });
}
async function checkIPBan(ip, pathname) {
  if (
    pathname === "/api/auth/session" ||
    pathname === "/api/auth/providers" ||
    pathname === "/api/auth/signout" ||
    pathname === "/api/auth/csrf" ||
    pathname.startsWith("/api/auth/signin/") ||
    pathname.startsWith("/api/auth/callback/")
  ) return;
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    logger.error("IP ban detected", { ip, pathname });
    throw new Error("IP temporarily banned due to excessive violations.");
  }
}
async function trackViolation(ip, pathname, reason = "Unknown") {
  if (
    pathname === "/api/auth/session" ||
    pathname === "/api/auth/providers" ||
    pathname === "/api/auth/signout" ||
    pathname === "/api/auth/csrf" ||
    pathname.startsWith("/api/auth/signin/") ||
    pathname.startsWith("/api/auth/callback/")
  ) return;
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 10;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;
  if (violations >= maxViolations) {
    await banIP(ip);
    throw new Error("IP banned due to repeated violations.");
  }
  await redisClient.multi().incr(key).expire(key, Math.floor(windowMs / 1000)).exec();
  logger.warn("Violation recorded", { ip, pathname, reason, violations: violations + 1 });
}
// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  "https://xynapseai.net",
  "https://www.xynapseai.net",
  "https://base.xynapseai.net",
  "https://xynapse-ai-xynapse-projects.vercel.app",
].filter((v, i, a) => a.indexOf(v) === i);
async function isAllowedOrigin(origin, referer, pathname) {
  logger.info("Checking origin", { origin, referer, pathname, allowedOrigins });
  try {
    if (pathname.includes("/api/auth/callback/google") && referer?.startsWith("https://accounts.google.com/")) {
      logger.info("Allowing Google OAuth callback", { referer });
      return true;
    }
    if (origin && allowedOrigins.includes(origin)) {
      logger.info("Origin allowed", { origin });
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) {
        logger.info("Referer origin allowed", { referer, refOrigin });
        return true;
      }
    }
    if (!origin && !referer) {
      logger.info("Allowing internal/SSR request");
      return true;
    }
    if (!origin && process.env.NODE_ENV === "production") {
      logger.error("Null origin blocked in production", { pathname });
      await trackViolation(referer || "unknown", pathname, "Null origin in production");
      return false;
    }
    if (!origin && process.env.NODE_ENV === "development") {
      logger.warn("Origin is null, allowing in development mode");
      return true;
    }
    logger.error("CORS blocked", { origin, referer, pathname });
    await trackViolation(origin || referer || "unknown", pathname, "CORS blocked");
    return false;
  } catch (err) {
    logger.error("Error in isAllowedOrigin", { error: err.message, origin, referer, pathname });
    await trackViolation(origin || referer || "unknown", pathname, "CORS error");
    return false;
  }
}
// ================= Rate Limit + CORS wrapper =================
const limiter = new Bottleneck({ maxConcurrent: 5, minTime: 200 });
const rateLimitedHandler = (handler) =>
  limiter.wrap(async (req, ...args) => {
    const pathname = req?.nextUrl?.pathname || new URL(req.url).pathname;
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    logger.info(`Auth Request: IP=${ip}, Origin=${origin || "null"}, Referer=${referer || "null"}, Pathname=${pathname}`);
    if (pathname === "/api/auth/session" || pathname === "/api/auth/providers" || pathname === "/api/auth/signout" || pathname === "/api/auth/csrf") {
      try {
        return await handler(req, ...args);
      } catch (err) {
        logger.error("NextAuth handler error (session/providers/signout/csrf)", { error: err.message, stack: err.stack });
        return NextResponse.json({ detail: `Internal Server Error: ${err.message}` }, { status: 500, headers: securityHeaders });
      }
    }
    if (!(await isAllowedOrigin(origin, referer, pathname))) {
      return NextResponse.json({ detail: "CORS Not Allowed" }, { status: 403, headers: securityHeaders });
    }
    try {
      await checkIPBan(ip, pathname);
      let session = null;
      try {
        const mod = await import("next-auth");
        const getServerSession = mod.getServerSession ?? mod.getServerSession;
        if (typeof getServerSession === "function") {
          try {
            session = await (getServerSession.length >= 1 ? getServerSession(authOptions) : getServerSession());
          } catch (e) {
            logger.debug("getServerSession call failed (ignored)", { error: e.message });
          }
        }
      } catch (e) {
        logger.debug("dynamic import next-auth/getServerSession failed (ok to ignore)", { error: e.message });
      }
      await dynamicRateLimit(ip, session, pathname);
    } catch (err) {
      logger.warn("Rate limit / IP ban triggered", { message: err.message, ip, pathname });
      return NextResponse.json({ detail: err.message }, { status: 429, headers: securityHeaders });
    }
    try {
      const res = await handler(req, ...args);
      const newHeaders = new Headers(res.headers || {});
      Object.entries(securityHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      // Fix: Explicit cho auth paths - allow credentials & origins
      if (pathname.startsWith('/api/auth/')) {
        newHeaders.set('Access-Control-Allow-Credentials', 'true');
        if (origin && allowedOrigins.includes(origin)) {
          newHeaders.set('Access-Control-Allow-Origin', origin); // Specific origin
          newHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
          newHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token,X-Recaptcha-Token,Cookie');
        }
      }
      return new NextResponse(res.body, { status: res.status || 200, headers: newHeaders });
    } catch (err) {
      logger.error(`Handler error: ${err.message}`, { stack: err.stack, ip: ip, pathname });
      return NextResponse.json({ detail: `Internal Server Error: ${err.message}` }, { status: 500, headers: securityHeaders });
    }
  });
// ================= NextAuth Handlers =================
const finalAuthOptions = {
  ...authOptions,
  events: {
    async signOut({ token }) {
      if (token && token.sub) {
        logger.info(`SignOut event triggered for user: ${token.sub}. Deleting Redis session.`);
        try {
          const client = await getRedisClient();
          const key = `session:${token.sub}`;
          const result = await client.del(key);
          if (result > 0) {
            logger.info(`Successfully deleted Redis session key: ${key}`);
          } else {
            logger.warn(`Redis session key not found for deletion: ${key}`);
          }
        } catch (error) {
          logger.error("Error deleting Redis session on signOut event", {
            error: error.message,
            userId: token.sub,
          });
        }
      } else {
        logger.warn("SignOut event triggered, but no token.sub (user ID) found to delete Redis session.");
      }
    },
  },
};
const {
  handlers: { GET: OriginalGET, POST: OriginalPOST },
} = NextAuth(finalAuthOptions);
export const GET = rateLimitedHandler(OriginalGET);
export const POST = rateLimitedHandler(OriginalPOST);
// ================= Graceful shutdown =================
process.on("SIGTERM", async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  logger.info("Redis connection closed on SIGTERM");
});
process.on("SIGINT", async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  logger.info("Redis connection closed on SIGINT");
});