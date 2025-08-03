import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { braveSearch } from '../../../utils/braveSearch';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import { auth } from '@/lib/auth';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:token_analysis:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 10) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 3,
  minTime: 1000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    return await axios.post(url, config.data, {
      ...config,
      headers: {
        ...config.headers,
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    if (error.response?.status === 429 && config.retryCount < 3) {
      const delay = config.retryCount * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRateLimit(url, { ...config, retryCount: config.retryCount + 1 });
    }
    throw error;
  }
});

const bodySchema = z.object({
  tokenSymbol: z.string().min(1).max(20, 'tokenSymbol must be between 1 and 20 characters'),
  recaptchaToken: z.string().nonempty('reCAPTCHA token is required'),
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

  try {
    await verifyRecaptcha(recaptchaToken, 'analyze', ip);
    logger.info(`reCAPTCHA verified for action: analyze`, { ip });
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
    return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          logger.info(`Fetching tweets for tokenSymbol: ${tokenSymbol}`, { ip });
          const tweetsResult = await query(
            `SELECT id, user_id, tweet_id, text, points, created_at
             FROM tweet_analyses
             WHERE LOWER(text) LIKE $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [`%${tokenSymbol}%`]
          );
          const tweets = tweetsResult.rows;

          logger.info(`Fetching AI interactions for tokenSymbol: ${tokenSymbol}`, { ip });
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

          try {
            const searchResult = await braveSearch({
              query: `${tokenSymbol} crypto price analysis`,
              count: 3,
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

          if (process.env.XAI_API_KEY) {
            logger.info(`Calling XAI API for token: ${tokenSymbol}`, { ip });
            try {
              const aiResponse = await fetchWithRateLimit(
                'https://api.x.ai/v1/completions',
                {
                  data: {
                    prompt: `Based on the following JSON data: {"tweets": ${JSON.stringify(tweets)}, "ai": ${JSON.stringify(aiInteractions)}, "brave": ${JSON.stringify(snippets)}}. Rewrite it into a clear, user-friendly paragraph in English for display on a user interface, reflecting analysis and trends related to the token ${tokenSymbol}, based on content from social media, AI, and web information.`,
                    max_tokens: 700,
                    temperature: 0.7,
                  },
                  retryCount: 0,
                }
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
                logger.info(`XAI API returned analysis for ${tokenSymbol}`, { ip });
              }
            } catch (xaiError) {
              logger.error(`XAI API error for ${tokenSymbol}: ${xaiError.message}`, { ip });
              aiAnalysis += `Unable to fetch real-time data from XAI. `;
            }
          } else {
            logger.warn(`No XAI_API_KEY provided for ${tokenSymbol}`, { ip });
            aiAnalysis += `Additional data required to assess trends. `;
          }

          controller.enqueue(JSON.stringify({
            success: true,
            tweets,
            aiInteractions,
            aiAnalysis,
            links,
          }));
          controller.close();
        } catch (error) {
          logger.error(`Error in token-analysis for ${tokenSymbol}: ${error.message}`, {
            stack: error.stack,
            ip,
          });
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