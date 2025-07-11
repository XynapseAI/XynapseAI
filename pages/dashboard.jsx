'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import Head from 'next/head';
import { signIn, signOut, useSession } from 'next-auth/react';
import Header from '../components/Header';
import LeaderboardTab from '../components/LeaderboardTab';
import PointTab from '../components/PointTab';
import AITab from '../components/AITab';
import TaskTab from '../components/TaskTab';
import ProfileTab from '../components/ProfileTab';
import MarketTab from '../components/MarketTab';
import TreemapTab from '../components/TreemapTab';
import { motion } from 'framer-motion';
import ReCAPTCHA from 'react-google-recaptcha';
import Link from 'next/link';
import MatrixHoverEffect from '../components/MatrixHoverEffect';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function Dashboard() {
  const { data: session, status } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [topPlayers, setTopPlayers] = useState({ rankings: [], creators: [], aiRank: [] });
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysisSuccess, setLastAnalysisSuccess] = useState(false);
  const recaptchaRef = useRef(null);

  // Initialize component
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch top players data
  useEffect(() => {
    if (!isMounted) return;
    async function fetchTopPlayers() {
      setLoading(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
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
              recaptchaRef.current.executeAsync({ action: 'get_user' }),
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
          window.location.href = '/auth/signin';
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
  }, [isMounted, session]);

  const handleConnectWallet = async () => {
    try {
      if (!session?.user) throw new Error('Not signed in with Twitter');
      if (!isConnected || !address) throw new Error('Wallet not connected');
      if (!recaptchaRef.current) throw new Error('reCAPTCHA not ready');
      const recaptchaToken = await recaptchaRef.current.executeAsync({ action: 'verify_wallet' });
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
      const recaptchaToken = await recaptchaRef.current.executeAsync({ action: 'analyze_tweets' });
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

  if (!isMounted) return null;

  if (status === 'unauthenticated') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-jetbrains">
        <Head>
          <title>Dashboard - Sign In</title>
          <meta name="description" content="Sign in with Twitter to access the dashboard" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
          <link
            href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap"
            rel="stylesheet"
          />
        </Head>
        <div className="p-8 bg-tech backdrop-blur-md border border-white/10 rounded-xl shadow-card text-center">
          <h1 className="text-3xl font-bold text-white mb-6 uppercase">
            Welcome to the Dashboard
          </h1>
          <p className="mb-6 text-sm text-gray-500">
            Sign in with Twitter to get started.
          </p>
          <button
            onClick={handleSignInTwitter}
            className="px-6 py-3 border border-2 border-white text-white rounded-full text-sm font-medium transition-all duration-300 uppercase"
          >
            <MatrixHoverEffect text="Sign in with Twitter" hoverColor="#00BFFF" />
          </button>
        </div>
        <style jsx>{`
          .shadow-card {
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
          }
          .bg-tech {
            background: linear-gradient(135deg, rgba(17, 24, 39, 0.8), rgba(0, 0, 0, 0.9));
          }
          .grecaptcha-badge {
            visibility: hidden !important;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
      <Head>
        <title>Dashboard</title>
        <meta name="description" content="Manage wallet, points, and interactions" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </Head>
      <Header activeTab={activeTab} setActiveTab={setActiveTab} handleSignOut={handleSignOut} />
      <main className="flex-1 flex items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full h-full flex items-center justify-center"
        >
          {activeTab === 'market' && <MarketTab recaptchaRef={recaptchaRef} />}
          {activeTab === 'ai' && <AITab recaptchaRef={recaptchaRef} />}
          {activeTab === 'leaderboard' && (
            <LeaderboardTab topPlayers={topPlayers} loading={loading} error={error} recaptchaRef={recaptchaRef} />
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
          {activeTab === 'treemap' && (
            <TreemapTab recaptchaRef={recaptchaRef} />
          )}
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