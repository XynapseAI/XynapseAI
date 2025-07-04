import { db } from '../../utils/firebaseAdmin';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha';
import rateLimit from 'express-rate-limit';
import { query, validationResult } from 'express-validator';
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
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  },
});

const validateGet = [
  query('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
];

export default async function handler(req, res) {
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'https://ipfs.io', 'https://pbs.twimg.com'],
        connectSrc: ["'self'", 'https://api.geckoterminal.com'],
      },
    },
  })(req, res, () => {});

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, query: ${JSON.stringify(req.query)}`);

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  const authOptionsInstance = await authOptions();
  const session = await getServerSession(req, res, authOptionsInstance);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { session });
    return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
  }

  await Promise.all(validateGet.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const recaptchaToken = req.headers['x-recaptcha-token'];
    if (!recaptchaToken) {
      logger.error('Missing X-Recaptcha-Token header');
      return res.status(400).json({ detail: 'Missing reCAPTCHA token in header' });
    }

    try {
      await verifyRecaptcha(recaptchaToken, 'get_point_history', ip);
      logger.info('reCAPTCHA verified successfully for get_point_history', { token: recaptchaToken.substring(0, 8) + '...' });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { stack: error.stack });
      return res.status(403).json({ detail: `reCAPTCHA verification failed: ${error.message}` });
    }

    const { uid } = req.query;
    if (!uid || uid !== session.user.id) {
      logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`);
      return res.status(403).json({ detail: 'Access denied: Invalid UID' });
    }

    const historyQuery = db
      .collection('dailyAIInteractions')
      .where('userId', '==', uid)
      .orderBy('timestamp', 'desc')
      .limit(10);

    logger.info(`Executing Firestore query for dailyAIInteractions with userId: ${uid}`);

    let historySnapshot;
    try {
      historySnapshot = await historyQuery.get();
    } catch (queryError) {
      logger.error(`Firestore query failed: ${queryError.message}`, {
        stack: queryError.stack,
        code: queryError.code,
      });
      if (queryError.code === 'failed-precondition') {
        return res.status(500).json({ detail: 'Firestore index missing. Please contact support.' });
      }
      throw queryError;
    }

    if (!historySnapshot.empty) {
      const firstDoc = historySnapshot.docs[0].data();
      logger.info(`dailyAIInteractions schema: ${JSON.stringify(Object.keys(firstDoc))}`);
    } else {
      logger.info(`No point history found for user: ${uid}`);
    }

    const history = historySnapshot.empty
      ? []
      : historySnapshot.docs.map((doc) => {
          const data = doc.data();
          if (!data.timestamp || typeof data.points !== 'number') {
            logger.warn(`Invalid document schema for doc ${doc.id}: ${JSON.stringify(data)}`);
            return null;
          }
          return {
            date: data.timestamp.toDate().toISOString().split('T')[0],
            tweetPoints: 0,
            aiPoints: data.points || 0,
            taskPoints: 0,
            totalPoints: data.points || 0,
          };
        }).filter(item => item !== null);

    logger.info(`Fetched ${history.length} point history entries for user: ${uid}`);
    return res.status(200).json({ success: true, history });
  } catch (error) {
    logger.error(`Error fetching point history: ${error.message}`, {
      stack: error.stack,
      uid: req.query.uid,
      code: error.code,
      details: error.details,
    });
    return res.status(500).json({ detail: `Failed to fetch point history: ${error.message}` });
  }
}