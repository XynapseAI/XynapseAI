'use client';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

export default function AuthError() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const provider = searchParams.get('provider');

  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="p-8 border rounded-lg text-center">
        <h1>Auth Error</h1>
        <p>{error ? `Error: ${error}` : 'Unknown authentication error. Try again.'}</p>
        <p>If domain mismatch, check NEXTAUTH_URL env.</p>
        <button onClick={() => signIn(provider || 'farcaster', { callbackUrl: '/dashboard' })}>
          Retry
        </button>
      </div>
    </div>
  );
}