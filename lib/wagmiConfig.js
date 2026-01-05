import { createConfig, http } from 'wagmi'
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
  transports: {
    [base.id]: http('https://mainnet.base.org'),
  },
})
