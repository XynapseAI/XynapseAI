// app/api/user/route.js
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, query as expressQuery, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';

const prisma = new PrismaClient();

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
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

const validatePost = [
  body('id').isString().isLength({ max: 100 }).withMessage('Invalid ID'),
  body('email').isEmail().withMessage('Invalid email'),
  body('profilePicture').optional().isString().isURL().withMessage('Invalid profile picture URL'),
  body('googleId').optional().isString().isLength({ max: 100 }).withMessage('Invalid Google ID'),
  body('googleName').optional().isString().isLength({ max: 255 }).withMessage('Invalid Google name'),
  body('emailVerified').optional().isBoolean().withMessage('Invalid email verified status'),
];

const validateGet = [
  expressQuery('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
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
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}, query: ${JSON.stringify(req.query)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { stack: err.stack, ip });
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  await Promise.all((req.method === 'POST' ? validatePost : validateGet).map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Input validation error: ${JSON.stringify(errors.array())}`, { ip, query: req.query, body: req.body });
    return res.status(400).json({ detail: 'Invalid input data', errors: errors.array() });
  }

  try {
    if (req.method === 'GET') {
      const recaptchaToken = req.headers['x-recaptcha-token'];
      if (!recaptchaToken) {
        logger.error('Missing X-Recaptcha-Token header', { ip });
        return res.status(400).json({ detail: 'Missing reCAPTCHA token in header' });
      }

      try {
        const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        logger.info('reCAPTCHA verification successful for get_user', {
          token: recaptchaToken.substring(0, 8) + '...',
          score,
          ip,
        });
      } catch (error) {
        logger.error(`reCAPTCHA verification failed: ${error.message}`, {
          stack: error.stack,
          token: recaptchaToken.substring(0, 8) + '...',
          ip,
        });
        return res.status(403).json({
          detail: `reCAPTCHA verification failed: ${error.message}`,
          errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
        });
      }

      const { uid } = req.query;
      if (!uid || uid !== session.user.id) {
        logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
        return res.status(403).json({ detail: 'Access denied: Invalid UID' });
      }

      const user = await prisma.users.findUnique({
        where: { id: uid },
      });

      if (!user) {
        logger.error(`User not found: ${uid}`, { ip });
        return res.status(404).json({ detail: 'User not found' });
      }

      logger.info(`Fetched user data for UID: ${uid}`, { ip });
      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email || '',
          googleId: user.google_id || null,
          profilePicture: user.profile_picture || '',
          googleName: user.google_name || '',
          emailVerified: user.email_verified || false,
          points: user.points || 0,
          tweetPoints: user.tweet_points || 0,
          aiPoints: user.ai_points || 0,
          taskPoints: user.task_points || 0,
          isCreator: user.is_creator || false,
          isAiRank: user.is_ai_rank || false,
          tier: user.tier || 'Basic',
          isPremium: user.is_premium || false,
          walletAddress: user.wallet_address || null,
          lastConnected: user.last_connected ? new Date(user.last_connected) : null,
        },
      });
    } else if (req.method === 'POST') {
      if (session.user.id !== req.body.id) {
        logger.warn(`Unauthorized: uid=${req.body.id}, sessionUserId=${session.user.id}`, { ip });
        return res.status(401).json({ detail: 'Unauthorized' });
      }

      const { id, email, profilePicture, googleId, googleName, emailVerified } = req.body;
      const userData = {
        email,
        googleId: googleId || null,
        profilePicture: profilePicture || '',
        googleName: googleName || '',
        emailVerified: emailVerified || false,
        connected: true,
        lastConnected: new Date(),
        points: 0,
        tweetPoints: 0,
        aiPoints: 0,
        taskPoints: 0,
        isCreator: false,
        isAiRank: false,
        tier: 'Basic',
        isPlus: false,
        isPremium: false,
      };

      const updatedUser = await prisma.users.upsert({
        where: { id },
        update: userData,
        create: {
          ...userData,
          id,
          createdAt: new Date(),
          apiKey: crypto.randomBytes(32).toString('hex'),
        },
      });

      logger.info(`User created/updated: ${id}`, { ip });
      return res.status(200).json({ success: true, user: updatedUser });
    } else {
      logger.warn(`Method not allowed: ${req.method}`, { ip });
      return res.status(405).json({ detail: 'Method not allowed' });
    }
  } catch (error) {
    logger.error(`Error processing user request: ${error.message}`, {
      stack: error.stack,
      query: req.query,
      body: req.body,
      ip,
    });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}