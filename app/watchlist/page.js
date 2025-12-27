// app/watchlist/page.js
import { redirect } from 'next/navigation';

export default async function WatchlistPage({ searchParams }) {
  const { address = null } = await searchParams;
  const query = address ? `tab=watchlists&address=${encodeURIComponent(address)}` : 'tab=watchlists';
  redirect(`/dashboard?${query}`);
}

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