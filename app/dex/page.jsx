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
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* SEO-optimized header */}
      <header className="container mx-auto px-4 py-8 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          DEX Tracker 2025: Live Whale Trades, Open Interest & Volume on Hyperliquid & Lighter
        </h1>
        <p className="text-lg md:text-xl text-[#D4D4D4] max-w-4xl mx-auto mb-8">
          Monitor real-time activity on leading decentralized perpetual futures exchanges like
          Hyperliquid and Lighter. View live whale trades over $100k, open interest distribution
          across assets, 24-hour volume rankings, price action charts, and detailed wallet analytics
          including cumulative PnL, win rate, and large trades. Data updated live as of December 26,
          2025. More DEXes to be added in the future.
        </p>
        {/* Visual gallery với alt text giàu keyword để tăng SEO hình ảnh */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 my-12 max-w-6xl mx-auto">
          <Image
            src="/dex-dashboard-example1.jpg" // Bạn có thể thay bằng ảnh thực tế hoặc screenshot
            alt="DEX Open Interest Distribution Pie Chart December 2025"
            width={1200}
            height={700}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
            priority
          />
          <Image
            src="/dex-whale-trades-table.jpg"
            alt="Live DEX Whale Trades Table Showing Large $100k+ Orders on Hyperliquid & Lighter December 2025"
            width={1200}
            height={700}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="/dex-volume-ranking.jpg"
            alt="DEX Top Assets by 24h Trading Volume Ranking 2025"
            width={1000}
            height={600}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="/dex-btc-price-chart.jpg"
            alt="DEX BTC-PERP 30-Day Price Action Chart December 2025"
            width={1200}
            height={680}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="/dex-wallet-pnl-example.jpg"
            alt="DEX Trader Wallet Analytics: Cumulative PnL and Win Rate 2025"
            width={1100}
            height={650}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="/dex-logo-and-ui.jpg"
            alt="DEX Decentralized Perpetual Exchanges Interface and Logos 2025 (Hyperliquid & Lighter)"
            width={1200}
            height={675}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
        </div>
        <section className="text-left max-w-5xl mx-auto mb-12">
          <h2 className="text-2xl font-bold mb-4">What is DEX Tracker?</h2>
          <p className="mb-4 text-[#D4D4D4]">
            This DEX Tracker monitors high-performance decentralized perpetual futures exchanges
            like Hyperliquid (built on its own L1 blockchain) and Lighter, offering deep liquidity,
            low fees, and advanced order types. It has rapidly become one of the top venues for
            leveraged crypto trading in 2025, especially among sophisticated traders and whales.
            Support for more DEXes planned for the future.
          </p>
          <p className="mb-4 text-[#D4D4D4]">
            Key features tracked here include: <strong>real-time whale trades over $100,000</strong>
            ,<strong>open interest distribution</strong> across major pairs (BTC, ETH, SOL, etc.),
            <strong>24-hour volume rankings</strong>, live price charts, and powerful wallet
            scanning to analyze trader performance (PnL, win rate, large positions).
          </p>
          <p className="text-[#D4D4D4]">
            In December 2025, DEXes like Hyperliquid and Lighter continue to see strong activity
            despite year-end market consolidation, with BTC and ETH perps dominating both volume and
            open interest.
          </p>
        </section>
      </header>
      {/* Interactive dashboard */}
      <main className="container mx-auto px-4 pb-12">
        <HyperliquidTab />
      </main>
      {/* Footer */}
      <footer className="bg-[#0A0A0A]/80 py-8 text-center text-[#888]">
        <p>Data sourced directly from DEX APIs in real-time. Not financial advice.</p>
      </footer>
    </div>
  )
}
