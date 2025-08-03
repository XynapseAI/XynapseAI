// app/api/auth/[...nextauth]/route.js
import NextAuth from "next-auth";
import { authOptions } from "./options";
import Bottleneck from "bottleneck";
import { createClient } from "redis";
import { logger } from "@/utils/serverLogger";
import { NextResponse } from "next/server";

const limiter = new Bottleneck({ maxConcurrent: 5, minTime: 200 });

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

async function checkRateLimit(ip) {
  const client = await getRedisClient();
  const key = `rate_limit:auth:${ip}`;
  const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || 60 * 1000);
  const maxRequests = parseInt(process.env.AUTH_RATE_LIMIT_MAX || 10);

  const requests = (await client.get(key)) || 0;
  if (requests >= maxRequests) throw new Error("Too many requests");
  await client.multi().incr(key).expire(key, windowMs / 1000).exec();
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  "http://localhost:3000",
  "https://xynapseai.net",
  "https://www.xynapseai.net",
  "https://xynapse-ai.vercel.app",
  "https://xynapse-ai-xynapse-projects.vercel.app",
].filter((v, i, a) => a.indexOf(v) === i);

const rateLimitedHandler = (handler) =>
  limiter.wrap(async (req, ...args) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");

    logger.info(`Auth Request: IP=${ip}, Origin=${origin || "null"}, Referer=${referer || "null"}`);

    let isAllowed = false;

    // Nếu Origin có trong danh sách
    if (origin && allowedOrigins.includes(origin)) {
      isAllowed = true;
    }
    // Nếu không có Origin nhưng có Referer
    else if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) isAllowed = true;
    }
    // Nếu cả Origin và Referer đều null => Đây là SSR hoặc NextAuth nội bộ → Cho phép
    else if (!origin && !referer) {
      isAllowed = true;
    }

    if (!isAllowed) {
      return NextResponse.json({ detail: "CORS Not Allowed" }, { status: 403 });
    }


    try {
      await checkRateLimit(ip);
    } catch (err) {
      return NextResponse.json({ detail: err.message }, { status: 429 });
    }

    const res = await handler(req, ...args);
    res.headers.set("Access-Control-Allow-Origin", origin || new URL(referer).origin);
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token");
    res.headers.set("Access-Control-Allow-Credentials", "true");

    return res;
  });

const { handlers: { GET: OriginalGET, POST: OriginalPOST } } = NextAuth(authOptions);

export const GET = rateLimitedHandler(OriginalGET);
export const POST = rateLimitedHandler(OriginalPOST);

// Graceful Redis close
process.on("SIGTERM", async () => { if (redisClient?.isOpen) await redisClient.quit(); });
process.on("SIGINT", async () => { if (redisClient?.isOpen) await redisClient.quit(); });
