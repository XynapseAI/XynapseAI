// app/api/token-cluster/route.js
import { NextResponse } from "next/server";
import { query } from "../../../utils/postgres";
import { logger } from "../../../utils/serverLogger";
import { getRedisClient } from "../../../lib/redis";

const EXCHANGE_MAPPING = {
  okex: "okx",
  bybit_spot: "bybit",
  mxc: "mexc",
  binance: "binance",
  "coinbase-exchange": "coinbase",
  kraken: "kraken",
  "huobi-global": "huobi",
  kucoin: "kucoin",
  "gate-io": "gate",
  bitfinex: "bitfinex",
};

function mapExchangeName(exchangeId) {
  return EXCHANGE_MAPPING[exchangeId.toLowerCase()] || exchangeId.toLowerCase();
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:token_cluster:${ip}`;
  const requests = Number.parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000; // 1 minute
  if (requests >= 200) {
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`, { ip });
    throw new Error("Too many requests, please try again later.");
  }
  await redisClient
    .multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const { exchange } = params;

  if (!exchange || typeof exchange !== "string" || exchange.trim() === "") {
    logger.warn(`Missing or invalid exchange parameter: ${exchange}`, { ip });
    return NextResponse.json({ success: false, detail: "Missing or invalid exchange parameter" }, { status: 400 });
  }

  try {
    await checkRateLimit(ip);

    const redisClient = await getRedisClient();
    if (!redisClient.isOpen) {
      logger.error("Redis client not connected", { ip });
      throw new Error("Redis client not connected");
    }

    const mappedExchange = mapExchangeName(exchange);

    // Portfolio: Aggregate holdings by coingecko_id and chain
    const portfolioQuery = `
      SELECT 
        coingecko_id AS token_id,
        chain,
        SUM(balance) AS total_balance,
        SUM(balance_usd) AS total_balance_usd,
        AVG(percentage) AS percentage
      FROM token_holders
      WHERE LOWER(name) = LOWER($1)
      GROUP BY coingecko_id, chain
      ORDER BY total_balance_usd DESC
      LIMIT 50
    `;
    const portfolioResult = await query(portfolioQuery, [mappedExchange]);

    // Wallets: Individual wallet addresses
    const walletQuery = `
      SELECT 
        holder_address,
        name_tag,
        image,
        balance_usd,
        balance,
        percentage,
        chain
      FROM token_holders
      WHERE LOWER(name) = LOWER($1)
      ORDER BY balance_usd DESC
      LIMIT 100
    `;
    const walletResult = await query(walletQuery, [mappedExchange]);

    if (portfolioResult.rows.length === 0 && walletResult.rows.length === 0) {
      logger.warn(`No data found for exchange: ${exchange} (mapped to: ${mappedExchange})`, { ip });
      return NextResponse.json(
        { success: false, detail: `No portfolio or wallet data found for exchange: ${exchange}` },
        { status: 404 }
      );
    }

    logger.info(`Fetched portfolio and wallet data for exchange: ${exchange} (mapped to: ${mappedExchange})`, {
      ip,
      portfolioCount: portfolioResult.rows.length,
      walletCount: walletResult.rows.length,
    });

    return NextResponse.json({
      success: true,
      portfolio: portfolioResult.rows,
      wallets: walletResult.rows,
    });
  } catch (error) {
    logger.error(`Error in token-cluster API: ${error.message}`, { ip, stack: error.stack });
    return NextResponse.json({ success: false, detail: `Error: ${error.message}` }, { status: 500 });
  }
}