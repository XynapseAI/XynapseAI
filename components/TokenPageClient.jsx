// components/TokenPageClient.jsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Header from './Header';
import MarketTab from './MarketTab';
import ReCAPTCHA from 'react-google-recaptcha';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';

export default function TokenPageClient({ initialTokenSlug, initialTokenData, initialTopHolders }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const recaptchaRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('market');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else {
      setLoading(false); // Complete loading once session is confirmed
    }
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

  const handleNavigateToToken = (newSlug) => {
    if (!newSlug || typeof newSlug !== 'string' || newSlug.trim() === '') {
      console.error('Invalid slug provided for navigation:', { slug: newSlug });
      toast.error('Cannot navigate to token page: Invalid token ID.', {
        position: 'top-center',
        autoClose: 3000,
      });
      return;
    }
    setLoading(true); // Show loading state during navigation
    router.push(`/token/${newSlug}`, { scroll: false });
    setActiveTab('market');
  };

  if (status === 'loading' || !initialTokenSlug || loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-700 border-t-neon-blue rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null; // Redirect handled in useEffect
  }

  return (
    <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} handleSignOut={handleSignOut} />
      <main className="flex-1 flex items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full h-full flex items-center justify-center"
        >
          <MarketTab
            recaptchaRef={recaptchaRef}
            initialTokenSlug={initialTokenSlug}
            initialTokenData={initialTokenData}
            initialTopHolders={initialTopHolders}
            onTokenSelect={handleNavigateToToken}
          />
        </motion.div>
      </main>
      <ReCAPTCHA
        ref={recaptchaRef}
        sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
        size="invisible"
        badge="bottomright"
      />
      <p className="text-[14px] text-gray-600 ml-2">
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