import { db } from '../../utils/firebaseAdmin.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, query, validationResult } from 'express-validator';
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
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
    return ip;
  },
  trustProxy: true,
});

const validatePost = [
  body('id').isString().isLength({ max: 100 }).withMessage('ID không hợp lệ'),
  body('twitterHandle').isString().isLength({ max: 15 }).withMessage('Tài khoản Twitter không hợp lệ'),
  body('twitterPFP').optional().isString().isURL().withMessage('URL ảnh đại diện không hợp lệ'),
];

const validateGet = [
  query('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5kb',
    },
  },
};

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Yêu cầu tới ${req.url} từ IP ${ip}, phương thức: ${req.method}, query: ${JSON.stringify(req.query)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`);
    return res.status(429).json({ detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Phiên chưa được xác thực hoặc thiếu ID người dùng', { session });
    return res.status(401).json({ detail: 'Chưa đăng nhập' });
  }

  await Promise.all((req.method === 'POST' ? validatePost : validateGet).map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực đầu vào: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Dữ liệu đầu vào không hợp lệ', errors: errors.array() });
  }

  try {
    if (req.method === 'GET') {
      const recaptchaToken = req.headers['x-recaptcha-token'];
      if (!recaptchaToken) {
        logger.error('Thiếu header X-Recaptcha-Token');
        return res.status(400).json({ detail: 'Thiếu token reCAPTCHA trong header' });
      }

      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        logger.info('Xác minh reCAPTCHA thành công cho get_user', {
          token: recaptchaToken.substring(0, 8) + '...',
          score,
        });
      } catch (error) {
        logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`, {
          stack: error.stack,
          token: recaptchaToken.substring(0, 8) + '...',
        });
        return res.status(403).json({
          detail: `Xác minh reCAPTCHA thất bại: ${error.message}`,
          errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
        });
      }

      const { uid } = req.query;
      if (!uid || uid !== session.user.id) {
        logger.warn(`Truy cập bị từ chối: uid=${uid}, sessionUserId=${session.user.id}`);
        return res.status(403).json({ detail: 'Truy cập bị từ chối: UID không hợp lệ' });
      }

      const userRef = db.collection('users').doc(uid);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        logger.error(`Không tìm thấy người dùng: ${uid}`);
        return res.status(404).json({ detail: 'Không tìm thấy người dùng' });
      }

      const user = userDoc.data();
      logger.info(`Lấy dữ liệu người dùng: ${uid}`);
      return res.status(200).json({
        success: true,
        user: {
          id: userDoc.id,
          twitterHandle: user.twitterHandle || '',
          twitterPFP: user.twitterPFP || '',
          points: user.points || 0,
          tweetPoints: user.tweetPoints || 0,
          aiPoints: user.aiPoints || 0,
          taskPoints: user.taskPoints || 0,
          isCreator: user.isCreator || false,
          isAiRank: user.isAiRank || false,
          tier: user.tier || 'Basic',
          walletAddress: user.walletAddress || null,
          lastConnected: user.lastConnected ? user.lastConnected.toDate() : null,
        },
      });
    } else if (req.method === 'POST') {
      if (session.user.id !== req.body.id) {
        logger.warn(`Không được phép: uid=${req.body.id}, sessionUserId=${session.user.id}`);
        return res.status(401).json({ detail: 'Không được phép' });
      }

      const { id, twitterHandle, twitterPFP } = req.body;
      const userRef = db.collection('users').doc(id);
      const userData = {
        twitterHandle,
        twitterPFP,
        twitterConnected: true,
        lastConnected: new Date(),
        points: 0,
        tweetPoints: 0,
        aiPoints: 0,
        taskPoints: 0,
        isCreator: false,
        isAiRank: false,
        tier: 'Basic',
        isPlus: false,
      };

      await userRef.set(userData, { merge: true });
      const updatedUser = (await userRef.get()).data();
      logger.info(`Người dùng được tạo/cập nhật: ${id}`);
      return res.status(200).json({ success: true, user: { id, ...updatedUser } });
    } else {
      logger.warn(`Phương thức không được phép: ${req.method}`);
      return res.status(405).json({ detail: 'Phương thức không được phép' });
    }
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu người dùng: ${error.message}`, {
      stack: error.stack,
      query: req.query,
      body: req.body,
    });
    return res.status(500).json({ detail: `Lỗi server: ${error.message}` });
  }
}