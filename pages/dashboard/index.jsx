// pages/dashboard/index.jsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useSession } from 'next-auth/react';

export default function Dashboard() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard/leaderboard');
    } else if (status === 'unauthenticated') {
      router.replace('/auth/signin');
    }
  }, [status, router]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
      <Head>
        <title>Dashboard - Redirecting</title>
        <meta name="description" content="Redirecting to dashboard" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </Head>
      <p>Loading...</p>
    </div>
  );
}