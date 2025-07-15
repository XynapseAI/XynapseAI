// pages/api/blockchair.js
import axios from 'axios';
import Cors from 'cors';
import { logger } from '../../utils/logger.cjs';
import rateLimit from 'express-rate-limit';

const BLOCKCHAIR_API_URL = 'https://api.blockchair.com';
const CACHE_DURATION = 5 * 60 * 1000; // 5 phút
const cache = new Map();

// Cấu hình CORS
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

// Cấu hình rate-limit
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 100, // Giới hạn 100 yêu cầu/phút
  message: { success: false, detail: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

// Tạo axios instance với rate-limit
const blockchairAxios = axios.create({
  baseURL: BLOCKCHAIR_API_URL,
  headers: { 'Accept': 'application/json' },
  timeout: 15000,
  // Rate-limit cho axios
  maxRequests: 30,
  perMilliseconds: 60000,
});

export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
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

  // Áp dụng rate-limit
  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return res.status(429).json({ success: false, detail: 'Too many requests, please try again later.' });
  }

  if (req.method !== 'POST') {
    logger.error('Method not allowed', { method: req.method, ip });
    return res.status(405).json({ success: false, detail: 'Method not allowed' });
  }

  const { chain, limit = 100 } = req.body;

  // Validate chain
  const supportedChains = ['bitcoin', 'ethereum', 'dogecoin'];
  if (!chain || !supportedChains.includes(chain.toLowerCase())) {
    logger.error('Invalid or unsupported chain', { chain, ip });
    return res.status(400).json({ success: false, detail: 'Invalid or unsupported chain' });
  }

  // Kiểm tra cache
  const cacheKey = `blockchair-${chain}-top-holders-${limit}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
    logger.info('Serving top holders from cache', { cacheKey, chain, ip });
    return res.status(200).json({ success: true, data: cachedData.data });
  }

  try {
    // Gọi Blockchair API
    const response = await blockchairAxios.get(`/${chain}/addresses?limit=${limit}&sort=balance`);

    if (!response.data?.data) {
      logger.error('Invalid response from Blockchair API', { chain, ip });
      return res.status(500).json({ success: false, detail: 'Invalid response from Blockchair API' });
    }

    // Xử lý dữ liệu top holders
    const topHolders = response.data.data.map((holder) => ({
      address: holder.address,
      balance: parseFloat(holder.balance) / (chain === 'ethereum' ? 1e18 : 1e8),
      share: parseFloat(holder.share) || 0,
    }));

    // Lưu vào cache
    cache.set(cacheKey, { data: topHolders, timestamp: Date.now() });
    logger.info('Top holders fetched and cached from Blockchair', {
      chain,
      count: topHolders.length,
      sample: topHolders.slice(0, 3),
      ip,
    });

    return res.status(200).json({ success: true, data: topHolders });
  } catch (error) {
    logger.error('Error fetching Blockchair top holders', {
      chain,
      status: error.response?.status,
      message: error.message,
      data: error.response?.data,
      ip,
    });

    const errorMessage =
      error.response?.status === 429
        ? 'Blockchair API rate limit exceeded. Please try again later.'
        : error.response?.status === 400
          ? 'Invalid request to Blockchair API.'
          : error.response?.data?.error || `Failed to fetch top holders for ${chain}.`;

    return res.status(error.response?.status || 500).json({ success: false, detail: errorMessage });
  }
}