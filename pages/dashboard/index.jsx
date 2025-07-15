// pages/dashboard/index.jsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useSession } from 'next-auth/react';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.xynapseai.net';

export default function Dashboard() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    console.log('Dashboard redirect check, status:', status);
    if (status === 'authenticated') {
      console.log('Redirecting to:', `${APP_URL}/dashboard/leaderboard`);
      router.replace(`${APP_URL}/dashboard/leaderboard`);
    } else if (status === 'unauthenticated') {
      console.log('Redirecting to:', `${APP_URL}/auth/signin`);
      router.replace(`${APP_URL}/auth/signin`);
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