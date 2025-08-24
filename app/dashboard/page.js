'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { signIn, signOut, useSession, getProviders } from 'next-auth/react';
import Header from '../../components/Header';
import AITab from '../../components/AITab';
import ProfileTab from '../../components/ProfileTab';
import MarketTab from '../../components/MarketTab';
import TreemapTab from '../../components/TreemapTab';
import WatchlistsTab from '../../components/WatchlistsTab';
import ClusterTab from '../../components/ClusterTab';
import ReCAPTCHA from 'react-google-recaptcha';
import { toast, ToastContainer } from 'react-toastify';
import MatrixHoverEffect from '../../components/MatrixHoverEffect';
import { motion } from 'framer-motion';
import styles from './page.module.css';
import Image from 'next/image';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
// import { LoadingOverlay } from '@/utils/helpers';
import { CurrencyProvider } from '../../components/CurrencyContext';

gsap.registerPlugin(MotionPathPlugin);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

// Custom hook để xử lý trạng thái và logic của user data
const useUserData = (session, csrfToken, setIsAnalyzing) => {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const recaptchaRef = useRef(null);

  const fetchUserData = useCallback(async () => {
    if (!session?.user?.id || !csrfToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const recaptchaToken = 'mock-recaptcha-token'; // Thay bằng logic thực tế
      const response = await fetch(`${API_BASE_URL}/api/user?uid=${encodeURIComponent(session.user.id)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken,
        },
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || 'Failed to fetch user data');
      }
      // Kiểm tra header X-Clear-IndexedDB
      if (response.headers.get('X-Clear-IndexedDB') === 'true') {
        await clearAllCaches(session.user.id);
        console.log('Cleared IndexedDB cache due to server instruction');
      }
      setUserData({
        ...result.user,
        profilePicture: result.user.profile_picture,
        googleName: result.user.google_name,
        tweetPoints: result.user.tweet_points,
        aiPoints: result.user.ai_points,
      });
      toast.success('User data loaded successfully!', { position: 'top-center' });
      setError(null);
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError(`Failed to fetch user data: ${err.message}`);
      toast.error(`Error: ${err.message}`, { position: 'top-center' });
    } finally {
      setLoading(false);
    }
  }, [session, csrfToken]);

  const handleAnalyzeTweets = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      if (!session?.user || !csrfToken) throw new Error('Authentication or CSRF token missing');
      const recaptchaToken = 'mock-recaptcha-token'; // Thay bằng logic thực tế
      const response = await fetch(`${API_BASE_URL}/api/analyze-tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ uid: session.user.id }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || 'Tweet analysis failed');
      }
      setUserData((prev) => (prev ? { ...prev, tweetPoints: result.tweet_points } : null));
      toast.success('Tweet analysis successful!', { position: 'top-center' });
    } catch (err) {
      console.error('Error analyzing tweet:', err);
      toast.error(`Tweet analysis error: ${err.message}`, { position: 'top-center' });
    } finally {
      setIsAnalyzing(false);
    }
  }, [session, csrfToken, setIsAnalyzing]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  return { userData, loading, error, handleAnalyzeTweets, recaptchaRef };
};

export default function Dashboard() {
  const { data: session, status, update } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  const [selectedAddress, setSelectedAddress] = useState(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [providers, setProviders] = useState(null);
  const [email, setEmail] = useState('');
  const [csrfToken, setCsrfToken] = useState(null);
  const starsBackgroundRef = useRef(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userData, loading, error, handleAnalyzeTweets, recaptchaRef } = useUserData(session, csrfToken, setIsAnalyzing);

  useEffect(() => {
    setIsMounted(true);
    const tab = searchParams.get('tab');
    if (tab && ['market', 'ai', 'profile', 'treemap', 'watchlists', 'cluster'].includes(tab)) {
      setActiveTab(tab);
    }
    const address = searchParams.get('address');
    if (address) {
      setSelectedAddress(address);
    }
  }, [searchParams]);

  useEffect(() => {
    if (status !== 'authenticated' || session?.csrfToken || csrfToken) return;

    const fetchCsrfToken = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/csrf-token`);
        const result = await response.json();
        if (response.ok) {
          setCsrfToken(result.csrfToken);
          await update({ csrfToken: result.csrfToken });
        } else {
          throw new Error(result.detail || 'Failed to fetch CSRF token');
        }
      } catch (err) {
        console.error('Error fetching CSRF token:', err);
        toast.error(`Failed to fetch CSRF token: ${err.message}`, { position: 'top-center' });
      }
    };
    fetchCsrfToken();
  }, [status, session, csrfToken, update]);

  // Handle wallet connection
  const handleConnectWallet = async () => {
    try {
      if (!session?.user || !isConnected || !address || !recaptchaRef.current) throw new Error('Prerequisites not met');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const message = `Sign this message to authenticate: ${address}`;
      const signature = await signMessageAsync({ message });
      const response = await fetch(`${API_BASE_URL}/api/verify-wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Recaptcha-Token': recaptchaToken, 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ walletAddress: address, signature, message, uid: session.user.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Wallet verification failed');
      toast.success('Wallet connected successfully!', { position: 'top-center' });
    } catch (err) {
      console.error('Error verifying wallet:', err);
      toast.error(`Wallet verification error: ${err.message}`, { position: 'top-center' });
    } finally {
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  // Handle sign out
  const handleSignOut = async () => {
    try {
      await signOut({ callbackUrl: '/' });
      if (isConnected) disconnect();
      toast.success('Signed out successfully!', { position: 'top-center' });
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out.', { position: 'top-center' });
    }
  };

  // Handle navigation to token page
  const handleNavigateToToken = useCallback((slug) => {
    if (!slug) {
      toast.error('Invalid token ID.', { position: 'top-center' });
      return;
    }
    router.push(`/dashboard?tab=market&token=${slug}`, { scroll: false });
    setActiveTab('market');
  }, [router]);

  // Handle email sign-in
  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    try {
      await signIn('email', { email, callbackUrl: '/dashboard' });
      toast.success('Sign-in email sent, please check your inbox!', { position: 'top-center' });
    } catch {
      toast.error('Failed to sign in with email.', { position: 'top-center' });
    }
  };

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await getProviders();
        setProviders(response);
      } catch (err) {
        console.error('Error fetching providers:', err);
        toast.error('Failed to fetch sign-in methods.', { position: 'top-center' });
      }
    };
    fetchProviders();
  }, []);

  if (!isMounted || !providers) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <LoadingOverlay isLoading={true} message="Loading dashboard..." isMobile={typeof window !== 'undefined' && window.innerWidth <= 640} />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className={`h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-saira relative ${styles.container}`}
      >
        <motion.div
          ref={starsBackgroundRef}
          className={`absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800 ${styles['stars-background']}`}
          animate={{
            background: [
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(0, 191, 255, 0.1))',
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
            ],
          }}
          transition={{ duration: 15, repeat: Infinity, repeatType: 'reverse' }}
        >
          <div className={styles['stars-layer-1']} />
          <div className={styles['stars-layer-2']} />
          <div className={styles['stars-layer-3']} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className={`absolute top-2 left-2 z-20 ${styles['logo-container']}`}
        >
          <Image
            src="/logos/logo-landscape.png"
            alt="Xynapse Logo"
            width={120}
            height={56}
            className="h-10 sm:h-12 w-auto object-contain"
            priority
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className={`relative z-10 bg-gray-900/30 backdrop-blur-lg p-6 md:p-10 rounded-2xl border border-white/10 ${styles['shadow-glow-neon']} max-w-md w-full mx-4 flex flex-col items-center`}
        >
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-2xl md:text-3xl font-bold text-white uppercase mb-2 text-center"
          >
            Sign In
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-xs md:text-xs text-gray-400 mb-8 text-center"
          >
            Sign in with Google or Email to access your dashboard.
          </motion.p>
          <form onSubmit={handleEmailSignIn} className="w-full space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className={`w-full px-4 py-3 bg-gray-800/50 border border-white/10 rounded-full text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-neon-blue ${styles['input-glow']}`}
              required
            />
            <button
              type="submit"
              className={`w-full px-4 py-3 bg-neon-blue text-black rounded-full text-sm font-medium uppercase transition-all duration-300 hover:bg-neon-blue/80 ${styles['button-glow']}`}
            >
              <MatrixHoverEffect text="Sign in with Email" hoverColor="#FFFFFF" />
            </button>
          </form>
          <div className="flex items-center justify-center my-4 w-full">
            <span className="text-gray-500 text-sm uppercase">OR</span>
          </div>
          {providers?.google && (
            <button
              onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
              className={`w-full px-4 py-3 bg-gray-800/50 border border-white/20 rounded-full text-white text-sm font-medium uppercase flex items-center justify-center gap-2 transition-all duration-300 hover:bg-gray-700/50 ${styles['button-glow']}`}
            >
              <Image
                src="/logos/google.png"
                alt="Google Logo"
                width={20}
                height={20}
                className="w-5 h-5 object-contain mr-2"
              />
              <MatrixHoverEffect text="Sign in with Google" hoverColor="#00BFFF" />
            </button>
          )}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className={`mt-6 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center ${styles['shadow-glow-neon-red']}`}
            >
              Error: {error}
            </motion.div>
          )}
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="absolute bottom-2 left-2 text-[8px] text-gray-600 z-10"
        >
          Protected by reCAPTCHA. See{' '}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-blue hover:underline"
          >
            Privacy Policy
          </a>{' '}
          &{' '}
          <a
            href="https://policies.google.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-blue hover:underline"
          >
            Terms
          </a>{' '}
          of Google.
        </motion.p>
      </motion.div>
    );
  }

  return (
    <CurrencyProvider>
      <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
        <Header activeTab={activeTab} setActiveTab={setActiveTab} handleSignOut={handleSignOut} selectedAddress={selectedAddress} />
        <main className="flex-1 flex items-center justify-center overflow-hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="w-full h-full flex items-center justify-center"
          >
            {activeTab === 'market' && (
              <MarketTab
                recaptchaRef={recaptchaRef}
                toast={toast}
                onTokenSelect={handleNavigateToToken}
                initialTokenSlug={searchParams.get('token') || undefined}
              />
            )}
            {activeTab === 'ai' && <AITab recaptchaRef={recaptchaRef} />}
            {activeTab === 'profile' && (
              <ProfileTab
                userData={userData}
                loading={loading}
                error={error}
                isConnected={isConnected}
                handleConnectWallet={handleConnectWallet}
                recaptchaRef={recaptchaRef}
              />
            )}
            {activeTab === 'treemap' && <TreemapTab onTokenSelect={handleNavigateToToken} />}
            {activeTab === 'watchlists' && <WatchlistsTab toast={toast} initialAddress={selectedAddress} />}
            {activeTab === 'cluster' && (
              <ClusterTab
                recaptchaRef={recaptchaRef}
                initialExchangeId={searchParams.get('exchangeId') || undefined}
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
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-neon-blue">
            Privacy Policy
          </a>{' '}
          &{' '}
          <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-neon-blue">
            Terms
          </a>{' '}
          of Google.
        </p>
        <ToastContainer position="top-center" autoClose={3000} hideProgressBar closeOnClick pauseOnHover />
      </div>
    </CurrencyProvider>
  );
}