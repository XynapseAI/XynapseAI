// app/dex/page.jsx
import DexTab from '@/components/DexTab'
import Image from 'next/image'

// Disable static generation if needed, but for this static page, it's optional
export const dynamic = 'force-dynamic'

// Server-side metadata for SEO
export async function generateMetadata() {
  return {
    title:
      'DEX Tracker 2025: Live Whale Trades, Open Interest & Volume on Hyperliquid & Lighter | Xynapse',
    description:
      'Real-time DEX perpetual futures tracker for Hyperliquid and Lighter: whale trades over $100k, open interest distribution, 24h volume ranking, price charts, and wallet analytics. Live data for BTC, ETH and all major pairs as of December 26, 2025. Support for more DEXes coming soon.',
    keywords:
      'dex tracker, hyperliquid tracker, lighter tracker, dex whale trades, dex open interest, dex volume, dex perp, dex live trades, dex wallet scanner, dex oi distribution, dex 2025',
    robots: 'index, follow',
    alternates: {
      canonical: 'https://xynapseai.net/dex',
    },
    openGraph: {
      title: 'DEX Tracker 2025 | Live Whale Trades, OI & Volume on Hyperliquid & Lighter',
      description:
        'Track real-time whale trades (> $100k), open interest by asset, 24h volume rankings, and detailed wallet PnL analytics on Hyperliquid and Lighter perpetual futures exchanges. More DEXes to be added in the future.',
      url: 'https://xynapseai.net/dex',
      type: 'website',
      images: [
        {
          url: 'https://xynapseai.net/og-dex.png', // Update to a custom OG image (chart OI + whale trades for DEX)
          width: 1200,
          height: 630,
          alt: 'DEX Whale Trades and Open Interest Dashboard December 2025',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'DEX Live Tracker 2025 | Whale Trades & OI on Hyperliquid & Lighter',
      description: 'Real-time DEX data: whale trades, open interest, volume, wallet PnL.',
      images: ['https://xynapseai.net/og-dex.png'],
    },
  }
}

// Server Component
export default async function DexPage() {
  return <DexTab />
}