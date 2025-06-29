// pages/api/blockchair.js
import axios from 'axios';
import { logger } from '../../utils/logger';
import rateLimit from 'axios-rate-limit';

const BLOCKCHAIR_API_URL = 'https://api.blockchair.com';
const CACHE_DURATION = 5 * 60 * 1000; // 5 phút
const cache = new Map();

// Tạo axios instance với rate limit
const blockchairAxios = rateLimit(axios.create(), {
  maxRequests: 30, // Giới hạn 30 yêu cầu/phút (theo tài liệu Blockchair miễn phí)
  perMilliseconds: 60000,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    logger.error('Method not allowed', { method: req.method });
    return res.status(405).json({ success: false, detail: 'Method not allowed' });
  }

  const { chain, limit = 100 } = req.body;

  // Validate chain
  const supportedChains = ['bitcoin', 'ethereum', 'dogecoin'];
  if (!chain || !supportedChains.includes(chain.toLowerCase())) {
    logger.error('Invalid or unsupported chain', { chain });
    return res.status(400).json({ success: false, detail: 'Invalid or unsupported chain' });
  }

  // Kiểm tra cache
  const cacheKey = `blockchair-${chain}-top-holders-${limit}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
    logger.info('Serving top holders from cache', { cacheKey, chain });
    return res.status(200).json({ success: true, data: cachedData.data });
  }

  try {
    // Gọi Blockchair API để lấy top addresses theo balance
    const response = await blockchairAxios.get(
      `${BLOCKCHAIR_API_URL}/${chain}/addresses?limit=${limit}&sort=balance`,
      {
        headers: { 'Accept': 'application/json' },
        timeout: 15000,
      }
    );

    if (!response.data?.data) {
      logger.error('Invalid response from Blockchair API', { chain });
      return res.status(500).json({ success: false, detail: 'Invalid response from Blockchair API' });
    }

    // Xử lý dữ liệu top holders
    const topHolders = response.data.data.map((holder) => ({
      address: holder.address,
      balance: parseFloat(holder.balance) / (chain === 'ethereum' ? 1e18 : 1e8), // ETH dùng wei (10^18), BTC/DOGE dùng satoshi (10^8)
      share: parseFloat(holder.share) || 0,
    }));

    // Lưu vào cache
    cache.set(cacheKey, { data: topHolders, timestamp: Date.now() });
    logger.info('Top holders fetched and cached from Blockchair', {
      chain,
      count: topHolders.length,
      sample: topHolders.slice(0, 3),
    });

    return res.status(200).json({ success: true, data: topHolders });
  } catch (error) {
    logger.error('Error fetching Blockchair top holders', {
      chain,
      status: error.response?.status,
      message: error.message,
      data: error.response?.data,
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