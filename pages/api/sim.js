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

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(), // Log ra console cho Vercel
    ...(process.env.NODE_ENV !== 'production'
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
    return ip;
  },
  trustProxy: true,
});

const addressLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => {
    return req.body?.address || 'unknown-address';
  },
  message: { error: 'Quá nhiều yêu cầu cho địa chỉ ví này.' },
  trustProxy: true,
});

axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => Math.min(retryCount * 2000, 10000), // Giới hạn delay tối đa 10s
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
  onRetry: (retryCount, error) => {
    logger.warn(`Retrying Dune API request (attempt ${retryCount})`, {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
  },
});

const cors = Cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL,
      'http://localhost:3000',
      'https://xynapse-ai.vercel.app', // Thêm rõ ràng domain Vercel
    ].filter(Boolean);
    logger.info(`CORS check: Origin ${origin}, Allowed origins: ${allowedOrigins}`);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['POST'],
});

const validate = [
  body('action')
    .isString()
    .isIn(['top-holders', 'wallet-balances', 'transactions'])
    .withMessage('Hành động không hợp lệ'),
  body('recaptchaToken').isString().notEmpty().withMessage('Yêu cầu token reCAPTCHA'),
  body('chain')
    .if(body('action').equals('top-holders'))
    .isString()
    .notEmpty()
    .withMessage('Yêu cầu chain cho top-holders'),
  body('tokenAddress')
    .if(body('action').equals('top-holders'))
    .isString()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Địa chỉ token phải là địa chỉ EVM hợp lệ cho top-holders'),
  body('address')
    .if(body('action').isIn(['wallet-balances', 'transactions']))
    .notEmpty()
    .isString()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Địa chỉ ví phải là địa chỉ EVM hợp lệ'),
  body('decimalPlace')
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage('Số thập phân phải là số nguyên không âm'),
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
  await new Promise((resolve, reject) => {
    cors(req, res, (err) => (err ? reject(err) : resolve()));
  });

  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  const startTime = Date.now();
  logger.info(`Yêu cầu tới ${req.url} từ IP ${ip}, body: ${JSON.stringify(req.body)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((resolve, reject) => {
      addressLimiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`);
    return res.status(429).json({ detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
  }

  if (req.method !== 'POST') {
    logger.warn(`Phương thức không được phép: ${req.method}`);
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Xác thực thất bại', errors: errors.array() });
  }

  const { chain, tokenAddress, action, recaptchaToken, decimalPlace = 18, address } = req.body;

  if (['wallet-balances', 'transactions'].includes(action)) {
    try {
      await new Promise((resolve, reject) => {
        requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      logger.error(`Lỗi xác thực: ${err.message}`);
      return res.status(401).json({ detail: 'Chưa đăng nhập: Vui lòng đăng nhập.' });
    }
  }

  if (!process.env.SIM_API_KEY) {
  logger.error('SIM_API_KEY is not configured');
  return res.status(500).json({ detail: 'Server configuration error: Missing SIM_API_KEY' });
}
if (!process.env.NEXT_PUBLIC_APP_URL) {
  logger.error('NEXT_PUBLIC_APP_URL is not configured');
}
logger.info(`CORS configured for origin: ${process.env.NEXT_PUBLIC_APP_URL}`);

  if (['wallet-balances', 'transactions'].includes(action) && address) {
    if (!isAddress(address)) {
      logger.warn(`Địa chỉ EVM không hợp lệ: ${address}`);
      return res.status(400).json({ detail: 'Địa chỉ EVM không hợp lệ' });
    }
  }

  try {
  const recaptchaResult = await verifyRecaptcha(recaptchaToken, action, ip);
  logger.info(`reCAPTCHA score for ${action}: ${recaptchaResult.score}`);
  if (['wallet-balances', 'transactions'].includes(action) && recaptchaResult.score < 0.7) {
    logger.warn(`reCAPTCHA score too low: ${recaptchaResult.score}`);
    return res.status(403).json({ detail: 'reCAPTCHA verification failed: score too low' });
  }
} catch (error) {
  logger.error(`reCAPTCHA verification failed: ${error.message}`);
  return res.status(403).json({ detail: `reCAPTCHA error: ${error.message}` });
}

  const SIM_API_KEY = process.env.SIM_API_KEY;
  if (!SIM_API_KEY) {
    logger.error('SIM_API_KEY không được cấu hình');
    return res.status(500).json({ detail: 'Lỗi cấu hình server: Thiếu SIM_API_KEY' });
  }

  if (!axios || typeof axios.get !== 'function') {
    logger.error('Axios không được khởi tạo đúng cách');
    return res.status(500).json({ detail: 'Lỗi server: Axios không được khởi tạo' });
  }

  try {
    if (action === 'top-holders' && chain && tokenAddress) {
      const chainId = CHAIN_ID_MAP[chain?.toLowerCase()];
      if (!chainId) {
        logger.warn(`Chuỗi không được hỗ trợ: ${chain}`);
        return res.status(400).json({ detail: `Chuỗi không được hỗ trợ: ${chain}` });
      }

      const url = `https://api.sim.dune.com/v1/evm/token-holders/${chainId}/${tokenAddress}?limit=100`;
      logger.info(`Gọi API Dune Sim: ${url}`);
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': SIM_API_KEY },
        timeout: 15000,
      });

      logger.info(`Phản hồi top holders cho chuỗi ${chain} (${chainId}): ${response.data.holders?.length || 0} holders, thời gian: ${Date.now() - startTime}ms`);
      if (process.env.NODE_ENV === 'development') {
        console.log('Phản hồi thô top holders:', {
          totalSupply: response.data.totalSupply,
          holders: response.data.holders.slice(0, 5),
        });
      }

      let effectiveDecimalPlace = Number(decimalPlace);
      if (isNaN(effectiveDecimalPlace) || effectiveDecimalPlace < 0 || effectiveDecimalPlace > 36) {
        logger.warn(`Số thập phân không hợp lệ: ${decimalPlace}, mặc định là 18`);
        effectiveDecimalPlace = 18;
      }
      const knownTokens = {
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
        '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
      };
      if (knownTokens[tokenAddress.toLowerCase()] && effectiveDecimalPlace !== knownTokens[tokenAddress.toLowerCase()]) {
        logger.info(
          `Ghi đè số thập phân cho token đã biết ${tokenAddress}: ${effectiveDecimalPlace} -> ${knownTokens[tokenAddress.toLowerCase()]}`
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

      logger.info(`Dữ liệu top holders đã xử lý: ${data.length} holders`);
      return res.status(200).json({ success: true, data });
    } else if (action === 'wallet-balances' && address) {
      logger.info(`Xử lý wallet-balances cho địa chỉ: ${address}`);
      const url = `https://api.sim.dune.com/v1/evm/balances/${address}?chain_ids=${SUPPORTED_CHAIN_IDS}&metadata=logo&limit=100`;
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': SIM_API_KEY },
        timeout: 15000,
      });

      logger.info(`Phản hồi wallet balances cho địa chỉ ${address}: ${response.data.balances?.length || 0} tokens, thời gian: ${Date.now() - startTime}ms`);
      if (process.env.NODE_ENV === 'development') {
        console.log('Phản hồi thô wallet balances:', {
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

      logger.info(`Dữ liệu wallet balances đã xử lý: ${data.length} tokens`);
      return res.status(200).json({ success: true, data });
    } else if (action === 'transactions' && address) {
      logger.info(`Xử lý transactions cho địa chỉ: ${address}`);
      const url = `https://api.sim.dune.com/v1/evm/transactions/${address}?chain_ids=${SUPPORTED_CHAIN_IDS}&limit=100`;
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': SIM_API_KEY },
        timeout: 15000,
      });

      logger.info(`Phản hồi transactions cho địa chỉ ${address}: ${response.data.transactions?.length || 0} transactions, thời gian: ${Date.now() - startTime}ms`);
      if (process.env.NODE_ENV === 'development') {
        console.log('Phản hồi thô transactions:', {
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

      logger.info(`Dữ liệu transactions đã xử lý: ${data.length} transactions`);
      return res.status(200).json({ success: true, data });
    }

    logger.warn(`Tham số không hợp lệ cho hành động: ${action}`);
    return res.status(400).json({ detail: `Tham số không hợp lệ cho hành động: ${action}` });
  } catch (error) {
    logger.error(`Lỗi API Dune Sim cho hành động ${action}: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'Vượt quá giới hạn API Dune Sim, vui lòng thử lại sau.'
        : status === 404
        ? 'Không tìm thấy dữ liệu yêu cầu.'
        : `Lỗi API Dune Sim: ${error.message}`;
    return res.status(status).json({ detail });
  }
}