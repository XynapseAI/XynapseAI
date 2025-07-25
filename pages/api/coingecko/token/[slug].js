// pages/api/coingecko/token/[slug].js
import axios from 'axios';
import connectRedis from '../../../../lib/redis';
import Bottleneck from 'bottleneck';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 1,
  minTime: process.env.NODE_ENV === 'production' ? 200 : 2000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await axios.get(url, {
      ...config,
      headers: {
        ...config.headers,
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || '',
      },
    });
    return response;
  } catch (error) {
    if (error.response?.status === 429 && config.retryCount < 3) {
      const delay = Math.pow(2, config.retryCount) * 1000 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRateLimit(url, { ...config, retryCount: config.retryCount + 1 });
    }
    throw error;
  }
});

export default async function handler(req, res) {
  const { slug } = req.query;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to /api/coingecko/token/${slug} from IP ${ip}`);

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ success: false, detail: 'Method not allowed' });
  }

  if (!slug || typeof slug !== 'string') {
    logger.warn('Invalid slug provided');
    return res.status(400).json({ success: false, detail: 'Invalid token slug' });
  }

  let redisClient;
  try {
    redisClient = await connectRedis();
    const cacheKey = `coingecko_token_${slug}`;
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      logger.info('Returning cached token data', { slug });
      return res.status(200).json({ success: true, data: JSON.parse(cachedData) });
    }

    const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
    if (!COINGECKO_API_KEY) {
      logger.error('COINGECKO_API_KEY is not configured');
      return res.status(500).json({ success: false, detail: 'Server configuration error: Missing COINGECKO_API_KEY' });
    }

    const response = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/coins/${slug}`,
      {
        timeout: 15000,
        params: {
          localization: false,
          tickers: true,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false,
        },
        retryCount: 0,
      }
    );

    const tokenData = {
      id: response.data.id,
      symbol: response.data.symbol,
      name: response.data.name,
      image: response.data.image?.large || '/fallback-image.png',
      current_price: response.data.market_data?.current_price || {},
      market_cap: response.data.market_data?.market_cap || {},
      market_cap_rank: response.data.market_data?.market_cap_rank || null,
      fully_diluted_valuation: response.data.market_data?.fully_diluted_valuation || null,
      total_volume: response.data.market_data?.total_volume || {},
      high_24h: response.data.market_data?.high_24h || {},
      low_24h: response.data.market_data?.low_24h || null,
      price_change_percentage_1h_in_currency: response.data.market_data?.price_change_percentage_1h_in_currency || null,
      price_change_percentage_24h_in_currency: response.data.market_data?.price_change_percentage_24h_in_currency || null,
      price_change_percentage_7d_in_currency: response.data.market_data?.price_change_percentage_7d_in_currency || null,
      price_change_percentage_30d_in_currency: response.data.market_data?.price_change_percentage_30d_in_currency || null,
      price_change_percentage_90d_in_currency: response.data.market_data?.price_change_percentage_90d_in_currency || null,
      price_change_percentage_1y_in_currency: response.data.market_data?.price_change_percentage_1y_in_currency || null,
      price_change_percentage_24h: response.data.market_data?.price_change_percentage_24h || null,
      circulating_supply: response.data.market_data?.circulating_supply || null,
      total_supply: response.data.market_data?.total_supply || null,
      max_supply: response.data.market_data?.max_supply || null,
      ath: response.data.market_data?.ath || null,
      ath_change_percentage: response.data.market_data?.ath_change_percentage || null,
      atl: response.data.market_data?.atl || null,
      atl_change_percentage: response.data.market_data?.atl_change_percentage || null,
      links: {
        homepage: response.data.links?.homepage || [],
        twitter_screen_name: response.data.links?.twitter_screen_name || null,
        chat_url: response.data.links?.chat_url || [],
        repos_url: response.data.links?.repos_url || { github: [] },
      },
      detail_platforms: response.data.detail_platforms || {},
    };

    await redisClient.setEx(cacheKey, 60, JSON.stringify(tokenData));
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
      stack: error.stack,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'Please wait a moment and try again.'
        : status === 404
        ? `Token with slug ${slug} could not be found`
        : `Failed to fetch token data: ${error.message}`;
    return res.status(status).json({ success: false, detail });
  } finally {
    if (redisClient?.isOpen) {
      try {
        await redisClient.quit();
      } catch (quitError) {
        logger.error(`Error closing Redis connection: ${quitError.message}`);
      }
    }
  }
}