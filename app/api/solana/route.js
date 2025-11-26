// app/api/solana/route.js
// Proxy for Helius Enhanced Transactions API
// Integrates with CoinGecko for USD values, logos, symbols (supports Solana mints via /coins/solana/contract/{mint})
// Based on Helius docs (Nov 2025): POST /v0/transactions?api-key=KEY
// UPDATED: POST /v0/transactions?api-key=KEY
// ADDED: Redis caching similar to etherscan-explorer

import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { createClient } from 'redis';

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 5,
  minTime: 250,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    return await axios(url, config);
  } catch (error) {
    if (error.response?.status === 429 || error.code === 'ECONNABORTED') {
      throw error;
    }
    throw error;
  }
});

// Redis Client
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    await redisClient.connect();
    logger.info('Redis connected for solana');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected for solana');
  }
  return redisClient;
}

// CoinGecko functions for Solana
const platformIdMap = {
  solana: 'solana',
};

// FIXED: Fetch token metadata/logo from CoinGecko by mint (exact case, no lower)
async function fetchCoinGeckoInfo(addresses) {
  if (addresses.length === 0) {
    logger.info('No addresses for CoinGecko fetch');
    return {};
  }

  const platform = platformIdMap['solana'];
  if (!platform) {
    logger.warn(`Unsupported platform for CoinGecko: solana`);
    return {};
  }

  const cgInfos = {};
  // Batch fetch: Promise.all single calls
  await Promise.all(addresses.map(async (addr) => {
    const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${addr}?localization=false&market_data=false`;
    try {
      const res = await fetchWithRateLimit(url, { method: 'GET', timeout: 5000 });
      if (res.data.id) {
        // FIXED: Use exact addr as key (no toLowerCase for Solana case-sensitive mints)
        cgInfos[addr] = {
          id: res.data.id,
          logo: res.data.image?.small || res.data.image?.thumb || null,
          name: res.data.name,
          symbol: res.data.symbol?.toUpperCase(),
        };
        logger.info(`CoinGecko info for ${addr} on ${platform}: ${res.data.name} (${res.data.symbol})`);
      }
    } catch (err) {
      logger.warn(`CoinGecko info failed for ${addr} on ${platform}: ${err.message}`);
    }
  }));

  const matchedCount = Object.keys(cgInfos).length;
  logger.info(`CoinGecko info fetched for ${matchedCount} tokens on ${platform} (queried ${addresses.length})`);
  return cgInfos;
}

// Fetch prices from CoinGecko by mint addresses (batch, original case)
async function fetchCoinGeckoPrices(addresses) {
  if (addresses.length === 0) {
    logger.info('No addresses for CoinGecko prices');
    return {};
  }

  const platform = platformIdMap['solana'];
  if (!platform) {
    logger.warn(`Unsupported platform for CoinGecko prices: solana`);
    return {};
  }

  const addressStr = addresses.join(',');
  const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${addressStr}&vs_currencies=usd`;
  try {
    const res = await fetchWithRateLimit(url, { method: 'GET', timeout: 5000 });
    logger.info(`CoinGecko prices called for ${addresses.length} addresses on ${platform}`);
    const matchedCount = Object.keys(res.data).length;
    logger.info(`CoinGecko prices fetched for ${matchedCount} tokens on ${platform}`);
    return res.data;
  } catch (err) {
    logger.warn(`CoinGecko prices fetch failed for ${platform}: ${err.message}`);
    return {};
  }
}

// Fetch SOL price from CoinGecko
async function fetchSolPrice() {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd`;
  try {
    const res = await fetchWithRateLimit(url, { method: 'GET', timeout: 5000 });
    const price = res.data.solana?.usd || null;
    logger.info(`SOL price from CoinGecko: ${price || 'N/A'} USD`);
    return price;
  } catch (err) {
    logger.warn(`CoinGecko SOL price fetch failed: ${err.message}`);
    return null;
  }
}

// Allowed origins (same as etherscan)
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  "https://base.xynapseai.net",
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

function isAllowedOrigin(origin, referer) {
  // Same logic as etherscan
  try {
    if (origin && (allowedOrigins.includes(origin) || new URL(origin).hostname.endsWith('xynapseai.net'))) {
      logger.info(`Origin allowed: ${origin}`);
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('xynapseai.net')) {
        logger.info(`Referer origin allowed: ${refOrigin}`);
        return true;
      }
    }
    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }
    logger.error(`CORS blocked: Origin=${origin || 'null'}, Referer=${referer || 'null'}`);
    return false;
  } catch (err) {
    logger.error(`Error in isAllowedOrigin: ${err.message}`, { origin, referer });
    return false;
  }
}

const bodySchema = z.object({
  action: z.literal('tx-details'),
  txHash: z.string().refine((val) => /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(val), { message: 'Invalid Solana signature' }),
});

// CORS wrapper (same as etherscan)
const handlerWrapper = (handler) =>
  limiterBottleneck.wrap(async (req) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    const startTime = Date.now();
    logger.info(`Request to /api/solana from IP ${ip}, Origin: ${origin || 'null'}, Referer: ${referer || 'null'}`);

    if (!isAllowedOrigin(origin, referer)) {
      return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
    }

    const res = await handler(req);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'POST');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Token');
    res.headers.set('Content-Security-Policy', "default-src 'self'");
    logger.info(`Response for /api/solana, time: ${Date.now() - startTime}ms`, { ip });
    return res;
  });

export const POST = handlerWrapper(async (request) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { action, txHash } = parsedBody;

  // REMOVED: Internal token and session auth check - Public feature, no login required
  // (Keep internal token if needed for server-side, but allow public without it)

  if (!process.env.HELIUS_API_KEY) {
    logger.error('HELIUS_API_KEY is not configured');
    return NextResponse.json({ detail: 'Server configuration error: Missing HELIUS_API_KEY' }, { status: 500 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          if (action === 'tx-details') {
            const redis = await getRedisClient();
            const cacheKey = `explorer:tx:solana:${txHash}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
              logger.info(`Cache hit for tx-details: ${cacheKey}`);
              controller.enqueue(cached);
              controller.close();
              return;
            }

            const url = `https://api-mainnet.helius-rpc.com/v0/transactions?api-key=${process.env.HELIUS_API_KEY}`;
            logger.info('Calling Helius Enhanced Transactions API', { txHash, ip });
            const response = await fetchWithRateLimit(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              data: JSON.stringify({ transactions: [txHash] }),
              timeout: 15000,
            });

            if (response.status !== 200) {
              throw new Error(`Helius API error: ${response.status}`);
            }

            const txs = response.data;
            if (!txs || txs.length === 0 || !txs[0]) {
              throw new Error('Transaction not found');
            }

            let tx = txs[0];

            // UPDATED: Enrich with SOL price from CoinGecko
            const solPrice = await fetchSolPrice();
            tx.solPrice = solPrice;
            tx.fee = (tx.fee || 0) / 1e9;
            tx.feeUSD = tx.fee * (solPrice || 0);

            const nativeTransfers = tx.nativeTransfers || [];
            const nativeValue = nativeTransfers.reduce((sum, t) => sum + (t.amount || 0), 0) / 1e9;
            tx.nativeValue = nativeValue;
            tx.nativeValueUSD = nativeValue * (solPrice || 0);

            // Map common fields
            tx.hash = tx.signature;
            tx.status = tx.transactionError ? 'Failed' : 'Success';
            tx.isSuccess = tx.status === 'Success';
            tx.timestamp = (tx.blockTime || Date.now() / 1000) * 1000;
            tx.blockNumber = tx.slot;
            tx.from = tx.feePayer;
            tx.to = nativeTransfers.length > 0 ? nativeTransfers[0].toUserAccount : (tx.tokenTransfers?.[0]?.toUserAccount || 'Contract');

            // FIXED: Enrich tokenTransfers with CoinGecko (exact mint match)
            if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
              const uniqueMints = [...new Set(tx.tokenTransfers.map(t => t.mint))]; // Original case
              const cgInfos = await fetchCoinGeckoInfo(uniqueMints);
              const cgPrices = await fetchCoinGeckoPrices(uniqueMints); // Batch with original cases

              tx.tokenTransfers = tx.tokenTransfers.map(t => {
                const mint = t.mint; // Exact case
                const cgInfo = cgInfos[mint]; // FIXED: Exact match, no lower
                const cgPrice = cgPrices[mint]?.usd || null; // CoinGecko returns keys as requested case
                const decimals = t.decimals || t.uiTokenAmount?.decimals || 6;
                const rawAmount = t.tokenAmount || 0;
                const amount = t.uiTokenAmount?.uiAmount || (rawAmount / Math.pow(10, decimals));
                const valueUSD = cgPrice ? amount * cgPrice : null;

                return {
                  ...t,
                  logo: cgInfo?.logo || null,
                  symbol: cgInfo?.symbol || 'UNK',
                  name: cgInfo?.name || 'Unknown Token',
                  priceUSD: cgPrice || null,
                  valueUSD: valueUSD || null,
                  amount,
                  decimals,
                };
              });
            }

            const data = { success: true, data: tx };
            await redis.set(cacheKey, JSON.stringify(data), 'EX', 3600);
            logger.info(`Cached tx-details: ${cacheKey}`);
            controller.enqueue(JSON.stringify(data));
          } else {
            throw new Error(`Invalid action: ${action}`);
          }
          controller.close();
        } catch (error) {
          logger.error(`Helius API error for action ${action}: ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
            stack: error.stack,
            ip,
          });
          const status = error.response?.status || 500;
          const detail = status === 429 ? 'Helius API rate limit exceeded' : `Helius API error: ${error.message}`;
          controller.enqueue(JSON.stringify({ detail }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
});