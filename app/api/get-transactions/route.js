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
import { autoLabelWallets } from '../../../utils/serverClustering';
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
  if (ip === '::1' || ip === '127.0.0.1') return;
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}
async function checkIPBan(ip) {
  if (ip === '::1' || ip === '127.0.0.1') return;
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) throw new Error('IP temporarily banned.');
}
async function trackViolation(ip, reason = '') {
  if (ip === '::1' || ip === '127.0.0.1') {
    logger.warn(`Localhost violation skipped: ${reason}`);
    return;
  }
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
  logger.warn(`Violation tracked for IP ${ip}: ${reason}`);
}
async function checkRateLimit(ip) {
  if (ip === '::1' || ip === '127.0.0.1') return;
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
    const response = await limiterBottleneck.schedule(() => axios.get(url, { ...config, timeout: 10000 })); // Reduced timeout
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
  maxConcurrent: process.env.NODE_ENV === 'production' ? 20 : 5, // Increased concurrency
  minTime: 100, // Reduced min time
  reservoir: 200, // Increased reservoir
  reservoirRefreshAmount: 200,
  reservoirRefreshInterval: 30 * 1000, // Reduced interval for faster refresh
});
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 300 + Math.random() * 50,
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED' || error.response?.status === 400,
});
async function isAllowedOrigin(origin, referer, ip) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://farcaster.xynapseai.net',
    "https://base.xynapseai.net",
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);
  if (process.env.NODE_ENV !== 'production') return configured.some(url => url === origin || (referer && new URL(referer).origin === url));
  try {
    const source = origin && origin !== 'null' ? origin : referer ? new URL(referer).origin : null;
    if (!source || !source.startsWith('https://')) {
      await trackViolation(ip, 'Non-HTTPS or missing origin/referer');
      return false;
    }
    if (configured.includes(source)) return true;
    await trackViolation(ip, 'Invalid origin/referer');
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
  '59144': { name: 'linea', explorer: 'Linea Explorer', apiUrl: '', apiKey: '', coingeckoId: 'linea' },
  '534352': { name: 'scroll', explorer: 'Scroll Explorer', apiUrl: '', apiKey: '', coingeckoId: 'scroll' },
  'solana': { name: 'solana', explorer: 'Solscan', apiUrl: 'https://public-api.solscan.io', apiKey: process.env.SOLSCAN_API_KEY, coingeckoId: 'solana' },
  'tron': { name: 'tron', explorer: 'TronScan', apiUrl: 'https://api.tronscan.org/api', apiKey: process.env.TRONSCAN_API_KEY, coingeckoId: 'tron' },
  'bitcoin': { name: 'bitcoin', explorer: 'Mempool', apiUrl: 'https://mempool.space/api', apiKey: '', coingeckoId: 'bitcoin' },
};
const chainIdToName = Object.fromEntries(
  Object.entries(SUPPORTED_CHAINS).map(([id, { name }]) => [id, name])
);
const bodySchema = z.object({
  wallet_address: z.string().nonempty('Wallet address is required'),
  chain: z.enum(Object.keys(SUPPORTED_CHAINS), { message: 'Invalid chain' }),
  limit: z.number().int().min(100).max(500, 'Limit must be between 100 and 500'), // Updated: min=100, max=500
  page: z.number().int().min(1).default(1),
  fetchLayer3: z.boolean().optional().default(false),
});
function isValidTokenSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;
  const cleanedSymbol = symbol.trim().toLowerCase();
  if (cleanedSymbol.length < 2 || cleanedSymbol.length > 20) return false;
  const validSymbolPattern = /^[a-z0-9\-_]+$/;
  if (!validSymbolPattern.test(cleanedSymbol)) return false;
  const urlPattern = /(https?:\/\/|www\.|\.com|\.org|\.net|\.io)/i;
  if (urlPattern.test(cleanedSymbol)) return false;
  const suspiciousKeywords = ['claim', 'free', 'airdrop', 'promo', 'reward', 'bonus'];
  return !suspiciousKeywords.some(keyword => cleanedSymbol.includes(keyword));
}
async function getChainLogo(coingeckoId) {
  const cacheKey = `chain_logo_${coingeckoId}`;
  const redisClient = await getRedisClient();
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
      timeout: 8000,
    });
    const chain = response.data.find((c) => c.id === coingeckoId);
    const logo = chain?.image?.thumb || '/icons/default.webp';
    await redisClient.setEx(cacheKey, 30 * 24 * 60 * 60, logo);
    return logo;
  } catch {
    return '/icons/default.webp';
  }
}
async function getCurrentPrice(cgId) {
  const redisClient = await getRedisClient();
  const cacheKey = `price_${cgId}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return parseFloat(cached);
  try {
    const response = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
    );
    const price = response.data[cgId]?.usd;
    if (price) {
      await redisClient.setEx(cacheKey, 300, price.toString());
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
  const cached = await redisClient.get(cacheKey);
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
async function getNametagsBatch(addresses) {
  const start = Date.now();
  const uniqueAddresses = [...new Set(addresses.map((addr) => addr.toLowerCase()))];
  const nametags = {};
  if (uniqueAddresses.length === 0) return nametags;
  const redisClient = await getRedisClient();
  const cacheKeys = uniqueAddresses.map((addr) => `nametag_${addr}`);
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
       WHERE LOWER(address) = ANY($1)`,
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
      await redisClient.setEx(`nametag_${address}`, 30 * 24 * 60 * 60, JSON.stringify(cachedNametags[address]));
    }
  }
  const addressesWithoutNametag = uniqueAddresses.filter(
    (addr) => !cachedNametags[addr] || cachedNametags[addr].name === 'Unknown'
  ).slice(0, 50); // Limit to 50 to reduce RPC load
  if (addressesWithoutNametag.length > 0) {
    const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
    const REGISTRY_ABI = ['function resolver(bytes32 node) view returns (address)'];
    const RESOLVER_ABI = ['function name(bytes32 node) view returns (string)'];
    const ENS_MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
    const MULTICALL_ABI = [
      'function aggregate((address target, bytes callData)[] calldata calls) external payable returns (uint256 blockNumber, bytes[] memory returnData)'
    ];
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com');
    try {
      await provider.getNetwork();
      logger.info(`Successfully connected to Ethereum RPC`);
    } catch (error) {
      logger.error(`Failed to connect to Ethereum RPC: ${error.message}, skipping ENS resolution`);
      // Continue without ENS
    }
    try {
      const reverseNodes = addressesWithoutNametag.map((addr) => ethers.namehash(`${addr.slice(2).toLowerCase()}.addr.reverse`));
      const registryInterface = new ethers.Interface(REGISTRY_ABI);
      const resolverInterface = new ethers.Interface(RESOLVER_ABI);
      const multicallContract = new ethers.Contract(ENS_MULTICALL_ADDRESS, MULTICALL_ABI, provider);
      // Batch size reduced to 20 for faster RPC
      const BATCH_SIZE = 20;
      // Batch fetch resolvers
      const resolvers = [];
      for (let batchStart = 0; batchStart < reverseNodes.length; batchStart += BATCH_SIZE) {
        const batchNodes = reverseNodes.slice(batchStart, batchStart + BATCH_SIZE);
        const resolverCalls = batchNodes.map((node) => ({
          target: ENS_REGISTRY,
          callData: registryInterface.encodeFunctionData('resolver', [node]),
        }));
        const { returnData: resolverReturnData } = await multicallContract.aggregate.staticCall(resolverCalls);
        const batchResolvers = resolverReturnData.map((data) => {
          try {
            return ethers.AbiCoder.defaultAbiCoder().decode(['address'], data)[0];
          } catch {
            return ethers.ZeroAddress;
          }
        });
        resolvers.push(...batchResolvers);
      }
      const validIndices = resolvers
        .map((resolver, index) => (resolver !== ethers.ZeroAddress ? index : -1))
        .filter((index) => index !== -1);
      if (validIndices.length > 0) {
        // Batch fetch names
        const names = [];
        for (let batchStart = 0; batchStart < validIndices.length; batchStart += BATCH_SIZE) {
          const batchIndices = validIndices.slice(batchStart, batchStart + BATCH_SIZE);
          const nameCalls = batchIndices.map((index) => ({
            target: resolvers[index],
            callData: resolverInterface.encodeFunctionData('name', [reverseNodes[index]]),
          }));
          const { returnData: nameReturnData } = await multicallContract.aggregate.staticCall(nameCalls);
          const batchNames = nameReturnData.map((data) => {
            try {
              return ethers.AbiCoder.defaultAbiCoder().decode(['string'], data)[0];
            } catch {
              return '';
            }
          });
          names.push(...batchNames);
        }
        // Process valid ENS names
        for (let vIndex = 0; vIndex < validIndices.length; vIndex++) {
          const index = validIndices[vIndex];
          const address = addressesWithoutNametag[index];
          const name = names[vIndex];
          if (name && name !== '') {
            let image = '/icons/default.webp';
            const shortName = name.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            try {
              const cgResponse = await fetchWithRateLimit(
                `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(shortName)}`,
                {
                  headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
                  timeout: 8000,
                }
              );
              const coin = cgResponse.data.coins?.[0];
              if (coin?.thumb) image = coin.thumb;
            } catch (cgError) {
              logger.error(`Failed to fetch CoinGecko image for ENS ${shortName}:`, cgError.message);
            }
            const ensNametag = { name, image, description: '', subcategory: 'ENS' };
            await redisClient.setEx(`nametag_${address}`, 30 * 24 * 60 * 60, JSON.stringify(ensNametag));
            await query(
              `INSERT INTO nametags (address, nametag, image, description, subcategory)
               VALUES (LOWER($1), $2, $3, $4, $5)
               ON CONFLICT (address)
               DO UPDATE SET
               nametag = $2, image = $3, description = $4, subcategory = $5`,
              [address.toLowerCase(), name, image, '', 'ENS']
            );
            logger.info(`Saved ENS ${name} for address ${address} to database`);
            cachedNametags[address] = { address, ...ensNametag };
          }
        }
      }
    } catch (ensError) {
      logger.error(`Failed to fetch ENS via multicall for batch: ${ensError.message} - Full error:`, ensError);
      // Optionally fallback to individual calls here if needed, but skip for now to avoid rate limits
    }
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
      await redisClient.setEx(`nametag_${address}`, 30 * 24 * 60 * 60, JSON.stringify(cachedNametags[address]));
    }
  }
  logger.info(`getNametagsBatch took ${(Date.now() - start)/1000}s for ${uniqueAddresses.length} addresses`);
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
       WHERE detail_platforms->'${chainIdToName[chain]}'->>'contract_address' = $1`,
      [tokenAddress.toLowerCase()]
    );
    if (result.rows.length > 0 && result.rows[0].image) {
      const image = result.rows[0].image;
      await redisClient.setEx(cacheKey, 30 * 24 * 60 * 60, image);
      logger.info(`Token image for ${tokenAddress} on ${chain}: ${image} (source: database)`);
      return image;
    }
    const cgResponse = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/coins/${chainIdToName[chain]}/contract/${tokenAddress}`,
      {
        headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
        timeout: 8000,
      }
    );
    const image = cgResponse.data.image?.thumb || '/icons/default.webp';
    await redisClient.setEx(cacheKey, 30 * 24 * 60 * 60, image);
    logger.info(`Token image for ${tokenAddress} on ${chain}: ${image} (source: CoinGecko)`);
    return image;
  } catch (error) {
    logger.error(`Failed to fetch token image for ${tokenAddress}:`, error.message);
    await redisClient.setEx(cacheKey, 30 * 24 * 60 * 60, '/icons/default.webp');
    return '/icons/default.webp';
  }
}
async function fetchLayer3Transactions(layer2Addresses, chain, limit, page) {
  const start = Date.now();
  const transactions = [];
  const chainConfig = SUPPORTED_CHAINS[chain];
  if (!chainConfig.apiUrl) return transactions;
  const layer2Nametags = await getNametagsBatch(layer2Addresses);
  const validLayer2Addresses = layer2Addresses.filter(
    (addr) => layer2Nametags[addr.toLowerCase()]?.name !== 'Unknown'
  ).slice(0, 20); // Limit to 20 to reduce delay
  logger.info(`Fetching Layer 3 transactions for ${validLayer2Addresses.length} valid Layer 2 addresses (limited)`);
  const layer3Limit = 50;
  const batchSize = 5;
  const batches = [];
  for (let i = 0; i < validLayer2Addresses.length; i += batchSize) {
    batches.push(validLayer2Addresses.slice(i, i + batchSize));
  }
  let nativePrice = await getCurrentPrice(chainConfig.coingeckoId);
  const allRawTxs = [];
  const batchPromises = batches.map(async (batch) => {
    const fetchPromises = batch.map(async (address) => {
      try {
        let apiUrl;
        if (chain === 'solana') {
          apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${address}&limit=${layer3Limit}&offset=${(page - 1) * layer3Limit}`;
        } else if (chain === 'tron') {
          apiUrl = `${chainConfig.apiUrl}/transaction?address=${address}&limit=${layer3Limit}&start=${(page - 1) * layer3Limit}`;
        } else if (chain === 'bitcoin') {
          apiUrl = `${chainConfig.apiUrl}/address/${address}/txs?limit=${layer3Limit}`;
        } else {
          apiUrl = `${chainConfig.apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${layer3Limit}&sort=desc&chainid=${chain}&apikey=${chainConfig.apiKey}`;
        }
        const cacheKey = `layer3_tx_${chain}_${address}_${page}_${layer3Limit}`;
        const redisClient = await getRedisClient();
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          logger.info(`Layer3 cache hit for ${cacheKey}`);
          return JSON.parse(cached).map(tx => ({ ...tx, fromAddress: address }));
        }
        const response = await fetchWithRateLimit(apiUrl, { timeout: 10000 });
        let txData = response.data.result || response.data.transactions || response.data || [];
        if (!Array.isArray(txData)) txData = [];
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(txData));
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
    } else if (chain === 'bitcoin') {
      if (!tx.status || !tx.status.confirmed) return null;
      blockTime = tx.status.block_time ? new Date(tx.status.block_time * 1000).toISOString() : null;
      if (!blockTime) return null;
      const receivedVouts = tx.vout ? tx.vout.filter(v => v.scriptpubkey_address === tx.fromAddress) : [];
      for (const vout of receivedVouts) {
        if (vout.value > 546) {
          value = (vout.value / 1e8).toString();
          tokenSymbol = 'BTC';
          usdValue = Number(value) * nativePrice;
          return {
            address: tx.vin && tx.vin[0] ? tx.vin[0].prevout.scriptpubkey_address : 'unknown',
            hash: tx.txid,
            value,
            usdValue: usdValue.toFixed(6),
            tokenSymbol,
            contractAddress,
            tokenImage,
            block_time: blockTime,
            type: 'incoming',
            layer2Address: tx.fromAddress,
          };
        }
      }
      const spentVins = tx.vin ? tx.vin.filter(v => v.prevout && v.prevout.scriptpubkey_address === tx.fromAddress) : [];
      for (const vin of spentVins) {
        value = (vin.prevout.value / 1e8).toString();
        const target = tx.vout && tx.vout[0] ? tx.vout[0].scriptpubkey_address : 'unknown';
        usdValue = Number(value) * nativePrice;
        return {
          address: target,
          hash: tx.txid,
          value,
          usdValue: usdValue.toFixed(6),
          tokenSymbol: 'BTC',
          contractAddress,
          tokenImage,
          block_time: blockTime,
          type: 'outgoing',
          layer2Address: tx.fromAddress,
        };
      }
      return null;
    } else {
      value = (parseInt(tx.value) / 1e18).toString();
      if (parseFloat(value) === 0) return null;
      blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
    }
    if (!blockTime) {
      logger.warn(`Missing or invalid block_time for tx ${tx.hash || tx.transactionHash} from address ${tx.fromAddress}`);
      return null;
    }
    usdValue = Number(value) * nativePrice;
    return {
      address: tx.from === tx.fromAddress.toLowerCase() ? tx.to : tx.from,
      hash: tx.hash || tx.transactionHash || tx.txid,
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
  const layer3Nametags = await getNametagsBatch(layer3Addresses);
  const processed = transactions
    .filter((tx) => layer3Nametags[tx.address.toLowerCase()]?.name !== 'Unknown')
    .map((tx) => ({
      ...tx,
      nametag: layer3Nametags[tx.address.toLowerCase()]?.name || 'Unknown',
      image: layer3Nametags[tx.address.toLowerCase()]?.image || '/icons/default.webp',
      chainLogo: chainConfig.logo || '/icons/default.webp',
    }));
  logger.info(`fetchLayer3Transactions took ${(Date.now() - start)/1000}s`);
  return processed;
}
async function hasConfidenceColumn() {
  try {
    const result = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'nametags' AND column_name = 'confidence'`
    );
    return result.rows.length > 0;
  } catch (err) {
    console.warn('Error checking confidence column:', err.message);
    return false;
  }
}
async function saveAutoLabelsToDB(addressesWithLabels) {
  const redisClient = await getRedisClient();
  const hasConf = await hasConfidenceColumn();
  const confParam = hasConf ? ', confidence' : '';
  const confValue = hasConf ? ', $6' : '';
  const confUpdate = hasConf ? ', confidence = $6' : '';
  for (const [address, { label, confidence }] of Object.entries(addressesWithLabels)) {
    // Skip saving if label is null, undefined, or empty to avoid NOT NULL violation
    if (!label || label.trim() === '') {
      logger.info(`Skipping auto-label save for ${address}: label is null/empty`);
      continue;
    }
    const image = '/icons/default.webp';
    const description = `Auto-labeled by ML (conf: ${confidence})`;
    const subcategory = 'ML Auto';
    const params = [address.toLowerCase(), label, image, description, subcategory];
    if (hasConf) params.push(parseFloat(confidence));
    try {
      await query(
        `INSERT INTO nametags (address, nametag, image, description, subcategory${confParam})
         VALUES (LOWER($1), $2, $3, $4, $5${confValue})
         ON CONFLICT (address)
         DO UPDATE SET
         nametag = $2, image = $3, description = $4, subcategory = $5${confUpdate}`,
        params
      );
      const ntagObj = { address: address.toLowerCase(), name: label, image, description, subcategory };
      if (hasConf) ntagObj.confidence = confidence;
      await redisClient.setEx(`nametag_${address.toLowerCase()}`, 30 * 24 * 60 * 60, JSON.stringify(ntagObj));
      logger.info(`Auto-saved label for ${address}: ${label} (conf: ${confidence})`);
    } catch (dbErr) {
      logger.error(`Failed to save auto-label for ${address}:`, dbErr.message);
    }
  }
}
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '::1';
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
    if (!isPremium && limit > 200) {
      await trackViolation(ip, 'Non-premium user attempted to fetch more than 200 transactions');
      return NextResponse.json({ error: 'Premium account required to fetch more than 200 transactions.' }, { status: 403, headers: securityHeaders });
    }
    const isBitcoin = chain === 'bitcoin';
    const bitcoinRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/i;
    if (!isBitcoin && chain !== 'solana' && chain !== 'tron' && !isAddress(wallet_address)) {
      await trackViolation(ip, 'Invalid wallet address');
      return NextResponse.json({ error: 'Invalid wallet address.' }, { status: 400, headers: securityHeaders });
    }
    if (isBitcoin && !bitcoinRegex.test(wallet_address)) {
      await trackViolation(ip, 'Invalid Bitcoin address');
      return NextResponse.json({ error: 'Invalid Bitcoin address.' }, { status: 400, headers: securityHeaders });
    }
    const chainConfig = SUPPORTED_CHAINS[chain];
    const redisClient = await getRedisClient();
    const cacheKey = `tx_${chain}_${wallet_address.toLowerCase()}_${page}_${limit}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for ${cacheKey}`);
      return NextResponse.json(JSON.parse(cached), { headers: securityHeaders });
    }
    const fetchPromises = [];
    let apiUrl;
    let internalData = [];
    if (chain === 'solana') {
      apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${wallet_address}&limit=${limit}&offset=${(page - 1) * limit}`;
      fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({ type: 'native', data: res.data.transactions || [] })));
    } else if (chain === 'tron') {
      apiUrl = `${chainConfig.apiUrl}/transaction?address=${wallet_address}&limit=${limit}&start=${(page - 1) * limit}`;
      fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({ type: 'native', data: res.data.transactions || [] })));
    } else if (chain === 'bitcoin') {
      apiUrl = `${chainConfig.apiUrl}/address/${wallet_address}/txs?limit=${limit}`;
      fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({ type: 'native', data: res.data || [] })));
    } else {
      const endpoints = [
        { action: 'txlist', type: 'native' },
        { action: 'tokentx', type: 'token' },
        { action: 'txlistinternal', type: 'internal' }
      ];
      endpoints.forEach(({ action, type }) => {
        const cacheKey = `api_${chain}_${wallet_address.toLowerCase()}_${action}_${page}_${limit}`;
        fetchPromises.push(
          (async () => {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
              logger.info(`API cache hit for ${cacheKey}`);
              return { type, data: JSON.parse(cached) };
            }
            const url = `${chainConfig.apiUrl}?module=account&action=${action}&address=${wallet_address}&startblock=0&endblock=99999999&page=${page}&offset=${limit}&sort=desc&chainid=${chain}&apikey=${chainConfig.apiKey}`;
            const response = await fetchWithRateLimit(url, { timeout: 10000 });
            const data = response.data.result || [];
            await redisClient.setEx(cacheKey, 3600, JSON.stringify(data));
            return { type, data };
          })()
        );
      });
    }
    const responses = await Promise.allSettled(fetchPromises);
    let transactions = [];
    let tokenTransactions = [];
    responses.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.type === 'native') transactions = result.value.data;
        if (result.value.type === 'token') tokenTransactions = result.value.data;
        if (result.value.type === 'internal') internalData = result.value.data;
      }
    });
    if (!Array.isArray(transactions)) transactions = [];
    if (!Array.isArray(tokenTransactions)) tokenTransactions = [];
    if (!Array.isArray(internalData)) internalData = [];
    let nativePrice = await getCurrentPrice(chainConfig.coingeckoId);
    let tokenPrices = {};
    if (chain !== 'solana' && chain !== 'tron' && chain !== 'bitcoin') {
      const uniqueContracts = [...new Set(tokenTransactions
        .map(tx => tx.contractAddress)
        .filter(isAddress)
      )];
      if (uniqueContracts.length > 0) {
        const platform = chainIdToName[chain];
        const contractList = uniqueContracts.join(',');
        const cacheKey = `token_prices_${platform}_${contractList}_${page}_${limit}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          tokenPrices = JSON.parse(cached);
          logger.info(`Token prices cache hit for ${cacheKey}`);
        } else {
          try {
            const response = await fetchWithRateLimit(
              `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractList}&vs_currencies=usd`,
              { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
            );
            tokenPrices = response.data || {};
            await redisClient.setEx(cacheKey, 300, JSON.stringify(tokenPrices));
            logger.info(`Batch fetched and cached prices for ${uniqueContracts.length} tokens`);
          } catch (e) {
            logger.error('Batch token price fetch failed:', e.message);
          }
        }
      }
    }
    const incoming = [];
    const outgoing = [];
    const addresses = new Set();
    if (chain === 'bitcoin') {
      const bitcoinTxPromises = transactions.map(async (tx) => {
        if (!tx.status || !tx.status.confirmed) return null;
        const blockTime = tx.status.block_time ? new Date(tx.status.block_time * 1000).toISOString() : null;
        if (!blockTime) return null;
        let value = '0';
        let tokenSymbol = 'BTC';
        let contractAddress = null;
        let tokenImage = '/icons/default.webp';
        let usdValue = 0;
        const receivedVouts = tx.vout ? tx.vout.filter(v => v.scriptpubkey_address?.toLowerCase() === wallet_address.toLowerCase()) : [];
        for (const vout of receivedVouts) {
          if (vout.value > 546) {
            value = (vout.value / 1e8).toString();
            usdValue = Number(value) * nativePrice;
            const source = tx.vin && tx.vin[0] ? tx.vin[0].prevout.scriptpubkey_address : 'unknown';
            return {
              address: source,
              hash: tx.txid,
              value,
              usdValue: usdValue.toFixed(6),
              tokenSymbol,
              contractAddress,
              tokenImage,
              block_time: blockTime,
              type: 'incoming',
            };
          }
        }
        const spentVins = tx.vin ? tx.vin.filter(v => v.prevout && v.prevout.scriptpubkey_address?.toLowerCase() === wallet_address.toLowerCase()) : [];
        for (const vin of spentVins) {
          value = (vin.prevout.value / 1e8).toString();
          usdValue = Number(value) * nativePrice;
          const target = tx.vout && tx.vout[0] ? tx.vout[0].scriptpubkey_address : 'unknown';
          return {
            address: target,
            hash: tx.txid,
            value,
            usdValue: usdValue.toFixed(6),
            tokenSymbol,
            contractAddress,
            tokenImage,
            block_time: blockTime,
            type: 'outgoing',
          };
        }
        return null;
      });
      const bitcoinTxResults = await Promise.allSettled(bitcoinTxPromises);
      bitcoinTxResults.forEach((result) => {
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
    } else {
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
          value = ethers.formatEther(tx.value);
          blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
        }
        if (!blockTime) {
          logger.warn(`Missing or invalid block_time for tx ${tx.hash || tx.transactionHash} from address ${wallet_address}`);
          return null;
        }
        if (parseFloat(value) === 0) return null;
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
      if (chain !== 'solana' && chain !== 'tron' && internalData.length > 0) {
        const internalNativeTxPromises = internalData.map(async (itx) => {
          if (itx.type !== 'call' || BigInt(itx.value) === 0n) return null;
          let value = ethers.formatEther(itx.value);
          let tokenSymbol = chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase();
          let contractAddress = null;
          let tokenImage = '/icons/default.webp';
          let blockTime = itx.timeStamp ? new Date(parseInt(itx.timeStamp) * 1000).toISOString() : null;
          let usdValue = Number(value) * nativePrice;
          if (!blockTime) {
            logger.warn(`Missing or invalid block_time for internal tx ${itx.hash} from address ${wallet_address}`);
            return null;
          }
          const from = itx.from.toLowerCase();
          const to = itx.to.toLowerCase();
          const isOutgoing = from === wallet_address.toLowerCase();
          const address = isOutgoing ? to : from;
          const type = isOutgoing ? 'outgoing' : 'incoming';
          return {
            address,
            hash: itx.hash,
            value,
            usdValue: usdValue.toFixed(6),
            tokenSymbol,
            contractAddress,
            tokenImage,
            block_time: blockTime,
            type,
          };
        });
        const internalTxResults = await Promise.allSettled(internalNativeTxPromises);
        internalTxResults.forEach((result) => {
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
      }
      const tokenPromises = tokenTransactions.map(async (tx) => {
        if (!isAddress(tx.contractAddress) || BLOCKED_TOKEN_ADDRESSES.includes(tx.contractAddress.toLowerCase()) || !isValidTokenSymbol(tx.tokenSymbol)) {
          return null;
        }
        let value = (parseInt(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal || 18))).toString();
        if (parseFloat(value) === 0) return null;
        let tokenSymbol = tx.tokenSymbol || 'Unknown';
        let contractAddress = tx.contractAddress;
        let tokenImage = await getTokenImage(contractAddress, chain);
        let blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
        let usdValue = 0;
        if (!blockTime) {
          logger.warn(`Missing or invalid block_time for token tx ${tx.hash} from address ${wallet_address}`);
          return null;
        }
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
    }
    const nametags = await getNametagsBatch([...addresses, wallet_address.toLowerCase()]);
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
    // Auto-label & DB save (with column check)
    const allAddresses = [...new Set([...addresses, wallet_address.toLowerCase()])];
    const unknownAddresses = allAddresses.filter(
      (addr) => !nametags[addr] || nametags[addr].name === 'Unknown'
    ).slice(0, 50); // Limit to 50 to reduce delay
    if (unknownAddresses.length > 0) {
      const mockNodes = unknownAddresses.map(addr => {
        const addrTxs = [...incoming, ...outgoing].filter(tx => tx.address.toLowerCase() === addr);
        const totalValue = addrTxs.reduce((sum, tx) => sum + parseFloat(tx.usdValue || 0), 0);
        const txCount = addrTxs.length;
        const uniqueTokens = new Set(addrTxs.map(tx => tx.tokenSymbol)).size;
        const velocity = txCount > 0 ? txCount / 30 : 0;
        return {
          id: addr,
          totalValue,
          txCount,
          degree: 1, // Simplified from connections
          uniqueTokens,
          velocity,
        };
      });
      const autoLabels = await autoLabelWallets(mockNodes);
      await saveAutoLabelsToDB(autoLabels); // Handles column check
      // Merge
      Object.entries(autoLabels).forEach(([addr, { label }]) => {
        if (!nametags[addr]) {
          nametags[addr] = { name: label, image: '/icons/default.webp', description: '', subcategory: 'ML Auto' };
        }
      });
      // Re-process with new labels
      processedIncoming.forEach(tx => {
        const ntag = nametags[tx.address.toLowerCase()];
        if (ntag) {
          tx.nametag = ntag.name;
          tx.image = ntag.image;
        }
      });
      processedOutgoing.forEach(tx => {
        const ntag = nametags[tx.address.toLowerCase()];
        if (ntag) {
          tx.nametag = ntag.name;
          tx.image = ntag.image;
        }
      });
    }
    const calculateServerRisk = (txs) => {
      return txs.map(tx => ({
        ...tx,
        riskScore: Math.random() > 0.8 ? 0.9 : 0.3
      }));
    };
    const resultWithRisk = {
      ...result,
      incoming: calculateServerRisk(processedIncoming),
      outgoing: calculateServerRisk(processedOutgoing),
      layer3: calculateServerRisk(layer3Transactions),
    };
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(resultWithRisk));
    return NextResponse.json(resultWithRisk, { headers: securityHeaders });
  } catch (error) {
    logger.error('Error processing request:', error.message);
    await trackViolation(ip, error.message);
    return NextResponse.json({ error: error.message }, { status: 429, headers: securityHeaders });
  }
}