// app/auth/error/AuthErrorClient.js
'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';

export default function AuthErrorClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get('error') || 'Unknown error';

  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold">Authentication Error</h1>
      <p className="mt-4">{error}</p>
      <button 
        onClick={() => router.push('/dashboard')} 
        className="mt-4 px-4 py-2 bg-blue-600 rounded"
      >
        Back to Dashboard
      </button>
    </div>
  );
}