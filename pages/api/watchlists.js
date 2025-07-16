// pages/api/watchlists.js
import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import { isAddress } from 'ethers';

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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

const validatePost = [
  body('action')
    .isString()
    .isIn(['add', 'remove'])
    .withMessage('Invalid action'),
  body('wallet_address')
    .if(body('action').equals('add'))
    .isString()
    .custom((value) => {
      const isValidEVM = isAddress(value);
      const isValidSVM = value.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
      if (!isValidEVM && !isValidSVM) {
        throw new Error('Invalid EVM or SVM address');
      }
      return true;
    })
    .withMessage('Invalid wallet address'),
  body('wallet_address')
    .if(body('action').equals('remove'))
    .isString()
    .notEmpty()
    .withMessage('Wallet address is required for removal'),
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
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}, body: ${JSON.stringify(req.body)}`);

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

  if (req.method === 'GET') {
    try {
      const result = await query(
        `SELECT wallet_address, name, created_at FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [session.user.id]
      );
      logger.info(`Fetched watchlists for user ${session.user.id}: ${result.rows.length} wallets`, { ip });
      return res.status(200).json({ success: true, data: result.rows });
    } catch (dbError) {
      logger.error(`Database query error: ${dbError.message}`, { stack: dbError.stack, ip });
      return res.status(500).json({ detail: `Server error: ${dbError.message}` });
    }
  } else if (req.method === 'POST') {
    await Promise.all(validatePost.map((validation) => validation.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(`Input validation error: ${JSON.stringify(errors.array())}`, { ip, body: req.body });
      return res.status(400).json({ detail: 'Invalid input data', errors: errors.array() });
    }

    const { action, wallet_address } = req.body;

    if (action === 'add') {
      try {
        // Check current watchlist count
        const countResult = await query(`SELECT COUNT(*) FROM watchlists WHERE user_id = $1`, [session.user.id]);
        if (parseInt(countResult.rows[0].count) >= 5) {
          logger.warn(`Watchlist limit reached for user ${session.user.id}`, { ip });
          return res.status(400).json({ detail: 'Maximum 5 wallets allowed in watchlist' });
        }

        // Insert new wallet
        await query(
          `INSERT INTO watchlists (user_id, wallet_address, name) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT unique_user_wallet DO NOTHING`,
          [session.user.id, wallet_address.toLowerCase(), 'Unnamed Wallet']
        );

        // Fetch updated watchlist
        const result = await query(
          `SELECT wallet_address, name, created_at FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
          [session.user.id]
        );
        logger.info(`Added wallet ${wallet_address} for user ${session.user.id}`, { ip });
        return res.status(200).json({ success: true, data: result.rows });
      } catch (dbError) {
        logger.error(`Database error adding wallet: ${dbError.message}`, { stack: dbError.stack, ip });
        return res.status(500).json({ detail: `Server error: ${dbError.message}` });
      }
    } else if (action === 'remove') {
      try {
        await query(
          `DELETE FROM watchlists WHERE user_id = $1 AND wallet_address = $2`,
          [session.user.id, wallet_address.toLowerCase()]
        );

        // Fetch updated watchlist
        const result = await query(
          `SELECT wallet_address, name, created_at FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
          [session.user.id]
        );
        logger.info(`Removed wallet ${wallet_address} for user ${session.user.id}`, { ip });
        return res.status(200).json({ success: true, data: result.rows });
      } catch (dbError) {
        logger.error(`Database error removing wallet: ${dbError.message}`, { stack: dbError.stack, ip });
        return res.status(500).json({ detail: `Server error: ${dbError.message}` });
      }
    }
  } else {
    logger.warn(`Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Method not allowed' });
  }
}