// components/WatchlistPageClient.jsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Header from './Header';
import WatchlistsTab from './WatchlistsTab';
import ReCAPTCHA from 'react-google-recaptcha';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { LoadingOverlay } from '../utils/helpers';

export default function WatchlistPageClient({ initialAddress = null }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const recaptchaRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      console.log('User unauthenticated, redirecting to signin');
      router.push('/auth/signin');
      return;
    }
    setIsLoading(false);
  }, [status, router]);

  const handleSignOut = async () => {
    try {
      await signOut({ callbackUrl: '/' });
    } catch (error) {
      console.error('Sign out error:', error);
      setError('Failed to sign out.');
      toast.error('Failed to sign out.', { position: 'top-center', autoClose: 3000 });
    }
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <div className="animate-pulse">
          <div className="w-12 h-12 border-4 border-gray-700 border-t-neon-blue rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null;
  }

  if (error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white font-saira">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <a href="/dashboard" className="text-neon-blue hover:underline">
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
      <Header activeTab="watchlist" setActiveTab={() => {}} handleSignOut={handleSignOut} />
      <main className="flex-1 flex items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full h-full flex items-center justify-center"
        >
          <WatchlistsTab
            initialAddress={initialAddress}
            toast={toast}
          />
        </motion.div>
      </main>
      <ReCAPTCHA
        ref={recaptchaRef}
        sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
        size="invisible"
        badge="bottomright"
      />
      <p className="text-[8px] text-gray-600 ml-2">
        Protected by reCAPTCHA. See{' '}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-blue"
        >
          Privacy Policy
        </a>{' '}
        &{' '}
        <a
          href="https://policies.google.com/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-blue"
        >
          Terms
        </a>{' '}
        of Google.
      </p>
    </div>
  );
}