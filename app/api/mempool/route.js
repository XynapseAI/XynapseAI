// app/api/mempool/route.js - Simplified for speed
// NEW: Added CoinMarketCap integration for BTC price and USD value calculation
// (Already public, no changes needed for auth)
// ADDED: Redis caching similar to etherscan-explorer

import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { z } from 'zod';
import { createClient } from 'redis';

const bodySchema = z.object({
  action: z.literal('tx-details'),
  txHash: z.string().refine((val) => /^[a-fA-F0-9]{64}$/.test(val), { message: 'Invalid Bitcoin transaction hash' }),
});

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
  try {
    if (origin && (allowedOrigins.includes(origin) || new URL(origin).hostname.endsWith('xynapseai.net'))) {
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('xynapseai.net')) {
        return true;
      }
    }
    if (!origin && !referer) {
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      return true;
    }
    return false;
  } catch {
    return false; 
  }
}

// Redis Client
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    await redisClient.connect();
    logger.info('Redis connected for mempool');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected for mempool');
  }
  return redisClient;
}

// NEW: Fetch BTC price from CoinMarketCap
async function fetchBtcPrice() {
  if (!process.env.COINMARKETCAP_API_KEY) {
    logger.info('CMC API key missing, skipping BTC price fetch');
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  const startTime = Date.now();
  logger.info(`Starting CMC fetch for BTC price at ${new Date().toISOString()}`);

  try {
    const response = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?id=1&convert=USD', {
      signal: controller.signal,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY,
        'User-Agent': 'xynapse-bot/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;
    logger.info(`CMC fetch completed in ${duration}ms`, { size: JSON.stringify(data).length });

    if (data.status?.error_code === 0 && data.data['1']?.quote?.USD?.price) {
      return data.data['1'].quote.USD.price;
    } else {
      logger.warn(`CMC returned error: ${data.status?.error_message}`);
      return null;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    logger.error(`CMC fetch failed after ${duration}ms`, { error: error.message, name: error.name });
    return null;
  }
}

// Native fetch with timeout (no axios/Bottleneck for speed)
async function fetchTx(txHash) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  const startTime = Date.now();
  logger.info(`Starting fetch for tx ${txHash} at ${new Date().toISOString()}`);

  try {
    const response = await fetch(`https://mempool.space/api/tx/${txHash}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'xynapse-bot/1.0' }, // Mimic curl
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;
    logger.info(`Mempool fetch completed in ${duration}ms`, { txHash, size: JSON.stringify(data).length });

    // NEW: Fetch BTC price and calculate USD values
    const btcPrice = await fetchBtcPrice();
    if (btcPrice) {
      // Total value in USD
      const totalValueBtc = data.vout ? data.vout.reduce((sum, out) => sum + (out.value || 0), 0) / 1e8 : 0;
      data.valueUSD = totalValueBtc * btcPrice;

      // Fee in USD
      const feeBtc = (data.fee || 0) / 1e8;
      data.feeUSD = feeBtc * btcPrice;

      // Per output USD (add to each vout)
      if (data.vout) {
        data.vout.forEach(vout => {
          vout.valueUSD = (vout.value || 0) / 1e8 * btcPrice;
        });
      }

      // Per input USD (add to each vin prevout if available)
      if (data.vin) {
        // Note: vin doesn't have value directly, but if expanded, can add
      }

      logger.info(`BTC price integrated: ${btcPrice} USD/BTC, total value USD: ${data.valueUSD}`);
    }

    return { success: true, data };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    logger.error(`Mempool fetch failed after ${duration}ms`, { txHash, error: error.message, name: error.name });
    throw error;
  }
}

export async function POST(request) {
  const startOverall = Date.now();
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.error('Invalid JSON body', { error: err.message });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn('Validation failed', { errors: err.errors });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { action, txHash } = parsedBody;
  if (action !== 'tx-details') {
    return NextResponse.json({ detail: 'Invalid action' }, { status: 400 });
  }

  try {
    const redis = await getRedisClient();
    const cacheKey = `explorer:tx:bitcoin:${txHash.toLowerCase()}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for tx-details: ${cacheKey}`);
      const result = JSON.parse(cached);
      const overallDuration = Date.now() - startOverall;
      logger.info(`Full API handler completed in ${overallDuration}ms (cache hit)`, { txHash });

      const res = NextResponse.json(result);
      const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
      res.headers.set('Access-Control-Allow-Origin', allowOrigin);
      res.headers.set('Access-Control-Allow-Methods', 'POST');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
      return res;
    }

    const result = await fetchTx(txHash);
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
    logger.info(`Cached tx-details: ${cacheKey}`);

    const overallDuration = Date.now() - startOverall;
    logger.info(`Full API handler completed in ${overallDuration}ms`, { txHash });

    const res = NextResponse.json(result);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'POST');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return res;
  } catch (error) {
    const overallDuration = Date.now() - startOverall;
    logger.error(`Full API error after ${overallDuration}ms`, { txHash, error: error.message, stack: error.stack });
    const detail = error.name === 'AbortError' ? 'Request timeout - network slow, retry?' : (error.message.includes('not found') ? 'Transaction not found' : 'API error');
    return NextResponse.json({ detail }, { status: 500 });
  }
}