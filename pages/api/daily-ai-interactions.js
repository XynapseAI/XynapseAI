import { db } from '../../utils/firebaseAdmin.js';
import { requireAuth } from './middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { query, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';

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

const validateGet = [
  query('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ'),
  query('interactionType').isString().isIn(['chat', 'market']).optional().withMessage('Loại tương tác không hợp lệ'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Yêu cầu tới ${req.url} từ IP ${ip}, query: ${JSON.stringify(req.query)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`);
    return res.status(429).json({ detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
  }

  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi xác thực: ${err.message}`);
    return res.status(401).json({ detail: 'Chưa đăng nhập: Vui lòng đăng nhập.' });
  }

  await Promise.all(validateGet.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực cho ${req.url}: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Xác thực thất bại', errors: errors.array() });
  }

  if (req.method !== 'GET') {
    logger.warn(`Phương thức không được phép: ${req.method}`);
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  try {
    const { uid, interactionType = 'chat' } = req.query;
    if (!uid || uid !== req.session?.user?.id) {
      logger.error(`Tham số không hợp lệ: uid=${uid}, sessionUserId=${req.session?.user?.id}`);
      return res.status(400).json({ detail: 'Thiếu hoặc ID người dùng không hợp lệ' });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateString = today.toISOString().split('T')[0];

    const dailyInteractionRef = db.collection('dailyAIInteractions').doc(`${uid}_${dateString}_${interactionType}`);
    const dailyInteractionDoc = await dailyInteractionRef.get();
    const dailyInteraction = dailyInteractionDoc.exists ? dailyInteractionDoc.data() : { count: 0 };

    const pointsCount = Math.min(dailyInteraction.count || 0, 5);
    const totalCount = dailyInteraction.count || 0;
    logger.info(`Lấy số lượng tương tác AI hàng ngày cho người dùng: ${uid}, loại: ${interactionType}, pointsCount: ${pointsCount}, totalCount: ${totalCount}`);
    return res.status(200).json({ success: true, pointsCount, totalCount });
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu: ${error.message}`);
    return res.status(500).json({ detail: 'Lỗi server.' });
  }
}