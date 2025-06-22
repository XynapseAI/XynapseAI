'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { initializeApp } from 'firebase/app';
import { useAccount } from 'wagmi';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

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
          console.error('Lỗi xử lý callback Twitter:', error);
          router.push('/dashboard?error=twitter-auth-failed');
        }
      }
    };
    handleCallback();
  }, [address, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <p>Đang xử lý kết nối Twitter...</p>
    </div>
  );
}