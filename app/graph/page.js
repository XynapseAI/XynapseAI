import GraphTab from '../../components/GraphTab'
import { auth } from '@/lib/auth'
import TabLayout from '../tab-layout'

// Disable static generation for dynamic routes with searchParams
export const dynamic = 'force-dynamic'

export async function generateStaticParams() {
  const supportedChains = ['ethereum', 'bsc', 'polygon', 'optimism', 'arbitrum']
  const popularAddresses = [
    '0x1234567890abcdef1234567890abcdef12345678',
    '0xabcdef1234567890abcdef1234567890abcdef12',
  ]
  return supportedChains.flatMap((chain) => popularAddresses.map((address) => ({ chain, address })))
}

// Server-side metadata for SEO
export async function generateMetadata({ searchParams }) {
  try {
    const session = await auth()
    const params = await searchParams
    const chain = (params?.chain || 'ethereum').toLowerCase()
    const address = params?.address || 'unknown'
    const supportedChains = ['ethereum', 'bsc', 'polygon', 'optimism', 'arbitrum', 'solana', 'tron']
    const validChain = supportedChains.includes(chain) ? chain : 'ethereum'
    const capitalizedChain = validChain.charAt(0).toUpperCase() + validChain.slice(1)
    const truncatedAddress =
      address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address

    // Use name, email, or fallback for user personalization
    const userName = session?.user?.name || ''
    const title = `${userName} Network Graph on ${capitalizedChain} | Xynapse`
    const description = `Explore the network graph for wallet ${truncatedAddress} on ${capitalizedChain} with Xynapse's advanced blockchain analytics. Visualize transactions, clusters, and wallet connections.`

    return {
      title,
      description,
      keywords: `network graph, wallet, ${truncatedAddress}, ${validChain}, cryptocurrency, blockchain, transactions, Xynapse`,
      robots: 'index, follow',
      alternates: {
        canonical: `https://xynapseai.net/graph?chain=${encodeURIComponent(validChain)}${address !== 'unknown' ? `&address=${encodeURIComponent(address)}` : ''}`,
      },
      openGraph: {
        title,
        description,
        url: `https://xynapseai.net/graph?chain=${encodeURIComponent(validChain)}${address !== 'unknown' ? `&address=${encodeURIComponent(address)}` : ''}`,
        type: 'website',
        images: [
          {
            url: 'https://xynapseai.net/logos/og.png',
            width: 1200,
            height: 630,
            alt: `${capitalizedChain} Network Graph`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: ['https://xynapseai.net/logos/og.png'],
      },
    }
  } catch (error) {
    console.error('Error fetching session for metadata:', error)
    const params = await searchParams
    const chain = (params?.chain || 'ethereum').toLowerCase()
    const address = params?.address || 'unknown'
    const supportedChains = ['ethereum', 'bsc', 'polygon', 'optimism', 'arbitrum', 'solana', 'tron']
    const validChain = supportedChains.includes(chain) ? chain : 'ethereum'
    const capitalizedChain = validChain.charAt(0).toUpperCase() + validChain.slice(1)
    const truncatedAddress =
      address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address

    return {
      title: `Network Graph on ${capitalizedChain} | Xynapse`,
      description: `Explore the network graph for wallet ${truncatedAddress} on ${capitalizedChain} with Xynapse's advanced blockchain analytics. Visualize transactions, clusters, and wallet connections.`,
      keywords: `network graph, wallet, ${truncatedAddress}, ${validChain}, cryptocurrency, blockchain, transactions, Xynapse`,
      robots: 'index, follow',
      alternates: {
        canonical: `https://xynapseai.net/graph?chain=${encodeURIComponent(validChain)}${address !== 'unknown' ? `&address=${encodeURIComponent(address)}` : ''}`,
      },
      openGraph: {
        title: `Network Graph on ${capitalizedChain} | Xynapse`,
        description: `Explore the network graph for wallet ${truncatedAddress} on ${capitalizedChain} with Xynapse's advanced blockchain analytics. Visualize transactions, clusters, and wallet connections.`,
        url: `https://xynapseai.net/graph?chain=${encodeURIComponent(validChain)}${address !== 'unknown' ? `&address=${encodeURIComponent(address)}` : ''}`,
        type: 'website',
        images: [
          {
            url: 'https://xynapseai.net/logos/og.png',
            width: 1200,
            height: 630,
            alt: `${capitalizedChain} Network Graph`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: `Network Graph on ${capitalizedChain} | Xynapse`,
        description: `Explore the network graph for wallet ${truncatedAddress} on ${capitalizedChain} with Xynapse's advanced blockchain analytics. Visualize transactions, clusters, and wallet connections.`,
        images: ['https://xynapseai.net/logos/og.png'],
      },
    }
  }
}

// Server Component
export default async function GraphPage({ searchParams }) {
  const params = await searchParams
  const initialChain = (params?.chain || 'ethereum').toLowerCase()
  const initialAddress = params?.address || ''
  return (
    <TabLayout initialTab="graph">
      <GraphTab initialChain={initialChain} initialAddress={initialAddress} />
    </TabLayout>
  )
}
