import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { query, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';

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
});

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.response?.status === 429,
});

const validate = [
  query('id').notEmpty().isString().isLength({ max: 100 }).withMessage('Invalid token ID'),
  query('vs_currency').optional().isIn(['usd', 'eur', 'btc']).withMessage('Invalid currency'),
  query('days').isIn(['0.5', '1', '7', '30', '90', '365']).withMessage('Invalid days parameter'),
  query('recaptchaToken').notEmpty().isString().withMessage('reCAPTCHA token is required'),
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

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  const { id, vs_currency = 'usd', days = '30', recaptchaToken } = req.query;

  try {
    await verifyRecaptcha(recaptchaToken, 'fetch_price_history', ip);
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`);
    return res.status(403).json({ detail: `reCAPTCHA error: ${error.message}` });
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing COINGECKO_API_KEY' });
  }

  try {
    const endDate = Math.floor(Date.now() / 1000);
    const parsedDays = parseFloat(days);
    const startDate = endDate - parsedDays * 24 * 60 * 60;

    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range`, {
      params: {
        vs_currency,
        from: startDate,
        to: endDate,
      },
      headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
      timeout: 10000,
    });

    let prices = response.data.prices;

    if (parsedDays === 0.5) {
      prices = prices
        .filter((_, index) => index % Math.ceil(prices.length / 144) === 0)
        .slice(-144);
    } else if (parsedDays === 1) {
      prices = prices
        .filter((_, index) => index % Math.ceil(prices.length / 24) === 0)
        .slice(-24);
    }

    return res.status(200).json({ prices });
  } catch (err) {
    logger.error(`Error fetching historical data: ${err.message}`, {
      status: err.response?.status,
      data: err.response?.data,
    });
    const status = err.response?.status || 500;
    const detail =
      status === 429
        ? 'CoinGecko API rate limit exceeded, please try again later.'
        : status === 404
        ? `Token ID ${id} not found.`
        : 'Failed to fetch historical data.';
    return res.status(status).json({ detail });
  }
}