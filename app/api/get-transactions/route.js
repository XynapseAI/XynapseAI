// app/api/get-transactions/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { isAddress } from 'ethers';
import { ethers } from 'ethers';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { BLOCKED_TOKEN_ADDRESSES } from '../../../utils/constants';

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

async function banIP(ip, durationSeconds = 3600) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) throw new Error('IP temporarily banned.');
}

async function trackViolation(ip) {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 50;
  const windowMs = 30 * 60 * 1000;
  const pipeline = redisClient.multi();
  pipeline.incr(key);
  pipeline.expire(key, windowMs / 1000);
  const [violations] = await pipeline.exec();
  if (violations >= maxViolations) {
    await banIP(ip, 3600);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:get_transactions:ip:${ip}`;
  const maxRequests = 300;
  const windowMs = 30 * 60 * 1000;
  const pipeline = redisClient.multi();
  pipeline.incr(key);
  pipeline.expire(key, windowMs / 1000);
  const [requests] = await pipeline.exec();
  if (requests > maxRequests) throw new Error('Too many requests.');
}

let circuitOpen = false;
let failureCount = 0;
const maxFailures = 15;
const resetTimeout = 120000;

async function fetchWithRateLimit(url, config) {
  if (circuitOpen) throw new Error('Service temporarily unavailable.');
  try {
    const response = await limiterBottleneck.schedule(() => axios.get(url, { ...config, timeout: 20000 }));
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
  maxConcurrent: process.env.NODE_ENV === 'production' ? 10 : 3,
  minTime: process.env.NODE_ENV === 'production' ? 500 : 1000,
  reservoir: 50,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000,
});

axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 500 + Math.random() * 100,
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED' || error.response?.status === 400,
});

async function isAllowedOrigin(origin, referer, ip) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    return configured.includes(origin) || configured.includes(referer ? new URL(referer).origin : null);
  }

  try {
    if (!origin && !referer) {
      await trackViolation(ip, 'Missing origin and referer in production');
      return false;
    }

    if (origin && origin !== 'null') {
      if (!origin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS origin in production');
        return false;
      }
      if (configured.includes(origin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid origin');
      return false;
    }

    if (referer) {
      const refOrigin = new URL(referer).origin;
      if (!refOrigin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS referer in production');
        return false;
      }
      if (configured.includes(refOrigin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid referer');
      return false;
    }

    await trackViolation(ip, 'Invalid origin or referer');
    return false;
  } catch {
    await trackViolation(ip, 'Error validating origin');
    return false;
  }
}

const SUPPORTED_CHAINS = {
  '1': { name: 'ethereum', explorer: 'Etherscan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'ethereum' },
  '56': { name: 'bsc', explorer: 'BscScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'binance-smart-chain' },
  '10': { name: 'optimism', explorer: 'Optimistic Etherscan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'optimism' },
  '130': { name: 'unichain', explorer: 'Unichain Explorer', apiUrl: '', apiKey: '', coingeckoId: '' },
  '137': { name: 'polygon', explorer: 'Polygonscan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'polygon-pos' },
  '5000': { name: 'mantle', explorer: 'Mantle Explorer', apiUrl: 'https://explorer.mantle.xyz/api', apiKey: '', coingeckoId: 'mantle' },
  '42161': { name: 'arbitrum', explorer: 'Arbiscan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'arbitrum-one' },
  '43114': { name: 'avalanche', explorer: 'SnowTrace', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'avalanche' },
  '59144': { name: 'linea', explorer: 'Linea Explorer', apiUrl: '', apiKey: '', coingeckoId: 'linea' },
  '534352': { name: 'scroll', explorer: 'Scroll Explorer', apiUrl: '', apiKey: '', coingeckoId: 'scroll' },
  '7777777': { name: 'zora', explorer: 'Zora Explorer', apiUrl: '', apiKey: '', coingeckoId: 'zora' },
  'solana': { name: 'solana', explorer: 'Solscan', apiUrl: 'https://public-api.solscan.io', apiKey: process.env.SOLSCAN_API_KEY, coingeckoId: 'solana' },
  'tron': { name: 'tron', explorer: 'TronScan', apiUrl: 'https://api.tronscan.org/api', apiKey: process.env.TRONSCAN_API_KEY, coingeckoId: 'tron' },
};

const chainIdToName = Object.fromEntries(
  Object.entries(SUPPORTED_CHAINS).map(([id, { name }]) => [id, name])
);

const bodySchema = z.object({
  wallet_address: z.string().nonempty('Wallet address is required'),
  chain: z.enum(Object.keys(SUPPORTED_CHAINS), { message: 'Invalid chain' }),
  limit: z.number().int().min(50).max(200, 'Limit must be between 50 and 200'),
  page: z.number().int().min(1).default(1),
  fetchLayer3: z.boolean().optional().default(false),
});

function isValidTokenSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;

  const cleanedSymbol = symbol.trim().toLowerCase();

  if (cleanedSymbol.length < 2 || cleanedSymbol.length > 20) {
    logger.warn(`Invalid token symbol length: ${symbol}`);
    return false;
  }

  const validSymbolPattern = /^[a-z0-9\-_]+$/;
  if (!validSymbolPattern.test(cleanedSymbol)) {
    logger.warn(`Invalid token symbol characters: ${symbol}`);
    return false;
  }

  const urlPattern = /(https?:\/\/|www\.|\.com|\.org|\.net|\.io)/i;
  if (urlPattern.test(cleanedSymbol)) {
    logger.warn(`Token symbol contains URL: ${symbol}`);
    return false;
  }

  const suspiciousKeywords = ['claim', 'free', 'airdrop', 'promo', 'reward', 'bonus'];
  if (suspiciousKeywords.some(keyword => cleanedSymbol.includes(keyword))) {
    logger.warn(`Token symbol contains suspicious keyword: ${symbol}`);
    return false;
  }

  return true;
}

async function getChainLogo(coingeckoId) {
  const cacheKey = `chain_logo_${coingeckoId}`;
  const redisClient = await getRedisClient();
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
      timeout: 10000,
    });
    const chain = response.data.find((c) => c.id === coingeckoId);
    const logo = chain?.image?.thumb || '/icons/default.webp';
    await redisClient.setEx(cacheKey, 7 * 24 * 60 * 60, logo);
    return logo;
  } catch {
    return '/icons/default.webp';
  }
}

async function getCurrentPrice(cgId) {
  const redisClient = await getRedisClient();
  const cacheKey = `price_${cgId}`;
  let cached = await redisClient.get(cacheKey);
  if (cached) return parseFloat(cached);

  try {
    const response = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
    );
    const price = response.data[cgId]?.usd;
    if (price) {
      await redisClient.setEx(cacheKey, 300, price.toString()); // 5 min
      return price;
    }
  } catch (e) {
    logger.error(`Error fetching price for ${cgId}:`, e);
  }
  return 0;
}

async function getTokenCurrentPrice(platform, contractAddress) {
  const redisClient = await getRedisClient();
  const cacheKey = `token_price_${platform}_${contractAddress.toLowerCase()}`;
  let cached = await redisClient.get(cacheKey);
  if (cached) return parseFloat(cached);

  try {
    const response = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractAddress}&vs_currencies=usd`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
    );
    const price = response.data[contractAddress.toLowerCase()]?.usd;
    if (price) {
      await redisClient.setEx(cacheKey, 300, price.toString());
      return price;
    }
  } catch (e) {
    logger.error(`Error fetching token price for ${contractAddress} on ${platform}:`, e);
  }
  return 0;
}

async function getNametagsBatch(addresses, chain) {
  const uniqueAddresses = [...new Set(addresses.map((addr) => addr.toLowerCase()).filter(isAddress))];
  const nametags = {};
  if (uniqueAddresses.length === 0) return nametags;

  const redisClient = await getRedisClient();
  const cacheKeys = uniqueAddresses.map((addr) => `ens_nametag_${addr}`);
  const cachedResults = await redisClient.mGet(cacheKeys);
  const cachedNametags = cachedResults.reduce((acc, cached, index) => {
    if (cached) {
      const parsed = JSON.parse(cached);
      acc[uniqueAddresses[index]] = {
        address: uniqueAddresses[index],
        name: parsed.name,
        image: parsed.image,
        description: parsed.description || '',
        subcategory: parsed.subcategory || 'Others',
      };
    }
    return acc;
  }, {});

  const addressesToQuery = uniqueAddresses.filter((addr) => !cachedNametags[addr]);
  if (addressesToQuery.length > 0) {
    const result = await query(
      `SELECT address, nametag, image, description, subcategory 
       FROM nametags 
       WHERE address = ANY($1) /*+ PARALLEL(4) */`, // Enable parallel query if supported
      [addressesToQuery]
    );

    for (const row of result.rows) {
      const address = row.address.toLowerCase();
      cachedNametags[address] = {
        address,
        name: row.nametag || 'Unknown',
        image: row.image || '/icons/default.webp',
        description: row.description || '',
        subcategory: row.subcategory || 'Others',
      };
    }
  }

  const addressesWithoutNametag = uniqueAddresses.filter(
    (addr) => !cachedNametags[addr] || cachedNametags[addr].name === 'Unknown'
  );

  if (addressesWithoutNametag.length > 0 && chainIdToName[chain] === 'ethereum') {
    const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
    const REGISTRY_ABI = ['function resolver(bytes32 node) view returns (address)'];
    const RESOLVER_ABI = ['function name(bytes32 node) view returns (string)'];
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL || 'https://ethereum.publicnode.com');

    try {
      await provider.getNetwork();
      logger.info(`Successfully connected to Ethereum RPC`);
    } catch (error) {
      logger.error(`Failed to connect to Ethereum RPC: ${error.message}`);
      throw error;
    }

    const ensStartTime = Date.now();
    const reverseNodes = addressesWithoutNametag.map((addr) => ethers.namehash(`${addr.toLowerCase().slice(2)}.addr.reverse`));

    const resolverCalls = reverseNodes.map((node) => ({
      contractAddress: ENS_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    }));

    const resolverResults = await Promise.allSettled(
      resolverCalls.map(async (call) => {
        const contract = new ethers.Contract(call.contractAddress, call.abi, provider);
        return await contract[call.functionName](...call.args);
      })
    );

    const ensPromises = [];
    resolverResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value !== ethers.ZeroAddress) {
        const address = addressesWithoutNametag[index];
        ensPromises.push({
          address,
          resolverAddr: result.value,
        });
      }
    });

    const ensResults = await Promise.allSettled(
      ensPromises.map(async ({ address, resolverAddr }) => {
        try {
          const resolver = new ethers.Contract(resolverAddr, RESOLVER_ABI, provider);
          const name = await resolver.name(ethers.namehash(`${address.toLowerCase().slice(2)}.addr.reverse`));
          let image = '/icons/default.webp';
          if (name && name !== '') {
            const shortName = name.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            try {
              const cgResponse = await fetchWithRateLimit(
                `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(shortName)}`,
                {
                  headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
                  timeout: 10000,
                }
              );
              const coin = cgResponse.data.coins?.[0];
              if (coin?.thumb) image = coin.thumb;
            } catch (cgError) {
              logger.error(`Failed to fetch CoinGecko image for ENS ${shortName}:`, cgError.message);
            }
            await redisClient.setEx(`ens_nametag_${address}`, 7 * 24 * 60 * 60, JSON.stringify({ name, image }));
            await query(
              `INSERT INTO nametags (address, nametag, image, description, subcategory) 
               VALUES ($1, $2, $3, $4, $5) 
               ON CONFLICT (address) DO UPDATE SET 
               nametag = $2, image = $3, description = $4, subcategory = $5`,
              [address.toLowerCase(), name, image, '', 'ENS']
            );
            logger.info(`Saved ENS ${name} for address ${address} to database`);
            return { address, name, image, description: '', subcategory: 'ENS' };
          }
          return { address, name: 'Unknown', image: '/icons/default.webp', description: '', subcategory: 'Others' };
        } catch (ensError) {
          logger.error(`Failed to fetch ENS for ${address}:`, ensError.message);
          return { address, name: 'Unknown', image: '/icons/default.webp', description: '', subcategory: 'Others' };
        }
      })
    );

    ensResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { address, name, image, description, subcategory } = result.value;
        cachedNametags[address] = { address, name, image, description, subcategory };
      }
    });

    logger.info(`ENS lookup for ${addressesWithoutNametag.length} addresses took ${Date.now() - ensStartTime}ms`);
  }

  for (const address of uniqueAddresses) {
    if (!cachedNametags[address]) {
      cachedNametags[address] = {
        address,
        name: 'Unknown',
        image: '/icons/default.webp',
        description: '',
        subcategory: 'Others',
      };
    }
  }

  return cachedNametags;
}

async function getTokenImage(tokenAddress, chain) {
  if (!tokenAddress || !isAddress(tokenAddress)) return '/icons/default.webp';
  const redisClient = await getRedisClient();
  const cacheKey = `token_image_${chain}_${tokenAddress.toLowerCase()}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;

  try {
    const result = await query(
      `SELECT image 
       FROM tokens 
       WHERE detail_platforms->'${chainIdToName[chain]}'->>'contract_address' = $1 /*+ PARALLEL(4) */`,
      [tokenAddress.toLowerCase()]
    );
    if (result.rows.length > 0 && result.rows[0].image) {
      const image = result.rows[0].image;
      await redisClient.setEx(cacheKey, 7 * 24 * 60 * 60, image);
      logger.info(`Token image for ${tokenAddress} on ${chain}: ${image} (source: database)`);
      return image;
    }

    const cgResponse = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/coins/${chainIdToName[chain]}/contract/${tokenAddress}`,
      {
        headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
        timeout: 10000,
      }
    );
    const image = cgResponse.data.image?.thumb || '/icons/default.webp';
    await redisClient.setEx(cacheKey, 7 * 24 * 60 * 60, image);
    logger.info(`Token image for ${tokenAddress} on ${chain}: ${image} (source: CoinGecko)`);
    return image;
  } catch (error) {
    logger.error(`Failed to fetch token image for ${tokenAddress}:`, error.message);
    await redisClient.setEx(cacheKey, 7 * 24 * 60 * 60, '/icons/default.webp');
    return '/icons/default.webp';
  }
}

async function fetchLayer3Transactions(layer2Addresses, chain, limit, page) {
  const transactions = [];
  const chainConfig = SUPPORTED_CHAINS[chain];
  if (!chainConfig.apiUrl) return transactions;

  const layer2Nametags = await getNametagsBatch(layer2Addresses, chain);
  const validLayer2Addresses = layer2Addresses.filter(
    (addr) => layer2Nametags[addr.toLowerCase()]?.name !== 'Unknown'
  );

  logger.info(`Fetching Layer 3 transactions for ${validLayer2Addresses.length} valid Layer 2 addresses`);

  const layer3Limit = 50;
  const batchSize = 10; // Process addresses in batches
  const batches = [];
  for (let i = 0; i < validLayer2Addresses.length; i += batchSize) {
    batches.push(validLayer2Addresses.slice(i, i + batchSize));
  }

  // Pre-fetch native price for layer3
  let nativePrice = 0;
  const cgId = SUPPORTED_CHAINS[chain].coingeckoId;
  nativePrice = await getCurrentPrice(cgId);

  // Collect all raw tx data first for potential batching (though layer3 uses txlist, mainly native)
  const allRawTxs = [];
  const batchPromises = batches.map(async (batch) => {
    const fetchPromises = batch.map(async (address) => {
      try {
        let apiUrl;
        if (chain === 'solana') {
          apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${address}&limit=${layer3Limit}&offset=${(page - 1) * layer3Limit}`;
        } else if (chain === 'tron') {
          apiUrl = `${chainConfig.apiUrl}/transaction?address=${address}&limit=${layer3Limit}&start=${(page - 1) * layer3Limit}`;
        } else {
          apiUrl = `${chainConfig.apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${layer3Limit}&sort=desc&chainid=${chain}&apikey=${chainConfig.apiKey}`;
        }

        const response = await fetchWithRateLimit(apiUrl, { timeout: 20000 });
        let txData = response.data.result || response.data.transactions || [];
        if (!Array.isArray(txData)) txData = [];
        return txData.map(tx => ({ ...tx, fromAddress: address }));
      } catch (error) {
        logger.error(`Failed to fetch Layer 3 transactions for ${address}:`, error.message);
        return [];
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    return results.flatMap((result) => 
      result.status === 'fulfilled' ? result.value.flat() : []
    );
  });

  const allBatchResults = await Promise.all(batchPromises);
  allRawTxs.push(...allBatchResults.flat());

  // Now process all raw txs in parallel
  const txPromises = allRawTxs.map(async (tx) => {
    let value = '0';
    let tokenSymbol = chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase();
    let contractAddress = null;
    let tokenImage = '/icons/default.webp';
    let blockTime;
    let usdValue = 0;

    if (chain === 'solana') {
      value = (tx.lamports / 1e9).toString();
      tokenSymbol = 'SOL';
      blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
    } else if (chain === 'tron') {
      value = (tx.amount / 1e6).toString();
      tokenSymbol = 'TRX';
      blockTime = tx.timestamp ? new Date(tx.timestamp).toISOString() : null;
    } else {
      value = (parseInt(tx.value) / 1e18).toString();
      // Note: txlist doesn't include token transfers; for tokens, would need separate tokentx fetch
      // Assuming native for layer3 as per original code
      blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
    }

    if (!blockTime) {
      logger.warn(`Missing or invalid block_time for tx ${tx.hash || tx.transactionHash} from address ${tx.fromAddress}`);
      return null;
    }

    // Use pre-fetched native price
    usdValue = Number(value) * nativePrice;

    return {
      address: tx.from === tx.fromAddress.toLowerCase() ? tx.to : tx.from,
      hash: tx.hash || tx.transactionHash,
      value,
      usdValue: usdValue.toFixed(6),
      tokenSymbol,
      contractAddress,
      tokenImage,
      block_time: blockTime,
      type: tx.from === tx.fromAddress.toLowerCase() ? 'outgoing' : 'incoming',
      layer2Address: tx.fromAddress,
    };
  });

  const txResults = await Promise.allSettled(txPromises);
  transactions.push(...txResults
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value)
  );

  const layer3Addresses = [...new Set(transactions.map((tx) => tx.address.toLowerCase()))];
  const layer3Nametags = await getNametagsBatch(layer3Addresses, chain);

  return transactions
    .filter((tx) => layer3Nametags[tx.address.toLowerCase()]?.name !== 'Unknown')
    .map((tx) => ({
      ...tx,
      nametag: layer3Nametags[tx.address.toLowerCase()]?.name || 'Unknown',
      image: layer3Nametags[tx.address.toLowerCase()]?.image || '/icons/default.webp',
      chainLogo: chainConfig.logo || '/icons/default.webp',
    }));
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);

    if (!(await isAllowedOrigin(origin, referer, ip))) {
      await trackViolation(ip, 'Invalid origin');
      return NextResponse.json({ error: 'Invalid origin.' }, { status: 403, headers: securityHeaders });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      await trackViolation(ip, 'Invalid request body');
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400, headers: securityHeaders });
    }

    const { wallet_address, chain, limit, page, fetchLayer3 } = parsed.data;

    const isPremium = request.headers.get('x-premium-user') === 'true';
    if (!isPremium && limit > 100) {
      await trackViolation(ip, 'Non-premium user attempted to fetch more than 100 transactions');
      return NextResponse.json({ error: 'Premium account required to fetch more than 100 transactions.' }, { status: 403, headers: securityHeaders });
    }
    if (chain !== 'solana' && chain !== 'tron' && !isAddress(wallet_address)) {
      await trackViolation(ip, 'Invalid wallet address');
      return NextResponse.json({ error: 'Invalid wallet address.' }, { status: 400, headers: securityHeaders });
    }

    const chainConfig = SUPPORTED_CHAINS[chain];
    const redisClient = await getRedisClient();
    const cacheKey = `tx_${chain}_${wallet_address}_${page}_${limit}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for ${cacheKey}`);
      return NextResponse.json(JSON.parse(cached), { headers: securityHeaders });
    }

    const fetchPromises = [];
    let apiUrl;
    if (chain === 'solana') {
      apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${wallet_address}&limit=${limit}&offset=${(page - 1) * limit}`;
      fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 20000 }).then((res) => ({ type: 'native', data: res.data.transactions || [] })));
    } else if (chain === 'tron') {
      apiUrl = `${chainConfig.apiUrl}/transaction?address=${wallet_address}&limit=${limit}&start=${(page - 1) * limit}`;
      fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 20000 }).then((res) => ({ type: 'native', data: res.data.transactions || [] })));
    } else {
      apiUrl = `${chainConfig.apiUrl}?module=account&action=txlist&address=${wallet_address}&startblock=0&endblock=99999999&page=${page}&offset=${limit}&sort=desc&chainid=${chain}&apikey=${chainConfig.apiKey}`;
      fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 20000 }).then((res) => ({ type: 'native', data: res.data.result || [] })));
      const tokenApiUrl = `${chainConfig.apiUrl}?module=account&action=tokentx&address=${wallet_address}&startblock=0&endblock=99999999&page=${page}&offset=${limit}&sort=desc&chainid=${chain}&apikey=${chainConfig.apiKey}`;
      fetchPromises.push(fetchWithRateLimit(tokenApiUrl, { timeout: 20000 }).then((res) => ({ type: 'token', data: res.data.result || [] })));
    }

    const responses = await Promise.allSettled(fetchPromises);
    let transactions = [];
    let tokenTransactions = [];

    responses.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.type === 'native') transactions = result.value.data;
        if (result.value.type === 'token') tokenTransactions = result.value.data;
      }
    });

    if (!Array.isArray(transactions)) transactions = [];
    if (!Array.isArray(tokenTransactions)) tokenTransactions = [];

    // Pre-fetch native price once
    let nativePrice = 0;
    const cgId = SUPPORTED_CHAINS[chain].coingeckoId;
    nativePrice = await getCurrentPrice(cgId);

    // Batch fetch token prices if EVM chain
    let tokenPrices = {};
    if (chain !== 'solana' && chain !== 'tron') {
      const uniqueContracts = [...new Set(tokenTransactions
        .map(tx => tx.contractAddress)
        .filter(isAddress)
      )];
      if (uniqueContracts.length > 0) {
        const platform = chainIdToName[chain];
        const contractList = uniqueContracts.join(',');
        try {
          const response = await fetchWithRateLimit(
            `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractList}&vs_currencies=usd`,
            { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
          );
          tokenPrices = response.data || {};
          // Update caches for each
          uniqueContracts.forEach(addr => {
            const price = tokenPrices[addr.toLowerCase()]?.usd || 0;
            redisClient.setEx(`token_price_${platform}_${addr.toLowerCase()}`, 300, price.toString());
          });
          logger.info(`Batch fetched prices for ${uniqueContracts.length} tokens`);
        } catch (e) {
          logger.error('Batch token price fetch failed, falling back to individual:', e.message);
        }
      }
    }

    const incoming = [];
    const outgoing = [];
    const addresses = new Set();

    const nativeTxPromises = transactions.map(async (tx) => {
      let value = '0';
      let tokenSymbol = chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase();
      let contractAddress = null;
      let tokenImage = '/icons/default.webp';
      let blockTime;
      let usdValue = 0;

      if (chain === 'solana') {
        value = (tx.lamports / 1e9).toString();
        tokenSymbol = 'SOL';
        blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
      } else if (chain === 'tron') {
        value = (tx.amount / 1e6).toString();
        tokenSymbol = 'TRX';
        blockTime = tx.timestamp ? new Date(tx.timestamp).toISOString() : null;
      } else {
        value = (parseInt(tx.value) / 1e18).toString();
        blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
      }

      if (!blockTime) {
        logger.warn(`Missing or invalid block_time for tx ${tx.hash || tx.transactionHash} from address ${wallet_address}`);
        return null;
      }

      // Use pre-fetched native price
      usdValue = Number(value) * nativePrice;

      return {
        address: tx.from === wallet_address.toLowerCase() ? tx.to : tx.from,
        hash: tx.hash || tx.transactionHash,
        value,
        usdValue: usdValue.toFixed(6),
        tokenSymbol,
        contractAddress,
        tokenImage,
        block_time: blockTime,
        type: tx.from === wallet_address.toLowerCase() ? 'outgoing' : 'incoming',
      };
    });

    const nativeTxResults = await Promise.allSettled(nativeTxPromises);
    nativeTxResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        const tx = result.value;
        if (tx.type === 'outgoing') {
          outgoing.push(tx);
          addresses.add(tx.address.toLowerCase());
        } else {
          incoming.push(tx);
          addresses.add(tx.address.toLowerCase());
        }
      }
    });

    const tokenPromises = tokenTransactions.map(async (tx) => {
      if (!isAddress(tx.contractAddress)) return null;
      if (BLOCKED_TOKEN_ADDRESSES.includes(tx.contractAddress.toLowerCase())) {
        logger.warn(`Filtered out blocked token contract: ${tx.contractAddress}`);
        return null;
      }
      if (!isValidTokenSymbol(tx.tokenSymbol)) {
        logger.warn(`Filtered out invalid token symbol: ${tx.tokenSymbol} for contract ${tx.contractAddress}`);
        return null;
      }
      let value = (parseInt(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal || 18))).toString();
      let tokenSymbol = tx.tokenSymbol || 'Unknown';
      let contractAddress = tx.contractAddress;
      let tokenImage = await getTokenImage(contractAddress, chain);
      let blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
      let usdValue = 0;

      if (!blockTime) {
        logger.warn(`Missing or invalid block_time for token tx ${tx.hash} from address ${wallet_address}`);
        return null;
      }

      // Use batched token price or fallback
      const price = tokenPrices[contractAddress.toLowerCase()]?.usd || await getTokenCurrentPrice(chainIdToName[chain], contractAddress);
      usdValue = Number(value) * price;

      return {
        address: tx.from === wallet_address.toLowerCase() ? tx.to : tx.from,
        hash: tx.hash,
        value,
        usdValue: usdValue.toFixed(6),
        tokenSymbol,
        contractAddress,
        tokenImage,
        block_time: blockTime,
        type: tx.from === wallet_address.toLowerCase() ? 'outgoing' : 'incoming',
      };
    });

    const tokenResults = await Promise.allSettled(tokenPromises);
    tokenResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        const tx = result.value;
        if (tx.type === 'outgoing') {
          outgoing.push(tx);
          addresses.add(tx.address.toLowerCase());
        } else {
          incoming.push(tx);
          addresses.add(tx.address.toLowerCase());
        }
      }
    });

    const nametags = await getNametagsBatch([...addresses, wallet_address.toLowerCase()], chain);
    const walletNametag = nametags[wallet_address.toLowerCase()] || {
      name: 'Unknown',
      image: '/icons/default.webp',
      description: '',
      subcategory: 'Others',
    };

    const chainLogo = await getChainLogo(chainConfig.coingeckoId);

    const processedIncoming = incoming.map((tx) => ({
      ...tx,
      nametag: nametags[tx.address.toLowerCase()]?.name || 'Unknown',
      image: nametags[tx.address.toLowerCase()]?.image || '/icons/default.webp',
      chainLogo,
    }));

    const processedOutgoing = outgoing.map((tx) => ({
      ...tx,
      nametag: nametags[tx.address.toLowerCase()]?.name || 'Unknown',
      image: nametags[tx.address.toLowerCase()]?.image || '/icons/default.webp',
      chainLogo,
    }));

    let layer3Transactions = [];
    if (fetchLayer3) {
      const layer2Addresses = [...new Set([...incoming, ...outgoing].map((tx) => tx.address.toLowerCase()))];
      layer3Transactions = await fetchLayer3Transactions(layer2Addresses, chain, limit, page);
    }

    const result = {
      incoming: processedIncoming,
      outgoing: processedOutgoing,
      layer3: layer3Transactions,
      wallet: {
        address: wallet_address,
        nametag: walletNametag.name,
        image: walletNametag.image,
        chainLogo,
      },
    };

    const calculateServerRisk = (txs) => {
      return txs.map(tx => ({
        ...tx,
        riskScore: Math.random() > 0.8 ? 0.9 : 0.3 // Placeholder; integrate ML later
      }));
    };

    const resultWithRisk = {
      ...result,
      incoming: calculateServerRisk(result.incoming),
      outgoing: calculateServerRisk(result.outgoing),
      layer3: calculateServerRisk(result.layer3),
    };

    await redisClient.setEx(cacheKey, 3600, JSON.stringify(resultWithRisk));

    return NextResponse.json(resultWithRisk, { headers: securityHeaders });
  } catch (error) {
    logger.error('Error processing request:', error.message);
    await trackViolation(ip, error.message);
    return NextResponse.json({ error: error.message }, { status: 429, headers: securityHeaders });
  }
}