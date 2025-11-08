'use client';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk'; // Nếu inMiniApp
import { toast } from 'react-toastify'; // Nếu dùng

export default function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const error = searchParams.get('error');

  useEffect(() => {
    if (error) {
      toast.error(`Auth error: ${error === 'undefined' ? 'Verification failed. Check domain.' : error}`);
    }
  }, [error]);

  const handleFarcasterSignIn = async () => {
    if (typeof window !== 'undefined') {
      try {
        const inMini = await sdk.isInMiniApp();
        if (inMini) {
          const { token } = await sdk.quickAuth.getToken();
          console.log('Token preview:', token?.substring(0, 50) + '...'); // Debug
          if (!token) throw new Error('No token from SDK');
          const decoded = JSON.parse(atob(token.split('.')[1]));
          console.log('Decoded aud:', decoded.aud); // CRITICAL debug
          const res = await signIn('farcaster', { token, redirect: false, callbackUrl: '/dashboard' });
          if (res?.error) {
            console.error('SignIn error:', res.error);
            toast.error(`Sign-in failed: ${res.error}`);
            return;
          }
          router.push('/dashboard');
        } else {
          // Fallback PC: manual FID input or other
          toast.error('Not in Mini App. Use Base/Google.');
        }
      } catch (err) {
        console.error('SDK error:', err);
        toast.error(`SDK error: ${err.message}`);
      }
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="p-8 border rounded-lg">
        <h1>Sign In</h1>
        {error && <p className="text-red-500">Error: {error}</p>}
        <button onClick={handleFarcasterSignIn} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in with Farcaster'}
        </button>
        {/* Add Base/Google buttons */}
      </div>
    </div>
  );
}