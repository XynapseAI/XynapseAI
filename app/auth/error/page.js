// app/auth/error/page.js
'use client';
import { useSearchParams } from 'next/navigation';

export default function AuthError() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || 'Unknown error';

  return (
    <div className="h-screen flex items-center justify-center bg-black text-white">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Authentication Error</h1>
        <p className="mt-4">{error}</p>
        <button onClick={() => window.location.href = '/dashboard'} className="mt-4 px-4 py-2 bg-blue-600 rounded">
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}