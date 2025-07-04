// pages/api/ai-interaction.js
import { config as dotenvConfig } from 'dotenv';
import { db } from '../../utils/firebaseAdmin.js';
import { requireAuth } from './middleware/auth.js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, query, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import { exec } from 'child_process';
import util from 'util';

dotenvConfig({ path: '.env' });

const execPromise = util.promisify(exec);

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
});

const validatePost = [
  body('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID').optional(),
  body('query').isString().isLength({ min: 1, max: 1000 }).withMessage('Query must be 1-1000 characters').optional(),
  body('response').isString().isLength({ max: 5000 }).withMessage('Response must be <= 5000 characters').optional(),
  body('interactionType')
    .isString()
    .isIn(['chat', 'market', 'analyze-deposit', 'detect-large-flow'])
    .optional()
    .withMessage('Invalid interactionType'),
  body('walletAddress')
    .optional()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Invalid EVM address'),
];

const validateGet = [
  query('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
  query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be 1-20'),
  query('interactionType')
    .isString()
    .isIn(['chat', 'market', 'analyze-deposit', 'detect-large-flow'])
    .optional()
    .withMessage('Invalid interactionType'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15kb',
    },
  },
};

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Authentication error: ${err.message}`, { ip });
    return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
  }

  const validate = req.method === 'POST' ? validatePost : validateGet;
  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`, { ip });
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  try {
    const recaptchaToken = req.headers['x-recaptcha-token'];
    if (!recaptchaToken) {
      logger.error('Missing X-Recaptcha-Token header', { ip });
      return res.status(400).json({ detail: 'Missing reCAPTCHA token in header' });
    }
    await verifyRecaptcha(recaptchaToken, req.method === 'POST' ? 'ai_interaction' : 'get_ai_interaction', ip);

    if (req.method === 'POST') {
      const { uid, query, response, interactionType = 'chat', walletAddress } = req.body;

      if (['chat', 'market'].includes(interactionType)) {
        // Existing logic for chat and market interactions
        if (!uid || uid !== req.session?.user?.id || !query) {
          logger.error(`Invalid parameters: uid=${uid}, sessionUserId=${req.session?.user?.id}, query=${query}`, { ip });
          return res.status(400).json({ detail: 'Missing or invalid parameters' });
        }

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const dateString = today.toISOString().split('T')[0];

        const dailyInteractionRef = db.collection('dailyAIInteractions').doc(`${uid}_${dateString}_${interactionType}`);
        const dailyInteractionDoc = await dailyInteractionRef.get();
        const dailyInteraction = dailyInteractionDoc.exists ? dailyInteractionDoc.data() : { count: 0, points: 0 };

        const maxDailyInteractions = interactionType === 'chat' ? 50 : 5;
        if (dailyInteraction.count >= maxDailyInteractions) {
          return res.status(400).json({
            detail: `You have reached the maximum of ${maxDailyInteractions} daily ${interactionType} interactions. Try again tomorrow.`,
          });
        }

        let pointsAwarded = 0;
        const pointsPerInteraction = 10;
        const batch = db.batch();

        const dailyInteractionData = {
          userId: uid,
          date: today,
          count: dailyInteraction.count + 1,
          interactionType,
          points: interactionType === 'market' ? (dailyInteraction.points || 0) + pointsPerInteraction : dailyInteraction.points || 0,
        };
        batch.set(dailyInteractionRef, dailyInteractionData);

        if (interactionType === 'market') {
          const userRef = db.collection('users').doc(uid);
          const userDoc = await userRef.get();
          if (!userDoc.exists) {
            logger.error(`User ${uid} not found`, { ip });
            return res.status(404).json({ detail: 'User not found' });
          }
          const user = userDoc.data();
          batch.update(userRef, {
            aiPoints: (user.aiPoints || 0) + pointsPerInteraction,
            points: (user.points || 0) + pointsPerInteraction,
          });
          pointsAwarded = pointsPerInteraction;
        }

        const interactionRef = db.collection('aiInteractions').doc();
        batch.set(interactionRef, {
          userId: uid,
          query,
          response,
          createdAt: new Date(),
          interactionType,
        });

        const taskId = interactionType === 'chat' ? 'task8' : 'task9';
        const taskRef = db.collection('tasks').doc(taskId);
        const taskDoc = await taskRef.get();
        if (taskDoc.exists) {
          const task = taskDoc.data();
          if (task.isDaily) {
            const taskCompletionRef = db.collection('taskCompletions').doc(`${uid}_${task.id}_${dateString}`);
            const completionDoc = await taskCompletionRef.get();
            const completionCount = completionDoc.exists ? completionDoc.data().completionCount + 1 : 1;

            if (completionCount <= task.maxCompletions) {
              batch.set(taskCompletionRef, {
                userId: uid,
                taskId: task.id,
                completedAt: today,
                completionCount,
              });

              if (completionCount === task.maxCompletions) {
                const userRef = db.collection('users').doc(uid);
                const userDoc = await userRef.get();
                const user = userDoc.data();
                batch.update(userRef, {
                  taskPoints: (user.taskPoints || 0) + task.points,
                  points: (user.points || 0) + task.points,
                });
              }
            }
          }
        }

        await batch.commit();
        return res.status(200).json({
          success: true,
          interaction: { id: interactionRef.id, userId: uid, query, response, createdAt: new Date(), interactionType },
          pointsAwarded,
        });
      } else if (interactionType === 'analyze-deposit') {
        if (!walletAddress) {
          logger.error('Missing walletAddress for analyze-deposit', { ip });
          return res.status(400).json({ detail: 'Missing walletAddress' });
        }
        const { stdout, stderr } = await execPromise(`python3 scripts/analyze_wallets.py predict ${walletAddress}`);
        if (stderr) {
          logger.error(`Python error: ${stderr}`, { ip });
          return res.status(500).json({ detail: 'AI processing error' });
        }
        const result = JSON.parse(stdout);

        // Store in Firestore
        const nametagRef = db.collection('nametags').doc(walletAddress);
        await nametagRef.set({
          address: walletAddress,
          is_deposit: result.is_deposit,
          nametag: result.nametag || 'Unknown',
          updatedAt: new Date(),
        }, { merge: true });

        logger.info(`Deposit wallet analysis for ${walletAddress}: ${JSON.stringify(result)}`, { ip });
        return res.status(200).json({ success: true, data: result });
      } else if (interactionType === 'detect-large-flow') {
        if (!walletAddress) {
          logger.error('Missing walletAddress for detect-large-flow', { ip });
          return res.status(400).json({ detail: 'Missing walletAddress' });
        }
        const { stdout, stderr } = await execPromise(`python3 scripts/detect_large_flow.py ${walletAddress}`);
        if (stderr) {
          logger.error(`Python error: ${stderr}`, { ip });
          return res.status(500).json({ detail: 'AI processing error' });
        }
        const result = JSON.parse(stdout);

        // Store large transactions in Firestore
        const batch = db.batch();
        for (const tx of result.large_flows) {
          const txRef = db.collection('large_transactions').doc(tx.hash);
          batch.set(txRef, {
            wallet: walletAddress,
            hash: tx.hash,
            value_usd: tx.value_usd,
            to_address: tx.to,
            nametag_to: tx.nametag_to || 'Unknown',
            block_time: tx.block_time,
            createdAt: new Date(),
          });
        }
        await batch.commit();

        logger.info(`Large flow detection for ${walletAddress}: ${JSON.stringify(result)}`, { ip });
        return res.status(200).json({ success: true, data: result });
      }

      logger.warn(`Invalid interactionType: ${interactionType}`, { ip });
      return res.status(400).json({ detail: 'Invalid interactionType' });
    } else if (req.method === 'GET') {
      const { uid, limit = 5, interactionType } = req.query;
      if (!uid || uid !== req.session?.user?.id) {
        logger.error(`Invalid GET parameters: uid=${uid}, sessionUserId=${req.session?.user?.id}`, { ip });
        return res.status(400).json({ detail: 'Missing or invalid user ID' });
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const dateString = today.toISOString().split('T')[0];

      const dailyInteractionRef = db.collection('dailyAIInteractions').doc(`${uid}_${dateString}_${interactionType || 'chat'}`);
      const dailyInteractionDoc = await dailyInteractionRef.get();
      const dailyInteraction = dailyInteractionDoc.exists ? dailyInteractionDoc.data() : { count: 0 };

      let query = db.collection('aiInteractions').where('userId', '==', uid);
      if (interactionType) {
        query = query.where('interactionType', '==', interactionType);
      }
      const interactionsSnapshot = await query.orderBy('createdAt', 'desc').limit(parseInt(limit)).get();
      const interactions = interactionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      return res.status(200).json({
        success: true,
        interactions,
        pointsCount: Math.min(dailyInteraction.count || 0, 5),
        totalCount: dailyInteraction.count || 0,
      });
    } else {
      logger.warn(`Method not allowed: ${req.method}`, { ip });
      return res.status(405).json({ detail: 'Method not allowed' });
    }
  } catch (error) {
    logger.error(`Error processing request: ${error.message}`, {
      stack: error.stack,
      code: error.code,
      details: error.details,
      ip,
    });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}