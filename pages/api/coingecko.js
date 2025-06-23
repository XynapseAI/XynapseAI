import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { query, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha';

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
  query('ids').optional().isString().isLength({ max: 100 }).withMessage('Invalid ids'),
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
  query('recaptchaToken')
    .if(query('action').not().equals('search'))
    .notEmpty()
    .isString()
    .withMessage('reCAPTCHA token is required'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Rate limit exceeded, please try again later.' });
  }

  if (req.method !== 'GET') {
    logger.warn(`Invalid method ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  const { action, ids, convert, limit, start, query, recaptchaToken, id } = req.query;

  if (action !== 'search') {
    try {
      await verifyRecaptcha(recaptchaToken, action || 'fetch_market_data', ip);
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`);
      return res.status(403).json({ detail: `reCAPTCHA error: ${error.message}` });
    }
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' });
  }

  try {
    if (action === 'list-all') {
      logger.warn(`Attempt to access disabled endpoint`);
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
        timeout: 10000,
      });
      return res.status(200).json(response.data);
    } else if (action === 'search') {
      if (!query) {
        logger.warn(`Missing query parameter`);
        return res.status(400).json({ detail: 'Missing query parameter' });
      }
      const response = await axios.get('https://api.coingecko.com/api/v3/search', {
        params: { query },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 10000,
      });
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
          timeout: 10000,
        }
      );
      return res.status(200).json(response.data);
    } else if (action === 'tickers') {
      if (!id) {
        logger.warn(`Missing id parameter`);
        return res.status(400).json({ detail: 'Missing id parameter' });
      }
      const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/tickers`, {
        params: { include_exchange_logo: true },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 10000,
      });
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
        timeout: 10000,
      });
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
        timeout: 10000,
      });
      return res.status(200).json(response.data);
    }
  } catch (error) {
    logger.error(`Error fetching CoinGecko data: ${error.message}`, {
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