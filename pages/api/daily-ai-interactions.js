import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import rateLimit from 'express-rate-limit';
import { query as expressQuery, validationResult } from 'express-validator';
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
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

const validateGet = [
  expressQuery('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
  expressQuery('interactionType')
    .isString()
    .isIn(['chat', 'market'])
    .optional()
    .withMessage('Invalid interaction type'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, query: ${JSON.stringify(req.query)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.error(`Authentication error: No session or UID`, { ip });
    return res.status(401).json({ detail: 'Not authenticated.' });
  }

  await Promise.all(validateGet.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation error: ${JSON.stringify(errors.array())}`, { ip, query: req.query });
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const { uid, interactionType = 'chat' } = req.query;
    if (!uid || uid !== session.user.id) {
      logger.error(`Invalid parameters: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
      return res.status(400).json({ detail: 'Missing or invalid user ID' });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateString = today.toISOString().split('T')[0];
    const docId = `${uid}_${dateString}_${interactionType}`;

    let dailyInteraction;
    try {
      const result = await query(`SELECT count FROM daily_ai_interactions WHERE id = $1`, [docId]);
      dailyInteraction = result.rows.length > 0 ? result.rows[0] : { count: 0 };
    } catch (error) {
      if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
        logger.error(`Table daily_ai_interactions does not exist`, { ip });
        return res.status(500).json({ detail: 'Server error: Table daily_ai_interactions does not exist' });
      }
      throw error;
    }

    const pointsCount = Math.min(dailyInteraction.count || 0, 5);
    const totalCount = dailyInteraction.count || 0;

    logger.info(`Retrieved daily AI interaction count for user: ${uid}, type: ${interactionType}, pointsCount: ${pointsCount}, totalCount: ${totalCount}`, { ip });
    return res.status(200).json({ success: true, pointsCount, totalCount });
  } catch (error) {
    logger.error(`Request processing error: ${error.message}`, { stack: error.stack, ip });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}