// app/api/token-cluster/route.js
import { NextResponse } from 'next/server';
import { query } from '../../../utils/postgres';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { auth } from '@/lib/auth';
import cookie from 'cookie';
import crypto from 'crypto';

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
    try {
      await redisClient.connect();
      logger.info('Redis connected (initial)');
    } catch (err) {
      logger.error('Redis initial connect failed', { err });
      throw new Error('Redis connection failed');
    }
  } else if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
      logger.info('Redis reconnected');
    } catch (err) {
      logger.error('Redis reconnect failed', { err });
      throw new Error('Redis connection failed');
    }
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

function securityHeaders(origin) {
  const csp = `
    default-src 'self';
    script-src 'self';
    connect-src 'self';
    object-src 'none';
    frame-ancestors 'none';
    base-uri 'self';
  `.replace(/\n/g, ' ').trim();
  const headers = {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
  if (origin && origin !== 'null') {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF-Token';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

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

async function checkRateLimit(ip, userId) {
  const client = await getRedisClient();
  const windowSeconds = 15 * 60;
  const ipKey = `rate:ip:${ip}`;
  const userKey = userId ? `rate:user:${userId}` : null;
  const ipMax = process.env.NODE_ENV === 'development' ? 1000 : 500;
  const userMax = process.env.NODE_ENV === 'development' ? 500 : 200;

  const ipCount = Number(await client.incr(ipKey));
  if (ipCount === 1) await client.expire(ipKey, windowSeconds);
  if (ipCount > ipMax) {
    const ttl = await client.ttl(ipKey);
    throw Object.assign(new Error('Too many requests from this IP'), { ttl });
  }

  if (userKey) {
    const uCount = Number(await client.incr(userKey));
    if (uCount === 1) await client.expire(userKey, windowSeconds);
    if (uCount > userMax) {
      const ttl = await client.ttl(userKey);
      throw Object.assign(new Error('Too many requests for this user'), { ttl });
    }
  }
}

async function trackViolation(ip, reason, severity = 'warn') {
  if (severity === 'warn') {
    logger.warn('Violation recorded (warning)', { ip, reason });
    return;
  }

  const client = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 5;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await client.get(key)) || 0;
  if (violations >= maxViolations) {
    await client.setEx(`banned_ip:${ip}`, 3600, 'banned');
    logger.info('IP banned', { ip, reason });
    throw new Error('IP banned due to repeated violations.');
  }
  await client.multi().incr(key).expire(key, Math.floor(windowMs / 1000)).exec();
  logger.warn('Violation recorded (severe)', { ip, reason, violations: violations + 1 });
}

async function checkDoubleSubmitCSRF(request) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = cookie.parse(request.headers.get('cookie') || '');
  const cookieToken = cookies['csrf_token'] || '';
  if (
    process.env.NODE_ENV === 'development' &&
    headerToken === 'dev-csrf' &&
    cookieToken === 'dev-csrf'
  ) {
    logger.info('Development CSRF bypass used');
    return true;
  }
  if (!headerToken || !cookieToken) {
    logger.warn('CSRF tokens missing', { headerProvided: !!headerToken, cookieProvided: !!cookieToken });
    return false;
  }
  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
  if (!valid) {
    logger.warn('CSRF token mismatch');
  }
  return valid;
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
  kraken: 'kraken',
  'huobi-global': 'huobi',
  kucoin: 'kucoin',
  'gate-io': 'gate',
  bitfinex: 'bitfinex',
};

// Capitalize function
const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

function mapExchangeName(exchangeId) {
  return EXCHANGE_MAPPING[exchangeId.toLowerCase()] || exchangeId.toLowerCase();
}

const fetchPrices = async (currency) => {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,dogecoin,litecoin&vs_currencies=${currency}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Your-App-Name/1.0'
        },
      }
    );
    const result = await response.json();
    if (response.ok) {
      return {
        bitcoin: result.bitcoin?.[currency] || 0,
        dogecoin: result.dogecoin?.[currency] || 0,
        litecoin: result.litecoin?.[currency] || 0,
      };
    } else {
      throw new Error('Failed to fetch coin prices');
    }
  } catch (err) {
    logger.error(`Error fetching coin prices in API:`, { error: err.message });
    return { bitcoin: 0, dogecoin: 0, litecoin: 0 };
  }
};

export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const pathname = new URL(request.url).pathname;
  const referer = request.headers.get('referer');

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin, referer });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  return new NextResponse(null, {
    status: 204,
    headers: securityHeaders(origin),
  });
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const { exchange, currency = 'usd' } = params;

  logger.info('GET /api/token-cluster requested', { ip, origin, referer, query: Object.keys(params) });

  if (!(await isAllowedOrigin(origin, referer, pathname))) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  if (!exchange || typeof exchange !== 'string' || exchange.trim() === '') {
    await trackViolation(ip, 'Missing or invalid exchange parameter', 'warn');
    logger.warn(`Missing or invalid exchange parameter: ${exchange}`, { ip });
    return NextResponse.json({ detail: 'Missing or invalid exchange parameter' }, { status: 400, headers });
  }

  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      logger.warn('Rate limit exceeded', { ip, userId });
      return NextResponse.json(
        { detail: err.message },
        { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
      );
    }

    const isAuthenticated = !!session;

    if (isAuthenticated) {
      const csrfOk = await checkDoubleSubmitCSRF(request);
      if (!csrfOk) {
        await trackViolation(ip, 'Invalid CSRF token', 'severe');
        logger.warn('Invalid CSRF token', { ip });
        return NextResponse.json({ detail: 'Invalid CSRF check.' }, { status: 403, headers });
      }
    }

    try {
      const redisClient = await getRedisClient();
      const mappedExchange = mapExchangeName(exchange);
      const cacheKey = isAuthenticated
        ? `token_cluster:auth:${mappedExchange}:${currency}`
        : `token_cluster:public:${mappedExchange}:${currency}`;
      const cacheTTL = isAuthenticated ? 300 : 3600;

      const cachedData = await withRetry(async () => await redisClient.get(cacheKey));
      if (cachedData) {
        logger.info(`Cache hit for exchange: ${mappedExchange}, auth: ${isAuthenticated}, currency: ${currency}`, { ip });
        return NextResponse.json(JSON.parse(cachedData), { headers });
      }

      const searchPattern = `%${mappedExchange}%`;

      // Fetch prices for calculation
      const prices = await fetchPrices(currency);

      // Query for non-Bitcoin, non-Dogecoin, non-Litecoin tokens
      const portfolioQuery = `
 WITH wallet_tokens AS (
   SELECT 
     COALESCE(
       wh.normalized_cluster_name, 
       normalize_cluster_name(COALESCE(wh.cluster_name, wh.exchange_name))
     ) AS cluster_name,
     wh.chain,
     wh.holder_address,
     t.token->>'token_address' AS token_address,
     COALESCE(tk.symbol, t.token->>'symbol') AS symbol,
     COALESCE(tk.image, t.token->>'logo') AS logo,
     (t.token->>'balance')::NUMERIC AS balance,
     (t.token->>'balance_usd')::NUMERIC AS balance_usd
   FROM wallet_holders wh
   CROSS JOIN jsonb_array_elements(wh.metadata) AS t(token)
   LEFT JOIN tokens tk ON (t.token->>'token_address') = tk.coingecko_id
   WHERE COALESCE(
     wh.normalized_cluster_name, 
     normalize_cluster_name(COALESCE(wh.cluster_name, wh.exchange_name))
   ) ILIKE $1
     AND LOWER(wh.chain) NOT IN ('bitcoin', 'dogecoin', 'litecoin')
     AND (tk.image IS NOT NULL OR t.token->>'logo' IS NOT NULL)
     AND (tk.image != '' OR t.token->>'logo' != '')
     AND (tk.image != '/fallback-image.webp' OR t.token->>'logo' != '/fallback-image.webp')
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

      // Query for Bitcoin, Dogecoin, Litecoin - include balance for calculation
      const specialCoinsPortfolioQuery = `
        SELECT 
          th.coingecko_id AS token_address,
          CASE 
            WHEN th.coingecko_id = 'bitcoin' THEN 'BTC'
            WHEN th.coingecko_id = 'dogecoin' THEN 'DOGE'
            WHEN th.coingecko_id = 'litecoin' THEN 'LTC'
          END AS symbol,
          CASE 
            WHEN th.coingecko_id = 'bitcoin' THEN '/logos/bitcoin.webp'
            WHEN th.coingecko_id = 'dogecoin' THEN '/logos/dogecoin.webp'
            WHEN th.coingecko_id = 'litecoin' THEN '/logos/litecoin.webp'
          END AS logo,
          json_agg(
            json_build_object(
              'chain', th.chain,
              'balance', th.balance,
              'balance_usd', th.balance_usd,
              'wallets', json_build_array(
                json_build_object(
                  'holder_address', LOWER(th.holder_address),
                  'balance', th.balance,
                  'value', th.balance_usd
                )
              )
            )
          ) AS chain_details,
          SUM(th.balance) AS total_balance,
          SUM(th.balance_usd) AS total_balance_usd
        FROM token_holders th
        WHERE th.name ILIKE $1
          AND LOWER(th.chain) IN ('bitcoin', 'dogecoin', 'litecoin')
        GROUP BY th.coingecko_id
        ORDER BY 
          CASE 
            WHEN th.coingecko_id = 'bitcoin' THEN 1
            WHEN th.coingecko_id = 'dogecoin' THEN 2
            WHEN th.coingecko_id = 'litecoin' THEN 3
            ELSE 4
          END, total_balance_usd DESC NULLS LAST
        LIMIT 50
      `;

      // Query for non-Bitcoin, non-Dogecoin, non-Litecoin wallets
      const walletQuery = `
 SELECT 
   COALESCE(
     wh.normalized_cluster_name, 
     normalize_cluster_name(COALESCE(wh.cluster_name, wh.exchange_name))
   ) AS cluster_name,
   wh.chain,
   LOWER(wh.holder_address) AS holder_address,
   wh.total_value_usd,
   wh.token_count,
   wh.name_tag,
   wh.image
 FROM wallet_holders wh
 WHERE COALESCE(
   wh.normalized_cluster_name, 
   normalize_cluster_name(COALESCE(wh.cluster_name, wh.exchange_name))
 ) ILIKE $1
   AND LOWER(wh.chain) NOT IN ('bitcoin', 'dogecoin', 'litecoin')
 ORDER BY wh.total_value_usd DESC NULLS LAST
 LIMIT 100
`;

      // Query for Bitcoin, Dogecoin, Litecoin wallets - include balance for calculation
      const specialCoinsWalletQuery = `
        SELECT 
          source AS cluster_name,
          chain,
          LOWER(holder_address) AS holder_address,
          balance,
          balance_usd,
          1 AS token_count,
          name_tag,
          image
        FROM token_holders
        WHERE name ILIKE $1
          AND LOWER(chain) IN ('bitcoin', 'dogecoin', 'litecoin')
        ORDER BY 
          CASE 
            WHEN token_address = 'bitcoin' THEN 1
            WHEN token_address = 'dogecoin' THEN 2
            WHEN token_address = 'litecoin' THEN 3
            ELSE 4
          END, balance_usd DESC NULLS LAST
        LIMIT 100
      `;

      // Execute queries in parallel
      const [portfolioResult, specialCoinsPortfolioResult, walletResult, specialCoinsWalletResult] = await Promise.all([
        withRetry(async () => await query(portfolioQuery, [searchPattern])),
        withRetry(async () => await query(specialCoinsPortfolioQuery, [searchPattern])),
        withRetry(async () => await query(walletQuery, [searchPattern])),
        withRetry(async () => await query(specialCoinsWalletQuery, [searchPattern])),
      ]);

      logger.info('Portfolio result from wallet_holders:', { rows: portfolioResult.rows });
      logger.info('Special coins portfolio result:', { rows: specialCoinsPortfolioResult.rows });
      logger.info('Wallet result from wallet_holders:', { rows: walletResult.rows });
      logger.info('Special coins wallet result:', { rows: specialCoinsWalletResult.rows });

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
          queryExchange: exchange,
          mappedExchange,
        });
        await trackViolation(ip, `No data found for exchange: ${exchange}`, 'warn');
        return NextResponse.json(
          {
            success: true, // Change to success: true to allow partial data
            portfolio: [],
            wallets: isAuthenticated ? [] : [],
            message: `No portfolio or wallet data found for cluster: ${exchange}. Please check the cluster name or try another.`,
          },
          { status: 200, headers } // Use 200 to indicate a successful response with no data
        );
      }

      // Post-process special coins to calculate USD if missing or zero
      const processedSpecialPortfolio = specialCoinsPortfolioResult.rows.map(row => {
        const coinId = row.token_address;
        const price = prices[coinId];
        const processedChainDetails = (row.chain_details || []).map(cd => {
          const currentUsd = Number(cd.balance_usd || 0);
          const calculatedUsd = Number(cd.balance || 0) * price;
          return {
            ...cd,
            balance_usd: (currentUsd <= 0 && calculatedUsd > 0) ? calculatedUsd : currentUsd
          };
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const totalBalanceUsd = processedChainDetails.reduce((sum, cd) => sum + (Number(cd.balance_usd) || 0), 0);
        const currentTotalUsd = Number(row.total_balance_usd || 0);
        const calculatedTotalUsd = Number(row.total_balance || 0) * price;
        return {
          ...row,
          chain_details: processedChainDetails,
          total_balance_usd: (currentTotalUsd <= 0 && calculatedTotalUsd > 0) ? calculatedTotalUsd : currentTotalUsd,
        };
      });

      const processedSpecialWallets = specialCoinsWalletResult.rows.map(row => {
        const price = prices[row.chain];
        const currentUsd = Number(row.balance_usd || 0);
        const calculatedUsd = Number(row.balance || 0) * price;
        const totalValueUsd = (currentUsd <= 0 && calculatedUsd > 0) ? calculatedUsd : currentUsd;
        return {
          ...row,
          total_value_usd: totalValueUsd,
        };
      });

      // Response data without prices
      const responseData = {
        success: true,
        portfolio: [
          ...processedSpecialPortfolio.map((row) => ({
            token_address: row.token_address || 'unknown',
            symbol: row.symbol || (row.token_address === 'bitcoin' ? 'BTC' : row.token_address === 'dogecoin' ? 'DOGE' : row.token_address === 'litecoin' ? 'LTC' : row.token_address),
            logo: row.logo || (row.token_address === 'bitcoin' ? '/logos/bitcoin.webp' : row.token_address === 'dogecoin' ? '/logos/dogecoin.webp' : row.token_address === 'litecoin' ? '/logos/litecoin.webp' : '/fallback-image.webp'),
            total_balance: Number(row.total_balance) || 0,
            total_balance_usd: Number(row.total_balance_usd) || 0,
            chain_details: row.chain_details || [],
          })),
          ...portfolioResult.rows.map((row) => ({
            token_address: row.token_address,
            symbol: row.symbol || row.token_address,
            logo: row.logo || '/fallback-image.webp',
            total_balance: Number(row.total_balance) || 0,
            total_balance_usd: Number(row.total_balance_usd) || 0,
            chain_details: row.chain_details || [],
          })),
        ],
        wallets: isAuthenticated
          ? [
              ...processedSpecialWallets.map((row) => ({
                cluster_name: capitalize(row.cluster_name),
                chain: row.chain,
                holder_address: row.holder_address || row.name_tag, // Fallback to nametag
                total_value_usd: Number(row.total_value_usd) || 0,
                token_count: row.token_count || 0,
                name_tag: row.name_tag || 'N/A',
                image: row.image || (row.chain === 'bitcoin' ? '/logos/bitcoin.webp' : row.chain === 'dogecoin' ? '/logos/dogecoin.webp' : row.chain === 'litecoin' ? '/logos/litecoin.webp' : '/fallback-image.webp'),
              })),
              ...walletResult.rows.map((row) => ({
                cluster_name: capitalize(row.cluster_name),
                chain: row.chain,
                holder_address: row.holder_address || row.name_tag, // Fallback to nametag
                total_value_usd: Number(row.total_value_usd) || 0,
                token_count: row.token_count || 0,
                name_tag: row.name_tag || 'N/A',
                image: row.image || '/fallback-image.webp',
              })),
            ]
          : [],
      };

      await withRetry(async () => {
        const redisClient = await getRedisClient();
        await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(responseData));
      });

      logger.info(`Fetched portfolio and wallet data for exchange: ${exchange} (mapped to: ${mappedExchange})`, {
        ip,
        portfolioCount: portfolioResult.rows.length + processedSpecialPortfolio.length,
        walletCount: isAuthenticated ? walletResult.rows.length + processedSpecialWallets.length : 0,
        auth: isAuthenticated,
        currency,
      });

      return NextResponse.json(responseData, { headers });
    } catch (error) {
      await trackViolation(ip, `Error in token-cluster API: ${error.message}`, 'severe');
      logger.error(`Error in token-cluster API: ${error.message}`, { ip, stack: error.stack });
      return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500, headers });
    }
  } catch (err) {
    logger.error('Unexpected error in GET', { err: err?.message });
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers });
  }
}