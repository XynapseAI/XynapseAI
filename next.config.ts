/** @type {import('next').NextConfig} */
const nextConfig = {
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
  }
};

export default nextConfig;