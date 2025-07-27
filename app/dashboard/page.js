// app/dashboard/page.js
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { signIn, signOut, useSession } from 'next-auth/react';
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
  const [ setLastAnalysisSuccess] = useState(false);
  const recaptchaRef = useRef(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    async function fetchTopPlayers() {
      setLoading(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const response = await fetch('/api/connect-data', {
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
          creators: result.creators || [],
          aiRank: result.aiRank || [],
        });
      } catch (err) {
        console.error('Error fetching leaderboard data:', err);
        setTopPlayers({ rankings: [], creators: [], aiRank: [] });
      } finally {
        setLoading(false);
      }
    }
    fetchTopPlayers();
  }, [isMounted]);

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
              new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 60000)),
            ]);
            if (recaptchaToken) break;
          } catch (err) {
            console.error('Error fetching leaderboard data:', err);
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
        setUserData(result.user);
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
      if (!session?.user) throw new Error('Not signed in with Twitter');
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

  const handleSignInTwitter = async () => {
    try {
      await signIn('twitter', { callbackUrl: '/dashboard' });
    } catch (error) {
      console.error('Twitter sign-in error:', error);
      setError(`Failed to sign in with Twitter: ${error.message || 'System error'}`);
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
      setUserData((prev) => (prev ? { ...prev, points: result.points } : null));
      setError(null);
      setLastAnalysisSuccess(true);
    } catch (error) {
      console.error('Tweet analysis error:', error);
      setError(`Tweet analysis error: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  // Hàm xử lý chọn token
  const handleNavigateToToken = (slug) => {
    if (!slug || typeof slug !== 'string' || slug.trim() === '') {
      console.error('Invalid slug provided for navigation:', { slug });
      toast.error('Cannot navigate to token page: Invalid token ID.', { position: 'top-center', autoClose: 3000 });
      return;
    }
    // Cập nhật URL và đảm bảo tab Market được chọn
    router.push(`/token/${slug}`, undefined, { shallow: true });
    setActiveTab('market'); // Chuyển sang tab Market
  };

  if (!isMounted) return null;

  if (status === 'unauthenticated') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className={`h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-jetbrains relative ${styles['container']}`}
      >
        <motion.div
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
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className={`relative z-10 bg-gray-900/30 backdrop-blur-lg p-6 md:p-8 rounded-2xl border border-white/10 ${styles['shadow-glow-neon']} max-w-md w-full mx-4`}
        >
          <div className="text-center">
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-2xl md:text-3xl font-bold text-white uppercase mb-4"
            >
              Welcome to the Dashboard
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="text-[14px] md:text-sm text-gray-400 mb-6"
            >
              Sign in with Twitter to access your profile and manage your account.
            </motion.p>
            <motion.button
              onClick={handleSignInTwitter}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`w-full px-6 py-3 bg-gray-900/50 border border-neon-blue text-neon-blue rounded-full text-[14px] md:text-sm font-medium uppercase ${styles['shadow-glow-neon']} hover:bg-neon-blue/20 transition-all duration-300`}
            >
              <MatrixHoverEffect text="Sign in with Twitter" hoverColor="#00BFFF" />
            </motion.button>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                className={`mt-4 text-red-400 text-[14px] md:text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center ${styles['shadow-glow-neon-red']}`}
              >
                Error: {error}
              </motion.div>
            )}
          </div>
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="absolute bottom-2 left-2 text-[14px] text-gray-600 z-10"
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
              error={error}
              loading={loading}
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