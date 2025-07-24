// app/token/[slug]/page.js
import { revalidateTokenPath } from './actions';
import TokenPageClient from '../../../components/TokenPageClient';
import connectRedis from '../../../lib/redis';
import Bottleneck from 'bottleneck';

// Cấu hình Bottleneck
const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 5 : 1,
  minTime: process.env.NODE_ENV === 'production' ? 200 : 1000,
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await fetch(url, config);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    return response.json();
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error);
    return null;
  }
});

async function fetchTokenData(slug) {
  try {
    const response = await fetchWithRateLimit(`https://api.coingecko.com/api/v3/coins/${slug}`, {
      headers: {
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY,
      },
      cache: 'force-cache',
      next: { revalidate: 300 },
    });
    return response;
  } catch (error) {
    console.error(`Error fetching token data for slug ${slug}:`, error);
    return null;
  }
}

let redisClient;

async function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    redisClient = await connectRedis();
    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
  }
  return redisClient;
}

async function fetchTopHolders(slug, chain = 'ethereum') {
  const cacheKey = `top-holders_${slug}_${chain}`;
  try {
    const client = await getRedisClient();
    const cachedData = await client.get(cacheKey);
    if (cachedData) {
      console.log(`Cache hit for top holders: ${cacheKey}`);
      return JSON.parse(cachedData);
    }

    const normalizedChain = ['bitcoin', 'ethereum'].includes(slug.toLowerCase()) ? slug.toLowerCase() : chain;
    console.log(`Fetching top holders for slug: ${slug}, chain: ${normalizedChain}`);

    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://your-production-api.com';
    let data;
    if (['bitcoin', 'ethereum'].includes(normalizedChain)) {
      const response = await fetchWithRateLimit(
        `${apiBaseUrl}/api/coingecko?action=public-treasury&tokenType=${normalizedChain}`,
        {
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          cache: 'force-cache',
          next: { revalidate: 300 },
        }
      );
      data = response;
      console.log(`CoinGecko treasury response for ${normalizedChain}:`, data);
      if (data?.success && data.data?.companies) {
        const topHolders = data.data.companies.map((company) => ({
          address: company.address || company.name || 'Unknown',
          balance: parseFloat(company.total_holdings) || 0,
          share: parseFloat(company.total_value_usd) / (company.total_holdings || 1) || 0,
          nameTag: company.name || null,
          image: null,
          source: 'CoinGecko',
        }));
        const result = { success: true, topHolders };
        await client.setEx(cacheKey, 12 * 3600, JSON.stringify(result));
        console.log(`Cached top holders for ${cacheKey}:`, result);
        return result;
      }
    } else {
      const response = await fetchWithRateLimit(`${apiBaseUrl}/api/top-holders?slug=${slug}&chain=${chain}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'force-cache',
        next: { revalidate: 300 },
      });
      data = response;
      console.log(`Top holders response for ${slug} on ${chain}:`, data);
      if (data?.success) {
        await client.setEx(cacheKey, 12 * 3600, JSON.stringify(data));
        return data;
      }
    }
    return { topHolders: [], success: false, error: data?.detail || 'No top holders data' };
  } catch (error) {
    console.error(`Error fetching top holders for ${slug} on ${chain}:`, error);
    return { topHolders: [], success: false, error: error.message };
  }
}

export async function generateStaticParams() {
  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/coins/list', {
      headers: {
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY,
      },
      cache: 'force-cache',
      next: { revalidate: 86400 },
    });
    const tokens = await response;
    return tokens ? tokens.slice(0, 10).map((token) => ({
      slug: token.id,
    })) : [];
  } catch (error) {
    console.error('Error in generateStaticParams:', error);
    return [];
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const tokenData = await fetchTokenData(slug);
  const capitalizedSlug = slug.charAt(0).toUpperCase() + slug.slice(1);

  if (!tokenData) {
    return {
      title: 'Token Not Found | Crypto Dashboard',
      description: 'The requested token could not be found.',
      keywords: 'cryptocurrency, market data, blockchain',
      robots: 'noindex',
    };
  }

  return {
    title: `${tokenData.name || capitalizedSlug} | Crypto Dashboard`,
    description: `Explore market data and insights for ${tokenData.name || capitalizedSlug} on our crypto dashboard.`,
    keywords: `${slug}, ${tokenData.symbol?.toUpperCase() || 'token'}, cryptocurrency, market data, blockchain`,
    robots: 'index, follow',
  };
}

export default async function TokenPage({ params }) {
  const { slug } = await params;
  const tokenData = await fetchTokenData(slug);
  const topHolders = await fetchTopHolders(slug, tokenData?.symbol?.toLowerCase() || 'ethereum');

  if (!tokenData) {
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

  if (process.env.NODE_ENV === 'production') {
    await revalidateTokenPath(slug);
  }

  return <TokenPageClient initialTokenSlug={slug} initialTokenData={tokenData} initialTopHolders={topHolders} />;
}

export const revalidate = 300;