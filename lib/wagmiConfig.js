// lib/wagmiConfig.js
import { createConfig, http } from 'wagmi';
import { mainnet, arbitrumSepolia, base } from 'wagmi/chains';  // THÊM: Import base chain
import { injected, coinbaseWallet } from '@wagmi/connectors';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';  // THÊM: Nếu dùng Mini App (optional)

const chains = [mainnet, arbitrumSepolia, base];  // THÊM: Base vào chains
const config = createConfig({
  chains,
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: 'My Web3 Landing' }),
    farcasterMiniApp({ chains: [mainnet, base] }),  // THÊM: Connector cho Farcaster trên Base (optional, nếu dùng Mini App)
  ],
  transports: {
    [mainnet.id]: http(),
    [arbitrumSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
    [base.id]: http('https://mainnet.base.org'),  // THÊM: RPC cho Base mainnet
  },
});

export { config };