// Upgraded app/api/etherscan/route.js with expanded actions for full explorer support
// Added: Full support for all Etherscan V2 chains based on latest docs (as of Nov 2025)
// Expanded chainIdMap with all supported mainnets and testnets
// Added aliases like 'bsc' for 'bnb_smart_chain_mainnet', 'polygon' for 'polygon_mainnet', etc.
// Enhanced error handling and logging
// Enhanced: Parse token transfers from logs in tx-details
// Enhanced: Fetch token info (name, symbol, decimals) for tokens in tx-details and token-info
import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { isAddress } from 'ethers';
import { auth } from '@/lib/auth';

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 1,  // Safe for 5 req/s
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

// Full chainIdMap based on latest Etherscan V2 docs (50+ chains, mainnets & testnets)
const chainIdMap = {
  // Ethereum
  ethereum: '1',
  ethereum_mainnet: '1',
  sepolia: '11155111',
  holesky: '17000',
  hoodi: '560048',

  // Abstract
  abstract: '2741',
  abstract_mainnet: '2741',
  abstract_sepolia: '11124',

  // ApeChain
  apechain: '33139',
  apechain_mainnet: '33139',
  apechain_curtis: '33111',

  // Arbitrum
  arbitrum: '42161',
  arbitrum_one: '42161',
  arbitrum_one_mainnet: '42161',
  arbitrum_nova: '42170',
  arbitrum_sepolia: '421614',

  // Avalanche
  avalanche: '43114',
  avalanche_c: '43114',
  avalanche_c_chain: '43114',
  avalanche_fuji: '43113',

  // Base
  base: '8453',
  base_mainnet: '8453',
  base_sepolia: '84532',

  // Berachain
  berachain: '80094',
  berachain_mainnet: '80094',
  berachain_bepolia: '80069',

  // BitTorrent
  bittorrent: '199',
  bittorrent_chain: '199',
  bittorrent_chain_mainnet: '199',
  bittorrent_testnet: '1029',

  // Blast
  blast: '81457',
  blast_mainnet: '81457',
  blast_sepolia: '168587773',

  // BNB Smart Chain (BSC)
  bnb: '56',
  bnb_smart_chain: '56',
  bnb_smart_chain_mainnet: '56',
  bsc: '56', // Alias for BSC
  bsc_mainnet: '56',
  bnb_testnet: '97',
  bsc_testnet: '97',

  // Celo
  celo: '42220',
  celo_mainnet: '42220',
  celo_sepolia: '11142220',

  // Fraxtal
  fraxtal: '252',
  fraxtal_mainnet: '252',
  fraxtal_hoodi: '2523',

  // Gnosis
  gnosis: '100',

  // HyperEVM
  hyperevm: '999',
  hyperevm_mainnet: '999',

  // Katana
  katana: '747474',
  katana_mainnet: '747474',
  katana_bokuto: '737373',

  // Linea
  linea: '59144',
  linea_mainnet: '59144',
  linea_sepolia: '59141',

  // Mantle
  mantle: '5000',
  mantle_mainnet: '5000',
  mantle_sepolia: '5003',

  // Memecore
  memecore: '43521',
  memecore_testnet: '43521',

  // Monad
  monad: '10143',
  monad_testnet: '10143',

  // Moonbeam / Moonriver
  moonbeam: '1284',
  moonbeam_mainnet: '1284',
  moonriver: '1285',
  moonriver_mainnet: '1285',
  moonbase_alpha: '1287',

  // Optimism (OP)
  op: '10',
  op_mainnet: '10',
  op_sepolia: '11155420',

  // opBNB
  opbnb: '204',
  opbnb_mainnet: '204',
  opbnb_testnet: '5611',

  // Polygon
  polygon: '137',
  polygon_mainnet: '137',
  matic: '137', // Alias
  polygon_amoy: '80002',

  // Scroll
  scroll: '534352',
  scroll_mainnet: '534352',
  scroll_sepolia: '534351',

  // Sei
  sei: '1329',
  sei_mainnet: '1329',
  sei_testnet: '1328',

  // Sonic
  sonic: '146',
  sonic_mainnet: '146',
  sonic_testnet: '14601',

  // Sophon
  sophon: '50104',
  sophon_mainnet: '50104',
  sophon_sepolia: '531050104',

  // Swellchain
  swellchain: '1923',
  swellchain_mainnet: '1923',
  swellchain_testnet: '1924',

  // Taiko
  taiko: '167000',
  taiko_mainnet: '167000',
  taiko_hoodi: '167013',

  // Unichain
  unichain: '130',
  unichain_mainnet: '130',
  unichain_sepolia: '1301',

  // World
  world: '480',
  world_mainnet: '480',
  world_sepolia: '4801',

  // XDC
  xdc: '50',
  xdc_mainnet: '50',
  xdc_apothem: '51',

  // zkSync
  zksync: '324',
  zksync_mainnet: '324',
  zksync_sepolia: '300',
};

// Allowed origins
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

// Helper to fetch token info via eth_call
async function fetchTokenInfo(chainId, tokenAddress) {
  const calls = [
    { selector: '0x06fdde03', key: 'name' }, // name()
    { selector: '0x95d89b41', key: 'symbol' }, // symbol()
    { selector: '0x313ce567', key: 'decimals' }, // decimals()
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
          // Decode ABI string
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

// CORS wrapper
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

  const internalToken = request.headers.get('x-internal-token');
  if (!internalToken || internalToken !== process.env.INTERNAL_API_TOKEN) {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`Bypassing auth in development mode`, { ip });
    } else {
      const session = await auth();
      if (!session || !session.user?.id) {
        logger.error(`Authentication error: No session or UID`, { ip });
        return NextResponse.json({ detail: 'Unauthorized: Please log in.' }, { status: 401 });
      }
    }
  }

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

            if (response.data.status === '1' && typeof response.data.result === 'string') {
              const ethBalanceWei = BigInt(response.data.result);
              data = {
                chain,
                address,
                symbol: chain === 'ethereum' ? 'ETH' : chain === 'bnb' || chain === 'bsc' ? 'BNB' : 'Native',
                decimals: 18,
                amount: Number(ethBalanceWei) / 1e18,
                balanceWei: ethBalanceWei.toString(),
              };
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for balance: ${response.data.message}`, { ip, address });
            }
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'token-balances' && address) {
            // Fetch all tokentx and aggregate balances
            const apiModule = 'account';
            const apiAction = 'tokentx';
            apiUrl += `&module=${apiModule}&action=${apiAction}&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API for token balances via tokentx', { module: apiModule, action: apiAction, chain, address, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

            if (response.data.status === '1' && Array.isArray(response.data.result)) {
              const balances = {};
              response.data.result.forEach((tx) => {
                const contract = tx.contractAddress.toLowerCase();
                if (!balances[contract]) {
                  balances[contract] = {
                    symbol: tx.tokenSymbol,
                    name: tx.tokenName,
                    decimals: parseInt(tx.tokenDecimal) || 18,
                    balance: BigInt(0),
                  };
                }
                const value = BigInt(tx.value);
                if (tx.to.toLowerCase() === address.toLowerCase()) {
                  balances[contract].balance += value;
                }
                if (tx.from.toLowerCase() === address.toLowerCase()) {
                  balances[contract].balance -= value;
                }
              });
              data = Object.entries(balances)
                .filter(([, bal]) => bal.balance > 0)
                .map(([contract, bal]) => ({
                  chain,
                  contractAddress: contract,
                  symbol: bal.symbol,
                  name: bal.name,
                  decimals: bal.decimals,
                  amount: Number(bal.balance) / 10 ** bal.decimals,
                  balanceRaw: bal.balance.toString(),
                }));
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for tokentx: ${response.data.message}`, { ip, address });
            }
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'tx-details' && txHash) {
            // For full TX details, we need multiple calls: tx, receipt, internal txs
            // 1. Get TX
            let txUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API for tx details', { module: 'proxy', action: 'eth_getTransactionByHash', chain, txHash, ip });
            const txResponse = await fetchWithRateLimit(txUrl, { timeout: 15000 });
            if (!txResponse.data.result) throw new Error('TX not found');

            // 2. Get receipt
            let receiptUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const receiptResponse = await fetchWithRateLimit(receiptUrl, { timeout: 15000 });

            // 3. Internal txs
            let internalUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=account&action=txlistinternal&txhash=${txHash}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const internalResponse = await fetchWithRateLimit(internalUrl, { timeout: 15000 });

            // 4. Get block details for timestamp
            let blockUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getBlockByNumber&tag=${txResponse.data.result.blockNumber}&boolean=true&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const blockResponse = await fetchWithRateLimit(blockUrl, { timeout: 15000 });

            data = {
              transaction: txResponse.data.result,
              receipt: receiptResponse.data.result,
              internalTxs: internalResponse.data.result || [],
              block: blockResponse.data.result || null,
              tokenTransfers: [],
            };

            // Parse token transfers from logs
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

            // Fetch token info for each unique token
            if (data.tokenTransfers.length > 0) {
              const uniqueTokens = [...new Set(data.tokenTransfers.map(t => t.tokenAddress.toLowerCase()))];
              const tokenInfos = {};
              await Promise.all(uniqueTokens.map(async (addr) => {
                tokenInfos[addr] = await fetchTokenInfo(chainId, addr);
              }));
              data.tokenTransfers = data.tokenTransfers.map(t => ({
                ...t,
                ...tokenInfos[t.tokenAddress.toLowerCase()],
              }));
            }

            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'address-overview' && address) {
            // Combine native balance, token balances, tx count
            const overview = {};

            // Native balance
            let balUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=account&action=balance&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const balResponse = await fetchWithRateLimit(balUrl, { timeout: 15000 });
            if (balResponse.data.status === '1') {
              overview.nativeBalance = balResponse.data.result;
            }

            // Token balances (from above logic)
            let tokUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const tokResponse = await fetchWithRateLimit(tokUrl, { timeout: 15000 });
            if (tokResponse.data.status === '1') {
              const balances = {};
              tokResponse.data.result.forEach((tx) => {
                const contract = tx.contractAddress.toLowerCase();
                if (!balances[contract]) {
                  balances[contract] = {
                    symbol: tx.tokenSymbol,
                    name: tx.tokenName,
                    decimals: parseInt(tx.tokenDecimal) || 18,
                    balance: BigInt(0),
                  };
                }
                const value = BigInt(tx.value);
                if (tx.to.toLowerCase() === address.toLowerCase()) {
                  balances[contract].balance += value;
                }
                if (tx.from.toLowerCase() === address.toLowerCase()) {
                  balances[contract].balance -= value;
                }
              });
              overview.tokenBalances = Object.entries(balances)
                .filter(([, bal]) => bal.balance > 0)
                .map(([contract, bal]) => ({ contractAddress: contract, ...bal, balance: bal.balance.toString() }));
            }

            // Tx count
            let txCountUrl = `${ETHERSCAN_V2_BASE_URL}?chainid=${chainId}&module=proxy&action=eth_getTransactionCount&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const txCountResponse = await fetchWithRateLimit(txCountUrl, { timeout: 15000 });
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

            if (response.data.status === '1' && typeof response.data.result === 'string') {
              const supply = response.data.result;
              data = { tokenAddress, totalSupply: supply };
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for token supply: ${response.data.message}`, { ip, tokenAddress });
              data = { success: false, detail: 'Token supply not found or invalid token address.' };
            }
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'token-info' && tokenAddress) {
            data = await fetchTokenInfo(chainId, tokenAddress);
            data.tokenAddress = tokenAddress;
            controller.enqueue(JSON.stringify({ success: true, data }));
          } else if (action === 'token-transactions' && tokenAddress) {
            const apiModule = 'account';
            const apiAction = 'tokentx';
            apiUrl += `&module=${apiModule}&action=${apiAction}&contractaddress=${tokenAddress}&startblock=0&endblock=99999999&sort=desc&page=${page}&offset=${offset}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API', { module: apiModule, action: apiAction, chain, tokenAddress, page, offset, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

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
              }));
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
          logger.error(`Etherscan V2 API error for action ${action}: ${error.message}`, {
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