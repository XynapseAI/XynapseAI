import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { auth } from '../auth/[...nextauth]/route';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { braveSearch } from '../../../utils/braveSearch';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:gemini:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 5) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const bodySchema = z.object({
  prompt: z.string().min(1).max(3000, 'Prompt must be between 1 and 3000 characters'),
  deepSearch: z.boolean().optional().default(false),
  tokenSymbol: z.string().max(20, 'tokenSymbol must not exceed 20 characters').optional(),
  recaptchaToken: z.string().nonempty('reCAPTCHA token is required'),
});

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/gemini from IP ${ip}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const internalToken = request.headers.get('x-internal-token');
  if (process.env.NODE_ENV !== 'development' || internalToken !== process.env.INTERNAL_API_TOKEN) {
    const session = await auth();
    if (!session) {
      logger.warn('Unauthorized request', { ip });
      return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { prompt, deepSearch, tokenSymbol, recaptchaToken } = parsedBody;

  if (process.env.NODE_ENV !== 'development') {
    try {
      let action = 'chat';
      if (prompt.match(/\bPredict\b/i)) action = 'predict';
      else if (prompt.match(/\b(Analyze|Analysis)\b/i) || tokenSymbol) action = 'analyze';
      await verifyRecaptcha(recaptchaToken, action, ip);
      logger.info(`reCAPTCHA verification successful for ${action}`, { token: recaptchaToken.substring(0, 8) + '...', ip });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403 });
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    logger.error('GEMINI_API_KEY is not configured');
    return NextResponse.json({ detail: 'Server configuration error: Missing GEMINI_API_KEY' }, { status: 500 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          let tokenAnalysis = '';
          let links = [];
          if (prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge|crypto|token|coin|blockchain)\b/i) && (prompt.match(/\b(Analyze|Analysis|Predict)\b/i) || tokenSymbol)) {
            try {
              const effectiveTokenSymbol = tokenSymbol?.toUpperCase() || prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge)\b/i)?.[0]?.toUpperCase() || 'BTC';
              const analysisResponse = await axios.post(`${process.env.NEXTAUTH_URL}/api/token-analysis`, {
                tokenSymbol: effectiveTokenSymbol,
                recaptchaToken,
              });
              tokenAnalysis = analysisResponse.data.aiAnalysis || 'No social media analysis available.';
              links = analysisResponse.data.links || [];

              if (prompt.match(/\b(Analyze|Analysis|Predict)\b/i)) {
                const economicSearch = await braveSearch({ query: `${effectiveTokenSymbol} crypto price CPI Non-Farm Payrolls GDP Federal Reserve`, count: 3, freshness: '1m' });
                const stockMarketSearch = await braveSearch({ query: `${effectiveTokenSymbol} crypto price S&P 500 Nasdaq correlation`, count: 3, freshness: '1m' });
                const politicalSearch = await braveSearch({ query: `${effectiveTokenSymbol} crypto price political news`, count: 3, freshness: '1m' });

                tokenAnalysis += `
### US Economic Impact
${economicSearch.snippets || 'No recent economic data available.'}

### Stock Market Correlation
${stockMarketSearch.snippets || 'No recent stock market correlation data available.'}

### Political News Impact
${politicalSearch.snippets || 'No recent political news impacting the market.'}
                `;
                links = links.concat(
                  (economicSearch.links || []),
                  (stockMarketSearch.links || []),
                  (politicalSearch.links || [])
                );
              }
            } catch (analysisError) {
              logger.error(`Token analysis error: ${analysisError.message}`);
              tokenAnalysis = 'Unable to fetch social media analysis or additional data.';
            }
          }

          let recentInteractions = '';
          if (process.env.NODE_ENV !== 'development') {
            const session = await auth();
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

            if (prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge|crypto|token|coin|blockchain)\b/i)) {
              try {
                const twitterResponse = await axios.post(`${process.env.NEXTAUTH_URL}/api/twitter-search`, {
                  query: prompt,
                  tokenSymbol: tokenSymbol?.toUpperCase() || 'BTC',
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
Answer in a natural, professional tone (150-200 words for analysis/prediction, concise for general queries) using Markdown with **bold**, *italics*, and tables. Include *not investment advice* for financial queries. Add links as [text](url).

**Data**:
- Token Analysis: ${tokenAnalysis}
- Recent Interactions: ${recentInteractions || 'None'}
- Search Context: ${searchContext}

**Instructions**:
- For wallet analysis, focus on transaction behavior and likelihood of being a deposit wallet.
- For general queries, provide a concise, conversational response.
- Create tables for structured data if applicable.
- If code is included, add **Explanation** (2-3 sentences) and library installation commands.

**Question**: ${prompt.replace(/[<>{}]/g, '')}
          `.slice(0, 2000);

          const response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent',
            {
              contents: [{ parts: [{ text: aiPrompt }] }],
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

          controller.enqueue(JSON.stringify({ answer: data.candidates[0].content.parts[0].text, links: deepSearch ? links.slice(0, 5) : [] }));
          controller.close();
        } catch (error) {
          logger.error(`Gemini API error: ${error.message}`, { stack: error.stack, response: error.response?.data });
          const status = error.response?.status || 500;
          const detail =
            status === 429
              ? 'Gemini API rate limit exceeded, please try again later.'
              : error.response?.data?.error?.message || 'Unable to fetch response from Gemini.';
          controller.enqueue(JSON.stringify({ detail }));
          controller.close();
        }
      },
    }),
    { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" } }
  );
}