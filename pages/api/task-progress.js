import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
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
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

const validateGet = [
  expressQuery('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ'),
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
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, query: ${JSON.stringify(req.query)}`);

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  if (!checkCSRF(req)) {
    logger.warn(`CSRF check failed`, { ip });
    return res.status(403).json({ detail: 'CSRF check không hợp lệ.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
  }

  const recaptchaToken = req.headers['x-recaptcha-token'];
  if (!recaptchaToken) {
    logger.error('Missing X-Recaptcha-Token header', { ip });
    return res.status(400).json({ detail: 'Missing reCAPTCHA token in header' });
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'task_progress', ip);
    logger.info('reCAPTCHA verified for task_progress', { ip, token: recaptchaToken.substring(0, 8) + '...' });
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
    return res.status(403).json({ detail: `reCAPTCHA verification failed: ${error.message}` });
  }

  await Promise.all(validateGet.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`, { ip, query: req.query });
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  try {
    const { uid } = req.query;
    if (!uid || uid !== session.user.id) {
      logger.warn(`Invalid parameters: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
      return res.status(403).json({ detail: 'Access denied: Invalid user ID' });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    logger.info(`Querying task progress for user: ${uid}, date: ${today.toISOString()}`, { ip });

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

    logger.info(`Fetched ${progress.length} task progress entries for user: ${uid}`, { ip });
    return res.status(200).json({ success: true, progress });
  } catch (error) {
    if (error.message.includes('relation "task_completions" does not exist')) {
      logger.error(`Table task_completions does not exist`, { ip });
      return res.status(500).json({ detail: 'System error: Table task_completions does not exist' });
    }
    logger.error(`Error fetching task progress: ${error.message}`, {
      stack: error.stack,
      uid: req.query.uid,
      ip,
    });
    return res.status(500).json({ detail: `Failed to fetch task progress: ${error.message}` });
  }
}