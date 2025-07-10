import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import axios from 'axios';

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
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

const validate = [
  body('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ'),
  body('recaptchaToken').isString().notEmpty().withMessage('Token reCAPTCHA là bắt buộc'),
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

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10kb',
    },
  },
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
    logger.warn('Chưa đăng nhập', { ip });
    return res.status(401).json({ detail: 'Chưa đăng nhập' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`, { ip, body: req.body });
    return res.status(400).json({ detail: 'Xác thực thất bại', errors: errors.array() });
  }

  if (req.method !== 'POST') {
    logger.warn(`Phương thức không được phép: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  const { uid, recaptchaToken } = req.body;
  if (!uid || uid !== session.user.id) {
    logger.warn(`Truy cập bị từ chối: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return res.status(403).json({ detail: 'Truy cập bị từ chối' });
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'analyze_tweets', ip);
  } catch (error) {
    logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`, { ip, stack: error.stack });
    return res.status(403).json({ detail: `Xác minh reCAPTCHA thất bại: ${error.message}` });
  }

  try {
    let user;
    try {
      const userResult = await query(
        `SELECT twitter_handle, twitter_connected, points, tweet_points, ai_points, task_points 
         FROM users 
         WHERE id = $1`,
        [uid]
      );
      if (userResult.rows.length === 0 || !userResult.rows[0].twitter_connected) {
        logger.warn(`Tài khoản Twitter không được kết nối: ${uid}`, { ip });
        return res.status(403).json({ detail: 'Tài khoản Twitter không được kết nối' });
      }
      user = userResult.rows[0];
    } catch (error) {
      if (error.message.includes('relation "users" does not exist')) {
        logger.error(`Bảng users không tồn tại`, { ip });
        return res.status(500).json({ detail: 'Lỗi server: Bảng users không tồn tại' });
      }
      throw error;
    }

    let twitterHandle = user.twitter_handle.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
    if (!twitterHandle.match(/^[A-Za-z0-9_]{1,15}$/)) {
      logger.error(`Tài khoản Twitter không hợp lệ: ${twitterHandle}`, { ip });
      return res.status(400).json({ detail: 'Tài khoản Twitter không hợp lệ' });
    }

    const accessToken = process.env.TWITTER_BEARER_TOKEN;
    if (!accessToken) {
      logger.error('Chưa cấu hình Twitter Bearer Token', { ip });
      return res.status(400).json({ detail: 'Chưa cấu hình Bearer Token' });
    }

    let twitterUserId;
    try {
      const userResponse = await axios.get(
        `https://api.twitter.com/2/users/by/username/${encodeURIComponent(twitterHandle)}?user.fields=id`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!userResponse.data.data) {
        logger.error(`Không tìm thấy người dùng Twitter: ${twitterHandle}`, { ip });
        return res.status(400).json({ detail: 'Không tìm thấy người dùng Twitter' });
      }
      twitterUserId = userResponse.data.data.id;
    } catch (error) {
      logger.error(`Lỗi khi lấy thông tin người dùng Twitter: ${error.message}`, { ip });
      return res.status(500).json({ detail: `Lỗi Twitter API: ${error.message}` });
    }

    let tweets;
    try {
      const tweetsResponse = await axios.get(
        `https://api.twitter.com/2/users/${twitterUserId}/tweets?tweet.fields=created_at,text&max_results=10`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!tweetsResponse.data.data) {
        logger.warn(`Không tìm thấy tweet: ${twitterUserId}`, { ip });
        return res.status(400).json({ detail: 'Không tìm thấy tweet' });
      }
      tweets = tweetsResponse.data.data;
    } catch (error) {
      logger.error(`Lỗi khi lấy tweet: ${error.message}`, { ip });
      if (error.response?.status === 429) {
        return res.status(429).json({ detail: 'Vượt quá giới hạn Twitter API. Vui lòng thử lại sau.' });
      }
      return res.status(500).json({ detail: `Lỗi Twitter API: ${error.message}` });
    }

    let totalTweetPoints = user.tweet_points || 0;
    const cryptoKeywords = ['crypto', 'blockchain', 'bitcoin', 'ethereum', 'web3', 'nft'];
    const tweetAnalyses = [];

    try {
      for (const tweet of tweets) {
        let points = 0;
        const text = tweet.text.toLowerCase();
        const length = tweet.text.length;

        if (length > 100) points += 50;
        else if (length > 50) points += 30;
        else points += 10;

        if (cryptoKeywords.some((keyword) => text.includes(keyword))) {
          points += 100;
        }

        if (text.includes('http') || text.includes('#')) points += 20;

        totalTweetPoints += points;

        await query(
          `INSERT INTO tweet_analyses (id, user_id, tweet_id, text, points, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [tweet.id, uid, tweet.id, tweet.text, points, new Date(tweet.created_at)]
        );

        tweetAnalyses.push({
          id: tweet.id,
          userId: uid,
          tweetId: tweet.id,
          text: tweet.text,
          points,
          createdAt: new Date(tweet.created_at),
        });
      }
    } catch (error) {
      if (error.message.includes('relation "tweet_analyses" does not exist')) {
        logger.error(`Bảng tweet_analyses không tồn tại`, { ip });
        return res.status(500).json({ detail: 'Lỗi server: Bảng tweet_analyses không tồn tại' });
      }
      throw error;
    }

    const totalPoints = totalTweetPoints + (user.ai_points || 0) + (user.task_points || 0);
    try {
      await query(
        `UPDATE users SET
           tweet_points = $1,
           points = $2,
           updated_at = $3
         WHERE id = $4`,
        [totalTweetPoints, totalPoints, new Date(), uid]
      );
    } catch (error) {
      if (error.message.includes('relation "users" does not exist')) {
        logger.error(`Bảng users không tồn tại`, { ip });
        return res.status(500).json({ detail: 'Lỗi server: Bảng users không tồn tại' });
      }
      throw error;
    }

    logger.info(`Phân tích tweet cho ${uid}: ${tweetAnalyses.length} tweet, tổng điểm: ${totalTweetPoints}`, { ip });
    return res.status(200).json({
      success: true,
      points: totalPoints,
      tweetPoints: totalTweetPoints,
      message: 'Đã phân tích tweet và cộng điểm!',
    });
  } catch (error) {
    logger.error(`Lỗi khi phân tích tweet: ${error.message}`, { ip, stack: error.stack });
    return res.status(500).json({ detail: `Không thể phân tích tweet: ${error.message}` });
  }
}