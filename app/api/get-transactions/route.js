// app/api/get-transactions/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { isAddress } from 'ethers';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error('REDIS_URL environment variable is required.');
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    await redisClient.connect();
    logger.info('Redis connected');
  }
  return redisClient;
}

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) throw new Error('IP temporarily banned.');
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 50;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:get_transactions:ip:${ip}`;
  const maxRequests = 200;
  const windowMs = 30 * 60 * 1000;
  const requests = parseInt(await redisClient.get(key)) || 0;
  if (requests >= maxRequests) throw new Error('Too many requests.');
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
}

let circuitOpen = false;
let failureCount = 0;
const maxFailures = 5;
const resetTimeout = 60000;

async function fetchWithRateLimit(url, config) {
  if (circuitOpen) throw new Error('Service temporarily unavailable.');
  try {
    const response = await limiterBottleneck.schedule(() => axios.get(url, { ...config, timeout: 30000 }));
    failureCount = 0;
    return response;
  } catch (error) {
    failureCount++;
    if (failureCount >= maxFailures) {
      circuitOpen = true;
      setTimeout(() => {
        circuitOpen = false;
        failureCount = 0;
      }, resetTimeout);
    }
    throw error;
  }
}

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 10 : 5,
  minTime: process.env.NODE_ENV === 'production' ? 600 : 1000,
  reservoir: 30,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000,
});

axiosRetry(axios, {
  retries: 8,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 1000 + Math.random() * 200,
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => v && a.indexOf(v) === i);

async function isAllowedOrigin(origin, referer) {
  if (origin && allowedOrigins.includes(origin)) return true;
  if (!origin && referer) {
    const refOrigin = new URL(referer).origin;
    if (allowedOrigins.includes(refOrigin)) return true;
  }
  if (!origin && !referer) return true;
  if (!origin && process.env.NODE_ENV === 'development') return true;
  return false;
}

const SUPPORTED_CHAINS = {
  '1': { name: 'ethereum', explorer: 'Etherscan', apiUrl: 'https://api.etherscan.io/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'ethereum' },
  '56': { name: 'bsc', explorer: 'BscScan', apiUrl: 'https://api.bscscan.com/api', apiKey: process.env.BSCSCAN_API_KEY, coingeckoId: 'binance-smart-chain' },
  'solana': { name: 'solana', explorer: 'Solscan', apiUrl: 'https://public-api.solscan.io', apiKey: process.env.SOLSCAN_API_KEY, coingeckoId: 'solana' },
  'tron': { name: 'tron', explorer: 'TronScan', apiUrl: 'https://api.tronscan.org/api', apiKey: process.env.TRONSCAN_API_KEY, coingeckoId: 'tron' },
};

const bodySchema = z.object({
  wallet_address: z.string().nonempty('Wallet address is required'),
  chain: z.enum(Object.keys(SUPPORTED_CHAINS), { message: 'Invalid chain' }),
  limit: z.number().int().min(100).max(500, 'Limit must be between 100 and 500'),
  page: z.number().int().min(1).default(1),
});

async function getChainLogo(coingeckoId) {
  const cacheKey = `chain_logo_${coingeckoId}`;
  const redisClient = await getRedisClient();
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
      timeout: 15000,
    });
    const chain = response.data.find((c) => c.id === coingeckoId);
    const logo = chain?.image?.thumb || '/icons/default.webp';
    await redisClient.setEx(cacheKey, 24 * 60 * 60, logo);
    return logo;
  } catch {
    return '/icons/default.webp';
  }
}

// app/api/get-transactions/route.js (only showing updated getNametagsBatch function)
async function getNametagsBatch(addresses) {
  const uniqueAddresses = [...new Set(addresses.map((addr) => addr.toLowerCase()).filter(isAddress))];
  const nametags = {};
  if (uniqueAddresses.length === 0) return nametags;

  const redisClient = await getRedisClient();

  try {
    const result = await query(
      `SELECT address, nametag, image, description, subcategory FROM nametags WHERE address = ANY($1)`,
      [uniqueAddresses]
    );

    for (const row of result.rows) {
      const address = row.address.toLowerCase();
      let image = row.image;
      let isValidImage = image && image !== '/icons/uniswap.webp';

      // Check if the image is valid by attempting to fetch it
      if (isValidImage) {
        try {
          const imageUrl = image.startsWith('http') ? image : `${process.env.NEXT_PUBLIC_APP_URL}${image}`;
          await axios.head(imageUrl, { timeout: 5000 });
        } catch {
          logger.warn(`Invalid image for address ${address}: ${image}`); // Updated
          isValidImage = false;
        } 
      }

      // If image is invalid or default, try fetching from CoinGecko
      if (!isValidImage) {
        const cacheKey = `nametag_image_${address}`;
        const cachedImage = await redisClient.get(cacheKey);
        if (cachedImage) {
          image = cachedImage;
        } else {
          const shortName = row.nametag
            .split(' ')[0]
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
          try {
            const response = await fetchWithRateLimit(
              `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(shortName)}`,
              {
                headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
                timeout: 15000,
              }
            );
            const coin = response.data.coins?.[0];
            image = coin?.thumb || '/icons/default.webp';
            await redisClient.setEx(cacheKey, 24 * 60 * 60, image);
          } catch (error) {
            logger.error(`Failed to fetch CoinGecko image for ${shortName}:`, error.message); // Updated
            image = '/icons/default.webp';
            await redisClient.setEx(cacheKey, 24 * 60 * 60, image);
          }
        }
      }

      nametags[address] = {
        address,
        name: row.nametag || 'Unknown',
        image,
        description: row.description || '',
        subcategory: row.subcategory || 'Others',
      };
    }

    // Set default values for addresses not found in the database
    for (const addr of uniqueAddresses) {
      if (!nametags[addr]) {
        const cacheKey = `nametag_image_${addr}`;
        let image = await redisClient.get(cacheKey) || '/icons/default.webp';
        nametags[addr] = { address: addr, name: 'Unknown', image, description: '', subcategory: 'Others' };
      }
    }

    return nametags;
  } catch (error) {
    logger.error('Error fetching nametags:', error);
    uniqueAddresses.forEach((addr) => {
      nametags[addr] = { address: addr, name: 'Unknown', image: '/icons/default.webp', description: '', subcategory: 'Others' };
    });
    return nametags;
  }
}

async function fetchBlockchainData(walletAddress, limit, chainId, page) {
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  if (!chain.apiKey) throw new Error(`API key missing for ${chain.explorer}`);

  const offset = (page - 1) * limit;
  let transactions = [];

  if (chainId === 'solana') {
    const response = await fetchWithRateLimit(`${chain.apiUrl}/account/transactions?account=${walletAddress}&limit=${limit}&offset=${offset}`, {
      headers: { 'Authorization': `Bearer ${chain.apiKey}` },
    });
    const data = response.data;
    if (!response.status.toString().startsWith('2')) throw new Error(data.message || 'Error fetching Solana transactions');
    transactions = data.map((tx) => ({
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
    const response = await fetchWithRateLimit(`${chain.apiUrl}/transaction?address=${walletAddress}&limit=${limit}&offset=${offset}`, {
      headers: { 'TRON-PRO-API-KEY': chain.apiKey },
    });
    const data = response.data;
    if (!data.success) throw new Error(data.error || 'Error fetching TRON transactions');
    transactions = data.data.map((tx) => ({
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
    const nativeResponse = await fetchWithRateLimit(
      `${chain.apiUrl}?module=account&action=txlist&address=${walletAddress}&sort=desc&apikey=${chain.apiKey}&page=${page}&offset=${limit}`
    );
    const nativeData = nativeResponse.data;
    if (nativeData.status !== '1') throw new Error(nativeData.message || 'Error fetching EVM transactions');
    const nativeTxs = nativeData.result.map((tx) => ({
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

    const tokenResponse = await fetchWithRateLimit(
      `${chain.apiUrl}?module=account&action=tokentx&address=${walletAddress}&sort=desc&apikey=${chain.apiKey}&page=${page}&offset=${limit}`
    );
    const tokenData = tokenResponse.data;
    if (tokenData.status !== '1') throw new Error(tokenData.message || 'Error fetching EVM token transactions');
    const tokenTxs = tokenData.result.map((tx) => ({
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
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (!(await isAllowedOrigin(origin, referer, new URL(request.url).pathname))) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ error: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders });
  }

  const headers = {
    ...securityHeaders,
    ...(origin && allowedOrigins.includes(origin) && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    return NextResponse.json({ error: err.message }, { status: 429, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    await trackViolation(ip, 'Invalid JSON body');
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    await trackViolation(ip, 'Validation error');
    return NextResponse.json({ error: 'Invalid input data', errors: err.errors }, { status: 400, headers });
  }

  const { wallet_address, chain, limit, page } = parsedBody;
  const isValidAddress = ['solana', 'tron'].includes(chain)
    ? /^[A-Za-z0-9]{32,44}$/.test(wallet_address)
    : isAddress(wallet_address);
  if (!isValidAddress) {
    await trackViolation(ip, 'Invalid wallet address');
    return NextResponse.json({ error: 'Invalid wallet address.' }, { status: 400, headers });
  }

  const lowerWalletAddress = wallet_address.toLowerCase();
  const validLimits = [100, 200, 300, 500];
  const selectedLimit = validLimits.includes(Number(limit)) ? Number(limit) : 100;

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const txData = await fetchBlockchainData(lowerWalletAddress, selectedLimit, chain, page);
          const uniqueTxData = Array.from(new Map(txData.map((tx) => [tx.hash, tx])).values());
          const incomingTxs = uniqueTxData
            .filter((tx) => tx.to.toLowerCase() === lowerWalletAddress)
            .slice(0, Math.ceil(selectedLimit / 2));
          const outgoingTxs = uniqueTxData
            .filter((tx) => tx.from.toLowerCase() === lowerWalletAddress)
            .slice(0, Math.ceil(selectedLimit / 2));

          const chainLogo = await getChainLogo(SUPPORTED_CHAINS[chain].coingeckoId);
          const allAddresses = [
            lowerWalletAddress,
            ...incomingTxs.map((tx) => tx.from.toLowerCase()),
            ...outgoingTxs.map((tx) => tx.to.toLowerCase()),
          ];
          const nametags = await getNametagsBatch(allAddresses);

          const incomingTxsWithNametags = incomingTxs.map((tx) => ({
            hash: tx.hash,
            address: tx.from.toLowerCase(),
            nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
            image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.webp',
            value: tx.value,
            block_time: tx.block_time,
            type: 'incoming',
            chainLogo,
            tokenName: tx.tokenName,
            tokenSymbol: tx.tokenSymbol,
            tokenDecimal: tx.tokenDecimal,
            contractAddress: tx.contractAddress,
          }));

          const outgoingTxsWithNametags = outgoingTxs.map((tx) => ({
            hash: tx.hash,
            address: tx.to.toLowerCase(),
            nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
            image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.webp',
            value: tx.value,
            block_time: tx.block_time,
            type: 'outgoing',
            chainLogo,
            tokenName: tx.tokenName,
            tokenSymbol: tx.tokenSymbol,
            tokenDecimal: tx.tokenDecimal,
            contractAddress: tx.contractAddress,
          }));

          const walletInfo = {
            address: lowerWalletAddress,
            nametag: nametags[lowerWalletAddress]?.name || 'Unknown',
            image: nametags[lowerWalletAddress]?.image || '/icons/default.webp',
            chainLogo,
          };

          controller.enqueue(
            JSON.stringify({
              incoming: incomingTxsWithNametags,
              outgoing: outgoingTxsWithNametags,
              wallet: walletInfo,
            })
          );
          controller.close();
        } catch (err) {
          await trackViolation(ip, `Error fetching transactions: ${err.message}`);
          controller.enqueue(JSON.stringify({ error: `Failed to fetch transactions: ${err.message}` }));
          controller.close();
        }
      },
    }),
    { headers }
  );
}