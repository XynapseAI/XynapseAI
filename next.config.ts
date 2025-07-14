// next.config.ts
/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  images: {
    domains: ['ipfs.io', 'pbs.twimg.com', 'localhost', 'lh3.googleusercontent.com', 'xynapseai.net', 'app.xynapseai.net', 'api.xynapseai.net'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
        pathname: '/asset_platforms/images/**',
      },
      {
        protocol: 'https',
        hostname: 'xynapseai.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'app.xynapseai.net',
        pathname: '/**',
      },
    ],
    loader: 'default', // Sử dụng Next.js Image Optimization mặc định
    path: '/_next/image', // Đường dẫn tối ưu hóa hình ảnh
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