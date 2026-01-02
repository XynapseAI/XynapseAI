// app/layout.js

export const dynamic = 'force-dynamic'
import '../styles/globals.css'
import ClientProviders from './ClientProviders'
import { inter, roboto, jetbrains, plexmono, saira } from './fonts'

export const metadata = {
  title: {
    default: 'Xynapse - Blockchain Transaction Search',
    template: '%s | Xynapse',
  },
  description:
    'Xynapse: Search and analyze transactions on Bitcoin, Ethereum, BSC, and Solana. Real-time blockchain data, nametags, token transfers, and insights for crypto enthusiasts.',
  keywords:
    'blockchain explorer, transaction search, Bitcoin tx, Ethereum tx, BSC tx, Solana tx, crypto analytics, Xynapse',
  robots: 'index, follow',
  alternates: {
    canonical: 'https://xynapseai.net',
  },
  openGraph: {
    title: 'Xynapse',
    description:
      'Explore blockchain transactions with Xynapse. Fast, secure, and insightful crypto explorer.',
    images: ['https://xynapseai.net/og.png', 'https://xynapseai.net/base-wallet-og.png'],
    url: 'https://xynapseai.net',
    siteName: 'Xynapse',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@xynapseai_',
    creator: '@xynapseai_',
    title: 'Xynapse - Blockchain Explorer',
    description:
      'Search and analyze transactions on Bitcoin, Ethereum, BSC, Solana. Real-time insights for crypto , ETF.',
    images: ['https://xynapseai.net/og.png'],
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
    other: {
      rel: 'apple-touch-icon-precomposed',
      url: '/apple-touch-icon.png',
    },
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
}

function hasCircularReference(obj, seen = new WeakSet()) {
  if (typeof obj !== 'object' || obj === null) return false
  if (seen.has(obj)) return true
  seen.add(obj)
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null && hasCircularReference(value, seen)) {
      return true
    }
  }
  return false
}

export default function RootLayout({ children }) {
  if (hasCircularReference(children)) {
    console.error('Circular reference detected in children:', children)
    throw new Error('Circular reference in layout')
  }

  return (
    <html
      lang="en"
      className={`
        ${inter.variable}
        ${roboto.variable}
        ${jetbrains.variable}
        ${plexmono.variable}
        ${saira.variable}
      `}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'Xynapse',
              url: 'https://xynapseai.net',
              sameAs: ['https://x.com/xynapseai_'],
              description:
                'Blockchain transaction search , label , and analytics on Bitcoin, Ethereum, BSC, Solana and ETFs.',
              potentialAction: {
                '@type': 'SearchAction',
                target: 'https://xynapseai.net/search?q={search_term_string}',
                'query-input': 'required name=search_term_string',
              },
            }),
          }}
        />
      </head>
      <body className="bg-black text-white font-inter !font-inter antialiased">
        {' '}
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}
