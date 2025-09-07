import { NextResponse } from "next/server";
import axios from "axios";
import { z } from "zod";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { logger } from "../../../utils/serverLogger";
import Bottleneck from "bottleneck";
import { createClient } from "redis";
import { GECKOTERMINAL_CHAIN_MAPPING } from "../../../utils/constants";
import { query } from "../../../utils/postgres";

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
  "Content-Security-Policy": "default-src 'self';",
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
  const maxViolations = 100;
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    keyPrefix: `rate_limit:dex:${userId}`,
    ...limits[limitType],
  });
  try {
    await rateLimiter.consume(userId);
  } catch (err) {
    throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(err.msBeforeNext / 1000)} seconds.`);
  }
}

// ================= HMAC Verification =================
function verifyHMAC(body, signature) {
  const hmac = crypto.createHmac("sha256", process.env.HMAC_SECRET);
  const payloadString = JSON.stringify(body, Object.keys(body).sort());
  hmac.update(payloadString);
  return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(hmac.digest("hex"), "hex"));
}

// ================= Body Size Limit =================
async function limitBodySize(request, maxSize = 1024 * 1024) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > maxSize) {
    throw new Error("Request body too large");
  }
  return request;
}

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  "https://xynapseai.net",
  "https://www.xynapseai.net",
  "https://xynapse-ai-xynapse-projects.vercel.app",
].filter((v, i, a) => a.indexOf(v) === i);

// ================= Rate Limiter =================
const limiterBottleneck = new Bottleneck({
  maxConcurrent: 15,
  minTime: 100,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  return await axios.get(url, config);
});

const bodySchema = z.object({
  chain: z.enum(Object.keys(GECKOTERMINAL_CHAIN_MAPPING), { message: "Invalid chain" }),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token address"),
});

const CACHE_DURATION = 15 * 60;

export async function POST(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const origin = request.headers.get("origin");
  logger.info(`Request to /api/dex from IP ${ip}`, { origin });

  if (!allowedOrigins.includes(origin)) {
    logger.warn(`CORS error: Origin ${origin} not allowed`, { ip });
    return NextResponse.json({ detail: "Not allowed by CORS" }, { status: 403, headers: securityHeaders });
  }

  try {
    await checkIPBan(ip);
    await limitBodySize(request);
  } catch (err) {
    await trackViolation(ip);
    return NextResponse.json({ detail: err.message }, { status: 400, headers: securityHeaders });
  }

  const token = request.headers.get("authorization")?.split(" ")[1];
  let userId;
  try {
    if (!token) throw new Error("No token provided");
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch (error) {
    await trackViolation(ip);
    logger.error("JWT verification failed:", { message: error.message, ip });
    return NextResponse.json({ detail: "Unauthorized: Invalid token" }, { status: 401, headers: securityHeaders });
  }

  try {
    await checkRateLimit(userId, ip);
  } catch (err) {
    await trackViolation(ip);
    return NextResponse.json({ detail: err.message }, { status: 429, headers: securityHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400, headers: securityHeaders });
  }

  const signature = request.headers.get("x-hmac-signature");
  if (!signature || !verifyHMAC(body, signature)) {
    await trackViolation(ip);
    return NextResponse.json({ detail: "Invalid HMAC signature" }, { status: 401, headers: securityHeaders });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: "Validation failed", errors: err.errors }, { status: 400, headers: securityHeaders });
  }

  const { chain, tokenAddress } = parsedBody;
  logger.info("Processing DEX request:", { chain, tokenAddress: tokenAddress.slice(0, 6) + "...", ip });

  const cacheKey = `dex-${chain}-${tokenAddress}`;
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    logger.info("Serving DEX data from cache:", { cacheKey });
    return NextResponse.json(JSON.parse(cachedData), {
      headers: {
        ...securityHeaders,
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-HMAC-Signature",
      },
    });
  }

  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/${GECKOTERMINAL_CHAIN_MAPPING[chain]}/tokens/${tokenAddress}/pools?page=1`;
    const response = await fetchWithRateLimit(url, {
      headers: { accept: "application/json" },
      timeout: 10000,
    });

    await redisClient.setEx(cacheKey, CACHE_DURATION, JSON.stringify(response.data));
    logger.info("DEX data fetched and cached:", { cacheKey, poolCount: response.data?.data?.length || 0 });

    return NextResponse.json(response.data, {
      headers: {
        ...securityHeaders,
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-HMAC-Signature",
      },
    });
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

    if (cachedData) {
      logger.info("Serving stale DEX data due to error:", { cacheKey });
      return NextResponse.json(JSON.parse(cachedData), {
        headers: {
          ...securityHeaders,
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-HMAC-Signature",
        },
      });
    }

    return NextResponse.json({ detail }, { status, headers: securityHeaders });
  }
}