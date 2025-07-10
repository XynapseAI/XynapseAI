import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, query as expressQuery, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import { exec } from 'child_process';
import util from 'util';

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
  expressQuery('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
  expressQuery('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be 1-20'),
  expressQuery('interactionType')
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
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';

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
    logger.error(`Authentication error: No session or user ID`, { ip });
    return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
  }

  await Promise.all((req.method === 'POST' ? validatePost : validateGet).map((validation) => validation.run(req)));
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
      const { uid, query: queryText, response, interactionType = 'chat', walletAddress } = req.body;

      if (['chat', 'market'].includes(interactionType)) {
        if (!uid || uid !== session.user.id || !queryText) {
          logger.error(`Invalid parameters: uid=${uid}, sessionUserId=${session.user.id}, query=${queryText}`, { ip });
          return res.status(400).json({ detail: 'Missing or invalid parameters' });
        }

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const dateString = today.toISOString().split('T')[0];
        const interactionId = `${uid}_${dateString}_${interactionType}`;

        // Kiểm tra daily_ai_interactions
        const dailyInteractionResult = await query(
          `SELECT count, points FROM daily_ai_interactions WHERE id = $1`,
          [interactionId]
        );
        const dailyInteraction = dailyInteractionResult.rows[0] || { count: 0, points: 0 };

        const maxDailyInteractions = interactionType === 'chat' ? 50 : 5;
        if (dailyInteraction.count >= maxDailyInteractions) {
          return res.status(400).json({
            detail: `You have reached the maximum of ${maxDailyInteractions} daily ${interactionType} interactions. Try again tomorrow.`,
          });
        }

        let pointsAwarded = 0;
        const pointsPerInteraction = 10;

        // Cập nhật daily_ai_interactions
        await query(
          `INSERT INTO daily_ai_interactions (id, uid, date, interaction_type, count, points, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             count = daily_ai_interactions.count + 1,
             points = $6,
             created_at = $7`,
          [
            interactionId,
            uid,
            today,
            interactionType,
            dailyInteraction.count + 1,
            interactionType === 'market' ? dailyInteraction.points + pointsPerInteraction : dailyInteraction.points,
            new Date(),
          ]
        );

        if (interactionType === 'market') {
          const userResult = await query(`SELECT points, ai_points FROM users WHERE id = $1`, [uid]);
          if (userResult.rows.length === 0) {
            logger.error(`User ${uid} not found`, { ip });
            return res.status(404).json({ detail: 'User not found' });
          }
          const user = userResult.rows[0];
          await query(
            `UPDATE users SET
               ai_points = $1,
               points = $2,
               updated_at = $3
             WHERE id = $4`,
            [
              user.ai_points + pointsPerInteraction,
              user.points + pointsPerInteraction,
              new Date(),
              uid,
            ]
          );
          pointsAwarded = pointsPerInteraction;
        }

        // Lưu tương tác AI (tương ứng với aiInteractions trong Firebase)
        const interactionResult = await query(
          `INSERT INTO daily_ai_interactions (id, uid, date, interaction_type, count, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [interactionId + '_' + Date.now(), uid, today, interactionType, 1, new Date()]
        );
        const interactionIdNew = interactionResult.rows[0].id;

        const taskId = interactionType === 'chat' ? 'task8' : 'task9';
        const taskResult = await query(`SELECT points, is_daily, max_completions FROM tasks WHERE id = $1`, [taskId]);
        if (taskResult.rows.length > 0) {
          const task = taskResult.rows[0];
          if (task.is_daily) {
            const taskCompletionId = `${uid}_${taskId}_${dateString}`;
            const completionResult = await query(
              `SELECT completion_count FROM task_completions WHERE id = $1`,
              [taskCompletionId]
            );
            const completionCount = completionResult.rows[0]?.completion_count + 1 || 1;

            if (completionCount <= task.max_completions) {
              await query(
                `INSERT INTO task_completions (id, user_id, task_id, completed_at, completion_count)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET
                   completion_count = $5,
                   completed_at = $4`,
                [taskCompletionId, uid, taskId, today, completionCount]
              );

              if (completionCount === task.max_completions) {
                const userResult = await query(`SELECT points, task_points FROM users WHERE id = $1`, [uid]);
                const user = userResult.rows[0];
                await query(
                  `UPDATE users SET
                     task_points = $1,
                     points = $2,
                     updated_at = $3
                   WHERE id = $4`,
                  [
                    user.task_points + task.points,
                    user.points + task.points,
                    new Date(),
                    uid,
                  ]
                );
              }
            }
          }
        }

        return res.status(200).json({
          success: true,
          interaction: { id: interactionIdNew, userId: uid, query: queryText, response, createdAt: new Date(), interactionType },
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

        // Lưu vào bảng nametags
        await query(
          `INSERT INTO nametags (address, nametag, image, description, subcategory)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (address) DO UPDATE SET
             nametag = $2,
             image = $3,
             description = $4,
             subcategory = $5`,
          [
            walletAddress.toLowerCase(),
            result.nametag || 'Unknown',
            result.image || '/icons/default.png',
            '',
            'Others',
          ]
        );

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

        // Lưu vào bảng large_flows
        for (const tx of result.large_flows) {
          await query(
            `INSERT INTO large_flows (id, source_wallet_scanned, from_address, to_address, value_usd, tx_hash, block_time, from_nametag, to_nametag, timestamp_recorded)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              `${walletAddress}_${tx.hash}`,
              walletAddress.toLowerCase(),
              tx.from.toLowerCase(),
              tx.to.toLowerCase(),
              tx.value_usd,
              tx.hash,
              new Date(tx.block_time),
              tx.nametag_from || 'Unknown',
              tx.nametag_to || 'Unknown',
              new Date(),
            ]
          );
        }

        logger.info(`Large flow detection for ${walletAddress}: ${JSON.stringify(result)}`, { ip });
        return res.status(200).json({ success: true, data: result });
      }

      logger.warn(`Invalid interactionType: ${interactionType}`, { ip });
      return res.status(400).json({ detail: 'Invalid interactionType' });
    } else if (req.method === 'GET') {
      const { uid, limit = 5, interactionType } = req.query;
      if (!uid || uid !== session.user.id) {
        logger.error(`Invalid GET parameters: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
        return res.status(400).json({ detail: 'Missing or invalid user ID' });
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const dateString = today.toISOString().split('T')[0];
      const dailyInteractionId = `${uid}_${dateString}_${interactionType || 'chat'}`;

      const dailyInteractionResult = await query(
        `SELECT count FROM daily_ai_interactions WHERE id = $1`,
        [dailyInteractionId]
      );
      const dailyInteraction = dailyInteractionResult.rows[0] || { count: 0 };

      let interactionQuery = `SELECT * FROM daily_ai_interactions WHERE uid = $1`;
      const params = [uid];
      if (interactionType) {
        interactionQuery += ` AND interaction_type = $2`;
        params.push(interactionType);
      }
      interactionQuery += ` ORDER BY created_at DESC LIMIT $3`;
      params.push(parseInt(limit));

      const interactionsResult = await query(interactionQuery, params);
      const interactions = interactionsResult.rows;

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