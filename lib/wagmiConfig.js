// lib/wagmiConfig.js
import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';

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