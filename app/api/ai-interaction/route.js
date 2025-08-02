import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { auth } from '../auth/[...nextauth]/route';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import { logger } from '../../../utils/serverLogger';


const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const pythonServiceRequest = limiter.wrap(async (url, config) => {
  try {
    const response = await axios.post(url, config.data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    logger.error(`Python service error: ${error.message}`, { url, stack: error.stack });
    throw error;
  }
});

async function checkRateLimit(ip) {
  const key = `rate_limit:ai_interaction:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = parseInt(process.env.AI_INTERACTION_RATE_LIMIT_WINDOW || 60 * 1000);
  const maxRequests = parseInt(process.env.AI_INTERACTION_RATE_LIMIT_MAX || 10);
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const postSchema = z.object({
  uid: z.string().max(100, 'Invalid UID').optional(),
  query: z.string().min(1).max(1000, 'Query must be 1-1000 characters').optional(),
  response: z.string().max(5000, 'Response must be <= 5000 characters').optional(),
  interactionType: z.enum(['chat', 'market', 'analyze-deposit', 'detect-large-flow'], { message: 'Invalid interaction type' }).optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address').optional(),
});

const getSchema = z.object({
  uid: z.string().max(100, 'Invalid UID'),
  limit: z.number().int().min(1).max(20, 'Limit must be 1-20').default(5),
  interactionType: z.enum(['chat', 'market', 'analyze-deposit', 'detect-large-flow'], { message: 'Invalid interaction type' }).optional(),
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
];

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken}`, { ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' });
    return false;
  }
  return true;
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/ai-interaction (GET) from IP ${ip}`);

  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) {
    logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  let parsedQuery;
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    parsedQuery = getSchema.parse(params);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400 });
  }

  const { uid, limit, interactionType } = parsedQuery;
  if (uid !== session.user.id) {
    logger.warn(`Unauthorized: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Invalid UID' }, { status: 403 });
  }

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken) {
    logger.warn('Missing X-Recaptcha-Token header', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400 });
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'get_ai_interaction', ip);
  } catch (error) {
    logger.error(`reCAPTCHA verification error: ${error.message}`, { ip });
    return NextResponse.json({ detail: `reCAPTCHA verification error: ${error.message}` }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);
          const dateString = today.toISOString().split('T')[0];
          const dailyInteractionId = `${uid}_${dateString}_${interactionType || 'chat'}`;

          const dailyInteractionResult = await query(
            `SELECT count FROM daily_ai_interactions WHERE id = $1`,
            [dailyInteractionId]
          );
          const dailyInteraction = dailyInteractionResult.rows[0] || { count: 0 };

          let interactionQuery = `SELECT id, uid, date, interaction_type, count, points, created_at 
                                 FROM daily_ai_interactions 
                                 WHERE uid = $1`;
          const params = [uid];
          if (interactionType) {
            interactionQuery += ` AND interaction_type = $2`;
            params.push(interactionType);
          }
          interactionQuery += ` ORDER BY created_at DESC LIMIT $3`;
          params.push(limit);

          const interactionsResult = await query(interactionQuery, params);
          const interactions = interactionsResult.rows;

          logger.info(`Fetched interactions for user ${uid}: ${interactions.length} records`, { ip });
          controller.enqueue(JSON.stringify({
            success: true,
            interactions,
            pointsCount: Math.min(dailyInteraction.count || 0, 5),
            totalCount: dailyInteraction.count || 0,
          }));
          controller.close();
        } catch (error) {
          logger.error(`Error processing GET request: ${error.message}`, { stack: error.stack, ip });
          controller.enqueue(JSON.stringify({ detail: `Server error: ${error.message}` }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
      },
    }
  );
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/ai-interaction (POST) from IP ${ip}`);

  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) {
    logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'CSRF check không hợp lệ.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = postSchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid input data', errors: err.errors }, { status: 400 });
  }

  const { uid, query: queryText, response, interactionType = 'chat', walletAddress } = parsedBody;

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken) {
    logger.warn('Missing X-Recaptcha-Token header', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400 });
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'ai_interaction', ip);
  } catch (error) {
    logger.error(`reCAPTCHA verification error: ${error.message}`, { ip });
    return NextResponse.json({ detail: `reCAPTCHA verification error: ${error.message}` }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          if (['chat', 'market'].includes(interactionType)) {
            if (!uid || uid !== session.user.id || !queryText) {
              logger.warn(`Invalid parameters: uid=${uid}, sessionUserId=${session.user.id}, query=${queryText}`, { ip });
              controller.enqueue(JSON.stringify({ detail: 'Missing or invalid parameters' }));
              controller.close();
              return;
            }

            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            const dateString = today.toISOString().split('T')[0];
            const interactionId = `${uid}_${dateString}_${interactionType}`;

            const dailyInteractionResult = await query(
              `SELECT count, points FROM daily_ai_interactions WHERE id = $1`,
              [interactionId]
            );
            const dailyInteraction = dailyInteractionResult.rows[0] || { count: 0, points: 0 };

            const maxDailyInteractions = parseInt(process.env[`MAX_DAILY_${interactionType.toUpperCase()}_INTERACTIONS`] || (interactionType === 'chat' ? 50 : 5));
            if (dailyInteraction.count >= maxDailyInteractions) {
              controller.enqueue(JSON.stringify({
                detail: `Reached maximum ${maxDailyInteractions} daily ${interactionType} interactions. Try again tomorrow.`,
              }));
              controller.close();
              return;
            }

            const pointsPerInteraction = parseInt(process.env.POINTS_PER_INTERACTION || 10);
            await query(
              `INSERT INTO daily_ai_interactions (id, uid, date, interaction_type, count, points, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (id) DO UPDATE SET
                 count = daily_ai_interactions.count + 1,
                 points = daily_ai_interactions.points + $6,
                 updated_at = CURRENT_TIMESTAMP`,
              [interactionId, uid, today, interactionType, dailyInteraction.count + 1, pointsPerInteraction, new Date()]
            );

            let pointsAwarded = 0;
            if (interactionType === 'market') {
              const userResult = await query(`SELECT points, ai_points FROM users WHERE id = $1`, [uid]);
              if (userResult.rows.length === 0) {
                logger.warn(`User not found: ${uid}`, { ip });
                controller.enqueue(JSON.stringify({ detail: 'User not found' }));
                controller.close();
                return;
              }
              const user = userResult.rows[0];

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
            const taskResult = await query(`SELECT points, is_daily, max_completions FROM tasks WHERE id = $1`, [taskId]);
            const task = taskResult.rows[0];

            if (task && task.is_daily) {
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
                     completed_at = $4,
                     updated_at = CURRENT_TIMESTAMP`,
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
                    [user.task_points + task.points, user.points + task.points, new Date(), uid]
                  );
                }
              }
            }

            controller.enqueue(JSON.stringify({
              success: true,
              interaction: { id: interactionId, userId: uid, query: queryText, response, createdAt: new Date(), interactionType },
              pointsAwarded,
            }));
            controller.close();
          } else if (interactionType === 'analyze-deposit') {
            if (!walletAddress) {
              logger.warn('Missing walletAddress for analyze-deposit', { ip });
              controller.enqueue(JSON.stringify({ detail: 'Missing walletAddress' }));
              controller.close();
              return;
            }

            const result = await pythonServiceRequest('http://python-service:5000/analyze-wallets', {
              data: { walletAddress },
            });

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

            logger.info(`Analyzed deposit wallet for ${walletAddress}: ${JSON.stringify(result)}`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data: result }));
            controller.close();
          } else if (interactionType === 'detect-large-flow') {
            if (!walletAddress) {
              logger.warn('Missing walletAddress for detect-large-flow', { ip });
              controller.enqueue(JSON.stringify({ detail: 'Missing walletAddress' }));
              controller.close();
              return;
            }

            const result = await pythonServiceRequest('http://python-service:5000/detect-large-flow', {
              data: { walletAddress },
            });

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

            logger.info(`Detected large flows for ${walletAddress}: ${JSON.stringify(result)}`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data: result }));
            controller.close();
          } else {
            logger.warn(`Invalid interaction type: ${interactionType}`, { ip });
            controller.enqueue(JSON.stringify({ detail: 'Invalid interaction type' }));
            controller.close();
          }
        } catch (error) {
          logger.error(`Error processing POST request: ${error.message}`, { stack: error.stack, ip });
          controller.enqueue(JSON.stringify({ detail: `Server error: ${error.message}` }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
      },
    }
  );
}