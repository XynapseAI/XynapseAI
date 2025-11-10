// lib/wagmiConfig.js
import { createConfig, http } from 'wagmi';
import { mainnet, arbitrumSepolia, base, optimism } from 'wagmi/chains';  // THÊM: Import optimism cho World ecosystem (chainId 10)
import { coinbaseWallet } from '@wagmi/connectors';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';  // Giữ: Connector cho Farcaster trên Base (optional, nếu dùng Mini App)

// NEW: Polyfill cho AsyncStorage (fix Metamask SDK error ở web)
if (typeof window !== 'undefined') {
  import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) => {
    window.AsyncStorage = AsyncStorage;  // FIXED: Remove 'as any' (JS syntax, không phải TS)
  });
}

const chains = [mainnet, arbitrumSepolia, base, optimism];  // THÊM: Optimism để hỗ trợ World SIWE (không ảnh hưởng Farcaster/Base)
const config = createConfig({
  chains,
  connectors: [
    coinbaseWallet({ appName: 'My Web3 Landing' }),
    farcasterMiniApp({ chains: [mainnet, base] }),  // Giữ: Connector cho Farcaster trên Base (optional, nếu dùng Mini App)
  ],
  transports: {
    [mainnet.id]: http(),
    [arbitrumSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
    [base.id]: http('https://mainnet.base.org'),  // Giữ: RPC cho Base mainnet
    [optimism.id]: http('https://mainnet.optimism.io'),  // THÊM: RPC cho Optimism (hỗ trợ World, không ảnh hưởng các chain khác)
  },
});

export { config };