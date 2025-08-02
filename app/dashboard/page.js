// app/dashboard/page.js
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { signIn, signOut, useSession, getProviders } from 'next-auth/react';
import Header from '../../components/Header';
import LeaderboardTab from '../../components/LeaderboardTab';
import PointTab from '../../components/PointTab';
import AITab from '../../components/AITab';
import TaskTab from '../../components/TaskTab';
import ProfileTab from '../../components/ProfileTab';
import MarketTab from '../../components/MarketTab';
import TreemapTab from '../../components/TreemapTab';
import WatchlistsTab from '../../components/WatchlistsTab';
import { motion } from 'framer-motion';
import ReCAPTCHA from 'react-google-recaptcha';
import { toast } from 'react-toastify';
import MatrixHoverEffect from '../../components/MatrixHoverEffect';
import styles from './page.module.css';
import Image from 'next/image';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

// Register GSAP plugins
gsap.registerPlugin(MotionPathPlugin);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function Dashboard() {
  const { data: session, status } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('leaderboard');
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
  const recaptchaRef = useRef(null);
  const starsBackgroundRef = useRef(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch providers for sign-in options
  useEffect(() => {
    async function fetchProviders() {
      const response = await getProviders();
      setProviders(response);
    }
    fetchProviders();
  }, []);

  // Shooting Star Effect
  useEffect(() => {
  if (!isMounted || status === 'authenticated' || !starsBackgroundRef.current) {
    console.log('Meteor effect not started: ', { isMounted, status, hasRef: !!starsBackgroundRef.current });
    return;
  }

  console.log('Starting meteor effect...');

  let meteorTimeout;

  const createMeteor = () => {
    console.log('Creating new meteor...');
    const meteorContainer = document.createElement('div');
    meteorContainer.className = styles['meteor-container'];
    starsBackgroundRef.current.appendChild(meteorContainer);

    const meteorHead = document.createElement('div');
    meteorHead.className = styles['meteor-head'];
    meteorContainer.appendChild(meteorHead);

    const meteorTail = document.createElement('div');
    meteorTail.className = styles['meteor-tail'];
    meteorContainer.appendChild(meteorTail);

    // Randomize starting position (top corners)
    const isFromRight = Math.random() > 0.5; // 50% chance to start from right
    const startX = isFromRight
      ? gsap.utils.random(70, 90) // Top-right corner (70–90% of viewport width)
      : gsap.utils.random(10, 30); // Top-left corner (10–30% of viewport width)
    const startY = -10; // Start above viewport
    const endX = isFromRight
      ? gsap.utils.random(10, 30) // Bottom-left corner
      : gsap.utils.random(70, 90); // Bottom-right corner
    const endY = 110; // End below viewport

    // Calculate angle for rotation
    const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI + 90;

    gsap.set(meteorContainer, {
      x: `${startX}vw`,
      y: `${startY}vh`,
      rotation: angle,
      opacity: 0,
      scale: 1,
      zIndex: 5,
    });

    const duration = gsap.utils.random(3, 5); // Slower duration (3–5 seconds)

    const meteorTl = gsap.timeline({
      onComplete: () => {
        console.log('Meteor animation completed, removing...');
        meteorContainer.remove();
        meteorTimeout = setTimeout(createMeteor, gsap.utils.random(10000, 20000));
      },
    });

    meteorTl
      .to(meteorContainer, {
        opacity: 1,
        duration: duration * 0.2,
        ease: 'power1.out',
      })
      .to(
        meteorContainer,
        {
          motionPath: {
            path: [
              { x: `${startX}vw`, y: `${startY}vh` },
              { x: `${endX}vw`, y: `${endY}vh` },
            ],
            curviness: 0.3,
          },
          opacity: 0,
          duration: duration * 0.8,
          ease: 'power1.in',
        },
        `<${duration * 0.2}`
      )
      .fromTo(
        meteorTail,
        { scaleY: 0, opacity: 0 },
        {
          scaleY: 1,
          opacity: 0.8,
          duration: duration * 0.3,
          ease: 'power1.out',
        },
        `<0`
      )
      .to(
        meteorTail,
        {
          scaleY: 0,
          opacity: 0,
          duration: duration * 0.7,
          ease: 'power1.in',
        },
        `>-0.1`
      );

    return meteorTl;
  };

  // Start first meteor after initial delay
  meteorTimeout = setTimeout(() => {
    console.log('Initializing first meteor...');
    createMeteor();
  }, gsap.utils.random(1000, 5000));

  return () => {
    console.log('Cleaning up meteor effect...');
    clearTimeout(meteorTimeout);
    if (starsBackgroundRef.current) {
      starsBackgroundRef.current.querySelectorAll(`.${styles['meteor-container']}`).forEach(el => el.remove());
    }
  };
}, [isMounted, status]);

  useEffect(() => {
    if (!isMounted || status !== 'authenticated') return;
    async function fetchTopPlayers() {
      setLoading(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(`${API_BASE_URL}/api/connect-data`, {
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Failed to fetch leaderboard data');
        setTopPlayers({
          rankings: result.rankings || [],
          creators: result.creators.map(player => ({
            ...player,
            points: player.tweet_points,
            profilePicture: player.profile_picture,
            googleName: player.google_name,
          })),
          aiRank: result.aiRank.map(player => ({
            ...player,
            points: player.ai_points,
            profilePicture: player.profile_picture,
            googleName: player.google_name,
          })),
        });
      } catch (err) {
        console.error('Error fetching leaderboard data:', err);
        setError(`Failed to fetch leaderboard data: ${err.message}`);
        setTopPlayers({ rankings: [], creators: [], aiRank: [] });
      } finally {
        setLoading(false);
      }
    }
    fetchTopPlayers();
  }, [isMounted, status]);

  useEffect(() => {
    if (!isMounted || !session?.user?.id) return;
    async function initUserData() {
      setLoading(true);
      try {
        if (!recaptchaRef.current) throw new Error('reCAPTCHA not initialized');
        let recaptchaToken = null;
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            await recaptchaRef.current.reset();
            recaptchaToken = await Promise.race([
              recaptchaRef.current.executeAsync(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 20000)),
            ]);
            if (recaptchaToken) break;
          } catch (err) {
            console.error('Error generating reCAPTCHA token:', err);
            if (attempt === 5) throw new Error('Failed to generate reCAPTCHA token after 5 attempts');
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
        if (!recaptchaToken) throw new Error('Failed to generate reCAPTCHA token');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(`${API_BASE_URL}/api/user?uid=${encodeURIComponent(session.user.id)}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Recaptcha-Token': recaptchaToken,
          },
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const result = await response.json();
        if (!response.ok) {
          if (result.detail?.includes('User not found')) {
            throw new Error('HTTP 404: User not found');
          }
          throw new Error(`${result.detail || 'Unknown error'}${result.errors ? `: ${result.errors.map(e => e.msg).join(', ')}` : ''} (HTTP ${response.status})`);
        }
        setUserData({
          ...result.user,
          profilePicture: result.user.profile_picture,
          googleName: result.user.google_name,
          tweetPoints: result.user.tweet_points,
          aiPoints: result.user.ai_points,
        });
      } catch (err) {
        console.error('Error fetching user data:', err);
        if (err.message.includes('HTTP 404')) {
          setError('User not found. Please sign in again.');
          await signOut({ redirect: false });
          router.push('/auth/signin');
        } else {
          setUserData(null);
          setError(`Failed to fetch user data: ${err.message}. Please try refreshing or contact support.`);
        }
      } finally {
        setLoading(false);
        if (recaptchaRef.current) recaptchaRef.current.reset();
      }
    }
    initUserData();
  }, [isMounted, session, router]);

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
    } catch (err) {
      console.error('Wallet verification error:', err);
      setError(`Wallet verification error: ${err.message}`);
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
    } catch (error) {
      console.error('Sign out error:', error);
      setError('Failed to sign out.');
    }
  };

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
    } catch (error) {
      console.error('Tweet analysis error:', error);
      setError(`Tweet analysis error: ${error.message}`);
      setLastAnalysisSuccess(false);
    } finally {
      setIsAnalyzing(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  const handleNavigateToToken = (slug) => {
    if (!slug || typeof slug !== 'string' || slug.trim() === '') {
      console.error('Invalid slug provided for navigation:', { slug });
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
    } catch {
      setError('Failed to sign in with email. Please try again.');
    }
  };

  if (!isMounted || !providers) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <p>Loading...</p>
      </div>
    );
  }



  if (status === 'unauthenticated') {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className={`h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-jetbrains relative ${styles['container']}`}
    >
      {/* Animated Background with Stars */}
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

      {/* Logo in Top-Left Corner */}
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

      {/* Login Card */}
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

      {/* reCAPTCHA Notice */}
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
          {activeTab === 'market' && <MarketTab recaptchaRef={recaptchaRef} onTokenSelect={handleNavigateToToken} />}
          {activeTab === 'ai' && <AITab recaptchaRef={recaptchaRef} />}
          {activeTab === 'leaderboard' && (
            <LeaderboardTab
              topPlayers={topPlayers}
              loading={loading}
              error={error}
              recaptchaRef={recaptchaRef}
            />
          )}
          {activeTab === 'point' && (
            <PointTab
              userData={userData}
              loading={loading}
              error={error}
              handleAnalyzeTweets={handleAnalyzeTweets}
              isAnalyzing={isAnalyzing}
              recaptchaRef={recaptchaRef}
            />
          )}
          {activeTab === 'task' && <TaskTab recaptchaRef={recaptchaRef} />}
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
    </div>
  );
}