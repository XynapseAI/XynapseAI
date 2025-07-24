import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { query, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import { createClient } from 'redis';
import Bottleneck from 'bottleneck'; // Thêm Bottleneck

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
  max: 10,
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

// Cấu hình Bottleneck
const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 1,
  minTime: process.env.NODE_ENV === 'production' ? 200 : 2000,
});

// Bọc axios.get trong Bottleneck
const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  return await axios.get(url, config);
});

const validate = [
  query('action')
    .optional()
    .isIn(['market-info', 'search', 'public-treasury', 'tickers', 'coin-details'])
    .withMessage('Invalid action'),
  query('ids').optional().isString().isLength({ max: 100 }).withMessage('Invalid IDs'),
  query('convert').optional().isIn(['usd', 'eur', 'btc']).withMessage('Invalid currency'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  query('start').optional().isInt({ min: 1 }).withMessage('Invalid start'),
  query('query').optional().isString().isLength({ max: 100 }).withMessage('Invalid query'),
  query('tokenType')
    .if(query('action').equals('public-treasury'))
    .notEmpty()
    .isIn(['bitcoin', 'ethereum'])
    .withMessage('Invalid token type'),
  query('id')
    .if(query('action').isIn(['tickers', 'coin-details']))
    .notEmpty()
    .isString()
    .isLength({ max: 100 })
    .withMessage('Invalid token ID'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to /api/coingecko from IP ${ip}, query: ${JSON.stringify(req.query)}`);

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

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  const { action, ids, convert, limit, start, query, id, tokenType } = req.query;

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' });
  }

  try {
    if (action === 'public-treasury') {
      if (!tokenType) {
        logger.warn(`Missing tokenType parameter`);
        return res.status(400).json({ detail: 'Missing tokenType parameter' });
      }
      const cacheKey = `coingecko_public_treasury_${tokenType}`;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Returning cached public treasury data for ${tokenType}`);
        return res.status(200).json({ success: true, data: JSON.parse(cachedData) });
      }

      const response = await fetchWithRateLimit(
        `https://api.coingecko.com/api/v3/companies/public_treasury/${tokenType}`,
        {
          headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
          timeout: 15000,
        }
      );

      const data = response.data || { companies: [] };
      await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(data)); // Cache 12 giờ
      logger.info(`Successfully fetched and cached public treasury data for ${tokenType}`);
      return res.status(200).json({ success: true, data });
    } else if (action === 'market-info') {
      if (!ids) {
        logger.warn(`Missing ids parameter`);
        return res.status(400).json({ detail: 'Missing ids parameter' });
      }
      const cacheKey = `coingecko_market_info_${ids}_${convert || 'usd'}`;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Returning cached market info for ids: ${ids}`);
        return res.status(200).json(JSON.parse(cachedData));
      }

      const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/coins/markets', {
        params: {
          vs_currency: convert || 'usd',
          ids: ids,
          order: 'market_cap_desc',
          per_page: 1,
          page: 1,
          sparkline: false,
          price_change_percentage: '24h',
        },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });

      await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(response.data)); // Cache 12 giờ
      logger.info(`Successfully fetched and cached market data for ids: ${ids}`);
      return res.status(200).json(response.data);
    } else if (action === 'search') {
      if (!query) {
        logger.warn(`Missing query parameter`);
        return res.status(400).json({ detail: 'Missing query parameter' });
      }
      const cacheKey = `coingecko_search_${query}`;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Returning cached search data for query: ${query}`);
        return res.status(200).json(JSON.parse(cachedData));
      }

      const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/search', {
        params: { query },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });

      await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(response.data.coins)); // Cache 12 giờ
      logger.info(`Search successful for query: ${query}, results: ${response.data.coins.length}`);
      return res.status(200).json(response.data.coins);
    } else if (action === 'tickers') {
      if (!id) {
        logger.warn(`Missing id parameter`);
        return res.status(400).json({ detail: 'Missing id parameter' });
      }
      const cacheKey = `coingecko_tickers_${id}`;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Returning cached ticker data for id: ${id}`);
        return res.status(200).json(JSON.parse(cachedData));
      }

      const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${id}/tickers`, {
        params: { include_exchange_logo: true },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });

      await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(response.data)); // Cache 12 giờ
      logger.info(`Successfully fetched and cached ticker data for id: ${id}, count: ${response.data.tickers.length}`);
      return res.status(200).json(response.data);
    } else if (action === 'coin-details') {
      if (!id) {
        logger.warn(`Missing id parameter`);
        return res.status(400).json({ detail: 'Missing id parameter' });
      }
      const cacheKey = `coingecko_coin_details_${id}`;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Returning cached coin details for id: ${id}`);
        return res.status(200).json(JSON.parse(cachedData));
      }

      const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${id}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false,
        },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });

      await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(response.data)); // Cache 12 giờ
      logger.info(`Successfully fetched and cached coin details for id: ${id}`);
      return res.status(200).json(response.data);
    } else {
      const cacheKey = `coingecko_default_markets_${convert || 'usd'}_${start || 1}_${limit || 30}`;
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Returning cached default market data`);
        return res.status(200).json(JSON.parse(cachedData));
      }

      const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/coins/markets', {
        params: {
          vs_currency: convert || 'usd',
          order: 'market_cap_desc',
          per_page: limit || 30,
          page: start || 1,
          sparkline: false,
          price_change_percentage: '24h',
        },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });

      await redisClient.setEx(cacheKey, 12 * 3600, JSON.stringify(response.data)); // Cache 12 giờ
      logger.info(`Successfully fetched and cached default market data, count: ${response.data.length}`);
      return res.status(200).json(response.data);
    }
  } catch (error) {
    logger.error(`CoinGecko API error: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'Please wait a moment and try again.'
        : status === 404
        ? 'Requested data not found.'
        : `Failed to fetch market data: ${error.message}`;
    return res.status(status).json({ success: false, detail });
  }
}