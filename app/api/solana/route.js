// app/api/solana/route.js
// Proxy for Helius Enhanced Transactions API
// Integrates with CMC for USD values, logos, symbols (supports Solana mints via platforms.solana)
// Based on Helius docs (Nov 2025): POST /v0/transactions?api-key=KEY

import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger'; // Assume same as etherscan
import Bottleneck from 'bottleneck';
// REMOVED: import { auth } from '@/lib/auth'; - No session required for public feature

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

// CMC functions (copied/adapted from etherscan/route.js)
async function fetchCmcInfo(addresses) { // Works for Solana mints (platforms.solana = mint)
  if (!process.env.COINMARKETCAP_API_KEY || addresses.length === 0) {
    logger.info('CMC API key missing or no addresses, skipping CMC fetch');
    return {};
  }

  const addressStr = addresses.join(',');
  const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?address=${addressStr}`;
  const config = {
    headers: {
      'Accept': 'application/json',
      'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY,
    },
    timeout: 10000,
  };

  try {
    const res = await fetchWithRateLimit(url, config);
    logger.info(`CMC info called for ${addresses.length} tokens (Solana mints)`);
    if (res.data.status?.error_code === 0) {
      const cmcInfos = {};
      Object.entries(res.data.data).forEach(([cmcId, info]) => {
        if (info.platforms) {
          Object.entries(info.platforms).forEach(([platform, tokenAddress]) => {
            if (platform === 'solana') {
              const lowerAddr = tokenAddress.toLowerCase(); // Mint case-insensitive?
              if (addresses.includes(lowerAddr)) {
                cmcInfos[lowerAddr] = {
                  id: cmcId,
                  logo: info.logo?.png || info.logo,
                  name: info.name,
                  symbol: info.symbol,
                };
              }
            }
          });
        }
      });
      const matchedCount = Object.keys(cmcInfos).length;
      logger.info(`CMC info fetched for ${matchedCount} Solana tokens (queried ${addresses.length})`);
      return cmcInfos;
    } else {
      logger.warn(`CMC info error: ${res.data.status?.error_message}`);
      return {};
    }
  } catch (err) {
    logger.warn(`CMC info fetch failed: ${err.message}`);
    return {};
  }
}

async function fetchCmcPrices(ids) {
  if (!process.env.COINMARKETCAP_API_KEY || ids.length === 0) {
    logger.info('CMC prices skipped: no key or ids');
    return {};
  }

  const idStr = ids.join(',');
  const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?id=${idStr}&convert=USD`;
  const config = {
    headers: {
      'Accept': 'application/json',
      'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY,
    },
    timeout: 10000,
  };

  try {
    const res = await fetchWithRateLimit(url, config);
    logger.info(`CMC prices called for ${ids.length} ids`);
    if (res.data.status?.error_code === 0) {
      logger.info(`CMC prices fetched for ${ids.length} tokens`);
      return res.data.data;
    } else {
      logger.warn(`CMC prices error: ${res.data.status?.error_message}`);
      return {};
    }
  } catch (err) {
    logger.warn(`CMC prices fetch failed: ${err.message}`);
    return {};
  }
}

// Fetch SOL price (CMC ID 5426)
async function fetchSolPrice() {
  if (!process.env.COINMARKETCAP_API_KEY) {
    logger.info('CMC key missing, skipping SOL price');
    return null;
  }

  const cmcPrices = await fetchCmcPrices(['5426']);
  const price = cmcPrices['5426']?.quote?.USD?.price || null;
  logger.info(`SOL price from CMC: ${price || 'N/A'} USD`);
  return price;
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

            // Enrich with SOL price
            const solPrice = await fetchSolPrice();
            tx.solPrice = solPrice; // FIXED: Pass solPrice to client-side data
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

            // Enrich tokenTransfers with CMC
            if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
              const uniqueMints = [...new Set(tx.tokenTransfers.map(t => t.mint))];
              const cmcInfos = await fetchCmcInfo(uniqueMints);
              const mintToId = {};
              Object.entries(cmcInfos).forEach(([mint, info]) => { mintToId[mint] = info.id; });
              const ids = uniqueMints.filter(m => mintToId[m]).map(m => mintToId[m]);
              const cmcQuotes = await fetchCmcPrices(ids);

              tx.tokenTransfers = tx.tokenTransfers.map(t => {
                const mint = t.mint;
                const cmcInfo = cmcInfos[mint];
                const cmcId = mintToId[mint];
                const priceUSD = cmcId ? cmcQuotes[cmcId]?.quote?.USD?.price : null;
                // Use uiTokenAmount if present, else compute
                const decimals = t.decimals || t.uiTokenAmount?.decimals || 6;
                const rawAmount = t.tokenAmount || 0;
                const amount = t.uiTokenAmount?.uiAmount || (rawAmount / Math.pow(10, decimals));
                const valueUSD = priceUSD ? amount * priceUSD : null;

                return {
                  ...t,
                  logo: cmcInfo?.logo || null,
                  symbol: cmcInfo?.symbol || 'UNK',
                  name: cmcInfo?.name || 'Unknown Token',
                  priceUSD: priceUSD || null,
                  valueUSD: valueUSD || null,
                  amount, // For render
                  decimals,
                };
              });
            }

            controller.enqueue(JSON.stringify({ success: true, data: tx }));
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