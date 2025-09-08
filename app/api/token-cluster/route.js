import { NextResponse } from 'next/server';
import { query } from '../../../utils/postgres';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', err));
    await redisClient.connect();
    logger.info('Redis connected');
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/.*\.vercel\.app$/;

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

async function isAllowedOrigin(origin, referer, pathname) {
  logger.info('Checking origin', { origin, referer, pathname, allowedOrigins });

  try {
    if (origin && origin !== 'null') {
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        logger.warn('Blocked origin: non-HTTPS origin in production', { origin });
        await trackViolation('unknown', 'Non-HTTPS origin in production');
        return false;
      }
      if (allowedOrigins.includes(origin) || vercelPreviewRegex.test(origin)) {
        logger.info('Origin allowed', { origin });
        return true;
      }
      await trackViolation('unknown', 'Invalid origin');
      return false;
    }

    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (process.env.NODE_ENV === 'production' && !refOrigin.startsWith('https://')) {
        logger.warn('Blocked referer: non-HTTPS in production', { referer });
        await trackViolation('unknown', 'Non-HTTPS referer in production');
        return false;
      }
      if (allowedOrigins.includes(refOrigin) || vercelPreviewRegex.test(refOrigin)) {
        logger.info('Referer origin allowed', { referer, refOrigin });
        return true;
      }
      await trackViolation('unknown', 'Invalid referer');
      return false;
    }

    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }

    if (!origin && process.env.NODE_ENV === 'production') {
      logger.error('Null origin blocked in production', { pathname });
      await trackViolation('unknown', 'Null origin in production');
      return false;
    }

    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }

    logger.error('Invalid origin or referer', { origin, referer });
    await trackViolation('unknown', 'Invalid origin or referer');
    return false;
  } catch (err) {
    logger.error('Error validating origin', { err: err?.message, origin, referer, pathname });
    await trackViolation('unknown', 'Error validating origin');
    return false;
  }
}

async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 100;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Missing or invalid exchange parameter'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`);
    return;
  }

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:token_cluster:${ip}`;
  const requests = Number.parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = process.env.NODE_ENV === 'development' ? 50 : 10;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

async function withRetry(fn, retries = 2, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Operation failed, retrying after ${delay}ms`, { attempt: i + 1, error: err.message });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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

async function fetchCoinPrice(coinId) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  try {
    const response = await fetch(`${apiUrl}/api/coingecko?action=coin-details&id=${coinId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await response.json();
    if (response.ok && result.data?.market_data?.current_price?.usd) {
      logger.info(`Fetched ${coinId} price:`, { price: result.data.market_data.current_price.usd });
      return result.data.market_data.current_price.usd;
    }
    throw new Error(`Failed to fetch ${coinId} price`);
  } catch (error) {
    await trackViolation(null, `Error fetching ${coinId} price: ${error.message}`);
    logger.error(`Error fetching ${coinId} price:`, { error: error.message, stack: error.stack });
    return 0; // Fallback to 0 to avoid breaking the query
  }
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const { exchange } = params;

  const headers = {
    ...securityHeaders,
    'Content-Type': 'application/json',
    ...(origin && origin !== 'null' && isAllowedOrigin(origin, referer, pathname) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers });
  }

  if (!exchange || typeof exchange !== 'string' || exchange.trim() === '') {
    await trackViolation(ip, 'Missing or invalid exchange parameter');
    logger.warn(`Missing or invalid exchange parameter: ${exchange}`, { ip });
    return NextResponse.json({ success: false, detail: 'Missing or invalid exchange parameter' }, { status: 400, headers });
  }

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    logger.error(`Rate limit or IP ban error: ${err.message}`);
    return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers });
  }

  try {
    const redisClient = await getRedisClient();
    const mappedExchange = mapExchangeName(exchange);
    const cacheKey = `token_cluster:${mappedExchange}`;
    const cachedData = await withRetry(async () => await redisClient.get(cacheKey));

    if (cachedData) {
      logger.info(`Cache hit for exchange: ${mappedExchange}`, { ip });
      return NextResponse.json(JSON.parse(cachedData), { headers });
    }

    // Fetch prices for Bitcoin, Dogecoin, and Litecoin
    const btcPrice = await fetchCoinPrice('bitcoin');
    const dogePrice = await fetchCoinPrice('dogecoin');
    const ltcPrice = await fetchCoinPrice('litecoin');
    logger.info('Coin prices for calculations:', { btcPrice, dogePrice, ltcPrice });

    // Query for non-Bitcoin, non-Dogecoin, non-Litecoin tokens
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
        WHERE LOWER(wh.exchange_name) LIKE LOWER($1)
          AND LOWER(wh.chain) NOT IN ('bitcoin', 'dogecoin', 'litecoin')
          AND t.token->>'logo' IS NOT NULL
          AND t.token->>'logo' != ''
          AND t.token->>'logo' != '/fallback-image.webp'
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
      LIMIT 200
    `;
    const portfolioResult = await withRetry(async () => await query(portfolioQuery, [`%${mappedExchange}%`]));
    logger.info('Portfolio result from wallet_holders:', { rows: portfolioResult.rows });

    // Query for Bitcoin, Dogecoin, and Litecoin
    const specialCoinsPortfolioQuery = `
      SELECT 
        th.token_address,
        CASE 
          WHEN th.token_address = 'bitcoin' THEN 'BTC'
          WHEN th.token_address = 'dogecoin' THEN 'DOGE'
          WHEN th.token_address = 'litecoin' THEN 'LTC'
        END AS symbol,
        CASE 
          WHEN th.token_address = 'bitcoin' THEN '/logos/bitcoin.webp'
          WHEN th.token_address = 'dogecoin' THEN '/logos/dogecoin.webp'
          WHEN th.token_address = 'litecoin' THEN '/logos/litecoin.webp'
        END AS logo,
        json_agg(
          json_build_object(
            'chain', th.chain,
            'balance', th.balance,
            'balance_usd', COALESCE(th.balance_usd, 
              CASE 
                WHEN th.token_address = 'bitcoin' THEN th.balance * $2
                WHEN th.token_address = 'dogecoin' THEN th.balance * $3
                WHEN th.token_address = 'litecoin' THEN th.balance * $4
              END),
            'wallets', json_build_array(
              json_build_object(
                'holder_address', th.holder_address,
                'balance', th.balance,
                'value', COALESCE(th.balance_usd, 
                  CASE 
                    WHEN th.token_address = 'bitcoin' THEN th.balance * $2
                    WHEN th.token_address = 'dogecoin' THEN th.balance * $3
                    WHEN th.token_address = 'litecoin' THEN th.balance * $4
                  END)
              )
            )
          )
        ) AS chain_details,
        SUM(th.balance) AS total_balance,
        SUM(COALESCE(th.balance_usd, 
          CASE 
            WHEN th.token_address = 'bitcoin' THEN th.balance * $2
            WHEN th.token_address = 'dogecoin' THEN th.balance * $3
            WHEN th.token_address = 'litecoin' THEN th.balance * $4
          END)) AS total_balance_usd
      FROM token_holders th
      WHERE LOWER(th.name) LIKE LOWER($1)
        AND LOWER(th.chain) IN ('bitcoin', 'dogecoin', 'litecoin')
      GROUP BY th.token_address
      ORDER BY 
        CASE 
          WHEN th.token_address = 'bitcoin' THEN 1
          WHEN th.token_address = 'dogecoin' THEN 2
          WHEN th.token_address = 'litecoin' THEN 3
          ELSE 4
        END, total_balance_usd DESC NULLS LAST
      LIMIT 50
    `;
    const specialCoinsPortfolioResult = await withRetry(async () => 
      await query(specialCoinsPortfolioQuery, [`%${mappedExchange}%`, btcPrice, dogePrice, ltcPrice]));
    logger.info('Special coins (Bitcoin, Dogecoin, Litecoin) portfolio result:', { rows: specialCoinsPortfolioResult.rows });

    // Query for non-Bitcoin, non-Dogecoin, non-Litecoin wallets
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
      WHERE LOWER(exchange_name) LIKE LOWER($1)
        AND LOWER(chain) NOT IN ('bitcoin', 'dogecoin', 'litecoin')
      ORDER BY total_value_usd DESC NULLS LAST
      LIMIT 100
    `;
    const walletResult = await withRetry(async () => await query(walletQuery, [`%${mappedExchange}%`]));
    logger.info('Wallet result from wallet_holders:', { rows: walletResult.rows });

    // Query for Bitcoin, Dogecoin, and Litecoin wallets
    const specialCoinsWalletQuery = `
      SELECT 
        source AS exchange_name,
        chain,
        holder_address,
        COALESCE(balance_usd, 
          CASE 
            WHEN token_address = 'bitcoin' THEN balance * $2
            WHEN token_address = 'dogecoin' THEN balance * $3
            WHEN token_address = 'litecoin' THEN balance * $4
          END) AS total_value_usd,
        1 AS token_count,
        name_tag,
        image
      FROM token_holders
      WHERE LOWER(name) LIKE LOWER($1)
        AND LOWER(chain) IN ('bitcoin', 'dogecoin', 'litecoin')
      ORDER BY 
        CASE 
          WHEN token_address = 'bitcoin' THEN 1
          WHEN token_address = 'dogecoin' THEN 2
          WHEN token_address = 'litecoin' THEN 3
          ELSE 4
        END, total_value_usd DESC NULLS LAST
      LIMIT 100
    `;
    const specialCoinsWalletResult = await withRetry(async () => 
      await query(specialCoinsWalletQuery, [`%${mappedExchange}%`, btcPrice, dogePrice, ltcPrice]));
    logger.info('Special coins (Bitcoin, Dogecoin, Litecoin) wallet result:', { rows: specialCoinsWalletResult.rows });

    if (
      portfolioResult.rows.length === 0 &&
      specialCoinsPortfolioResult.rows.length === 0 &&
      walletResult.rows.length === 0 &&
      specialCoinsWalletResult.rows.length === 0
    ) {
      logger.warn(`No data found for exchange: ${exchange} (mapped to: ${mappedExchange})`, {
        ip,
        portfolioResult: portfolioResult.rows,
        specialCoinsPortfolioResult: specialCoinsPortfolioResult.rows,
        walletResult: walletResult.rows,
        specialCoinsWalletResult: specialCoinsWalletResult.rows,
      });
      await trackViolation(ip, `No data found for exchange: ${exchange}`);
      return NextResponse.json(
        { success: false, detail: `No portfolio or wallet data found for exchange: ${exchange}` },
        { status: 404, headers }
      );
    }

    const responseData = {
      success: true,
      portfolio: [
        ...specialCoinsPortfolioResult.rows.map((row) => ({
          token_address: row.token_address || 'unknown',
          symbol: row.symbol || (row.token_address === 'bitcoin' ? 'BTC' : 
                                row.token_address === 'dogecoin' ? 'DOGE' : 
                                row.token_address === 'litecoin' ? 'LTC' : row.token_address),
          logo: row.logo || (row.token_address === 'bitcoin' ? '/logos/bitcoin.webp' : 
                            row.token_address === 'dogecoin' ? '/logos/dogecoin.webp' : 
                            row.token_address === 'litecoin' ? '/logos/litecoin.webp' : '/fallback-image.webp'),
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
        ...specialCoinsWalletResult.rows.map((row) => ({
          exchange_name: row.exchange_name,
          chain: row.chain,
          holder_address: row.holder_address,
          total_value_usd: Number(row.total_value_usd) || 0,
          token_count: row.token_count || 0,
          name_tag: row.name_tag || 'N/A',
          image: row.image || (row.chain === 'bitcoin' ? '/logos/bitcoin.webp' : 
                              row.chain === 'dogecoin' ? '/logos/dogecoin.webp' : 
                              row.chain === 'litecoin' ? '/logos/litecoin.webp' : '/fallback-image.webp'),
        })),
        ...walletResult.rows.map((row) => ({
          exchange_name: row.exchange_name,
          chain: row.chain,
          holder_address: row.holder_address,
          total_value_usd: Number(row.total_value_usd) || 0,
          token_count: row.token_count || 0,
          name_tag: row.name_tag || 'N/A',
          image: row.image || '/fallback-image.webp',
        })),
      ],
    };

    await withRetry(async () => {
      const redisClient = await getRedisClient();
      await redisClient.setEx(cacheKey, 300, JSON.stringify(responseData));
    });

    logger.info(`Fetched portfolio and wallet data for exchange: ${exchange} (mapped to: ${mappedExchange})`, {
      ip,
      portfolioCount: portfolioResult.rows.length + specialCoinsPortfolioResult.rows.length,
      walletCount: walletResult.rows.length + specialCoinsWalletResult.rows.length,
    });

    return NextResponse.json(responseData, { headers });
  } catch (error) {
    await trackViolation(ip, `Error in token-cluster API: ${error.message}`);
    logger.error(`Error in token-cluster API: ${error.message}`, { ip, stack: error.stack });
    return NextResponse.json({ success: false, detail: `Error: ${error.message}` }, { status: 500, headers });
  }
}