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

async function fetchBtcPrice() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
  try {
    const response = await fetch(`${apiUrl}/api/coingecko?action=coin-details&id=bitcoin`, {
      headers: { "Content-Type": "application/json" },
    });
    const result = await response.json();
    if (response.ok && result.data?.market_data?.current_price?.usd) {
      logger.info("Fetched BTC price:", { price: result.data.market_data.current_price.usd });
      return result.data.market_data.current_price.usd;
    }
    throw new Error("Failed to fetch BTC price");
  } catch (error) {
    logger.error("Error fetching BTC price:", { error: error.message, stack: error.stack });
    return 0; // Fallback to 0 to avoid breaking the query
  }
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
    const cacheKey = `token_cluster:${mappedExchange}`;
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      logger.info(`Cache hit for exchange: ${mappedExchange}`, { ip });
      return NextResponse.json(JSON.parse(cachedData));
    }

    // Fetch BTC price for Bitcoin balance calculation
    const btcPrice = await fetchBtcPrice();
    logger.info("BTC price for calculations:", { btcPrice });

    // Portfolio: Aggregate tokens from wallet_holders.metadata for EVM chains
    const portfolioQuery = `
      WITH wallet_tokens AS (
        SELECT 
          wh.exchange_name,
          wh.chain,
          wh.holder_address,
          t.token->>'token_address' AS token_address,
          t.token->>'symbol' AS symbol,
          t.token->>'logo' AS logo,
          (t.token->>'balance')::NUMERIC AS balance,
          (t.token->>'balance_usd')::NUMERIC AS balance_usd
        FROM wallet_holders wh,
          jsonb_array_elements(wh.metadata) AS t(token)
        WHERE LOWER(wh.exchange_name) = LOWER($1)
          AND LOWER(wh.chain) != 'bitcoin'
          AND t.token->>'logo' IS NOT NULL
          AND t.token->>'logo' != ''
          AND t.token->>'logo' != '/fallback-image.png'
      ),
      wallet_agg AS (
        SELECT 
          token_address,
          chain,
          symbol,
          logo,
          SUM(balance) AS chain_balance,
          SUM(balance_usd) AS chain_balance_usd,
          json_agg(
            json_build_object(
              'holder_address', holder_address,
              'balance', balance,
              'value', balance_usd
            )
          ) AS wallets
        FROM wallet_tokens
        GROUP BY token_address, chain, symbol, logo
      )
      SELECT 
        token_address,
        symbol,
        logo,
        json_agg(
          json_build_object(
            'chain', chain,
            'balance', chain_balance,
            'balance_usd', chain_balance_usd,
            'wallets', wallets
          )
        ) AS chain_details,
        SUM(chain_balance) AS total_balance,
        SUM(chain_balance_usd) AS total_balance_usd
      FROM wallet_agg
      GROUP BY token_address, symbol, logo
      ORDER BY total_balance_usd DESC NULLS LAST
      LIMIT 50
    `;
    const portfolioResult = await query(portfolioQuery, [mappedExchange]);
    logger.info("Portfolio result from wallet_holders:", { rows: portfolioResult.rows });

    // Portfolio: Aggregate Bitcoin from token_holders
    const bitcoinPortfolioQuery = `
      SELECT 
        th.token_address,
        'BTC' AS symbol, -- Cố định symbol là 'BTC' cho Bitcoin
        '/logos/bitcoin.png' AS logo, -- Cố định logo là '/logos/bitcoin.png'
        json_agg(
          json_build_object(
            'chain', th.chain,
            'balance', th.balance,
            'balance_usd', COALESCE(th.balance_usd, th.balance * $2),
            'wallets', json_build_array(
              json_build_object(
                'holder_address', th.holder_address,
                'balance', th.balance,
                'value', COALESCE(th.balance_usd, th.balance * $2)
              )
            )
          )
        ) AS chain_details,
        SUM(th.balance) AS total_balance,
        SUM(COALESCE(th.balance_usd, th.balance * $2)) AS total_balance_usd,
        (th.token_address = 'bitcoin') AS is_bitcoin
      FROM token_holders th
      WHERE LOWER(th.chain) = 'bitcoin'
        AND LOWER(th.name) = LOWER($1)
      GROUP BY th.token_address
      ORDER BY is_bitcoin DESC, total_balance_usd DESC NULLS LAST
      LIMIT 50
    `;
    const bitcoinPortfolioResult = await query(bitcoinPortfolioQuery, [mappedExchange, btcPrice]);
    logger.info("Bitcoin portfolio result:", { rows: bitcoinPortfolioResult.rows });

    // Wallets: Individual wallet addresses from wallet_holders (EVM chains)
    const walletQuery = `
      SELECT 
        exchange_name,
        chain,
        holder_address,
        total_value_usd,
        token_count,
        name_tag,
        image
      FROM wallet_holders
      WHERE LOWER(exchange_name) = LOWER($1)
        AND LOWER(chain) != 'bitcoin'
      ORDER BY total_value_usd DESC NULLS LAST
      LIMIT 100
    `;
    const walletResult = await query(walletQuery, [mappedExchange]);
    logger.info("Wallet result from wallet_holders:", { rows: walletResult.rows });

    // Wallets: Bitcoin wallets from token_holders
    const bitcoinWalletQuery = `
      SELECT 
        source AS exchange_name,
        chain,
        holder_address,
        COALESCE(balance_usd, balance * $2) AS total_value_usd,
        1 AS token_count,
        name_tag,
        image,
        (token_address = 'bitcoin') AS is_bitcoin
      FROM token_holders
      WHERE LOWER(chain) = 'bitcoin'
        AND LOWER(name) = LOWER($1)
      ORDER BY is_bitcoin DESC, total_value_usd DESC NULLS LAST
      LIMIT 100
    `;
    const bitcoinWalletResult = await query(bitcoinWalletQuery, [mappedExchange, btcPrice]);
    logger.info("Bitcoin wallet result:", { rows: bitcoinWalletResult.rows });

    if (
      portfolioResult.rows.length === 0 &&
      bitcoinPortfolioResult.rows.length === 0 &&
      walletResult.rows.length === 0 &&
      bitcoinWalletResult.rows.length === 0
    ) {
      logger.warn(`No data found for exchange: ${exchange} (mapped to: ${mappedExchange})`, { ip });
      return NextResponse.json(
        { success: false, detail: `No portfolio or wallet data found for exchange: ${exchange}` },
        { status: 404 }
      );
    }

    const responseData = {
      success: true,
      portfolio: [
        ...bitcoinPortfolioResult.rows.map((row) => ({
          token_address: row.token_address || "bitcoin",
          symbol: row.symbol || "BTC",
          logo: row.logo || "/logos/bitcoin.png",
          total_balance: Number(row.total_balance) || 0,
          total_balance_usd: Number(row.total_balance_usd) || 0,
          chain_details: row.chain_details || [],
        })),
        ...portfolioResult.rows.map((row) => ({
          token_address: row.token_address,
          symbol: row.symbol || row.token_address,
          logo: row.logo,
          total_balance: Number(row.total_balance) || 0,
          total_balance_usd: Number(row.total_balance_usd) || 0,
          chain_details: row.chain_details || [],
        })),
      ],
      wallets: [
        ...bitcoinWalletResult.rows.map((row) => ({
          exchange_name: row.exchange_name,
          chain: row.chain,
          holder_address: row.holder_address,
          total_value_usd: Number(row.total_value_usd) || 0,
          token_count: row.token_count || 0,
          name_tag: row.name_tag || "N/A",
          image: row.image || "/logos/bitcoin.png",
        })),
        ...walletResult.rows.map((row) => ({
          exchange_name: row.exchange_name,
          chain: row.chain,
          holder_address: row.holder_address,
          total_value_usd: Number(row.total_value_usd) || 0,
          token_count: row.token_count || 0,
          name_tag: row.name_tag || "N/A",
          image: row.image || "/fallback-image.png",
        })),
      ],
    };

    // Cache the result for 5 minutes
    await redisClient.setEx(cacheKey, 300, JSON.stringify(responseData));

    logger.info(`Fetched portfolio and wallet data for exchange: ${exchange} (mapped to: ${mappedExchange})`, {
      ip,
      portfolioCount: portfolioResult.rows.length + bitcoinPortfolioResult.rows.length,
      walletCount: walletResult.rows.length + bitcoinWalletResult.rows.length,
    });

    return NextResponse.json(responseData);
  } catch (error) {
    logger.error(`Error in token-cluster API: ${error.message}`, { ip, stack: error.stack });
    return NextResponse.json({ success: false, detail: `Error: ${error.message}` }, { status: 500 });
  }
}