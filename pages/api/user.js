// pages/api/user.js
const { db } = require('../../utils/firebaseAdmin');
const { getServerSession } = require('next-auth/next');
const { authOptions } = require('./auth/[...nextauth]');
const { verifyRecaptcha } = require('../../utils/verifyRecaptcha');
const rateLimit = require('express-rate-limit');
const { body, query, validationResult } = require('express-validator');
const winston = require('winston');
const helmet = require('helmet');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});

const validatePost = [
  body('id').isString().isLength({ max: 100 }).withMessage('Invalid ID'),
  body('twitterHandle').isString().isLength({ max: 15 }).withMessage('Invalid Twitter handle'),
  body('twitterPFP').optional().isString().isURL().withMessage('Invalid profile picture URL'),
];

const validateGet = [
  query('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1kb',
    },
  },
};

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}, query: ${JSON.stringify(req.query)}, headers: ${JSON.stringify(req.headers)}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { session });
    return res.status(401).json({ detail: 'Not signed in' });
  }

  await Promise.all((req.method === 'POST' ? validatePost : validateGet).map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Input validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Invalid input data', errors: errors.array() });
  }

  try {
    if (req.method === 'GET') {
      const recaptchaToken = req.headers['x-recaptcha-token'];
      if (!recaptchaToken) {
        logger.error('Missing X-Recaptcha-Token header');
        return res.status(400).json({ detail: 'Missing reCAPTCHA token in header' });
      }

      try {
        await verifyRecaptcha(recaptchaToken, 'get_user', ip);
        logger.info('reCAPTCHA verified successfully for get_user', { token: recaptchaToken.substring(0, 8) + '...' });
      } catch (error) {
        logger.error(`reCAPTCHA verification failed: ${error.message}`, { stack: error.stack, token: recaptchaToken.substring(0, 8) + '...' });
        return res.status(403).json({ detail: `reCAPTCHA verification failed: ${error.message}` });
      }

      const { uid } = req.query;
      if (!uid || uid !== session.user.id) {
        logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`);
        return res.status(403).json({ detail: 'Access denied: Invalid UID' });
      }

      const userRef = db.collection('users').doc(uid);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        logger.error(`User not found: ${uid}`);
        return res.status(404).json({ detail: 'User not found' });
      }

      const user = userDoc.data();
      logger.info(`Fetched user data: ${uid}`);
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
        logger.warn(`Unauthorized: uid=${req.body.id}, sessionUserId=${session.user.id}`);
        return res.status(401).json({ detail: 'Unauthorized' });
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
      logger.info(`User created/updated: ${id}`);
      return res.status(200).json({ success: true, user: { id, ...updatedUser } });
    } else {
      logger.warn(`Method not allowed: ${req.method}`);
      return res.status(405).json({ detail: 'Method not allowed' });
    }
  } catch (error) {
    logger.error(`Error processing user request: ${error.message}`, {
      stack: error.stack,
      query: req.query,
      body: req.body,
    });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}