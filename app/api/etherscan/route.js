// Upgraded app/api/etherscan/route.js (minor fix for V2 compatibility, no major changes)
// Fixed: Sanitized logging to avoid exposing API key in logs
// Fixed: Renamed 'module' variable to 'apiModule' to avoid Next.js linting rule violation
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

// Map chain name to chainid for V2 (fixed space in 'sonic')
const chainIdMap = {
  ethereum: '1',
  sepolia: '11155111',
  bnb: '56',
  polygon: '137',
  arbitrum: '42161',
  optimism: '10',
  avalanche: '43114',
  celo: '42220',
  base: '8453',
  fantom: '250',
  matic: '137', // Alias for polygon
  avalanche_c: '43114', // Alias for avalanche
  sonic: '146', // Sonic Chain (removed space, chainId 146 as per SUPPORTED_EVM_CHAINS)
  monad: '143',
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
  action: z.enum(['wallet-balances', 'transactions', 'token-supply', 'token-info', 'token-transactions'], { message: 'Invalid action' }),
  chain: z.string().nonempty('Chain is required'),
  address: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Wallet address must be a valid EVM address' }),
  tokenAddress: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Token address must be a valid EVM address' }),
  page: z.number().int().min(1).optional().default(1),
  offset: z.number().int().min(1).max(10000).optional().default(100), // Increased max offset for more pages
}).refine(
  (data) => (['wallet-balances', 'transactions'].includes(data.action) ? !!data.address : true),
  { message: 'Wallet address is required for wallet-balances and transactions', path: ['address'] }
).refine(
  (data) => (['token-supply', 'token-info', 'token-transactions'].includes(data.action) ? !!data.tokenAddress : true),
  { message: 'Token address is required for token-supply, token-info and token-transactions', path: ['tokenAddress'] }
);

// V2 unified base URL
const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';

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

  const { chain, action, address, tokenAddress } = parsedBody;
  const chainId = chainIdMap[chain?.toLowerCase()];
  if (!chainId) {
    logger.warn(`Unsupported chain for Etherscan V2: ${chain}`, { ip });
    return NextResponse.json({ detail: `Unsupported chain for Etherscan V2: ${chain}` }, { status: 400 });
  }

  const internalToken = request.headers.get('x-internal-token');
  if (!internalToken || internalToken !== process.env.INTERNAL_API_TOKEN) {
    const session = await auth();
    if (!session || !session.user?.id) {
      logger.error(`Authentication error: No session or UID`, { ip });
      return NextResponse.json({ detail: 'Unauthorized: Please log in.' }, { status: 401 });
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
          let data = [];

          if (action === 'transactions' && address) {
            const apiModule = 'account';
            const apiAction = 'txlist';
            apiUrl += `&module=${apiModule}&action=${apiAction}&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API', { module: apiModule, action: apiAction, chain, address, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

            if (response.data.status === '1' && Array.isArray(response.data.result)) {
              data = response.data.result.map((tx) => ({
                chain,
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: '0x' + (parseInt(tx.value) || 0).toString(16),
                block_time: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
                gasUsed: tx.gasUsed,
                gasPrice: tx.gasPrice,
                input: tx.input,
                isError: tx.isError === '1',
              }));
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for transactions: ${response.data.message}`, { ip, address });
            }
            logger.info(`Transactions response for address ${address}: ${data.length} transactions`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data }));
            controller.close();
          } else if (action === 'wallet-balances' && address) {
            const apiModule = 'account';
            const apiAction = 'balance';
            apiUrl += `&module=${apiModule}&action=${apiAction}&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API', { module: apiModule, action: apiAction, chain, address, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

            if (response.data.status === '1' && typeof response.data.result === 'string') {
              const ethBalanceWei = parseInt(response.data.result);
              data = [
                {
                  chain,
                  chain_id: null,
                  address,
                  symbol: chain === 'ethereum' ? 'ETH' : chain === 'bnb' ? 'BNB' : 'Native',
                  decimals: 18,
                  amount: ethBalanceWei / Math.pow(10, 18),
                  price_usd: 0,
                  value_usd: 0,
                  logo: null,
                },
              ];
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for balance: ${response.data.message}`, { ip, address });
            }
            logger.info(`Wallet balances response for address ${address}: ${data.length} tokens`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data }));
            controller.close();
          } else if (action === 'token-supply' && tokenAddress) {
            const apiModule = 'stats';
            const apiAction = 'tokensupply';
            apiUrl += `&module=${apiModule}&action=${apiAction}&contractaddress=${tokenAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API', { module: apiModule, action: apiAction, chain, tokenAddress, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

            if (response.data.status === '1' && typeof response.data.result === 'string') {
              const supply = response.data.result;
              controller.enqueue(JSON.stringify({ success: true, data: { tokenAddress, totalSupply: supply } }));
              controller.close();
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for token supply: ${response.data.message}`, { ip, tokenAddress });
              controller.enqueue(JSON.stringify({ success: false, detail: 'Token supply not found or invalid token address.' }));
              controller.close();
            }
          } else if (action === 'token-info' && tokenAddress) {
            logger.warn(`'token-info' action not fully supported by Etherscan V2 directly. Requires contract interaction for full details.`, { ip, tokenAddress });
            controller.enqueue(JSON.stringify({ success: true, data: { tokenAddress, name: 'Unknown', symbol: 'Unknown', decimals: 0, note: 'Requires contract interaction for full details' } }));
            controller.close();
          } else if (action === 'token-transactions' && tokenAddress) {
            const apiModule = 'account';
            const apiAction = 'tokentx';
            const pageNum = parsedBody.page;
            const offsetNum = parsedBody.offset;
            apiUrl += `&module=${apiModule}&action=${apiAction}&contractaddress=${tokenAddress}&startblock=0&endblock=99999999&sort=desc&page=${pageNum}&offset=${offsetNum}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info('Calling Etherscan V2 API', { module: apiModule, action: apiAction, chain, tokenAddress, page: pageNum, offset: offsetNum, ip });
            const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

            if (response.data.status === '1' && Array.isArray(response.data.result)) {
              data = response.data.result.map((tx) => ({
                chain,
                txhash: tx.hash || tx.txhash,  // ← SỬA: Lấy từ 'hash' (V2), fallback 'txhash' (V1)
                timeStamp: tx.timeStamp,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                tokenSymbol: tx.tokenSymbol,
                tokenName: tx.tokenName,
                tokenDecimal: tx.tokenDecimal,
                gasUsed: tx.gasUsed,
                gasPrice: tx.gasPrice,
                decimals: parseInt(tx.tokenDecimal || 18),
              }));
            } else {
              logger.warn(`Etherscan V2 API returned status ${response.data.status} for token tx: ${response.data.message}`, { ip, tokenAddress });
            }
            logger.info(`Token transactions response for ${tokenAddress}: ${data.length} transactions`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data }));
            controller.close();
          } else {
            logger.warn(`Invalid parameters for action: ${action}`, { ip });
            controller.enqueue(JSON.stringify({ detail: `Invalid parameters for action: ${action}` }));
            controller.close();
          }
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