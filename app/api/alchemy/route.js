// app/api/alchemy/route.js
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis'; // Giữ Upstash vì đã dùng, nhưng thêm wrapper như node-redis
import { ethers } from 'ethers';
import { logger } from '../../../utils/serverLogger'; // Giả sử có logger

const redis = Redis.fromEnv();
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

// ================= Security & Utils =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://base.xynapseai.net',
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
    if (!origin && process.env.NODE_ENV === 'development') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function securityHeaders(origin) {
  const baseHeaders = {
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self';",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };
  if (origin && origin !== 'null') {
    baseHeaders['Access-Control-Allow-Origin'] = origin;
    baseHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    baseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return baseHeaders;
}

async function checkRateLimit(ip) {
  const key = `rate_limit:alchemy:${ip}`;
  const maxRequests = 50;
  const windowMs = 60 * 1000;
  const cached = await redis.get(key);
  const requests = cached ? Number(cached) : 0;
  if (requests >= maxRequests) {
    const err = new Error('Too many requests, please try again later.');
    err.ttl = 60;
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`);
    throw err;
  }
  await redis.set(key, requests + 1, { ex: Math.floor(windowMs / 1000) });
  logger.info(`Rate limit check passed for IP ${ip}: ${requests + 1}/${maxRequests}`);
}

async function banIP(ip, durationSeconds = 1800) {
  await redis.set(`banned_ip:${ip}`, 'banned', { ex: durationSeconds });
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}

async function checkIPBan(ip) {
  const isBanned = await redis.get(`banned_ip:${ip}`);
  if (isBanned) {
    logger.error(`IP ban detected: ${ip}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown', severity = 'severe') {
  const nonCriticalReasons = ['CORS blocked', 'Chain required', 'Invalid action'];
  if (nonCriticalReasons.includes(reason) || severity === 'warn') {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}`);
    return;
  }
  const key = `violations:${ip}`;
  const maxViolations = 10;
  const windowMs = 30 * 60 * 1000;
  const violations = await redis.get(key);
  const numViolations = violations ? Number(violations) : 0;
  if (numViolations >= maxViolations) {
    await banIP(ip);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redis.set(key, numViolations + 1, { ex: Math.floor(windowMs / 1000) });
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${numViolations + 1}`);
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!isAllowedOrigin(origin, referer)) {
    logger.warn('CORS origin not allowed for OPTIONS', { origin, referer });
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }
  return new NextResponse(null, { status: 204, headers: securityHeaders(origin) });
}

const rpcMap = {
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  optimism: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  avalanche: `https://avax-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  celo: `https://celo-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  gnosis: `https://gnosis-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  zksync: `https://zksync-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  linea: `https://linea-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  bsc: `https://bnb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  abstract: `https://abstract-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  apechain: `https://apechain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  hyperevm: `https://hyperliquid-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  monad: `https://monad-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  unichain: `https://linea-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  world: `https://worldchain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
};

const nativeIdMap = {
  ethereum: '1027', // ETH
  bsc: '1839', // BNB
  arbitrum: '1027', // ETH
  optimism: '1027', // ETH
  polygon: '3890', // MATIC
  base: '1027', // ETH
  avalanche: '5805', // AVAX
  celo: '5568', // CELO
  gnosis: '16547', // xDAI
  zksync: '1027', // ETH
  linea: '1027', // ETH
  monad: '143', // MON
  hyperevm: '999', // HYPER
};

async function fetchNativePrice(chain) {
  if (!process.env.COINMARKETCAP_API_KEY) {
    return null;
  }
  const nativeId = nativeIdMap[chain];
  if (!nativeId) return null;
  const idStr = nativeId;
  const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?id=${idStr}&convert=USD`;
  const config = {
    headers: {
      'Accept': 'application/json',
      'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY,
    },
    timeout: 10000,
  };
  try {
    const res = await fetch(url, config);
    const data = await res.json();
    if (data.status?.error_code === 0) {
      const price = data.data[nativeId]?.quote?.USD?.price || null;
      return price;
    }
  } catch (err) {
    logger.warn(`CMC native price failed for ${chain}: ${err.message}`);
  }
  return null;
}

const getCachedData = async (key, defaultVal = []) => {
  const cached = await redis.get(key);
  if (cached === null) return defaultVal;
  return typeof cached === 'string' ? JSON.parse(cached) : cached;
};

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`POST request to /api/alchemy from IP ${ip}`, { origin, timestamp: new Date().toISOString() });

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked', 'warn');
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders(origin) });
  }

  const headers = securityHeaders(origin);

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    if (err.message.includes('Too many requests')) {
      return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers: { ...headers, 'Retry-After': '60' } });
    }
    await trackViolation(ip, err.message, 'severe');
    return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers });
  }

  if (!ALCHEMY_API_KEY) {
    await trackViolation(ip, 'Alchemy API key required', 'warn');
    return NextResponse.json({ error: 'Alchemy API key required' }, { status: 500, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    await trackViolation(ip, 'Invalid JSON body', 'warn');
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers });
  }

  const { action, chain } = body;

  if (!chain || typeof chain !== 'string' || chain.trim() === '') {
    await trackViolation(ip, 'Chain required', 'warn');
    return NextResponse.json({ error: 'Chain required' }, { status: 400, headers });
  }

  const isEVM = !['bitcoin', 'solana'].includes(chain);

  try {
    if (action === 'native-price') {
      let price = await redis.get(`price:${chain}`);
      if (price === null) {
        price = await fetchNativePrice(chain);
        if (price !== null) {
          await redis.set(`price:${chain}`, price, { EX: 3600 });
        }
      }
      return NextResponse.json({ price: Number(price) || 0 }, { headers });
    }

    if (action === 'latest-blocks') {
      let blocks = await getCachedData(`blocks:${chain}`);
      if (blocks.length === 0 && isEVM) {
        const rpcUrl = rpcMap[chain];
        if (rpcUrl) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const latestNum = await provider.getBlockNumber();
          const numBlocks = 10;
          const blockPromises = [];
          for (let i = 0; i < numBlocks; i++) {
            const num = latestNum - i;
            blockPromises.push(
              provider.getBlock(num).then(b => ({
                number: b.number,
                timestamp: b.timestamp,
                miner: b.miner,
                transactions: b.transactions.length
              })).catch(() => null)
            );
          }
          let fetchedBlocks = await Promise.all(blockPromises);
          fetchedBlocks = fetchedBlocks.filter(Boolean).slice(0, 10);
          blocks = fetchedBlocks.reverse(); // newest first
          await redis.set(`blocks:${chain}`, JSON.stringify(blocks), { EX: 30 });
        }
      }
      return NextResponse.json(blocks, { headers });
    }

    if (action === 'latest-txs') {
      let txs = await getCachedData(`txs:${chain}`);
      if (txs.length === 0 && isEVM) {
        const rpcUrl = rpcMap[chain];
        if (rpcUrl) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const latestBlock = await provider.getBlock('latest', true);
          const fetchedTxs = latestBlock.transactions.slice(0, 20).map(tx => ({
            hash: tx.hash,
            from: tx.from,
            to: tx.to || null,
            value: tx.value ? tx.value.toString() : '0'
          }));
          txs = fetchedTxs;
          await redis.set(`txs:${chain}`, JSON.stringify(txs), { EX: 30 });
        }
      }
      return NextResponse.json(txs, { headers });
    }

    if (action === 'chain-stats') {
      let stats = await getCachedData(`stats:${chain}`, { blockNumber: 0, gasPrice: '0' });
      if (stats.blockNumber === 0 && isEVM) {
        const rpcUrl = rpcMap[chain];
        if (rpcUrl) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const blockNumber = await provider.getBlockNumber();
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice?.toString() || '0';
          stats = { blockNumber, gasPrice };
          await redis.set(`stats:${chain}`, JSON.stringify(stats), { EX: 30 });
        }
      }
      return NextResponse.json(stats, { headers });
    }

    await trackViolation(ip, 'Invalid action', 'warn');
    return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers });
  } catch (err) {
    logger.error('API Error:', { error: err.message, stack: err.stack, ip });
    await trackViolation(ip, err.message, 'severe');
    return NextResponse.json({ error: err.message }, { status: 500, headers });
  }
}