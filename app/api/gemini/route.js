import { NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { braveSearch, fetchFullContent } from '../../../utils/braveSearch';
import axiosRetry from 'axios-retry';
import crypto from 'crypto';
import cookie from 'cookie';

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

// ================= Environment Variable Validation =================
function validateEnvVars() {
  const requiredVars = ['DATABASE_URL', 'REDIS_URL', 'NEXT_PUBLIC_APP_URL', 'GEMINI_API_KEY'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (process.env.NODE_ENV !== 'production') {
    logger.info('All required environment variables validated');
  }
}

validateEnvVars();

// ================= Redis Client =================
let redisClient;
async function getRedisClient() {
  if (redisClient?.isOpen) {
    return redisClient;
  }
  const maxRetries = 3;
  const delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
      redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
      await redisClient.connect();
      if (process.env.NODE_ENV !== 'production') {
        logger.info('Redis connected');
      }
      return redisClient;
    } catch (err) {
      if (i === maxRetries - 1) throw new Error('Failed to connect to Redis');
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Redis connection failed, retrying...`, { attempt: i + 1, err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// ================= Utility Functions =================
function getClientIp(request) {
  const xForwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const xRealIp = request.headers.get('x-real-ip')?.trim();
  const vercelIp = request.headers.get('x-vercel-forwarded-for')?.trim();
  return xRealIp || vercelIp || xForwardedFor || 'unknown';
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  try {
    return cookie.parse(raw);
  } catch {
    return {};
  }
}

async function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function setCSRFToken(ip, userId) {
  const client = await getRedisClient();
  const token = await generateCSRFToken();
  const key = `csrf:${userId || ip}`;
  await client.setEx(key, 15 * 60, token);
  return token;
}

async function checkDoubleSubmitCSRF(request, ip, userId) {
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookies = parseCookies(request);
  const cookieToken = cookies['csrf_token'] || '';

  if (process.env.NODE_ENV !== 'production') {
    logger.info('Checking CSRF tokens', {
      headerToken: headerToken ? 'provided' : 'missing',
      cookieToken: cookieToken ? 'provided' : 'missing',
    });
  }

  if (process.env.NODE_ENV === 'development' && headerToken === 'dev-csrf' && cookieToken === 'dev-csrf') {
    if (process.env.NODE_ENV !== 'production') {
      logger.info('Development CSRF bypass used');
    }
    return true;
  }

  if (!headerToken || !cookieToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF tokens missing', {
        headerProvided: !!headerToken,
        cookieProvided: !!cookieToken,
      });
    }
    return false;
  }

  if (process.env.NODE_ENV === 'development') {
    const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
    if (!valid && process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token mismatch in development', {
        headerToken: mask(headerToken),
        cookieToken: mask(cookieToken),
      });
    }
    return valid;
  }

  const client = await getRedisClient();
  const storedToken = await client.get(`csrf:${userId || ip}`);
  if (!storedToken) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('CSRF token not found in Redis', { key: `csrf:${userId || ip}` });
    }
    return false;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
    crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken));
  if (!valid && process.env.NODE_ENV !== 'production') {
    logger.warn('CSRF token mismatch', {
      headerToken: mask(headerToken),
      cookieToken: mask(cookieToken),
      storedToken: mask(storedToken),
    });
  }
  return valid;
}

function mask(value, keep = 6) {
  if (!value) return '';
  return value.length <= keep ? '••••' : value.slice(0, keep) + '••••';
}

async function checkRateLimit(ip, userId) {
  const client = await getRedisClient();
  try {
    const windowSeconds = 15 * 60;
    const ipKey = `rate:ip:${ip}`;
    const userKey = userId ? `rate:user:${userId}` : null;
    const ipMax = process.env.NODE_ENV === 'development' ? 1000 : 500;
    const userMax = process.env.NODE_ENV === 'development' ? 500 : 200;

    const ipCount = Number(await client.incr(ipKey));
    if (ipCount === 1) await client.expire(ipKey, windowSeconds);
    if (ipCount > ipMax) {
      const ttl = await client.ttl(ipKey);
      throw Object.assign(new Error('Too many requests from this IP'), { ttl });
    }

    if (userKey) {
      const uCount = Number(await client.incr(userKey));
      if (uCount === 1) await client.expire(userKey, windowSeconds);
      if (uCount > userMax) {
        const ttl = await client.ttl(userKey);
        throw Object.assign(new Error('Too many requests for this user'), { ttl });
      }
    }
  } finally {
    await client.quit().catch(err => {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Redis disconnect failed', { err: err?.message });
      }
    });
  }
}

async function trackViolation(ip, reason, severity = 'warn') {
  if (severity === 'warn') {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Violation recorded (warning)', { ip, reason });
    }
    return;
  }

  const client = await getRedisClient();
  try {
    const key = `violations:${ip}`;
    const maxViolations = 5;
    const windowMs = 15 * 60 * 1000;
    const violations = parseInt(await client.get(key)) || 0;
    if (violations >= maxViolations) {
      await client.setEx(`banned_ip:${ip}`, 3600, 'banned');
      logger.info('IP banned', { ip, reason });
      throw new Error('IP banned due to repeated violations.');
    }
    await client.multi().incr(key).expire(key, Math.floor(windowMs / 1000)).exec();
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('Violation recorded (severe)', { ip, reason, violations: violations + 1 });
    }
  } finally {
    await client.quit().catch(err => {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Redis disconnect failed', { err: err?.message });
      }
    });
  }
}

async function isAllowedOrigin(origin, referer, pathname, ip) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://farcaster.xynapseai.net',
    "https://base.xynapseai.net",
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    return configured.includes(origin) || configured.includes(referer ? new URL(referer).origin : null);
  }

  try {
    if (!origin && !referer) {
      await trackViolation(ip, 'Missing origin and referer in production');
      return false;
    }

    if (origin && origin !== 'null') {
      if (!origin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS origin in production');
        return false;
      }
      if (configured.includes(origin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid origin');
      return false;
    }

    if (referer) {
      const refOrigin = new URL(referer).origin;
      if (!refOrigin.startsWith('https://')) {
        await trackViolation(ip, 'Non-HTTPS referer in production');
        return false;
      }
      if (configured.includes(refOrigin)) {
        return true;
      }
      await trackViolation(ip, 'Invalid referer');
      return false;
    }

    await trackViolation(ip, 'Invalid origin or referer');
    return false;
  } catch {
    await trackViolation(ip, 'Error validating origin');
    return false;
  }
}

function securityHeaders(csrfToken = null) {
  const csp = "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';";
  const headers = {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
  if (csrfToken) {
    headers['Set-Cookie'] = cookie.serialize('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60,
      path: '/',
    });
  }
  return headers;
}

async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Operation failed, retrying...`, { attempt: i + 1, err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Cache durations
const BRAVE_SEARCH_CACHE_DURATION = 15 * 60 * 1000;
const TOKEN_ANALYSIS_CACHE_DURATION = 10 * 60 * 1000;
const GEMINI_API_CACHE_DURATION = 5 * 60 * 1000;

const bodySchema = z.object({
  prompt: z.string().min(1).max(3000, 'Prompt must be between 1 and 3000 characters'),
  deepSearch: z.boolean().optional().default(false),
  tokenSymbol: z.string().max(20, 'tokenSymbol must not exceed 20 characters').optional(),
  recaptchaToken: z.string().optional(),
});

export async function OPTIONS(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;

  if (!(await isAllowedOrigin(origin, referer, pathname, ip))) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request) {
  const ip = getClientIp(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const pathname = new URL(request.url).pathname;
  if (process.env.NODE_ENV !== 'production') {
    logger.info('POST /api/gemini requested', { ip, pathname });
  }

  if (!(await isAllowedOrigin(origin, referer, pathname, ip))) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders() });
  }

  const headers = {
    ...securityHeaders(),
    ...(origin && origin !== 'null' && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    }),
  };

  const startTime = Date.now();
  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    if (!session || !userId) {
      await trackViolation(ip, 'Unauthenticated request');
      return NextResponse.json({ detail: 'Not authenticated. Please log in.' }, { status: 401, headers });
    }

    try {
      await checkRateLimit(ip, userId);
    } catch (err) {
      await trackViolation(ip, err.message);
      return NextResponse.json(
        { detail: 'Too many requests' },
        { status: 429, headers: { ...headers, 'Retry-After': err.ttl.toString() } }
      );
    }

    let newCsrfToken;
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId);
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid CSRF token');
      return NextResponse.json({ detail: 'Invalid CSRF token. Please try again.' }, { status: 403, headers: securityHeaders(newCsrfToken) });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid JSON body');
      return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    let parsedBody;
    try {
      parsedBody = bodySchema.parse(body);
    } catch (err) {
      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      await trackViolation(ip, 'Invalid input data');
      return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400, headers: securityHeaders(newCsrfToken) });
    }

    const { prompt, deepSearch, tokenSymbol, recaptchaToken } = parsedBody;

    if (process.env.DISABLE_RECAPTCHA !== 'true' && recaptchaToken !== 'disabled' && process.env.NODE_ENV !== 'development') {
      try {
        let action = 'chat';
        if (prompt.match(/\bPredict\b/i)) action = 'predict';
        else if (prompt.match(/\b(Analyze|Analysis)\b/i) || tokenSymbol) action = 'analyze';
        const { score } = await verifyRecaptcha(recaptchaToken, action, ip);
        if (score < 0.7) {
          newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
          await trackViolation(ip, 'reCAPTCHA score too low');
          return NextResponse.json({ detail: 'reCAPTCHA verification failed' }, { status: 403, headers: securityHeaders(newCsrfToken) });
        }
        if (process.env.NODE_ENV !== 'production') {
          logger.info('reCAPTCHA OK', { ip, score });
        }
      } catch (error) {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        await trackViolation(ip, 'reCAPTCHA verification failed');
        return NextResponse.json({ detail: `reCAPTCHA verification failed: ${error.message}` }, { status: 403, headers: securityHeaders(newCsrfToken) });
      }
    } else {
      logger.info(`reCAPTCHA verification skipped`, { ip });
    }

    let redisClient;
    try {
      redisClient = await getRedisClient();
      const geminiCacheKey = `gemini:${tokenSymbol || 'general'}:${prompt.slice(0, 50)}`;
      const cachedGeminiResult = await redisClient.get(geminiCacheKey);
      if (cachedGeminiResult) {
        const { answer, links } = JSON.parse(cachedGeminiResult);
        logger.info(`Using cached Gemini result for ${tokenSymbol || 'general'}`, { ip });
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        return NextResponse.json({ answer, links: deepSearch ? links.slice(0, 10) : [] }, { headers: securityHeaders(newCsrfToken) });
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
            const analysisResponse = await withRetry(() =>
              axios.post(
                `${process.env.NEXTAUTH_URL}/api/token-analysis`,
                {
                  tokenSymbol: effectiveTokenSymbol,
                  recaptchaToken,
                },
                { timeout: 40000 }
              )
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
              economicSearch = await withRetry(() =>
                braveSearch({
                  query: `${effectiveTokenSymbol} crypto price impact CPI "Non-Farm Payrolls" GDP "Federal Reserve" site:*.gov | site:*.edu | site:*.org | site:*.com`,
                  count: 5,
                  freshness: '1w',
                })
              );
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
              stockMarketSearch = await withRetry(() =>
                braveSearch({
                  query: `${effectiveTokenSymbol} crypto price correlation "S&P 500" Nasdaq site:*.gov | site:*.edu | site:*.org | site:*.com`,
                  count: 5,
                  freshness: '1w',
                })
              );
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
              politicalSearch = await withRetry(() =>
                braveSearch({
                  query: `${effectiveTokenSymbol} crypto price impact political news policy site:*.gov | site:*.edu | site:*.org | site:*.com`,
                  count: 5,
                  freshness: '1w',
                })
              );
              await redisClient.setEx(politicalCacheKey, BRAVE_SEARCH_CACHE_DURATION / 1000, JSON.stringify(politicalSearch));
            } catch (braveError) {
              logger.error(`Political search error: ${braveError.message}`, { ip });
              politicalSearch = { snippets: 'No recent political news impacting the market.', links: [] };
            }
          }

          for (const link of [...(economicSearch.links || []), ...(stockMarketSearch.links || []), ...(politicalSearch.links || [])].slice(0, 3)) {
            const content = await withRetry(() => fetchFullContent(link.url));
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
        try {
          const interactions = await withRetry(() =>
            axios.get(`${process.env.NEXTAUTH_URL}/api/ai-interaction`, {
              params: { uid: userId, limit: 5 },
              timeout: 40000,
            })
          );
          recentInteractions = interactions.data.interactions
            .map((i) => `Query: ${i.query}\nResponse: ${i.response}`)
            .join('\n---\n');
        } catch (interactionError) {
          logger.error(`AI interactions error: ${interactionError.message}`, { ip });
          recentInteractions = 'Unable to fetch recent interactions.';
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
            const { snippets, links: searchLinks } = await withRetry(() =>
              braveSearch({ query: prompt, count: 5, freshness: 'pw' })
            );
            searchContext += snippets ? `### Web Insights\n${snippets}\n` : '';
            links = links.concat(searchLinks || []);
            for (const link of searchLinks.slice(0, 3)) {
              const content = await withRetry(() => fetchFullContent(link.url));
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

      const response = await withRetry(() =>
        geminiAxios.post(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent',
          {
            contents: [{ parts: [{ text: aiPrompt }] }],
          },
          {
            params: { key: process.env.GEMINI_API_KEY },
            headers: { 'Content-Type': 'application/json' },
            timeout: 40000,
          }
        )
      );

      const data = response.data;
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
        logger.error(`Invalid Gemini response: ${JSON.stringify(data)}`, { ip });
        return NextResponse.json({ detail: 'No valid response from Gemini' }, { status: 500, headers: securityHeaders(newCsrfToken) });
      }

      const answer = data.candidates[0].content.parts[0].text;
      await redisClient.setEx(geminiCacheKey, GEMINI_API_CACHE_DURATION / 1000, JSON.stringify({ answer, links }));
      logger.info(`Gemini API request completed in ${Date.now() - startTime}ms`, { ip });

      newCsrfToken = newCsrfToken || await setCSRFToken(ip, userId);
      return NextResponse.json({ answer, links: deepSearch ? links.slice(0, 10) : [] }, { headers: securityHeaders(newCsrfToken) });
    } finally {
      if (redisClient) {
        await redisClient.quit().catch(err => {
          if (process.env.NODE_ENV !== 'production') {
            logger.warn('Redis disconnect failed in POST', { err: err?.message });
          }
        });
      }
    }
  } catch (error) {
    let newCsrfToken = await setCSRFToken(ip, userId);
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
    return NextResponse.json({ detail }, { status, headers: securityHeaders(newCsrfToken) });
  }
}