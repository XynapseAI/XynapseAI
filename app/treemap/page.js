// app/treemap/page.js
import TreemapTab from '../../components/TreemapTab';

// Disable static generation for now to avoid prerendering issues
export async function generateStaticParams() {
  const supportedChains = ['ethereum', 'bsc', 'polygon', 'optimism', 'arbitrum'];
  const popularAddresses = [
    '0x1234567890abcdef1234567890abcdef12345678',
    '0xabcdef1234567890abcdef1234567890abcdef12',
  ];
  return supportedChains.flatMap((chain) =>
    popularAddresses.map((address) => ({ chain, address }))
  );
}

// Server-side metadata for SEO
export async function generateMetadata({ searchParams }) {
  const address = searchParams.address || 'unknown';
  const chain = searchParams.chain || 'ethereum';
  const truncatedAddress = address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
  const capitalizedChain = chain.charAt(0).toUpperCase() + chain.slice(1);
  return {
    title: `Transaction Treemap for Wallet ${truncatedAddress} on ${capitalizedChain}`,
    description: `Explore the transaction treemap for wallet ${truncatedAddress} on ${capitalizedChain}.`,
    keywords: `wallet, treemap, transactions, ${chain}, cryptocurrency, blockchain`,
  };
}

// Server Component
export default function TreemapPage({ searchParams }) {
  console.log('TreemapPage props:', { searchParams }); // Debug log
  const initialChain = searchParams.chain || 'ethereum';
  const initialAddress = searchParams.address || '';
  return <TreemapTab initialChain={initialChain} initialAddress={initialAddress} />;
}