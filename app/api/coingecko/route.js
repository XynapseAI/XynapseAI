// app/api/coingecko/route.js
import { NextResponse } from "next/server";
import axios from "axios";
import axiosRetry from "axios-retry";
import Bottleneck from "bottleneck";
import { logger } from "../../../utils/serverLogger";
import { getRedisClient } from "../../../lib/redis";

// Configure axios-retry for CoinGecko API
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => {
    logger.info(`Retry attempt ${retryCount} for CoinGecko API`);
    return Math.pow(2, retryCount) * 1000 + Math.random() * 100; // Exponential backoff with jitter
  },
  retryCondition: (error) => error.response?.status === 429 || error.code === "ECONNABORTED",
});

// Rate limiter configuration
const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === "production" ? 20 : 5,
  minTime: process.env.NODE_ENV === "production" ? 333 : 1000, // Adjusted to ~3 req/s in production
  reservoir: 50, // Reduced to align with free tier limits (~50 req/min)
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

async function checkRateLimit(ip) {
  try {
    const redisClient = await getRedisClient();
    const key = `rate_limit:coingecko:${ip}`;
    const requests = Number.parseInt(await redisClient.get(key)) || 0;
    const windowMs = 60 * 1000;
    if (requests >= 50) { // Reduced to prevent overloading CoinGecko
      logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`, { ip });
      throw new Error("Too many requests, please try again later.");
    }
    await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  } catch (err) {
    logger.error(`Redis rate limit check failed: ${err.message}`, { ip });
    throw err;
  }
}

export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const { action = "market-info", ids, vs_currencies = "usd", limit, start, query, id, tokenType, days } = params;

  // Validate parameters
  if (
    ["tickers", "coin-details", "exchange-details", "volume-chart"].includes(action) &&
    (!id || typeof id !== "string" || id.trim() === "")
  ) {
    logger.warn(`Missing or invalid id parameter: ${id}`, { ip });
    return NextResponse.json({ success: false, detail: "Missing or invalid id parameter" }, { status: 400 });
  }
  if (action === "public-treasury" && (!tokenType || typeof tokenType !== "string" || tokenType.trim() === "")) {
    logger.warn(`Missing or invalid tokenType parameter: ${tokenType}`, { ip });
    return NextResponse.json({ success: false, detail: "Missing or invalid tokenType parameter" }, { status: 400 });
  }
  if (action === "market INFO" && !vs_currencies) {
    logger.warn(`Missing vs_currencies parameter`, { ip });
    return NextResponse.json({ success: false, detail: "Missing vs_currencies parameter" }, { status: 400 });
  }
  if (["search", "exchange-search"].includes(action) && (!query || typeof query !== "string" || query.trim() === "")) {
    logger.warn(`Missing or invalid query parameter: ${query}`, { ip });
    return NextResponse.json({ success: false, detail: "Missing or invalid query parameter" }, { status: 400 });
  }
  if (action === "volume-chart" && (!days || isNaN(days))) {
    logger.warn(`Missing or invalid days parameter: ${days}`, { ip });
    return NextResponse.json({ success: false, detail: "Missing or invalid days parameter" }, { status: 400 });
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error("COINGECKO_API_KEY is not configured", { ip });
    return NextResponse.json(
      { success: false, detail: "Server configuration error: Missing COINGECKO_API_KEY" },
      { status: 500 }
    );
  }

  const currencies = vs_currencies.split(",").map((c) => c.trim().toLowerCase());
  const validCurrencies = currencies.filter((c) => VALID_CURRENCIES.includes(c));
  const selectedCurrency = validCurrencies[0] || "usd";

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  let redisClient;
  try {
    redisClient = await getRedisClient();
  } catch (err) {
    logger.error(`Redis connection error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: "Database connection error" }, { status: 500 });
  }

  try {
    let data;
    let cacheKey;
    let cacheTTL;

    if (action === "trending") {
      cacheKey = `coingecko_trending_${selectedCurrency}`;
      cacheTTL = 60 * 60; // 1 hour
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(JSON.parse(cachedData));
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
        return NextResponse.json({ success: true, data });
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
        });
      }
    }

    if (action === "exchange-search") {
      cacheKey = `coingecko_exchange_search_${query}`;
      cacheTTL = 5 * 60; // 5 minutes
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(JSON.parse(cachedData));
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
      return NextResponse.json({ success: true, data });
    }

    if (action === "tickers") {
      cacheKey = `coingecko_tickers_${id}`;
      cacheTTL = 60 * 60; // 1 hour
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        if (parsedCache.success && Array.isArray(parsedCache.data?.tickers)) {
          return NextResponse.json(parsedCache);
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
        return NextResponse.json({ success: true, data });
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
        });
      }
    } else if (action === "coin-details") {
      cacheKey = `coingecko_coin_details_${id}`;
      cacheTTL = 4 * 3600; // 4 hours
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(JSON.parse(cachedData));
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
      return NextResponse.json({ success: true, data });
    } else if (action === "search") {
      cacheKey = `coingecko_search_${query}`;
      cacheTTL = 5 * 60; // 5 minutes
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(JSON.parse(cachedData));
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
      return NextResponse.json({ success: true, data });
    } else if (action === "exchange-details") {
      cacheKey = `coingecko_exchange18n_exchange_details_${id}`;
      cacheTTL = 4 * 3600; // 4 hours
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(JSON.parse(cachedData));
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
      return NextResponse.json({ success: true, data });
    } else if (action === "volume-chart") {
      cacheKey = `coingecko_volume_chart_${id}_${days}`;
      cacheTTL = 2 * 3600; // 2 hours
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(JSON.parse(cachedData));
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
      return NextResponse.json({ success: true, data });
    } else if (action === "public-treasury") {
      cacheKey = `coingecko_public_treasury_${tokenType}`;
      cacheTTL = 12 * 3600; // 12 hours
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return NextResponse.json({ success: true, data: JSON.parse(cachedData) });
      }

      try {
        const response = await fetchWithRateLimit(
          `https://api.coingecko.com/api/v3/companies/public_treasury/${tokenType}`,
          { headers: { "x-cg-demo-api-key": COINGECKO_API_KEY }, timeout: 30000 }
        );
        data = response.data || { companies: [] };
        await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(data));
        return NextResponse.json({ success: true, data });
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
        });
      }
    } else if (action === "market-info") {
      cacheKey = `coingecko_market_info_${ids || "default"}_${selectedCurrency}_${start || 1}_${limit || 30}`;
      cacheTTL = 2 * 60; // 2 minutes
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(JSON.parse(cachedData));
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
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ success: false, detail: "Invalid action specified" }, { status: 400 });
  } catch (error) {
    logger.error(`CoinGecko API error: ${error.message}`, {
      ip,
      action,
      status: error.response?.status,
      data: error.response?.data,
    });
    return NextResponse.json(
      {
        success: false,
        detail:
          error.response?.status === 429
            ? "CoinGecko API rate limit exceeded. Please try again in a few minutes."
            : error.response?.status === 404
              ? `No data found for the requested resource.`
              : `Failed to fetch data: ${error.response?.data?.error || error.message}`,
      },
      { status: error.response?.status || 500 }
    );
  }
}