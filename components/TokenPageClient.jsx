// components/TokenPageClient.jsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Header from './Header';
import MarketTab from './MarketTab';
import ReCAPTCHA from 'react-google-recaptcha';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { useMarketTabLogic } from './MarketTabLogic';
import { LoadingOverlay } from '../utils/helpers';
import axios from 'axios';

export default function TokenPageClient({ initialTokenSlug, initialTokenData, initialTopHolders, initialPriceHistory }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedAddress = searchParams.get('address') || null;
  const slugFromUrl = searchParams.get('slug') || initialTokenSlug;
  const recaptchaRef = useRef(null);
  const [isLoadingToken, setIsLoadingToken] = useState(true);
  const [isLoadingPriceHistory, setIsLoadingPriceHistory] = useState(true);
  const [isLoadingTopHolders, setIsLoadingTopHolders] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('market');
  const initializedRef = useRef(false);
  const prevTokenSlugRef = useRef(slugFromUrl);
  const [tokenData, setTokenData] = useState(initialTokenData);
  const [topHolders, setTopHolders] = useState(initialTopHolders || []);
  const [priceHistory, setPriceHistory] = useState(initialPriceHistory || []);

  const {
    selectedToken,
    debouncedHandleTokenSelect,
    fetchSupportedChains,
    chains,
  } = useMarketTabLogic({
    recaptchaRef,
    toast,
    initialTokenSlug: slugFromUrl,
    initialTokenData: tokenData,
  });

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

  const fetchTokenData = async (slug) => {
    try {
      const response = await axios.get(`${apiBaseUrl}/api/coingecko/token/${slug}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.data.success || !response.data.data) {
        throw new Error(`Invalid response for ${slug}`);
      }
      setTokenData(response.data.data);
      setTopHolders(response.data.topHolders || []);
      setPriceHistory(response.data.priceHistory || []);
      return response.data;
    } catch (error) {
      console.error(`Error fetching token data for ${slug}:`, error);
      setError(`Failed to fetch token data for ${slug}`);
      toast.error(`Token ${slug} not found`, { position: 'top-center', autoClose: 3000 });
      return null;
    }
  };

  useEffect(() => {
    console.log('TokenPageClient mounted with:', {
      slugFromUrl,
      initialTokenSlug,
      initialTokenData: initialTokenData?.id,
      selectedToken: selectedToken?.id,
    });

    if (status === 'unauthenticated') {
      console.log('User unauthenticated, redirecting to signin');
      router.push('/auth/signin');
      return;
    }

    if (!slugFromUrl) {
      setError('No token slug provided');
      setIsLoadingToken(false);
      toast.error('No token specified', { position: 'top-center', autoClose: 3000 });
      return;
    }

    if (initializedRef.current && prevTokenSlugRef.current === slugFromUrl) {
      console.log(`Skipping initialization: Token ${slugFromUrl} already set`);
      return;
    }

    if (initialTokenData && slugFromUrl === initialTokenSlug && chains.length > 0) {
      console.log(`Setting initial token: ${slugFromUrl}`);
      debouncedHandleTokenSelect({ id: slugFromUrl }, initialTokenData);
      setIsLoadingToken(false);
      setIsLoadingPriceHistory(!initialPriceHistory);
      setIsLoadingTopHolders(!initialTopHolders);
      initializedRef.current = true;
      prevTokenSlugRef.current = slugFromUrl;
    } else {
      fetchSupportedChains().then(() => {
        fetchTokenData(slugFromUrl).then((data) => {
          if (data) {
            debouncedHandleTokenSelect({ id: slugFromUrl }, data.data);
            setIsLoadingToken(false);
            setIsLoadingPriceHistory(!data.priceHistory);
            setIsLoadingTopHolders(!data.topHolders);
            initializedRef.current = true;
            prevTokenSlugRef.current = slugFromUrl;
          }
        });
      });
    }
  }, [slugFromUrl, initialTokenSlug, initialTokenData, initialPriceHistory, initialTopHolders, debouncedHandleTokenSelect, fetchSupportedChains, chains, status, router]);

  const handleSignOut = async () => {
    try {
      await signOut({ callbackUrl: '/' });
    } catch (error) {
      console.error('Sign out error:', error);
      setError('Failed to sign out.');
      toast.error('Failed to sign out.', { position: 'top-center', autoClose: 3000 });
    }
  };

  const handleSetActiveTab = (tabId) => {
    setActiveTab(tabId);
    const queryParams = new URLSearchParams();
    queryParams.set('tab', tabId);
    if (tabId === 'watchlists' && selectedAddress) {
      queryParams.set('address', encodeURIComponent(selectedAddress));
    } else if (tabId === 'market' && slugFromUrl) {
      queryParams.set('slug', encodeURIComponent(slugFromUrl));
    }
    router.push(`/dashboard?${queryParams.toString()}`, { scroll: false });
  };

  const handleNavigateToToken = (newSlug) => {
    if (!newSlug || typeof newSlug !== 'string' || newSlug.trim() === '') {
      console.error(`Invalid slug provided for navigation: ${newSlug}`);
      toast.error('Cannot navigate to token page: Invalid token ID.', {
        position: 'top-center',
        autoClose: 3000,
      });
      return;
    }
    console.log(`Navigating to token: ${newSlug}`);
    setIsLoadingToken(true);
    setIsLoadingPriceHistory(true);
    setIsLoadingTopHolders(true);
    setError(null);
    const queryParams = new URLSearchParams();
    queryParams.set('tab', 'market');
    queryParams.set('slug', encodeURIComponent(newSlug));
    if (selectedAddress) {
      queryParams.set('address', encodeURIComponent(selectedAddress));
    }
    router.push(`/dashboard?${queryParams.toString()}`, { scroll: false });
    setActiveTab('market');
  };

  if (status === 'loading' || !slugFromUrl) {
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
          <h1 className="text-2xl font-bold mb-4">Token Not Found</h1>
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
      <Header
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        handleSignOut={handleSignOut}
        selectedAddress={selectedAddress}
      />
      <main className="flex-1 flex items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full h-full flex items-center justify-center"
        >
          {isLoadingToken ? (
            <div className="w-full h-full flex items-center justify-center">
              <LoadingOverlay isLoading={true} isMobile={window.innerWidth <= 640} />
            </div>
          ) : (
            <MarketTab
              recaptchaRef={recaptchaRef}
              initialTokenSlug={slugFromUrl}
              initialTokenData={tokenData}
              initialTopHolders={topHolders}
              initialPriceHistory={priceHistory}
              onTokenSelect={handleNavigateToToken}
              isLoadingPriceHistory={isLoadingPriceHistory}
              setIsLoadingPriceHistory={setIsLoadingPriceHistory}
              isLoadingTopHolders={isLoadingTopHolders}
              setIsLoadingTopHolders={setIsLoadingTopHolders}
            />
          )}
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