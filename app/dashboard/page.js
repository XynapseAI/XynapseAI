'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { signIn, signOut, useSession, getProviders } from 'next-auth/react';
import Header from '../../components/Header';
import AITab from '../../components/AITab';
import ProfileTab  from '../../components/ProfileTab';
import MarketTab from '../../components/MarketTab';
import TreemapTab from '../../components/TreemapTab';
import WatchlistsTab from '../../components/WatchlistsTab';
import ReCAPTCHA from 'react-google-recaptcha';
import { toast, ToastContainer } from 'react-toastify';
import MatrixHoverEffect from '../../components/MatrixHoverEffect';
import { motion } from 'framer-motion';
import styles from './page.module.css';
import Image from 'next/image';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { LoadingOverlay } from '@/utils/helpers';

// Register GSAP plugins
gsap.registerPlugin(MotionPathPlugin);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function Dashboard() {
  const { data: session, status, update } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('profile');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [topPlayers, setTopPlayers] = useState({ rankings: [], creators: [], aiRank: [] });
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [lastAnalysisSuccess, setLastAnalysisSuccess] = useState(false);
  const [providers, setProviders] = useState(null);
  const [email, setEmail] = useState('');
  const [csrfToken, setCsrfToken] = useState(null);
  const [isFetchingCsrf, setIsFetchingCsrf] = useState(false);
  const recaptchaRef = useRef(null);
  const starsBackgroundRef = useRef(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch providers for sign-in options
  useEffect(() => {
    async function fetchProviders() {
      try {
        const response = await getProviders();
        setProviders(response);
      } catch (err) {
        console.error('Error fetching providers:', err);
        setError('Failed to fetch sign-in methods.');
      }
    }
    fetchProviders();
  }, []);

  // Fetch CSRF token on mount when authenticated
  useEffect(() => {
    if (!isMounted || status !== 'authenticated' || session?.csrfToken || isFetchingCsrf) return;

    async function fetchCsrfToken() {
      setIsFetchingCsrf(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Failed to fetch CSRF token');
        setCsrfToken(result.csrfToken);
        try {
          await update({ csrfToken: result.csrfToken });
        } catch (updateError) {
          console.error('Error updating session:', updateError);
          setError(`Failed to update session: ${updateError.message}. Please refresh the page.`);
        }
      } catch (err) {
        console.error('Error fetching CSRF token:', err);
        setError(`Failed to fetch CSRF token: ${err.message}. Please refresh the page or contact support.`);
        setCsrfToken(null);
      } finally {
        setIsFetchingCsrf(false);
      }
    }
    fetchCsrfToken();
  }, [isMounted, status, session, update, isFetchingCsrf]);

  // Fetch top players
  useEffect(() => {
    if (!isMounted || status !== 'authenticated' || !csrfToken) return;

    async function fetchTopPlayers() {
      setLoading(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${API_BASE_URL}/api/connect-data`, {
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken || '',
          },
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Failed to fetch leaderboard data');
        setTopPlayers({
          rankings: result.rankings || [],
          creators: result.creators.map((player) => ({
            ...player,
            points: player.tweet_points,
            profilePicture: player.profile_picture,
            googleName: player.google_name,
          })),
          aiRank: result.aiRank.map((player) => ({
            ...player,
            points: player.ai_points,
            profilePicture: player.profile_picture,
            googleName: player.google_name,
          })),
        });
        setError(null);
      } catch (err) {
        console.error('Error fetching leaderboard data:', err);
        setError(`Failed to fetch leaderboard data: ${err.message}. Please try again later.`);
        setTopPlayers({ rankings: [], creators: [], aiRank: [] });
      } finally {
        setLoading(false);
      }
    }
    fetchTopPlayers();
  }, [isMounted, status, csrfToken]);

  // Fetch user data
  useEffect(() => {
    if (!isMounted || !session?.user?.id || !csrfToken) return;

    async function initUserData() {
      setLoading(true);
      try {
        if (!recaptchaRef.current) throw new Error('reCAPTCHA not initialized');
        let recaptchaToken = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await recaptchaRef.current.reset();
            recaptchaToken = await Promise.race([
              recaptchaRef.current.executeAsync(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timed out')), 5000)),
            ]);
            if (recaptchaToken) break;
          } catch (err) {
            console.error('Error generating reCAPTCHA token (attempt', attempt, '):', err);
            if (attempt === 3) throw new Error('Failed to generate reCAPTCHA token after 3 attempts');
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        if (!recaptchaToken) throw new Error('Failed to generate reCAPTCHA token');

        // Retry logic for /api/user request
        let response;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            response = await fetch(`${API_BASE_URL}/api/user?uid=${encodeURIComponent(session.user.id)}`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'X-Recaptcha-Token': recaptchaToken,
                'X-CSRF-Token': csrfToken || '',
              },
              credentials: 'include',
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (response.ok) break;
            if (response.status === 403 && attempt < 3) {
              await fetchCsrfToken();
            } else {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
          } catch (err) {
            console.error('Error fetching user data (attempt', attempt, '):', err);
            if (attempt === 3) throw err;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        const result = await response.json();
        if (!response.ok) {
          if (result.detail?.includes('User not found')) {
            throw new Error('HTTP 404: User not found');
          }
          throw new Error(
            `${result.detail || 'Unknown error'}${result.errors ? `: ${result.errors.map((e) => e.msg).join(', ')}` : ''} (HTTP ${response.status})`
          );
        }
        setUserData({
          ...result.user,
          profilePicture: result.user.profile_picture,
          googleName: result.user.google_name,
          tweetPoints: result.user.tweet_points,
          aiPoints: result.user.ai_points,
        });
        setError(null);
        toast.success('User data loaded successfully!', { position: 'top-center' });
      } catch (err) {
        console.error('Error fetching user data:', err);
        if (err.message.includes('HTTP 404')) {
          setError('User not found. Please sign in again.');
          await signOut({ redirect: false });
          router.push('/auth/signin');
        } else {
          setUserData(null);
          setError(`Failed to fetch user data: ${err.message}. Please refresh the page or contact support.`);
          toast.error(`Error: ${err.message}`, { position: 'top-center' });
        }
      } finally {
        setLoading(false);
      }
    }
    initUserData();
  }, [isMounted, session, router, csrfToken]);

  const handleConnectWallet = async () => {
    try {
      if (!session?.user) throw new Error('Not signed in');
      if (!isConnected || !address) throw new Error('Wallet not connected');
      if (!recaptchaRef.current) throw new Error('reCAPTCHA not ready');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const message = `Sign this message to authenticate: ${address}`;
      const signature = await signMessageAsync({ message });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${API_BASE_URL}/api/verify-wallet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          walletAddress: address,
          signature,
          message,
          uid: session.user.id,
        }),
      });
      clearTimeout(timeoutId);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Wallet verification failed');
      setError(null);
      setUserData((prev) => ({
        ...prev,
        walletAddress: address,
      }));
      toast.success('Wallet connected successfully!', { position: 'top-center' });
    } catch (err) {
      console.error('Error verifying wallet:', err);
      setError(`Wallet verification error: ${err.message}`);
      toast.error(`Wallet verification error: ${err.message}`, { position: 'top-center' });
    } finally {
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut({ callbackUrl: '/' });
      if (isConnected) disconnect();
      setUserData(null);
      setError(null);
      toast.success('Signed out successfully!', { position: 'top-center' });
    } catch (error) {
      console.error('Error signing out:', error);
      setError('Failed to sign out.');
      toast.error('Failed to sign out.', { position: 'top-center' });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleAnalyzeTweets = async () => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      if (!session?.user) throw new Error('Not signed in');
      if (!recaptchaRef.current) throw new Error('reCAPTCHA not ready');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${API_BASE_URL}/api/analyze-tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ uid: session.user.id }),
      });
      clearTimeout(timeoutId);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Tweet analysis failed');
      setUserData((prev) => (prev ? { ...prev, points: result.points, tweet_points: result.tweet_points } : null));
      setError(null);
      setLastAnalysisSuccess(true);
      toast.success('Tweet analysis successful!', { position: 'top-center' });
    } catch (error) {
      console.error('Error analyzing tweet:', error);
      setError(`Tweet analysis error: ${error.message}`);
      setLastAnalysisSuccess(false);
      toast.error(`Tweet analysis error: ${error.message}`, { position: 'top-center' });
    } finally {
      setIsAnalyzing(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  const handleNavigateToToken = (slug) => {
    if (!slug || typeof slug !== 'string' || slug.trim() === '') {
      console.error('Invalid slug:', { slug });
      toast.error('Cannot navigate to token page: Invalid token ID.', { position: 'top-center', autoClose: 3000 });
      return;
    }
    router.push(`/token/${slug}`, undefined, { shallow: true });
    setActiveTab('market');
  };

  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    try {
      await signIn('email', { email, callbackUrl: '/dashboard' });
      toast.success('Sign-in email sent, please check your inbox!', { position: 'top-center' });
    } catch {
      setError('Failed to sign in with email. Please try again.');
      toast.error('Failed to sign in with email.', { position: 'top-center' });
    }
  };

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
    <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} handleSignOut={handleSignOut} />
      <main className="flex-1 flex items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full h-full flex items-center justify-center"
        >
          {activeTab === 'market' && <MarketTab recaptchaRef={recaptchaRef} toast={toast} onTokenSelect={handleNavigateToToken} />}
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
          {activeTab === 'watchlists' && <WatchlistsTab toast={toast} />}
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
  );
}