// app/api/twitter-search/route.js
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import { auth } from '../auth/[...nextauth]/route.js';
import { NextResponse } from 'next/server';

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
  handler: () => {
    return NextResponse.json({ success: false, tweets: [], message: 'Rate limit exceeded, try again later.' }, { status: 429 });
  },
  keyGenerator: (req) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown',
  trustProxy: true,
});

const validate = [
  body('query').isString().isLength({ min: 1, max: 500 }).withMessage('Query must be a string from 1-500 characters'),
  body('tokenSymbol').optional().isString().isLength({ max: 20 }).withMessage('TokenSymbol must not exceed 20 characters'),
];

const checkCSRF = (req) => {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
  ];
  const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/');
  const csrfToken = req.headers.get('x-csrf-token');
  if (!origin || !allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
    logger.warn(`CSRF check failed: Invalid or missing Origin/Referer: ${origin}`, { ip: req.ip });
    return false;
  }
  if (!csrfToken || csrfToken !== process.env.CSRF_SECRET) {
    logger.warn(`CSRF check failed: Invalid or missing CSRF token: ${csrfToken}`, { ip: req.ip });
    return false;
  }
  return true;
};

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  logger.info(`Request to /api/twitter-search from IP ${ip}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, null, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, tweets: [], message: 'Rate limit exceeded, try again later.' }, { status: 429 });
  }

  if (!checkCSRF(req)) {
    logger.warn(`CSRF check failed`, { ip });
    return NextResponse.json({ detail: 'CSRF check không hợp lệ.' }, { status: 403 });
  }

  const session = await auth(req);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return NextResponse.json({ detail: 'Unauthorized: Please log in.' }, { status: 401 });
  }

  const body = await req.json();
  await Promise.all(validate.map((validation) => validation.run({ body })));
  const errors = validationResult({ body });
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`, { ip, body });
    return NextResponse.json({ errors: errors.array() }, { status: 400 });
  }

  const { query, tokenSymbol } = body;
  logger.info(`Processing Twitter search: query="${query}", tokenSymbol="${tokenSymbol || 'none'}"`, { ip });

  if (!process.env.TWITTER_BEARER_TOKEN) {
    logger.error('TWITTER_BEARER_TOKEN is not configured', { ip });
    return NextResponse.json({
      success: false,
      tweets: [],
      message: 'Server configuration error: Missing TWITTER_BEARER_TOKEN',
    }, { status: 500 });
  }

  const cacheKey = `${query}-${tokenSymbol || ''}`;
  const CACHE_DURATION = 5 * 60 * 1000;
  const cached = global.tweetCache?.[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    logger.info(`Using cached tweets for ${cacheKey}`, { ip });
    return NextResponse.json({
      success: true,
      tweets: cached.data,
      message: 'Tweets retrieved from cache',
    });
  }

  const trySearch = async (searchQuery) => {
    try {
      logger.info(`Calling Twitter/X API with query: ${searchQuery}`, { ip });
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
      logger.info(`Twitter/X API response: status=${response.status}, rateLimit=${JSON.stringify(rateLimit)}`, { ip });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || 'Twitter/X API error');
      }

      const tweets = data.data || [];
      logger.info(`Raw tweets received: ${tweets.length}`, { ip });

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

      logger.info(`Filtered tweets (likes >= ${MIN_LIKES}): ${formattedTweets.length}`, { ip });
      return formattedTweets;
    } catch (error) {
      throw error;
    }
  };

  try {
    let formattedTweets = await trySearch(`#${tokenSymbol || 'XRP'} OR ${tokenSymbol || 'XRP'} -is:retweet lang:en`);

    if (formattedTweets.length === 0) {
      logger.info('No tweets found, trying fallback query', { ip });
      formattedTweets = await trySearch(`${tokenSymbol || 'XRP'} -is:retweet lang:en`);
    }

    for (const tweet of formattedTweets) {
      await query(
        `INSERT INTO tweet_analyses (tweet_id, user_id, text, points, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tweet_id) DO NOTHING`,
        [
          tweet.id,
          session.user.id,
          tweet.text,
          tweet.likes + tweet.retweets * 2,
          new Date(tweet.created_at),
        ]
      );
    }

    if (!global.tweetCache) global.tweetCache = {};
    global.tweetCache[cacheKey] = { data: formattedTweets, timestamp: Date.now() };
    logger.info(`Saved ${formattedTweets.length} tweets to tweet_analyses and cache`, { ip });

    return NextResponse.json({
      success: true,
      tweets: formattedTweets,
      message: `Successfully retrieved ${formattedTweets.length} tweets`,
    });
  } catch (error) {
    logger.error(`Twitter/X API error: ${error.message}`, { ip, stack: error.stack });
    if (error.response?.status === 429 && cached) {
      logger.info(`API limit reached, using cached tweets for ${cacheKey}`, { ip });
      return NextResponse.json({
        success: true,
        tweets: cached.data,
        message: 'Twitter/X API limit reached, using cached data.',
      });
    }
    if (error.response?.status === 429) {
      logger.warn('Twitter/X API rate limit reached', { ip });
      return NextResponse.json({
        success: false,
        tweets: [],
        message: 'Twitter/X API limit reached, no cached data available.',
      });
    }
    return NextResponse.json({
      success: false,
      tweets: [],
      message: `Tweet search error: ${error.message}`,
    });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };