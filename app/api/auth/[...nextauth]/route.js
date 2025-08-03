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
  const maxRequests = parseInt(process.env.AUTH_RATE_LIMIT_MAX || 10);

  const requests = (await client.get(key)) || 0;
  if (requests >= maxRequests) throw new Error("Too many requests, slow down!");
  await client.multi().incr(key).expire(key, windowMs / 1000).exec();
}

const limiter = new Bottleneck({ maxConcurrent: 5, minTime: 200 });

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  "http://localhost:3000",
  "https://xynapseai.net",
  "https://www.xynapseai.net",
  'https://xynapse-ai.vercel.app', 
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

// Function kiểm tra Origin / Referer
function isAllowedOrigin(origin, referer) {
  try {
    // 1. Nếu có Origin và hợp lệ
    if (origin) {
      if (allowedOrigins.includes(origin)) return true;
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith(".vercel.app")) return true;
    }
    // 2. Nếu Origin null nhưng Referer hợp lệ
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) return true;
      const hostname = new URL(refOrigin).hostname;
      if (hostname.endsWith(".vercel.app")) return true;
    }
    // 3. Nếu cả Origin và Referer null (SSR hoặc internal)
    if (!origin && !referer) return true;

    return false;
  } catch {
    return false;
  }
}

// ================= Rate Limit + CORS wrapper =================
const rateLimitedHandler = (handler) =>
  limiter.wrap(async (req, ...args) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");

    logger.info(`Auth Request: IP=${ip}, Origin=${origin || "null"}, Referer=${referer || "null"}`);

    if (!isAllowedOrigin(origin, referer)) {
      logger.error(`CORS blocked: Origin=${origin || "null"}, Referer=${referer || "null"}`);
      return NextResponse.json({ detail: "CORS Not Allowed" }, { status: 403 });
    }

    try {
      await checkRateLimit(ip);
    } catch (err) {
      return NextResponse.json({ detail: err.message }, { status: 429 });
    }

    const res = await handler(req, ...args);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL);
    res.headers.set("Access-Control-Allow-Origin", allowOrigin);
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token");
    res.headers.set("Access-Control-Allow-Credentials", "true");

    return res;
  });

// NextAuth Handlers
const { handlers: { GET: OriginalGET, POST: OriginalPOST } } = NextAuth(authOptions);
export const GET = rateLimitedHandler(OriginalGET);
export const POST = rateLimitedHandler(OriginalPOST);

// Close Redis on exit
process.on("SIGTERM", async () => { if (redisClient?.isOpen) await redisClient.quit(); });
process.on("SIGINT", async () => { if (redisClient?.isOpen) await redisClient.quit(); });
