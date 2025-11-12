// app/api/etherscan/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { isAddress } from 'ethers';

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 5,
  minTime: 250,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    return await axios.get(url, config);
  } catch (error) {
    if (error.response?.status === 429 || error.code === 'ECONNABORTED') {
      throw error;
    }
    throw error;
  }
});

// FIXED: CoinGecko platform map (same as CMC slugs)
const platformIdMap = {
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  arbitrum: 'arbitrum-one',
  optimism: 'optimism',
  polygon: 'polygon-pos',
  base: 'base',
  // Add more: avalanche: 'avalanche', etc.
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
  // Batch fetch: CoinGecko no direct batch for metadata, so Promise.all single calls (rate limit OK for small batches)
  await Promise.all(addresses.map(async (addr) => {
    const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${addr}?localization=false&market_data=false`;
    try {
      const res = await fetchWithRateLimit(url, { timeout: 5000 });
      if (res.data.id) {
        const lowerAddr = addr.toLowerCase();
        cgInfos[lowerAddr] = {
          id: res.data.id, // For price fetch
          logo: res.data.image?.small || res.data.image?.thumb || null, // Prefer small for icons
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
    // Res: { '0x...': { usd: 1.00 } }
    const matchedCount = Object.keys(res.data).length;
    logger.info(`CoinGecko prices fetched for ${matchedCount} tokens on ${platform}`);
    return res.data;
  } catch (err) {
    logger.warn(`CoinGecko prices fetch failed for ${platform}: ${err.message}`);
    return {};
  }
}

// UPDATED: Fetch native price (keep CMC for accuracy)
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
  };
  const nativeId = nativeIdMap[chain];
  if (!nativeId) return null;

  // Simple CMC price fetch (no batch needed)
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
  if (tokens.length === 0) {
    logger.info('No tokens to enrich with CoinGecko');
    return tokens;
  }
  const chain = tokens[0].chain; // Assume same chain
  const uniqueAddrs = [...new Set(tokens.map(t => t.tokenAddress?.toLowerCase()).filter(Boolean))];
  logger.info(`Enriching ${tokens.length} tokens from ${uniqueAddrs.length} unique addresses on ${chain} with CoinGecko`);

  const cgInfos = await fetchCoinGeckoInfo(chain, uniqueAddrs);
  const cgPrices = await fetchCoinGeckoPrices(chain, uniqueAddrs);

  return tokens.map(t => {
    const lowerAddr = t.tokenAddress?.toLowerCase();
    const cgInfo = cgInfos[lowerAddr];
    const cgPrice = cgPrices[lowerAddr]?.usd || null;
    const amount = Number(t.value || t.balanceRaw) / 10 ** (t.decimals || 18);
    const valueUSD = cgPrice ? amount * cgPrice : null;
    logger.info(`Enriched token ${t.tokenAddress} on ${chain}: symbol ${t.symbol || cgInfo?.symbol}, price ${cgPrice}, amount ${amount}, valueUSD ${valueUSD}, logo: ${cgInfo?.logo ? 'OK' : 'fallback'}`);

    return {
      ...t,
      logo: cgInfo?.logo || `https://via.placeholder.com/16?text=${t.symbol || 'T'}`,
      priceUSD: cgPrice || null,
      valueUSD: valueUSD || null,
      name: cgInfo?.name || t.name, // Optional: Override if better
      symbol: cgInfo?.symbol || t.symbol,
    };
  });
}

// Full chainIdMap (unchanged)
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
  monad: '10143',
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
  chain: z.string().nonempty('Chain is required'),
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
  (data) => (['token-supply', 'token-info', 'token-transactions'].includes(data.action) ? !!data.tokenAddress : true),
  { message: 'Token address is required for token-supply, token-info and token-transactions', path: ['tokenAddress'] }
);

// V2 unified base URL
const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';

// Helper to fetch token info via eth_call (unchanged)
async function fetchTokenInfo(chainId, tokenAddress) {
  const calls = [
    { selector: '0x06fdde03', key: 'name' },
    { selector: '0x95d89b41', key: 'symbol' },
    { selector: '0x313ce567', key: 'decimals' },
  ];
  let info = { name: 'Unknown', symbol: 'UNK', decimals: 18 };

  for (const call of calls) {
    let callUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_call&to=${tokenAddress}&data=${call.selector}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
    try {
      const callRes = await fetchWithRateLimit(callUrl, { timeout: 15000 });
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
      logger.warn(`Failed to fetch ${call.key} for token ${tokenAddress}: ${err.message}`);
    }
  }
  return info;
}

// CORS wrapper (unchanged)
const handlerWrapper = (handler) =>
  limiterBottleneck.wrap(async (req) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    const startTime = Date.now();
    logger.info(`Request to /api/etherscan from IP ${ip}, Origin: ${origin || 'null'}, Referer: ${referer || 'null'}`);

    if (!isAllowedOrigin(origin, referer)) {
      return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
    }

    const res = await handler(req);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'POST');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Token');
    res.headers.set('Content-Security-Policy', "default-src 'self'");
    logger.info(`Response for /api/etherscan, time: ${Date.now() - startTime}ms`, { ip });
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
  if (!chainId) {
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

          if (action === 'transactions' && address) {
            const apiModule = 'account';
            const apiAction = 'txlist';
            apiUrl += `&module=${apiModule}&action=${apiAction}&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${offset}&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API for transactions', { module: apiModule, action: apiAction, chain, address, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });
            logger.info(`API fetch for transactions: status ${response.status}`);

            if (response.data.status === '1' && Array.isArray(response.data.result)) {
              data = response.data.result.map((tx) => ({
                chain,
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                blockNumber: tx.blockNumber,
                timeStamp: tx.timeStamp,
                gasUsed: tx.gasUsed,
                gasPrice: tx.gasPrice,
                input: tx.input,
                isError: tx.isError === '1',
                txreceipt_status: tx.txreceipt_status,
              }));
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for transactions: ${response.data.message}`, { ip, address });
            }
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
                  balanceRaw: bal.balanceRaw,
                  value: bal.balanceRaw,
                }));
              tokenData = await enrichWithCoinGecko(tokenData); // FIXED: Use CoinGecko
              data = tokenData;
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for tokentx: ${response.data.message}`, { ip, address });
            }
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'tx-details' && txHash) {
            let txUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API for tx details', { module: 'proxy', action: 'eth_getTransactionByHash', chain, txHash, ip });
            const txResponse = await fetchWithRateLimit(txUrl, { timeout: 15000 });
            logger.info(`TX fetch for ${chain}: status ${txResponse.status}`);
            if (!txResponse.data.result) throw new Error('TX not found');

            let receiptUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const receiptResponse = await fetchWithRateLimit(receiptUrl, { timeout: 15000 });
            logger.info(`Receipt fetch for ${chain}: status ${receiptResponse.status}`);

            let internalUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=account&action=txlistinternal&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const internalResponse = await fetchWithRateLimit(internalUrl, { timeout: 15000 });
            logger.info(`Internal txs fetch for ${chain}: status ${internalResponse.status}`);

            let blockUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getBlockByNumber&tag=${txResponse.data.result.blockNumber}&boolean=true&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const blockResponse = await fetchWithRateLimit(blockUrl, { timeout: 15000 });
            logger.info(`Block fetch for ${chain}: status ${blockResponse.status}`);

            data = {
              transaction: txResponse.data.result,
              receipt: receiptResponse.data.result,
              internalTxs: internalResponse.data.result || [],
              block: blockResponse.data.result || null,
              tokenTransfers: [],
            };

            if (data.receipt && data.receipt.logs) {
              data.receipt.logs.forEach((log) => {
                if (log.topics && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' && log.topics.length === 3) {
                  data.tokenTransfers.push({
                    tokenAddress: log.address,
                    from: `0x${log.topics[1].slice(-40)}`,
                    to: `0x${log.topics[2].slice(-40)}`,
                    value: BigInt(log.data).toString(),
                  });
                }
              });
            }

            if (data.tokenTransfers.length > 0) {
              const uniqueTokens = [...new Set(data.tokenTransfers.map(t => t.tokenAddress.toLowerCase()))];
              const tokenInfos = {};
              await Promise.all(uniqueTokens.map(async (addr) => {
                tokenInfos[addr] = await fetchTokenInfo(chainId, addr.toLowerCase());
              }));
              data.tokenTransfers = data.tokenTransfers.map(t => ({
                ...t,
                tokenAddress: t.tokenAddress.toLowerCase(),
                ...tokenInfos[t.tokenAddress.toLowerCase()],
                chain, // Ensure chain field
              }));

              logger.info(`Found ${data.tokenTransfers.length} token transfers, enriching with CoinGecko on ${chain}`);
              data.tokenTransfers = await enrichWithCoinGecko(data.tokenTransfers); // FIXED: Use CoinGecko
            } else {
              logger.info('No token transfers, skipping enrich');
            }

            const nativePrice = await fetchNativePrice(chain);
            if (nativePrice) {
              const nativeValue = Number(parseInt(data.transaction.value || '0', 16)) / 1e18;
              data.nativeValueUSD = nativeValue * nativePrice;
              const gasUsed = parseInt(data.receipt?.gasUsed || '0', 16);
              const effectiveGasPrice = parseInt(data.receipt?.effectiveGasPrice || data.transaction.gasPrice || '0', 16);
              const fee = (gasUsed * effectiveGasPrice) / 1e18;
              data.feeUSD = fee * nativePrice;
              logger.info(`Native ${chain} enriched: value USD ${data.nativeValueUSD}, fee USD ${data.feeUSD}`);
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
              tokenData = await enrichWithCoinGecko(tokenData); // FIXED: Use CoinGecko
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
            let tokenData = await fetchTokenInfo(chainId, tokenAddress);
            tokenData.tokenAddress = tokenAddress;
            tokenData.chain = chain;
            const enriched = await enrichWithCoinGecko([tokenData]); // FIXED: Use CoinGecko
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
              data = await enrichWithCoinGecko(data); // FIXED: Use CoinGecko
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