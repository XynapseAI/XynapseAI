// pages/api/wallet-history.js
import { config as dotenvConfig } from 'dotenv';
import { db } from '../../utils/firebaseAdmin.js';
import { requireAuth } from './middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';

dotenvConfig({ path: '.env' });

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
  message: { error: 'Too many requests, please try again later.' },
});

const validate = [
  body('uid').isString().notEmpty().withMessage('User ID is required'),
  body('walletAddress').isString().matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Wallet address must be a valid EVM address'),
  body('action').isString().isIn(['wallet-balances', 'transactions']).withMessage('Invalid action'),
  body('data').isArray().withMessage('Data must be an array'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50kb',
    },
  },
};

export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  logger.info(`Request to ${req.url} from IP ${ip}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Rate limit exceeded, please try again later.' });
  }

  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Authentication error: ${err.message}`);
    return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
  }

  if (req.method !== 'POST') {
    logger.warn(`Invalid method ${req.method} for ${req.url}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  const { uid, walletAddress, action, data } = req.body;

  if (uid !== req.session.user.id) {
    logger.warn(`Unauthorized: uid=${uid}, sessionUserId=${req.session.user.id}`);
    return res.status(403).json({ detail: 'Invalid UID' });
  }

  try {
    const walletHistoryRef = db.collection('walletHistories').doc();
    const walletHistory = {
      userId: uid,
      walletAddress,
      action,
      data, // Store data as-is (array)
      createdAt: new Date(),
    };
    await walletHistoryRef.set(walletHistory);
    logger.info(`Wallet history saved for user ${uid}, address ${walletAddress}, action ${action}`);
    return res.status(200).json({ success: true, walletHistory: { id: walletHistoryRef.id, ...walletHistory } });
  } catch (error) {
    logger.error(`Error saving wallet history: ${error.message}`);
    return res.status(500).json({ detail: 'Failed to save wallet history.' });
  }
}