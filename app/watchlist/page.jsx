// app/watchlist/page.jsx
import WatchlistsTab from '@/components/WatchlistsTab'
import TabLayout from '../tab-layout'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ searchParams }) {
  const params = await searchParams
  const address = params?.address || null
  const truncatedAddress =
    address && address.length > 10
      ? `${address.slice(0, 6)}...${address.slice(-4)}`
      : address || 'Watchlist'

  return {
    title: `Wallet ${truncatedAddress} | Xynapse Watchlist`,
    description: `Track wallet balances, transactions, DeFi positions, and portfolio performance across multiple chains on Xynapse Watchlist.`,
    keywords: `watchlist, wallet tracker, portfolio, cryptocurrency, blockchain, ${address || 'multi-chain'}`,
    robots: 'index, follow',
    alternates: {
      canonical: address
        ? `https://xynapseai.net/watchlist?address=${encodeURIComponent(address)}`
        : 'https://xynapseai.net/watchlist',
    },
    openGraph: {
      title: `Watchlist - ${truncatedAddress} | Xynapse`,
      description:
        'Real-time multi-chain wallet tracking with balances, transactions, and DeFi positions.',
      url: address
        ? `https://xynapseai.net/watchlist?address=${address}`
        : 'https://xynapseai.net/watchlist',
      type: 'website',
      images: [
        {
          url: 'https://xynapseai.net/og-watchlist.png', // khuyến khích tạo OG riêng
          width: 1200,
          height: 630,
          alt: 'Xynapse Watchlist Dashboard',
        },
      ],
    },
  }
}

export default async function WatchlistPage({ searchParams }) {
  const params = await searchParams
  const initialAddress = params?.address || null

  return (
    <TabLayout initialTab="watchlists">
      <WatchlistsTab initialAddress={initialAddress} />
    </TabLayout>
  )
}
