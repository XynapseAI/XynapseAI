'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'react-toastify';
import { Suspense } from 'react';

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get('error');

  useEffect(() => {
    if (error === 'AccessDenied') {
      toast.error('Access denied. Please try signing in again.');
      setTimeout(() => router.push('/dashboard'), 5000);
    } else if (error) {
      toast.error(`Auth error: ${error}`);
      setTimeout(() => router.push('/dashboard'), 3000);
    }
  }, [error, router]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Authentication Error</h1>
        <p className="mb-4">Error: {error || 'Unknown'}</p>
        <p>Redirecting to dashboard...</p>
      </div>
    </div>
  );
}

export default function AuthError() {
  return (
    <Suspense fallback={<div className="h-screen w-screen flex items-center justify-center bg-black text-white">Loading...</div>}>
      <AuthErrorContent />
    </Suspense>
  );
}