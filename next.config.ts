// next.config.ts
/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  images: {
    domains: ['ipfs.io'],
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
