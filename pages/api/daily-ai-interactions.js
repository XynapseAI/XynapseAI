// pages/api/daily-ai-interactions.js
import { db } from '../../utils/firebaseAdmin.js';
import { requireAuth } from './middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { query, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
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

const validateGet = [
  query('uid').isString().isLength({ max: 100 }),
  query('interactionType').isString().isIn(['chat', 'market']).optional(),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  logger.info(`Request to ${req.url} from IP ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);

  await new Promise((resolve, reject) => {
    limiter(req, res, (err) => (err ? reject(err) : resolve()));
  });

  await new Promise((resolve, reject) => {
    requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
  });

  await Promise.all(validateGet.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors for ${req.url}: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const { uid, interactionType = 'chat' } = req.query;
    if (!uid || uid !== req.session.user.id) {
      logger.error(`Invalid parameters: uid=${uid}, sessionUserId=${req.session.user.id}`);
      return res.status(400).json({ detail: 'Missing or invalid user ID' });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateString = today.toISOString().split('T')[0];

    const dailyInteractionRef = db.collection('dailyAIInteractions').doc(`${uid}_${dateString}_${interactionType}`);
    const dailyInteractionDoc = await dailyInteractionRef.get();
    const dailyInteraction = dailyInteractionDoc.exists ? dailyInteractionDoc.data() : { count: 0 };

    const pointsCount = Math.min(dailyInteraction.count || 0, 5);
    const totalCount = dailyInteraction.count || 0;
    logger.info(`Fetched daily ${interactionType} AI interaction count for user: ${uid}, pointsCount: ${pointsCount}, totalCount: ${totalCount}`);
    return res.status(200).json({ success: true, pointsCount, totalCount });
  } catch (error) {
    logger.error(`Error processing request: ${error.message}`);
    return res.status(500).json({ detail: 'Server error.' });
  }
}