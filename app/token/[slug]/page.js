// app/token/[slug]/page.js
import { revalidateTokenPath } from './actions';
import TokenPageClient from '../../../components/TokenPageClient';
import { getRedisClient } from '../../../lib/redis';
import Bottleneck from 'bottleneck';
import { redirect } from 'next/navigation';

const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 10 : 10,
  minTime: process.env.NODE_ENV === 'production' ? 100 : 1000,
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
    return response.json();
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error);
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
      console.log(`Cache hit for token ${slug}`);
      return JSON.parse(cached);
    }

    const response = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/coins/${slug}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
      {
        headers: { 'Content-Type': 'application/json' },
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    if (!response || !response.id) {
      console.error(`Invalid response for ${slug}:`, response);
      return null;
    }

    const formattedResponse = {
      success: true,
      data: response,
      topHolders: [], // Add logic if needed
      priceHistory: [], // Add logic if needed
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(formattedResponse));
    return formattedResponse;
  } catch (error) {
    console.error(`Error fetching token data for slug ${slug}:`, error);
    return null;
  }
}

export async function generateStaticParams() {
  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/coins/list', {
      headers: {
        'Content-Type': 'application/json',
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || '',
      },
      next: { revalidate: 86400 }, // Cache for 24 hours
    });
    if (!response) {
      console.error('Failed to fetch token list from CoinGecko');
      return [{ slug: 'bitcoin' }, { slug: 'ethereum' }, { slug: 'tether' }, { slug: 'chainlink' }];
    }

    const tokens = response;
    const topTokens = tokens.slice(0, 50);

    const redisClient = await getRedisClient();
    await Promise.all(
      topTokens.slice(0, 20).map(async (token) => {
        const cacheKey = `token-full-${token.id}-1-usd`;
        const cached = await redisClient.get(cacheKey);
        if (!cached) {
          const data = await fetchTokenData(token.id);
          if (data) {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(data));
          }
        }
      })
    );

    return topTokens.map((token) => ({
      slug: token.id,
    }));
  } catch (error) {
    console.error('Error in generateStaticParams:', error);
    return [{ slug: 'bitcoin' }, { slug: 'ethereum' }, { slug: 'tether' }, { slug: 'chainlink' }];
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const data = await fetchTokenData(slug);
  const tokenData = data?.data;
  if (!tokenData) {
    return {
      title: 'Token Not Found | Xynapse Dashboard',
      description: 'The requested token could not be found.',
      keywords: 'cryptocurrency, market data, blockchain',
      robots: 'noindex',
    };
  }
  const capitalizedSlug = slug.charAt(0).toUpperCase() + slug.slice(1);
  return {
    title: `${tokenData.name || capitalizedSlug}`,
    description: `Explore market data and insights for ${tokenData.name || capitalizedSlug} on our crypto dashboard.`,
    keywords: `${slug}, ${tokenData.symbol?.toUpperCase() || 'token'}, cryptocurrency, market data, blockchain`,
    robots: 'index, follow',
  };
}

export default async function TokenPage({ params, searchParams }) {
  const { slug } = await params;
  // Redirect to new URL structure if accessed via /token/[slug]
  if (!searchParams.tab && !searchParams.token) {
    redirect(`/dashboard?tab=market&token=${slug}`);
  }
  const data = await fetchTokenData(slug);
  if (!data?.data) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white font-saira">
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
  if (process.env.NODE_ENV === 'production') {
    await revalidateTokenPath(slug);
  }
  return (
    <TokenPageClient
      initialTokenSlug={slug}
      initialTokenData={data.data}
      initialTopHolders={data.topHolders || []}
      initialPriceHistory={data.priceHistory || []}
    />
  );
}

export const revalidate = 300;