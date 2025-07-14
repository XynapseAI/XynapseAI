// next.config.ts
/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  images: {
    domains: ['ipfs.io', 'pbs.twimg.com', 'localhost', 'lh3.googleusercontent.com', 'xynapseai.net', 'app.xynapseai.net'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
        pathname: '/asset_platforms/images/**',
      },
      {
        protocol: 'https',
        hostname: 'xynapseai.net',
        pathname: '/**', // Hỗ trợ tất cả đường dẫn trên xynapseai.net
      },
      {
        protocol: 'https',
        hostname: 'app.xynapseai.net',
        pathname: '/**', // Hỗ trợ tất cả đường dẫn trên app.xynapseai.net
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