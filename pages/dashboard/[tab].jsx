// pages/dashboard/[tab].jsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import Head from 'next/head';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Header from '../../components/Header';
import LeaderboardTab from '../../components/LeaderboardTab';
import PointTab from '../../components/PointTab';
import AITab from '../../components/AITab';
import TaskTab from '../../components/TaskTab';
import ProfileTab from '../../components/ProfileTab';
import MarketTab from '../../components/MarketTab';
import TreemapTab from '../../components/TreemapTab';
import { motion, AnimatePresence } from 'framer-motion';
import ReCAPTCHA from 'react-google-recaptcha';
import MatrixHoverEffect from '../../components/MatrixHoverEffect';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.xynapseai.net';

export default function DashboardTab() {
  const { data: session, status } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const { tab } = router.query;
  const [activeTab, setActiveTab] = useState(tab || 'leaderboard');
  const [topPlayers, setTopPlayers] = useState({ rankings: [], creators: [], aiRank: [] });
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysisSuccess, setLastAnalysisSuccess] = useState(false);
  const recaptchaRef = useRef(null);

  const validTabs = ['leaderboard', 'point', 'ai', 'task', 'profile', 'market', 'treemap'];

  // Initialize component
  useEffect(() => {
    setIsMounted(true);
    if (tab && validTabs.includes(tab)) {
      setActiveTab(tab);
    } else if (tab) {
      router.replace('/dashboard/leaderboard');
    }
  }, [tab, router]);

  // Fetch top players data
  useEffect(() => {
    if (!isMounted) return;
    async function fetchTopPlayers() {
      setLoading(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(`${API_BASE_URL}/connect-data`, {
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
        setError(`Failed to fetch leaderboard data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    fetchTopPlayers();
  }, [isMounted]);

  // Fetch user data
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
            if (attempt === 5) throw new Error('Failed to generate reCAPTCHA token after 5 attempts');
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
        if (!recaptchaToken) throw new Error('Failed to generate reCAPTCHA token');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${API_BASE_URL}/user?uid=${encodeURIComponent(session.user.id)}`, {
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
          throw new Error(`${result.detail || 'Unknown error'}${result.errors ? `: ${result.errors.map(e => e.msg).join(', ')}` : ''} (HTTP ${response.status})`);
        }
        setUserData(result.user);
      } catch (err) {
        console.error('Error fetching user data:', err);
        setError(`Failed to fetch user data: ${err.message}. Please try refreshing or contact support.`);
      } finally {
        setLoading(false);
        if (recaptchaRef.current) recaptchaRef.current.reset();
      }
    }
    initUserData();
  }, [isMounted, session]);

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
      const response = await fetch(`${API_BASE_URL}/verify-wallet`, {
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
      await signIn('twitter', { callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/leaderboard` });
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
      const response = await fetch(`${API_BASE_URL}/analyze-tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ uid: session.user.id, recaptchaToken }),
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

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    router.push(`/dashboard/${newTab}`);
  };

  if (!isMounted) return null;

  if (status === 'unauthenticated') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-jetbrains relative"
      >
        <Head>
          <title>Dashboard - Sign In</title>
          <meta name="description" content="Sign in with Twitter to access the dashboard" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
          <link
            href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
            rel="stylesheet"
          />
        </Head>
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800"
          animate={{
            background: [
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(0, 191, 255, 0.1))',
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
            ],
          }}
          transition={{ duration: 15, repeat: Infinity, repeatType: 'reverse' }}
        >
          <div className="absolute inset-0 stars-layer-1" />
          <div className="absolute inset-0 stars-layer-2" />
          <div className="absolute inset-0 stars-layer-3" />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="relative z-10 bg-gray-900/30 backdrop-blur-lg p-6 md:p-8 rounded-2xl border border-white/10 shadow-glow-neon max-w-md w-full mx-4"
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
              className="text-[10px] md:text-sm text-gray-400 mb-6"
            >
              Sign in with Twitter to access your profile and manage your account.
            </motion.p>
            <motion.button
              onClick={handleSignInTwitter}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-full px-6 py-3 bg-gray-900/50 border border-neon-blue text-neon-blue rounded-full text-[10px] md:text-sm font-medium uppercase shadow-glow-neon hover:bg-neon-blue/20 transition-all duration-300"
            >
              <MatrixHoverEffect text="Sign in with Twitter" hoverColor="#00BFFF" />
            </motion.button>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                className="mt-4 text-red-400 text-[10px] md:text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center shadow-glow-neon-red"
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
          className="absolute bottom-2 left-2 text-[9px] md:text-[10px] text-gray-600 z-10"
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
        <style jsx>{`
          .shadow-glow-neon {
            box-shadow: 0 0 8px rgba(255, 255, 255, 0.3), 0 0 16px rgba(255, 255, 255, 0.1);
          }
          .shadow-glow-neon-red {
            box-shadow: 0 0 8px rgba(239, 68, 68, 0.3), 0 0 16px rgba(239, 68, 68, 0.1);
          }
          .stars-layer-1,
          .stars-layer-2,
          .stars-layer-3 {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: transparent;
            pointer-events: none;
          }
          .stars-layer-1 {
            background: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 800' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='200' cy='100' r='2' fill='rgba(255,255,255,0.4)'/%3E%3Ccircle cx='300' cy='600' r='1' fill='rgba(255,255,255,0.3)'/%3E%3Ccircle cx='500' cy='300' r='1.5' fill='rgba(255,255,255,0.5)'/%3E%3Ccircle cx='800' cy='500' r='2' fill='rgba(255,255,255,0.4)'/%3E%3Ccircle cx='1000' cy='200' r='1' fill='rgba(255,255,255,0.3)'/%3E%3C/svg%3E");
            animation: moveStars 100s linear infinite;
          }
          .stars-layer-2 {
            background: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 800' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='150' cy='400' r='1.5' fill='rgba(255,255,255,0.5)'/%3E%3Ccircle cx='400' cy='200' r='2' fill='rgba(255,255,255,0.4)'/%3E%3Ccircle cx='600' cy='700' r='1' fill='rgba(255,255,255,0.3)'/%3E%3Ccircle cx='900' cy='300' r='1.5' fill='rgba(255,255,255,0.5)'/%3E%3C/svg%3E");
            animation: moveStars 150s linear infinite;
          }
          .stars-layer-3 {
            background: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 800' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='250' cy='500' r='1' fill='rgba(255,255,255,0.3)'/%3E%3Ccircle cx='450' cy='100' r='1.5' fill='rgba(255,255,255,0.5)'/%3E%3Ccircle cx='700' cy='400' r='2' fill='rgba(255,255,255,0.4)'/%3E%3Ccircle cx='1100' cy='600' r='1' fill='rgba(255,255,255,0.3)'/%3E%3C/svg%3E");
            animation: moveStars 200s linear infinite;
          }
          @keyframes moveStars {
            0% { transform: translateY(0); }
            100% { transform: translateY(-1000px); }
          }
          .grecaptcha-badge {
            visibility: hidden !important;
          }
          @media (max-width: 640px) {
            .text-3xl { font-size: 1.5rem; }
            .text-2xl { font-size: 1.25rem; }
          }
        `}</style>
      </motion.div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
      <Head>
        <title>Dashboard - {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</title>
        <meta name="description" content={`Manage your ${activeTab} in the Xynapse dashboard`} />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </Head>
      <Header activeTab={activeTab} setActiveTab={handleTabChange} handleSignOut={handleSignOut} />
      <main className="flex-1 w-full overflow-hidden">
        <motion.div
          className="w-full h-full flex items-start justify-start"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <AnimatePresence mode="wait">
            {activeTab === 'market' && (
              <motion.div
                key="market"
                className="w-full"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3 }}
              >
                <MarketTab recaptchaRef={recaptchaRef} />
              </motion.div>
            )}
            {activeTab === 'ai' && (
              <motion.div
                key="ai"
                className="w-full"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3 }}
              >
                <AITab recaptchaRef={recaptchaRef} />
              </motion.div>
            )}
            {activeTab === 'leaderboard' && (
              <motion.div
                key="leaderboard"
                className="w-full"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3 }}
              >
                <LeaderboardTab topPlayers={topPlayers} loading={loading} error={error} recaptchaRef={recaptchaRef} />
              </motion.div>
            )}
            {activeTab === 'point' && (
              <motion.div
                key="point"
                className="w-full"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3 }}
              >
                <PointTab
                  userData={userData}
                  error={error}
                  loading={loading}
                  handleAnalyzeTweets={handleAnalyzeTweets}
                  isAnalyzing={isAnalyzing}
                  recaptchaRef={recaptchaRef}
                />
              </motion.div>
            )}
            {activeTab === 'task' && (
              <motion.div
                key="task"
                className="w-full"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3 }}
              >
                <TaskTab recaptchaRef={recaptchaRef} />
              </motion.div>
            )}
            {activeTab === 'profile' && (
              <motion.div
                key="profile"
                className="w-full"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3 }}
              >
                <ProfileTab
                  userData={userData}
                  loading={loading}
                  error={error}
                  isConnected={isConnected}
                  handleConnectWallet={handleConnectWallet}
                  recaptchaRef={recaptchaRef}
                />
              </motion.div>
            )}
            {activeTab === 'treemap' && (
              <motion.div
                key="treemap"
                className="w-full"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3 }}
              >
                <TreemapTab recaptchaRef={recaptchaRef} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>
      <ReCAPTCHA
        ref={recaptchaRef}
        sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
        size="invisible"
        badge="bottomright"
      />
      <p className="text-[9px] text-gray-600 ml-2">
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
      <style jsx>{`
        .grecaptcha-badge {
          z-index: 1000;
        }
      `}</style>
    </div>
  );
}