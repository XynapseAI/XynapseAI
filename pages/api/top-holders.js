// pages/api/top-holders.js
import { createClient } from 'redis';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
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

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

export default async function handler(req, res) {
  limiter(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to /api/top-holders from IP ${ip}`);

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  const { slug, chain } = req.query;
  if (!slug || !chain) {
    logger.warn('Missing slug or chain');
    return res.status(400).json({ detail: 'Missing slug or chain parameter' });
  }

  const cacheKey = `top-holders_${slug}_${chain}`;
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    logger.info(`Returning cached top holders data for ${slug} on ${chain}`);
    return res.status(200).json({ success: true, data: JSON.parse(cachedData) });
  }

  try {
    if (['bitcoin', 'ethereum'].includes(chain)) {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_APP_URL || 'https://xynapse-ai.vercel.app'}/api/coingecko`,
        {
          params: { action: 'public-treasury', tokenType: chain },
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );

      if (!response.data.success || !response.data.data?.companies) {
        throw new Error(response.data.detail || `No public treasury data for ${chain}`);
      }

      const topHolders = response.data.data.companies.map((company) => ({
        address: company.address || 'Unknown',
        balance: parseFloat(company.total_holdings) || 0,
        share: parseFloat(company.total_value_usd) / company.total_holdings || 0,
        nameTag: company.name || null,
        image: null,
        source: 'CoinGecko',
      }));

      await redisClient.setEx(cacheKey, 3600, JSON.stringify(topHolders));
      logger.info(`Successfully fetched top holders for ${slug} on ${chain}`);
      return res.status(200).json({ success: true, data: topHolders });
    }

    // For EVM chains, use /api/sim
    const response = await axios.post(
      `${process.env.NEXT_PUBLIC_APP_URL || 'https://xynapse-ai.vercel.app'}/api/sim`,
      {
        action: 'top-holders',
        chain,
        tokenAddress: slug, // Assuming slug is tokenAddress or needs mapping
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.detail || 'Failed to fetch top holders');
    }

    const topHolders = response.data.data || [];
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(topHolders));
    logger.info(`Successfully fetched top holders for ${slug} on ${chain}`);
    return res.status(200).json({ success: true, data: topHolders });
  } catch (error) {
    logger.error(`Error fetching top holders for ${slug} on ${chain}: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'API rate limit exceeded, please try again later.'
        : status === 404
        ? 'Top holders not found'
        : `Failed to fetch top holders: ${error.message}`;
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