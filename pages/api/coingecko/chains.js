import axios from 'axios';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import NodeCache from 'node-cache';
import cors from 'cors'; // Add CORS import

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
    return ip;
  },
  trustProxy: true,
});

// Configure CORS to allow requests from the frontend origin
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : 'http://localhost:3000',
  credentials: true, // Allow cookies to be sent
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.response?.status === 429,
});

const cache = new NodeCache({ stdTTL: 1800 }); // Cache for 30 minutes

export default async function handler(req, res) {
  // Apply CORS middleware
  await new Promise((resolve, reject) => {
    cors(corsOptions)(req, res, (err) => (err ? reject(err) : resolve()));
  });

  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to /api/coingecko/chains from IP ${ip}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  const cacheKey = 'coingecko_chains';
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    logger.info('Returning cached CoinGecko chains', {
      count: cachedData.length,
      sample: cachedData.slice(0, 3).map((c) => ({ id: c.id, name: c.name, image: c.image?.thumb })),
    });
    return res.status(200).json({ success: true, data: cachedData });
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' });
  }

  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
      timeout: 15000,
    });

    const chains = response.data.map((chain) => ({
      id: chain.id,
      name: chain.name,
      chainId: chain.chain_identifier,
      shortname: chain.shortname || chain.name,
      image: chain.image || { thumb: '/fallback-image.png', small: '/fallback-image.png', large: '/fallback-image.png' },
    }));

    cache.set(cacheKey, chains);
    logger.info(`Successfully fetched ${chains.length} chains from CoinGecko`, {
      sample: chains.slice(0, 5).map((c) => ({
        id: c.id,
        name: c.name,
        image: c.image?.large,
      })),
    });
    return res.status(200).json({ success: true, data: chains });
  } catch (error) {
    logger.error(`Error fetching CoinGecko chains: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'CoinGecko API rate limit exceeded, please try again later.'
        : `Failed to fetch chains: ${error.message}`;
    return res.status(status).json({ detail });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10kb',
    },
  },
};