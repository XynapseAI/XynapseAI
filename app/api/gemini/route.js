// app/api/gemini/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { braveSearch, fetchFullContent } from '../../../utils/braveSearch';
import axiosRetry from 'axios-retry';

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

// Cache durations
const BRAVE_SEARCH_CACHE_DURATION = 15 * 60 * 1000;
const TOKEN_ANALYSIS_CACHE_DURATION = 10 * 60 * 1000;
const GEMINI_API_CACHE_DURATION = 5 * 60 * 1000;

async function checkRateLimit(ip) {
  const key = `rate_limit:gemini:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 5) {
    throw new Error('Too many request , please try again later.');
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
  recaptchaToken: z.string().optional(),
});

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/gemini from IP ${ip}`);

  const startTime = Date.now();
  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const internalToken = request.headers.get('x-internal-token');
  if (process.env.NODE_ENV !== 'development' || internalToken !== process.env.INTERNAL_API_TOKEN) {
    const session = await auth();
    if (!session || !session.user?.id) {
      logger.warn('Unauthorized request', { ip });
      return NextResponse.json({ detail: 'Not authenticated. Please log in.' }, { status: 401 });
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

  if (process.env.DISABLE_RECAPTCHA !== 'true' && recaptchaToken !== 'disabled') {
    try {
      let action = 'chat';
      if (prompt.match(/\bPredict\b/i)) action = 'predict';
      else if (prompt.match(/\b(Analyze|Analysis)\b/i) || tokenSymbol) action = 'analyze';
      await verifyRecaptcha(recaptchaToken, action, ip);
      logger.info(`reCAPTCHA verification successful for ${action}`, { ip });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
      return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403 });
    }
  } else {
    logger.info(`reCAPTCHA verification skipped for action: ${prompt.match(/\bPredict\b/i) ? 'predict' : 'analyze'}`, { ip });
  }

  if (!process.env.GEMINI_API_KEY) {
    logger.error('GEMINI_API_KEY is not configured', { ip });
    return NextResponse.json({ detail: 'Server configuration error: Missing GEMINI_API_KEY' }, { status: 500 });
  }

  try {
    const geminiCacheKey = `gemini:${tokenSymbol || 'general'}:${prompt.slice(0, 50)}`;
    const cachedGeminiResult = await redisClient.get(geminiCacheKey);
    if (cachedGeminiResult) {
      const { answer, links } = JSON.parse(cachedGeminiResult);
      logger.info(`Using cached Gemini result for ${tokenSymbol || 'general'}`, { ip });
      return NextResponse.json({ answer, links: deepSearch ? links.slice(0, 10) : [] });
    }

    let tokenAnalysis = '';
    let links = [];
    let fullContents = []; 

    if (prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge|crypto|token|coin|blockchain)\b/i) && (prompt.match(/\b(Analyze|Analysis|Predict)\b/i) || tokenSymbol)) {
      const effectiveTokenSymbol = tokenSymbol?.toUpperCase() || prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge)\b/i)?.[0]?.toUpperCase() || 'BTC';
      const tokenAnalysisCacheKey = `token_analysis:${effectiveTokenSymbol}`;
      const cachedTokenAnalysis = await redisClient.get(tokenAnalysisCacheKey);

      if (cachedTokenAnalysis) {
        const { aiAnalysis, links: cachedLinks } = JSON.parse(cachedTokenAnalysis);
        tokenAnalysis = aiAnalysis;
        links = cachedLinks;
        logger.info(`Using cached token analysis for ${effectiveTokenSymbol}`, { ip });
      } else {
        try {
          const analysisResponse = await axios.post(
            `${process.env.NEXTAUTH_URL}/api/token-analysis`,
            {
              tokenSymbol: effectiveTokenSymbol,
              recaptchaToken,
            },
            { timeout: 10000 }
          );
          tokenAnalysis = analysisResponse.data.aiAnalysis || 'No social media analysis available.';
          links = analysisResponse.data.links || [];
          await redisClient.setEx(
            tokenAnalysisCacheKey,
            TOKEN_ANALYSIS_CACHE_DURATION / 1000,
            JSON.stringify({ aiAnalysis: tokenAnalysis, links })
          );
          logger.info(`Fetched token analysis for ${effectiveTokenSymbol}`, { ip });
        } catch (analysisError) {
          logger.error(`Token analysis error: ${analysisError.message}`, { ip });
          tokenAnalysis = 'Unable to fetch social media analysis or additional data.';
        }
      }

      if (prompt.match(/\b(Analyze|Analysis|Predict)\b/i)) {
        const economicCacheKey = `brave_economic:${effectiveTokenSymbol}`;
        const stockMarketCacheKey = `brave_stock:${effectiveTokenSymbol}`;
        const politicalCacheKey = `brave_political:${effectiveTokenSymbol}`;

        const [cachedEconomic, cachedStockMarket, cachedPolitical] = await redisClient.mGet([
          economicCacheKey,
          stockMarketCacheKey,
          politicalCacheKey,
        ]);

        let economicSearch, stockMarketSearch, politicalSearch;

        if (cachedEconomic) {
          economicSearch = JSON.parse(cachedEconomic);
        } else {
          try {
            economicSearch = await braveSearch({
              query: `${effectiveTokenSymbol} crypto price impact CPI "Non-Farm Payrolls" GDP "Federal Reserve" site:*.gov | site:*.edu | site:*.org | site:*.com`,
              count: 5,
              freshness: '1w',
            });
            await redisClient.setEx(economicCacheKey, BRAVE_SEARCH_CACHE_DURATION / 1000, JSON.stringify(economicSearch));
          } catch (braveError) {
            logger.error(`Economic search error: ${braveError.message}`, { ip });
            economicSearch = { snippets: 'No recent economic data available.', links: [] };
          }
        }

        if (cachedStockMarket) {
          stockMarketSearch = JSON.parse(cachedStockMarket);
        } else {
          try {
            stockMarketSearch = await braveSearch({
              query: `${effectiveTokenSymbol} crypto price correlation "S&P 500" Nasdaq site:*.gov | site:*.edu | site:*.org | site:*.com`,
              count: 5,
              freshness: '1w',
            });
            await redisClient.setEx(stockMarketCacheKey, BRAVE_SEARCH_CACHE_DURATION / 1000, JSON.stringify(stockMarketSearch));
          } catch (braveError) {
            logger.error(`Stock market search error: ${braveError.message}`, { ip });
            stockMarketSearch = { snippets: 'No recent stock market correlation data available.', links: [] };
          }
        }

        if (cachedPolitical) {
          politicalSearch = JSON.parse(cachedPolitical);
        } else {
          try {
            politicalSearch = await braveSearch({
              query: `${effectiveTokenSymbol} crypto price impact political news policy site:*.gov | site:*.edu | site:*.org | site:*.com`,
              count: 5,
              freshness: '1w',
            });
            await redisClient.setEx(politicalCacheKey, BRAVE_SEARCH_CACHE_DURATION / 1000, JSON.stringify(politicalSearch));
          } catch (braveError) {
            logger.error(`Political search error: ${braveError.message}`, { ip });
            politicalSearch = { snippets: 'No recent political news impacting the market.', links: [] };
          }
        }

        // Lấy full content từ top 3 links
        for (const link of [...(economicSearch.links || []), ...(stockMarketSearch.links || []), ...(politicalSearch.links || [])].slice(0, 3)) {
          const content = await fetchFullContent(link.url);
          if (content) fullContents.push({ url: link.url, content });
        }

        tokenAnalysis += `
### US Economic Impact
${economicSearch.snippets || 'No recent economic data available.'}

### Stock Market Correlation
${stockMarketSearch.snippets || 'No recent stock market correlation data available.'}

### Political News Impact
${politicalSearch.snippets || 'No recent political news impacting the market.'}

### Full Article Contents
${fullContents.length ? fullContents.map(c => `From ${c.url}:\n${c.content.slice(0, 500)}...`).join('\n\n') : 'No full content fetched.'}
        `;
        links = links.concat(
          (economicSearch.links || []),
          (stockMarketSearch.links || []),
          (politicalSearch.links || [])
        );
      }
    }

    let recentInteractions = '';
    if (process.env.NODE_ENV !== 'development') {
      const session = await auth();
      if (session?.user?.id) {
        try {
          const interactions = await axios.get(`${process.env.NEXTAUTH_URL}/api/ai-interaction`, {
            params: { uid: session.user.id, limit: 5 },
            timeout: 8000,
          });
          recentInteractions = interactions.data.interactions
            .map((i) => `Query: ${i.query}\nResponse: ${i.response}`)
            .join('\n---\n');
        } catch (interactionError) {
          logger.error(`AI interactions error: ${interactionError.message}`, { ip });
          recentInteractions = 'Unable to fetch recent interactions.';
        }
      }
    }

    let searchContext = '';
    if (deepSearch) {
      const braveCacheKey = `brave_search:${prompt.slice(0, 50)}`;
      const cachedBraveResult = await redisClient.get(braveCacheKey);
      if (cachedBraveResult) {
        const { snippets, links: searchLinks } = JSON.parse(cachedBraveResult);
        searchContext += snippets ? `### Web Insights\n${snippets}\n` : '';
        links = links.concat(searchLinks || []);
        logger.info(`Using cached Brave search for prompt`, { ip });
      } else {
        try {
          const { snippets, links: searchLinks } = await braveSearch({ query: prompt, count: 5, freshness: 'pw' });
          searchContext += snippets ? `### Web Insights\n${snippets}\n` : '';
          links = links.concat(searchLinks || []);
          for (const link of searchLinks.slice(0, 3)) {
            const content = await fetchFullContent(link.url);
            if (content) fullContents.push({ url: link.url, content });
          }
          await redisClient.setEx(braveCacheKey, BRAVE_SEARCH_CACHE_DURATION / 1000, JSON.stringify({ snippets, links: searchLinks }));
        } catch (braveError) {
          logger.error(`Brave search error: ${braveError.message}`, { ip });
          searchContext += '\n### Web Insights\nUnable to fetch insights from Brave Search.';
        }
      }

      if (prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge|crypto|token|coin|blockchain)\b/i)) {
        const twitterCacheKey = `twitter_search:${tokenSymbol || 'general'}`;
        const cachedTwitterResult = await redisClient.get(twitterCacheKey);
        if (cachedTwitterResult) {
          const { message, tweets } = JSON.parse(cachedTwitterResult);
          searchContext += `\n### Twitter/X Insights\n${message}\n`;
          if (tweets?.length > 0) {
            searchContext += tweets
              .map((tweet) => `- @${tweet.author} (${tweet.verified ? 'Verified' : 'Unverified'}): "${tweet.text.slice(0, 100)}..." (${tweet.likes} likes, ${tweet.retweets} retweets)`)
              .join('\n');
            links = links.concat(tweets.map((tweet) => tweet.link));
          }
          logger.info(`Using cached Twitter search for ${tokenSymbol || 'general'}`, { ip });
        } else {
          try {
            searchContext += '\n### Twitter/X Insights\nTwitter search disabled for testing.';
          } catch (twitterError) {
            logger.error(`Twitter search error: ${twitterError.message}`, { ip });
            searchContext += '\n### Twitter/X Insights\nUnable to fetch Twitter/X data.';
          }
        }
      }
    }

    const aiPrompt = `
Answer in a natural, professional tone (500-800 words for analysis/prediction, concise for general queries) using Markdown with **bold**, *italics*, and tables. Include *not investment advice* for financial queries. Add links as [text](url). Base your response heavily on the provided search context and data for accuracy and detail.

**Data**:
- Token Analysis: ${tokenAnalysis}
- Recent Interactions: ${recentInteractions || 'None'}
- Search Context: ${searchContext}
- Full Web Contents: ${JSON.stringify(fullContents)}

**Instructions**:
- For wallet analysis, focus on transaction behavior and likelihood of being a deposit wallet.
- For general queries, provide a concise, conversational response.
- Create tables for structured data if applicable.
- If code is included, add **Explanation** (2-3 sentences) and library installation commands.
- Ensure all claims are substantiated by the data or search context.

**Question**: ${prompt.replace(/[<>{}]/g, '')}
    `.slice(0, 2000);

    const response = await geminiAxios.post(
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

    const data = response.data;
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      logger.error(`Invalid Gemini response: ${JSON.stringify(data)}`, { ip });
      return NextResponse.json({ detail: 'No valid response from Gemini' }, { status: 500 });
    }

    const answer = data.candidates[0].content.parts[0].text;
    await redisClient.setEx(geminiCacheKey, GEMINI_API_CACHE_DURATION / 1000, JSON.stringify({ answer, links }));
    logger.info(`Gemini API request completed in ${Date.now() - startTime}ms`, { ip });

    return NextResponse.json({ answer, links: deepSearch ? links.slice(0, 10) : [] });
  } catch (error) {
    logger.error(`Gemini API error: ${error.message}`, {
      stack: error.stack,
      response: error.response?.data,
      ip,
    });
    const status = error.response?.status || 500;
    const detail =
      error.code === 'ECONNABORTED'
        ? 'Request to Gemini API timed out. Please try again later or simplify the request.'
        : error.response?.status === 429
          ? 'Gemini API rate limit exceeded, please try again later.'
          : error.response?.data?.error?.message || `Unable to fetch response from Gemini: ${error.message}`;
    return NextResponse.json({ detail }, { status });
  }
}