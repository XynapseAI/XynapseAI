import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import rateLimit from 'express-rate-limit';
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
  logger.info(`Yêu cầu tới ${req.url} từ IP ${ip}`);

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
    logger.warn('Chưa đăng nhập hoặc thiếu UID', { ip, session });
    return res.status(401).json({ detail: 'Chưa đăng nhập.' });
  }

  if (req.method !== 'GET') {
    logger.warn(`Phương thức không được phép: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  try {
    const tasksResult = await query(
      `SELECT id, points, is_daily, max_completions, created_at, updated_at
       FROM tasks
       ORDER BY points ASC`
    );
    const tasks = tasksResult.rows.map(row => ({
      id: row.id,
      points: row.points,
      isDaily: row.is_daily,
      maxCompletions: row.max_completions,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    logger.info(`Lấy ${tasks.length} nhiệm vụ cho người dùng: ${session.user.id}`, { ip });
    return res.status(200).json({ success: true, tasks });
  } catch (error) {
    if (error.message.includes('relation "tasks" does not exist')) {
      logger.error(`Bảng tasks không tồn tại`, { ip });
      return res.status(500).json({ detail: 'Lỗi server: Bảng tasks không tồn tại' });
    }
    logger.error(`Lỗi khi lấy nhiệm vụ: ${error.message}`, { stack: error.stack, ip });
    return res.status(500).json({ detail: `Lỗi khi lấy nhiệm vụ: ${error.message}` });
  }
}