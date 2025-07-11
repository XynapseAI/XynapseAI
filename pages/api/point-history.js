import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { query as expressQuery, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import { getCsrfToken } from 'next-auth/react';

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
  max: 50, // Tăng giới hạn để debug
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
});

const validateGet = [
  expressQuery('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Yêu cầu tới ${req.url} từ IP ${ip}, query: ${JSON.stringify(req.query)}`);

  if (req.method !== 'GET') {
    logger.warn(`Phương thức không được phép: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`, { ip });
    return res.status(429).json({ detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
  }

  const csrfToken = req.headers['x-csrf-token'];
  const expectedCsrfToken = await getCsrfToken({ req });
  if (!csrfToken || csrfToken !== expectedCsrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken}`, { ip });
    return res.status(403).json({ detail: 'CSRF check không hợp lệ.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Chưa đăng nhập hoặc thiếu UID', { ip, session });
    return res.status(401).json({ detail: 'Chưa đăng nhập.' });
  }

  await Promise.all(validateGet.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`, { ip, query: req.query });
    return res.status(400).json({ detail: 'Xác thực thất bại', errors: errors.array() });
  }

  try {
    const recaptchaToken = req.headers['x-recaptcha-token'];
    if (!recaptchaToken) {
      logger.error('Thiếu header X-Recaptcha-Token', { ip });
      return res.status(400).json({ detail: 'Thiếu token reCAPTCHA trong header' });
    }

    try {
      await verifyRecaptcha(recaptchaToken, 'get_point_history', ip);
      logger.info('Xác minh reCAPTCHA thành công cho get_point_history', { token: recaptchaToken.substring(0, 8) + '...' });
    } catch (error) {
      logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`, { ip, stack: error.stack });
      return res.status(403).json({ detail: `Xác minh reCAPTCHA thất bại: ${error.message}` });
    }

    const { uid } = req.query;
    if (!uid || uid !== session.user.id) {
      logger.warn(`Truy cập bị từ chối: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
      return res.status(403).json({ detail: 'Truy cập bị từ chối: UID không hợp lệ' });
    }

    let user;
    try {
      const userResult = await query(
        `SELECT points, tweet_points, ai_points, task_points 
         FROM users 
         WHERE id = $1`,
        [uid]
      );
      if (userResult.rows.length === 0) {
        logger.error(`Không tìm thấy người dùng: ${uid}`, { ip });
        return res.status(404).json({ detail: 'Không tìm thấy người dùng' });
      }
      user = userResult.rows[0];
    } catch (error) {
      if (error.message.includes('relation "users" does not exist')) {
        logger.error(`Bảng users không tồn tại`, { ip });
        return res.status(500).json({ detail: 'Lỗi server: Bảng users không tồn tại' });
      }
      throw error;
    }

    let history;
    try {
      const historyResult = await query(
        `SELECT date, interaction_type, count, points
         FROM daily_ai_interactions
         WHERE uid = $1
         ORDER BY date DESC
         LIMIT 10`,
        [uid]
      );
      history = historyResult.rows.map((row) => ({
        date: row.date.toISOString().split('T')[0],
        interactionType: row.interaction_type,
        tweetPoints: user.tweet_points || 0,
        aiPoints: row.points || 0,
        taskPoints: user.task_points || 0,
        totalPoints: (user.tweet_points || 0) + (row.points || 0) + (user.task_points || 0),
      }));
    } catch (error) {
      if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
        logger.error(`Bảng daily_ai_interactions không tồn tại`, { ip });
        return res.status(500).json({ detail: 'Lỗi server: Bảng daily_ai_interactions không tồn tại' });
      }
      throw error;
    }

    logger.info(`Lấy ${history.length} mục lịch sử điểm cho người dùng: ${uid}`, { ip });
    return res.status(200).json({ success: true, history });
  } catch (error) {
    logger.error(`Lỗi khi lấy lịch sử điểm: ${error.message}`, { stack: error.stack, ip, uid: req.query.uid });
    return res.status(500).json({ detail: `Lỗi khi lấy lịch sử điểm: ${error.message}` });
  }
}