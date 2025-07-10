// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { query } from '../../utils/postgres.js';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import pkg from '../../utils/logger.cjs';
import helmet from 'helmet';

const { logger } = pkg;

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-ip';
    logger.info(`Rate limit IP: ${ip}`);
    return ip;
  },
});

const validate = [
  body('query').isString().isLength({ min: 1, max: 500 }).withMessage('Query must be a string from 1-500 characters'),
  body('tokenSymbol').optional().isString().isLength({ max: 20 }).withMessage('TokenSymbol must not exceed 20 characters'),
];

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req, res) {
  req.app?.set('trust proxy', true);
  helmet({ contentSecurityPolicy: false })(req, res, () => {});

  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}`);

  if (req.method !== 'POST') {
    logger.warn(`Invalid method ${req.method} for ${req.url}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ success: false, tweets: [], message: 'Rate limit exceeded, try again later.' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  const { query, tokenSymbol } = req.body;
  logger.info(`Processing Twitter search: query="${query}", tokenSymbol="${tokenSymbol || 'none'}"`);

  if (!process.env.TWITTER_BEARER_TOKEN) {
    logger.error('TWITTER_BEARER_TOKEN is not configured');
    return res.status(500).json({
      success: false,
      tweets: [],
      message: 'Server configuration error: Missing TWITTER_BEARER_TOKEN',
    });
  }

  const cacheKey = `${query}-${tokenSymbol || ''}`;
  const CACHE_DURATION = 5 * 60 * 1000;
  const cached = global.tweetCache?.[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    logger.info(`Using cached tweets for ${cacheKey}`);
    return res.status(200).json({
      success: true,
      tweets: cached.data,
      message: 'Tweets retrieved from cache',
    });
  }

  const trySearch = async (searchQuery) => {
    try {
      logger.info(`Calling Twitter/X API with query: ${searchQuery}`);
      const params = new URLSearchParams({
        query: searchQuery,
        'tweet.fields': 'created_at,text,public_metrics,author_id',
        'expansions': 'author_id',
        'user.fields': 'username,verified',
        max_results: 10,
        sort_order: 'relevancy',
      });
      const response = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
        headers: { Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}` },
      });

      const rateLimit = {
        limit: response.headers.get('x-rate-limit-limit') || 'unknown',
        remaining: response.headers.get('x-rate-limit-remaining') || 'unknown',
        reset: response.headers.get('x-rate-limit-reset') || 'unknown',
      };
      logger.info(`Twitter/X API response: status=${response.status}, rateLimit=${JSON.stringify(rateLimit)}`);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || 'Twitter/X API error');
      }

      const tweets = data.data || [];
      logger.info(`Raw tweets received: ${tweets.length}`);

      const MIN_LIKES = 10;
      const formattedTweets = tweets
        .filter(tweet => tweet.public_metrics?.like_count >= MIN_LIKES)
        .map(tweet => ({
          id: tweet.id,
          text: tweet.text,
          created_at: tweet.created_at,
          likes: tweet.public_metrics?.like_count || 0,
          retweets: tweet.public_metrics?.retweet_count || 0,
          author: data.includes?.users?.find(user => user.id === tweet.author_id)?.username || 'Unknown',
          verified: data.includes?.users?.find(user => user.id === tweet.author_id)?.verified || false,
          link: `https://x.com/${data.includes?.users?.find(user => user.id === tweet.author_id)?.username || 'user'}/status/${tweet.id}`,
        }));

      logger.info(`Filtered tweets (likes >= ${MIN_LIKES}): ${formattedTweets.length}`);
      return formattedTweets;
    } catch (error) {
      throw error;
    }
  };

  try {
    let formattedTweets = await trySearch(`#${tokenSymbol || 'XRP'} OR ${tokenSymbol || 'XRP'} -is:retweet lang:en`);

    if (formattedTweets.length === 0) {
      logger.info('No tweets found, trying fallback query');
      formattedTweets = await trySearch(`${tokenSymbol || 'XRP'} -is:retweet lang:en`);
    }

    // Save to PostgreSQL
    for (const tweet of formattedTweets) {
      await query(
        `INSERT INTO tweet_analyses (tweet_id, user_id, text, points, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tweet_id) DO NOTHING`,
        [
          tweet.id,
          'system',
          tweet.text,
          tweet.likes + tweet.retweets * 2,
          new Date(tweet.created_at),
        ]
      );
    }

    if (!global.tweetCache) global.tweetCache = {};
    global.tweetCache[cacheKey] = { data: formattedTweets, timestamp: Date.now() };
    logger.info(`Saved ${formattedTweets.length} tweets to tweet_analyses and cache`);

    return res.status(200).json({
      success: true,
      tweets: formattedTweets,
      message: `Successfully retrieved ${formattedTweets.length} tweets`,
    });
  } catch (error) {
    logger.error(`Twitter/X API error: ${error.message}`);
    if (error.response?.status === 429 && cached) {
      logger.info(`API limit reached, using cached tweets for ${cacheKey}`);
      return res.status(200).json({
        success: true,
        tweets: cached.data,
        message: 'Twitter/X API limit reached, using cached data.',
      });
    }
    if (error.response?.status === 429) {
      logger.warn('Twitter/X API rate limit reached');
      return res.status(200).json({
        success: false,
        tweets: [],
        message: 'Twitter/X API limit reached, no cached data available.',
      });
    }
    return res.status(200).json({
      success: false,
      tweets: [],
      message: `Tweet search error: ${error.message}`,
    });
  }
}