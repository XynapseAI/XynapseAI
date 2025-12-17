// app/ClientProviders.jsx – Giữ nguyên import, chỉ sửa return
'use client';

import { SessionProvider } from 'next-auth/react';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query'; // Bỏ new QueryClient
import { OnchainKitProvider } from '@coinbase/onchainkit';
import { base } from 'wagmi/chains';
import { config, queryClient } from '../lib/wagmiConfig'; // Import global queryClient

export default function ClientProviders({ children }) {
  return (
    <WagmiProvider config={config} reconnectOnMount={true}> {/* Thêm reconnectOnMount */}
      <QueryClientProvider client={queryClient}> {/* Dùng global */}
        <SessionProvider>
          <OnchainKitProvider
            apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY || "your_fallback_api_key_here"} 
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