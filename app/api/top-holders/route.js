import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import Bottleneck from 'bottleneck';

const prisma = new PrismaClient();

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => logger.error('Redis Client Error', err));
    await redisClient.connect();
    logger.info('Redis connected');
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
  ...(process.env.VERCEL_ENV === 'production' ? [] : ['https://*.vercel.app']),
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/.*\.vercel\.app$/;

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self' https://www.google.com https://www.recaptcha.net; frame-src https://www.google.com https://www.recaptcha.net",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info('No Origin or Referer (likely SSR or server-to-server), allowing request');
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info('No valid Origin or Referer, allowing for SSR compatibility');
    return true;
  }
  const isAllowed = allowedOrigins.some((allowed) =>
    allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(checkOrigin) : allowed === checkOrigin
  ) || vercelPreviewRegex.test(checkOrigin);
  logger.info(`Origin check: ${checkOrigin}, Allowed: ${isAllowed}`);
  return isAllowed;
}

async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned');
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:${ip}`);
  if (isBanned) {
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:${ip}`;
  const maxViolations = 100;
  const windowMs = 30 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid slug', 'Invalid chain'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`);
    return;
  }

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:top_holders:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  const maxRequests = process.env.NODE_ENV === 'development' ? 60 : 50;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
}

async function withRetry(fn, retries = 2, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(`Operation failed, retrying after ${delay}ms`, { attempt: i + 1, error: err.message });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 15 : 5,
  minTime: process.env.NODE_ENV === 'production' ? 200 : 1000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await axios.request({
      url,
      ...config,
      headers: {
        ...config.headers,
        'Content-Type': 'application/json',
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || '',
      },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 429 && config.retryCount < 3) {
      const delay = Math.pow(2, config.retryCount) * 1000 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRateLimit(url, { ...config, retryCount: config.retryCount + 1 });
    }
    throw error;
  }
});

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.info(`Request to /api/top-holders from IP ${ip}, query: ${JSON.stringify(params)}`);

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    ...securityHeaders,
  };

  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked');
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`);
    return NextResponse.json({ success: false, detail: 'Not allowed by CORS' }, { status: 403, headers: corsHeaders });
  }

  try {
    await checkIPBan(ip);
    await checkRateLimit(ip);
  } catch (err) {
    await trackViolation(ip, err.message);
    logger.error(`Rate limit or IP ban error: ${err.message}`);
    return NextResponse.json({ success: false, detail: err.message }, { status: 429, headers: corsHeaders });
  }

  const { chain } = params;

  if (!chain || typeof chain !== 'string' || chain.trim() === '') {
    await trackViolation(ip, 'Invalid chain');
    logger.warn(`Invalid chain: ${chain}`, { ip });
    return NextResponse.json({ success: false, detail: 'Invalid chain' }, { status: 400, headers: corsHeaders });
  }

  const normalizedChain = chain.toLowerCase() === 'binancecoin' ? 'bsc' : chain.toLowerCase();
  const cacheKey = `top-holders_${normalizedChain}`;
  const cachedData = await withRetry(async () => {
    const redisClient = await getRedisClient();
    return await redisClient.get(cacheKey);
  });

  if (cachedData) {
    logger.info(`Returning cached top holders data for ${normalizedChain}`, { ip });
    return new NextResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(cachedData);
          controller.close();
        },
      }),
      { headers: corsHeaders }
    );
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          let topHolders = [];

          // Fetch from top_holders table
          const dbHolders = await withRetry(async () => {
            const holders = await prisma.top_holders.findMany({
              where: { chain: normalizedChain },
              select: {
                address: true,
                balance: true,
                name_tag: true,
                image: true,
              },
              take: 100, // Limit to top 100 holders
            });
            return holders.map((holder) => ({
              address: holder.address.toLowerCase(),
              balance: parseFloat(holder.balance) || 0,
              nameTag: holder.name_tag || null,
              image: holder.image || null,
              source: 'database',
            }));
          });

          topHolders = dbHolders;

          // For Bitcoin and Ethereum, fetch additional treasury data from CoinGecko
          if (['bitcoin', 'ethereum'].includes(normalizedChain)) {
            try {
              const response = await fetchWithRateLimit(
                `https://api.coingecko.com/api/v3/companies/public_treasury/${normalizedChain}`,
                {
                  retryCount: 0,
                }
              );

              if (response.companies && Array.isArray(response.companies)) {
                const treasuryHolders = response.companies.map((company) => ({
                  address: (company.address || company.name || 'unknown').toLowerCase(),
                  balance: parseFloat(company.total_holdings) || 0,
                  share: parseFloat(company.total_value_usd) / (company.total_holdings || 1) || 0,
                  nameTag: company.name || null,
                  image: null,
                  source: 'CoinGecko',
                }));

                // Merge with database holders, avoid duplicates
                const uniqueAddresses = new Set(dbHolders.map((holder) => holder.address));
                topHolders = [
                  ...dbHolders,
                  ...treasuryHolders.filter((holder) => {
                    const addr = holder.address.toLowerCase();
                    if (!uniqueAddresses.has(addr) && addr !== 'unknown') {
                      uniqueAddresses.add(addr);
                      return true;
                    }
                    return false;
                  }),
                ];
              } else {
                logger.warn(`No valid public treasury data for ${normalizedChain}`, { ip });
              }
            } catch (coingeckoError) {
              logger.warn(`Failed to fetch treasury data from CoinGecko for ${normalizedChain}:`, coingeckoError.message);
            }
          }

          // Sort by balance and limit to top 100
          topHolders = topHolders.sort((a, b) => b.balance - a.balance).slice(0, 100);

          if (topHolders.length === 0) {
            throw new Error(`No top holders data available for ${normalizedChain}`);
          }

          // Cache the result
          await withRetry(async () => {
            const redisClient = await getRedisClient();
            await redisClient.setEx(cacheKey, 3600, JSON.stringify({ success: true, data: topHolders }));
          });

          logger.info(`Successfully fetched top holders for ${normalizedChain}`, { ip });
          controller.enqueue(JSON.stringify({ success: true, data: topHolders }));
          controller.close();
        } catch (error) {
          await trackViolation(ip, `Error fetching top holders: ${error.message}`);
          logger.error(`Error fetching top holders for ${normalizedChain}: ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
            stack: error.stack,
            ip,
          });
          const status = error.response?.status || 500;
          const detail =
            status === 429
              ? 'API rate limit exceeded, please try again later.'
              : status === 404
                ? 'Top holders not found'
                : `Failed to fetch top holders: ${error.message}`;
          controller.enqueue(JSON.stringify({ success: false, detail }));
          controller.close();
        } finally {
          await prisma.$disconnect();
        }
      },
    }),
    { headers: corsHeaders }
  );
}