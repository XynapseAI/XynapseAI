import axios from 'axios';
import { braveSearch } from '../../utils/braveSearch';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';
import { getSecrets } from '../../lib/vault'; // Thêm import

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
  max: 5,
  message: { error: 'Too many requests, please try again later.' },
});

const validate = [
  body('prompt').isString().isLength({ min: 1, max: 1000 }),
  body('deepSearch').optional().isBoolean(),
  body('tokenSymbol').optional().isString().isLength({ max: 10 }),
  body('recaptchaToken').isString(),
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15kb',
    },
  },
};

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}`);

  const secrets = await getSecrets(); // Lấy bí mật từ Vault
  const OPENAI_API_KEY = secrets.OPENAI_API_KEY;

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

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  const { prompt, deepSearch = false, tokenSymbol, recaptchaToken } = req.body;

  try {
    await verifyRecaptcha(recaptchaToken, 'chat', ip);
    logger.info('reCAPTCHA verification successful for action: chat');
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`);
    return res.status(403).json({ detail: 'reCAPTCHA verification failed. Please try again.' });
  }

  try {
    logger.info('Processing OpenAI request:', { prompt, deepSearch, tokenSymbol });

    const isTokenRelated = tokenSymbol || prompt.match(/bitcoin|eth|sol|ada|xrp|doge|crypto|token|coin|blockchain/i);
    const effectiveTokenSymbol = tokenSymbol || prompt.match(/bitcoin|eth|sol|ada|xrp|doge/i)?.[0]?.toUpperCase() || 'BTC';

    let tokenAnalysis = '';
    let links = [];
    if (isTokenRelated) {
      try {
        const analysisResponse = await axios.post(`${process.env.NEXTAUTH_URL}/api/token-analysis`, { tokenSymbol: effectiveTokenSymbol });
        tokenAnalysis = analysisResponse.data.aiAnalysis || 'No social media analysis available.';
        links = analysisResponse.data.links || [];
        logger.info('Token analysis:', { tokenAnalysis, links });
      } catch (analysisError) {
        logger.error(`Token analysis error: ${analysisError.message}`, { response: analysisError.response?.data });
        tokenAnalysis = 'Unable to fetch social media analysis.';
      }
    }

    let recentInteractions = '';
    if (session?.user?.id) {
      try {
        const interactions = await axios.get(`${process.env.NEXTAUTH_URL}/api/ai-interaction`, {
          params: { uid: session.user.id, limit: 5 },
          headers: { 'X-Recaptcha-Token': await req.recaptchaRef?.executeAsync?.() || recaptchaToken },
        });
        recentInteractions = interactions.data.interactions
          .map((i) => `Query: ${i.query}\nResponse: ${i.response}`)
          .join('\n---\n');
        logger.info('Fetched recent AI interactions:', recentInteractions);
      } catch (interactionError) {
        logger.error(`AI interactions error: ${interactionError.message}`, { response: interactionError.response?.data });
        recentInteractions = 'Unable to fetch recent interactions.';
      }
    }

    const aiPrompt = `
Answer in a natural, concise tone, adjusting response length (simple or detailed based on context), using Markdown with **bold**, *italics*, and line breaks for readability. For comparisons or analysis (e.g., "compare", "analyze"), create a comparison table. For financial queries, include *not investment advice*. Add links as [text](url).

If the response includes code, add a short **Explanation** (2-3 sentences) describing the code's functionality, and list library installation commands in a code block (e.g. \`\`\`bash\npip install yfinance\n\`\`\`), ensuring correct code syntax.

Based on the following data: ${tokenAnalysis}, ${recentInteractions || 'None'}

Web search (if DeepSearch): Incorporate the latest information.

**Question**: ${prompt.replace(/[<>{}]/g, '')}
    `;

    let searchContext = '';
    if (deepSearch) {
      try {
        const { snippets, links: searchLinks } = await braveSearch({ query: prompt, count: 5, freshness: 'pm' });
        searchContext = snippets || '';
        links = searchLinks;
        logger.info('Brave Search context:', { searchContext, links });
      } catch (searchError) {
        logger.error(`Brave Search API error: ${searchError.message}`, { response: searchError.response?.data });
        searchContext = 'Unable to fetch web information.';
      }
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant. Answer with the latest available information.',
          },
          { role: 'user', content: `${searchContext}\n${aiPrompt}` },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response.data;
    logger.info('OpenAI response:', JSON.stringify(data, null, 2));

    if (!data.choices?.[0]?.message?.content) {
      logger.error(`Invalid OpenAI response: ${JSON.stringify(data)}`);
      throw new Error('No valid response from OpenAI');
    }

    res.status(200).json({ answer: data.choices[0].message.content, links: deepSearch ? links.slice(0, 5) : [] });
  } catch (error) {
    logger.error(`OpenAI handler error: ${error.message}`, { response: error.response?.data });
    if (error.response?.status === 429) {
      return res.status(429).json({ detail: 'OpenAI API rate limit exceeded, please try again later.' });
    }
    return res.status(error.response?.status || 500).json({
      detail: error.response?.data?.error?.message || 'Unable to fetch response from OpenAI.',
    });
  }
}