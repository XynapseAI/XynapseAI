// app/twitter-callback/page.js
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';


export default function TwitterCallback() {
  const router = useRouter();
  const { address } = useAccount();

  useEffect(() => {
    const handleCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      if (code && state && address) {
        try {
          const handleTwitterCallback = httpsCallable(functions, 'handleTwitterCallback');
          await handleTwitterCallback({ code, state, walletAddress: address });
          router.push('/dashboard');
        } catch (error) {
          console.error('Twitter callback error:', error);
          router.push('/dashboard?error=twitter-auth-failed');
        }
      }
    };
    handleCallback();
  }, [address, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <p>Processing Twitter connection...</p>
    </div>
  );
}