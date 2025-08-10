// app/watchlist/page.js
import WatchlistPageClient from '../../components/WatchlistPageClient';

// Hàm tạo static params
export async function generateStaticParams() {
  try {
    // No static parameters needed since we're using dynamic rendering with address
    return [];
  } catch (error) {
    console.error('Error in generateStaticParams:', error);
    return [];
  }
}

// Server-side metadata for SEO
export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const { address = 'unknown' } = params;
  const truncatedAddress = address && address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address || 'unknown';
  return {
    title: `Wallet ${truncatedAddress} | Crypto Dashboard`,
    description: `View wallet data for ${truncatedAddress} on our crypto dashboard.`,
    keywords: `wallet, cryptocurrency, blockchain, ${address || 'watchlist'}`,
    robots: 'index, follow',
  };
}

// Server Component
export default async function WatchlistPage({ searchParams }) {
  const params = await searchParams;
  const { address = null } = params;
  return <WatchlistPageClient initialAddress={address} />;
}