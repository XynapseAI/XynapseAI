import { braveSearch } from '../../utils/braveSearch';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha';
import { requireAuth } from './middleware/auth';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import { getSecrets } from '../../lib/vault'; // Thêm import

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
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip',
});

const validate = [
  body('prompt').isString().isLength({ min: 1, max: 1500 }).withMessage('Prompt must be a string between 1 and 1500 characters'),
  body('deepSearch').optional().isBoolean().withMessage('deepSearch must be a boolean'),
  body('tokenSymbol').optional().isString().isLength({ max: 20 }).withMessage('tokenSymbol must not exceed 20 characters'),
  body('recaptchaToken').isString().notEmpty().withMessage('reCAPTCHA token is required'),
];

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } };

export default async function handler(req, res) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}`);

  const secrets = await getSecrets(); // Lấy bí mật từ Vault
  const XAI_API_KEY = secrets.XAI_API_KEY;

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Rate limit exceeded, please try again later.' });
  }

  await new Promise((resolve, reject) => {
    requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
  });

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
  logger.info(`Processing Grok request: prompt="${prompt.substring(0, 50)}...", deepSearch=${deepSearch}, tokenSymbol="${tokenSymbol || 'none'}"`);

  try {
    let action = 'chat';
    if (prompt.match(/\bPredict\b/i)) {
      action = 'predict';
    } else if (prompt.match(/\b(Analyze|Analysis)\b/i) || tokenSymbol) {
      action = 'analyze';
    }
    logger.info(`Verifying reCAPTCHA with action: ${action}`);
    await verifyRecaptcha(recaptchaToken, action, ip);
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`);
    return res.status(403).json({ detail: error.message });
  }

  if (!XAI_API_KEY) {
    logger.error('XAI_API_KEY is not configured');
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
    if (req.session?.user?.id) {
      try {
        const interactions = await axios.get(`${process.env.NEXTAUTH_URL}/api/ai-interaction`, {
          params: { uid: req.session.user.id, limit: 5 },
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

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [
          { role: 'system', content: 'You are Grok, a helpful AI assistant created by xAI. Answer with recent, accurate data in a professional tone.' },
          { role: 'user', content: aiPrompt },
        ],
        temperature: 0.6,
        max_tokens: 1500,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      logger.error(`xAI API error: ${JSON.stringify(data)}`);
      if (response.status === 429) {
        return res.status(429).json({ detail: 'xAI API rate limit exceeded, please try again later.' });
      }
      throw new Error(data.error?.message || 'Error from xAI API');
    }

    if (!data.choices?.[0]?.message?.content) {
      logger.error(`Invalid xAI API response: ${JSON.stringify(data)}`);
      throw new Error('No valid response from Grok');
    }

    res.status(200).json({ answer: data.choices[0].message.content, links: deepSearch ? links.slice(0, 5) : [] });
  } catch (error) {
    logger.error(`Grok error: ${error.message}`);
    res.status(500).json({ detail: 'Unable to fetch response from Grok.' });
  }
}