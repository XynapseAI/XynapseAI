'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { signIn } from 'next-auth/react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const provider = searchParams.get('provider');

  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="p-8 border rounded-lg text-center max-w-md w-full">
        <h1 className="text-2xl font-bold mb-4 text-red-500">Authentication Error</h1>
        <p className="mb-4">{error ? `Error: ${error}` : 'Unknown error occurred.'}</p>
        <p className="text-sm text-gray-400 mb-4">If this persists, check console logs or contact support.</p>
        <button 
          onClick={() => signIn(provider || 'farcaster', { callbackUrl: '/dashboard' })}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg"
        >
          Retry Sign In
        </button>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ErrorContent />
    </Suspense>
  );
}