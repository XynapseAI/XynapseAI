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
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'app.xynapseai.net',
        pathname: '/**',
      },
    ],
    loader: 'default',
    path: '/_next/image',
    // Thêm để hỗ trợ file cục bộ
    unoptimized: false, // Bật tối ưu hóa, nhưng có thể thử true nếu vẫn lỗi
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