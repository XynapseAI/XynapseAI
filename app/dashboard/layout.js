import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }) {
  try {
    const session = await auth();
    const tab = searchParams?.get('tab') || 'dashboard';
    const userName = session?.user?.name || '';

    let title = `${userName ? userName + ' - ' : ''}Xynapse Dashboard`;
    let description = `Manage your cryptocurrency wallet, track market trends, and analyze blockchain interactions with Xynapse's advanced dashboard.`;
    let keywords = 'cryptocurrency, dashboard, wallet, blockchain, market trends, onchain analysis, Xynapse';
    let ogImage = 'https://xynapseai.net/og.png';

    switch (tab) {
      case 'etf':
        title = `${userName ? userName + ' - ' : ''}Bitcoin ETF Tracker: Inflows, Outflows & Holdings | Xynapse`;
        description = `Real-time Bitcoin ETF analysis on Xynapse: Track daily inflows/outflows, top holdings (IBIT, FBTC, GBTC), onchain metrics, and nametags for crypto investors.`;
        keywords = 'bitcoin etf, etf inflows outflows, crypto etf tracker, IBIT FBTC GBTC, etf holdings, blockchain analysis, onchain metrics, nametag etf, xynapse etf';
        ogImage = 'https://xynapseai.net/etf-og.png';
        break;

      case 'market':
        title = `${userName ? userName + ' - ' : ''}Crypto Market: Prices, Trends & Analysis | Xynapse`;
        description = `Explore real-time cryptocurrency market data, price charts, token performance, and blockchain trends on Xynapse.`;
        keywords = 'crypto market, cryptocurrency prices, token analysis, blockchain trends, market cap, xynapse market';
        break;

      case 'explorer':
        title = `${userName ? userName + ' - ' : ''}Blockchain Explorer: Transactions & Nametags | Xynapse`;
        description = `Search and analyze blockchain transactions, token transfers, fees, and nametags on Ethereum, BSC, Bitcoin, Solana with Xynapse Explorer.`;
        keywords = 'blockchain explorer, transaction search, tx hash, ethereum tx, bsc tx, bitcoin tx, solana tx, nametag, onchain analysis, xynapse explorer';
        break;

      case 'treemap':
        title = `${userName ? userName + ' - ' : ''}Wallet Network Graph & Clusters | Xynapse`;
        description = `Visualize wallet connections, transaction clusters, and onchain networks on Ethereum, BSC, Polygon, Optimism with Xynapse Treemap.`;
        keywords = 'wallet network graph, blockchain clusters, onchain analysis, wallet connections, ethereum graph, bsc graph, xynapse treemap';
        break;

      case 'graph':
        title = `${userName ? userName + ' - ' : ''}Transaction Graph & Analytics | Xynapse`;
        description = `Interactive transaction graph and blockchain analytics for in-depth onchain insights on Xynapse.`;
        keywords = 'transaction graph, blockchain analytics, onchain graph, crypto visualization, xynapse graph';
        break;

      case 'cluster':
        title = `${userName ? userName + ' - ' : ''}Address Clusters & Exchange Analysis | Xynapse`;
        description = `Analyze address clusters, exchange wallets, and onchain behavior with Xynapse Cluster tool.`;
        keywords = 'address clusters, exchange wallet analysis, onchain clusters, blockchain intelligence, xynapse cluster';
        break;

      default:
        title = `${userName ? userName + ' - ' : ''}Xynapse Dashboard`;
        description = `Manage your cryptocurrency wallet, track market trends, and analyze blockchain interactions with Xynapse.`;
    }

    return {
      title,
      description,
      keywords,
      robots: 'index, follow',
      alternates: {
        canonical: `https://xynapseai.net/dashboard?tab=${tab}`,
      },
      other: {
        'fc:miniapp': JSON.stringify({
          version: 'next',
          imageUrl: ogImage,
          button: {
            title: 'Open Dashboard',
            action: {
              type: 'launch_miniapp',
              name: 'Xynapse Dashboard',
              url: `https://xynapseai.net/dashboard?tab=${tab}`,
            },
          },
        }),
      },
      openGraph: {
        title,
        description,
        url: `https://xynapseai.net/dashboard?tab=${tab}`,
        type: 'website',
        images: [
          {
            url: ogImage,
            width: 1200,
            height: 630,
            alt: `${title} - Xynapse`,
          },
          { url: 'https://xynapseai.net/og.png', width: 1200, height: 630, alt: 'Xynapse Dashboard' },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImage],
      },
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return {
      title: 'Xynapse Dashboard',
      description: 'Manage your cryptocurrency wallet, track market trends, and analyze blockchain interactions.',
      keywords: 'cryptocurrency, dashboard, wallet, blockchain, market trends, Xynapse',
      robots: 'index, follow',
      alternates: {
        canonical: 'https://xynapseai.net/dashboard',
      },
      openGraph: {
        title: 'Xynapse Dashboard',
        description: 'Manage your cryptocurrency wallet, track market trends, and analyze blockchain interactions.',
        url: 'https://xynapseai.net/dashboard',
        type: 'website',
        images: [{ url: 'https://xynapseai.net/og.png', width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Xynapse Dashboard',
        description: 'Manage your cryptocurrency wallet, track market trends, and analyze blockchain interactions.',
        images: ['https://xynapseai.net/og.png'],
      },
    };
  }
}

export function generateViewport() {
  return {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  };
}

export default function DashboardLayout({ children }) {
  return <div>{children}</div>;
}