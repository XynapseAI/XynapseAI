// components/WatchlistPageClient.jsx
'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

export default function WatchlistPageClient({ initialAddress = null }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const address = searchParams.get('address') || initialAddress;

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      console.log('User unauthenticated, redirecting to signin');
      router.push('/auth/signin');
      return;
    }
    // Redirect to /dashboard with tab=watchlists and address
    const query = address ? `tab=watchlists&address=${encodeURIComponent(address)}` : 'tab=watchlists';
    router.replace(`/dashboard?${query}`, { scroll: false });
  }, [status, router, address]);

  // Return null since the component will redirect
  return null;
}