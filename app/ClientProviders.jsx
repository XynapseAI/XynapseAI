// app/ClientProviders.jsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnchainKitProvider } from '@coinbase/onchainkit';
import { base } from 'wagmi/chains';
import { config } from '../lib/wagmiConfig';

const queryClient = new QueryClient();

export default function ClientProviders({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <OnchainKitProvider
            apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY}
            chain={base}
            config={{
              appearance: { mode: 'dark' },
              wallet: {
                display: 'modal',
                preference: 'all',
              },
            }}
            miniKit={{ enabled: true }}
          >
            {children}
          </OnchainKitProvider>
        </SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}