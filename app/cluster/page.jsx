// app/cluster/page.jsx
import ClusterTab from '@/components/ClusterTab'
import TabLayout from '../tab-layout'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ searchParams }) {
  try {
    const session = await auth()
    const params = await searchParams
    const clusterId = params?.clusterId || 'binance'
    const clusterName = clusterId.charAt(0).toUpperCase() + clusterId.slice(1)
    const userName = session?.user?.name || ''
    const title = `${userName ? userName + ' - ' : ''}${clusterName} Cluster | Xynapse`
    const description = `Explore ${clusterName} cluster details, track wallet balances, transactions, and market trends on Xynapse's advanced blockchain analytics platform.`

    return {
      title,
      description,
      keywords: `cryptocurrency, ${clusterName}, blockchain, wallet, transactions, market trends, Xynapse`,
      robots: 'index, follow',
      alternates: {
        canonical: `https://xynapseai.net/cluster?clusterId=${encodeURIComponent(clusterId)}`,
      },
      openGraph: {
        title,
        description,
        url: `https://xynapseai.net/cluster?clusterId=${encodeURIComponent(clusterId)}`,
        type: 'website',
        images: [
          {
            url: 'https://xynapseai.net/logos/og.png',
            width: 1200,
            height: 630,
            alt: `${clusterName} Cluster Logo`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: ['https://xynapseai.net/og.png'],
      },
    }
  } catch (error) {
    console.error('Error fetching session for metadata:', error)
    const params = await searchParams
    const clusterId = params?.clusterId || 'binance'
    const clusterName = clusterId.charAt(0).toUpperCase() + clusterId.slice(1)
    return {
      title: `${clusterName} Cluster | Xynapse`,
      description: `Explore ${clusterName} cluster details, track wallet balances, transactions, and market trends on Xynapse's advanced blockchain analytics platform.`,
      // ... giữ nguyên phần fallback
    }
  }
}

export default async function Cluster({ searchParams }) {
  const params = await searchParams
  const initialClusterId = params?.clusterId || 'binance'

  return (
    <TabLayout initialTab="cluster">
      <ClusterTab initialClusterId={initialClusterId} />
    </TabLayout>
  )
}
