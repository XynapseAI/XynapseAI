import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    domains: [
      'ipfs.io',
      'pbs.twimg.com',
      'localhost',
      'lh3.googleusercontent.com',
      'api.dune.com',
      's2.coinmarketcap.com',
      'assets.coingecko.com',
      'api.sim.dune.com',
      'gateway.irys.xyz',
      'cdn.dexscreener.com',
      'scontent.xx.fbcdn.net',
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
        pathname: '/asset_platforms/images/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
          },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type,Authorization,X-CSRF-Token,X-Recaptcha-Token',
          },
        ],
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/privacy-policy',
        destination: '/',
      },
      {
        source: '/terms-of-service',
        destination: '/',
      },
    ]
  },
  webpack: (config, options) => {
    if (options.isServer) {
      // Handle Node.js built-in modules for server-side code
      config.resolve.alias = {
        ...config.resolve.alias,
        'node:crypto': 'crypto',
        'node:fs': 'fs',
        'node:path': 'path',
      }
    } else {
      // Avoid including Node.js built-in modules in client-side bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        path: false,
      }
    }
    return config
  },
}

export default nextConfig
