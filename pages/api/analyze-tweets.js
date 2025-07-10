import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import axios from 'axios';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
});

const validate = [
  body('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
  body('recaptchaToken').isString().notEmpty().withMessage('reCAPTCHA token is required'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10kb',
    },
  },
};

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    logger.warn('Not authenticated');
    return res.status(401).json({ detail: 'Not signed in' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation error: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  if (req.method !== 'POST') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  const { uid, recaptchaToken } = req.body;
  if (!uid || uid !== session.user.id) {
    logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`);
    return res.status(403).json({ detail: 'Access denied' });
  }

  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
    await verifyRecaptcha(recaptchaToken, 'analyze_tweets', ip);
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`);
    return res.status(403).json({ detail: 'reCAPTCHA verification failed. Please try again.' });
  }

  try {
    const userResult = await query(`SELECT twitter_handle, twitter_connected, points, tweet_points, ai_points, task_points FROM users WHERE id = $1`, [uid]);
    if (userResult.rows.length === 0 || !userResult.rows[0].twitter_connected) {
      logger.warn(`Twitter account not connected: ${uid}`);
      return res.status(403).json({ detail: 'Twitter account not connected' });
    }
    const user = userResult.rows[0];

    let twitterHandle = user.twitter_handle
      .replace(/^@/, '')
      .replace(/[^A-Za-z0-9_]/g, '');
    if (!twitterHandle.match(/^[A-Za-z0-9_]{1,15}$/)) {
      logger.error(`Invalid Twitter handle: ${twitterHandle}`);
      return res.status(400).json({ detail: 'Invalid Twitter handle' });
    }

    const accessToken = process.env.TWITTER_BEARER_TOKEN;
    if (!accessToken) {
      logger.error('Twitter Bearer Token not configured');
      return res.status(400).json({ detail: 'Bearer Token not configured' });
    }

    const userResponse = await axios.get(
      `https://api.twitter.com/2/users/by/username/${encodeURIComponent(twitterHandle)}?user.fields=id`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!userResponse.data.data) {
      logger.error(`Twitter user not found: ${twitterHandle}`);
      return res.status(400).json({ detail: 'Twitter user not found' });
    }

    const twitterUserId = userResponse.data.data.id;
    const tweetsResponse = await axios.get(
      `https://api.twitter.com/2/users/${twitterUserId}/tweets?tweet.fields=created_at,text&max_results=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!tweetsResponse.data.data) {
      logger.warn(`No tweets found: ${twitterUserId}`);
      return res.status(400).json({ detail: 'No tweets found' });
    }

    let totalTweetPoints = user.tweet_points || 0;
    const cryptoKeywords = ['crypto', 'blockchain', 'bitcoin', 'ethereum', 'web3', 'nft'];

    const tweetAnalyses = [];
    for (const tweet of tweetsResponse.data.data) {
      let points = 0;
      const text = tweet.text.toLowerCase();
      const length = tweet.text.length;

      if (length > 100) points += 50;
      else if (length > 50) points += 30;
      else points += 10;

      if (cryptoKeywords.some((keyword) => text.includes(keyword))) {
        points += 100;
      }

      if (text.includes('http') || text.includes('#')) points += 20;

      totalTweetPoints += points;

      await query(
        `INSERT INTO tweet_analyses (id, user_id, tweet_id, text, points, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [tweet.id, uid, tweet.id, tweet.text, points, new Date(tweet.created_at)]
      );

      tweetAnalyses.push({ id: tweet.id, userId: uid, tweetId: tweet.id, text: tweet.text, points, createdAt: new Date(tweet.created_at) });
    }

    const totalPoints = totalTweetPoints + (user.ai_points || 0) + (user.task_points || 0);
    await query(
      `UPDATE users SET
         tweet_points = $1,
         points = $2,
         updated_at = $3
       WHERE id = $4`,
      [totalTweetPoints, totalPoints, new Date(), uid]
    );

    return res.status(200).json({
      success: true,
      points: totalPoints,
      tweetPoints: totalTweetPoints,
      message: 'Tweets analyzed and points awarded!',
    });
  } catch (error) {
    logger.error(`Error analyzing tweets: ${error.response?.data || error.message}`);
    if (error.response?.status === 429) {
      return res.status(429).json({
        detail: 'Twitter API rate limit exceeded. Please try again later.',
      });
    }
    return res.status(500).json({
      detail: `Unable to analyze tweets: ${error.response?.data?.errors?.[0]?.message || error.message}`,
    });
  }
}