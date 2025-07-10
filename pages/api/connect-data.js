import { query } from '../../utils/postgres.js';
import winston from 'winston';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';

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
    logger.warn(`CSRF check failed: Invalid or missing Origin/Referer: ${origin}`, { ip: req.ip });
    return false;
  }
  if (!csrfToken || csrfToken !== process.env.CSRF_SECRET) {
    logger.warn(`CSRF check failed: Invalid or missing CSRF token: ${csrfToken}`, { ip: req.ip });
    return false;
  }
  return true;
};

export default async function handler(req, res) {
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'self'", 'https://www.google.com', 'https://www.recaptcha.net'],
        frameSrc: ['https://www.google.com', 'https://www.recaptcha.net'],
      },
    },
  })(req, res, () => {});
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
    logger.info('Lấy dữ liệu connect-data', { ip });
    let creatorsResult, aiRankResult, rankingsResult;
    try {
      [creatorsResult, aiRankResult, rankingsResult] = await Promise.all([
        query(
          `SELECT id, twitter_handle, twitter_pfp, tweet_points, tier 
           FROM users 
           WHERE tweet_points > 0 
           ORDER BY tweet_points DESC 
           LIMIT 10`
        ),
        query(
          `SELECT id, twitter_handle, twitter_pfp, ai_points, tier 
           FROM users 
           WHERE ai_points > 0 
           ORDER BY ai_points DESC 
           LIMIT 10`
        ),
        query(
          `SELECT id, twitter_handle, twitter_pfp, points, tier 
           FROM users 
           WHERE points > 0 
           ORDER BY points DESC 
           LIMIT 100`
        ),
      ]);
    } catch (error) {
      if (error.message.includes('relation "users" does not exist')) {
        logger.error(`Bảng users không tồn tại`, { ip });
        return res.status(500).json({ detail: 'Lỗi server: Bảng users không tồn tại' });
      }
      throw error;
    }

    const creators = creatorsResult.rows.map((row) => ({
      id: row.id,
      twitterHandle: row.twitter_handle,
      twitterPFP: row.twitter_pfp,
      tweetPoints: row.tweet_points,
      tier: row.tier,
    }));

    const aiRank = aiRankResult.rows.map((row) => ({
      id: row.id,
      twitterHandle: row.twitter_handle,
      twitterPFP: row.twitter_pfp,
      aiPoints: row.ai_points,
      tier: row.tier,
    }));

    const rankings = rankingsResult.rows.map((row) => ({
      id: row.id,
      twitterHandle: row.twitter_handle,
      twitterPFP: row.twitter_pfp,
      points: row.points,
      tier: row.tier,
    }));

    logger.info('Lấy connect-data thành công', {
      creatorsCount: creators.length,
      aiRankCount: aiRank.length,
      rankingsCount: rankings.length,
      ip,
    });

    return res.status(200).json({
      success: true,
      creators: creators.map((user) => ({ ...user, isCreator: true, points: user.tweetPoints })),
      aiRank: aiRank.map((user) => ({ ...user, isAiRank: true, points: user.aiPoints })),
      rankings,
    });
  } catch (error) {
    logger.error('Lỗi trong /api/connect-data:', { message: error.message, stack: error.stack, ip });
    return res.status(500).json({ detail: `Lỗi khi lấy dữ liệu bảng xếp hạng: ${error.message}` });
  }
}