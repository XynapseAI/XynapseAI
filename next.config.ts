/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['ipfs.io', 'pbs.twimg.com'], // Thêm domain cho ảnh Twitter
  },
  experimental: {
    trustProxy: true, // Bật trustProxy để xử lý X-Forwarded-For
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
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://xynapseai.net; style-src 'self' 'unsafe-inline'; img-src 'self' https://ipfs.io https://pbs.twimg.com; connect-src 'self' https://api.geckoterminal.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;