import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { braveSearch } from '../../utils/braveSearch.js';
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
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
});

const validate = [
  body('tokenSymbol').isString().isLength({ min: 1, max: 20 }).withMessage('tokenSymbol must be a string between 1 and 20 characters'),
  body('recaptchaToken').isString().notEmpty().withMessage('reCAPTCHA token is required'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15kb',
    },
  },
};

const retryRequest = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1 || error.response?.status !== 429) throw error;
      logger.warn(`Retrying XAI API call (${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Rate limit exceeded, please try again later.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.error(`Authentication error: No session or user ID`);
    return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
  }

  if (req.method !== 'POST') {
    logger.warn(`Invalid method ${req.method} for ${req.url}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors for ${req.url}: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  const { tokenSymbol: rawTokenSymbol, recaptchaToken } = req.body;
  const tokenSymbol = rawTokenSymbol.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!tokenSymbol) {
    logger.warn(`Invalid tokenSymbol after sanitization: ${rawTokenSymbol}`);
    return res.status(400).json({ errors: [{ msg: 'Invalid token symbol' }] });
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'analyze', ip);
    logger.info(`reCAPTCHA verified for action: analyze`);
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`);
    return res.status(403).json({ detail: `reCAPTCHA verification failed: ${error.message}` });
  }

  try {
    logger.info(`Fetching tweets for tokenSymbol: ${tokenSymbol}`);
    const tweetsResult = await query(
      `SELECT id, user_id, tweet_id, text, points, created_at
       FROM tweet_analyses
       WHERE LOWER(text) LIKE $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [`%${tokenSymbol}%`]
    );
    const tweets = tweetsResult.rows;

    logger.info(`Fetching AI interactions for tokenSymbol: ${tokenSymbol}`);
    const aiInteractionsResult = await query(
      `SELECT id, uid, date, interaction_type, count, points, created_at
       FROM daily_ai_interactions
       WHERE LOWER(query) LIKE $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [`%${tokenSymbol}%`]
    );
    const aiInteractions = aiInteractionsResult.rows;

    let aiAnalysis = `Token ${tokenSymbol} recorded ${tweets.length} tweets and ${aiInteractions.length} AI interactions. `;
    let links = [], snippets = null;
    if (tweets.length > 0) {
      const positiveTweets = tweets.filter(t => t.text.toLowerCase().includes('bullish')).length;
      aiAnalysis += `${positiveTweets}/${tweets.length} tweets are positive. `;
    } else {
      aiAnalysis += `No related tweets found. `;
    }
    if (aiInteractions.length > 0) {
      const positiveInteractions = aiInteractions.filter(i => i.response?.toLowerCase().includes('positive')).length;
      aiAnalysis += `${positiveInteractions}/${aiInteractions.length} AI interactions are positive. `;
    } else {
      aiAnalysis += `No related AI interactions found. `;
    }

    try {
      const searchResult = await braveSearch({
        query: `${tokenSymbol} crypto price analysis`,
        count: 3,
        freshness: '1w',
      });
      snippets = searchResult.snippets;
      links = searchResult.links || [];
      aiAnalysis += snippets ? `Web discussions indicate ${links.length} related articles in the past 7 days. ` : `No related web articles found. `;
      logger.info(`Brave Search returned ${links.length} links for ${tokenSymbol}`);
    } catch (braveError) {
      logger.error(`Brave Search error for ${tokenSymbol}: ${braveError.message}`);
      aiAnalysis += `Unable to fetch web articles. `;
    }

    if (process.env.XAI_API_KEY) {
      logger.info(`Calling XAI API for token: ${tokenSymbol}`);
      try {
        const aiResponse = await retryRequest(() =>
          axios.post(
            'https://api.x.ai/v1/completions',
            {
              prompt: `Based on the following JSON data: {"tweets": ${JSON.stringify(tweets)}, "ai": ${JSON.stringify(aiInteractions)}, "brave": ${JSON.stringify(snippets)}}. Rewrite it into a clear, user-friendly paragraph in English for display on a user interface, reflecting analysis and trends related to the token ${tokenSymbol}, based on content from social media, AI, and web information.`,
              max_tokens: 700,
              temperature: 0.7,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.XAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
            }
          )
        );
        const responseText = aiResponse.data.choices[0].text.trim();
        if (responseText) {
          aiAnalysis = responseText
            .replace(/\*\*/g, '')
            .replace(/---/g, '')
            .replace(/<\|separator\|>/g, '')
            .replace(/<\|eos\|>/g, '')
            .replace(/Assistant/g, '')
            .trim();
          logger.info(`XAI API returned analysis for ${tokenSymbol}`);
        }
      } catch (xaiError) {
        logger.error(`XAI API error for ${tokenSymbol}: ${xaiError.message}`);
        aiAnalysis += `Unable to fetch real-time data from XAI. `;
      }
    } else {
      logger.warn(`No XAI_API_KEY provided for ${tokenSymbol}`);
      aiAnalysis += `Additional data required to assess trends. `;
    }

    return res.status(200).json({
      success: true,
      tweets,
      aiInteractions,
      aiAnalysis,
      links,
    });
  } catch (error) {
    logger.error(`Error in token-analysis for ${tokenSymbol}: ${error.message}`, {
      stack: error.stack,
      code: error.code,
      details: error.details,
    });
    return res.status(500).json({ detail: `Unable to analyze token: ${error.message}` });
  }
}