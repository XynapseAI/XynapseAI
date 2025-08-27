// app\api\get-transactions\route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { isAddress } from 'ethers';
import crypto from 'crypto';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { auth } from '@/lib/auth';

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message, stack: err.stack }));
    await redisClient.connect();
    logger.info('Redis connected', { timestamp: new Date().toISOString() });
  }
  return redisClient;
}

// ================= Security Headers =================
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// ================= IP Ban Logic =================
async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    logger.error(`IP ban detected: ${ip}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 100;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid JSON body', 'Validation error', 'Invalid wallet address'].includes(reason)) {
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

// ================= Rate Limiting =================
async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:get_transactions:${ip}`;
  const maxRequests = 200;
  const windowMs = 30 * 60 * 1000;
  const requests = parseInt(await redisClient.get(key)) || 0;
  if (requests >= maxRequests) {
    logger.warn(`Rate limit exceeded for IP ${ip}: ${requests} requests`);
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.info(`Rate limit check passed for IP ${ip}: ${requests + 1}/${maxRequests} requests`);
}

// Bottleneck configuration
const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 10 : 5,
  minTime: process.env.NODE_ENV === 'production' ? 600 : 1000,
  reservoir: 30,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000,
});

// Axios retry configuration
axiosRetry(axios, {
  retries: 8,
  retryDelay: (retryCount) => {
    logger.info(`Retry attempt ${retryCount} for blockchain API`);
    return Math.pow(2, retryCount) * 1000 + Math.random() * 200;
  },
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await axios.get(url, {
      ...config,
      timeout: 30000,
    });
    return response;
  } catch (error) {
    logger.error(`Axios error: ${error.message}`, { url, status: error.response?.status });
    throw error;
  }
});

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  ...(process.env.VERCEL_ENV === 'production' ? [] : ['https://*.vercel.app']),
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/.*\.vercel\.app$/;

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info('No Origin or Referer (likely SSR or server-to-server), allowing request');
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info('No valid Origin or Referer, allowing for SSR compatibility');
    return true;
  }
  if (
    allowedOrigins.some((allowed) =>
      allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(checkOrigin) : allowed === checkOrigin
    )
  ) {
    logger.info(`Origin allowed: ${checkOrigin}`);
    return true;
  }
  if (vercelPreviewRegex.test(checkOrigin)) {
    logger.info(`Origin allowed by Vercel preview regex: ${checkOrigin}`);
    return true;
  }
  logger.error(`CORS error: Origin ${checkOrigin || 'null'} not allowed`);
  return false;
}

const SUPPORTED_CHAINS = {
  '1': { name: 'ethereum', explorer: 'Etherscan', apiUrl: 'https://api.etherscan.io/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'ethereum' },
  '56': { name: 'bsc', explorer: 'BscScan', apiUrl: 'https://api.bscscan.com/api', apiKey: process.env.BSCSCAN_API_KEY, coingeckoId: 'binance-smart-chain' },
  '204': { name: 'opbnb', explorer: 'opBNB BscScan', apiUrl: 'https://api-opbnb.bscscan.com/api', apiKey: process.env.BSCSCAN_API_KEY, coingeckoId: 'opbnb' },
  '250': { name: 'fantom', explorer: 'FTMScan', apiUrl: 'https://api.ftmscan.com/api', apiKey: process.env.FTMSCAN_API_KEY, coingeckoId: 'fantom' },
  '10': { name: 'optimism', explorer: 'Optimistic Etherscan', apiUrl: 'https://api-optimistic.etherscan.io/api', apiKey: process.env.OPTIMISM_API_KEY, coingeckoId: 'optimistic-ethereum' },
  '137': { name: 'polygon', explorer: 'PolygonScan', apiUrl: 'https://api.polygonscan.com/api', apiKey: process.env.POLYGONSCAN_API_KEY, coingeckoId: 'polygon-pos' },
  '42161': { name: 'arbitrum', explorer: 'Arbiscan', apiUrl: 'https://api.arbiscan.io/api', apiKey: process.env.ARBISCAN_API_KEY, coingeckoId: 'arbitrum-one' },
  '100': { name: 'gnosis', explorer: 'GnosisScan', apiUrl: 'https://api.gnosisscan.io/api', apiKey: process.env.GNOSISSCAN_API_KEY, coingeckoId: 'xdai' },
  '8453': { name: 'base', explorer: 'BaseScan', apiUrl: 'https://api.basescan.org/api', apiKey: process.env.BASESCAN_API_KEY, coingeckoId: 'base' },
  '59144': { name: 'linea', explorer: 'LineaScan', apiUrl: 'https://api.lineascan.build/api', apiKey: process.env.LINEASCAN_API_KEY, coingeckoId: 'linea' },
  '534352': { name: 'scroll', explorer: 'ScrollScan', apiUrl: 'https://api.scrollscan.com/api', apiKey: process.env.SCROLLSCAN_API_KEY, coingeckoId: 'scroll' },
  '81457': { name: 'blast', explorer: 'BlastScan', apiUrl: 'https://api.blastscan.io/api', apiKey: process.env.BLASTSCAN_API_KEY, coingeckoId: 'blast' },
  'solana': { name: 'solana', explorer: 'Solscan', apiUrl: 'https://public-api.solscan.io', apiKey: process.env.SOLSCAN_API_KEY, coingeckoId: 'solana' },
  'tron': { name: 'tron', explorer: 'TronScan', apiUrl: 'https://api.tronscan.org/api', apiKey: process.env.TRONSCAN_API_KEY, coingeckoId: 'tron' },
};

const bodySchema = z.object({
  wallet_address: z.string().nonempty('Wallet address is required'),
  chain: z.enum(Object.keys(SUPPORTED_CHAINS), { message: 'Invalid chain' }),
  limit: z.number().int().min(100).max(500, 'Limit must be between 100 and 500'),
});

const chainLogoCache = {};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function checkIp(ip) {
  try {
    const response = await fetchWithRateLimit(`https://ipinfo.io/${ip}/json?token=${process.env.IPINFO_TOKEN}`);
    const { abuse } = response.data;
    if (abuse && abuse.score > 50) {
      logger.warn(`Suspicious IP detected: ${ip}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`IP check failed: ${error.message}`);
    return true;
  }
}

async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      logger.warn(`Attempt ${attempt} failed: ${e.message}. Retrying after ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

async function verifyHmacSignature(payload, signature, secret) {
  try {
    const hmac = crypto.createHmac('sha256', secret);
    const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
    hmac.update(payloadString);
    const expectedSignature = hmac.digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
  } catch (error) {
    logger.error(`HMAC verification error: ${error.message}`, { stack: error.stack });
    return false;
  }
}

async function verifyApiKey(apiKey, session) {
  try {
    if (apiKey === 'default-api-key') return { isValid: true, isPremium: false };
    const result = await withRetry(() =>
      query(`SELECT is_premium, premium_expires_at, id FROM users WHERE api_key = $1`, [apiKey])
    );
    if (result.rows.length === 0) {
      logger.warn(`Invalid API key: ${apiKey}`);
      return { isValid: false, isPremium: false };
    }
    const { is_premium, premium_expires_at, id } = result.rows[0];
    if (session && session.user.id !== id) {
      logger.warn(`API key ${apiKey} does not belong to user ${session.user.id}`);
      return { isValid: false, isPremium: false };
    }
    if (premium_expires_at && new Date(premium_expires_at) < new Date()) {
      logger.warn(`Premium expired for API key: ${apiKey}`);
      return { isValid: true, isPremium: false };
    }
    return { isValid: true, isPremium: is_premium || false };
  } catch (error) {
    logger.error(`Error verifying API key: ${error.message}`, { stack: error.stack });
    return { isValid: false, isPremium: false };
  }
}

async function getChainLogo(coingeckoId) {
  if (chainLogoCache[coingeckoId]) {
    logger.info(`Cache hit for chain logo: ${coingeckoId}, logo: ${chainLogoCache[coingeckoId]}`);
    return chainLogoCache[coingeckoId];
  }
  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
      timeout: 15000,
    });
    const chain = response.data.find(c => c.id === coingeckoId);
    const logo = chain?.image?.thumb || '/icons/default.png';
    chainLogoCache[coingeckoId] = logo;
    logger.info(`Fetched logo for ${coingeckoId}: ${logo}`);
    return logo;
  } catch (error) {
    logger.error(`Error fetching logo for ${coingeckoId}: ${error.message}`);
    chainLogoCache[coingeckoId] = '/icons/default.png';
    return '/icons/default.png';
  }
}

async function getNametagsBatch(addresses) {
  const uniqueAddresses = [...new Set(addresses.map(addr => addr.toLowerCase()).filter(isAddress))];
  logger.info(`Fetching nametags for ${uniqueAddresses.length} addresses`, { addresses: uniqueAddresses.slice(0, 5) });
  const nametags = {};
  if (uniqueAddresses.length === 0) {
    logger.info('No valid addresses provided for nametag fetch.');
    return nametags;
  }
  try {
    const batchSize = 100;
    for (let i = 0; i < uniqueAddresses.length; i += batchSize) {
      const batchAddresses = uniqueAddresses.slice(i, i + batchSize);
      logger.info(`Querying nametags for batch: ${batchAddresses.length} addresses`);
      const result = await withRetry(() =>
        query(`SELECT address, nametag, image FROM nametags WHERE address = ANY($1)`, [batchAddresses])
      );
      logger.info(`Received ${result.rows.length} nametags for batch`);
      result.rows.forEach(row => {
        const nametag = row.nametag || 'Unknown';
        let image = row.image || '/icons/default.png';
        if (nametag !== 'Unknown' && !image) {
          const shortName = nametag.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
          image = `/icons/${shortName}.png`;
        }
        nametags[row.address.toLowerCase()] = {
          address: row.address.toLowerCase(),
          name: nametag,
          image,
          description: '',
          subcategory: 'Others',
        };
      });
    }
    uniqueAddresses.forEach(addr => {
      if (!nametags[addr]) {
        nametags[addr] = {
          address: addr,
          name: 'Unknown',
          image: '/icons/default.png',
          description: '',
          subcategory: 'Others',
        };
      }
    });
    logger.info(`Fetched ${Object.keys(nametags).length} nametags, Unknown: ${Object.values(nametags).filter(tag => tag.name === 'Unknown').length}`);
    return nametags;
  } catch (error) {
    logger.error(`Error fetching nametags: ${error.message}`, { stack: error.stack, addresses: uniqueAddresses.slice(0, 5) });
    uniqueAddresses.forEach(addr => {
      nametags[addr] = {
        address: addr,
        name: 'Unknown',
        image: '/icons/default.png',
        description: '',
        subcategory: 'Others',
      };
    });
    return nametags;
  }
}

async function fetchBlockchainData(walletAddress, dataType, isTestnet, limit, chainId) {
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  if (!chain.apiKey) throw new Error(`API key missing for ${chain.explorer}`);
  try {
    let transactions = [];
    if (chainId === 'solana') {
      const response = await fetchWithRateLimit(`${chain.apiUrl}/account/transactions?account=${walletAddress}&limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${chain.apiKey}` },
      });
      const data = response.data;
      if (!response.status.toString().startsWith('2')) throw new Error(data.message || 'Error fetching Solana transactions');
      transactions = data.map(tx => ({
        hash: tx.txHash,
        from: tx.signer,
        to: tx.actions[0]?.destination || '',
        value: tx.actions[0]?.amount ? Number((tx.actions[0].amount / 1e9).toFixed(6)) : 0,
        block_time: new Date(tx.blockTime * 1000).toISOString(),
        tokenName: 'Solana',
        tokenSymbol: 'SOL',
        tokenDecimal: '9',
        contractAddress: null,
      }));
    } else if (chainId === 'tron') {
      const response = await fetchWithRateLimit(`${chain.apiUrl}/transaction?address=${walletAddress}&limit=${limit}`, {
        headers: { 'TRON-PRO-API-KEY': chain.apiKey },
      });
      const data = response.data;
      if (!data.success) throw new Error(data.error || 'Error fetching TRON transactions');
      transactions = data.data.map(tx => ({
        hash: tx.hash,
        from: tx.ownerAddress,
        to: tx.toAddress,
        value: tx.amount ? Number((tx.amount / 1e6).toFixed(6)) : 0,
        block_time: new Date(tx.timestamp).toISOString(),
        tokenName: 'TRON',
        tokenSymbol: 'TRX',
        tokenDecimal: '6',
        contractAddress: null,
      }));
    } else {
      // Fetch native transactions (txlist)
      const nativeResponse = await fetchWithRateLimit(
        `${chain.apiUrl}?module=account&action=txlist&address=${walletAddress}&sort=desc&apikey=${chain.apiKey}&page=1&offset=${limit}`
      );
      const nativeData = nativeResponse.data;
      if (nativeData.status !== '1') throw new Error(nativeData.message || 'Error fetching EVM transactions');
      const nativeTxs = nativeData.result.map(tx => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: Number((parseInt(tx.value) / 1e18).toFixed(6)),
        block_time: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
        tokenName: chain.name.charAt(0).toUpperCase() + chain.name.slice(1),
        tokenSymbol: chainId === '1' ? 'ETH' : chain.name.toUpperCase(),
        tokenDecimal: '18',
        contractAddress: null,
      }));

      // Fetch token transactions (tokentx)
      const tokenResponse = await fetchWithRateLimit(
        `${chain.apiUrl}?module=account&action=tokentx&address=${walletAddress}&sort=desc&apikey=${chain.apiKey}&page=1&offset=${limit}`
      );
      const tokenData = tokenResponse.data;
      if (tokenData.status !== '1') throw new Error(tokenData.message || 'Error fetching EVM token transactions');
      const tokenTxs = tokenData.result.map(tx => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: Number((parseInt(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal))).toFixed(6)),
        block_time: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
        tokenName: tx.tokenName,
        tokenSymbol: tx.tokenSymbol,
        tokenDecimal: tx.tokenDecimal,
        contractAddress: tx.contractAddress,
      }));

      transactions = [...nativeTxs, ...tokenTxs];
    }
    return transactions;
  } catch (error) {
    logger.error(`Error fetching data from ${chain.explorer}: ${error.message}`);
    throw error;
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  logger.info(`Request to /api/get-transactions from IP ${ip}`, { origin, timestamp: new Date().toISOString() });

  // Check CORS
  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ error: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders });
  }

  // Check IP ban
  try {
    await checkIPBan(ip);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 403, headers: securityHeaders });
  }

  // Check rate limit
  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ error: err.message }, { status: 429, headers: securityHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    await trackViolation(ip, 'Invalid JSON body');
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: securityHeaders });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    await trackViolation(ip, 'Validation error');
    return NextResponse.json({ error: 'Invalid input data', errors: err.errors }, { status: 400, headers: securityHeaders });
  }

  const { wallet_address, chain, limit } = parsedBody;
  const isValidAddress = ['solana', 'tron'].includes(chain)
    ? /^[A-Za-z0-9]{32,44}$/.test(wallet_address)
    : isAddress(wallet_address);
  if (!isValidAddress) {
    logger.error(`Invalid wallet address: ${wallet_address} for chain ${chain}`, { ip });
    await trackViolation(ip, 'Invalid wallet address');
    return NextResponse.json({ error: 'Wallet address is required and must be valid for the selected chain.' }, { status: 400, headers: securityHeaders });
  }

  const lowerWalletAddress = wallet_address.toLowerCase();
  const apiKey = request.headers.get('x-api-key') || process.env.INTERNAL_API_TOKEN || 'default-api-key';
  const signature = request.headers.get('x-hmac-signature');

  const session = await auth();
  const { isValid, isPremium } = await verifyApiKey(apiKey, session);
  if (!isValid) {
    logger.error(`Invalid API key: ${apiKey}`, { ip });
    await trackViolation(ip, 'Invalid API key');
    return NextResponse.json({ error: 'Unauthorized: Invalid API key.' }, { status: 401, headers: securityHeaders });
  }

  if (!signature || !(await verifyHmacSignature(body, signature, process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex')))) {
    logger.warn(`Unauthorized: Invalid HMAC signature for wallet ${lowerWalletAddress}`, { ip });
    await trackViolation(ip, 'Invalid HMAC signature');
    return NextResponse.json({ error: 'Unauthorized: Invalid HMAC signature.' }, { status: 401, headers: securityHeaders });
  }

  if (!isPremium && chain !== '1') {
    logger.warn(`Non-Premium user attempted to access chain ${chain}`, { ip });
    await trackViolation(ip, 'Non-Premium chain access');
    return NextResponse.json({ error: 'Premium account required to access chains other than Ethereum.' }, { status: 403, headers: securityHeaders });
  }

  const validLimits = [100, 200, 300, 500];
  const selectedLimit = validLimits.includes(Number(limit)) ? Number(limit) : 100;
  if (!isPremium && selectedLimit > 100) {
    logger.warn(`Non-Premium user attempted to use limit ${selectedLimit}`, { ip });
    await trackViolation(ip, 'Non-Premium limit exceed');
    return NextResponse.json({ error: 'Premium account required to fetch more than 100 transactions.' }, { status: 403, headers: securityHeaders });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          logger.info(`Fetching transactions for ${lowerWalletAddress} on ${chain} with limit ${selectedLimit}...`, { ip });
          const txData = await fetchBlockchainData(lowerWalletAddress, 'transactions', false, selectedLimit, chain);

          const uniqueTxData = Array.from(new Map(txData.map((tx) => [tx.hash, tx])).values());
          const incomingTxs = uniqueTxData
            .filter((tx) => tx.to.toLowerCase() === lowerWalletAddress)
            .slice(0, Math.ceil(selectedLimit / 2));
          const outgoingTxs = uniqueTxData
            .filter((tx) => tx.from.toLowerCase() === lowerWalletAddress)
            .slice(0, Math.ceil(selectedLimit / 2));

          const chainLogo = await getChainLogo(SUPPORTED_CHAINS[chain].coingeckoId);

          let incomingTxsWithNametags = [];
          let outgoingTxsWithNametags = [];
          let walletInfo = {
            address: lowerWalletAddress,
            nametag: ['solana', 'tron'].includes(chain) ? lowerWalletAddress.slice(0, 6) + '...' + lowerWalletAddress.slice(-4) : 'Unknown',
            image: '/icons/default.png',
            chainLogo,
            isPremium,
          };

          if (!['solana', 'tron'].includes(chain)) {
            logger.info(`Fetching nametags for ${lowerWalletAddress} and related addresses...`, { ip });
            const allAddresses = [
              lowerWalletAddress,
              ...incomingTxs.map((tx) => tx.from.toLowerCase()),
              ...outgoingTxs.map((tx) => tx.to.toLowerCase()),
            ];
            const nametags = await getNametagsBatch(allAddresses);

            incomingTxsWithNametags = incomingTxs.map((tx) => ({
              hash: tx.hash,
              from: tx.from.toLowerCase(),
              to: tx.to.toLowerCase(),
              value: tx.value,
              block_time: tx.block_time,
              type: 'incoming',
              chainLogo,
              from_nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
              from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
              to_nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
              to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
              tokenName: tx.tokenName,
              tokenSymbol: tx.tokenSymbol,
              tokenDecimal: tx.tokenDecimal,
              contractAddress: tx.contractAddress,
            }));

            outgoingTxsWithNametags = outgoingTxs.map((tx) => ({
              hash: tx.hash,
              from: tx.from.toLowerCase(),
              to: tx.to.toLowerCase(),
              value: tx.value,
              block_time: tx.block_time,
              type: 'outgoing',
              chainLogo,
              from_nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
              from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
              to_nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
              to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
              tokenName: tx.tokenName,
              tokenSymbol: tx.tokenSymbol,
              tokenDecimal: tx.tokenDecimal,
              contractAddress: tx.contractAddress,
            }));

            walletInfo = {
              address: lowerWalletAddress,
              nametag: nametags[lowerWalletAddress]?.name || 'Unknown',
              image: nametags[lowerWalletAddress]?.image || '/icons/default.png',
              chainLogo,
              isPremium,
            };
          } else {
            incomingTxsWithNametags = incomingTxs.map((tx) => ({
              hash: tx.hash,
              from: tx.from.toLowerCase(),
              to: tx.to.toLowerCase(),
              value: tx.value,
              block_time: tx.block_time,
              type: 'incoming',
              chainLogo,
              from_nametag: tx.from.slice(0, 6) + '...' + tx.from.slice(-4),
              from_image: '/icons/default.png',
              to_nametag: tx.to.slice(0, 6) + '...' + tx.to.slice(-4),
              to_image: '/icons/default.png',
              tokenName: tx.tokenName,
              tokenSymbol: tx.tokenSymbol,
              tokenDecimal: tx.tokenDecimal,
              contractAddress: tx.contractAddress,
            }));

            outgoingTxsWithNametags = outgoingTxs.map((tx) => ({
              hash: tx.hash,
              from: tx.from.toLowerCase(),
              to: tx.to.toLowerCase(),
              value: tx.value,
              block_time: tx.block_time,
              type: 'outgoing',
              chainLogo,
              from_nametag: tx.from.slice(0, 6) + '...' + tx.from.slice(-4),
              from_image: '/icons/default.png',
              to_nametag: tx.to.slice(0, 6) + '...' + tx.to.slice(-4),
              to_image: '/icons/default.png',
              tokenName: tx.tokenName,
              tokenSymbol: tx.tokenSymbol,
              tokenDecimal: tx.tokenDecimal,
              contractAddress: tx.contractAddress,
            }));
          }

          logger.info(`Fetched ${incomingTxsWithNametags.length} incoming and ${outgoingTxsWithNametags.length} outgoing transactions for ${lowerWalletAddress}`, { ip });
          controller.enqueue(JSON.stringify({
            incoming: incomingTxsWithNametags,
            outgoing: outgoingTxsWithNametags,
            wallet: walletInfo,
          }));
          controller.close();
        } catch (err) {
          logger.error(`Error fetching transactions for ${lowerWalletAddress}: ${err.message}`, { stack: err.stack, ip });
          controller.enqueue(JSON.stringify({ error: `Failed to fetch transactions: ${err.message}` }));
          controller.close();
        }
      },
    }),
    { headers: securityHeaders }
  );
}