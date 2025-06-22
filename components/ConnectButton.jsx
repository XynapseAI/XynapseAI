'use client';

import { useAccount, useDisconnect } from 'wagmi';

export default function ConnectButton() {
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const handleConnect = async () => {
    try {
      if (typeof window !== 'undefined') {
        const { createWeb3Modal } = await import('@web3modal/wagmi');
        const modal = createWeb3Modal({
          wagmiConfig: (await import('../lib/wagmiConfig')).config,
          projectId: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
          themeMode: 'dark',
          themeVariables: { '--w3m-z-index': 1000 },
        });
        await modal.open();
      }
    } catch (error) {
      console.error('Lỗi kết nối ví:', error);
    }
  };

  if (isConnected) {
    return (
      <button
        onClick={() => disconnect()}
        className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-all duration-300"
      >
        Ngắt Kết Nối
      </button>
    );
  }

  return (
    <button
      onClick={handleConnect}
      className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-all duration-300"
    >
      Kết Nối Ví
    </button>
  );
}