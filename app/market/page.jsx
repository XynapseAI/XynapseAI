// app/market/page.jsx
import MarketTab from '@/components/MarketTab';
import TabLayout from '../tab-layout';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return {
    title: 'Crypto Market 2025: Live Prices, Charts, Trends & Analytics | Xynapse',
    description:
      'Real-time cryptocurrency market data: live prices, interactive charts, trending tokens, whale trades, on-chain analytics, and advanced market insights for BTC, ETH, and 1000+ tokens as of December 2025.',
    keywords:
      'crypto market, live prices, cryptocurrency charts, trending tokens, whale trades, on-chain analytics, bitcoin price, ethereum price, market cap, volume, dex, cex, 2025',
    robots: 'index, follow',
    alternates: {
      canonical: 'https://xynapseai.net/market',
    },
    openGraph: {
      title: 'Crypto Market Live 2025 | Prices, Charts & Trends | Xynapse',
      description: 'Track real-time crypto prices, volume, trends, whale activity, and on-chain data for all major tokens.',
      url: 'https://xynapseai.net/market',
      type: 'website',
      images: [
        {
          url: 'https://xynapseai.net/og-market.png',
          width: 1200,
          height: 630,
          alt: 'Xynapse Crypto Market Dashboard 2025',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Crypto Market Live | Xynapse',
      description: 'Real-time prices, charts, trends & whale analytics.',
      images: ['https://xynapseai.net/og-market.png'],
    },
  };
}

export default function MarketPage() {
  return (
    <TabLayout initialTab="market">
      <MarketTab />
    </TabLayout>
  );
}