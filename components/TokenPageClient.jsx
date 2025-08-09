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
import { useMarketTabLogic } from './MarketTabLogic';

export default function TokenPageClient({ initialTokenSlug, initialTokenData, initialTopHolders, initialPriceHistory }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const recaptchaRef = useRef(null);
  const [isLoadingToken, setIsLoadingToken] = useState(true);
  const [isLoadingPriceHistory, setIsLoadingPriceHistory] = useState(true);
  const [isLoadingTopHolders, setIsLoadingTopHolders] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('market');
  const initializedRef = useRef(false); // Theo dõi trạng thái khởi tạo
  const prevTokenSlugRef = useRef(initialTokenSlug); // Lưu token trước đó

  const {
    selectedToken,
    debouncedHandleTokenSelect,
    fetchSupportedChains,
    chains, // Lấy danh sách chains từ useMarketTabLogic
  } = useMarketTabLogic({
    recaptchaRef,
    toast,
    initialTokenSlug,
    initialTokenData,
  });

  useEffect(() => {
    console.log('TokenPageClient mounted with:', {
      initialTokenSlug,
      initialTokenData: initialTokenData?.id,
      selectedToken: selectedToken?.id,
    });
  }, [initialTokenSlug, initialTokenData, selectedToken]);

  useEffect(() => {
    // Ngăn chạy lại nếu đã khởi tạo và token không thay đổi
    if (initializedRef.current && prevTokenSlugRef.current === initialTokenSlug) {
      console.log(`Skipping initialization: Token ${initialTokenSlug} already set`);
      return;
    }

    if (initialTokenData && initialTokenSlug) {
      console.log(`Setting initial token: ${initialTokenSlug}`);
      // Kiểm tra xem chains đã được tải chưa
      if (chains.length === 0) {
        fetchSupportedChains().then(() => {
          debouncedHandleTokenSelect({ id: initialTokenSlug }, initialTokenData);
          setIsLoadingToken(false);
          setIsLoadingPriceHistory(!initialPriceHistory);
          setIsLoadingTopHolders(!initialTopHolders);
          initializedRef.current = true;
          prevTokenSlugRef.current = initialTokenSlug;
        });
      } else {
        // Nếu chains đã có, gọi trực tiếp debouncedHandleTokenSelect
        debouncedHandleTokenSelect({ id: initialTokenSlug }, initialTokenData);
        setIsLoadingToken(false);
        setIsLoadingPriceHistory(!initialPriceHistory);
        setIsLoadingTopHolders(!initialTopHolders);
        initializedRef.current = true;
        prevTokenSlugRef.current = initialTokenSlug;
      }
    } else if (!initialTokenData) {
      setError(`Token data for ${initialTokenSlug} not found`);
      setIsLoadingToken(false);
      toast.error(`Token ${initialTokenSlug} not found`, { position: 'top-center', autoClose: 3000 });
      initializedRef.current = true; // Đánh dấu đã khởi tạo để tránh chạy lại
    }
  }, [initialTokenSlug, initialTokenData, initialPriceHistory, initialTopHolders, debouncedHandleTokenSelect, fetchSupportedChains, chains]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      console.log('User unauthenticated, redirecting to signin');
      router.push('/auth/signin');
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
    router.push(`/token/${newSlug}`, { scroll: false });
    setActiveTab('market');
  };

  if (status === 'loading' || !initialTokenSlug) {
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
      <Header activeTab={activeTab} setActiveTab={setActiveTab} handleSignOut={handleSignOut} />
      <main className="flex-1 flex items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full h-full flex items-center justify-center"
        >
          {isLoadingToken ? (
            <div className="animate-pulse w-full max-w-4xl p-4">
              <div className="h-8 bg-gray-700 rounded w-1/4 mb-4"></div>
              <div className="h-64 bg-gray-700 rounded w-full mb-4"></div>
              <div className="h-32 bg-gray-700 rounded w-full"></div>
            </div>
          ) : (
            <MarketTab
              recaptchaRef={recaptchaRef}
              initialTokenSlug={initialTokenSlug}
              initialTokenData={initialTokenData}
              initialTopHolders={initialTopHolders}
              initialPriceHistory={initialPriceHistory}
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