// app/api/etherscan/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { isAddress } from 'ethers';
import { auth } from '@/lib/auth';
import { createClient } from 'redis';

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

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 10,
  minTime: 500,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    return await axios.get(url, { ...config, timeout: 15000 });
  } catch (error) {
    if (error.response?.status === 429 || error.code === 'ECONNABORTED') {
      throw error;
    }
    throw error;
  }
});

// Allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
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
  actions: z.array(
    z.object({
      action: z.enum(['wallet-balances', 'transactions', 'token-supply', 'token-info'], { message: 'Invalid action' }),
      chain: z.string().nonempty('Chain is required'),
      address: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Wallet address must be a valid EVM address' }),
      tokenAddress: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Token address must be a valid EVM address' }),
    })
  ).min(1, 'At least one action is required').refine(
    (actions) => actions.every((data) => 
      (['wallet-balances', 'transactions'].includes(data.action) ? !!data.address : true) &&
      (['token-supply', 'token-info'].includes(data.action) ? !!data.tokenAddress : true)
    ),
    { message: 'Address or tokenAddress required for specific actions' }
  ),
});

const ETHERSCAN_API_URLS = {
  ethereum: 'https://api.etherscan.io/api',
  sepolia: 'https://api-sepolia.etherscan.io/api',
  bnb: 'https://api.bscscan.com/api',
  polygon: 'https://api.polygonscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api',
  optimism: 'https://api-optimistic.etherscan.io/api',
};

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

  const { actions } = parsedBody;
  const redisClient = await getRedisClient();
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
          const actionPromises = actions.map(async ({ action, chain, address, tokenAddress }) => {
            const etherscanBaseUrl = ETHERSCAN_API_URLS[chain?.toLowerCase()];
            if (!etherscanBaseUrl) {
              logger.warn(`Unsupported chain for Etherscan: ${chain}`, { ip });
              return { action, success: false, detail: `Unsupported chain for Etherscan: ${chain}` };
            }

            const cacheKey = `etherscan_${action}_${chain}_${address || tokenAddress}_${Date.now() - (Date.now() % 3600000)}`; // Cache per hour
            const cached = await redisClient.get(cacheKey);
            if (cached) {
              logger.info(`Cache hit for ${cacheKey}`);
              return { action, success: true, data: JSON.parse(cached) };
            }

            try {
              let apiUrl = '';
              let data = [];

              if (action === 'transactions' && address) {
                apiUrl = `${etherscanBaseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
                logger.info(`Calling Etherscan API for transactions: ${apiUrl}`, { ip });
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
                  await redisClient.setEx(cacheKey, 3600, JSON.stringify(data));
                  logger.info(`Transactions response for address ${address}: ${data.length} transactions`, { ip });
                  return { action, success: true, data };
                }
                logger.warn(`Etherscan API returned status ${response.data.status} for transactions: ${response.data.message}`, { ip, address });
                return { action, success: false, detail: `Etherscan API error: ${response.data.message}` };
              } else if (action === 'wallet-balances' && address) {
                apiUrl = `${etherscanBaseUrl}?module=account&action=balance&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
                logger.info(`Calling Etherscan API for balance: ${apiUrl}`, { ip });
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
                  await redisClient.setEx(cacheKey, 3600, JSON.stringify(data));
                  logger.info(`Wallet balances response for address ${address}: ${data.length} tokens`, { ip });
                  return { action, success: true, data };
                }
                logger.warn(`Etherscan API returned status ${response.data.status} for balance: ${response.data.message}`, { ip, address });
                return { action, success: false, detail: `Etherscan API error: ${response.data.message}` };
              } else if (action === 'token-supply' && tokenAddress) {
                apiUrl = `${etherscanBaseUrl}?module=stats&action=tokensupply&contractaddress=${tokenAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`;
                logger.info(`Calling Etherscan API for token supply: ${apiUrl}`, { ip });
                const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

                if (response.data.status === '1' && typeof response.data.result === 'string') {
                  const supply = response.data.result;
                  const data = { tokenAddress, totalSupply: supply };
                  await redisClient.setEx(cacheKey, 3600, JSON.stringify(data));
                  return { action, success: true, data };
                }
                logger.warn(`Etherscan API returned status ${response.data.status} for token supply: ${response.data.message}`, { ip, tokenAddress });
                return { action, success: false, detail: 'Token supply not found or invalid token address.' };
              } else if (action === 'token-info' && tokenAddress) {
                logger.warn(`'token-info' action not fully supported by Etherscan directly. Requires contract interaction for full details.`, { ip, tokenAddress });
                const data = { tokenAddress, name: 'Unknown', symbol: 'Unknown', decimals: 0, note: 'Requires contract interaction for full details' };
                await redisClient.setEx(cacheKey, 3600, JSON.stringify(data));
                return { action, success: true, data };
              } else {
                logger.warn(`Invalid parameters for action: ${action}`, { ip });
                return { action, success: false, detail: `Invalid parameters for action: ${action}` };
              }
            } catch (error) {
              logger.error(`Etherscan API error for action ${action}: ${error.message}`, {
                status: error.response?.status,
                data: error.response?.data,
                stack: error.stack,
                ip,
              });
              const status = error.response?.status || 500;
              const detail =
                status === 429
                  ? 'Etherscan API rate limit exceeded, please try again later.'
                  : status === 404
                  ? 'Requested data not found.'
                  : `Etherscan API error: ${error.message}`;
              return { action, success: false, detail };
            }
          });

          const results = await Promise.allSettled(actionPromises);
          const responseData = results.map((result) => {
            if (result.status === 'fulfilled') {
              return result.value;
            }
            return { action: 'unknown', success: false, detail: 'Internal error processing action' };
          });

          const successfulResults = responseData.filter((res) => res.success);
          const failedResults = responseData.filter((res) => !res.success);

          if (successfulResults.length === 0) {
            controller.enqueue(JSON.stringify({ success: false, errors: failedResults }));
            controller.close();
            return;
          }

          controller.enqueue(JSON.stringify({ success: true, results: successfulResults, errors: failedResults }));
          controller.close();
        } catch (error) {
          logger.error(`Unexpected error: ${error.message}`, { ip, stack: error.stack });
          controller.enqueue(JSON.stringify({ success: false, detail: 'Unexpected server error' }));
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