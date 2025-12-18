// app/layout.js - Fixed: Removed direct OnchainKitProvider usage in server component (moved to ClientProviders)
// Import and usage of client components in server layouts causes ReferenceError
export const dynamic = 'force-dynamic';
import '../styles/globals.css';
import ClientProviders from './ClientProviders';

export const metadata = {
  title: {
    default: 'Xynapse - Blockchain Transaction Search',
    template: '%s | Xynapse',
  },
  description: 'Xynapse: Search and analyze transactions on Bitcoin, Ethereum, BSC, and Solana. Real-time blockchain data, nametags, token transfers, and insights for crypto enthusiasts.',
  keywords: 'blockchain explorer, transaction search, Bitcoin tx, Ethereum tx, BSC tx, Solana tx, crypto analytics, Xynapse',
  openGraph: {
    title: 'Xynapse',
    description: 'Explore blockchain transactions with Xynapse. Fast, secure, and insightful crypto explorer.',
    images: [
      'https://xynapseai.net/og.png',
      'https://xynapseai.net/base-wallet-og.png',  // Added for wallet connect OG
    ],
    url: 'https://xynapseai.net/dashboard?tab=explorer',
    siteName: 'Xynapse',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Xynapse',
    description: 'Search transactions on major blockchains with Xynapse.',
    images: ['https://xynapseai.net/og.png'],
  },
  other: {
    'fc:miniapp': JSON.stringify({
      version: 'next',
      imageUrl: 'https://xynapseai.net/og.png',
      button: {
        title: 'Launch Xynapse',
        action: {
          type: 'launch_miniapp',
          name: 'Xynapse',
          url: 'https://xynapseai.net/dashboard?tab=explorer',
          splashImageUrl: 'https://xynapseai.net/splash.png',
          splashBackgroundColor: '#000000',
        },
      },
    }),
    'base:app_id': '690858f0aa8286a3a56039d4',
  },
};

function hasCircularReference(obj, seen = new WeakSet()) {
  if (typeof obj !== 'object' || obj === null) return false;
  if (seen.has(obj)) return true;
  seen.add(obj);
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null && hasCircularReference(value, seen)) {
      return true;
    }
  }
  return false;
}

export default function RootLayout({ children }) {
  if (hasCircularReference(children)) {
    console.error('Circular reference detected in children:', children);
    throw new Error('Circular reference in layout');
  }

  return (
    <html lang="en">
      <head>
        <link rel="canonical" href="https://xynapseai.net/dashboard?tab=explorer" />
      </head>
      <body className={`bg-black text-white`}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}