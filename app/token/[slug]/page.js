// app/token/[slug]/page.js
import { logger } from '../../../utils/serverLogger'; // Thêm server logger
import TokenPageClient from '../../../components/TokenPageClient';
import { getRedisClient } from '../../../lib/redis';
import Bottleneck from 'bottleneck';

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 1,
  minTime: process.env.NODE_ENV === 'production' ? 200 : 1000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await fetch(url, {
      ...config,
      headers: {
        ...config.headers,
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || '',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    logger.info(`Fetched data from ${url}`, { status: response.status });
    return data;
  } catch (error) {
    logger.error(`Fetch error for ${url}: ${error.message}`, { stack: error.stack });
    return null;
  }
});

async function fetchTokenData(slug) {
  let redisClient;
  try {
    redisClient = await getRedisClient();
    const cacheKey = `token-full-${slug}-1-usd`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for token ${slug}`);
      return JSON.parse(cached);
    }

    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
    const response = await fetchWithRateLimit(`${apiBaseUrl}/api/coingecko/token/${slug}`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    if (!response || !response.success || !response.data) {
      logger.error(`Invalid response for ${slug}`, { response });
      return null;
    }

    await redisClient.setEx(cacheKey, 60, JSON.stringify(response));
    logger.info(`Cached token data for ${slug}`);
    return response;
  } catch (error) {
    logger.error(`Error fetching token data for slug ${slug}: ${error.message}`, { stack: error.stack });
    return null;
  } finally {
    if (redisClient?.isOpen) await redisClient.quit();
  }
}

export async function generateStaticParams() {
  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/coins/list', {
      headers: {
        'Content-Type': 'application/json',
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || '',
      },
      cache: 'force-cache',
      next: { revalidate: 86400 },
    });

    if (!response) {
      logger.error('Failed to fetch token list from CoinGecko');
      return [{ slug: 'bitcoin' }, { slug: 'ethereum' }, { slug: 'tether' }, { slug: 'chainlink' }];
    }

    const tokens = response;
    const topTokens = tokens.slice(0, 100);

    const redisClient = await getRedisClient();
    await Promise.all(
      topTokens.slice(0, 20).map(async (token) => {
        const cacheKey = `token-full-${token.id}-1-usd`;
        const cached = await redisClient.get(cacheKey);
        if (!cached) {
          const data = await fetchTokenData(token.id);
          if (data) {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(data));
            logger.info(`Pre-cached token data for ${token.id}`);
          }
        }
      })
    );

    return topTokens.map((token) => ({
      slug: token.id,
    }));
  } catch (error) {
    logger.error('Error in generateStaticParams:', { error: error.message, stack: error.stack });
    return [{ slug: 'bitcoin' }, { slug: 'ethereum' }, { slug: 'tether' }, { slug: 'chainlink' }];
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const data = await fetchTokenData(slug);
  const tokenData = data?.data;

  if (!tokenData) {
    logger.warn(`No token data found for slug ${slug}`);
    return {
      title: 'Token Not Found | Xynapse Dashboard',
      description: 'The requested token could not be found.',
      keywords: 'cryptocurrency, market data, blockchain',
      robots: 'noindex',
    };
  }

  const capitalizedSlug = slug.charAt(0).toUpperCase() + slug.slice(1);
  logger.info(`Generated metadata for ${slug}`, { tokenName: tokenData.name });
  return {
    title: `${tokenData.name || capitalizedSlug}`,
    description: `Explore market data and insights for ${tokenData.name || capitalizedSlug} on our crypto dashboard.`,
    keywords: `${slug}, ${tokenData.symbol?.toUpperCase() || 'token'}, cryptocurrency, market data, blockchain`,
    robots: 'index, follow',
  };
}

export default async function TokenPage({ params }) {
  const { slug } = await params;
  const data = await fetchTokenData(slug);

  if (!data?.data) {
    logger.error(`No token data for ${slug}, rendering not found page`);
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white font-jetbrains">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Token Not Found</h1>
          <p className="text-gray-400 mb-4">The token with slug {slug} could not be found.</p>
          <a href="/dashboard" className="text-neon-blue hover:underline">
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  logger.info(`Rendering TokenPage for ${slug}`, { tokenId: data.data.id });
  return (
    <TokenPageClient
      initialTokenSlug={slug}
      initialTokenData={data.data}
      initialTopHolders={data.topHolders || []}
      initialPriceHistory={data.priceHistory || []}
    />
  );
}

export const revalidate = 300; // Revalidate every 5 minutes