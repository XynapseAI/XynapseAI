import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import rateLimit from 'express-rate-limit';
import { query as expressQuery, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

const validateGet = [
  expressQuery('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ'),
  expressQuery('interactionType')
    .isString()
    .isIn(['chat', 'market'])
    .optional()
    .withMessage('Loại tương tác không hợp lệ'),
];

const checkCSRF = (req) => {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
  ];
  const origin = req.headers['origin'] || req.headers['referer']?.split('/').slice(0, 3).join('/');
  const csrfToken = req.headers['x-csrf-token'];
  if (!origin || !allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
    logger.warn(`CSRF check failed: Invalid or missing Origin/Referer: ${origin}`);
    return false;
  }
  if (!csrfToken || csrfToken !== process.env.CSRF_SECRET) {
    logger.warn(`CSRF check failed: Invalid or missing CSRF token: ${csrfToken}`);
    return false;
  }
  return true;
};

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Yêu cầu tới ${req.url} từ IP ${ip}, query: ${JSON.stringify(req.query)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`, { ip });
    return res.status(429).json({ detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
  }

  if (!checkCSRF(req)) {
    logger.warn(`CSRF check failed`, { ip });
    return res.status(403).json({ detail: 'CSRF check không hợp lệ.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.error(`Lỗi xác thực: Không có session hoặc UID`, { ip });
    return res.status(401).json({ detail: 'Chưa đăng nhập.' });
  }

  await Promise.all(validateGet.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`, { ip, query: req.query });
    return res.status(400).json({ detail: 'Xác thực thất bại', errors: errors.array() });
  }

  if (req.method !== 'GET') {
    logger.warn(`Phương thức không được phép: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  try {
    const { uid, interactionType = 'chat' } = req.query;
    if (!uid || uid !== session.user.id) {
      logger.error(`Tham số không hợp lệ: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
      return res.status(400).json({ detail: 'Thiếu hoặc ID người dùng không hợp lệ' });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateString = today.toISOString().split('T')[0];
    const docId = `${uid}_${dateString}_${interactionType}`;

    let dailyInteraction;
    try {
      const result = await query(`SELECT count FROM daily_ai_interactions WHERE id = $1`, [docId]);
      dailyInteraction = result.rows.length > 0 ? result.rows[0] : { count: 0 };
    } catch (error) {
      if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
        logger.error(`Bảng daily_ai_interactions không tồn tại`, { ip });
        return res.status(500).json({ detail: 'Lỗi server: Bảng daily_ai_interactions không tồn tại' });
      }
      throw error;
    }

    const pointsCount = Math.min(dailyInteraction.count || 0, 5);
    const totalCount = dailyInteraction.count || 0;

    logger.info(`Lấy số lượng tương tác AI hàng ngày cho người dùng: ${uid}, loại: ${interactionType}, pointsCount: ${pointsCount}, totalCount: ${totalCount}`, { ip });
    return res.status(200).json({ success: true, pointsCount, totalCount });
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu: ${error.message}`, { stack: error.stack, ip });
    return res.status(500).json({ detail: `Lỗi server: ${error.message}` });
  }
}