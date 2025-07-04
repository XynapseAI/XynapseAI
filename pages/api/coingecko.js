import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { query, validationResult } from 'express-validator';
import winston from 'winston';
import axiosRetry from 'axios-retry';
import { getSecrets } from '../../lib/vault'; // Thêm import

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

  const secrets = await getSecrets(); // Lấy bí mật từ Vault
  const COINGECKO_API_KEY = secrets.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' });
  }

  const { action, ids, convert, limit, start, query, id } = req.query;

  if (!axios || typeof axios.get !== 'function') {
    logger.error('Axios is not properly initialized');
    return res.status(500).json({ detail: 'Server error: Axios not initialized' });
  }

  try {
    if (action === 'list-all') {
      logger.warn(`Request to disabled endpoint`);
      return res.status(404).json({ detail: 'Endpoint disabled' });
    } else if (action === 'market-info') {
      if (!ids) {
        logger.warn(`Missing ids parameter`);
        return res.status(400).json({ detail: 'Missing ids parameter' });
      }
      const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
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
      logger.info(`Successfully fetched market data for ids: ${ids}`);
      return res.status(200).json(response.data);
    } else if (action === 'search') {
      if (!query) {
        logger.warn(`Missing query parameter`);
        return res.status(400).json({ detail: 'Missing query parameter' });
      }
      const response = await axios.get('https://api.coingecko.com/api/v3/search', {
        params: { query },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });
      logger.info(`Search successful for query: ${query}, results: ${response.data.coins.length}`);
      return res.status(200).json(response.data.coins);
    } else if (action === 'public-treasury') {
      if (!tokenType) {
        logger.warn(`Missing tokenType parameter`);
        return res.status(400).json({ detail: 'Missing tokenType parameter' });
      }
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/companies/public_treasury/${tokenType}`,
        {
          headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
          timeout: 15000,
        }
      );
      logger.info(`Successfully fetched public treasury data for ${tokenType}`);
      return res.status(200).json(response.data);
    } else if (action === 'tickers') {
      if (!id) {
        logger.warn(`Missing id parameter`);
        return res.status(400).json({ detail: 'Missing id parameter' });
      }
      const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/tickers`, {
        params: { include_exchange_logo: true },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });
      logger.info(`Successfully fetched ticker data for id: ${id}, count: ${response.data.tickers.length}`);
      return res.status(200).json(response.data);
    } else if (action === 'coin-details') {
      if (!id) {
        logger.warn(`Missing id parameter`);
        return res.status(400).json({ detail: 'Missing id parameter' });
      }
      const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}`, {
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
      logger.info(`Successfully fetched coin details for id: ${id}`);
      return res.status(200).json(response.data);
    } else {
      const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
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
      logger.info(`Successfully fetched default market data, count: ${response.data.length}`);
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
        ? 'CoinGecko API rate limit exceeded, please try again later.'
        : status === 404
        ? 'Requested data not found.'
        : 'Failed to fetch market data.';
    return res.status(status).json({ detail });
  }
}