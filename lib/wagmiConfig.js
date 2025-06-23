import { createConfig, http } from 'wagmi';
import { mainnet, arbitrumSepolia } from 'wagmi/chains';
import { injected, coinbaseWallet } from '@wagmi/connectors';

const chains = [mainnet, arbitrumSepolia];
const config = createConfig({
  chains,
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: 'My Web3 Landing' }),
  ],
  transports: {
    [mainnet.id]: http(),
    [arbitrumSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
  },
});

export { config };