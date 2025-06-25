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
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
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
    .withMessage('Hành động không hợp lệ'),
  query('ids').optional().isString().isLength({ max: 100 }).withMessage('ID không hợp lệ'),
  query('convert').optional().isIn(['usd', 'eur', 'btc']).withMessage('Đơn vị tiền tệ không hợp lệ'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Giới hạn không hợp lệ'),
  query('start').optional().isInt({ min: 1 }).withMessage('Điểm bắt đầu không hợp lệ'),
  query('query').optional().isString().isLength({ max: 100 }).withMessage('Truy vấn không hợp lệ'),
  query('tokenType')
    .if(query('action').equals('public-treasury'))
    .notEmpty()
    .isIn(['bitcoin', 'ethereum'])
    .withMessage('Loại token không hợp lệ'),
  query('id')
    .if(query('action').isIn(['tickers', 'coin-details']))
    .notEmpty()
    .isString()
    .isLength({ max: 100 })
    .withMessage('ID token không hợp lệ'),
  query('recaptchaToken')
    .if(query('action').not().equals('search'))
    .notEmpty()
    .isString()
    .withMessage('Yêu cầu token reCAPTCHA'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Yêu cầu tới /api/coingecko từ IP ${ip}, query: ${JSON.stringify(req.query)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`);
    return res.status(429).json({ detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
  }

  if (req.method !== 'GET') {
    logger.warn(`Phương thức không được phép: ${req.method}`);
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Xác thực thất bại', errors: errors.array() });
  }

  const { action, ids, convert, limit, start, query, recaptchaToken, id } = req.query;

  if (action !== 'search') {
    try {
      await verifyRecaptcha(recaptchaToken, action || 'fetch_market_data', ip);
    } catch (error) {
      logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`);
      return res.status(403).json({ detail: `Lỗi reCAPTCHA: ${error.message}` });
    }
  }

  const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
  if (!COINGECKO_API_KEY) {
    logger.error('COINGECKO_API_KEY không được cấu hình');
    return res.status(500).json({ detail: 'Lỗi cấu hình server: Thiếu COINGECKO_API_KEY' });
  }

  if (!axios || typeof axios.get !== 'function') {
    logger.error('Axios không được khởi tạo đúng cách');
    return res.status(500).json({ detail: 'Lỗi server: Axios không được khởi tạo' });
  }

  try {
    if (action === 'list-all') {
      logger.warn(`Yêu cầu truy cập endpoint bị vô hiệu hóa`);
      return res.status(404).json({ detail: 'Endpoint bị vô hiệu hóa' });
    } else if (action === 'market-info') {
      if (!ids) {
        logger.warn(`Thiếu tham số ids`);
        return res.status(400).json({ detail: 'Thiếu tham số ids' });
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
      logger.info(`Lấy dữ liệu thị trường thành công cho ids: ${ids}`);
      return res.status(200).json(response.data);
    } else if (action === 'search') {
      if (!query) {
        logger.warn(`Thiếu tham số query`);
        return res.status(400).json({ detail: 'Thiếu tham số query' });
      }
      const response = await axios.get('https://api.coingecko.com/api/v3/search', {
        params: { query },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });
      logger.info(`Tìm kiếm thành công với query: ${query}, kết quả: ${response.data.coins.length}`);
      return res.status(200).json(response.data.coins);
    } else if (action === 'public-treasury') {
      if (!tokenType) {
        logger.warn(`Thiếu tham số tokenType`);
        return res.status(400).json({ detail: 'Thiếu tham số tokenType' });
      }
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/companies/public_treasury/${tokenType}`,
        {
          headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
          timeout: 15000,
        }
      );
      logger.info(`Lấy dữ liệu kho bạc công khai thành công cho ${tokenType}`);
      return res.status(200).json(response.data);
    } else if (action === 'tickers') {
      if (!id) {
        logger.warn(`Thiếu tham số id`);
        return res.status(400).json({ detail: 'Thiếu tham số id' });
      }
      const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/tickers`, {
        params: { include_exchange_logo: true },
        headers: { 'x-cg-demo-api-key': COINGECKO_API_KEY },
        timeout: 15000,
      });
      logger.info(`Lấy dữ liệu ticker thành công cho id: ${id}, số lượng: ${response.data.tickers.length}`);
      return res.status(200).json(response.data);
    } else if (action === 'coin-details') {
      if (!id) {
        logger.warn(`Thiếu tham số id`);
        return res.status(400).json({ detail: 'Thiếu tham số id' });
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
      logger.info(`Lấy chi tiết token thành công cho id: ${id}`);
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
      logger.info(`Lấy dữ liệu thị trường mặc định thành công, số lượng: ${response.data.length}`);
      return res.status(200).json(response.data);
    }
  } catch (error) {
    logger.error(`Lỗi khi lấy dữ liệu CoinGecko: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'Vượt quá giới hạn API CoinGecko, vui lòng thử lại sau.'
        : status === 404
        ? 'Không tìm thấy dữ liệu yêu cầu.'
        : 'Không thể lấy dữ liệu thị trường.';
    return res.status(status).json({ detail });
  }
}