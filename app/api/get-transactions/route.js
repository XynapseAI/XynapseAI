// app\api\get-transactions\route.js
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
import crypto from 'crypto';
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
  const maxRequests = 200;
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
  maxConcurrent: 25,
  minTime: 30,
  reservoir: 300,
  reservoirRefreshAmount: 300,
  reservoirRefreshInterval: 30 * 1000,
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
  'monad': { name: 'monad', explorer: 'Monad Explorer', apiUrl: 'https://monadvision.com/', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'monad' },
};

const alchemyNetworks = {
  '1': 'eth-mainnet',
  '10': 'opt-mainnet',
  '137': 'polygon-mainnet',
  '59144': 'linea-mainnet',
  '8453': 'base-mainnet',
  '999': 'hyperliquid-mainnet',
  '43114': 'avax-mainnet',
  '56': 'bnb-mainnet',
  '130': 'unichain-mainnet',
  '143': 'monad-mainnet',
  '42161': 'arb-mainnet', // Added Arbitrum
  '5000': 'mantle-mainnet', // Added Mantle (if supported by Alchemy)
  '534352': 'scroll-mainnet', // Added Scroll (if supported)
};

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

const chainIdToName = Object.fromEntries(
  Object.entries(SUPPORTED_CHAINS).map(([id, { name }]) => [id, name])
);

const bodySchema = z.object({
  wallet_address: z.string().nonempty('Wallet address is required'),
  chain: z.enum(Object.keys(SUPPORTED_CHAINS), { message: 'Invalid chain' }),
  limit: z.number().int().min(200).max(1000, 'Limit must be between 200 and 1000'),
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

function safeFormatUnits(value, unit) {
  if (value == null) return '0';
  try {
    return ethers.formatUnits(value, unit);
  } catch (error) {
    logger.warn(`Failed to format units for value ${value} with unit ${unit}: ${error.message}. Using raw value.`);
    return typeof value === 'number' ? value.toFixed(6) : String(value);
  }
}

function safeFormatEther(value) {
  return safeFormatUnits(value, 18);
}

async function getChainLogo(coingeckoId) {
  const cacheKey = `chain_logo_${coingeckoId}`;
  const redisClient = await getRedisClient();
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-c-g-demo-api-key': process.env.COINGECKO_API_KEY },
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

async function getTokenCurrentPriceBatch(platform, contractAddresses) {
  const redisClient = await getRedisClient();
  const contractList = contractAddresses.join(',');
  const cacheKey = `token_prices_batch_${platform}_${contractList}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  if (circuitOpen) {
    logger.warn(`Circuit open, skipping price batch for ${platform}`);
    return {}; // Fallback empty, usdValue sẽ =0
  }
  try {
    const response = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractList}&vs_currencies=usd`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } }
    );
    const prices = response.data || {};
    await redisClient.setEx(cacheKey, 300, JSON.stringify(prices));
    return prices;
  } catch (e) {
    logger.error(`Error fetching batch token prices for ${platform}:`, e);
    return {}; // Fallback empty thay vì throw, tránh propagate error
  }
}

async function getTokenCurrentPrice(platform, contractAddress) {
  const prices = await getTokenCurrentPriceBatch(platform, [contractAddress]);
  return prices[contractAddress.toLowerCase()]?.usd || 0;
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
  ).slice(0, 20); // Reduced to 20 for speed
  if (addressesWithoutNametag.length > 0 && addressesWithoutNametag.length <= 20) { // Skip if >20
    const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
    const REGISTRY_ABI = ['function resolver(bytes32 node) view returns (address)'];
    const RESOLVER_ABI = ['function name(bytes32 node) view returns (string)'];
    const ENS_MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
    const MULTICALL_ABI = [
      'function aggregate((address target, bytes callData)[] calldata calls) external payable returns (uint256 blockNumber, bytes[] memory returnData)'
    ];
    const ENS_PROVIDER = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com');
    try {
      // Batch cache for ENS
      const ensBatchKey = `ens_batch_${crypto.createHash('md5').update(addressesWithoutNametag.join(',')).digest('hex')}`;
      const cachedEns = await redisClient.get(ensBatchKey);
      if (cachedEns) {
        const parsedEns = JSON.parse(cachedEns);
        Object.assign(cachedNametags, parsedEns);
        logger.info(`ENS batch cache hit for ${addressesWithoutNametag.length} addresses`);
      } else {
        const reverseNodes = addressesWithoutNametag.map((addr) => ethers.namehash(`${addr.slice(2).toLowerCase()}.addr.reverse`));
        const registryInterface = new ethers.Interface(REGISTRY_ABI);
        const resolverInterface = new ethers.Interface(RESOLVER_ABI);
        const multicallContract = new ethers.Contract(ENS_MULTICALL_ADDRESS, MULTICALL_ABI, ENS_PROVIDER);
        const BATCH_SIZE = 10; // Smaller batches for speed
        const resolvers = [];
        for (let batchStart = 0; batchStart < reverseNodes.length; batchStart += BATCH_SIZE) {
          const batchNodes = reverseNodes.slice(batchStart, batchStart + BATCH_SIZE);
          const resolverCalls = batchNodes.map((node) => ({
            target: ENS_REGISTRY,
            callData: registryInterface.encodeFunctionData('resolver', [node]),
          }));
          // Timeout for multicall
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s per batch
          try {
            const { returnData: resolverReturnData } = await multicallContract.aggregate.staticCall(resolverCalls, { signal: controller.signal });
            const batchResolvers = resolverReturnData.map((data) => {
              try {
                return ethers.AbiCoder.defaultAbiCoder().decode(['address'], data)[0];
              } catch {
                return ethers.ZeroAddress;
              }
            });
            resolvers.push(...batchResolvers);
          } catch (err) {
            if (err.name === 'AbortError') logger.warn('ENS multicall timeout');
            else logger.error(`ENS resolver error: ${err.message}`);
          }
          clearTimeout(timeoutId);
        }
        const validIndices = resolvers
          .map((resolver, index) => (resolver !== ethers.ZeroAddress ? index : -1))
          .filter((index) => index !== -1);
        if (validIndices.length > 0) {
          const names = [];
          for (let batchStart = 0; batchStart < validIndices.length; batchStart += BATCH_SIZE) {
            const batchIndices = validIndices.slice(batchStart, batchStart + BATCH_SIZE);
            const nameCalls = batchIndices.map((index) => ({
              target: resolvers[index],
              callData: resolverInterface.encodeFunctionData('name', [reverseNodes[index]]),
            }));
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
              const { returnData: nameReturnData } = await multicallContract.aggregate.staticCall(nameCalls, { signal: controller.signal });
              const batchNames = nameReturnData.map((data) => {
                try {
                  return ethers.AbiCoder.defaultAbiCoder().decode(['string'], data)[0];
                } catch {
                  return '';
                }
              });
              names.push(...batchNames);
            } catch (err) {
              if (err.name === 'AbortError') logger.warn('ENS name timeout');
              else logger.error(`ENS name error: ${err.message}`);
            }
            clearTimeout(timeoutId);
          }
          const ensResults = {};
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
                    timeout: 3000, // Faster timeout
                  }
                );
                const coin = cgResponse.data.coins?.[0];
                if (coin?.thumb) image = coin.thumb;
              } catch (cgError) {
                logger.error(`Failed to fetch CoinGecko image for ENS ${shortName}:`, cgError.message);
              }
              const ensNametag = { name, image, description: '', subcategory: 'ENS' };
              ensResults[address] = ensNametag;
              await redisClient.setEx(`nametag_${address}`, 30 * 24 * 60 * 60, JSON.stringify({ address, ...ensNametag }));
              await query(
                `INSERT INTO nametags (address, nametag, image, description, subcategory)
                 VALUES (LOWER($1), $2, $3, $4, $5)
                 ON CONFLICT (address)
                 DO UPDATE SET
                 nametag = $2, image = $3, description = $4, subcategory = $5`,
                [address.toLowerCase(), name, image, '', 'ENS']
              );
              logger.info(`Saved ENS ${name} for address ${address} to database`);
            }
          }
          // Cache batch ENS
          await redisClient.setEx(ensBatchKey, 30 * 24 * 60 * 60, JSON.stringify(ensResults));
          Object.assign(cachedNametags, ensResults);
        }
      }
    } catch (ensError) {
      logger.error(`Failed to fetch ENS via multicall for batch: ${ensError.message} - Full error:`, ensError);
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
  logger.info(`getNametagsBatch took ${(Date.now() - start) / 1000}s for ${uniqueAddresses.length} addresses`);
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

async function getTokenSymbolsBatch(baseUrl, contractAddresses) {
  const redisClient = await getRedisClient();
  const symbols = {};
  const uncachedContracts = [];
  for (const contract of contractAddresses) {
    const cacheKey = `token_symbol_${contract.toLowerCase()}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      symbols[contract.toLowerCase()] = cached;
    } else {
      uncachedContracts.push(contract);
    }
  }
  if (uncachedContracts.length === 0) return symbols;
  // Batch eth_call using Alchemy batch JSON-RPC
  const batchPayloads = uncachedContracts.map((contract, index) => ({
    jsonrpc: "2.0",
    id: index,
    method: "eth_call",
    params: [{ to: contract, data: "0x95d89b41" }, "latest"], // symbol() selector
  }));
  try {
    const abi = ["function symbol() view returns (string)"];
    const iface = new ethers.Interface(abi);
    const response = await axios.post(baseUrl, batchPayloads);
    for (const [index, res] of Object.entries(response.data)) {
      if (res.result) {
        const symbol = iface.decodeFunctionResult("symbol", res.result)[0];
        const contract = uncachedContracts[index];
        symbols[contract.toLowerCase()] = symbol;
        await redisClient.setEx(`token_symbol_${contract.toLowerCase()}`, 30 * 24 * 60 * 60, symbol);
      }
    }
  } catch (error) {
    logger.error(`Failed to batch fetch symbols:`, error.message);
    // Fallback to individual fetches if batch fails
    const symbolPromises = uncachedContracts.map(async (contract) => {
      try {
        const abi = ["function symbol() view returns (string)"];
        const iface = new ethers.Interface(abi);
        const data = iface.encodeFunctionData("symbol", []);
        const payload = {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: contract, data }, "latest"],
        };
        const response = await axios.post(baseUrl, payload);
        if (response.data.result) {
          const symbol = iface.decodeFunctionResult("symbol", response.data.result)[0];
          symbols[contract.toLowerCase()] = symbol;
          await redisClient.setEx(`token_symbol_${contract.toLowerCase()}`, 30 * 24 * 60 * 60, symbol);
        }
      } catch {
        symbols[contract.toLowerCase()] = 'ERC20';
      }
    });
    await Promise.all(symbolPromises);
  }
  return symbols;
}

async function fetchLayer3Transactions(layer2Addresses, chain, limit, page) {
  const start = Date.now();
  const transactions = [];
  const chainConfig = SUPPORTED_CHAINS[chain];
  if (!chainConfig.apiUrl && !alchemyNetworks[chain]) return transactions;
  const layer2Nametags = await getNametagsBatch(layer2Addresses);
  const validLayer2Addresses = layer2Addresses.filter(
    (addr) => layer2Nametags[addr.toLowerCase()]?.name !== 'Unknown'
  ).slice(0, 10);
  logger.info(`Fetching Layer 3 transactions for ${validLayer2Addresses.length} valid Layer 2 addresses (limited)`);
  const layer3Limit = 20;
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
        let txData = [];
        if (alchemyNetworks[chain]) {
          const network = alchemyNetworks[chain];
          const baseUrl = `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
          // Parallel outgoing and incoming
          const [resOut, resIn] = await Promise.all([
            axios.post(baseUrl, {
              jsonrpc: "2.0",
              id: 0,
              method: "alchemy_getAssetTransfers",
              params: [{
                fromBlock: "0x0",
                toBlock: "latest",
                fromAddress: address,
                excludeZeroValue: true,
                maxCount: `0x${layer3Limit.toString(16)}`,
                category: ["external", "internal", "erc20"],
                withMetadata: true,
                order: "desc",
              }]
            }),
            axios.post(baseUrl, {
              jsonrpc: "2.0",
              id: 1,
              method: "alchemy_getAssetTransfers",
              params: [{
                fromBlock: "0x0",
                toBlock: "latest",
                toAddress: address,
                excludeZeroValue: true,
                maxCount: `0x${layer3Limit.toString(16)}`,
                category: ["external", "internal", "erc20"],
                withMetadata: true,
                order: "desc",
              }]
            })
          ]);
          txData.push(...(resOut.data.result.transfers || []).map(t => ({ ...t, type: 'outgoing', fromAddress: address })));
          txData.push(...(resIn.data.result.transfers || []).map(t => ({ ...t, type: 'incoming', fromAddress: address })));
        } else {
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
            txData = JSON.parse(cached).map(tx => ({ ...tx, fromAddress: address }));
          } else {
            const response = await fetchWithRateLimit(apiUrl, { timeout: 10000 });
            txData = response.data.result || response.data.transactions || response.data || [];
            await redisClient.setEx(cacheKey, 3600, JSON.stringify(txData));
            txData = txData.map(tx => ({ ...tx, fromAddress: address }));
          }
        }
        return txData;
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

  const uniqueContracts = [...new Set(allRawTxs
    .filter(tx => tx.rawContract?.address && isAddress(tx.rawContract.address))
    .map(tx => tx.rawContract.address.toLowerCase())
  )];
  let tokenPrices = {};
  if (uniqueContracts.length > 0 && alchemyNetworks[chain]) {
    tokenPrices = await getTokenCurrentPriceBatch(chainIdToName[chain], uniqueContracts);
  }

  const txPromises = allRawTxs.map(async (tx) => {
    let value = '0';
    let tokenSymbol = chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase();
    let contractAddress = null;
    let tokenImage = '/icons/default.webp';
    let blockTime;
    let usdValue = 0;
    let decimals = 18;
    let isTokenTransfer = false;
    if (alchemyNetworks[chain]) {
      if (tx.category === 'erc20' || tx.category === 'erc721' || tx.category === 'erc1155') {
        isTokenTransfer = true;
        decimals = tx.rawContract?.decimal ? parseInt(tx.rawContract.decimal, 16) : 18;
        value = safeFormatUnits(tx.rawContract?.value, decimals);
        tokenSymbol = tx.asset || (tx.rawContract?.address ? 'ERC20' : tokenSymbol);
        contractAddress = tx.rawContract?.address || null;
      } else {
        value = safeFormatEther(tx.value);
      }
      blockTime = tx.metadata.blockTimestamp;
      if (contractAddress) {
        tokenImage = await getTokenImage(contractAddress, chain);
        const price = tokenPrices[contractAddress.toLowerCase()]?.usd || 0; // Fallback 0 nếu miss
        usdValue = parseFloat(value) * price;
      } else {
        usdValue = parseFloat(value) * nativePrice;
      }
      if (isTokenTransfer && parseFloat(value) === 0) return null;
      const address = tx.type === 'outgoing' ? tx.to : tx.from;
      return {
        address,
        hash: tx.hash,
        value,
        usdValue: usdValue.toFixed(6),
        tokenSymbol,
        contractAddress,
        tokenImage,
        block_time: blockTime,
        type: tx.type,
        layer2Address: tx.fromAddress,
      };
    } else {
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
        value = (tx.value / 1e8).toString();
        tokenSymbol = 'BTC';
        usdValue = Number(value) * nativePrice;
        const address = tx.type === 'incoming' ? tx.vin[0].prevout.scriptpubkey_address : tx.vout[0].scriptpubkey_address;
        return {
          address,
          hash: tx.txid,
          value,
          usdValue: usdValue.toFixed(6),
          tokenSymbol,
          contractAddress,
          tokenImage,
          block_time: blockTime,
          type: tx.type,
          layer2Address: tx.fromAddress,
        };
      } else {
        value = safeFormatEther(parseInt(tx.value));
        if (parseFloat(value) === 0) return null;
        blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
      }
      if (!blockTime) return null;
      usdValue = Number(value) * nativePrice;
      const address = tx.from === tx.fromAddress ? tx.to : tx.from;
      const type = tx.from === tx.fromAddress ? 'outgoing' : 'incoming';
      return {
        address,
        hash: tx.hash || tx.transactionHash,
        value,
        usdValue: usdValue.toFixed(6),
        tokenSymbol,
        contractAddress,
        tokenImage,
        block_time: blockTime,
        type,
        layer2Address: tx.fromAddress,
      };
    }
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
  logger.info(`fetchLayer3Transactions took ${(Date.now() - start) / 1000}s`);
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
    const { wallet_address, chain, limit, page, fetchLayer3: inputFetchLayer3 } = parsed.data;
    const address = wallet_address.toLowerCase();
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
    const cacheKey = `tx_${chain}_${address}_${page}_${limit}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for ${cacheKey}`);
      return NextResponse.json(JSON.parse(cached), { headers: securityHeaders });
    }
    let isTokenQuery = false;
    let tokenSymbol = 'UNKNOWN';
    let tokenImage = '/icons/default.webp';
    let fetchLayer3 = inputFetchLayer3;
    if (alchemyNetworks[chain]) {
      const network = alchemyNetworks[chain];
      const baseUrl = `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
      const codePayload = {
        jsonrpc: "2.0",
        id: 0,
        method: "eth_getCode",
        params: [address, "latest"]
      };
      const codeRes = await axios.post(baseUrl, codePayload);
      const code = codeRes.data.result;
      if (code && code !== '0x') {
        isTokenQuery = true;
        fetchLayer3 = true; // ALWAYS fetch layer3 for token queries (most activity is L2/L3)
        // Get token symbol
        const symbols = await getTokenSymbolsBatch(baseUrl, [address]);
        tokenSymbol = symbols[address] || 'ERC20';
        tokenImage = await getTokenImage(address, chain);
      }
    }
    if (isTokenQuery) {
      const network = alchemyNetworks[chain];
      const baseUrl = `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
      const chainLogo = await getChainLogo(chainConfig.coingeckoId);
      const addresses = new Set();
      const resToken = await axios.post(baseUrl, {
        jsonrpc: "2.0",
        id: 0,
        method: "alchemy_getAssetTransfers",
        params: [{
          fromBlock: "0x0",
          toBlock: "latest",
          contractAddresses: [address],
          excludeZeroValue: true,
          maxCount: `0x${limit.toString(16)}`,
          category: ["erc20"],
          withMetadata: true,
          order: "desc",
        }]
      });
      if (resToken.data.error) throw new Error(resToken.data.error.message);
      const transfers = resToken.data.result.transfers || [];
      const newPageKey = resToken.data.result.pageKey;
      if (newPageKey && page === 1) {
        await redisClient.setEx(`pagekey_token_latest_${chain}_${address}`, 3600, newPageKey);
      }
      let continuationPageKey = null;
      if (page > 1) {
        continuationPageKey = await redisClient.get(`pagekey_token_latest_${chain}_${address}`);
        if (continuationPageKey) {
          // Gọi lại lần nữa với pageKey để lấy trang cũ hơn
          const resContinue = await axios.post(baseUrl, {
            jsonrpc: "2.0",
            id: 0,
            method: "alchemy_getAssetTransfers",
            params: [{
              fromBlock: "0x0",
              toBlock: "latest",
              contractAddresses: [address],
              excludeZeroValue: true,
              maxCount: `0x${limit.toString(16)}`,
              category: ["erc20"],
              withMetadata: true,
              order: "desc",
              pageKey: continuationPageKey,
            }]
          });
          transfers.length = 0; // xóa dữ liệu cũ
          transfers.push(...(resContinue.data.result.transfers || []));
          // Cập nhật pageKey mới nhất cho lần tiếp theo
          if (resContinue.data.result.pageKey) {
            await redisClient.setEx(`pagekey_token_latest_${chain}_${address}`, 3600, resContinue.data.result.pageKey);
          } else {
            await redisClient.del(`pagekey_token_latest_${chain}_${address}`); // hết dữ liệu
          }
        }
      }
      const tokenPrice = await getTokenCurrentPrice(chainIdToName[chain], address);
      const tokenTransfers = [];
      for (const transfer of transfers) {
        const decimals = transfer.rawContract?.decimal ? parseInt(transfer.rawContract.decimal, 16) : 18;
        let value = safeFormatUnits(transfer.rawContract?.value, decimals);
        if (parseFloat(value) === 0) continue;
        const block_time = transfer.metadata.blockTimestamp;
        const usdValue = parseFloat(value) * tokenPrice;
        const tx = {
          from: transfer.from.toLowerCase(),
          to: transfer.to.toLowerCase(),
          address: transfer.to.toLowerCase(),
          hash: transfer.hash,
          value,
          usdValue: usdValue.toFixed(6),
          tokenSymbol: transfer.asset || tokenSymbol,
          contractAddress: address,
          tokenImage,
          block_time,
          method: 'Transfer',
          type: 'outgoing',
          layer2Address: transfer.from.toLowerCase(),
          // thêm source/target để graph worker vẽ đúng
          source: transfer.from.toLowerCase(),
          target: transfer.to.toLowerCase(),
        };
        tokenTransfers.push(tx);
        addresses.add(transfer.from.toLowerCase());
        addresses.add(transfer.to.toLowerCase());
      }
      // Thêm chính token address vào (làm root node)
      addresses.add(address);
      // Lấy nametag cho tất cả address (không lọc Unknown)
      const nametags = await getNametagsBatch([...addresses]);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const uniqueWallets = [...new Set(tokenTransfers.flatMap(tx => [tx.from, tx.to]))];
      const dummyLayer2 = []; // Không sử dụng dummy để tránh kết nối root, tập trung vào layer2 và layer3
      const processedDummyLayer2 = dummyLayer2.map((tx) => ({
        ...tx,
        nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
        image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.webp',
        chainLogo,
      }));
      // Các token transfers thực tế sẽ là layer3 (giao dịch giữa các layer2 wallets)
      const layer3Transactions = tokenTransfers.map((tx) => ({
        ...tx,
        nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
        image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.webp',
        nametagLayer2: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
        imageLayer2: nametags[tx.from.toLowerCase()]?.image || '/icons/default.webp',
        chainLogo,
      }));
      // Thông tin root (token contract)
      const walletNametag = {
        name: `${tokenSymbol} Token`,
        image: tokenImage,
        description: 'ERC20 Token Contract',
        subcategory: 'Token',
      };
      const result = {
        incoming: [],
        outgoing: processedDummyLayer2, // Dummy connections as layer2
        layer3: layer3Transactions, // Actual token transfers as layer3 between wallets
        wallet: {
          address,
          nametag: walletNametag.name,
          image: walletNametag.image,
          chainLogo,
        },
      };
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result));
      return NextResponse.json(result, { headers: securityHeaders });
    }
    else {
      let incoming = [];
      let outgoing = [];
      let nativePrice = await getCurrentPrice(chainConfig.coingeckoId);
      let tokenPrices = {};
      const addresses = new Set();
      let layer3Transactions = [];
      let walletNametag;
      let chainLogo = await getChainLogo(chainConfig.coingeckoId);
      // Reduced limit for wallet query
      const walletLimit = Math.min(50, limit);
      // Original wallet logic
      if (alchemyNetworks[chain]) {
        const network = alchemyNetworks[chain];
        const baseUrl = `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
        // Parallel outgoing and incoming fetches
        let outPageKey = null;
        if (page > 1) {
          outPageKey = await redisClient.get(`pagekey_out_${chain}_${address}_${page - 1}`);
        }
        let inPageKey = null;
        if (page > 1) {
          inPageKey = await redisClient.get(`pagekey_in_${chain}_${address}_${page - 1}`);
        }
        const [resOut, resIn] = await Promise.all([
          axios.post(baseUrl, {
            jsonrpc: "2.0",
            id: 0,
            method: "alchemy_getAssetTransfers",
            params: [{
              fromBlock: "0x0",
              toBlock: "latest",
              fromAddress: address,
              excludeZeroValue: true,
              maxCount: `0x${walletLimit.toString(16)}`,
              category: ["external", "internal", "erc20"],
              withMetadata: true,
              order: "desc",
              ...(outPageKey ? { pageKey: outPageKey } : {}),
            }]
          }),
          axios.post(baseUrl, {
            jsonrpc: "2.0",
            id: 1,
            method: "alchemy_getAssetTransfers",
            params: [{
              fromBlock: "0x0",
              toBlock: "latest",
              toAddress: address,
              excludeZeroValue: true,
              maxCount: `0x${walletLimit.toString(16)}`,
              category: ["external", "internal", "erc20"],
              withMetadata: true,
              order: "desc",
              ...(inPageKey ? { pageKey: inPageKey } : {}),
            }]
          })
        ]);
        if (resOut.data.error) throw new Error(resOut.data.error.message);
        if (resIn.data.error) throw new Error(resIn.data.error.message);
        const transfersOut = resOut.data.result.transfers || [];
        const newPageKeyOut = resOut.data.result.pageKey;
        if (newPageKeyOut) await redisClient.setEx(`pagekey_out_${chain}_${address}_${page}`, 3600, newPageKeyOut);
        const transfersIn = resIn.data.result.transfers || [];
        const newPageKeyIn = resIn.data.result.pageKey;
        if (newPageKeyIn) await redisClient.setEx(`pagekey_in_${chain}_${address}_${page}`, 3600, newPageKeyIn);
        // Collect unique contracts for batch processing
        const allTransfers = [...transfersOut, ...transfersIn];
        const uniqueContracts = [...new Set(allTransfers
          .filter(t => t.rawContract?.address)
          .map(t => t.rawContract.address)
          .filter(isAddress)
        )];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const symbolsNeedingFetch = uniqueContracts.filter(c => !allTransfers.some(t => t.asset));
        let tokenSymbols = {};
        if (symbolsNeedingFetch.length > 0) {
          tokenSymbols = await getTokenSymbolsBatch(baseUrl, symbolsNeedingFetch);
        }
        if (uniqueContracts.length > 0) {
          tokenPrices = await getTokenCurrentPriceBatch(chainIdToName[chain], uniqueContracts);
        }
        const imagePromises = uniqueContracts.map(async (contract) => {
          const image = await getTokenImage(contract, chain);
          return { contract: contract.toLowerCase(), image };
        });
        const tokenImages = Object.fromEntries((await Promise.all(imagePromises)).map(({ contract, image }) => [contract, image]));
        // Process outgoing
        for (const transfer of transfersOut) {
          let value, tokenSymbolLocal, contractAddressLocal, decimalsLocal = 18;
          if (transfer.category === 'erc20' || transfer.category === 'erc721' || transfer.category === 'erc1155') {
            decimalsLocal = transfer.rawContract?.decimal ? parseInt(transfer.rawContract.decimal, 16) : 18;
            value = safeFormatUnits(transfer.rawContract?.value, decimalsLocal);
            tokenSymbolLocal = transfer.asset || tokenSymbols[transfer.rawContract?.address?.toLowerCase()] || 'UNKNOWN';
            contractAddressLocal = transfer.rawContract?.address;
          } else {
            value = safeFormatEther(transfer.value);
            tokenSymbolLocal = chain === '1' ? 'ETH' : chainConfig.name.toUpperCase();
            contractAddressLocal = null;
          }
          if (parseFloat(value) === 0 && contractAddressLocal) continue;
          let tokenImageLocal = contractAddressLocal ? tokenImages[contractAddressLocal.toLowerCase()] || '/icons/default.webp' : '/icons/default.webp';
          let usdValue = 0;
          if (contractAddressLocal) {
            const price = tokenPrices[contractAddressLocal.toLowerCase()]?.usd || await getTokenCurrentPrice(chainIdToName[chain], contractAddressLocal);
            usdValue = parseFloat(value) * price;
          } else {
            usdValue = parseFloat(value) * nativePrice;
          }
          const block_time = transfer.metadata.blockTimestamp;
          outgoing.push({
            address: transfer.to.toLowerCase(),
            hash: transfer.hash,
            value,
            usdValue: usdValue.toFixed(6),
            tokenSymbol: tokenSymbolLocal,
            contractAddress: contractAddressLocal,
            tokenImage: tokenImageLocal,
            block_time,
            type: 'outgoing',
            method: transfer.category === 'erc20' ? 'Transfer' : undefined,
          });
          addresses.add(transfer.to.toLowerCase());
        }
        // Process incoming
        for (const transfer of transfersIn) {
          let value, tokenSymbolLocal, contractAddressLocal, decimalsLocal = 18;
          if (transfer.category === 'erc20' || transfer.category === 'erc721' || transfer.category === 'erc1155') {
            decimalsLocal = transfer.rawContract?.decimal ? parseInt(transfer.rawContract.decimal, 16) : 18;
            value = safeFormatUnits(transfer.rawContract?.value, decimalsLocal);
            tokenSymbolLocal = transfer.asset || tokenSymbols[transfer.rawContract?.address?.toLowerCase()] || 'UNKNOWN';
            contractAddressLocal = transfer.rawContract?.address;
          } else {
            value = safeFormatEther(transfer.value);
            tokenSymbolLocal = chain === '1' ? 'ETH' : chainConfig.name.toUpperCase();
            contractAddressLocal = null;
          }
          if (parseFloat(value) === 0 && contractAddressLocal) continue;
          let tokenImageLocal = contractAddressLocal ? tokenImages[contractAddressLocal.toLowerCase()] || '/icons/default.webp' : '/icons/default.webp';
          let usdValue = 0;
          if (contractAddressLocal) {
            const price = tokenPrices[contractAddressLocal.toLowerCase()]?.usd || await getTokenCurrentPrice(chainIdToName[chain], contractAddressLocal);
            usdValue = parseFloat(value) * price;
          } else {
            usdValue = parseFloat(value) * nativePrice;
          }
          const block_time = transfer.metadata.blockTimestamp;
          incoming.push({
            address: transfer.from.toLowerCase(),
            hash: transfer.hash,
            value,
            usdValue: usdValue.toFixed(6),
            tokenSymbol: tokenSymbolLocal,
            contractAddress: contractAddressLocal,
            tokenImage: tokenImageLocal,
            block_time,
            type: 'incoming',
            method: transfer.category === 'erc20' ? 'Transfer' : undefined,
          });
          addresses.add(transfer.from.toLowerCase());
        }
      } else {
        // Original fetching logic for non-Alchemy chains
        const fetchPromises = [];
        let apiUrl;
        let internalData = [];
        const walletLimitNonAlchemy = Math.min(50, limit);
        if (chain === 'solana') {
          apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${address}&limit=${walletLimitNonAlchemy}&offset=${(page - 1) * walletLimitNonAlchemy}`;
          fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({ type: 'native', data: res.data.transactions || [] })));
        } else if (chain === 'tron') {
          apiUrl = `${chainConfig.apiUrl}/transaction?address=${address}&limit=${walletLimitNonAlchemy}&start=${(page - 1) * walletLimitNonAlchemy}`;
          fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({ type: 'native', data: res.data.transactions || [] })));
        } else if (chain === 'bitcoin') {
          apiUrl = `${chainConfig.apiUrl}/address/${address}/txs?limit=${walletLimitNonAlchemy}`;
          fetchPromises.push(fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({ type: 'native', data: res.data || [] })));
        } else {
          const endpoints = [
            { action: 'txlist', type: 'native' },
            { action: 'tokentx', type: 'token' },
            { action: 'txlistinternal', type: 'internal' }
          ];
          endpoints.forEach(({ action, type }) => {
            fetchPromises.push(
              (async () => {
                const cacheKey = `api_${chain}_${address}_${action}_${page}_${walletLimitNonAlchemy}`;
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                  logger.info(`API cache hit for ${cacheKey}`);
                  return { type, data: JSON.parse(cached) };
                }
                const url = `${chainConfig.apiUrl}?module=account&action=${action}&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${walletLimitNonAlchemy}&sort=desc&chainid=${chain}&apikey=${chainConfig.apiKey}`;
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
        if (chain !== 'solana' && chain !== 'tron' && chain !== 'bitcoin') {
          const uniqueContracts = [...new Set(tokenTransactions
            .map(tx => tx.contractAddress)
            .filter(isAddress)
          )];
          if (uniqueContracts.length > 0) {
            const platform = chainIdToName[chain];
            const contractList = uniqueContracts.join(',');
            const cacheKey = `token_prices_${platform}_${contractList}_${page}_${walletLimitNonAlchemy}`;
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
            const receivedVouts = tx.vout ? tx.vout.filter(v => v.scriptpubkey_address?.toLowerCase() === address) : [];
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
            const spentVins = tx.vin ? tx.vin.filter(v => v.prevout && v.prevout.scriptpubkey_address?.toLowerCase() === address) : [];
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
              value = safeFormatEther(tx.value);
              blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
            }
            if (!blockTime) {
              logger.warn(`Missing or invalid block_time for tx ${tx.hash || tx.transactionHash} from address ${address}`);
              return null;
            }
            if (parseFloat(value) === 0) return null;
            usdValue = Number(value) * nativePrice;
            return {
              address: tx.from === address ? tx.to : tx.from,
              hash: tx.hash || tx.transactionHash,
              value,
              usdValue: usdValue.toFixed(6),
              tokenSymbol,
              contractAddress,
              tokenImage,
              block_time: blockTime,
              type: tx.from === address ? 'outgoing' : 'incoming',
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
              let value = safeFormatEther(itx.value);
              let tokenSymbol = chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase();
              let contractAddress = null;
              let tokenImage = '/icons/default.webp';
              let blockTime = itx.timeStamp ? new Date(parseInt(itx.timeStamp) * 1000).toISOString() : null;
              let usdValue = Number(value) * nativePrice;
              if (!blockTime) {
                logger.warn(`Missing or invalid block_time for internal tx ${itx.hash} from address ${address}`);
                return null;
              }
              const from = itx.from.toLowerCase();
              const to = itx.to.toLowerCase();
              const isOutgoing = from === address;
              const addressLocal = isOutgoing ? to : from;
              const type = isOutgoing ? 'outgoing' : 'incoming';
              return {
                address: addressLocal,
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
              logger.warn(`Missing or invalid block_time for token tx ${tx.hash} from address ${address}`);
              return null;
            }
            const price = tokenPrices[contractAddress.toLowerCase()]?.usd || await getTokenCurrentPrice(chainIdToName[chain], contractAddress);
            usdValue = Number(value) * price;
            return {
              address: tx.from === address ? tx.to : tx.from,
              hash: tx.hash,
              value,
              usdValue: usdValue.toFixed(6),
              tokenSymbol,
              contractAddress,
              tokenImage,
              block_time: blockTime,
              type: tx.from === address ? 'outgoing' : 'incoming',
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
      }
      if (fetchLayer3) {
        const layer2Addresses = [...new Set([...incoming, ...outgoing].map((tx) => tx.address.toLowerCase()))];
        layer3Transactions = await fetchLayer3Transactions(layer2Addresses, chain, limit, page);
      }
      const nametags = await getNametagsBatch([...addresses, address]);
      walletNametag = nametags[address] || {
        name: 'Unknown',
        image: '/icons/default.webp',
        description: '',
        subcategory: 'Others',
      };
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
      const result = {
        incoming: processedIncoming,
        outgoing: processedOutgoing,
        layer3: layer3Transactions,
        wallet: {
          address,
          nametag: walletNametag.name,
          image: walletNametag.image,
          chainLogo,
        },
      };
      // Auto-label & DB save...
      const allAddressesSet = new Set([...addresses, address]);
      const allAddresses = [...allAddressesSet];
      const unknownAddresses = allAddresses.filter(
        (addr) => !nametags?.[addr] || nametags[addr].name === 'Unknown'
      ).slice(0, 50);
      if (unknownAddresses.length > 0) {
        const mockNodes = unknownAddresses.map(addr => {
          const addrTxs = [...incoming, ...outgoing, ...layer3Transactions].filter(tx => tx.address.toLowerCase() === addr || (tx.layer2Address && tx.layer2Address.toLowerCase() === addr));
          const totalValue = addrTxs.reduce((sum, tx) => sum + parseFloat(tx.usdValue || 0), 0);
          const txCount = addrTxs.length;
          const uniqueTokens = new Set(addrTxs.map(tx => tx.tokenSymbol)).size;
          const velocity = txCount > 0 ? txCount / 30 : 0;
          return {
            id: addr,
            totalValue,
            txCount,
            degree: 1,
            uniqueTokens,
            velocity,
          };
        });
        const autoLabels = await autoLabelWallets(mockNodes);
        await saveAutoLabelsToDB(autoLabels);
        Object.entries(autoLabels).forEach(([addr, { label }]) => {
          if (!nametags[addr]) {
            nametags[addr] = { name: label, image: '/icons/default.webp', description: '', subcategory: 'ML Auto' };
          }
        });
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
        layer3Transactions.forEach(tx => {
          const ntagTo = nametags[tx.address.toLowerCase()];
          if (ntagTo) {
            tx.nametag = ntagTo.name;
            tx.image = ntagTo.image;
          }
          // Also update for layer2 if needed, but frontend uses source for from
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
        incoming: calculateServerRisk(result.incoming),
        outgoing: calculateServerRisk(result.outgoing),
        layer3: calculateServerRisk(result.layer3),
      };
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(resultWithRisk));
      return NextResponse.json(resultWithRisk, { headers: securityHeaders });
    }
  } catch (error) {
    logger.error('Error processing request:', error.message);
    await trackViolation(ip, error.message);
    return NextResponse.json({ error: error.message }, { status: 429, headers: securityHeaders });
  }
}