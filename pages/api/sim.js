// pages/api/sim.js
import axios from 'axios';
import winston from 'winston';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import Cors from 'cors';
import { isAddress } from 'ethers';
import { requireAuth } from './middleware/auth';

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// Rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

// Address-specific rate limiter
const addressLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.body.address,
  message: { error: 'Too many requests for this wallet address.' },
});

// Configure axios retry
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.response?.status === 429,
});

// CORS configuration
const cors = Cors({
  origin: process.env.NEXT_PUBLIC_APP_URL,
  methods: ['POST'],
});

// Validation middleware
const validate = [
  body('action')
    .isString()
    .isIn(['top-holders', 'wallet-balances', 'transactions'])
    .withMessage('Invalid action'),
  body('recaptchaToken').isString().notEmpty().withMessage('reCAPTCHA token is required'),
  body('chain')
    .if(body('action').equals('top-holders'))
    .isString()
    .notEmpty()
    .withMessage('Chain is required for top-holders'),
  body('tokenAddress')
    .if(body('action').equals('top-holders'))
    .isString()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Token address must be a valid EVM address for top-holders'),
  body('address')
    .if(body('action').isIn(['wallet-balances', 'transactions']))
    .notEmpty()
    .isString()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Wallet address must be a valid EVM address'),
  body('decimalPlace')
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage('Decimal place must be a non-negative integer'),
];

const CHAIN_ID_MAP = {
  abstract: '2741',
  ancient8: '888888888',
  ape_chain: '33139',
  arbitrum: '42161',
  arbitrum_nova: '42170',
  avalanche_c: '43114',
  avalanche_fuji: '43113',
  base: '8453',
  base_sepolia: '84532',
  berachain: '80094',
  blast: '81457',
  bnb: '56',
  bob: '60808',
  boba: '288',
  celo: '42220',
  corn: '21000000',
  cyber: '7560',
  degen: '666666666',
  ethereum: '1',
  fantom: '250',
  flare: '14',
  gnosis: '100',
  ham: '5112',
  hychain: '2911',
  ink: '57073',
  kaia: '8217',
  linea: '59144',
  lisk: '1135',
  mantle: '5000',
  metis: '1088',
  mint: '185',
  mode: '34443',
  omni: '166',
  opbnb: '204',
  optimism: '10',
  polygon: '137',
  proof_of_play: '70700',
  rari: '1380012617',
  redstone: '690',
  scroll: '534352',
  sei: '1329',
  sepolia: '11155111',
  shape: '360',
  soneium: '1868',
  sonic: '146',
  superseed: '5330',
  swellchain: '1923',
  unichain: '130',
  wemix: '1111',
  world: '480',
  xai: '660279',
  zero_network: '543210',
  zkevm: '1101',
  zksync: '324',
  zora: '7777777',
};

const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_ID_MAP).join(',');

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } };

export default async function handler(req, res) {
  // Apply CORS
  await new Promise((resolve, reject) => {
    cors(req, res, (err) => (err ? reject(err) : resolve()));
  });

  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const startTime = Date.now();
  logger.info(`Request to ${req.url} from IP ${ip}, body: ${JSON.stringify(req.body)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((resolve, reject) => {
      addressLimiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Rate limit exceeded, please try again later.' });
  }

  if (req.method !== 'POST') {
    logger.warn(`Invalid method ${req.method} for ${req.url}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  // Validate query parameters
  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  const { chain, tokenAddress, action, recaptchaToken, decimalPlace = 18, address } = req.body;

  // Require authentication for wallet-balances and transactions
  if (['wallet-balances', 'transactions'].includes(action)) {
    try {
      await new Promise((resolve, reject) => {
        requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      logger.error(`Authentication error: ${err.message}`);
      return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
    }
  }

  // Validate EVM address with ethers
  if (['wallet-balances', 'transactions'].includes(action) && address) {
    if (!isAddress(address)) {
      logger.warn(`Invalid EVM address: ${address}`);
      return res.status(400).json({ detail: 'Invalid EVM address' });
    }
  }

  // Verify reCAPTCHA with score check
  try {
    const recaptchaResult = await verifyRecaptcha(recaptchaToken, action, ip);
    if (action === 'wallet-balances' || action === 'transactions') {
      if (recaptchaResult.score < 0.7) {
        logger.warn(`reCAPTCHA score too low: ${recaptchaResult.score}`);
        return res.status(403).json({ detail: 'reCAPTCHA verification failed: score too low' });
      }
    }
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`);
    return res.status(403).json({ detail: `reCAPTCHA error: ${error.message}` });
  }

  // Check API key
  const SIM_API_KEY = process.env.SIM_API_KEY;
  if (!SIM_API_KEY) {
    logger.error('SIM_API_KEY is not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing SIM_API_KEY' });
  }

  try {
    if (action === 'top-holders' && chain && tokenAddress) {
      const chainId = CHAIN_ID_MAP[chain?.toLowerCase()];
      if (!chainId) {
        logger.warn(`Unsupported chain: ${chain}`);
        return res.status(400).json({ detail: `Unsupported chain: ${chain}` });
      }

      const url = `https://api.sim.dune.com/v1/evm/token-holders/${chainId}/${tokenAddress}?limit=100`;
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': SIM_API_KEY },
        timeout: 10000,
      });

      logger.info(`Top holders response for chain ${chain} (${chainId}): ${response.data.holders?.length || 0} holders, duration: ${Date.now() - startTime}ms`);
      if (process.env.NODE_ENV === 'development') {
        console.log('Top holders raw response:', {
          totalSupply: response.data.totalSupply,
          holders: response.data.holders.slice(0, 5),
        });
      }

      let effectiveDecimalPlace = Number(decimalPlace);
      if (isNaN(effectiveDecimalPlace) || effectiveDecimalPlace < 0 || effectiveDecimalPlace > 36) {
        logger.warn(`Invalid decimalPlace: ${decimalPlace}, defaulting to 18`);
        effectiveDecimalPlace = 18;
      }
      const knownTokens = {
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
        '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
      };
      if (knownTokens[tokenAddress.toLowerCase()] && effectiveDecimalPlace !== knownTokens[tokenAddress.toLowerCase()]) {
        logger.info(
          `Overriding decimalPlace for known token ${tokenAddress}: ${effectiveDecimalPlace} -> ${knownTokens[tokenAddress.toLowerCase()]}`
        );
        effectiveDecimalPlace = knownTokens[tokenAddress.toLowerCase()];
      }

      const data = response.data.holders?.map((holder) => {
        const rawBalance = Number(holder.balance) || 0;
        const balance = rawBalance / Math.pow(10, effectiveDecimalPlace);
        return {
          address: holder.wallet_address || 'Unknown',
          balance: Number(balance.toFixed(6)),
        };
      }) || [];

      logger.info(`Processed top holders data: ${data.length} holders`);
      if (process.env.NODE_ENV === 'development') {
      }

      return res.status(200).json({ success: true, data });
    } else if (action === 'wallet-balances' && address) {
      logger.info(`Processing wallet-balances for address: ${address}`);
      const url = `https://api.sim.dune.com/v1/evm/balances/${address}?chain_ids=${SUPPORTED_CHAIN_IDS}&metadata=logo&limit=100`;
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': SIM_API_KEY },
        timeout: 15000,
      });

      logger.info(`Wallet balances response for address ${address}: ${response.data.balances?.length || 0} tokens, duration: ${Date.now() - startTime}ms`);
      if (process.env.NODE_ENV === 'development') {
        console.log('Wallet balances raw response:', {
          wallet_address: response.data.wallet_address,
          balances: response.data.balances.slice(0, 5),
        });
      }

      const data = response.data.balances?.map((balance) => ({
        chain: balance.chain,
        chain_id: balance.chain_id,
        address: balance.address,
        symbol: balance.symbol || 'Unknown',
        decimals: balance.decimals || 18,
        amount: Number(balance.amount) / Math.pow(10, balance.decimals || 18),
        price_usd: balance.price_usd || 0,
        value_usd: balance.value_usd || 0,
        logo: balance.token_metadata?.logo || null,
      })) || [];

      logger.info(`Processed wallet balances data: ${data.length} tokens`);
      if (process.env.NODE_ENV === 'development') {
      }

      return res.status(200).json({ success: true, data });
    } else if (action === 'transactions' && address) {
      logger.info(`Processing transactions for address: ${address}`);
      const url = `https://api.sim.dune.com/v1/evm/transactions/${address}?chain_ids=${SUPPORTED_CHAIN_IDS}&limit=100`;
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': SIM_API_KEY },
        timeout: 15000,
      });

      logger.info(`Transactions response for address ${address}: ${response.data.transactions?.length || 0} transactions, duration: ${Date.now() - startTime}ms`);
      if (process.env.NODE_ENV === 'development') {
        console.log('Transactions raw response:', {
          wallet_address: response.data.wallet_address,
          transactions: response.data.transactions.slice(0, 5),
        });
      }

      const data = response.data.transactions?.map((tx) => ({
        chain: tx.chain,
        hash: tx.hash,
        from: tx.from,
        to: tx.to || 'None',
        value: tx.value || '0x0',
        block_time: tx.block_time,
      })) || [];

      logger.info(`Processed transactions data: ${data.length} transactions`);
      if (process.env.NODE_ENV === 'development') {
      }

      return res.status(200).json({ success: true, data });
    }

    logger.warn(`Invalid parameters for action: ${action}`);
    return res.status(400).json({ detail: `Invalid parameters for action: ${action}` });
  } catch (error) {
    logger.error(`Dune Sim API error for action ${action}: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'Dune Sim API rate limit exceeded, please try again later.'
        : status === 404
        ? 'Requested data not found.'
        : `Dune Sim API error: ${error.message}`;
    return res.status(status).json({ detail });
  }
}