import { createConfig, http } from 'wagmi';
import { mainnet, arbitrumSepolia } from 'wagmi/chains';
import { walletConnect, injected, coinbaseWallet } from '@wagmi/connectors';const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;if (!projectId) {
  throw new Error('NEXT_PUBLIC_REOWN_PROJECT_ID is not defined in .env');
}const chains = [mainnet, arbitrumSepolia];const config = createConfig({
  chains,
  connectors: [
    injected({ shimDisconnect: true }),
    walletConnect({ projectId, showQrModal: false }),
    coinbaseWallet({ appName: 'My Web3 Landing' }),
  ],
  transports: {
    [mainnet.id]: http(),
    [arbitrumSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
  },
});

export { config };

