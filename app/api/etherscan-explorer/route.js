// app/api/etherscan-explorer/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { isAddress } from 'ethers';
import { createClient } from 'redis';
import { ethers } from 'ethers';

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 10,
  minTime: 200,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config = {}) => {
  // Add abort signal for long timeouts
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout || 30000);
  config.signal = controller.signal;

  try {
    const response = await axios.get(url, config);
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
      logger.warn(`Request aborted/timeout for ${url}: ${error.message}`);
      throw new Error('Request timeout - please try again');
    }
    if (error.response?.status === 429) {
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
    logger.info('Redis connected for etherscan-explorer');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected for etherscan-explorer');
  }
  return redisClient;
}

// FIXED: CoinGecko platform map (same as CMC slugs) - Added more chains
const platformIdMap = {
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  arbitrum: 'arbitrum-one',
  optimism: 'optimism',
  polygon: 'polygon-pos',
  base: 'base',
  avalanche: 'avalanche',
  celo: 'celo',
  gnosis: 'gnosis',
  zksync: 'zksync-era',
  linea: 'linea',
  monad: 'monad',
  hyperevm: 'hyperevm',
};

// FIXED: Fetch token metadata/logo from CoinGecko by contract (batch via Promise.all)
async function fetchCoinGeckoInfo(chain, addresses) {
  if (addresses.length === 0) {
    logger.info('No addresses for CoinGecko fetch');
    return {};
  }

  const platform = platformIdMap[chain];
  if (!platform) {
    logger.warn(`Unsupported platform for CoinGecko: ${chain}`);
    return {};
  }

  const cgInfos = {};
  await Promise.all(addresses.map(async (addr) => {
    const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${addr}?localization=false&market_data=false`;
    try {
      const res = await fetchWithRateLimit(url, { timeout: 5000 });
      if (res.data.id) {
        const lowerAddr = addr.toLowerCase();
        cgInfos[lowerAddr] = {
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

// FIXED: Fetch prices from CoinGecko by contract addresses (batch support)
async function fetchCoinGeckoPrices(chain, addresses) {
  if (addresses.length === 0) {
    logger.info('No addresses for CoinGecko prices');
    return {};
  }

  const platform = platformIdMap[chain];
  if (!platform) {
    logger.warn(`Unsupported platform for CoinGecko prices: ${chain}`);
    return {};
  }

  const addressStr = addresses.join(',');
  const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${addressStr}&vs_currencies=usd`;
  try {
    const res = await fetchWithRateLimit(url, { timeout: 5000 });
    logger.info(`CoinGecko prices called for ${addresses.length} addresses on ${platform}`);
    const matchedCount = Object.keys(res.data).length;
    logger.info(`CoinGecko prices fetched for ${matchedCount} tokens on ${platform}`);
    return res.data;
  } catch (err) {
    logger.warn(`CoinGecko prices fetch failed for ${platform}: ${err.message}`);
    return {};
  }
}

// UPDATED: Fetch native price (keep CMC for accuracy) - Added more chains
async function fetchNativePrice(chain) {
  if (!process.env.COINMARKETCAP_API_KEY) {
    logger.info(`CMC key missing, skipping native price for ${chain}`);
    return null;
  }

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
    const res = await fetchWithRateLimit(url, config);
    if (res.data.status?.error_code === 0) {
      const price = res.data.data[nativeId]?.quote?.USD?.price || null;
      logger.info(`Native ${chain} price from CMC: ${price || 'N/A'} USD`);
      return price;
    }
  } catch (err) {
    logger.warn(`CMC native price failed for ${chain}: ${err.message}`);
  }
  return null;
}

// FIXED: Enrich tokens with CoinGecko (logo + price by contract, no key needed)
async function enrichWithCoinGecko(tokens) {
  if (tokens.length === 0) return tokens;
  const chain = tokens[0].chain;
  const uniqueAddrs = [...new Set(tokens.map(t => t.tokenAddress?.toLowerCase()).filter(Boolean))];
  logger.info(`Enriching ${tokens.length} tokens on ${chain} with CoinGecko`);

  const cgInfos = await fetchCoinGeckoInfo(chain, uniqueAddrs);
  const cgPrices = await fetchCoinGeckoPrices(chain, uniqueAddrs);

  return tokens.map(t => {
    const lowerAddr = t.tokenAddress?.toLowerCase();
    const cgInfo = cgInfos[lowerAddr];
    const cgPrice = cgPrices[lowerAddr]?.usd || null;
    const decimals = t.decimals || 18;
    const rawValue = BigInt(t.value || '0');
    const amount = Number(rawValue) / 10 ** decimals;
    const valueUSD = cgPrice ? amount * cgPrice : null;
    logger.info(`Enriched ${t.tokenAddress} on ${chain}: ${t.symbol || cgInfo?.symbol}, dec=${decimals}, amount=${amount.toFixed(6)}, USD=${valueUSD?.toFixed(2)}`);

    return {
      ...t,
      logo: cgInfo?.logo || `https://via.placeholder.com/16?text=${t.symbol || 'T'}`,
      priceUSD: cgPrice || null,
      valueUSD: valueUSD || null,
      name: cgInfo?.name || t.name,
      symbol: cgInfo?.symbol || t.symbol,
      amount: amount.toFixed(18), // Full precision
    };
  });
}

// Full chainIdMap (unchanged, added plasma map)
const chainIdMap = {
  ethereum: '1',
  ethereum_mainnet: '1',
  abstract: '2741',
  apechain: '33139',
  arbitrum: '42161',
  arbitrum_one: '42161',
  arbitrum_nova: '42170',
  avalanche: '43114',
  base: '8453',
  bnb: '56',
  bnb_smart_chain: '56',
  bsc: '56',
  celo: '42220',
  gnosis: '100',
  hyperevm: '999',
  linea: '59144',
  monad: '143',
  op: '10',
  optimism: '10',
  polygon: '137',
  matic: '137',
  scroll: '534352',
  sei: '1329',
  sonic: '146',
  unichain: '130',
  world: '480',
  zksync: '324',
};

// NEW: primaryChainNameMap - Map chainId (str) to primary chain name for parallel search
const primaryChainNameMap = {
  '1': 'ethereum',
  '2741': 'abstract',
  '33139': 'apechain',
  '42161': 'arbitrum',
  '42170': 'arbitrum_nova',
  '43114': 'avalanche',
  '8453': 'base',
  '56': 'bsc',
  '42220': 'celo',
  '100': 'gnosis',
  '999': 'hyperevm',
  '59144': 'linea',
  '143': 'monad',
  '10': 'optimism',
  '137': 'polygon',
  '534352': 'scroll',
  '1329': 'sei',
  '146': 'sonic',
  '130': 'unichain',
  '480': 'world',
  '324': 'zksync',
};

// Supported Etherscan chains (exclude new/unsupported like monad, hyperevm)
const supportedEtherscanChainIds = ['1', '42161', '137', '8453', '43114', '42220', '100', '59144', '130', '324'];

// Alchemy RPC map (same as frontend)
const rpcMap = {
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  optimism: `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  base: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  avalanche: `https://avax-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  celo: `https://celo-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  gnosis: `https://gnosis-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  zksync: `https://zksync-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  linea: `https://linea-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  bsc: `https://bnb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  abstract: `https://abstract-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  apechain: `https://apechain-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  hyperevm: `https://hyperliquid-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  monad: `https://monad-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  unichain: `https://linea-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  world: `https://worldchain-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
};

// NEW: Fetch token info using Alchemy provider
async function fetchTokenInfo(provider, tokenAddress) {
  const lowerAddr = tokenAddress.toLowerCase();
  const knownTokens = {
    '0x4200000000000000000000000000000000000006': { name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 }, // Base WETH
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { name: 'Coinbase Wrapped BTC', symbol: 'cbBTC', decimals: 8 }, // Base cbBTC
  };
  if (knownTokens[lowerAddr]) {
    logger.info(`Using known token info for ${lowerAddr}: ${knownTokens[lowerAddr].symbol}`);
    return knownTokens[lowerAddr];
  }

  const abi = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
  ];
  const contract = new ethers.Contract(tokenAddress, abi, provider);
  let info = { name: 'Unknown Token', symbol: 'UNK', decimals: 18 };

  try {
    info.name = await contract.name();
  } catch {
    logger.warn(`Failed to fetch name for ${tokenAddress}`);
  }
  try {
    info.symbol = (await contract.symbol()).toUpperCase();
  } catch {
    logger.warn(`Failed to fetch symbol for ${tokenAddress}`);
  }
  try {
    info.decimals = Number(await contract.decimals());
  } catch {
    logger.warn(`Failed to fetch decimals for ${tokenAddress}`);
  }

  logger.info(`Fetched token info for ${tokenAddress}: ${info.symbol} (${info.decimals} dec)`);
  return info;
}

// UPDATED: Verify candidate by receipt (primary) + fallback block timestamp
async function verifyTxOnChain(chainId, txHash, transaction) {
  const receiptUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
  try {
    const receiptRes = await fetchWithRateLimit(receiptUrl, { timeout: 30000 });
    logger.info(`Receipt verification on ${chainId}: status ${receiptRes.status}`);
    if (receiptRes.data.result) {
      const receipt = receiptRes.data.result;
      const numLogs = receipt.logs ? receipt.logs.length : 0;
      // FIXED: Accept if logs >0, even if status undefined (recent L2 tx)
      if (numLogs > 0) {
        const isSuccess = receipt.status === '0x1' || !receipt.status; // Assume success if no status but logs
        logger.info(`Receipt valid on ${chainId}: ${isSuccess ? 'success' : 'unknown status'}, ${numLogs} logs`);
        return { valid: true, numLogs, receipt, isSuccess };
      } else {
        logger.warn(`Receipt invalid on ${chainId}: logs ${numLogs}`);
      }
    }
  } catch (err) {
    logger.warn(`Receipt verification failed on ${chainId}: ${err.message}`);
  }

  // Fallback: Block timestamp recent
  if (transaction.blockNumber) {
    const blockUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getBlockByNumber&tag=${transaction.blockNumber}&boolean=true&apikey=${process.env.ETHERSCAN_API_KEY}`;
    try {
      const blockRes = await fetchWithRateLimit(blockUrl, { timeout: 30000 });
      if (blockRes.data.result) {
        const block = blockRes.data.result;
        const blockTime = parseInt(block.timestamp || '0', 16) * 1000;
        const now = Date.now();
        const isRecent = Math.abs(now - blockTime) < 3600000;
        if (isRecent) {
          logger.info(`Block timestamp valid on ${chainId}: recent`);
          return { valid: true, numLogs: 0, receipt: null, isSuccess: true };
        }
      }
    } catch (err) {
      logger.warn(`Block fallback failed on ${chainId}: ${err.message}`);
    }
  }

  return { valid: false, numLogs: 0, receipt: null, isSuccess: false };
}

// Allowed origins (unchanged)
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
  action: z.enum(['wallet-balances', 'token-balances', 'transactions', 'tx-details', 'address-overview', 'token-supply', 'token-info', 'token-transactions'], { message: 'Invalid action' }),
  chain: z.string().optional(),
  address: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Wallet address must be a valid EVM address' }),
  txHash: z.string().optional().refine((val) => !val || /^0x[a-f0-9]{64}$/.test(val), { message: 'Invalid transaction hash' }),
  tokenAddress: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Token address must be a valid EVM address' }),
  page: z.number().int().min(1).optional().default(1),
  offset: z.number().int().min(1).max(10000).optional().default(100),
}).refine(
  (data) => (['wallet-balances', 'token-balances', 'transactions', 'address-overview'].includes(data.action) ? !!data.address : true),
  { message: 'Wallet address is required for wallet-balances, token-balances, transactions, and address-overview', path: ['address'] }
).refine(
  (data) => (data.action === 'tx-details' ? !!data.txHash : true),
  { message: 'Transaction hash is required for tx-details', path: ['txHash'] }
).refine(
  (data) => !(['tx-details'].includes(data.action)) ? !!data.chain : true,
  { message: 'Chain is required for this action', path: ['chain'] }
).refine(
  (data) => (['token-supply', 'token-info', 'token-transactions'].includes(data.action) ? !!data.tokenAddress : true),
  { message: 'Token address is required for token-supply, token-info and token-transactions', path: ['tokenAddress'] }
);

// V2 unified base URL
const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';

// UPDATED: Helper to fetch token info via provider or fallback known tokens
async function fetchTokenInfoViaProvider(provider, tokenAddress, chainId) {
  if (provider) {
    return await fetchTokenInfo(provider, tokenAddress);
  }
  // Fallback to Etherscan eth_call if no provider
  const lowerAddr = tokenAddress.toLowerCase();
  const knownTokens = {
    '0x4200000000000000000000000000000000000006': { name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 }, // Base WETH
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { name: 'Coinbase Wrapped BTC', symbol: 'cbBTC', decimals: 8 }, // Base cbBTC
  };
  if (knownTokens[lowerAddr]) {
    logger.info(`Using known token info for ${lowerAddr}: ${knownTokens[lowerAddr].symbol}`);
    return knownTokens[lowerAddr];
  }

  const calls = [
    { selector: '0x06fdde03', key: 'name' },
    { selector: '0x95d89b41', key: 'symbol' },
    { selector: '0x313ce567', key: 'decimals' },
  ];
  let info = { name: 'Unknown', symbol: 'UNK', decimals: 18 };

  await Promise.all(calls.map(async (call) => {
    let callUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_call&to=${tokenAddress}&data=${call.selector}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
    try {
      const callRes = await fetchWithRateLimit(callUrl, { timeout: 20000 });
      if (callRes.data.result) {
        const result = callRes.data.result;
        if (call.key === 'decimals') {
          info[call.key] = parseInt(result, 16);
        } else {
          const lenHex = result.slice(66, 130);
          const len = parseInt(lenHex, 16);
          const dataHex = result.slice(130, 130 + len * 2);
          info[call.key] = Buffer.from(dataHex, 'hex').toString('utf8');
        }
      }
    } catch (err) {
      logger.warn(`Failed to fetch ${call.key} for token ${tokenAddress} on chain ${chainId}: ${err.message} - using fallback`);
    }
  }));
  logger.info(`Fetched token info for ${tokenAddress}: ${info.symbol} (${info.decimals} dec)`);
  return info;
}

// CORS wrapper (unchanged)
const handlerWrapper = (handler) =>
  limiterBottleneck.wrap(async (req) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    const startTime = Date.now();
    logger.info(`Request to /api/etherscan-explorer from IP ${ip}, Origin: ${origin || 'null'}, Referer: ${referer || 'null'}`);

    if (!isAllowedOrigin(origin, referer)) {
      return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
    }

    const res = await handler(req);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'POST');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Token');
    res.headers.set('Content-Security-Policy', "default-src 'self'");
    logger.info(`Response for /api/etherscan-explorer, time: ${Date.now() - startTime}ms`, { ip });
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

  const { chain, action, address, txHash, tokenAddress, page, offset } = parsedBody;
  const chainId = chainIdMap[chain?.toLowerCase()];
  if (!chainId && action !== 'tx-details') {
    logger.warn(`Unsupported chain for Etherscan V2: ${chain}`, { ip });
    return NextResponse.json({ detail: `Unsupported chain for Etherscan V2: ${chain}` }, { status: 400 });
  }

  logger.info(`Processing ${action} for chain ${chain} (ID: ${chainId})`, { ip, txHash: txHash?.slice(0, 10) + '...' });

  if (!process.env.ETHERSCAN_API_KEY) {
    logger.error('ETHERSCAN_API_KEY is not configured');
    return NextResponse.json({ detail: 'Server configuration error: Missing ETHERSCAN_API_KEY' }, { status: 500 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          let apiUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}`;
          let data = {};

          if (action === 'tx-details' && txHash) {
            const redis = await getRedisClient();
            const cacheKey = `explorer:tx:${chain}:${txHash.toLowerCase()}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
              data = JSON.parse(cached);
              logger.info(`Cache hit for tx-details: ${cacheKey}`);
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
              return;
            }

            let supportedChains;
            if (chain) {
              const lowerChain = chain.toLowerCase();
              const providedId = chainIdMap[lowerChain];
              if (!providedId) {
                throw new Error(`Unsupported chain: ${chain}`);
              }
              const providedName = primaryChainNameMap[providedId] || lowerChain;
              supportedChains = [[providedId, providedName]];
            } else {
              supportedChains = Object.entries(primaryChainNameMap);
            }
            const priorityOrder = ['1', '8453', '10', '42161', '56', '137'];
            const sortedChains = supportedChains.sort((a, b) => {
              const priA = priorityOrder.indexOf(a[0]);
              const priB = priorityOrder.indexOf(b[0]);
              return (priA === -1 ? Infinity : priA) - (priB === -1 ? Infinity : priB);
            });

            const isSupportedByEtherscan = supportedEtherscanChainIds.includes(chainId);
            if (!isSupportedByEtherscan && chain) {
              // Use Alchemy for unsupported chains like monad, hyperevm
              const rpcUrl = rpcMap[chain];
              if (!rpcUrl) throw new Error(`No RPC for ${chain}`);
              const provider = new ethers.JsonRpcProvider(rpcUrl);
              const tx = await provider.getTransaction(txHash);
              if (!tx) throw new Error('Transaction not found');
              const receipt = await provider.getTransactionReceipt(txHash);
              if (!receipt) throw new Error('No receipt');
              const block = await provider.getBlock(tx.blockNumber);
              data = {
                detectedChain: chain,
                transaction: tx,
                receipt,
                block,
                internalTxs: [], // Alchemy doesn't support internal txs easily, skip
                tokenTransfers: [],
              };
              // Parse logs for token transfers
              receipt.logs.forEach((log, logIndex) => {
                if (log.topics && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                  const from = `0x${log.topics[1].slice(-40)}`;
                  const to = `0x${log.topics[2].slice(-40)}`;
                  let transfer = {
                    tokenAddress: log.address.toLowerCase(),
                    from,
                    to,
                    logIndex,
                  };
                  if (log.topics.length === 3) {
                    // ERC-20
                    transfer.type = 'ERC20';
                    transfer.decimals = 18;
                    transfer.value = log.data === '0x' ? '0' : BigInt(log.data).toString();
                  } else if (log.topics.length === 4) {
                    // ERC-721
                    transfer.type = 'ERC721';
                    transfer.value = '1';
                    transfer.tokenId = BigInt(log.topics[3]).toString();
                    transfer.decimals = 0;
                  }
                  data.tokenTransfers.push(transfer);
                }
              });
              if (data.tokenTransfers.length > 0) {
                const uniqueTokens = [...new Set(data.tokenTransfers.map(t => t.tokenAddress))];
                const tokenInfos = {};
                await Promise.all(uniqueTokens.map(async (addr) => {
                  tokenInfos[addr.toLowerCase()] = await fetchTokenInfo(provider, addr);
                }));
                data.tokenTransfers = data.tokenTransfers.map(t => {
                  const info = tokenInfos[t.tokenAddress.toLowerCase()];
                  const decimals = info.decimals || (t.type === 'ERC721' ? 0 : 18);
                  logger.info(`Token ${t.tokenAddress}: using decimals ${decimals} (${t.type || 'ERC20'})`);
                  return {
                    ...t,
                    ...info,
                    decimals,
                    chain: chain,
                  };
                });

                logger.info(`Found ${data.tokenTransfers.length} token transfers (${data.tokenTransfers.filter(t => t.type === 'ERC721').length} NFTs), enriching on ${chain}`);
                data.tokenTransfers = await enrichWithCoinGecko(data.tokenTransfers);
              } else {
                logger.info('No token transfers, skipping enrich');
              }

              const nativePrice = await fetchNativePrice(chain);
              if (nativePrice) {
                const nativeValue = Number(tx.value || 0n) / 1e18;
                data.nativeValueUSD = nativeValue * nativePrice;
                const gasUsed = Number(receipt.gasUsed || 0n);
                const effectiveGasPrice = Number(receipt.effectiveGasPrice || tx.gasPrice || 0n);
                const fee = (gasUsed * effectiveGasPrice) / 1e18;
                data.feeUSD = fee * nativePrice;
                logger.info(`Native ${chain} enriched: value USD ${data.nativeValueUSD}, fee USD ${data.feeUSD}`);
              }

              await redis.set(cacheKey, JSON.stringify(data), 'EX', 3600);
              logger.info(`Cached tx-details via Alchemy: ${cacheKey}`);
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
              return;
            }

            // Original Etherscan logic for supported chains
            const searchPromises = sortedChains.map(async ([chainIdStr, chainName]) => {
              const txUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainIdStr}&module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
              try {
                const response = await fetchWithRateLimit(txUrl, { timeout: 30000 });
                logger.info(`TX search on ${chainName} (ID: ${chainIdStr}): status ${response.status}`);
                if (response.data.result) {
                  const tx = response.data.result;
                  const txChainId = tx.chainId ? parseInt(tx.chainId, 16).toString() : null;
                  if (txChainId && txChainId !== chainIdStr) {
                    logger.warn(`TX chainId mismatch on ${chainName}: expected ${chainIdStr}, got ${txChainId} - skipping`);
                    return null;
                  }
                  return { chainName, chainId: chainIdStr, transaction: tx };
                }
              } catch (err) {
                logger.warn(`TX search failed on ${chainName}: ${err.message}`);
              }
              return null;
            });

            let candidates = (await Promise.all(searchPromises)).filter(Boolean);
            logger.info(`Found ${candidates.length} tx candidates for ${txHash.slice(0, 10)}...`);

            if (candidates.length === 0) {
              if (!chain) {
                const baseId = '8453';
                const baseName = primaryChainNameMap[baseId];
                logger.info(`No candidates, retrying Base (${baseId})`);
                const retryUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${baseId}&module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
                const retryRes = await fetchWithRateLimit(retryUrl, { timeout: 30000 });
                if (retryRes.data.result) {
                  candidates = [{ chainName: baseName, chainId: baseId, transaction: retryRes.data.result }];
                  logger.info(`Retry found on Base`);
                }
              } else {
                throw new Error('Transaction not found on selected chain');
              }
            }

            if (candidates.length === 0) {
              throw new Error('Transaction not found on any supported chain');
            }

            const verifyPromises = candidates.map(async (cand) => {
              const verify = await verifyTxOnChain(cand.chainId, txHash, cand.transaction);
              if (verify.valid) {
                logger.info(`Verified valid tx on ${cand.chainName} (ID: ${cand.chainId}): ${verify.numLogs} logs`);
                return { ...cand, numLogs: verify.numLogs, receipt: verify.receipt };
              }
              return null;
            });

            let validCandidates = (await Promise.all(verifyPromises)).filter(Boolean);
            if (validCandidates.length === 0 && candidates.length > 0) {
              logger.warn(`No receipt valid, falling back to timestamp check for candidates`);
              validCandidates = candidates.filter(c => c.transaction.blockNumber).map(c => ({ ...c, numLogs: 0, receipt: null })).slice(0, 1);
            }

            if (validCandidates.length === 0) {
              throw new Error(chain ? 'Transaction not found on selected chain' : 'Transaction not found on any supported chain');
            }
            if (validCandidates.length > 1) {
              validCandidates.sort((a, b) => b.numLogs - a.numLogs);
              logger.warn(`Multiple valid candidates for ${txHash.slice(0, 10)}... taking max logs: ${validCandidates[0].chainName} (${validCandidates[0].numLogs} logs)`);
            }

            const { chainName: foundChainName, chainId: foundChainId, transaction, numLogs, receipt: preReceipt } = validCandidates[0];
            logger.info(`TX verified on ${foundChainName} (ID: ${foundChainId}) for hash ${txHash.slice(0, 10)}... (${numLogs} logs)`);

            let receiptResponse;
            if (preReceipt) {
              receiptResponse = { data: { result: preReceipt } };
            } else {
              let receiptUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${foundChainId}&module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
              receiptResponse = await fetchWithRateLimit(receiptUrl, { timeout: 30000 });
              logger.info(`Receipt fetch for ${foundChainName}: status ${receiptResponse.status}`);
            }

            let internalUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${foundChainId}&module=account&action=txlistinternal&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const internalResponse = await fetchWithRateLimit(internalUrl, { timeout: 30000 });
            logger.info(`Internal txs fetch for ${foundChainName}: status ${internalResponse.status}`);

            let blockUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${foundChainId}&module=proxy&action=eth_getBlockByNumber&tag=${transaction.blockNumber}&boolean=true&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const blockResponse = await fetchWithRateLimit(blockUrl, { timeout: 30000 });
            logger.info(`Block fetch for ${foundChainName}: status ${blockResponse.status}`);

            data = {
              detectedChain: foundChainName,
              verificationDetails: { numLogs },
              transaction,
              receipt: receiptResponse.data.result,
              internalTxs: internalResponse.data.result || [],
              block: blockResponse.data.result || null,
              tokenTransfers: [],
            };

            if (data.receipt && data.receipt.logs) {
              data.receipt.logs.forEach((log, logIndex) => {
                if (log.topics && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                  const from = `0x${log.topics[1].slice(-40)}`;
                  const to = `0x${log.topics[2].slice(-40)}`;
                  let transfer = {
                    tokenAddress: log.address.toLowerCase(),
                    from,
                    to,
                    logIndex,
                  };

                  if (log.topics.length === 3) {
                    // ERC-20
                    transfer.type = 'ERC20';
                    transfer.decimals = 18;
                    // FIXED: Safe BigInt for data
                    if (log.data === '0x' || !log.data) {
                      transfer.value = '0';
                    } else {
                      transfer.value = BigInt(log.data).toString();
                    }
                  } else if (log.topics.length === 4) {
                    // ERC-721
                    transfer.type = 'ERC721';
                    transfer.value = '1';
                    transfer.tokenId = BigInt(log.topics[3]).toString();
                    transfer.decimals = 0;
                  }
                  data.tokenTransfers.push(transfer);
                }
              });
            }

            if (data.tokenTransfers.length > 0) {
              const uniqueTokens = [...new Set(data.tokenTransfers.map(t => t.tokenAddress))];
              const tokenInfos = {};
              await Promise.all(uniqueTokens.map(async (addr) => {
                tokenInfos[addr.toLowerCase()] = await fetchTokenInfoViaProvider(null, addr, foundChainId);
              }));
              data.tokenTransfers = data.tokenTransfers.map(t => {
                const info = tokenInfos[t.tokenAddress.toLowerCase()];
                const decimals = info.decimals || (t.type === 'ERC721' ? 0 : 18);
                logger.info(`Token ${t.tokenAddress}: using decimals ${decimals} (${t.type || 'ERC20'})`);
                return {
                  ...t,
                  ...info,
                  decimals,
                  chain: foundChainName,
                };
              });

              logger.info(`Found ${data.tokenTransfers.length} token transfers (${data.tokenTransfers.filter(t => t.type === 'ERC721').length} NFTs), enriching on ${foundChainName}`);
              data.tokenTransfers = await enrichWithCoinGecko(data.tokenTransfers);
            } else {
              logger.info('No token transfers, skipping enrich');
            }

            const nativePrice = await fetchNativePrice(foundChainName);
            if (nativePrice) {
              const nativeValue = Number(parseInt(data.transaction.value || '0x0', 16)) / 1e18;
              data.nativeValueUSD = nativeValue * nativePrice;
              const gasUsed = parseInt(data.receipt?.gasUsed || '0x0', 16);
              const effectiveGasPrice = parseInt(data.receipt?.effectiveGasPrice || data.transaction.gasPrice || '0x0', 16);
              const fee = (gasUsed * effectiveGasPrice) / 1e18;
              data.feeUSD = fee * nativePrice;
              logger.info(`Native ${foundChainName} enriched: value USD ${data.nativeValueUSD}, fee USD ${data.feeUSD}`);
            }

            await redis.set(cacheKey, JSON.stringify(data), 'EX', 3600);
            logger.info(`Cached tx-details: ${cacheKey}`);

            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'wallet-balances' && address) {
            const apiModule = 'account';
            const apiAction = 'balance';
            apiUrl += `&module=${apiModule}&action=${apiAction}&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API for native balance', { module: apiModule, action: apiAction, chain, address, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });
            logger.info(`API fetch for balance: status ${response.status}`);

            if (response.data.status === '1' && typeof response.data.result === 'string') {
              const ethBalanceWei = BigInt(response.data.result);
              const nativePrice = await fetchNativePrice(chain);
              data = {
                chain,
                address,
                symbol: chain === 'ethereum' ? 'ETH' : chain === 'bnb' || chain === 'bsc' ? 'BNB' : 'Native',
                decimals: 18,
                amount: Number(ethBalanceWei) / 1e18,
                balanceWei: ethBalanceWei.toString(),
                priceUSD: nativePrice || null,
                valueUSD: nativePrice ? (Number(ethBalanceWei) / 1e18) * nativePrice : null,
              };
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for balance: ${response.data.message}`, { ip, address });
            }
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'token-balances' && address) {
            const apiModule = 'account';
            const apiAction = 'tokentx';
            apiUrl += `&module=${apiModule}&action=${apiAction}&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API for token balances via tokentx', { module: apiModule, action: apiAction, chain, address, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });
            logger.info(`API fetch for tokentx: status ${response.status}`);

            if (response.data.status === '1' && Array.isArray(response.data.result)) {
              const balances = {};
              response.data.result.forEach((tx) => {
                const contract = tx.contractAddress.toLowerCase();
                if (!balances[contract]) {
                  balances[contract] = {
                    tokenAddress: tx.contractAddress,
                    symbol: tx.tokenSymbol,
                    name: tx.tokenName,
                    decimals: parseInt(tx.tokenDecimal) || 18,
                    balanceRaw: BigInt(0).toString(),
                  };
                }
                const value = BigInt(tx.value);
                if (tx.to.toLowerCase() === address.toLowerCase()) {
                  balances[contract].balanceRaw = (BigInt(balances[contract].balanceRaw) + value).toString();
                }
                if (tx.from.toLowerCase() === address.toLowerCase()) {
                  balances[contract].balanceRaw = (BigInt(balances[contract].balanceRaw) - value).toString();
                }
              });
              let tokenData = Object.entries(balances)
                .filter(([, bal]) => BigInt(bal.balanceRaw) > 0)
                .map(([contract, bal]) => ({
                  chain,
                  contractAddress: contract,
                  symbol: bal.symbol,
                  name: bal.name,
                  decimals: bal.decimals,
                  amount: Number(BigInt(bal.balanceRaw)) / 10 ** bal.decimals,
                  value: bal.balanceRaw,
                }));
              tokenData = await enrichWithCoinGecko(tokenData);
              data = tokenData;
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for tokentx: ${response.data.message}`, { ip, address });
            }
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'address-overview' && address) {
            const overview = {};

            let balUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=account&action=balance&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const balResponse = await fetchWithRateLimit(balUrl, { timeout: 15000 });
            logger.info(`API fetch for balance overview: status ${balResponse.status}`);
            if (balResponse.data.status === '1') {
              overview.nativeBalance = balResponse.data.result;
            }

            let tokUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const tokResponse = await fetchWithRateLimit(tokUrl, { timeout: 15000 });
            logger.info(`API fetch for tokentx overview: status ${tokResponse.status}`);
            if (tokResponse.data.status === '1') {
              const balances = {};
              tokResponse.data.result.forEach((tx) => {
                const contract = tx.contractAddress.toLowerCase();
                if (!balances[contract]) {
                  balances[contract] = {
                    tokenAddress: tx.contractAddress,
                    symbol: tx.tokenSymbol,
                    name: tx.tokenName,
                    decimals: parseInt(tx.tokenDecimal) || 18,
                    balanceRaw: BigInt(0).toString(),
                  };
                }
                const value = BigInt(tx.value);
                if (tx.to.toLowerCase() === address.toLowerCase()) {
                  balances[contract].balanceRaw = (BigInt(balances[contract].balanceRaw) + value).toString();
                }
                if (tx.from.toLowerCase() === address.toLowerCase()) {
                  balances[contract].balanceRaw = (BigInt(balances[contract].balanceRaw) - value).toString();
                }
              });
              let tokenData = Object.entries(balances)
                .filter(([, bal]) => BigInt(bal.balanceRaw) > 0)
                .map(([contract, bal]) => ({
                  chain,
                  contractAddress: contract,
                  ...bal,
                  amount: Number(BigInt(bal.balanceRaw)) / 10 ** bal.decimals,
                  value: bal.balanceRaw
                }));
              tokenData = await enrichWithCoinGecko(tokenData);
              overview.tokenBalances = tokenData;
            }

            let txCountUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getTransactionCount&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const txCountResponse = await fetchWithRateLimit(txCountUrl, { timeout: 15000 });
            logger.info(`API fetch for tx count: status ${txCountResponse.status}`);
            if (txCountResponse.data.result) {
              overview.txCount = parseInt(txCountResponse.data.result, 16);
            }

            data = overview;
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'token-supply' && tokenAddress) {
            const apiModule = 'stats';
            const apiAction = 'tokensupply';
            apiUrl += `&module=${apiModule}&action=${apiAction}&contractaddress=${tokenAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API', { module: apiModule, action: apiAction, chain, tokenAddress, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });
            logger.info(`API fetch for token supply: status ${response.status}`);

            if (response.data.status === '1' && typeof response.data.result === 'string') {
              const supply = response.data.result;
              data = { tokenAddress, totalSupply: supply };
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for token supply: ${response.data.message}`, { ip, tokenAddress });
              data = { success: false, detail: 'Token supply not found or invalid token address.' };
            }
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'token-info' && tokenAddress) {
            let provider = null;
            if (!supportedEtherscanChainIds.includes(chainId)) {
              const rpcUrl = rpcMap[chain];
              if (rpcUrl) {
                provider = new ethers.JsonRpcProvider(rpcUrl);
              }
            }
            let tokenData = await fetchTokenInfoViaProvider(provider, tokenAddress, chainId);
            tokenData.tokenAddress = tokenAddress;
            tokenData.chain = chain;
            const enriched = await enrichWithCoinGecko([tokenData]);
            data = enriched[0];
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'token-transactions' && tokenAddress) {
            const apiModule = 'account';
            const apiAction = 'tokentx';
            apiUrl += `&module=${apiModule}&action=${apiAction}&contractaddress=${tokenAddress}&startblock=0&endblock=99999999&sort=desc&page=${page}&offset=${offset}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API', { module: apiModule, action: apiAction, chain, tokenAddress, page, offset, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });
            logger.info(`API fetch for token tx: status ${response.status}`);

            if (response.data.status === '1' && Array.isArray(response.data.result)) {
              data = response.data.result.map((tx) => ({
                chain,
                hash: tx.hash,
                timeStamp: tx.timeStamp,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                tokenSymbol: tx.tokenSymbol,
                tokenName: tx.tokenName,
                tokenDecimal: tx.tokenDecimal,
                gasUsed: tx.gasUsed,
                gasPrice: tx.gasPrice,
                tokenAddress: tokenAddress,
                decimals: parseInt(tx.tokenDecimal) || 18,
              }));
              data = await enrichWithCoinGecko(data);
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for token tx: ${response.data.message}`, { ip, tokenAddress });
            }
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else {
            logger.warn(`Invalid parameters for action: ${action}`, { ip });
            controller.enqueue(JSON.stringify({ detail: `Invalid parameters for action: ${action}` }));
          }
          controller.close();
        } catch (error) {
          logger.error(`Etherscan V2 API error for ${action} on chain ${chain} (ID: ${chainId}): ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
            stack: error.stack,
            ip,
          });
          const status = error.response?.status || 500;
          const detail =
            status === 429
              ? 'Etherscan V2 API rate limit exceeded, please try again later.'
              : status === 404
                ? 'Requested data not found.'
                : `Etherscan V2 API error: ${error.message}`;
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