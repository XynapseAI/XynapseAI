// app/treemap/page.js
import TreemapTab from '../../components/TreemapTab';

// Disable static generation for dynamic routes with searchParams
export const dynamic = 'force-dynamic';

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
  const params = await searchParams; // Await searchParams
  const chain = (params?.chain || 'ethereum').toLowerCase();
  const address = params?.address || 'unknown';
  const supportedChains = ['ethereum', 'bsc', 'polygon', 'optimism', 'arbitrum'];
  const validChain = supportedChains.includes(chain) ? chain : 'ethereum';
  const truncatedAddress = address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
  const capitalizedChain = validChain.charAt(0).toUpperCase() + validChain.slice(1);

  return {
    title: `Transaction Treemap for Wallet ${truncatedAddress} on ${capitalizedChain}`,
    description: `Explore the transaction treemap for wallet ${truncatedAddress} on ${capitalizedChain}.`,
    keywords: `wallet, treemap, transactions, ${validChain}, cryptocurrency, blockchain`,
  };
}

// Server Component
export default async function TreemapPage({ searchParams }) {
  const params = await searchParams; // Await searchParams
  console.log('TreemapPage props:', { params }); // Debug log
  const initialChain = (params?.chain || 'ethereum').toLowerCase();
  const initialAddress = params?.address || '';
  return <TreemapTab initialChain={initialChain} initialAddress={initialAddress} />;
}