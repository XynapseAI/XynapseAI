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
import { LoadingOverlay } from '@/utils/helpers';
import { CurrencyProvider } from '../../components/CurrencyContext';

gsap.registerPlugin(MotionPathPlugin);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

// Custom hook to handle user data state and logic
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
      // Kiểm tra xem reCAPTCHA đã sẵn sàng chưa
      if (!recaptchaRef.current) {
        throw new Error('reCAPTCHA component is not initialized');
      }
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      if (!recaptchaToken) {
        throw new Error('Failed to obtain reCAPTCHA token');
      }
      const jwtToken = session?.accessToken;
      const response = await fetch(`${API_BASE_URL}/user?uid=${encodeURIComponent(session.user.id)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken,
          Authorization: `Bearer ${jwtToken}`,
        },
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setError('Session expired, please sign in again');
          return;
        }
        throw new Error(result.detail || 'Failed to fetch user data');
      }
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
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
    }
  }, [session, csrfToken]);

  const handleAnalyzeTweets = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      if (!session?.user || !csrfToken) throw new Error('Authentication or CSRF token missing');
      const recaptchaToken = process.env.NODE_ENV === 'development' ? 'development-token' : await recaptchaRef.current?.executeAsync();
      const jwtToken = session?.accessToken;
      const payload = { uid: session.user.id };
      const signature = crypto.createHmac("sha256", process.env.HMAC_SECRET || "default-secret")
        .update(JSON.stringify(payload, Object.keys(payload).sort()))
        .digest("hex");
      const response = await fetch(`${API_BASE_URL}/api/analyze-tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken,
          Authorization: `Bearer ${jwtToken}`,
          'X-HMAC-Signature': signature,
        },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setError('Session expired, please sign in again');
          return;
        }
        throw new Error(result.detail || 'Tweet analysis failed');
      }
      setUserData((prev) => (prev ? { ...prev, tweetPoints: result.tweet_points } : null));
      toast.success('Tweet analysis successful!', { position: 'top-center' });
    } catch (err) {
      console.error('Error analyzing tweet:', err);
      toast.error(`Tweet analysis error: ${err.message}`, { position: 'top-center' });
    } finally {
      setIsAnalyzing(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
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
  const recaptchaRef = useRef(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userData, loading, error, handleAnalyzeTweets } = useUserData(session, csrfToken, setIsAnalyzing);

  const fetchProvidersWithRetry = useCallback(async (retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await getProviders();
        setProviders(response);
        return;
      } catch (err) {
        console.error(`Attempt ${i + 1} failed to fetch providers: ${err.message}`);
        if (err.message.includes("IP banned") || err.status === 429) {
          toast.error("Too many requests. Please try again later.", { position: 'top-center' });
          return;
        }
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        toast.error('Failed to fetch sign-in methods.', { position: 'top-center' });
      }
    }
  }, []);

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
        const response = await fetch(`${API_BASE_URL}/auth/csrf`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.accessToken || ''}`,
          },
          credentials: 'include',
        });
        const result = await response.json();
        console.log('CSRF Token Response:', result); // Debug CSRF token
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

  useEffect(() => {
    if (isMounted && !providers) {
      fetchProvidersWithRetry();
    }
  }, [isMounted, providers, fetchProvidersWithRetry]);

  const handleConnectWallet = async () => {
    try {
      if (!session?.user || !isConnected || !address || !recaptchaRef.current) throw new Error('Prerequisites not met');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const message = `Sign this message to authenticate: ${address}`;
      const signature = await signMessageAsync({ message });
      const jwtToken = session?.accessToken;
      const payload = { walletAddress: address, signature, message, uid: session.user.id };
      const hmacSignature = crypto.createHmac("sha256", process.env.HMAC_SECRET || "default-secret")
        .update(JSON.stringify(payload, Object.keys(payload).sort()))
        .digest("hex");
      const response = await fetch(`${API_BASE_URL}/api/verify-wallet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken,
          Authorization: `Bearer ${jwtToken}`,
          'X-HMAC-Signature': hmacSignature,
        },
        body: JSON.stringify(payload),
        credentials: 'include',
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

  const handleSignOut = async () => {
    if (!session || !session.user?.id) {
      toast.error('Session expired. Please sign in again.', { position: 'top-center' });
      router.push('/dashboard');
      return;
    }

    try {
      let currentCsrfToken = csrfToken;
      if (!currentCsrfToken) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/auth/csrf`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.accessToken || ''}`,
            },
            credentials: 'include',
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.detail || 'Failed to fetch CSRF token');
          currentCsrfToken = result.csrfToken;
          setCsrfToken(result.csrfToken);
          await update({ csrfToken: result.csrfToken });
        } catch (csrfError) {
          console.error('Failed to fetch CSRF token:', csrfError);
          throw new Error('Cannot sign out: Missing CSRF token');
        }
      }

      try {
        await signOut({ redirect: false });
        await update();
      } catch (signOutError) {
        console.error('signOut fetch error:', signOutError);
        if (signOutError.message.includes('ClientFetchError')) {
          const response = await fetch('/api/auth/signout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': currentCsrfToken,
            },
            credentials: 'include',
            body: JSON.stringify({}),
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Manual signout failed');
          }
          await update();
        } else {
          throw signOutError;
        }
      }

      console.log('Client-side caches cleared');

      try {
        const token = await recaptchaRef.current?.executeAsync();
        const response = await fetch(`${API_BASE_URL}/api/clear-cache`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': currentCsrfToken,
            'X-Recaptcha-Token': token,
          },
          body: JSON.stringify({ cacheKeys: [`user:${session.user.id}`] }),
          credentials: 'include',
        });
        if (!response.ok) {
          const errorData = await response.json();
          console.warn('Failed to clear server-side cache:', errorData.detail || response.statusText);
        } else {
          console.log('Server-side cache cleared');
        }
      } catch (cacheErr) {
        console.warn('Failed to clear server-side cache:', cacheErr.message);
      }

      localStorage.removeItem('csrfToken');
      setCsrfToken(null);
      if (isConnected) {
        disconnect();
      }

      toast.success('Signed out successfully!', { position: 'top-center' });
      router.refresh();
      router.push('/dashboard');
    } catch (error) {
      console.error('Error during sign out process:', error);
      toast.error(`Failed to sign out: ${error.message}`, { position: 'top-center' });
      router.refresh();
      router.push('/dashboard');
    } finally {
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
    }
  };

  const handleNavigateToToken = useCallback((slug) => {
    if (!slug) {
      toast.error('Invalid token ID.', { position: 'top-center' });
      return;
    }
    router.push(`/dashboard?tab=market&token=${slug}`, { scroll: false });
    setActiveTab('market');
  }, [router]);

  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    try {
      await signIn('email', { email, callbackUrl: '/dashboard', redirect: false });
      toast.success('Sign-in email sent, please check your inbox!', { position: 'top-center' });
    } catch (err) {
      console.error('Error signing in with email:', err);
      toast.error('Failed to sign in with email.', { position: 'top-center' });
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const result = await signIn('google', { callbackUrl: '/dashboard', redirect: false });
      console.log('Google sign-in result:', result);
      if (result?.error) {
        if (result.error.includes('Rate limit exceeded')) {
          toast.error('Too many sign-in attempts. Please try again later.', { position: 'top-center' });
          return;
        }
        throw new Error(result.error);
      }
      if (!result?.url) {
        console.warn('No redirect URL provided by NextAuth, falling back to manual redirect');
        window.location.href = `${API_BASE_URL}/api/auth/signin/google`;
        return;
      }
      try {
        new URL(result.url);
        window.location.href = result.url;
      } catch (urlError) {
        console.error('Invalid URL in Google sign-in:', urlError, { url: result.url });
        window.location.href = `${API_BASE_URL}/api/auth/signin/google`;
      }
    } catch (err) {
      console.error('Error signing in with Google:', err);
      toast.error(`Failed to sign in with Google: ${err.message}`, { position: 'top-center' });
    }
  };

  if (!isMounted || !providers || status === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <LoadingOverlay
          isLoading={true}
          message="Loading dashboard..."
          isMobile={typeof window !== 'undefined' && window.innerWidth <= 640}
        />
      </div>
    );
  }

  const requiresAuth = ['profile', 'ai', 'watchlists'].includes(activeTab);
  const showLoginForm = status === 'unauthenticated' && requiresAuth;

  return (
    <CurrencyProvider>
      <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
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
            {showLoginForm ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className={`w-full h-full flex items-center justify-center bg-black/5 text-white font-saira relative ${styles.container}`}
              >
                <motion.div
                  ref={starsBackgroundRef}
                  className={`absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800 ${styles['stars-background']}`}
                  animate={{
                    background: [
                      'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
                      'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(180, 180, 180, 0.1))',
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
                  className={`absolute top-2 left-2 ${styles['logo-container']}`}
                >
                  <Image
                    src="/logos/logo-landscape.webp"
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
                  className={`relative z-10 bg-white/5 backdrop-blur-sm p-6 md:p-10 rounded-2xl border border-white/10 max-w-md w-full mx-4 flex flex-col items-center`}
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
                      className={`w-full px-4 py-3 bg-black/50 border border-white/10 rounded-full text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-neon-blue ${styles['input-glow']}`}
                      required
                    />
                    <button
                      type="submit"
                      className={`w-full px-4 py-3 border-2 border-white/10 bg-white/5 text-white rounded-full text-sm font-medium uppercase transition-all duration-300`}
                    >
                      <MatrixHoverEffect text="Sign in with Email" hoverColor="#FFFFFF" />
                    </button>
                  </form>
                  <div className="flex items-center justify-center my-4 w-full">
                    <span className="text-gray-500 text-xs uppercase">OR</span>
                  </div>
                  {providers?.google && (
                    <button
                      onClick={handleGoogleSignIn}
                      className={`w-full px-4 py-3 bg-black/10 border border-white/20 rounded-full text-white text-sm font-medium uppercase flex items-center justify-center gap-2 transition-all duration-300 hover:bg-gray-700/50 ${styles['button-glow']}`}
                    >
                      <Image
                        src="/logos/google.webp"
                        alt="Google Logo"
                        width={20}
                        height={20}
                        className="w-5 h-5 object-contain mr-2"
                      />
                      <MatrixHoverEffect text="Sign in with Google" />
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
              </motion.div>
            ) : (
              <>
                {activeTab === 'market' && (
                  <MarketTab
                    recaptchaRef={recaptchaRef}
                    toast={toast}
                    onTokenSelect={handleNavigateToToken}
                    initialTokenSlug={searchParams.get('token') || undefined}
                  />
                )}
                {activeTab === 'cluster' && (
                  <ClusterTab
                    recaptchaRef={recaptchaRef}
                    initialExchangeId={searchParams.get('exchangeId') || undefined}
                  />
                )}
                {activeTab === 'treemap' && <TreemapTab onTokenSelect={handleNavigateToToken} />}
                {activeTab === 'ai' && <AITab recaptchaRef={recaptchaRef} />}
                {activeTab === 'profile' && (
                  <ProfileTab
                    userData={userData}
                    loading={loading}
                    error={error}
                    isConnected={isConnected}
                    handleConnectWallet={handleConnectWallet}
                    recaptchaRef={recaptchaRef}
                    handleSignOut={handleSignOut}
                  />
                )}
                {activeTab === 'watchlists' && <WatchlistsTab toast={toast} initialAddress={selectedAddress} />}
              </>
            )}
          </motion.div>
        </main>
        {process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ? (
          <ReCAPTCHA
            ref={recaptchaRef}
            sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
            size="invisible"
            badge="bottomright"
            onError={() => {
              console.error('reCAPTCHA initialization failed');
              toast.error('Failed to initialize reCAPTCHA', { position: 'top-center' });
            }}
          />
        ) : (
          <p className="text-[8px] text-red-600 ml-2">
            Error: reCAPTCHA site key is missing. Please configure NEXT_PUBLIC_RECAPTCHA_SITE_KEY.
          </p>
        )}
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