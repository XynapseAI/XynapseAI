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
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

const validatePost = [
  body('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ').optional(),
  body('query').isString().isLength({ min: 1, max: 1000 }).withMessage('Query phải từ 1-1000 ký tự').optional(),
  body('response').isString().isLength({ max: 5000 }).withMessage('Response phải <= 5000 ký tự').optional(),
  body('interactionType')
    .isString()
    .isIn(['chat', 'market', 'analyze-deposit', 'detect-large-flow'])
    .optional()
    .withMessage('Loại tương tác không hợp lệ'),
  body('walletAddress')
    .optional()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Địa chỉ EVM không hợp lệ'),
];

const validateGet = [
  expressQuery('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ'),
  expressQuery('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit phải từ 1-20'),
  expressQuery('interactionType')
    .isString()
    .isIn(['chat', 'market', 'analyze-deposit', 'detect-large-flow'])
    .optional()
    .withMessage('Loại tương tác không hợp lệ'),
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
    logger.warn(`CSRF check failed: Invalid or missing Origin/Referer: ${origin}`);
    return false;
  }
  if (!csrfToken || csrfToken !== process.env.CSRF_SECRET) {
    logger.warn(`CSRF check failed: Invalid or missing CSRF token: ${csrfToken}`);
    return false;
  }
  return true;
};

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
  logger.info(`Yêu cầu tới ${req.url} từ IP ${ip}, phương thức: ${req.method}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`, { ip });
    return res.status(429).json({ detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
  }

  if (!checkCSRF(req)) {
    logger.warn(`CSRF check failed`, { ip });
    return res.status(403).json({ detail: 'CSRF check không hợp lệ.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.error(`Lỗi xác thực: Không có session hoặc UID`, { ip });
    return res.status(401).json({ detail: 'Chưa đăng nhập.' });
  }

  await Promise.all((req.method === 'POST' ? validatePost : validateGet).map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`, { ip, body: req.body, query: req.query });
    return res.status(400).json({ detail: 'Xác thực thất bại', errors: errors.array() });
  }

  try {
    const recaptchaToken = req.headers['x-recaptcha-token'];
    if (!recaptchaToken) {
      logger.error('Thiếu header X-Recaptcha-Token', { ip });
      return res.status(400).json({ detail: 'Thiếu token reCAPTCHA trong header' });
    }
    await verifyRecaptcha(recaptchaToken, req.method === 'POST' ? 'ai_interaction' : 'get_ai_interaction', ip);

    if (req.method === 'POST') {
      const { uid, query: queryText, response, interactionType = 'chat', walletAddress } = req.body;

      if (['chat', 'market'].includes(interactionType)) {
        if (!uid || uid !== session.user.id || !queryText) {
          logger.error(`Tham số không hợp lệ: uid=${uid}, sessionUserId=${session.user.id}, query=${queryText}`, { ip });
          return res.status(400).json({ detail: 'Tham số thiếu hoặc không hợp lệ' });
        }

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const dateString = today.toISOString().split('T')[0];
        const interactionId = `${uid}_${dateString}_${interactionType}`;

        let dailyInteraction;
        try {
          const dailyInteractionResult = await query(
            `SELECT count, points FROM daily_ai_interactions WHERE id = $1`,
            [interactionId]
          );
          dailyInteraction = dailyInteractionResult.rows[0] || { count: 0, points: 0 };
        } catch (error) {
          if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
            logger.error(`Bảng daily_ai_interactions không tồn tại`, { ip });
            return res.status(500).json({ detail: 'Lỗi server: Bảng daily_ai_interactions không tồn tại' });
          }
          throw error;
        }

        const maxDailyInteractions = interactionType === 'chat' ? 50 : 5;
        if (dailyInteraction.count >= maxDailyInteractions) {
          return res.status(400).json({
            detail: `Đã đạt tối đa ${maxDailyInteractions} tương tác ${interactionType} hàng ngày. Thử lại vào ngày mai.`,
          });
        }

        let pointsAwarded = 0;
        const pointsPerInteraction = 10;

        try {
          await query(
            `INSERT INTO daily_ai_interactions (id, uid, date, interaction_type, count, points, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
               count = daily_ai_interactions.count + 1,
               points = daily_ai_interactions.points + $6,
               updated_at = CURRENT_TIMESTAMP`,
            [interactionId, uid, today, interactionType, dailyInteraction.count + 1, pointsPerInteraction, new Date()]
          );
        } catch (error) {
          if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
            logger.error(`Bảng daily_ai_interactions không tồn tại`, { ip });
            return res.status(500).json({ detail: 'Lỗi server: Bảng daily_ai_interactions không tồn tại' });
          }
          throw error;
        }

        if (interactionType === 'market') {
          let user;
          try {
            const userResult = await query(`SELECT points, ai_points FROM users WHERE id = $1`, [uid]);
            if (userResult.rows.length === 0) {
              logger.error(`Không tìm thấy người dùng: ${uid}`, { ip });
              return res.status(404).json({ detail: 'Không tìm thấy người dùng' });
            }
            user = userResult.rows[0];
          } catch (error) {
            if (error.message.includes('relation "users" does not exist')) {
              logger.error(`Bảng users không tồn tại`, { ip });
              return res.status(500).json({ detail: 'Lỗi server: Bảng users không tồn tại' });
            }
            throw error;
          }

          await query(
            `UPDATE users SET
               ai_points = $1,
               points = $2,
               updated_at = $3
             WHERE id = $4`,
            [user.ai_points + pointsPerInteraction, user.points + pointsPerInteraction, new Date(), uid]
          );
          pointsAwarded = pointsPerInteraction;
        }

        const taskId = interactionType === 'chat' ? 'task8' : 'task9';
        let task;
        try {
          const taskResult = await query(`SELECT points, is_daily, max_completions FROM tasks WHERE id = $1`, [taskId]);
          if (taskResult.rows.length === 0) {
            logger.warn(`Không tìm thấy task: ${taskId}`, { ip });
          } else {
            task = taskResult.rows[0];
          }
        } catch (error) {
          if (error.message.includes('relation "tasks" does not exist')) {
            logger.error(`Bảng tasks không tồn tại`, { ip });
            return res.status(500).json({ detail: 'Lỗi server: Bảng tasks không tồn tại' });
          }
          throw error;
        }

        if (task && task.is_daily) {
          const taskCompletionId = `${uid}_${taskId}_${dateString}`;
          let completionCount;
          try {
            const completionResult = await query(
              `SELECT completion_count FROM task_completions WHERE id = $1`,
              [taskCompletionId]
            );
            completionCount = completionResult.rows[0]?.completion_count + 1 || 1;
          } catch (error) {
            if (error.message.includes('relation "task_completions" does not exist')) {
              logger.error(`Bảng task_completions không tồn tại`, { ip });
              return res.status(500).json({ detail: 'Lỗi server: Bảng task_completions không tồn tại' });
            }
            throw error;
          }

          if (completionCount <= task.max_completions) {
            await query(
              `INSERT INTO task_completions (id, user_id, task_id, completed_at, completion_count)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO UPDATE SET
                 completion_count = $5,
                 completed_at = $4,
                 updated_at = CURRENT_TIMESTAMP`,
              [taskCompletionId, uid, taskId, today, completionCount]
            );

            if (completionCount === task.max_completions) {
              let user;
              try {
                const userResult = await query(`SELECT points, task_points FROM users WHERE id = $1`, [uid]);
                user = userResult.rows[0];
              } catch (error) {
                if (error.message.includes('relation "users" does not exist')) {
                  logger.error(`Bảng users không tồn tại`, { ip });
                  return res.status(500).json({ detail: 'Lỗi server: Bảng users không tồn tại' });
                }
                throw error;
              }

              await query(
                `UPDATE users SET
                   task_points = $1,
                   points = $2,
                   updated_at = $3
                 WHERE id = $4`,
                [user.task_points + task.points, user.points + task.points, new Date(), uid]
              );
            }
          }
        }

        return res.status(200).json({
          success: true,
          interaction: { id: interactionId, userId: uid, query: queryText, response, createdAt: new Date(), interactionType },
          pointsAwarded,
        });
      } else if (interactionType === 'analyze-deposit') {
        if (!walletAddress) {
          logger.error('Thiếu walletAddress cho analyze-deposit', { ip });
          return res.status(400).json({ detail: 'Thiếu walletAddress' });
        }
        let result;
        try {
          const { stdout, stderr } = await execPromise(`python3 scripts/analyze_wallets.py predict ${walletAddress}`);
          if (stderr) {
            logger.error(`Lỗi Python: ${stderr}`, { ip });
            return res.status(500).json({ detail: 'Lỗi xử lý AI' });
          }
          result = JSON.parse(stdout);
        } catch (error) {
          logger.error(`Lỗi khi chạy analyze_wallets.py: ${error.message}`, { ip });
          return res.status(500).json({ detail: `Lỗi xử lý AI: ${error.message}` });
        }

        try {
          await query(
            `INSERT INTO nametags (address, nametag, image, description, subcategory)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (address) DO UPDATE SET
               nametag = $2,
               image = $3,
               description = $4,
               subcategory = $5,
               updated_at = CURRENT_TIMESTAMP`,
            [walletAddress.toLowerCase(), result.nametag || 'Unknown', result.image || '/icons/default.png', '', 'Others']
          );
        } catch (error) {
          if (error.message.includes('relation "nametags" does not exist')) {
            logger.error(`Bảng nametags không tồn tại`, { ip });
            return res.status(500).json({ detail: 'Lỗi server: Bảng nametags không tồn tại' });
          }
          throw error;
        }

        logger.info(`Phân tích ví deposit cho ${walletAddress}: ${JSON.stringify(result)}`, { ip });
        return res.status(200).json({ success: true, data: result });
      } else if (interactionType === 'detect-large-flow') {
        if (!walletAddress) {
          logger.error('Thiếu walletAddress cho detect-large-flow', { ip });
          return res.status(400).json({ detail: 'Thiếu walletAddress' });
        }
        let result;
        try {
          const { stdout, stderr } = await execPromise(`python3 scripts/detect_large_flow.py ${walletAddress}`);
          if (stderr) {
            logger.error(`Lỗi Python: ${stderr}`, { ip });
            return res.status(500).json({ detail: 'Lỗi xử lý AI' });
          }
          result = JSON.parse(stdout);
        } catch (error) {
          logger.error(`Lỗi khi chạy detect_large_flow.py: ${error.message}`, { ip });
          return res.status(500).json({ detail: `Lỗi xử lý AI: ${error.message}` });
        }

        try {
          for (const tx of result.large_flows) {
            await query(
              `INSERT INTO large_flows (id, source_wallet_scanned, from_address, to_address, value_usd, tx_hash, block_time, from_nametag, to_nametag, timestamp_recorded)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (id) DO NOTHING`,
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
        } catch (error) {
          if (error.message.includes('relation "large_flows" does not exist')) {
            logger.error(`Bảng large_flows không tồn tại`, { ip });
            return res.status(500).json({ detail: 'Lỗi server: Bảng large_flows không tồn tại' });
          }
          throw error;
        }

        logger.info(`Phát hiện dòng chảy lớn cho ${walletAddress}: ${JSON.stringify(result)}`, { ip });
        return res.status(200).json({ success: true, data: result });
      }

      logger.warn(`Loại tương tác không hợp lệ: ${interactionType}`, { ip });
      return res.status(400).json({ detail: 'Loại tương tác không hợp lệ' });
    } else if (req.method === 'GET') {
      const { uid, limit = 5, interactionType } = req.query;
      if (!uid || uid !== session.user.id) {
        logger.error(`Tham số không hợp lệ: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
        return res.status(400).json({ detail: 'Thiếu hoặc ID người dùng không hợp lệ' });
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const dateString = today.toISOString().split('T')[0];
      const dailyInteractionId = `${uid}_${dateString}_${interactionType || 'chat'}`;

      let dailyInteraction;
      try {
        const dailyInteractionResult = await query(
          `SELECT count FROM daily_ai_interactions WHERE id = $1`,
          [dailyInteractionId]
        );
        dailyInteraction = dailyInteractionResult.rows[0] || { count: 0 };
      } catch (error) {
        if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
          logger.error(`Bảng daily_ai_interactions không tồn tại`, { ip });
          return res.status(500).json({ detail: 'Lỗi server: Bảng daily_ai_interactions không tồn tại' });
        }
        throw error;
      }

      let interactionQuery = `SELECT id, uid, date, interaction_type, count, points, created_at 
                             FROM daily_ai_interactions 
                             WHERE uid = $1`;
      const params = [uid];
      if (interactionType) {
        interactionQuery += ` AND interaction_type = $2`;
        params.push(interactionType);
      }
      interactionQuery += ` ORDER BY created_at DESC LIMIT $3`;
      params.push(parseInt(limit));

      let interactions;
      try {
        const interactionsResult = await query(interactionQuery, params);
        interactions = interactionsResult.rows;
      } catch (error) {
        if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
          logger.error(`Bảng daily_ai_interactions không tồn tại`, { ip });
          return res.status(500).json({ detail: 'Lỗi server: Bảng daily_ai_interactions không tồn tại' });
        }
        throw error;
      }

      return res.status(200).json({
        success: true,
        interactions,
        pointsCount: Math.min(dailyInteraction.count || 0, 5),
        totalCount: dailyInteraction.count || 0,
      });
    } else {
      logger.warn(`Phương thức không được phép: ${req.method}`, { ip });
      return res.status(405).json({ detail: 'Phương thức không được phép' });
    }
  } catch (error) {
    logger.error(`Lỗi xử lý yêu cầu: ${error.message}`, { stack: error.stack, ip });
    return res.status(500).json({ detail: `Lỗi server: ${error.message}` });
  }
}