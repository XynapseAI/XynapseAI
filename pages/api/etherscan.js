// pages/api/etherscan.js
import axios from 'axios';
import winston from 'winston';
import { body, validationResult } from 'express-validator';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import Cors from 'cors';
import { isAddress } from 'ethers';
import { requireAuth } from './middleware/auth.js';

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV !== 'production'
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});

// CORS
const cors = Cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL,
      'http://localhost:3000',
      'https://xynapse-ai.vercel.app',
      'https://xynapseai.net',
      'https://app.xynapseai.net',
    ].filter(Boolean);
    logger.info(`CORS check: Origin ${origin || 'undefined'}, Allowed origins: ${allowedOrigins}`);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['POST'],
});

// Rate Limiting (in-memory store)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 phút
const RATE_LIMIT_MAX = 100; // 100 yêu cầu/phút/IP
const ADDRESS_RATE_LIMIT_MAX = 30; // 30 yêu cầu/phút/địa chỉ ví

const rateLimitMiddleware = (req, limit, key) => {
  const currentTime = Date.now();
  const windowStart = currentTime - RATE_LIMIT_WINDOW_MS;
  const requestKey = `${key}:${Math.floor(currentTime / RATE_LIMIT_WINDOW_MS)}`;
  
  const count = requestCounts.get(requestKey) || 0;
  if (count >= limit) {
    throw new Error(`Too many requests for ${key}`);
  }
  
  requestCounts.set(requestKey, count + 1);
  // Xóa các key cũ
  for (const [k] of requestCounts) {
    if (k.includes(key) && parseInt(k.split(':')[1]) < windowStart / RATE_LIMIT_WINDOW_MS) {
      requestCounts.delete(k);
    }
  }
};

// Axios Retry
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => Math.min(retryCount * 2000, 10000),
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
  onRetry: (retryCount, error) => {
    logger.warn(`Retrying Etherscan API request (attempt ${retryCount})`, {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
  },
});

// Validation Rules
const validate = [
  body('action')
    .isString()
    .isIn(['wallet-balances', 'transactions', 'token-supply', 'token-info'])
    .withMessage('Invalid action'),
  body('chain')
    .isString()
    .notEmpty()
    .withMessage('Chain is required'),
  body('address')
    .if(body('action').isIn(['wallet-balances', 'transactions']))
    .notEmpty()
    .isString()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Wallet address must be a valid EVM address'),
  body('tokenAddress')
    .if(body('action').isIn(['token-supply', 'token-info']))
    .isString()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Token address must be a valid EVM address'),
];

// Etherscan API Base URLs
const ETHERSCAN_API_URLS = {
  ethereum: 'https://api.etherscan.io/api',
  sepolia: 'https://api-sepolia.etherscan.io/api',
  bnb: 'https://api.bscscan.com/api',
  polygon: 'https://api.polygonscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api',
  optimism: 'https://api-optimistic.etherscan.io/api',
};

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } };

export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  const startTime = Date.now();
  logger.info(`Request to ${req.url} from IP ${ip}, body: ${JSON.stringify(req.body)}`);

  // Áp dụng CORS
  try {
    await new Promise((resolve, reject) => {
      cors(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`CORS error: ${err.message}`, { ip });
    return res.status(403).json({ success: false, detail: 'Not allowed by CORS' });
  }

  // Áp dụng helmet
  helmet()(req, res);

  // Áp dụng rate-limit thủ công
  try {
    rateLimitMiddleware(req, RATE_LIMIT_MAX, ip);
    if (req.body.address) {
      rateLimitMiddleware(req, ADDRESS_RATE_LIMIT_MAX, req.body.address);
    }
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return res.status(429).json({ success: false, detail: 'Too many requests, please try again later.' });
  }

  if (req.method !== 'POST') {
    logger.warn(`Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ success: false, detail: 'Method not allowed' });
  }

  // Validation
  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`, { ip });
    return res.status(400).json({ success: false, detail: 'Validation failed', errors: errors.array() });
  }

  const { chain, action, address, tokenAddress } = req.body;

  if (!process.env.ETHERSCAN_API_KEY) {
    logger.error('ETHERSCAN_API_KEY is not configured', { ip });
    return res.status(500).json({ success: false, detail: 'Server configuration error: Missing ETHERSCAN_API_KEY' });
  }

  const etherscanBaseUrl = ETHERSCAN_API_URLS[chain?.toLowerCase()];
  if (!etherscanBaseUrl) {
    logger.warn(`Unsupported chain for Etherscan: ${chain}`, { ip });
    return res.status(400).json({ success: false, detail: `Unsupported chain for Etherscan: ${chain}` });
  }

  // Yêu cầu xác thực cho wallet-balances và transactions
  if (['wallet-balances', 'transactions'].includes(action)) {
    const internalToken = req.headers['x-internal-token'];
    if (internalToken && internalToken === process.env.INTERNAL_API_TOKEN) {
      logger.info(`Bypassing auth with internal token for ${action}`, { ip });
    } else {
      try {
        await new Promise((resolve, reject) => {
          requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
        });
      } catch (err) {
        logger.error(`Authentication error: ${err.message}`, { ip });
        return res.status(401).json({ success: false, detail: 'Unauthorized: Please log in.' });
      }
    }
  }

  // Validate EVM address
  if (address && !isAddress(address)) {
    logger.warn(`Invalid EVM address: ${address}`, { ip });
    return res.status(400).json({ success: false, detail: 'Invalid EVM address' });
  }

  try {
    let apiUrl = '';
    let data = [];

    if (action === 'transactions' && address) {
      apiUrl = `${etherscanBaseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
      logger.info(`Calling Etherscan API for transactions: ${apiUrl}`, { ip });
      const response = await axios.get(apiUrl, { timeout: 15000 });

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
        logger.warn(`Etherscan API returned status ${response.data.status}: ${response.data.message}`, { ip, address });
      }
      logger.info(`Transactions response for address ${address}: ${data.length} transactions, time: ${Date.now() - startTime}ms`, { ip });
      return res.status(200).json({ success: true, data });

    } else if (action === 'wallet-balances' && address) {
      apiUrl = `${etherscanBaseUrl}?module=account&action=balance&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
      logger.info(`Calling Etherscan API for balance: ${apiUrl}`, { ip });
      const response = await axios.get(apiUrl, { timeout: 15000 });

      if (response.data.status === '1' && typeof response.data.result === 'string') {
        const ethBalanceWei = parseInt(response.data.result);
        data = [{
          chain,
          chain_id: null,
          address,
          symbol: chain === 'ethereum' ? 'ETH' : chain === 'bnb' ? 'BNB' : 'Native',
          decimals: 18,
          amount: ethBalanceWei / Math.pow(10, 18),
          price_usd: 0,
          value_usd: 0,
          logo: null,
        }];
      } else {
        logger.warn(`Etherscan API returned status ${response.data.status}: ${response.data.message}`, { ip, address });
      }
      logger.info(`Wallet balances response for address ${address}: ${data.length} tokens, time: ${Date.now() - startTime}ms`, { ip });
      return res.status(200).json({ success: true, data });

    } else if (action === 'token-supply' && tokenAddress) {
      apiUrl = `${etherscanBaseUrl}?module=stats&action=tokensupply&contractaddress=${tokenAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`;
      logger.info(`Calling Etherscan API for token supply: ${apiUrl}`, { ip });
      const response = await axios.get(apiUrl, { timeout: 15000 });

      if (response.data.status === '1' && typeof response.data.result === 'string') {
        const supply = response.data.result;
        return res.status(200).json({ success: true, data: { tokenAddress, totalSupply: supply } });
      } else {
        logger.warn(`Etherscan API returned status ${response.data.status}: ${response.data.message}`, { ip, tokenAddress });
        return res.status(404).json({ success: false, detail: 'Token supply not found or invalid token address.' });
      }

    } else if (action === 'token-info' && tokenAddress) {
      logger.warn(`'token-info' action not fully supported by Etherscan directly.`, { ip, tokenAddress });
      return res.status(200).json({ success: true, data: { tokenAddress, name: 'Unknown', symbol: 'Unknown', decimals: 0, note: 'Requires contract interaction for full details' } });
    }

    logger.warn(`Invalid parameters for action: ${action}`, { ip });
    return res.status(400).json({ success: false, detail: `Invalid parameters for action: ${action}` });
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
    return res.status(status).json({ success: false, detail });
  }
}