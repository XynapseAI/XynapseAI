import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import axios from 'axios';
import Bottleneck from 'bottleneck';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:top_holders:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 100) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
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

async function fetchTokenAddressFromSlug(slug, ip) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
  try {
    const response = await fetchWithRateLimit(`${apiBaseUrl}/api/coingecko/token/${slug}`, {
      headers: { 'Content-Type': 'application/json' },
      retryCount: 0,
    });

    if (!response.data?.detail_platforms) {
      logger.warn(`No detail_platforms found for slug ${slug}`, { ip });
      return { chain: null, tokenAddress: null };
    }

    const availableChains = Object.keys(response.data.detail_platforms).filter(
      (chain) =>
        response.data.detail_platforms[chain]?.contract_address?.match(/^0x[a-fA-F0-9]{40}$/)
    );
    const defaultChain = availableChains.includes('ethereum') ? 'ethereum' : availableChains[0] || null;

    if (!defaultChain) {
      logger.warn(`No valid chain found for slug ${slug}`, { ip });
      return { chain: null, tokenAddress: null };
    }

    return {
      chain: defaultChain,
      tokenAddress: response.data.detail_platforms[defaultChain].contract_address,
    };
  } catch (error) {
    logger.error(`Error fetching token address for slug ${slug}: ${error.message}`, { ip });
    return { chain: null, tokenAddress: null };
  }
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const params = Object.fromEntries(request.nextUrl.searchParams);
  logger.info(`Request to /api/top-holders from IP ${ip}, query: ${JSON.stringify(params)}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  const { slug, chain } = params;

  if (!slug || typeof slug !== 'string' || slug.trim() === '') {
    logger.warn(`Invalid slug: ${slug}`, { ip });
    return NextResponse.json({ success: false, detail: 'Invalid slug' }, { status: 400 });
  }

  if (!chain || typeof chain !== 'string' || chain.trim() === '') {
    logger.warn(`Invalid chain: ${chain}`, { ip });
    return NextResponse.json({ success: false, detail: 'Invalid chain' }, { status: 400 });
  }

  const cacheKey = `top-holders_${slug}_${chain}`;
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    logger.info(`Returning cached top holders data for ${slug} on ${chain}`, { ip });
    return new NextResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(cachedData);
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" } }
    );
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          let topHolders;
          if (['bitcoin', 'ethereum'].includes(chain.toLowerCase())) {
            const response = await fetchWithRateLimit(
              `https://api.coingecko.com/api/v3/companies/public_treasury/${chain}`,
              {
                retryCount: 0,
              }
            );

            if (!response.companies || !Array.isArray(response.companies)) {
              logger.warn(`No valid public treasury data for ${chain}`, { ip });
              controller.enqueue(JSON.stringify({ success: false, detail: `No valid public treasury data for ${chain}` }));
              controller.close();
              return;
            }

            topHolders = response.companies.map((company) => ({
              address: company.address || company.name || 'Unknown',
              balance: parseFloat(company.total_holdings) || 0,
              share: parseFloat(company.total_value_usd) / (company.total_holdings || 1) || 0,
              nameTag: company.name || null,
              image: null,
              source: 'CoinGecko',
            }));
          } else {
            const tokenInfo = await fetchTokenAddressFromSlug(slug, ip);
            if (!tokenInfo.tokenAddress) {
              logger.warn(`No valid token address found for slug ${slug} on chain ${chain}`, { ip });
              controller.enqueue(JSON.stringify({ success: false, detail: `No valid token address found for slug ${slug}` }));
              controller.close();
              return;
            }

            const response = await fetchWithRateLimit(
              `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}/api/sim`,
              {
                method: 'POST',
                data: {
                  action: 'top-holders',
                  chain: tokenInfo.chain,
                  tokenAddress: tokenInfo.tokenAddress,
                },
                retryCount: 0,
              }
            );

            if (!response.success) {
              throw new Error(response.detail || 'Failed to fetch top holders');
            }

            topHolders = response.data || [];
          }

          await redisClient.setEx(cacheKey, 3600, JSON.stringify({ success: true, data: topHolders }));
          logger.info(`Successfully fetched top holders for ${slug} on ${chain}`, { ip });
          controller.enqueue(JSON.stringify({ success: true, data: topHolders }));
          controller.close();
        } catch (error) {
          logger.error(`Error fetching top holders for ${slug} on ${chain}: ${error.message}`, {
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
        }
      },
    }),
    { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" } }
  );
}