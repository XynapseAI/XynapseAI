import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import rateLimit from 'express-rate-limit';
import { query as expressQuery, validationResult } from 'express-validator';
import pkg from '../../utils/logger.cjs';
import helmet from 'helmet';

const { logger } = pkg;

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: 'Too many requests, please try again later.' },
});

const validateGet = [
  expressQuery('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, query: ${JSON.stringify(req.query)}`);

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  // Apply rate limiting
  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  // Check authentication
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { session });
    return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
  }

  // Validate query
  await Promise.all(validateGet.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  try {
    const { uid } = req.query;
    if (!uid || uid !== session.user.id) {
      logger.warn(`Invalid parameters: uid=${uid}, sessionUserId=${session.user.id}`);
      return res.status(403).json({ detail: 'Access denied: Invalid user ID' });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    logger.info(`Querying task progress for user: ${uid}, date: ${today.toISOString()}`);

    const result = await query(
      `SELECT task_id, completion_count, completed_at
       FROM task_completions
       WHERE user_id = $1 AND completed_at >= $2`,
      [uid, today]
    );

    const progress = result.rows.map((row) => ({
      taskId: row.task_id,
      completionCount: row.completion_count,
      completedAt: row.completed_at,
    }));

    logger.info(`Fetched ${progress.length} task progress entries for user: ${uid}`);
    return res.status(200).json({ success: true, progress });
  } catch (error) {
    logger.error(`Error fetching task progress: ${error.message}`, {
      stack: error.stack,
      uid: req.query.uid,
      code: error.code,
    });
    return res.status(500).json({ detail: `Failed to fetch task progress: ${error.message}` });
  }
}