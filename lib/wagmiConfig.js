// lib/wagmiConfig.js 
import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';
import { QueryClient } from '@tanstack/react-query';

export const config = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({
      appName: 'XynapseAI',
      preference: 'smartWalletOnly',
    }),
    injected({ target: 'metaMask' }), 
  ],
  transports: {
    [base.id]: http(),
  },
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24h stale time 
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    },
  },
});