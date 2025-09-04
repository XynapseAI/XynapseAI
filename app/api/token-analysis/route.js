// app/api/token-analysis/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { braveSearch, fetchFullContent } from '../../../utils/braveSearch';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { auth } from '@/lib/auth';

// Configure axios with retry for Gemini API
const geminiAxios = axios.create();
axiosRetry(geminiAxios, {
  retries: 3,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 1000 + Math.random() * 100,
  retryCondition: (error) =>
    error.code === 'ECONNABORTED' ||
    error.response?.status === 429 ||
    error.response?.status >= 500,
});

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:token_analysis:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 5) {
    throw new Error('Quá nhiều yêu cầu, vui lòng thử lại sau.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const bodySchema = z.object({
  tokenSymbol: z.string().min(1).max(20, 'tokenSymbol must be between 1 and 20 characters'),
  recaptchaToken: z.string().optional(),
});

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/token-analysis from IP ${ip}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.error(`Authentication error: No session or UID`, { ip });
    return NextResponse.json({ detail: 'Unauthorized: Please log in.' }, { status: 401 });
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

  const { tokenSymbol: rawTokenSymbol, recaptchaToken } = parsedBody;
  const tokenSymbol = rawTokenSymbol.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!tokenSymbol) {
    logger.warn(`Invalid tokenSymbol after sanitization: ${rawTokenSymbol}`, { ip });
    return NextResponse.json({ detail: 'Invalid token symbol' }, { status: 400 });
  }

  if (process.env.DISABLE_RECAPTCHA !== 'true' && recaptchaToken !== 'disabled') {
    try {
      await verifyRecaptcha(recaptchaToken, 'analyze', ip);
      logger.info(`reCAPTCHA verified for action: analyze`, { ip });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403 });
    }
  } else {
    logger.info(`reCAPTCHA verification skipped for action: analyze`, { ip });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(JSON.stringify({ progress: 'Fetching tweets...' }));
          const tweetsResult = await query(
            `SELECT id, user_id, tweet_id, text, points, created_at
             FROM tweet_analyses
             WHERE LOWER(text) LIKE $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [`%${tokenSymbol}%`]
          );
          const tweets = tweetsResult.rows;

          controller.enqueue(JSON.stringify({ progress: 'Fetching AI interactions...' }));
          const aiInteractionsResult = await query(
            `SELECT id, uid, date, interaction_type, count, points, created_at
             FROM daily_ai_interactions
             WHERE interaction_type = 'market'
             ORDER BY created_at DESC
             LIMIT 10`
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
            aiAnalysis += `${aiInteractions.length} market-related AI interactions recorded. `;
          } else {
            aiAnalysis += `No related AI interactions found. `;
          }

          controller.enqueue(JSON.stringify({ progress: 'Searching web with Brave...' }));
          try {
            const searchResult = await braveSearch({
              query: `${tokenSymbol} crypto price analysis sentiment news`,
              count: 5,
              freshness: '1w',
            });
            snippets = searchResult.snippets;
            links = searchResult.links || [];
            aiAnalysis += snippets ? `Web discussions indicate ${links.length} related articles in the past 7 days. ` : `No related web articles found. `;
            logger.info(`Brave Search returned ${links.length} links for ${tokenSymbol}`, { ip });
          } catch (braveError) {
            logger.error(`Brave Search error for ${tokenSymbol}: ${braveError.message}`, { ip });
            aiAnalysis += `Unable to fetch web articles. `;
          }

          // Lấy full content từ top 3 links
          controller.enqueue(JSON.stringify({ progress: 'Fetching full content from articles...' }));
          let fullContents = [];
          for (const link of links.slice(0, 3)) {
            const content = await fetchFullContent(link.url);
            if (content) fullContents.push({ url: link.url, content });
          }
          aiAnalysis += fullContents.length ? `Fetched full content from ${fullContents.length} articles. ` : '';

          controller.enqueue(JSON.stringify({ progress: 'Analyzing with Gemini AI...' }));

          if (!process.env.GEMINI_API_KEY) {
            logger.error('GEMINI_API_KEY is not configured', { ip });
            controller.enqueue(JSON.stringify({ detail: 'Server configuration error: Missing GEMINI_API_KEY' }));
            controller.close();
            return;
          }

          logger.info(`Calling Gemini API for token: ${tokenSymbol}`, { ip });
          try {
            const aiPrompt = `
Answer in a natural, professional tone using Markdown with **bold**, *italics*, and tables. Include *not investment advice*. Add links as [text](url).

**Data**:
- Tweets: ${JSON.stringify(tweets)}
- AI Interactions: ${JSON.stringify(aiInteractions)}
- Brave Search Results: ${JSON.stringify(snippets)}
- Full Web Contents: ${JSON.stringify(fullContents)}

**Instructions**:
- Rewrite the data into a detailed, user-friendly analysis in English (300-500 words) for display on a user interface, reflecting in-depth trends, sentiments, and insights related to the token ${tokenSymbol}, based on content from social media, AI, web information, and full article contents. Include quantitative metrics, quotes from sources, and balanced views.
- Include *not investment advice* for financial context.
- Return a JSON object with two keys: "content" (the Markdown analysis as a string) and "links" (an array of links as { text, url, description, image } objects).

**Output Format**:
{
  "content": "Markdown text here",
  "links": [{ "text": "Article Title", "url": "https://example.com", "description": "Summary", "image": "https://thumbnail.jpg" }, ...]
}
            `.slice(0, 2000);

            const aiResponse = await geminiAxios.post(
              'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent',
              {
                contents: [{ parts: [{ text: aiPrompt }] }],
              },
              {
                params: { key: process.env.GEMINI_API_KEY },
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000,
              }
            );

            const data = aiResponse.data;
            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
              logger.error(`Invalid Gemini response: ${JSON.stringify(data)}`, { ip });
              controller.enqueue(JSON.stringify({ detail: 'No valid response from Gemini' }));
              controller.close();
              return;
            }

            const responseText = data.candidates[0].content.parts[0].text;
            let parsedResponse;
            try {
              parsedResponse = JSON.parse(responseText);
              if (!parsedResponse.content || !Array.isArray(parsedResponse.links)) {
                throw new Error('Invalid response format from Gemini');
              }
            } catch (parseError) {
              logger.error(`Failed to parse Gemini response: ${parseError.message}`, { ip });
              parsedResponse = {
                content: responseText,
                links: links, // Fallback to Brave Search links
              };
            }

            const cacheKey = `token_analysis:${tokenSymbol}`;
            await redisClient.setEx(
              cacheKey,
              10 * 60,
              JSON.stringify({ aiAnalysis: parsedResponse.content, links: parsedResponse.links })
            );

            controller.enqueue(JSON.stringify({
              success: true,
              tweets,
              aiInteractions,
              aiAnalysis: parsedResponse.content,
              links: parsedResponse.links,
            }));
            controller.close();
          } catch (geminiError) {
            logger.error(`Gemini API error for ${tokenSymbol}: ${geminiError.message}`, { ip });
            controller.enqueue(JSON.stringify({
              success: true,
              tweets,
              aiInteractions,
              aiAnalysis: aiAnalysis + 'Unable to fetch real-time data from Gemini.',
              links,
            }));
            controller.close();
          }
        } catch (error) {
          logger.error(`Error in token-analysis for ${tokenSymbol}: ${error.message}`, {
            stack: error.stack,
            ip,
          });
          console.log('Links before sending:', JSON.stringify(links));
          if (error.message.includes('does not exist')) {
            controller.enqueue(JSON.stringify({ detail: `Database error: ${error.message}` }));
          } else {
            controller.enqueue(JSON.stringify({ detail: `Unable to analyze token: ${error.message}` }));
          }
          controller.close();
        }
      },
    }),
    { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" } }
  );
}