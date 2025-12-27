// app/etf/page.jsx
import EtfTab from '@/components/EtfTab'
import TabLayout from '../tab-layout'

// Disable static generation if needed, but for this static page, it's optional
export const dynamic = 'force-dynamic'

// Server-side metadata for SEO
export async function generateMetadata() {
  return {
    title: 'Bitcoin ETF Tracker Live Inflows, Outflows & Holdings | Xynapse',
    description:
      'Real-time tracking of daily inflows/outflows for top Spot Bitcoin ETFs (IBIT, FBTC, GBTC, ARKB, BITB, HODL...). Latest holdings in BTC, net flows in USD millions, and historical charts. Updated as of December 26, 2025.',
    keywords:
      'bitcoin etf tracker, bitcoin etf inflows, bitcoin etf outflows, spot bitcoin etf holdings, ibit inflows, fbtc flows, gbtc holdings, bitcoin etf live data, bitcoin etf 2025',
    robots: 'index, follow',
    alternates: {
      canonical: 'https://xynapseai.net/etf',
    },
    openGraph: {
      title: 'Bitcoin ETF Tracker: Live Inflows, Outflows & Holdings',
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
      title: 'Bitcoin ETF Tracker| Live Flows & Holdings',
      description: 'Real-time inflows/outflows for Spot Bitcoin ETFs.',
      images: ['https://xynapseai.net/og-etf.png'],
    },
  }
}

// Server Component
export default async function EtfPage() {
  return (
    <TabLayout initialTab="etf">
      <EtfTab />
    </TabLayout>
  )
}
