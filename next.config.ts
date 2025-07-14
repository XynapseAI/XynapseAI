// next.config.ts
/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  images: {
    domains: ['ipfs.io', 'pbs.twimg.com', 'localhost', 'lh3.googleusercontent.com'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
        pathname: '/asset_platforms/images/**',
      },
      {
        protocol: 'https',
        hostname: 'app.xynapseai.net',
        pathname: '/logos/**',
      },
    ],
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
};