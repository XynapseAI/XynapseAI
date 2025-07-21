// pages/api/coingecko/market_chart.js
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { query, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';

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

const validate = [
  query('id').notEmpty().isString().isLength({ max: 100 }).withMessage('Invalid token ID'),
  query('days').isNumeric().withMessage('Days must be a number'),
  query('currency').isString().withMessage('Currency must be a string'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to /api/coingecko/market_chart from IP ${ip}, query: ${JSON.stringify(req.query)}`);

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  let { id, days, currency } = req.query;
  // Adjust days to avoid hourly interval restriction
  days = parseFloat(days) < 1 ? 1 : days;

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY is not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' });
  }

  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart`, {
      params: {
        vs_currency: currency,
        days: days,
      },
      headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
      timeout: 15000,
    });

    const prices = response.data.prices;
    if (!prices || !Array.isArray(prices) || prices.length === 0) {
      logger.error(`Invalid or empty price data for id: ${id}, days: ${days}`);
      return res.status(500).json({ detail: 'Invalid or empty price data' });
    }

    // For days=0.5, filter prices to the last 12 hours
    if (parseFloat(req.query.days) === 0.5) {
      const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
      const filteredPrices = prices.filter(([timestamp]) => timestamp >= twelveHoursAgo);
      const high = Math.max(...filteredPrices.map((price) => price[1]));
      const low = Math.min(...filteredPrices.map((price) => price[1]));
      return res.status(200).json({ prices: filteredPrices, high, low });
    }

    const high = Math.max(...prices.map((price) => price[1]));
    const low = Math.min(...prices.map((price) => price[1]));

    logger.info(`Successfully fetched market chart for id: ${id}, days: ${days}`);
    return res.status(200).json({ prices, high, low });
  } catch (error) {
    logger.error(`Error fetching market chart: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
      url: `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${currency}&days=${days}`,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'CoinGecko API rate limit exceeded, please try again later.'
        : status === 401
        ? 'CoinGecko API authentication failed. Please check your API key and try again later.'
        : status === 404
        ? `Token ID ${id} not found.`
        : `Failed to fetch market chart: ${error.message}`;
    return res.status(status).json({ detail });
  }
}