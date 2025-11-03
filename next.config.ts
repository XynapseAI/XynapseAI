import type { NextConfig } from 'next';

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
      'imagedelivery.net',
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
        pathname: '/asset_platforms/images/**',
      },
      {
        protocol: 'https',
        hostname: 'pbs.twimg.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'imagedelivery.net',  // Thêm hostname từ Neynar PFP
        pathname: '/**',  // Cho phép tất cả path (an toàn cho PFP)
      },
    ],
  },
  async headers() {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      'https://xynapseai.net',
      'https://www.xynapseai.net',
      'https://xynapse-ai-xynapse-projects.vercel.app',
      'https://xynapse-ai.vercel.app',
    ].filter(Boolean);

    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: allowedOrigins.join(','),
          },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type,Authorization,X-CSRF-Token,X-Recaptcha-Token',
          },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
        ],
      },
    ];
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
    ];
  },
  async redirects() {
    return [
      {
        source: '/.well-known/farcaster.json',
        destination: 'https://api.farcaster.xyz/miniapps/hosted-manifest/019a47d2-a46d-5d87-c46c-f1862b23438e',
        permanent: false, // Ensures a 307 temporary redirect
      },
    ];
  },
  webpack: (config, options) => {
    if (options.isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'node:crypto': 'crypto',
        'node:fs': 'fs',
        'node:path': 'path',
      };
    } else {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        path: false,
      };
    }
    if (!options.dev) {
      config.optimization.minimizer.push(
        new (require('terser-webpack-plugin'))({
          terserOptions: {
            compress: {
              drop_console: true,
            },
          },
        })
      );
    }
    return config;
  },
};

export default nextConfig;