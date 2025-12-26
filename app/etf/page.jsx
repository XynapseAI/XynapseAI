// app/etf/page.jsx
import EtfTab from '@/components/EtfTab'
import Image from 'next/image'

// Disable static generation if needed, but for this static page, it's optional
export const dynamic = 'force-dynamic'

// Server-side metadata for SEO
export async function generateMetadata() {
  return {
    title: 'Bitcoin ETF Tracker 2025: Live Inflows, Outflows & Holdings | Xynapse',
    description:
      'Real-time tracking of daily inflows/outflows for top Spot Bitcoin ETFs (IBIT, FBTC, GBTC, ARKB, BITB, HODL...). Latest holdings in BTC, net flows in USD millions, and historical charts. Updated as of December 26, 2025.',
    keywords:
      'bitcoin etf tracker, bitcoin etf inflows, bitcoin etf outflows, spot bitcoin etf holdings, ibit inflows, fbtc flows, gbtc holdings, bitcoin etf live data, bitcoin etf 2025',
    robots: 'index, follow',
    alternates: {
      canonical: 'https://xynapseai.net/etf',
    },
    openGraph: {
      title: 'Bitcoin ETF Tracker 2025: Live Inflows, Outflows & Holdings',
      description:
        'Real-time data on top Spot Bitcoin ETFs: IBIT (BlackRock), FBTC (Fidelity), GBTC (Grayscale), ARKB (Ark), BITB (Bitwise)... View daily net flows, BTC holdings, and historical charts.',
      url: 'https://xynapseai.net/etf',
      type: 'website',
      images: [
        {
          url: 'https://xynapseai.net/og-etf.png', // Create a custom OG image featuring the inflows chart or holdings table
          width: 1200,
          height: 630,
          alt: 'Bitcoin Spot ETF Inflows Outflows Chart December 2025',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Bitcoin ETF Tracker 2025 | Live Flows & Holdings',
      description: 'Real-time inflows/outflows for Spot Bitcoin ETFs.',
      images: ['https://xynapseai.net/og-etf.png'],
    },
  }
}

// Server Component
export default async function EtfPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* SEO-optimized header with rich text content */}
      <header className="container mx-auto px-4 py-8 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Bitcoin ETF Tracker 2025: Live Inflows, Outflows & Holdings
        </h1>
        <p className="text-lg md:text-xl text-[#D4D4D4] max-w-4xl mx-auto mb-8">
          Track real-time daily inflows and outflows for the leading Spot Bitcoin ETFs, including
          IBIT (BlackRock), FBTC (Fidelity), GBTC (Grayscale), ARKB (Ark Invest), BITB (Bitwise),
          HODL (VanEck), and more. View current BTC holdings, USD value, net flows in millions, and
          historical charts. Data updated as of December 26, 2025.
        </p>
        {/* Visual aids with keyword-rich alt text for SEO */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 my-12 max-w-6xl mx-auto">
          <Image
            src="https://www.theblock.co/dashboard-images/2025-12-23/spot-bitcoin-etf-flows.png"
            alt="Spot Bitcoin ETF Daily Inflows and Outflows Chart December 2025"
            width={1200}
            height={700}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="https://cryptoslate.com/wp-content/uploads/2025/12/bitcoin_etf_daily_flows-1024x614.png"
            alt="Bitcoin Spot ETF Daily Flows Chart 2025 Showing Recent Outflows"
            width={1024}
            height={614}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="https://www.thestreet.com/.image/w_3840,q_auto:good,c_limit/NDA6MDAwMDAwMDAyNzQyODc1/image.png?arena_f_auto"
            alt="Top Bitcoin Spot ETF Holdings and Comparison Table 2025"
            width={994}
            height={556}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="https://forklog.com/wp-content/uploads/img-9e2f401cb7054a79-1803545438299384-1024x546.png"
            alt="Bitcoin ETF Flows Overview on Christmas Eve 2025"
            width={1024}
            height={546}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="https://substackcdn.com/image/fetch/$s_!F1yq!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2F%2Fpublic%2F%2Fimages%2Fd4d625a1-04e9-48c9-912f-2ba2847fc184_1124x636.png"
            alt="Comparison of Major Bitcoin Spot ETF Logos: BlackRock IBIT, Fidelity FBTC, Grayscale GBTC, Ark ARKB"
            width={1124}
            height={636}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
          <Image
            src="https://www.thecoinrepublic.com/wp-content/uploads/2025/01/cd0029fe-1441-40a9-8eef-4375d115d36d.jpeg"
            alt="Bitcoin Spot ETFs Logos and Providers Comparison 2025"
            width={1920}
            height={1080}
            className="rounded-2xl shadow-2xl border border-[#FFFFFF20]"
          />
        </div>
        <section className="text-left max-w-5xl mx-auto mb-12">
          <h2 className="text-2xl font-bold mb-4">Top Spot Bitcoin ETFs in 2025</h2>
          <p className="mb-4 text-[#D4D4D4]">
            The leading Spot Bitcoin ETFs include:{' '}
            <strong>IBIT (iShares Bitcoin Trust by BlackRock)</strong> – the dominant leader with
            over $25 billion in inflows despite recent market volatility;
            <strong>FBTC (Fidelity Wise Origin Bitcoin Fund)</strong>;{' '}
            <strong>GBTC (Grayscale Bitcoin Trust)</strong>;
            <strong>ARKB (ARK 21Shares Bitcoin ETF)</strong>;{' '}
            <strong>BITB (Bitwise Bitcoin ETF)</strong>; and{' '}
            <strong>HODL (VanEck Bitcoin Trust)</strong>.
          </p>
          <p className="text-[#D4D4D4]">
            In 2025, Spot Bitcoin ETFs attracted approximately $34 billion in total inflows, led
            overwhelmingly by BlackRock's IBIT. However, late-year outflows amid Bitcoin price
            consolidation erased much of the earlier gains, with December seeing significant
            pullbacks ahead of the holidays.
          </p>
        </section>
      </header>
      {/* Reuse the existing interactive EtfTab component for live charts and table */}
      <main className="container mx-auto px-4 pb-12">
        <EtfTab />
      </main>
      {/* Footer with disclaimer for SEO */}
      <footer className="bg-[#0A0A0A]/80 py-8 text-center text-[#888]">
        <p>Data updated in real-time from reliable sources. Not financial advice.</p>
      </footer>
    </div>
  )
}
