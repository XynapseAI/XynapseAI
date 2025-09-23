import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  try {
    const session = await auth();
    const userName = session?.user?.name || '';
    const title = `${userName} Xynapse Dashboard`;
    const description = `Manage your cryptocurrency wallet, track market trends, and analyze interactions with Xynapse's advanced dashboard.`;
    
    return {
      title,
      description,
      keywords: 'cryptocurrency, dashboard, wallet, blockchain, market trends, Xynapse',
      robots: 'index, follow',
      alternates: {
        canonical: 'https://xynapseai.net/dashboard',
      },
      openGraph: {
        title,
        description,
        url: 'https://xynapseai.net/dashboard',
        type: 'website',
        images: [
          {
            url: 'https://xynapseai.net/logos/logo-landscape.webp',
            width: 1200,
            height: 630,
            alt: 'Xynapse Dashboard Logo',
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: ['https://xynapseai.net/logos/logo-landscape.webp'],
      },
    };
  } catch (error) {
    console.error('Error fetching session for metadata:', error);
    return {
      title: 'Xynapse Dashboard',
      description: 'Manage your cryptocurrency wallet, track market trends, and analyze interactions with Xynapse.',
      keywords: 'cryptocurrency, dashboard, wallet, blockchain, market trends, Xynapse',
      robots: 'index, follow',
      alternates: {
        canonical: 'https://xynapseai.net/dashboard',
      },
      openGraph: {
        title: 'Xynapse Dashboard',
        description: 'Manage your cryptocurrency wallet, track market trends, and analyze interactions with Xynapse.',
        url: 'https://xynapseai.net/dashboard',
        type: 'website',
        images: [
          {
            url: 'https://xynapseai.net/logos/logo-landscape.webp',
            width: 1200,
            height: 630,
            alt: 'Xynapse Dashboard Logo',
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Xynapse Dashboard',
        description: 'Manage your cryptocurrency wallet, track market trends, and analyze interactions with Xynapse.',
        images: ['https://xynapseai.net/logos/logo-landscape.webp'],
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