import { createClient } from 'redis';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck'; // Thêm Bottleneck

// Cấu hình Bottleneck để giới hạn yêu cầu API
const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 1, // 5 yêu cầu đồng thời trong production, 1 trong development
  minTime: process.env.NODE_ENV === 'production' ? 200 : 2000, // 0.2s (300 req/phút) trong production, 2s (30 req/phút) trong development
});

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

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.response?.status === 429,
});

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

// Bọc axios.get trong Bottleneck
const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  return await axios.get(url, config);
});

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to /api/coingecko/token/${req.query.slug} from IP ${ip}`);

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

  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    logger.warn('Invalid slug provided');
    return res.status(400).json({ detail: 'Invalid token slug' });
  }

  const cacheKey = `coingecko_token_${slug}`;
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    logger.info('Returning cached token data', { slug });
    return res.status(200).json({ success: true, data: JSON.parse(cachedData) });
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' });
  }

  try {
    const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${slug}`, {
      headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
      timeout: 15000,
      params: {
        localization: false,
        tickers: true,
        market_data: true,
        community_data: false,
        developer_data: false,
        sparkline: false,
      },
    });

    const tokenData = {
      id: response.data.id,
      symbol: response.data.symbol,
      name: response.data.name,
      image: response.data.image?.large || '/fallback-image.png',
      current_price: response.data.market_data?.current_price || {},
      market_cap: response.data.market_data?.market_cap || {},
      market_cap_rank: response.data.market_data?.market_cap_rank || null,
      fully_diluted_valuation: response.data.market_data?.fully_diluted_valuation || {},
      total_volume: response.data.market_data?.total_volume || {},
      high_24h: response.data.market_data?.high_24h || {},
      low_24h: response.data.market_data?.low_24h || {},
      price_change_percentage_1h_in_currency: response.data.market_data?.price_change_percentage_1h_in_currency || {},
      price_change_percentage_24h_in_currency: response.data.market_data?.price_change_percentage_24h_in_currency || {},
      price_change_percentage_7d_in_currency: response.data.market_data?.price_change_percentage_7d_in_currency || {},
      price_change_percentage_30d_in_currency: response.data.market_data?.price_change_percentage_30d_in_currency || {},
      price_change_percentage_90d_in_currency: response.data.market_data?.price_change_percentage_90d_in_currency || {},
      price_change_percentage_1y_in_currency: response.data.market_data?.price_change_percentage_1y_in_currency || {},
      price_change_percentage_24h: response.data.market_data?.price_change_percentage_24h || null,
      circulating_supply: response.data.market_data?.circulating_supply || null,
      total_supply: response.data.market_data?.total_supply || null,
      max_supply: response.data.market_data?.max_supply || null,
      ath: response.data.market_data?.ath || {},
      ath_change_percentage: response.data.market_data?.ath_change_percentage || {},
      atl: response.data.market_data?.atl || {},
      atl_change_percentage: response.data.market_data?.atl_change_percentage || {},
      links: {
        homepage: response.data.links?.homepage || [],
        twitter_screen_name: response.data.links?.twitter_screen_name || null,
        chat_url: response.data.links?.chat_url || [],
        repos_url: response.data.links?.repos_url || { github: [] },
      },
      detail_platforms: response.data.detail_platforms || {},
    };

    await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(tokenData)); // Cache 12 giờ
    logger.info(`Successfully fetched token data for ${slug}`, {
      id: tokenData.id,
      name: tokenData.name,
      symbol: tokenData.symbol,
    });
    return res.status(200).json({ success: true, data: tokenData });
  } catch (error) {
    logger.error(`Error fetching token data for ${slug}: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'Please wait a moment and try again.'
        : status === 404
        ? 'Token not found'
        : `Failed to fetch token data: ${error.message}`;
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