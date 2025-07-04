import { db } from '../../utils/firebaseAdmin';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import axios from 'axios';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { logger } from '../../utils/logger';
import { getSecrets } from '../../lib/vault';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  },
});

const validate = [
  body('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
  body('recaptchaToken').isString().withMessage('Invalid reCAPTCHA token'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10kb',
    },
  },
};

export default async function handler(req, res) {
  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip });
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  const authOptionsInstance = await authOptions();
  const session = await getServerSession(req, res, authOptionsInstance);
  if (!session) {
    logger.warn('Unauthorized access attempt', { method: req.method });
    return res.status(401).json({ detail: 'Not signed in' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`, { uid: req.body.uid });
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
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    await verifyRecaptcha(recaptchaToken, 'analyze_tweets', ip);
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, { uid });
    return res.status(403).json({ detail: 'reCAPTCHA verification failed. Please try again.' });
  }

  try {
    const secrets = await getSecrets();
    const accessToken = secrets.TWITTER_BEARER_TOKEN;
    if (!accessToken) {
      logger.error('Twitter Bearer Token not configured', { uid });
      return res.status(500).json({ detail: 'Server configuration error: Missing Twitter Bearer Token' });
    }

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists || !userDoc.data().twitterConnected) {
      logger.warn(`Twitter account not connected for user: ${uid}`);
      return res.status(403).json({ detail: 'Twitter account not connected' });
    }
    const user = userDoc.data();

    let twitterHandle = user.twitterHandle?.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
    if (!twitterHandle || !twitterHandle.match(/^[A-Za-z0-9_]{1,15}$/)) {
      logger.error(`Invalid Twitter handle: ${twitterHandle}`, { uid });
      return res.status(400).json({ detail: 'Invalid Twitter handle' });
    }

    const userResponse = await axios.get(
      `https://api.twitter.com/2/users/by/username/${encodeURIComponent(twitterHandle)}?user.fields=id`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      }
    );

    if (!userResponse.data?.data?.id) {
      logger.error(`Twitter user not found: ${twitterHandle}`, { uid });
      return res.status(400).json({ detail: 'Twitter user not found' });
    }

    const twitterUserId = userResponse.data.data.id;
    const tweetsResponse = await axios.get(
      `https://api.twitter.com/2/users/${twitterUserId}/tweets?tweet.fields=created_at,text&max_results=10`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      }
    );

    if (!tweetsResponse.data?.data?.length) {
      logger.warn(`No tweets found for user: ${twitterUserId}`, { uid });
      return res.status(400).json({ detail: 'No tweets found' });
    }

    let totalTweetPoints = user.tweetPoints || 0;
    const cryptoKeywords = ['crypto', 'blockchain', 'bitcoin', 'ethereum', 'web3', 'nft'];

    const batch = db.batch();
    const tweetAnalyses = [];
    tweetsResponse.data.data.forEach((tweet) => {
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

      const analysisRef = db.collection('tweetAnalyses').doc(tweet.id);
      batch.set(analysisRef, {
        userId: uid,
        tweetId: tweet.id,
        text: tweet.text,
        points,
        createdAt: new Date(tweet.created_at),
      });
      tweetAnalyses.push({
        id: tweet.id,
        userId: uid,
        tweetId: tweet.id,
        text: tweet.text,
        points,
        createdAt: new Date(tweet.created_at),
      });
    });

    const totalPoints = totalTweetPoints + (user.aiPoints || 0) + (user.taskPoints || 0);
    batch.update(userRef, {
      tweetPoints: totalTweetPoints,
      points: totalPoints,
    });

    await batch.commit();
    logger.info(`Tweets analyzed successfully for user: ${uid}`, { totalPoints, tweetPoints: totalTweetPoints });
    return res.status(200).json({
      success: true,
      points: totalPoints,
      tweetPoints: totalTweetPoints,
      message: 'Tweets analyzed and points awarded!',
    });
  } catch (error) {
    logger.error(`Error analyzing tweets: ${error.message}`, {
      uid,
      twitterError: error.response?.data,
      status: error.response?.status,
    });
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