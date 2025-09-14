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

async function trackViolation(ip) {
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
const maxFailures = 10;
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
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 3,
  minTime: process.env.NODE_ENV === 'production' ? 1000 : 2000,
  reservoir: 30,
  reservoirRefreshAmount: 30,
  reservoirRefreshInterval: 60 * 1000,
});

axiosRetry(axios, {
  retries: 8,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 1000 + Math.random() * 200,
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED' || error.response?.status === 400,
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
  '10': { name: 'optimism', explorer: 'Optimistic Etherscan', apiUrl: 'https://api-optimistic.etherscan.io/api', apiKey: process.env.OPTIMISM_API_KEY, coingeckoId: 'optimism' },
  '130': { name: 'unichain', explorer: 'Unichain Explorer', apiUrl: '', apiKey: '', coingeckoId: '' },
  '137': { name: 'polygon', explorer: 'Polygonscan', apiUrl: 'https://api.polygonscan.com/api', apiKey: process.env.POLYGONSCAN_API_KEY, coingeckoId: 'polygon-pos' },
  '5000': { name: 'mantle', explorer: 'Mantle Explorer', apiUrl: 'https://explorer.mantle.xyz/api', apiKey: '', coingeckoId: 'mantle' },
  '42161': { name: 'arbitrum', explorer: 'Arbiscan', apiUrl: 'https://api.arbiscan.io/api', apiKey: process.env.ARBISCAN_API_KEY, coingeckoId: 'arbitrum-one' },
  '43114': { name: 'avalanche', explorer: 'SnowTrace', apiUrl: 'https://api.snowtrace.io/api', apiKey: process.env.SNOWTRACE_API_KEY, coingeckoId: 'avalanche' },
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
  limit: z.number().int().min(100).max(500, 'Limit must be between 100 and 500'),
  page: z.number().int().min(1).default(1),
  fetchLayer3: z.boolean().optional().default(false),
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

async function getNametagsBatch(addresses, chain) {
  const uniqueAddresses = [...new Set(addresses.map((addr) => addr.toLowerCase()).filter(isAddress))];
  const nametags = {};
  if (uniqueAddresses.length === 0) return nametags;

  const redisClient = await getRedisClient();
  const moralisApiKey = process.env.MORALIS_API_KEY;
  const moralisBaseUrl = 'https://deep-index.moralis.io/api/v2.2';

  try {
    // Fetch nametags from database
    const result = await query(
      `SELECT address, nametag, image, description, subcategory FROM nametags WHERE address = ANY($1)`,
      [uniqueAddresses]
    );

    for (const row of result.rows) {
      const address = row.address.toLowerCase();
      let image = row.image;
      let isValidImage = image && image !== '/icons/uniswap.webp';

      if (isValidImage) {
        try {
          const imageUrl = image.startsWith('http') ? image : `${process.env.NEXT_PUBLIC_APP_URL}${image}`;
          await axios.head(imageUrl, { timeout: 5000 });
        } catch {
          logger.warn(`Invalid image for address ${address}: ${image}`);
          isValidImage = false;
        }
      }

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
            logger.error(`Failed to fetch CoinGecko image for ${shortName}:`, error.message);
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

    // Find addresses without valid nametags
    const addressesWithoutNametag = uniqueAddresses.filter(
      (addr) => !nametags[addr] || nametags[addr].name === 'Unknown'
    );

    if (addressesWithoutNametag.length > 0 && moralisApiKey && chainIdToName[chain] === 'ethereum') {
      // Fetch ENS names from Moralis (only for Ethereum)
      for (const address of addressesWithoutNametag) {
        try {
          if (!isAddress(address)) {
            logger.warn(`Skipping invalid address for Moralis ENS API: ${address}`);
            nametags[address] = {
              address,
              name: 'Unknown',
              image: '/icons/default.webp',
              description: '',
              subcategory: 'Others',
            };
            continue;
          }

          let name = 'Unknown';
          let image = '/icons/default.webp';
          const cacheKey = `ens_nametag_${address}`;
          const cachedNametag = await redisClient.get(cacheKey);
          if (cachedNametag) {
            const parsed = JSON.parse(cachedNametag);
            name = parsed.name;
            image = parsed.image;
          } else {
            const response = await fetchWithRateLimit(
              `${moralisBaseUrl}/wallets/${address}/profiles`,
              {
                headers: { 'X-API-Key': moralisApiKey },
                timeout: 10000,
              }
            );
            const profiles = response.data.result;
            const ensProfile = profiles.find((p) => p.registry === 'ENS');
            if (ensProfile && ensProfile.name) {
              name = ensProfile.name;
              image = ensProfile.avatar || '/icons/default.webp';
              await redisClient.setEx(cacheKey, 24 * 60 * 60, JSON.stringify({ name, image }));
            }
          }

          nametags[address] = {
            address,
            name,
            image,
            description: '',
            subcategory: 'ENS',
          };
        } catch (error) {
          logger.error(`Failed to fetch ENS for ${address}:`, error.message);
          nametags[address] = {
            address,
            name: 'Unknown',
            image: '/icons/default.webp',
            description: '',
            subcategory: 'Others',
          };
        }
      }
    }

    // Set default nametags for addresses not found
    for (const address of uniqueAddresses) {
      if (!nametags[address]) {
        nametags[address] = {
          address,
          name: 'Unknown',
          image: '/icons/default.webp',
          description: '',
          subcategory: 'Others',
        };
      }
    }

    return nametags;
  } catch (error) {
    logger.error('Error fetching nametags:', error.message);
    return uniqueAddresses.reduce((acc, addr) => ({
      ...acc,
      [addr]: {
        address: addr,
        name: 'Unknown',
        image: '/icons/default.webp',
        description: '',
        subcategory: 'Others',
      },
    }), {});
  }
}

async function getTokenImage(tokenAddress, chain) {
  if (!tokenAddress || !isAddress(tokenAddress)) return '/icons/default.webp';
  const redisClient = await getRedisClient();
  const cacheKey = `token_image_${chain}_${tokenAddress.toLowerCase()}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await query(
      `SELECT image FROM tokens WHERE contract_address = $1 AND chain = $2`,
      [tokenAddress.toLowerCase(), chainIdToName[chain]]
    );
    if (response.rows.length > 0 && response.rows[0].image) {
      const image = response.rows[0].image;
      await redisClient.setEx(cacheKey, 24 * 60 * 60, image);
      return image;
    }

    const cgResponse = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/coins/${chainIdToName[chain]}/contract/${tokenAddress}`,
      {
        headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
        timeout: 15000,
      }
    );
    const image = cgResponse.data.image?.thumb || '/icons/default.webp';
    await redisClient.setEx(cacheKey, 24 * 60 * 60, image);
    return image;
  } catch {
    await redisClient.setEx(cacheKey, 24 * 60 * 60, '/icons/default.webp');
    return '/icons/default.webp';
  }
}

async function fetchLayer3Transactions(layer2Addresses, chain, limit, page) {
  const transactions = [];
  const chainConfig = SUPPORTED_CHAINS[chain];
  if (!chainConfig.apiUrl) return transactions;

  for (const address of layer2Addresses) {
    try {
      let apiUrl;
      if (chain === 'solana') {
        apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${address}&limit=${limit}&offset=${(page - 1) * limit}`;
      } else if (chain === 'tron') {
        apiUrl = `${chainConfig.apiUrl}/transaction?address=${address}&limit=${limit}&start=${(page - 1) * limit}`;
      } else {
        apiUrl = `${chainConfig.apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${limit}&sort=desc&apikey=${chainConfig.apiKey}`;
      }

      const response = await fetchWithRateLimit(apiUrl, { timeout: 30000 });
      let txData = response.data.result || response.data.transactions || [];

      if (!Array.isArray(txData)) txData = [];

      for (const tx of txData) {
        let value = '0';
        let tokenSymbol = chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase();
        let contractAddress = null;
        let tokenImage = '/icons/default.webp';
        let blockTime;

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
          if (tx.tokenSymbol) {
            tokenSymbol = tx.tokenSymbol;
            contractAddress = tx.contractAddress;
            tokenImage = await getTokenImage(contractAddress, chain);
          }
          blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
        }

        if (!blockTime) {
          logger.warn(`Missing or invalid block_time for tx ${tx.hash || tx.transactionHash} from address ${address}`);
          continue; // Skip transactions with invalid timestamps
        }

        transactions.push({
          address: tx.from === address.toLowerCase() ? tx.to : tx.from,
          hash: tx.hash || tx.transactionHash,
          value,
          tokenSymbol,
          contractAddress,
          tokenImage,
          block_time: blockTime,
          type: tx.from === address.toLowerCase() ? 'outgoing' : 'incoming',
          layer2Address: address,
        });
      }
    } catch (error) {
      logger.error(`Failed to fetch Layer 3 transactions for ${address}:`, error.message);
    }
  }

  // Fetch nametags for Layer 3 addresses
  const layer3Addresses = [...new Set(transactions.map((tx) => tx.address.toLowerCase()))];
  const layer3Nametags = await getNametagsBatch(layer3Addresses, chain);

  // Filter transactions to include only those with valid nametags
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
  const startTime = Date.now();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);

    if (!(await isAllowedOrigin(origin, referer))) {
      await trackViolation(ip, 'Invalid origin');
      return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      await trackViolation(ip, 'Invalid request body');
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { wallet_address, chain, limit, page, fetchLayer3 } = parsed.data;
    if (chain !== 'solana' && chain !== 'tron' && !isAddress(wallet_address)) {
      await trackViolation(ip, 'Invalid wallet address');
      return NextResponse.json({ error: 'Invalid wallet address.' }, { status: 400 });
    }

    const chainConfig = SUPPORTED_CHAINS[chain];
    const redisClient = await getRedisClient();
    const cacheKey = `tx_${chain}_${wallet_address}_${page}_${limit}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for ${cacheKey}`);
      return NextResponse.json(JSON.parse(cached), { headers: securityHeaders });
    }

    let apiUrl;
    if (chain === 'solana') {
      apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${wallet_address}&limit=${limit}&offset=${(page - 1) * limit}`;
    } else if (chain === 'tron') {
      apiUrl = `${chainConfig.apiUrl}/transaction?address=${wallet_address}&limit=${limit}&start=${(page - 1) * limit}`;
    } else {
      apiUrl = `${chainConfig.apiUrl}?module=account&action=txlist&address=${wallet_address}&startblock=0&endblock=99999999&page=${page}&offset=${limit}&sort=desc&apikey=${chainConfig.apiKey}`;
    }

    const response = await fetchWithRateLimit(apiUrl, { timeout: 30000 });
    let transactions = response.data.result || response.data.transactions || [];
    if (!Array.isArray(transactions)) transactions = [];

    const incoming = [];
    const outgoing = [];
    const addresses = new Set();

    for (const tx of transactions) {
      let value = '0';
      let tokenSymbol = chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase();
      let contractAddress = null;
      let tokenImage = '/icons/default.webp';
      let blockTime;

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
        if (tx.tokenSymbol) {
          tokenSymbol = tx.tokenSymbol;
          contractAddress = tx.contractAddress;
          tokenImage = await getTokenImage(contractAddress, chain);
        }
        blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null;
      }

      if (!blockTime) {
        logger.warn(`Missing or invalid block_time for tx ${tx.hash || tx.transactionHash} from address ${wallet_address}`);
        continue; // Skip transactions with invalid timestamps
      }

      const txData = {
        address: tx.from === wallet_address.toLowerCase() ? tx.to : tx.from,
        hash: tx.hash || tx.transactionHash,
        value,
        tokenSymbol,
        contractAddress,
        tokenImage,
        block_time: blockTime,
        type: tx.from === wallet_address.toLowerCase() ? 'outgoing' : 'incoming',
      };

      if (tx.from === wallet_address.toLowerCase()) {
        outgoing.push(txData);
        addresses.add(tx.to.toLowerCase());
      } else {
        incoming.push(txData);
        addresses.add(tx.from.toLowerCase());
      }
    }

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

    await redisClient.setEx(cacheKey, 3600, JSON.stringify(result));
    logger.info(`Request processed in ${Date.now() - startTime}ms`);

    return NextResponse.json(result, { headers: securityHeaders });
  } catch (error) {
    logger.error('Error processing request:', error.message);
    await trackViolation(ip, error.message);
    return NextResponse.json({ error: error.message }, { status: 429, headers: securityHeaders });
  }
}