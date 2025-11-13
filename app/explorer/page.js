// app/explorer/page.js - Updated to pass isStandalone prop
import ExplorerTab from '../../components/ExplorerTab';
import { auth } from '@/lib/auth';

// Disable static generation for dynamic routes with searchParams
export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  const supportedChains = ['ethereum', 'bsc', 'bitcoin', 'solana'];
  const exampleTxHashes = [
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12', // Ethereum example
    'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd', // Bitcoin example
  ];
  return supportedChains.flatMap((chain) =>
    exampleTxHashes.map((txHash) => ({ chain, query: txHash }))
  );
}

// Server-side metadata for SEO
export async function generateMetadata({ searchParams }) {
  try {
    const session = await auth();
    const params = await searchParams;
    const query = params?.query || 'unknown';
    const chain = (params?.chain || 'ethereum').toLowerCase();
    const supportedChains = ['ethereum', 'bsc', 'bitcoin', 'solana'];
    const validChain = supportedChains.includes(chain) ? chain : 'ethereum';
    const capitalizedChain = validChain.charAt(0).toUpperCase() + validChain.slice(1);
    const truncatedQuery = query.length > 10 ? `${query.slice(0, 8)}...${query.slice(-6)}` : query;
    
    // Use name, email, or fallback for user personalization
    const userName = session?.user?.name || '';
    const title = `${userName ? userName + ' - ' : ''}Transaction ${truncatedQuery} on ${capitalizedChain} | Xynapse Explorer`;
    const description = `Explore transaction ${truncatedQuery} on ${capitalizedChain} blockchain with Xynapse Explorer. View real-time details, token transfers, fees, and nametags for comprehensive blockchain analysis.`;

    return {
      title,
      description,
      keywords: `transaction explorer, tx hash, ${truncatedQuery}, ${validChain}, blockchain, ${capitalizedChain} tx, cryptocurrency, Xynapse`,
      robots: 'index, follow',
      alternates: {
        canonical: `https://xynapseai.net/explorer?query=${encodeURIComponent(query)}&chain=${encodeURIComponent(validChain)}`,
      },
      openGraph: {
        title,
        description,
        url: `https://xynapseai.net/explorer?query=${encodeURIComponent(query)}&chain=${encodeURIComponent(validChain)}`,
        type: 'website',
        images: [
          {
            url: 'https://xynapseai.net/explorer.png', // Primary: Always use explorer.png for reliability (social media prefers first image)
            width: 1200,
            height: 630,
            alt: `Xynapse Explorer - ${capitalizedChain} Tx`,
          },
          {
            url: `https://assets.coingecko.com/coins/images/${validChain === 'bitcoin' ? 1 : validChain === 'ethereum' ? 279 : validChain === 'bsc' ? 825 : 4128}/small/${validChain}.png`, // Secondary: Dynamic chain logo
            width: 1200,
            height: 630,
            alt: `${capitalizedChain} Transaction Explorer`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [
          'https://xynapseai.net/explorer.png', // Primary
          `https://assets.coingecko.com/coins/images/${validChain === 'bitcoin' ? 1 : validChain === 'ethereum' ? 279 : validChain === 'bsc' ? 825 : 4128}/small/${validChain}.png`, // Secondary
        ],
      },
    };
  } catch (error) {
    console.error('Error fetching session for metadata:', error);
    const params = await searchParams;
    const query = params?.query || 'unknown';
    const chain = (params?.chain || 'ethereum').toLowerCase();
    const supportedChains = ['ethereum', 'bsc', 'bitcoin', 'solana'];
    const validChain = supportedChains.includes(chain) ? chain : 'ethereum';
    const capitalizedChain = validChain.charAt(0).toUpperCase() + validChain.slice(1);
    const truncatedQuery = query.length > 10 ? `${query.slice(0, 8)}...${query.slice(-6)}` : query;

    return {
      title: `Transaction ${truncatedQuery} on ${capitalizedChain} | Xynapse Explorer`,
      description: `Explore transaction ${truncatedQuery} on ${capitalizedChain} blockchain with Xynapse Explorer. View real-time details, token transfers, fees, and nametags for comprehensive blockchain analysis.`,
      keywords: `transaction explorer, tx hash, ${truncatedQuery}, ${validChain}, blockchain, ${capitalizedChain} tx, cryptocurrency, Xynapse`,
      robots: 'index, follow',
      alternates: {
        canonical: `https://xynapseai.net/explorer?query=${encodeURIComponent(query)}&chain=${encodeURIComponent(validChain)}`,
      },
      openGraph: {
        title: `Transaction ${truncatedQuery} on ${capitalizedChain} | Xynapse Explorer`,
        description: `Explore transaction ${truncatedQuery} on ${capitalizedChain} blockchain with Xynapse Explorer. View real-time details, token transfers, fees, and nametags for comprehensive blockchain analysis.`,
        url: `https://xynapseai.net/explorer?query=${encodeURIComponent(query)}&chain=${encodeURIComponent(validChain)}`,
        type: 'website',
        images: [
          {
            url: 'https://xynapseai.net/explorer.png', // Primary fallback
            width: 1200,
            height: 630,
            alt: `Xynapse Explorer - ${capitalizedChain} Tx`,
          },
          {
            url: `https://assets.coingecko.com/coins/images/${validChain === 'bitcoin' ? 1 : validChain === 'ethereum' ? 279 : validChain === 'bsc' ? 825 : 4128}/small/${validChain}.png`,
            width: 1200,
            height: 630,
            alt: `${capitalizedChain} Transaction Explorer`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: `Transaction ${truncatedQuery} on ${capitalizedChain} | Xynapse Explorer`,
        description: `Explore transaction ${truncatedQuery} on ${capitalizedChain} blockchain with Xynapse Explorer. View real-time details, token transfers, fees, and nametags for comprehensive blockchain analysis.`,
        images: [
          'https://xynapseai.net/explorer.png',
          `https://assets.coingecko.com/coins/images/${validChain === 'bitcoin' ? 1 : validChain === 'ethereum' ? 279 : validChain === 'bsc' ? 825 : 4128}/small/${validChain}.png`,
        ],
      },
    };
  }
}

// Server Component
export default async function ExplorerPage({ searchParams }) {
  const params = await searchParams;
  console.log('ExplorerPage props:', { params }); // Debug log
  const initialQuery = params?.query || '';
  const initialChain = (params?.chain || 'ethereum').toLowerCase();
  return <ExplorerTab initialQuery={initialQuery} initialChain={initialChain} isStandalone={true} />;
}