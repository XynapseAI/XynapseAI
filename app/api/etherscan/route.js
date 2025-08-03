// app/api/etherscan/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import Bottleneck from 'bottleneck';
import { createClient } from 'redis';
import { isAddress } from 'ethers';
import { auth } from '@/lib/auth';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip, address) {
  const ipKey = `rate_limit:etherscan_ip:${ip}`;
  const addressKey = `rate_limit:etherscan_address:${address || 'unknown'}`;
  const windowMs = 60 * 1000;
  const [ipRequests, addressRequests] = await Promise.all([
    redisClient.get(ipKey) || 0,
    redisClient.get(addressKey) || 0,
  ]);
  if (ipRequests >= 100 || addressRequests >= 30) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(ipKey)
    .expire(ipKey, windowMs / 1000)
    .incr(addressKey)
    .expire(addressKey, windowMs / 1000)
    .exec();
}

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 5,
  minTime: 2000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    return await axios.get(url, config);
  } catch (error) {
    if (error.response?.status === 429 || error.code === 'ECONNABORTED') {
      throw error; // Let Bottleneck handle retries
    }
    throw error;
  }
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net', // Thêm để nhất quán với /api/auth/[...nextauth]
  'https://xynapse-ai.vercel.app', 
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

const bodySchema = z.object({
  action: z.enum(['wallet-balances', 'transactions', 'token-supply', 'token-info'], { message: 'Invalid action' }),
  chain: z.string().nonempty('Chain is required'),
  address: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Wallet address must be a valid EVM address' }),
  tokenAddress: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Token address must be a valid EVM address' }),
}).refine(
  (data) => (['wallet-balances', 'transactions'].includes(data.action) ? !!data.address : true),
  { message: 'Wallet address is required for wallet-balances and transactions', path: ['address'] }
).refine(
  (data) => (['token-supply', 'token-info'].includes(data.action) ? !!data.tokenAddress : true),
  { message: 'Token address is required for token-supply and token-info', path: ['tokenAddress'] }
);

const ETHERSCAN_API_URLS = {
  ethereum: 'https://api.etherscan.io/api',
  sepolia: 'https://api-sepolia.etherscan.io/api',
  bnb: 'https://api.bscscan.com/api',
  polygon: 'https://api.polygonscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api',
  optimism: 'https://api-optimistic.etherscan.io/api',
};

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const startTime = Date.now();
  logger.info(`Request to /api/etherscan from IP ${ip}, Origin: ${request.headers.get('origin') || 'null'}`);

  const origin = request.headers.get('origin');
  if (!origin && process.env.NODE_ENV === 'development') {
    logger.warn(`Origin is null, allowing in development mode`, { ip });
  } else if (!origin || !allowedOrigins.includes(origin)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins, ip });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
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
    await checkRateLimit(ip, address || tokenAddress);

    const etherscanBaseUrl = ETHERSCAN_API_URLS[chain?.toLowerCase()];
    if (!etherscanBaseUrl) {
      logger.warn(`Unsupported chain for Etherscan: ${chain}`, { ip });
      return NextResponse.json({ detail: `Unsupported chain for Etherscan: ${chain}` }, { status: 400 });
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
            let apiUrl = '';
            let data = [];

            if (action === 'transactions' && address) {
              apiUrl = `${etherscanBaseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
              logger.info(`Calling Etherscan API for transactions: ${apiUrl}`, { ip });
              const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

              if (response.data.status === '1' && Array.isArray(response.data.result)) {
                data = response.data.result.map(tx => ({
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
                logger.warn(`Etherscan API returned status ${response.data.status} for transactions: ${response.data.message}`, { ip, address });
              }
              logger.info(`Transactions response for address ${address}: ${data.length} transactions, time: ${Date.now() - startTime}ms`, { ip });
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
            } else if (action === 'wallet-balances' && address) {
              apiUrl = `${etherscanBaseUrl}?module=account&action=balance&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
              logger.info(`Calling Etherscan API for balance: ${apiUrl}`, { ip });
              const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

              if (response.data.status === '1' && typeof response.data.result === 'string') {
                const ethBalanceWei = parseInt(response.data.result);
                data = [{
                  chain,
                  chain_id: null,
                  address,
                  symbol: chain === 'ethereum' ? 'ETH' : (chain === 'bnb' ? 'BNB' : 'Native'),
                  decimals: 18,
                  amount: ethBalanceWei / Math.pow(10, 18),
                  price_usd: 0,
                  value_usd: 0,
                  logo: null,
                }];
              } else {
                logger.warn(`Etherscan API returned status ${response.data.status} for balance: ${response.data.message}`, { ip, address });
              }
              logger.info(`Wallet balances response for address ${address}: ${data.length} tokens, time: ${Date.now() - startTime}ms`, { ip });
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
            } else if (action === 'token-supply' && tokenAddress) {
              apiUrl = `${etherscanBaseUrl}?module=stats&action=tokensupply&contractaddress=${tokenAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`;
              logger.info(`Calling Etherscan API for token supply: ${apiUrl}`, { ip });
              const response = await fetchWithRateLimit(apiUrl, { timeout: 15000 });

              if (response.data.status === '1' && typeof response.data.result === 'string') {
                const supply = response.data.result;
                controller.enqueue(JSON.stringify({ success: true, data: { tokenAddress, totalSupply: supply } }));
                controller.close();
              } else {
                logger.warn(`Etherscan API returned status ${response.data.status} for token supply: ${response.data.message}`, { ip, tokenAddress });
                controller.enqueue(JSON.stringify({ success: false, detail: 'Token supply not found or invalid token address.' }));
                controller.close();
              }
            } else if (action === 'token-info' && tokenAddress) {
              logger.warn(`'token-info' action not fully supported by Etherscan directly. Requires contract interaction for full details.`, { ip, tokenAddress });
              controller.enqueue(JSON.stringify({ success: true, data: { tokenAddress, name: 'Unknown', symbol: 'Unknown', decimals: 0, note: 'Requires contract interaction for full details' } }));
              controller.close();
            } else {
              logger.warn(`Invalid parameters for action: ${action}`, { ip });
              controller.enqueue(JSON.stringify({ detail: `Invalid parameters for action: ${action}` }));
              controller.close();
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
            controller.enqueue(JSON.stringify({ detail }));
            controller.close();
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Security-Policy': "default-src 'self'",
          'Access-Control-Allow-Origin': process.env.NODE_ENV === 'development' ? (origin || 'http://localhost:3000') : origin,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Token',
        },
      }
    );
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }
}