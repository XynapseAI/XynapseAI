// app/ClientProviders.jsx - Updated with OnchainKit integration
'use client';

import { SessionProvider } from 'next-auth/react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnchainKitProvider } from '@coinbase/onchainkit';
import { base } from 'wagmi/chains'; // Changed to testnet for mint testing
import { config } from '../lib/wagmiConfig';

const queryClient = new QueryClient();

export default function ClientProviders({ children }) {
  return (
    <OnchainKitProvider
      apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY || "your_fallback_api_key_here"} 
      chain={base}
      config={{
        appearance: { mode: 'dark' },  // Match app's dark theme
        wallet: { 
          display: 'modal',  // Modal on PC, auto-drawer on mobile/Base App
          preference: 'all',  // Support EOA (MetaMask) + Smart Wallets (Coinbase)
        },
      }}
      miniKit={{ enabled: true }}  // Enable for Base Mini App native support
    >
      <SessionProvider>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </WagmiProvider>
      </SessionProvider>
    </OnchainKitProvider>
  );
}