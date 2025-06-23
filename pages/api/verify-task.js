// pages/api/verify-task.js
import { db, admin } from '../../utils/firebaseAdmin.js';
import { requireAuth } from './middleware/auth.js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import TwitterApi from 'twitter-api-v2';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import fetch from 'node-fetch';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: { error: 'Too many requests, please try again later.' },
});

const validate = [
  body('taskId').isString().isLength({ max: 100 }).withMessage('Invalid task ID'),
  body('userId').isString().isLength({ max: 100 }).withMessage('Invalid user ID'),
  body('taskType').isString().isIn(['tweet', 'follow', 'like', 'join', 'ai_interaction']).withMessage('Invalid task type'),
  body('link').optional().isString().isLength({ max: 500 }).withMessage('Invalid link'),
  body('recaptchaToken').isString().withMessage('Invalid reCAPTCHA token'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1kb',
    },
  },
};

export default async function handler(req, res) {
  // Apply security headers
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}`);

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
  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Authentication error: ${err.message}`);
    return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
  }

  // Validate request body
  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  if (req.method !== 'POST') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  const { taskId, userId, taskType, link, recaptchaToken } = req.body;

  // Verify user ID matches session
  if (!taskId || !userId || !taskType || userId !== req.session.user.id) {
    logger.error(`Invalid parameters: taskId=${taskId}, userId=${userId}, sessionUserId=${req.session.user.id}`);
    return res.status(400).json({ detail: 'Missing or invalid parameters' });
  }

  // Verify reCAPTCHA
  try {
    await verifyRecaptcha(recaptchaToken, 'verify_task', ip);
    logger.info('reCAPTCHA verified for action: verify_task');
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`);
    return res.status(403).json({ detail: 'reCAPTCHA verification failed. Please try again.' });
  }

  try {
    // Fetch task
    const taskRef = db.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) {
      logger.error(`Task not found: ${taskId}`);
      return res.status(404).json({ detail: 'Task not found' });
    }
    const task = taskDoc.data();

    // Check daily task limit
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateString = today.toISOString().split('T')[0];
    const completionRef = db.collection('taskCompletions').doc(`${userId}_${taskId}_${dateString}`);
    const completionDoc = await completionRef.get();
    let completionCount = completionDoc.exists ? completionDoc.data().completionCount : 0;

    if (task.isDaily && completionCount >= task.maxCompletions) {
      logger.info(`Daily task limit reached for task: ${taskId}, user: ${userId}`);
      return res.status(400).json({ detail: 'Daily task limit reached' });
    }

    let isCompleted = false;

    // Handle task verification
    if (taskType === 'ai_interaction') {
      const dailyInteractionRef = db.collection('dailyAIInteractions').doc(`${userId}_${dateString}_${taskType}`);
      const dailyInteractionDoc = await dailyInteractionRef.get();
      if (!dailyInteractionDoc.exists) {
        logger.info(`No AI interactions found for user ${userId} on ${dateString}`);
        return res.status(400).json({ detail: 'No AI interactions recorded' });
      }
      if (dailyInteractionDoc.data().count < task.maxCompletions) {
        logger.info(`Insufficient AI interactions: ${dailyInteractionDoc.data().count}/${task.maxCompletions}`);
        return res.status(400).json({ detail: 'Complete all daily AI interactions before verifying' });
      }
      completionCount = dailyInteractionDoc.data().count;
      isCompleted = true;
    } else {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists || !userDoc.data().twitterAccessToken) {
        logger.error(`No Twitter access token for user: ${userId}`);
        return res.status(400).json({ detail: 'Twitter not connected' });
      }
      const user = userDoc.data();
      const twitterClient = new TwitterApi(user.twitterAccessToken);

      if (taskType === 'follow' && link) {
        const targetHandle = link.replace('@', '');
        const { data: targetUser } = await twitterClient.v2.usersByUsernames([targetHandle]);
        if (!targetUser?.[0]?.id) {
          logger.error(`Target Twitter user not found: ${targetHandle}`);
          return res.status(400).json({ detail: 'Invalid Twitter handle' });
        }
        try {
          let allFollowers = [];
          let nextToken = null;
          do {
            const { data, meta } = await twitterClient.v2.followers(targetUser[0].id, {
              max_results: 1000,
              pagination_token: nextToken,
            });
            allFollowers = allFollowers.concat(data || []);
            nextToken = meta.next_token;
          } while (nextToken);
          const userTwitter = await twitterClient.v2.usersByUsernames([user.twitterHandle]);
          const userTwitterId = userTwitter.data?.[0]?.id;
          isCompleted = allFollowers.some((follower) => follower.id === userTwitterId);
          if (!isCompleted) {
            logger.info(`User ${userId} does not follow ${targetHandle}`);
            return res.status(400).json({ detail: `You must follow ${link} to complete this task.` });
          }
        } catch (error) {
          if (error.code === 429) {
            logger.error('Twitter API rate limit exceeded');
            return res.status(429).json({ detail: 'Twitter API rate limit exceeded. Try again later.' });
          }
          throw error;
        }
      } else if (taskType === 'tweet' && link) {
        const userTwitter = await twitterClient.v2.usersByUsernames([user.twitterHandle]);
        const userTwitterId = userTwitter.data?.[0]?.id;
        if (!userTwitterId) {
          logger.error(`Invalid Twitter user: ${user.twitterHandle}`);
          return res.status(400).json({ detail: 'Invalid Twitter user' });
        }
        try {
          let allTweets = [];
          let nextToken = null;
          do {
            const { data, meta } = await twitterClient.v2.userTimeline(userTwitterId, {
              max_results: 100,
              pagination_token: nextToken,
            });
            allTweets = allTweets.concat(data || []);
            nextToken = meta.next_token;
          } while (nextToken && allTweets.length < 3200);
          isCompleted = allTweets.some((tweet) => tweet.text.includes(link));
          if (!isCompleted) {
            logger.info(`User ${userId} has not tweeted with ${link}`);
            return res.status(400).json({ detail: `You must tweet with ${link} to complete this task.` });
          }
        } catch (error) {
          if (error.code === 429) {
            logger.error('Twitter API rate limit exceeded');
            return res.status(429).json({ detail: 'Twitter API rate limit exceeded. Try again later.' });
          }
          throw error;
        }
      } else if (taskType === 'like' && link) {
        const tweetId = link.match(/status\/(\d+)/)?.[1];
        if (!tweetId) {
          logger.error(`Invalid tweet URL: ${link}`);
          return res.status(400).json({ detail: 'Invalid tweet URL' });
        }
        try {
          let allLikers = [];
          let nextToken = null;
          do {
            const { data, meta } = await twitterClient.v2.tweetLikedBy(tweetId, {
              max_results: 100,
              pagination_token: nextToken,
            });
            allLikers = allLikers.concat(data || []);
            nextToken = meta.next_token;
          } while (nextToken);
          const userTwitter = await twitterClient.v2.usersByUsernames([user.twitterHandle]);
          const userTwitterId = userTwitter.data?.[0]?.id;
          isCompleted = allLikers.some((liker) => liker.id === userTwitterId);
          if (!isCompleted) {
            logger.info(`User ${userId} has not liked tweet ${tweetId}`);
            return res.status(400).json({ detail: `You must like the tweet to complete this task.` });
          }
        } catch (error) {
          if (error.code === 429) {
            logger.error('Twitter API rate limit exceeded');
            return res.status(429).json({ detail: 'Twitter API rate limit exceeded. Try again later.' });
          }
          throw error;
        }
      } else if (taskType === 'join' && link) {
        if (!userDoc.data().discordAccessToken) {
          logger.error(`No Discord access token for user: ${userId}`);
          return res.status(400).json({ detail: 'Discord not connected' });
        }
        const discordToken = userDoc.data().discordAccessToken;
        const guildId = link.match(/discord\.gg\/([a-zA-Z0-9]+)/)?.[1];
        if (!guildId) {
          logger.error(`Invalid Discord invite link: ${link}`);
          return res.status(400).json({ detail: 'Invalid Discord invite link' });
        }
        try {
          const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${discordToken}` },
          });
          if (!response.ok) {
            logger.error(`Discord API error: ${response.status}`);
            return res.status(400).json({ detail: 'Failed to verify Discord membership' });
          }
          const guilds = await response.json();
          isCompleted = guilds.some((guild) => guild.id === guildId);
          if (!isCompleted) {
            logger.info(`User ${userId} has not joined Discord server ${guildId}`);
            return res.status(400).json({ detail: 'You must join the Discord server to complete this task.' });
          }
        } catch (error) {
          logger.error(`Discord API error: ${error.message}`);
          return res.status(400).json({ detail: 'Failed to verify Discord membership' });
        }
      } else {
        logger.error(`Invalid task type: ${taskType}`);
        return res.status(400).json({ detail: 'Invalid task type' });
      }
    }

    if (!isCompleted) {
      return res.status(400).json({ detail: 'Task not completed' });
    }

    // Update completion and user points
    const batch = db.batch();
    completionCount = completionDoc.exists ? completionDoc.data().completionCount + 1 : 1;
    batch.set(completionRef, {
      userId,
      taskId,
      completedAt: admin.firestore.Timestamp.fromDate(today),
      completionCount,
    });

    if (!task.isDaily || completionCount === task.maxCompletions) {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      const user = userDoc.data();
      batch.update(userRef, {
        taskPoints: (user.taskPoints || 0) + task.points,
        points: (user.points || 0) + task.points,
      });
    }

    await batch.commit();
    logger.info(`Task ${taskId} verified for user ${userId}, points: ${task.points}`);
    return res.status(200).json({ success: true, message: 'Task verified successfully', completionCount });
  } catch (error) {
    logger.error(`Error verifying task: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Task verification failed: ${error.message}` });
  }
}