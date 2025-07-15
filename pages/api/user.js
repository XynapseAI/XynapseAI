// pages/api/user.js
import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, query as expressQuery, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import Cors from 'cors';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV !== 'production'
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});

// CORS
const cors = Cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL,
      'http://localhost:3000',
      'https://xynapse-ai.vercel.app',
      'https://xynapseai.net',
      'https://app.xynapseai.net',
    ].filter(Boolean);
    logger.info(`CORS check: Origin ${origin || 'undefined'}, Allowed origins: ${allowedOrigins}`);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
});

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, detail: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

// Validation Rules
const validatePost = [
  body('id').isString().isLength({ max: 100 }).withMessage('Invalid ID'),
  body('twitterHandle').isString().isLength({ max: 15 }).withMessage('Invalid Twitter handle'),
  body('twitterPFP').optional().isString().isURL().withMessage('Invalid profile picture URL'),
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
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}, query: ${JSON.stringify(req.query)}`);

  // Áp dụng CORS
  try {
    await new Promise((resolve, reject) => {
      cors(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`CORS error: ${err.message}`, { ip });
    return res.status(403).json({ success: false, detail: 'Not allowed by CORS' });
  }

  // Áp dụng helmet
  helmet()(req, res);

  // Áp dụng rate-limit
  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return res.status(429).json({ success: false, detail: 'Too many requests, please try again later.' });
  }

  // Kiểm tra session
  const session = await getServerSession(req, res, authOptions);
  logger.debug(`Session: ${JSON.stringify(session)}`);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return res.status(401).json({ success: false, detail: 'Not authenticated' });
  }

  // Validation
  await Promise.all((req.method === 'POST' ? validatePost : validateGet).map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Input validation error: ${JSON.stringify(errors.array())}`, { ip, query: req.query, body: req.body });
    return res.status(400).json({ success: false, detail: 'Invalid input data', errors: errors.array() });
  }

  try {
    if (req.method === 'GET') {
      const recaptchaToken = req.headers['x-recaptcha-token'];
      logger.debug(`reCAPTCHA token: ${recaptchaToken ? recaptchaToken.substring(0, 8) + '...' : 'missing'}`);
      if (!recaptchaToken) {
        logger.error('Missing X-Recaptcha-Token header', { ip });
        return res.status(400).json({ success: false, detail: 'Missing reCAPTCHA token in header' });
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
          success: false,
          detail: `reCAPTCHA verification failed: ${error.message}`,
          errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
        });
      }

      const { uid } = req.query;
      logger.info(`Fetching user data for UID: ${uid}`, { ip });
      if (!uid || uid !== session.user.id) {
        logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
        return res.status(403).json({ success: false, detail: 'Access denied: Invalid UID' });
      }

      if (typeof uid !== 'string' || uid === 'uid') {
        logger.error('Invalid or tampered UID', { uid, ip });
        return res.status(400).json({ success: false, detail: 'Invalid UID' });
      }

      try {
        const result = await query(`SELECT * FROM users WHERE id = $1`, [uid]);
        if (result.rows.length === 0) {
          logger.error(`User not found: ${uid}`, { ip });
          return res.status(404).json({ success: false, detail: 'User not found' });
        }

        const user = result.rows[0];
        logger.info(`Fetched user data for UID: ${uid}`, { ip });
        return res.status(200).json({
          success: true,
          user: {
            id: user.id,
            twitterHandle: user.twitter_handle || '',
            twitterPFP: user.twitter_pfp || '',
            points: user.points || 0,
            tweetPoints: user.tweet_points || 0,
            aiPoints: user.ai_points || 0,
            taskPoints: user.task_points || 0,
            isCreator: user.is_creator || false,
            isAiRank: user.is_ai_rank || false,
            tier: user.tier || 'Basic',
            is_premium: user.is_premium || false,
            walletAddress: user.wallet_address || null,
            lastConnected: user.last_connected ? new Date(user.last_connected).toISOString() : null,
          },
        });
      } catch (dbError) {
        logger.error(`Database query error: ${dbError.message}`, { stack: dbError.stack, ip });
        if (dbError.message.includes('relation "users" does not exist')) {
          return res.status(500).json({ success: false, detail: 'Server error: Table users does not exist' });
        }
        throw dbError;
      }
    } else if (req.method === 'POST') {
      if (session.user.id !== req.body.id) {
        logger.warn(`Unauthorized: uid=${req.body.id}, sessionUserId=${session.user.id}`, { ip });
        return res.status(401).json({ success: false, detail: 'Unauthorized' });
      }

      const { id, twitterHandle, twitterPFP } = req.body;
      const userData = {
        twitter_handle: twitterHandle,
        twitter_pfp: twitterPFP,
        twitter_connected: true,
        last_connected: new Date(),
        points: 0,
        tweet_points: 0,
        ai_points: 0,
        task_points: 0,
        is_creator: false,
        is_ai_rank: false,
        tier: 'Basic',
        is_premium: false,
      };

      try {
        await query(
          `INSERT INTO users (
            id, twitter_handle, twitter_pfp, twitter_connected, 
            points, tweet_points, ai_points, task_points, 
            is_creator, is_ai_rank, tier, is_premium, created_at, last_connected
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (id) DO UPDATE SET
            twitter_handle = EXCLUDED.twitter_handle,
            twitter_pfp = EXCLUDED.twitter_pfp,
            twitter_connected = EXCLUDED.twitter_connected,
            last_connected = EXCLUDED.last_connected,
            points = EXCLUDED.points,
            tweet_points = EXCLUDED.tweet_points,
            ai_points = EXCLUDED.ai_points,
            task_points = EXCLUDED.task_points,
            is_creator = EXCLUDED.is_creator,
            is_ai_rank = EXCLUDED.is_ai_rank,
            tier = EXCLUDED.tier,
            is_premium = EXCLUDED.is_premium,
            updated_at = CURRENT_TIMESTAMP`,
          [
            id,
            userData.twitter_handle,
            userData.twitter_pfp,
            userData.twitter_connected,
            userData.points,
            userData.tweet_points,
            userData.ai_points,
            userData.task_points,
            userData.is_creator,
            userData.is_ai_rank,
            userData.tier,
            userData.is_premium,
            new Date(),
            userData.last_connected,
          ]
        );

        const result = await query(`SELECT * FROM users WHERE id = $1`, [id]);
        const updatedUser = result.rows[0];
        logger.info(`User created/updated: ${id}`, { ip });
        return res.status(200).json({
          success: true,
          user: {
            id: updatedUser.id,
            twitterHandle: updatedUser.twitter_handle || '',
            twitterPFP: updatedUser.twitter_pfp || '',
            points: updatedUser.points || 0,
            tweetPoints: updatedUser.tweet_points || 0,
            aiPoints: updatedUser.ai_points || 0,
            taskPoints: updatedUser.task_points || 0,
            isCreator: updatedUser.is_creator || false,
            isAiRank: updatedUser.is_ai_rank || false,
            tier: updatedUser.tier || 'Basic',
            is_premium: updatedUser.is_premium || false,
            walletAddress: updatedUser.wallet_address || null,
            lastConnected: updatedUser.last_connected ? new Date(updatedUser.last_connected).toISOString() : null,
          },
        });
      } catch (dbError) {
        logger.error(`Database query error: ${dbError.message}`, { stack: dbError.stack, ip });
        if (dbError.message.includes('relation "users" does not exist')) {
          return res.status(500).json({ success: false, detail: 'Server error: Table users does not exist' });
        }
        throw dbError;
      }
    } else {
      logger.warn(`Method not allowed: ${req.method}`, { ip });
      return res.status(405).json({ success: false, detail: 'Method not allowed' });
    }
  } catch (error) {
    logger.error(`Error processing user request: ${error.message}`, {
      stack: error.stack,
      query: req.query,
      body: req.body,
      ip,
    });
    return res.status(500).json({ success: false, detail: `Server error: ${error.message}` });
  }
}