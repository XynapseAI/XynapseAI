// app\api\token-cluster\route.js
import { NextResponse } from 'next/server';
import { query } from '../../../utils/postgres';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL;
    const isProduction = process.env.NODE_ENV === 'production';
    if (!redisUrl) {
      logger.error('REDIS_URL is not defined in environment variables');
      throw new Error('Server configuration error: REDIS_URL is required');
    }
    if (isProduction && (!redisUrl.startsWith('rediss://') || !redisUrl.includes('@'))) {
      logger.error('Invalid REDIS_URL: Must use rediss:// protocol with authentication in production');
      throw new Error('Server configuration error: Invalid REDIS_URL for production');
    }
    if (!isProduction && !redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
      logger.error('Invalid REDIS_URL: Must use redis:// or rediss:// protocol in development');
      throw new Error('Server configuration error: Invalid REDIS_URL for development');
    }
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message, stack: err.stack }));
    await redisClient.connect();
    logger.info('Redis connected', { timestamp: new Date().toISOString() });
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected', { timestamp: new Date().toISOString() });
  }
  return redisClient;
}

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
  ...(process.env.NODE_ENV === 'production' ? [] : ['https://[a-z0-9-]+\.vercel\.app']),
].filter((v, i, a) => v && a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info('No Origin or Referer (likely SSR or server-to-server), allowing request', { timestamp: new Date().toISOString() });
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info('No valid Origin or Referer, allowing for SSR compatibility', { timestamp: new Date().toISOString() });
    return true;
  }
  const isAllowed = allowedOrigins.some((allowed) =>
    allowed.includes('[a-z0-9-]+\.vercel\.app')
      ? new RegExp('^https://[a-z0-9-]+\.vercel\.app$').test(checkOrigin)
      : allowed === checkOrigin
  ) || vercelPreviewRegex.test(checkOrigin);
  logger.info(`Origin check: ${checkOrigin}, Allowed: ${isAllowed}`, { timestamp: new Date().toISOString() });
  return isAllowed;
}

// ================= IP Ban Logic =================
async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`, { timestamp: new Date().toISOString() });
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    logger.error(`IP ban detected: ${ip}`, { timestamp: new Date().toISOString() });
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 20;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Missing or invalid exchange parameter'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`, { timestamp: new Date().toISOString() });
    return;
  }

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`, { timestamp: new Date().toISOString() });
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`, { timestamp: new Date().toISOString() });
}

// ================= Rate Limiting =================
async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:token_cluster:${ip}`;
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50;
  const windowMs = 60 * 1000; // 1 minute
  const requests = parseInt(await redisClient.get(key)) || 0;
  if (requests >= maxRequests) {
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`, { timestamp: new Date().toISOString() });
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.info(`Rate limit check passed for IP ${ip}: ${requests + 1}/${maxRequests} requests`, { timestamp: new Date().toISOString() });
}

// ================= Retry Logic =================
async function withRetry(fn, retries = 2, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Operation failed, retrying after ${delay}ms`, { attempt: i + 1, error: err.message, timestamp: new Date().toISOString() });
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

// ================= Exchange Mapping =================
const EXCHANGE_MAPPING = {
  okex: 'okx',
  bybit_spot: 'bybit',
  mxc: 'mexc',
  binance: 'binance',
  'coinbase-exchange': 'coinbase',
  kraken: 'kraken',
  'huobi-global': 'huobi',
  kucoin: 'kucoin',
  'gate-io': 'gate',
  bitfinex: 'bitfinex',
};

function mapExchangeName(exchangeId) {
  return EXCHANGE_MAPPING[exchangeId.toLowerCase()] || exchangeId.toLowerCase();
}

// ================= BTC Price Caching =================
async function fetchBtcPrice() {
  const redisClient = await getRedisClient();
  const cacheKey = 'btc_price_usd';
  const cacheTTL = 300; // 5 minutes

  try {
    const cachedPrice = await redisClient.get(cacheKey);
    if (cachedPrice) {
      logger.info('Cache hit for BTC price', { price: cachedPrice, timestamp: new Date().toISOString() });
      return parseFloat(cachedPrice);
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const response = await fetch(`${apiUrl}/api/coingecko?action=coin-details&id=bitcoin`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await response.json();
    if (response.ok && result.data?.market_data?.current_price?.usd) {
      const price = result.data.market_data.current_price.usd;
      await redisClient.setEx(cacheKey, cacheTTL, price.toString());
      logger.info('Fetched and cached BTC price', { price, timestamp: new Date().toISOString() });
      return price;
    }
    throw new Error('Failed to fetch BTC price');
  } catch (error) {
    await trackViolation(null, 'Error fetching BTC price');
    logger.error('Error fetching BTC price', { error: error.message, stack: error.stack, timestamp: new Date().toISOString() });
    return 0; // Fallback to 0 to avoid breaking the query
  }
}

// ================= Main GET Handler =================
export async function GET(request) {
  // Handle IP spoofing by validating x-forwarded-for
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor
    ? forwardedFor.split(',')[0].trim()
    : request.headers.get('x-real-ip') || 'unknown';
  if (!ip || ip === 'unknown' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^[0-9a-f:]+$/i.test(ip)) {
    logger.warn('Invalid or missing IP address', { forwardedFor, ip, timestamp: new Date().toISOString() });
    return NextResponse.json(
      { success: false, detail: 'Invalid request source' },
      { status: 400, headers: securityHeaders }
    );
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const { exchange } = params;

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': isAllowedOrigin(origin, referer) ? (origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') : '',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    ...securityHeaders,
  };

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { timestamp: new Date().toISOString() });
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: corsHeaders });
  }

  if (!exchange || typeof exchange !== 'string' || exchange.trim() === '') {
    await trackViolation(ip, 'Missing or invalid exchange parameter');
    logger.warn(`Missing or invalid exchange parameter: ${exchange}`, { ip, timestamp: new Date().toISOString() });
    return NextResponse.json({ success: false, detail: 'Missing or invalid exchange parameter' }, { status: 400, headers: corsHeaders });
  }

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, 'Rate limit or IP ban error');
    logger.error(`Rate limit or IP ban error`, { ip, error: err.message, timestamp: new Date().toISOString() });
    return NextResponse.json({ success: false, detail: 'Request limit exceeded or IP banned' }, { status: 429, headers: corsHeaders });
  }

  try {
    const redisClient = await getRedisClient();
    const mappedExchange = mapExchangeName(exchange);
    const cacheKey = `token_cluster:${mappedExchange}`;
    const cachedData = await withRetry(async () => await redisClient.get(cacheKey));

    if (cachedData) {
      logger.info(`Cache hit for exchange: ${mappedExchange}`, { ip, timestamp: new Date().toISOString() });
      return NextResponse.json(JSON.parse(cachedData), { headers: corsHeaders });
    }

    const btcPrice = await fetchBtcPrice();
    logger.info('BTC price for calculations:', { btcPrice, timestamp: new Date().toISOString() });

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
    const portfolioResult = await withRetry(async () => await query(portfolioQuery, [mappedExchange]));
    logger.info('Portfolio result from wallet_holders:', { rows: portfolioResult.rows.length, timestamp: new Date().toISOString() });

    const bitcoinPortfolioQuery = `
      SELECT 
        th.token_address,
        'BTC' AS symbol,
        '/logos/bitcoin.png' AS logo,
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
    const bitcoinPortfolioResult = await withRetry(async () => await query(bitcoinPortfolioQuery, [mappedExchange, btcPrice]));
    logger.info('Bitcoin portfolio result:', { rows: bitcoinPortfolioResult.rows.length, timestamp: new Date().toISOString() });

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
    const walletResult = await withRetry(async () => await query(walletQuery, [mappedExchange]));
    logger.info('Wallet result from wallet_holders:', { rows: walletResult.rows.length, timestamp: new Date().toISOString() });

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
    const bitcoinWalletResult = await withRetry(async () => await query(bitcoinWalletQuery, [mappedExchange, btcPrice]));
    logger.info('Bitcoin wallet result:', { rows: bitcoinWalletResult.rows.length, timestamp: new Date().toISOString() });

    if (
      portfolioResult.rows.length === 0 &&
      bitcoinPortfolioResult.rows.length === 0 &&
      walletResult.rows.length === 0 &&
      bitcoinWalletResult.rows.length === 0
    ) {
      await trackViolation(ip, `No data found for exchange: ${exchange}`);
      logger.warn(`No data found for exchange: ${exchange} (mapped to: ${mappedExchange})`, { ip, timestamp: new Date().toISOString() });
      return NextResponse.json(
        { success: false, detail: 'No portfolio or wallet data found for the specified exchange' },
        { status: 404, headers: corsHeaders }
      );
    }

    const responseData = {
      success: true,
      portfolio: [
        ...bitcoinPortfolioResult.rows.map((row) => ({
          token_address: row.token_address || 'bitcoin',
          symbol: row.symbol || 'BTC',
          logo: row.logo || '/logos/bitcoin.png',
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
          name_tag: row.name_tag || 'N/A',
          image: row.image || '/logos/bitcoin.png',
        })),
        ...walletResult.rows.map((row) => ({
          exchange_name: row.exchange_name,
          chain: row.chain,
          holder_address: row.holder_address,
          total_value_usd: Number(row.total_value_usd) || 0,
          token_count: row.token_count || 0,
          name_tag: row.name_tag || 'N/A',
          image: row.image || '/fallback-image.png',
        })),
      ],
    };

    await withRetry(async () => {
      const redisClient = await getRedisClient();
      await redisClient.setEx(cacheKey, 300, JSON.stringify(responseData));
    });

    logger.info(`Fetched portfolio and wallet data for exchange: ${exchange} (mapped to: ${mappedExchange})`, {
      ip,
      portfolioCount: portfolioResult.rows.length + bitcoinPortfolioResult.rows.length,
      walletCount: walletResult.rows.length + bitcoinWalletResult.rows.length,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(responseData, { headers: corsHeaders });
  } catch (error) {
    await trackViolation(ip, 'Internal server error');
    logger.error(`Error in token-cluster API`, { error: error.message, stack: error.stack, ip, timestamp: new Date().toISOString() });
    return NextResponse.json(
      { success: false, detail: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}