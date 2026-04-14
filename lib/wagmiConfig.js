// lib/wagmiConfig.js
import { createConfig, http, createStorage, cookieStorage } from 'wagmi'
import { base } from 'wagmi/chains'
import { coinbaseWallet, injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({
      appName: 'XynapseAI',
      preference: 'all',       
    }),
    injected(),
  ],
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,        
  }),
  transports: {
    [base.id]: http('https://mainnet.base.org'),
  },
})