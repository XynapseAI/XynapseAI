import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Cấu hình build cho Next.js 15+
  // Đưa các thư viện server-side nặng hoặc gây lỗi build vào đây
  serverExternalPackages: [
    'rate-limiter-flexible', 
    '@tensorflow/tfjs', 
    '@tensorflow/tfjs-node', 
    'ml-isolation-forest',
    'pino',
    'winston'
  ],
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
      'res.cloudinary.com',
      'gold-tired-panda-407.mypinata.cloud',
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
        hostname: 'imagedelivery.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.mypinata.cloud',
        pathname: '/ipfs/**',
      },
      {
        protocol: 'https',
        hostname: 'ipfs.io',
        pathname: '/ipfs/**',
      },
    ],
  },
  async headers() {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      'https://xynapseai.net',
      'https://www.xynapseai.net',
      'https://base.xynapseai.net',
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
      {
        source: '/.well-known/farcaster.json',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Content-Type', value: 'application/json' },
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
      // config.optimization.minimizer.push(
      //   new (require('terser-webpack-plugin'))({
      //     terserOptions: {
      //       compress: {
      //         drop_console: true,
      //       },
      //     },
      //   })
      // );
    }
    return config;
  },
  experimental: {
  },
};

export default nextConfig;