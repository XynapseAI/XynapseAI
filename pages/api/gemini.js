// pages/api/gemini.js
import axios from 'axios';
import { braveSearch } from '../../utils/braveSearch';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';

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
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip',
});

const validate = [
  body('prompt').isString().isLength({ min: 1, max: 3000 }).withMessage('Prompt must be a string between 1 and 3000 characters'),
  body('deepSearch').optional().isBoolean().withMessage('deepSearch must be a boolean'),
  body('tokenSymbol').optional().isString().isLength({ max: 20 }).withMessage('tokenSymbol must not exceed 20 characters'),
  body('recaptchaToken').isString().notEmpty().withMessage('reCAPTCHA token is required'),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15kb', // Increased to match grok.js
    },
  },
};

export default async function handler(req, res) {
  helmet({ contentSecurityPolicy: false })(req, res, () => {});
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Rate limit exceeded, please try again later.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    logger.warn('Unauthorized request');
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  if (req.method !== 'POST') {
    logger.warn(`Invalid method ${req.method} for ${req.url}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  const { prompt, deepSearch = false, tokenSymbol, recaptchaToken } = req.body;
  logger.info(`Processing Gemini request: prompt="${prompt.substring(0, 50)}...", deepSearch=${deepSearch}, tokenSymbol="${tokenSymbol || 'none'}"`);

  try {
    // Determine reCAPTCHA action based on context
    let action = 'chat'; // Default for general prompts
    if (prompt.match(/\bPredict\b/i)) {
      action = 'predict'; // For prediction prompts
    } else if (prompt.match(/\b(Analyze|Analysis)\b/i) || tokenSymbol) {
      action = 'analyze'; // For analysis prompts or MarketTab
    }
    logger.info(`Verifying reCAPTCHA with action: ${action}`);
    await verifyRecaptcha(recaptchaToken, action, ip);
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`);
    return res.status(403).json({ detail: error.message });
  }

  if (!process.env.GEMINI_API_KEY) {
    logger.error('GEMINI_API_KEY is not configured');
    return res.status(500).json({ detail: 'Server configuration error' });
  }

  try {
    const isTokenRelated = tokenSymbol || prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge|crypto|token|coin|blockchain)\b/i);
    const effectiveTokenSymbol = tokenSymbol?.toUpperCase() || prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge)\b/i)?.[0]?.toUpperCase() || 'BTC';

    let tokenAnalysis = '';
    let links = [];
    if (isTokenRelated && (prompt.match(/\b(Analyze|Analysis|Predict)\b/i) || tokenSymbol)) {
      try {
        const analysisResponse = await axios.post(`${process.env.NEXTAUTH_URL}/api/token-analysis`, {
          tokenSymbol: effectiveTokenSymbol,
          recaptchaToken,
        });
        tokenAnalysis = analysisResponse.data.aiAnalysis || 'No social media analysis available.';
        links = analysisResponse.data.links || [];

        if (prompt.match(/\b(Analyze|Analysis|Predict)\b/i)) {
          const economicSearch = await braveSearch({
            query: `${effectiveTokenSymbol} crypto price CPI Non-Farm Payrolls GDP Federal Reserve`,
            count: 3,
            freshness: '1m',
          });
          const stockMarketSearch = await braveSearch({
            query: `${effectiveTokenSymbol} crypto price S&P 500 Nasdaq correlation`,
            count: 3,
            freshness: '1m',
          });
          const politicalSearch = await braveSearch({
            query: `${effectiveTokenSymbol} crypto price political news`,
            count: 3,
            freshness: '1m',
          });

          tokenAnalysis += `
### US Economic Impact
${economicSearch.snippets || 'No recent economic data available.'}

### Stock Market Correlation
${stockMarketSearch.snippets || 'No recent stock market correlation data available.'}

### Political News Impact
${politicalSearch.snippets || 'No recent political news impacting the market.'}
          `;
          links = [
            ...links,
            ...(economicSearch.links || []),
            ...(stockMarketSearch.links || []),
            ...(politicalSearch.links || []),
          ];
        }
      } catch (analysisError) {
        logger.error(`Token analysis error: ${analysisError.message}`);
        tokenAnalysis = 'Unable to fetch social media analysis or additional data.';
      }
    }

    let recentInteractions = '';
    if (session?.user?.id) {
      try {
        const interactions = await axios.get(`${process.env.NEXTAUTH_URL}/api/ai-interaction`, {
          params: { uid: session.user.id, limit: 5 },
        });
        recentInteractions = interactions.data.interactions
          .map((i) => `Query: ${i.query}\nResponse: ${i.response}`)
          .join('\n---\n');
      } catch (interactionError) {
        logger.error(`AI interactions error: ${interactionError.message}`);
        recentInteractions = 'Unable to fetch recent interactions.';
      }
    }

    let searchContext = '';
    if (deepSearch) {
      try {
        const { snippets, links: searchLinks } = await braveSearch({ query: prompt, count: 5, freshness: 'pm' });
        searchContext += snippets ? `### Web Insights\n${snippets}\n` : '';
        links = links.concat(searchLinks || []);
      } catch (braveError) {
        logger.error(`Brave search error: ${braveError.message}`);
        searchContext += '\n### Web Insights\nUnable to fetch insights from Brave Search.';
      }

      if (isTokenRelated) {
        try {
          const twitterResponse = await axios.post(`${process.env.NEXTAUTH_URL}/api/twitter-search`, {
            query: prompt,
            tokenSymbol: effectiveTokenSymbol,
          });
          searchContext += `\n### Twitter/X Insights\n${twitterResponse.data.message}\n`;
          if (twitterResponse.data.success && twitterResponse.data.tweets?.length > 0) {
            searchContext += twitterResponse.data.tweets
              .map((tweet) => `- @${tweet.author} (${tweet.verified ? 'Verified' : 'Unverified'}): "${tweet.text.slice(0, 100)}..." (${tweet.likes} likes, ${tweet.retweets} retweets)`)
              .join('\n');
            links = links.concat(twitterResponse.data.tweets.map((tweet) => tweet.link));
          }
        } catch (twitterError) {
          logger.error(`Twitter search error: ${twitterError.message}`);
          searchContext += '\n### Twitter/X Insights\nUnable to fetch Twitter/X data.';
        }
      }
    }

    const aiPrompt = `
Answer in a natural, professional tone (250-300 words for analysis/prediction, concise for general queries) using Markdown with **bold**, *italics*, and tables. Include *not investment advice* for financial queries. Add links as [text](url).

**Data**:
- Token Analysis: ${tokenAnalysis}
- Recent Interactions: ${recentInteractions || 'None'}
- Search Context: ${searchContext}

**Instructions**:
- For financial queries (e.g., analyze, predict), use recent data (economic indicators, stock market trends, political news).
- For general queries, provide a concise, conversational response without financial analysis unless requested.
- Create tables for comparisons or structured data (e.g., likelihood, economic indicators).
- If code is included, add **Explanation** (2-3 sentences) and library installation commands.

**Question**: ${prompt.replace(/[<>{}]/g, '')}
    `.slice(0, 2000);

    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent', // Updated to use gemini-pro for consistency
      {
        contents: [
          {
            parts: [
              {
                text: aiPrompt,
              },
            ],
          },
        ],
      },
      {
        params: { key: process.env.GEMINI_API_KEY },
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const data = response.data;
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      logger.error(`Invalid Gemini response: ${JSON.stringify(data)}`);
      throw new Error('No valid response from Gemini');
    }

    res.status(200).json({ answer: data.candidates[0].content.parts[0].text, links: deepSearch ? links.slice(0, 5) : [] });
  } catch (error) {
    logger.error(`Gemini error: ${error.message}`);
    if (error.response?.status === 429) {
      return res.status(429).json({ detail: 'Gemini API rate limit exceeded, please try again later.' });
    }
    return res.status(error.response?.status || 500).json({
      detail: error.response?.data?.error?.message || 'Unable to fetch response from Gemini.',
    });
  }
}


