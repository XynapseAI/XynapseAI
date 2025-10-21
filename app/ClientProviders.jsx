// app/ClientProviders.jsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MiniAppProvider } from '@neynar/react';  // Mới: Mini App context
import { config } from '../lib/wagmiConfig';  // Đảm bảo import đúng

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,  // Optimize cho Mini App (không refetch khi focus)
    },
  },
});

export default function ClientProviders({ children }) {
  return (
    <SessionProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <MiniAppProvider analyticsEnabled={true}>  {/* Mới: Wrap để detect Farcaster */}
            {children}
          </MiniAppProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </SessionProvider>
  );
}