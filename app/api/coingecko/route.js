import { NextResponse } from "next/server";
import axios from "axios";
import axiosRetry from "axios-retry";
import Bottleneck from "bottleneck";
import { logger } from "../../../utils/serverLogger";
import { createClient } from "redis";

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on("error", (err) => logger.error("Redis Client Error", { error: err.message, stack: err.stack }));
    await redisClient.connect();
    logger.info("Redis connected", { timestamp: new Date().toISOString() });
  }
  return redisClient;
}

// ================= Security Headers =================
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self';",
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
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    logger.error(`IP ban detected: ${ip}`);
    throw new Error("IP temporarily banned due to excessive violations.");
  }
}


async function trackViolation(ip, reason = "Unknown") {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 60;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;
  if (violations >= maxViolations) {
    await banIP(ip);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error("IP banned due to repeated violations.");
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

// ================= Rate Limit =================
async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:coingecko:${ip}`;
  const windowMs = 60 * 1000;
  const maxRequests = 100;
  const requests = parseInt(await redisClient.get(key)) || 0;
  if (requests >= maxRequests) {
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`);
    throw new Error("Too many requests, please try again later.");
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.info(`Rate limit check passed for IP ${ip}: ${requests + 1}/${maxRequests} requests`);
}

// Configure axios-retry
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => {
    logger.info(`Retry attempt ${retryCount} for CoinGecko API`);
    return Math.pow(2, retryCount) * 1000 + Math.random() * 100;
  },
  retryCondition: (error) => error.response?.status === 429 || error.code === "ECONNABORTED",
});


// Rate limiter configuration
const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === "production" ? 15 : 5,
  minTime: process.env.NODE_ENV === "production" ? 400 : 1000,
  reservoir: 30,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000,
});


const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await axios.get(url, {
      ...config,
      headers: {
        ...config.headers,
        "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "",
      },
      timeout: 30000,
    });
    return response;
  } catch (error) {
    logger.error(`Axios error: ${error.message}`, { url, status: error.response?.status });
    throw error;
  }
});

// List of supported CoinGecko currencies
const VALID_CURRENCIES = [
  "usd", "eur", "gbp", "cny", "jpy", "krw", "rub", "inr", "brl", "aud",
  "cad", "chf", "hkd", "sgd", "twd", "thb", "vnd", "php", "idr", "myr",
  "zar", "mxn", "pln", "sek", "nok", "dkk", "czk", "huf", "ron", "try",
  "nzd", "clp", "ars", "cop", "pen", "aed", "sar", "ils", "uah", "egp",
];

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  "https://xynapseai.net",
  "https://www.xynapseai.net",
  "https://xynapse-ai-xynapse-projects.vercel.app",
].filter((v, i, a) => a.indexOf(v) === i);


const vercelPreviewRegex = /^https:\/\/xynapse-ai-[a-z0-9-]+\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (allowedOrigins.includes(origin)) {
    logger.info(`Origin allowed: ${origin}`);
    return true;
  }
  if (vercelPreviewRegex.test(origin || "")) {
    logger.info(`Origin allowed by Vercel preview regex: ${origin}`);
    return true;
  }
  // Allow null origins for server-to-server requests (SSR, API calls)
  if (!origin) {
    logger.info("Origin is null (server-to-server or SSR), allowing request");
    return true;
  }
  logger.error(`CORS error: Origin ${origin || "null"} not allowed`);
  return false;
}


// ================= GET Handler =================
export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const origin = request.headers.get("origin");
  logger.info(`Request to /api/coingecko from IP ${ip}`, { origin, timestamp: new Date().toISOString() });


  // Check CORS
  if (!isAllowedOrigin(origin)) {
    await trackViolation(ip, "CORS blocked");
    return NextResponse.json({ success: false, detail: "Not allowed by CORS" }, { status: 403, headers: securityHeaders });
  }

  // Check IP ban and rate limit
  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    if (err.message.includes("Too many requests")) {
      logger.warn(`Rate limit error for IP ${ip}: ${err.message}`);
      return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers: securityHeaders });
    }
    await trackViolation(ip, err.message);
    return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers: securityHeaders });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const { action = "market-info", ids, vs_currencies = "usd", limit, start, query, id, tokenType, days, address } = params;

  // Validate parameters
  if (
    ["tickers", "coin-details", "exchange-details", "volume-chart"].includes(action) &&
    (!id || typeof id !== "string" || id.trim() === "")
  ) {
    await trackViolation(ip, "Missing or invalid id parameter");
    return NextResponse.json({ success: false, detail: "Missing or invalid id parameter" }, { status: 400, headers: securityHeaders });
  }
  if (action === "public-treasury" && (!tokenType || typeof tokenType !== "string" || tokenType.trim() === "")) {
    await trackViolation(ip, "Missing or invalid tokenType parameter");
    return NextResponse.json({ success: false, detail: "Missing or invalid tokenType parameter" }, { status: 400, headers: securityHeaders });
  }
  if (action === "market-info" && !vs_currencies) {
    await trackViolation(ip, "Missing vs_currencies parameter");
    return NextResponse.json({ success: false, detail: "Missing vs_currencies parameter" }, { status: 400, headers: securityHeaders });
  }
  if (["search", "exchange-search"].includes(action) && (!query || typeof query !== "string" || query.trim() === "")) {
    await trackViolation(ip, "Missing or invalid query parameter");
    return NextResponse.json({ success: false, detail: "Missing or invalid query parameter" }, { status: 400, headers: securityHeaders });
  }
  if (action === "volume-chart" && (!days || isNaN(days))) {
    await trackViolation(ip, "Missing or invalid days parameter");
    return NextResponse.json({ success: false, detail: "Missing or invalid days parameter" }, { status: 400, headers: securityHeaders });
  }
  if (action === "token-details" && (!address || typeof address !== "string" || address.trim() === "")) {
    await trackViolation(ip, "Missing or invalid address parameter");
    return NextResponse.json({ success: false, detail: "Missing or invalid address parameter" }, { status: 400, headers: securityHeaders });
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error("COINGECKO_API_KEY is not configured", { ip });
    return NextResponse.json(
      { success: false, detail: "Server configuration error: Missing COINGECKO_API_KEY" },
      { status: 500, headers: securityHeaders }
    );
  }

  const currencies = vs_currencies.split(",").map((c) => c.trim().toLowerCase());
  const validCurrencies = currencies.filter((c) => VALID_CURRENCIES.includes(c));
  const selectedCurrency = validCurrencies[0] || "usd";

  try {
    let data;
    let cacheKey;
    let cacheTTL;

    if (action === "token-details") {
      cacheKey = `coingecko_token_details_${address}`;
      cacheTTL = 4 * 3600;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for token-details: ${address}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      if (address.toLowerCase() === "bitcoin") {
        data = {
          symbol: "BTC",
          image: { thumb: "/logos/bitcoin.png" },
        };
        await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
        logger.info(`Returning hardcoded Bitcoin details for address: ${address}`, { ip });
        return NextResponse.json({ success: true, data }, { headers: securityHeaders });
      }

      try {
        const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}`, {
          headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
          timeout: 30000,
        });
        data = {
          symbol: response.data.symbol.toUpperCase(),
          image: response.data.image || { thumb: "/fallback-image.png" },
        };
        await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
        logger.info(`Fetched token details for address: ${address}`, { ip });
        return NextResponse.json({ success: true, data }, { headers: securityHeaders });
      } catch (error) {
        logger.error(`Failed to fetch token details for ${address}: ${error.message}`, {
          ip,
          status: error.response?.status,
          data: error.response?.data,
        });
        return NextResponse.json({
          success: false,
          detail: error.response?.status === 404
            ? `No token data found for address ${address}`
            : `Failed to fetch token details: ${error.message}`,
          data: { symbol: address, image: { thumb: "/fallback-image.png" } },
        }, { headers: securityHeaders });
      }
    }

    if (action === "trending") {
      cacheKey = `coingecko_trending_${selectedCurrency}`;
      cacheTTL = 60 * 60;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for trending-tokens-${selectedCurrency}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      try {
        const response = await fetchWithRateLimit("https://api.coingecko.com/api/v3/search/trending", {
          headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
          timeout: 30000,
        });
        data = response.data.coins.map((coin) => ({
          id: coin.item.id,
          name: coin.item.name,
          symbol: coin.item.symbol,
          thumb: coin.item.thumb || "/fallback-image.png",
          large: coin.item.large || "/fallback-image.png",
          market_cap_rank: coin.item.market_cap_rank,
          price: coin.item.data.price,
          price_change_percentage_24h: coin.item.data.price_change_percentage_24h.usd,
        }));
        await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
        logger.info(`Fetched trending tokens for ${selectedCurrency}`, { ip });
        return NextResponse.json({ success: true, data }, { headers: securityHeaders });
      } catch (error) {
        logger.error(`Failed to fetch trending tokens: ${error.message}`, {
          ip,
          status: error.response?.status,
          data: error.response?.data,
        });
        return NextResponse.json({
          success: false,
          detail:
            error.response?.status === 429
              ? "CoinGecko API rate limit exceeded. Please try again in a few minutes."
              : `Failed to fetch trending tokens: ${error.message}`,
          data: [],
        }, { status: error.response?.status || 500, headers: securityHeaders });
      }
    }

    if (action === "exchange-search") {
      cacheKey = `coingecko_exchange_search_${query}`;
      cacheTTL = 5 * 60;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for exchange-search: ${query}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      const response = await fetchWithRateLimit("https://api.coingecko.com/api/v3/exchanges", {
        headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
        timeout: 30000,
      });
      data = response.data
        .filter((exchange) => exchange.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10)
        .map((exchange) => ({
          id: exchange.id,
          name: exchange.name,
          image: exchange.image || "/fallback-image.png",
        }));
      await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
      logger.info(`Fetched exchange search results for ${query}`, { ip });
      return NextResponse.json({ success: true, data }, { headers: securityHeaders });
    }

    if (action === "tickers") {
      cacheKey = `coingecko_tickers_${id}`;
      cacheTTL = 60 * 60;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        if (parsedCache.success && Array.isArray(parsedCache.data?.tickers)) {
          logger.info(`Cache hit for tickers: ${id}`, { ip });
          return NextResponse.json(parsedCache, { headers: securityHeaders });
        }
      }

      try {
        const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${id}/tickers`, {
          params: { include_exchange_logo: true },
          headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
          timeout: 30000,
        });
        data = { tickers: response.data.tickers || [] };
        await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
        logger.info(`Fetched tickers for ${id}`, { ip });
        return NextResponse.json({ success: true, data }, { headers: securityHeaders });
      } catch (error) {
        logger.error(`Failed to fetch tickers for ${id}: ${error.message}`, {
          ip,
          status: error.response?.status,
          data: error.response?.data,
        });
        return NextResponse.json({
          success: false,
          detail:
            error.response?.status === 429
              ? "CoinGecko API rate limit exceeded. Please try again in a few minutes."
              : error.response?.status === 404
                ? `No ticker data found for ${id}.`
                : `Failed to fetch ticker data: ${error.message}`,
          data: { tickers: [] },
        }, { status: error.response?.status || 500, headers: securityHeaders });
      }
    }

    if (action === "coin-details") {
      cacheKey = `coingecko_coin_details_${id}`;
      cacheTTL = 4 * 3600;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for coin-details: ${id}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${id}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false,
          vs_currency: selectedCurrency,
        },
        headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
        timeout: 30000,
      });
      data = response.data;
      await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
      logger.info(`Fetched coin details for ${id}`, { ip });
      return NextResponse.json({ success: true, data }, { headers: securityHeaders });
    }

    if (action === "search") {
      cacheKey = `coingecko_search_${query}`;
      cacheTTL = 5 * 60;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for search: ${query}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      const response = await fetchWithRateLimit("https://api.coingecko.com/api/v3/search", {
        params: { query },
        headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
        timeout: 30000,
      });
      data = response.data.coins.map((coin) => ({
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol,
        image: coin.large || coin.thumb || "/fallback-image.png",
        market_cap_rank: coin.market_cap_rank,
      }));
      await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
      logger.info(`Fetched search results for ${query}`, { ip });
      return NextResponse.json({ success: true, data }, { headers: securityHeaders });
    }

    if (action === "exchange-details") {
      cacheKey = `coingecko_exchange_details_${id}`;
      cacheTTL = 4 * 3600;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for exchange-details: ${id}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/exchanges/${id}`, {
        headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
        timeout: 30000,
      });
      data = {
        id: response.data.id,
        name: response.data.name,
        image: response.data.image || "/fallback-image.png",
        country: response.data.country || "N/A",
        year_established: response.data.year_established || "N/A",
        trust_score: response.data.trust_score || "N/A",
        trust_score_rank: response.data.trust_score_rank || "N/A",
        trade_volume_24h_btc: response.data.trade_volume_24h_btc || 0,
        centralized: response.data.centralized || false,
        url: response.data.url || "",
        twitter_handle: response.data.twitter_handle || "",
      };
      await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
      logger.info(`Fetched exchange details for ${id}`, { ip });
      return NextResponse.json({ success: true, data }, { headers: securityHeaders });
    }

    if (action === "volume-chart") {
      cacheKey = `coingecko_volume_chart_${id}_${days}`;
      cacheTTL = 2 * 3600;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for volume-chart: ${id}_${days}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      const response = await fetchWithRateLimit(
        `https://api.coingecko.com/api/v3/exchanges/${id}/volume_chart?days=${days}`,
        {
          headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
          timeout: 30000,
        }
      );
      data = response.data;
      await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
      logger.info(`Fetched volume chart for ${id} over ${days} days`, { ip });
      return NextResponse.json({ success: true, data }, { headers: securityHeaders });
    }

    if (action === "public-treasury") {
      cacheKey = `coingecko_public_treasury_${tokenType}`;
      cacheTTL = 12 * 3600;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for public-treasury: ${tokenType}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      try {
        const response = await fetchWithRateLimit(
          `https://api.coingecko.com/api/v3/companies/public_treasury/${tokenType}`,
          { headers: { "x-cg-demo-api-key": COINGECKO_API_KEY }, timeout: 30000 }
        );
        data = response.data || { companies: [] };
        await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
        logger.info(`Fetched public treasury data for ${tokenType}`, { ip });
        return NextResponse.json({ success: true, data }, { headers: securityHeaders });
      } catch (error) {
        logger.error(`Failed to fetch public treasury data for ${tokenType}: ${error.message}`, {
          ip,
          status: error.response?.status,
          data: error.response?.data,
        });
        return NextResponse.json({
          success: false,
          detail: `No treasury data available for ${tokenType}`,
          data: { companies: [] },
        }, { status: error.response?.status || 500, headers: securityHeaders });
      }
    }

    if (action === "market-info") {
      cacheKey = `coingecko_market_info_${ids || "default"}_${selectedCurrency}_${start || 1}_${limit || 30}`;
      cacheTTL = 2 * 60;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for market-info: ${selectedCurrency}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers: securityHeaders });
      }

      const response = await fetchWithRateLimit("https://api.coingecko.com/api/v3/coins/markets", {
        params: {
          vs_currency: selectedCurrency,
          ids: ids || undefined,
          order: "market_cap_desc",
          per_page: limit || 30,
          page: start || 1,
          sparkline: false,
          price_change_percentage: "24h",
        },
        headers: { "x-cg-demo-api-key": COINGECKO_API_KEY },
        timeout: 30000,
      });
      data = response.data.map((coin) => ({
        ...coin,
        image: coin.image || "/fallback-image.png",
      }));
      await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify({ success: true, data }));
      logger.info(`Fetched market info for ${selectedCurrency}`, { ip });
      return NextResponse.json({ success: true, data }, { headers: securityHeaders });
    }

    await trackViolation(ip, "Invalid action specified");
    return NextResponse.json({ success: false, detail: "Invalid action specified" }, { status: 400, headers: securityHeaders });
  } catch (error) {
    logger.error(`CoinGecko API error: ${error.message}`, {
      ip,
      action,
      status: error.response?.status,
      data: error.response?.data,
    });
    return NextResponse.json({
      success: false,
      detail:
        error.response?.status === 429
          ? "CoinGecko API rate limit exceeded. Please try again in a few minutes."
          : error.response?.status === 404
            ? `No data found for the requested resource.`
            : `Failed to fetch data: ${error.message}`,
      data: [],
    }, { status: error.response?.status || 500, headers: securityHeaders });
  }
}