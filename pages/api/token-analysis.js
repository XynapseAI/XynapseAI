require('dotenv').config({ path: '.env' });
const { db } = require('../../utils/firebaseAdmin');
const { braveSearch } = require('../../utils/braveSearch');
const { verifyRecaptcha } = require('../../utils/verifyRecaptcha');
const { requireAuth } = require('./middleware/auth');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const winston = require('winston');
const helmet = require('helmet');
const axios = require('axios');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
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
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Rate limit exceeded, please try again later.' });
  }

  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Authentication error: ${err.message}`);
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
    const tweetsQuery = db.collection('tweetAnalyses')
      .where('text', '>=', tokenSymbol)
      .where('text', '<=', tokenSymbol + '\uf8ff')
      .orderBy('createdAt', 'desc')
      .limit(10);
    logger.info(`Executing tweetAnalyses query for ${tokenSymbol}`);
    let tweetsSnapshot;
    try {
      tweetsSnapshot = await tweetsQuery.get();
    } catch (queryError) {
      logger.error(`tweetAnalyses query failed for ${tokenSymbol}: ${queryError.message}`, {
        stack: queryError.stack,
        code: queryError.code,
      });
      throw queryError;
    }
    const tweets = tweetsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    logger.info(`Fetched ${tweets.length} tweets for ${tokenSymbol}`);

    logger.info(`Fetching AI interactions for tokenSymbol: ${tokenSymbol}`);
    logger.info(`Querying aiInteractions with range: ${tokenSymbol} to ${tokenSymbol + '\uf8ff'}`);
    const aiInteractionsQuery = db.collection('aiInteractions')
      .where('query', '>=', tokenSymbol)
      .where('query', '<=', tokenSymbol + '\uf8ff')
      .orderBy('createdAt', 'desc')
      .limit(10);
    logger.info(`Executing aiInteractions query for ${tokenSymbol}`);
    let aiInteractionsSnapshot;
    try {
      aiInteractionsSnapshot = await aiInteractionsQuery.get();
    } catch (queryError) {
      logger.error(`aiInteractions query failed for ${tokenSymbol}: ${queryError.message}`, {
        stack: queryError.stack,
        code: queryError.code,
      });
      throw queryError;
    }
    const aiInteractions = aiInteractionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    logger.info(`Fetched ${aiInteractions.length} AI interactions for ${tokenSymbol}`);

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