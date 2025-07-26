// app/watchlist/page.js
import WatchlistsTab from '../../components/WatchlistsTab';
import { toast } from 'react-toastify';

// Hàm tạo static params (giữ nguyên)
export async function generateStaticParams() {
  try {
    const popularAddresses = [
      '0x1234567890abcdef1234567890abcdef12345678', // Example EVM address
      '7x7y8z9A1b2C3d4E5f6G7h8I9j0K1L2M3N4O5P6Q', // Example Solana address
    ];
    const tabs = ['token', 'nft', 'activity'];
    const params = popularAddresses.flatMap((address) =>
      tabs.map((tab) => ({
        query: { tab, address },
      }))
    );
    return params;
  } catch (error) {
    console.error('Error in generateStaticParams:', error);
    return []; // Return empty array to allow dynamic server-side rendering
  }
}

// Server-side metadata for SEO
export async function generateMetadata({ searchParams }) {
  const params = await searchParams; // Await searchParams
  const { address = 'unknown', tab = 'token' } = params;
  const capitalizedTab = tab.charAt(0).toUpperCase() + tab.slice(1);
  const truncatedAddress = address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
  return {
    title: `${capitalizedTab} for Wallet ${truncatedAddress} | Crypto Dashboard`,
    description: `View ${tab} data for wallet ${truncatedAddress} on our crypto dashboard.`,
    keywords: `wallet, ${tab}, cryptocurrency, blockchain, ${address}`,
    robots: 'index, follow',
  };
}

// Server Component
export default async function WatchlistPage({ searchParams }) {
  const params = await searchParams; // Await searchParams
  const { tab = 'token', address = null } = params;
  return <WatchlistsTab initialTab={tab} initialAddress={address} toast={toast} />;
}