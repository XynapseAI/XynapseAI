// pages/dashboard.jsx
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
import { motion } from 'framer-motion';
import ReCAPTCHA from 'react-google-recaptcha';
import { logger } from '../utils/logger';
import Link from 'next/link';
import MatrixHoverEffect from '../components/MatrixHoverEffect';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function Dashboard() {
  const { data: session, status } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [topPlayers, setTopPlayers] = useState([]);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysisSuccess, setLastAnalysisSuccess] = useState(false);
  const recaptchaRef = useRef(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch top players (Leaderboard)
  useEffect(() => {
    if (!isMounted) return;
    async function fetchTopPlayers() {
      setLoading(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch('/api/connect-data', { signal: controller.signal });
        clearTimeout(timeoutId);
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Lỗi tải danh sách người chơi');
        logger.info('Fetched top players:', result);
        setTopPlayers(result || {});
      } catch (err) {
        logger.error('Lỗi lấy danh sách người chơi:', {
          message: err.message,
          stack: err.stack,
        });
        setError(`Không thể tải danh sách người chơi: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    fetchTopPlayers();
  }, [isMounted]);

  // Initialize user data
  useEffect(() => {
    if (!isMounted || !session?.user?.id || userData) return;
    async function initUserData() {
      setLoading(true);
      try {
        if (!recaptchaRef.current) throw new Error('reCAPTCHA chưa được khởi tạo');
        let recaptchaToken = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            recaptchaToken = await recaptchaRef.current.executeAsync();
            logger.info(`Tạo token reCAPTCHA (lần ${attempt}): ${recaptchaToken ? 'success' : 'failed'}`);
            if (recaptchaToken) break;
          } catch (err) {
            logger.warn(`Lỗi tạo token reCAPTCHA (lần ${attempt}):`, {
              message: err.message,
              stack: err.stack,
            });
            if (attempt === 3) throw new Error('Không thể tạo token reCAPTCHA sau 3 lần thử');
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        if (!recaptchaToken) throw new Error('Không thể tạo token reCAPTCHA');

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
          const errorDetail = result.detail || 'Lỗi không xác định';
          const errorMessages = result.errors?.map((e) => e.msg).join(', ') || '';
          throw new Error(`${errorDetail}${errorMessages ? `: ${errorMessages}` : ''} (HTTP ${response.status})`);
        }
        logger.info('Khởi tạo dữ liệu người dùng:', { user: result.user });
        setUserData(result.user);
      } catch (err) {
        logger.error('Lỗi khởi tạo dữ liệu người dùng:', {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });
        if (err.message.includes('HTTP 404')) {
          setError('Không tìm thấy người dùng. Đang đăng xuất và chuyển hướng đến trang đăng nhập...');
          await signOut({ redirect: false });
          window.location.href = '/auth/signin';
        } else {
          setError(`Không thể tải dữ liệu người dùng: ${err.message}`);
        }
      } finally {
        setLoading(false);
        if (recaptchaRef.current) recaptchaRef.current.reset();
      }
    }
    initUserData();
  }, [isMounted, session, userData]);

  // Handle wallet verification
  const handleConnectWallet = async () => {
    try {
      if (!session?.user) throw new Error('Chưa đăng nhập Twitter');
      if (!isConnected || !address) throw new Error('Ví chưa được kết nối');
      if (!recaptchaRef.current) throw new Error('reCAPTCHA chưa sẵn sàng');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      logger.info('Tạo token reCAPTCHA cho verify wallet:', { token: recaptchaToken ? 'success' : 'failed' });
      const message = `Sign this message to authenticate: ${address}`;
      logger.info('Ký message:', { message });
      const signature = await signMessageAsync({ message });
      logger.info('Chữ ký:', { signature });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${API_BASE_URL}/verify-wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Recaptcha-Token': recaptchaToken },
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
      if (!response.ok) throw new Error(result.detail || 'Lỗi xác minh ví');
      logger.info('Kết quả xác minh ví:', { result });
      setError(null);
      setUserData((prev) => ({
        ...prev,
        walletAddress: address,
      }));
    } catch (err) {
      logger.error('Lỗi xác minh ví:', {
        message: err.message,
        stack: err.stack,
      });
      setError(`Lỗi xác minh ví: ${err.message}`);
    } finally {
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  // Handle Twitter sign-in
  const handleSignInTwitter = async () => {
    try {
      logger.info('Bắt đầu đăng nhập Twitter');
      await signIn('twitter', { callbackUrl: '/dashboard' });
    } catch (error) {
      logger.error('Lỗi đăng nhập Twitter:', {
        message: error.message,
        stack: error.stack,
      });
      setError(`Không thể đăng nhập Twitter: ${error.message || 'Lỗi hệ thống'}`);
    }
  };

  // Handle sign-out
  const handleSignOut = async () => {
    try {
      await signOut({ callbackUrl: '/' });
      if (isConnected) disconnect();
      setUserData(null);
      setError(null);
      logger.info('Đăng xuất thành công');
    } catch (error) {
      logger.error('Lỗi đăng xuất:', {
        message: error.message,
        stack: error.stack,
      });
      setError('Không thể đăng xuất.');
    }
  };

  // Analyze tweets
  const handleAnalyzeTweets = async () => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      if (!session?.user) throw new Error('Chưa đăng nhập');
      if (!recaptchaRef.current) throw new Error('reCAPTCHA chưa sẵn sàng');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      logger.info('Tạo token reCAPTCHA cho analyze tweets:', { token: recaptchaToken ? 'success' : 'failed' });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${API_BASE_URL}/analyze-tweets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Recaptcha-Token': recaptchaToken },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ uid: session.user.id, recaptchaToken }),
      });
      clearTimeout(timeoutId);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Lỗi phân tích tweet');
      logger.info('Kết quả phân tích tweet:', { result });
      setUserData((prev) => (prev ? { ...prev, points: result.points } : null));
      setError(null);
      setLastAnalysisSuccess(true);
    } catch (error) {
      logger.error('Lỗi phân tích tweet:', {
        message: error.message,
        stack: error.stack,
      });
      setError(`Lỗi phân tích tweet: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  if (!isMounted) return null;

  if (status === 'unauthenticated') {
    return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-courier">
      <Head>
        <title>Dashboard - Đăng Nhập</title>
        <meta name="description" content="Đăng nhập bằng Twitter để truy cập dashboard" />
        <link
          href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <div className="p-8 bg-tech backdrop-blur-md border border-white/10 rounded-xl shadow-card text-center">
        <h1 className="text-3xl font-bold text-white mb-6 uppercase">
          Chào Mừng Đến Với Dashboard
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          Đăng nhập bằng Twitter để bắt đầu.
        </p>
        <button
          onClick={handleSignInTwitter}
          className="px-6 py-3 border border-2 border-white text-white rounded-full text-sm font-medium transition-all duration-300 uppercase"
        >
          <MatrixHoverEffect text="Đăng Nhập Twitter" hoverColor="#00BFFF" />
        </button>
      </div>

      <style jsx>{`
        .shadow-card {
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
        }
        .bg-tech {
          background: linear-gradient(135deg, rgba(17, 24, 39, 0.8), rgba(0, 0, 0, 0.9));
        }
      `}</style>
    </div>
  );
  }

  return (
    <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
      <Head>
        <title>Dashboard</title>
        <meta name="description" content="Quản lý ví, điểm số và tương tác" />
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
        </motion.div>
      </main>
      <ReCAPTCHA
        ref={recaptchaRef}
        sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
        size="invisible"
        badge="bottomright"
      />
    </div>
  );
}