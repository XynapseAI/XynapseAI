// components/ProfileTab.jsx
'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Trophy, Award, Flame, User, Crown, Calendar, Info, Check, Coins, Shield, Users, Eye, EyeOff, RefreshCw, Copy, Wallet } from 'lucide-react'; // Add Copy, Wallet icons
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts';
import { ethers } from 'ethers';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { cacheData, getCachedData, clearCache, clearAllCaches } from '../utils/indexedDB';
import { LoadingOverlay } from '@/utils/helpers';
import { debounce } from 'lodash';
import LoginPrompt from './LoginPrompt';
import ReCAPTCHA from 'react-google-recaptcha';
import { logger } from '../utils/clientLogger';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
// Enhanced Spinner component - Accepts className and color props for flexibility
const Spinner = ({ className = "h-4 w-4", color = "text-blue-400" }) => (
  <svg className={`animate-spin ${className} ${color}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);
// Blinking Dots component for loading states
const BlinkingDots = () => (
  <div className="flex items-center gap-0.5">
    <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce"></span>
    <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
    <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
  </div>
);
/*
const DailyCheckinBar = ({ last7Days, streak, onCheckin, isLoading, userData, twitterConnected }) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayIndex = new Date().getDay();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const getDayIndex = (index) => {
    const daysBack = 6 - index;
    return (todayIndex - daysBack + 7) % 7;
  };
  const isTodayChecked = last7Days[last7Days.length - 1];
  const handleCheckinClick = () => {
    if (!twitterConnected) {
      toast.info('Please connect your X (Twitter) account first to unlock check-in.', { position: 'top-center', autoClose: 4000 });
      return;
    }
    onCheckin();
  };
  return (
    <div className="relative w-full bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-xl p-3 mb-2 shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
      <div className="relative z-20 flex justify-between items-center mb-3">
        <div className="flex items-center gap-1">
          <Calendar className="w-4 h-4 text-[#00FFFF]" />
          <h3 className="text-[#FFF] font-bold text-[12px]">Daily Check-in</h3>
        </div>
        <div className="relative">
          <Info
            className="w-4 h-4 text-[#D4D4D4] cursor-help"
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
          />
          {tooltipVisible && (
            <div className="absolute top-full right-0 mt-1 p-2 bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] rounded-lg text-[10px] sm:text-[11px] text-[#D4D4D4] z-80 w-48 shadow-2xl">
              Maintain a 7-day streak to earn double points (20 pts/day) and unlock exclusive rewards! Breaking the streak resets to normal (10 pts).
            </div>
          )}
        </div>
      </div>
      <div className="relative z-20 flex justify-around items-center">
        {last7Days.map((checked, index) => {
          const dayIndex = getDayIndex(index);
          return (
            <div key={index} className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold transition-all duration-300 ${checked
                ? 'bg-gradient-to-r from-[#FFF] to-[#D4D4D4] text-[#0A0A0A] shadow-lg shadow-[#D4D4D4]/25'
                : 'bg-[#FFFFFF]/10 text-[#FFF]/50 border border-[#FFFFFF20]'
                }`}>
                {checked ? (
                  <Check className="w-3 h-3 text-[#0A0A0A]" />
                ) : (
                  days[dayIndex]
                )}
              </div>
              {index === last7Days.length - 1 && !checked && (
                <motion.button
                  onClick={handleCheckinClick}
                  disabled={isLoading || !twitterConnected}
                  className={`mt-1 px-2 py-1 rounded-full text-[9px] font-semibold transition-all duration-300 flex items-center justify-center gap-1 ${isLoading || !twitterConnected
                    ? 'bg-[#FFFFFF]/10 text-[#FFF]/70 cursor-not-allowed relative overflow-hidden border border-[#FFFFFF20]'
                    : 'bg-[#0A0A0A]/80 border border-[#FFFFFF] text-[#FFF] hover:from-[#00FFFF]/20 hover:to-emerald-400/20 shadow-lg shadow-[#00FFFF]/25'
                    }`}
                  whileHover={{ scale: (isLoading || !twitterConnected) ? 1 : 1 }}
                  whileTap={{ scale: (isLoading || !twitterConnected) ? 1 : 1 }}
                >
                  {isLoading ? (
                    <BlinkingDots />
                  ) : !twitterConnected ? (
                    'Connect Twitter'
                  ) : (
                    'Check-in'
                  )}
                  {(isLoading || !twitterConnected) && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#FFFFFF]/10 to-transparent animate-shimmer"></div>
                  )}
                </motion.button>
              )}
            </div>
          );
        })}
      </div>
      {streak >= 7 && (
        <div className="relative z-20 flex items-center justify-center mt-3 gap-1">
          <Flame className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span className="text-emerald-400 font-bold text-sm">Streak: {streak} days - Double Points Active!</span>
        </div>
      )}
    </div>
  );
};
*/
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <motion.div
        className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] p-3 rounded-2xl text-[#FFF] text-sm font-medium shadow-2xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <p className="text-[#D4D4D4] text-xs mb-1">{label}</p>
        <p className="text-[#FFF] font-semibold">
          Points: <span className="text-emerald-400">{payload[0].value}</span>
        </p>
      </motion.div>
    );
  }
  return null;
};
export default function ProfileTab({ recaptchaRef, handleSignOut }) {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 640);
  const [activeTab, setActiveTab] = useState('profile');
  const [currentPage, setCurrentPage] = useState({ leaderboard: 1 });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [followedTasks, setFollowedTasks] = useState(new Set());
  const [immediateLoading, setImmediateLoading] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showV2Modal, setShowV2Modal] = useState(false);
  const [pendingTask, setPendingTask] = useState(null);
  const [showWallet, setShowWallet] = useState(false); // Add state for wallet display
  const recaptchaV2Ref = useRef(null);
  const itemsPerPage = 20;
  const { data: csrfToken, isLoading: csrfLoading, error: csrfError } = useQuery({
    queryKey: ['csrfToken'],
    queryFn: async () => {
      const response = await axios.get('/api/csrf-token', { withCredentials: true });
      if (!response.data.csrfToken) throw new Error('Empty CSRF token received');
      return response.data.csrfToken;
    },
    retry: 3,
    retryDelay: 2000,
    enabled: status === 'authenticated',
    onError: (err) => {
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Error fetching CSRF token:', err);
      }
      toast.error('Unable to initialize session security. Please refresh the page and try again.', {
        position: 'top-center',
        autoClose: 5000,
      });
    },
  });
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      console.log = () => { };
      console.error = () => { };
      console.warn = () => { };
    }
  }, []);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.addEventListener('resize', handleResize);
  }, []);
  const onSignOut = async () => {
    setIsSigningOut(true);
    await handleSignOut();
    setIsSigningOut(false);
  };
  /*
  const handleFollow = (taskId) => {
    const followUrl = `https://x.com/intent/follow?screen_name=XynapseAI`;
    window.open(followUrl, '_blank');
    setFollowedTasks(prev => new Set([...prev, taskId]));
    toast.info('Redirecting to X. Please follow @XynapseAI and return to verify your action.', {
      position: 'top-center',
      autoClose: 6000
    });
  };
  */
  let isExecuting = false;
  const debouncedExecuteRecaptcha = useCallback(
    async (action, retries = 3) => {
      if (!recaptchaRef.current) {
        if (process.env.NODE_ENV !== 'production') {
          logger.error('reCAPTCHA ref is null');
        }
        throw new Error('reCAPTCHA not initialized');
      }
      for (let i = 0; i < retries; i++) {
        try {
          await recaptchaRef.current.reset();
          const token = await Promise.race([
            recaptchaRef.current.executeAsync(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 20000)),
          ]);
          if (!token) throw new Error('Empty reCAPTCHA token');
          return token;
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') {
            logger.error(`reCAPTCHA attempt ${i + 1} failed for ${action}: ${error.message}`);
          }
          if (i === retries - 1) {
            throw new Error(`reCAPTCHA failed after ${retries} attempts: ${error.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    },
    [recaptchaRef]
  );
  /*
  const verifyTaskMutation = useMutation({
    mutationFn: async ({ task, v2Token }) => {
      if (task.task_type === 'follow') {
        await new Promise(resolve => setTimeout(resolve, 5500));
      }
      const token = v2Token || await debouncedExecuteRecaptcha('verify_task');
      const response = await axios.post(
        '/api/twitter/verify-task',
        { taskId: task.id, userId: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
          withCredentials: true,
        }
      );
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to verify task');
      return response.data;
    },
    onSuccess: async (data, variables) => {
      const task = variables.task;
      toast.success(`${task.description} verified successfully! You've earned ${data.pointsEarned} points.`, {
        position: 'top-center',
        autoClose: 5000
      });
      const userCacheKey = `userData-${session.user.id}`;
      const progressCacheKey = `taskProgress-${session.user.id}`;
      await Promise.all([
        clearCache(userCacheKey),
        clearCache(progressCacheKey),
      ]);
      await Promise.all([
        queryClient.invalidateQueries(['taskProgress', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
      ]);
      await Promise.all([
        queryClient.refetchQueries(['taskProgress', session?.user?.id, csrfToken]),
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
      ]);
    },
    onError: (err, variables) => {
      const task = variables?.task || { task_type: 'unknown' };
      if (err.response?.status === 403 && err.response.data.detail === 'low_score_fallback') {
        setPendingTask(task);
        setShowV2Modal(true);
        toast.info('Please verify you are human to complete this action.', { position: 'top-center', autoClose: 4000 });
        return;
      }
      const detail = err.response?.data?.detail;
      let errorMessage = `Verification unsuccessful for ${task.description || 'this task'}. Please try again.`;
      if (err.response?.status === 429) {
        errorMessage = 'X (Twitter) rate limit exceeded. Please wait 1-2 minutes and try again.';
      } else if (err.response?.status === 403) {
        if (detail === 'Invalid CSRF check.') {
          errorMessage = 'Session security issue detected. Please refresh the page and try again.';
        } else if (detail?.includes('reCAPTCHA')) {
          errorMessage = 'Security verification failed. Please try the action again. If it persists , try another browser.';
        } else {
          errorMessage = 'Security verification failed. Please try the action again. If it persists, refresh the page.';
        }
      } else if (detail === 'Task already completed today') {
        errorMessage = `You've already completed today's ${task.task_type === 'daily_checkin' ? 'check-in' : 'task'}! Come back tomorrow.`;
      } else if (detail === 'Maximum completions reached') {
        errorMessage = `You've already completed this ${task.task_type === 'follow' ? 'follow' : 'task'}! Thanks for your support—explore other tasks for more rewards.`;
      } else if (detail === 'X (Twitter) account not connected') {
        errorMessage = 'Please connect your X (Twitter) account first to verify this task. Head to your profile to get started!';
      } else if (err.message.includes('reCAPTCHA')) {
        errorMessage = 'Verification challenge failed. Please complete the security check and retry.';
      } else if (detail?.includes('Twitter authentication')) {
        errorMessage = 'X (Twitter) authentication issue. Please reconnect your account in profile settings.';
      } else {
        errorMessage = detail || err.message || errorMessage;
      }
      toast.error(errorMessage, { position: 'top-center', autoClose: 6000 });
    },
  });
  */
  // v2 fallback handler
  /*
  const handleV2Change = useCallback((token) => {
    if (token && pendingTask) {
      setImmediateLoading(true);
      verifyTaskMutation.mutate({ task: pendingTask, v2Token: token }, {
        onSettled: () => {
          setImmediateLoading(false);
          if (recaptchaV2Ref.current) {
            recaptchaV2Ref.current.reset();
          }
          setPendingTask(null);
        },
      });
      setShowV2Modal(false);
    }
  }, [pendingTask, verifyTaskMutation]);
  */
  const createChargeMutation = useMutation({
    mutationFn: async () => {
      if (!session?.user?.id) throw new Error('Not authenticated');
      if (!csrfToken) throw new Error('CSRF token not available');
      const token = await debouncedExecuteRecaptcha('create_charge');
      const response = await axios.post(
        '/api/coinbase/create-charge',
        { userId: session.user.id, plan: 'premium' },
        {
          headers: {
            'x-csrf-token': csrfToken,
            'X-Recaptcha-Token': token,
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        }
      );
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to create charge');
      return response.data.hostedUrl;
    },
    onSuccess: async (hostedUrl) => {
      window.location.href = hostedUrl;
      await queryClient.invalidateQueries(['userData', session?.user?.id]);
    },
    onError: (err) => {
      let errorMessage = 'Unable to process payment initiation. Please try again shortly.';
      if (err.message.includes('CSRF token not available')) {
        errorMessage = 'Session security issue detected. Please refresh the page.';
      } else if (err.response?.status === 500) {
        errorMessage = 'Temporary server issue. Our team has been notified—please try again in a moment.';
      } else if (err.response?.status === 403) {
        errorMessage = 'Security verification failed. Please try the action again. If it persists, refresh the page.';
      } else if (err.response?.status === 401) {
        errorMessage = 'Your session has expired. Please log in again to continue.';
      } else if (err.response?.status === 429) {
        errorMessage = 'Request limit reached. Please wait 1 minute before retrying.';
      } else {
        errorMessage = err.response?.data?.detail || err.message || 'Payment initiation failed unexpectedly.';
      }
      toast.error(errorMessage, { position: 'top-center', autoClose: 6000 });
    },
  });

  const { data: userData, isLoading: userLoading, error: userError } = useQuery({
    queryKey: ['userData', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `userData-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) {
        if (cached.twitterHandle && window.location.search.includes('twitterConnected=true')) {
          await clearCache(cacheKey);
          throw new Error('Cache invalidated due to Twitter connection');
        }
        return cached;
      }
      try {
        const response = await axios.get(`/api/user?uid=${encodeURIComponent(session.user.id)}`, {
          headers: {
            'x-csrf-token': csrfToken,
          },
          withCredentials: true,
        });
        if (!response.data.success) throw new Error(response.data.detail || 'Unable to fetch user data');
        const user = {
          ...response.data.user,
          isPremium: response.data.user.isPremium || false,
          tier: response.data.user.isPremium ? 'Premium' : response.data.user.tier || 'Basic',
          twitterHandle: response.data.user.twitterHandle || null,
          profilePicture: response.data.user.profilePicture || '',
          googleName: response.data.user.googleName || '',
          walletAddress: response.data.user.walletAddress || null, // Ensure wallet from API
          daysActive: response.data.user.daysActive || 0,
          streak: response.data.user.streak || 0,
          last7Days: response.data.user.last7Days || [],
        };
        await cacheData(cacheKey, user, 24 * 60 * 1000);
        return user;
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          logger.error('Error fetching user data:', err.response?.data || err.message);
        }
        throw err;
      }
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    onError: async (err) => {
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Error fetching user data:', err.response?.data || err.message);
      }
      let errorMessage = 'Unable to load your profile data. Please try refreshing the page.';
      if (err.response?.status === 429) {
        errorMessage = 'Request limit reached. Please wait a moment and refresh.';
      } else if (err.response?.status === 403) {
        errorMessage = 'Authentication issue detected. Please log in again.';
        await signOut({ redirect: false });
        window.location.href = '/auth/signin';
      } else if (err.response?.status === 404) {
        errorMessage = 'Profile not found. Please log in again to sync your data.';
        await signOut({ redirect: false });
        window.location.href = '/auth/signin';
      } else {
        errorMessage = err.response?.data?.detail || err.message || 'Profile load failed unexpectedly.';
      }
      toast.error(errorMessage, { position: 'top-center', autoClose: 6000 });
    },
  });

  useEffect(() => {
    if (userData?.twitterHandle && !userData?.profilePicture.includes('pbs.twimg.com') && status === 'authenticated') {
      logger.warn('Twitter handle present but profile picture is not from Twitter, triggering refetch');
      const cacheKey = `userData-${session.user.id}`;
      clearCache(cacheKey).then(() => {
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]);
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]);
      });
    }
  }, [userData, session, csrfToken, queryClient, status]);
  const handleCopyWallet = async () => {
    if (userData?.walletAddress) {
      await navigator.clipboard.writeText(userData.walletAddress);
      toast.success('Wallet address copied!', { position: 'top-center', autoClose: 2000 });
    }
  };
  const email = userData?.email || '';
  const isBaseAccount = email.includes('@base.xynapseai.net');
  const displayInfo = isBaseAccount ? (userData?.walletAddress || '') : email;
  const maskedInfo = isBaseAccount
    ? `${userData?.walletAddress?.slice(0, 6) || ''}...${userData?.walletAddress?.slice(-4) || ''}`
    : (email ? email.replace(/./g, '*') : '********');
  const fullInfo = displayInfo;
  const renderWalletSection = () => {
    if (!userData?.walletAddress) return null;
    return (
      <div className="h-[22vh] rounded-xl p-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] relative">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-[#00FFFF]" />
            <span className="text-[#FFF] font-semibold text-sm">Wallet</span>
          </div>
          <span className="text-emerald-400 text-xs font-medium">Connected</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <p className="text-xs text-[#D4D4D4] truncate flex-1">
              {showWallet ? userData.walletAddress : `${userData.walletAddress.slice(0, 6)}...${userData.walletAddress.slice(-4)}`}
            </p>
            <motion.button
              onClick={handleCopyWallet}
              className="text-[#D4D4D4] hover:text-[#FFF]/80 transition-colors p-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Copy className="w-3 h-3" />
            </motion.button>
            <motion.button
              onClick={() => setShowWallet(!showWallet)}
              className="text-[#D4D4D4] hover:text-[#FFF]/80 transition-colors p-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {showWallet ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </motion.button>
          </div>
        </div>
      </div>
    );
  };
  /*
  // Fetch Tasks - No reCAPTCHA for faster load
  const { data: tasks, isLoading: tasksLoading, error: tasksError } = useQuery({
    queryKey: ['tasks', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `tasks-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) return cached;
      const response = await axios.get('/api/tasks', {
        headers: {
          'x-csrf-token': csrfToken,
        },
        withCredentials: true,
      });
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to fetch tasks.');
      await cacheData(cacheKey, response.data.tasks, 10 * 60 * 1000);
      return response.data.tasks;
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 10 * 60 * 1000,
  });
  // Fetch Task Progress - Removed reCAPTCHA for faster load
  const { data: taskProgress, isLoading: taskProgressLoading, error: taskProgressError } = useQuery({
    queryKey: ['taskProgress', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `taskProgress-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) return cached;
      const response = await axios.get(`/api/task-progress?uid=${session.user.id}`, {
        headers: {
          'x-csrf-token': csrfToken,
        },
        withCredentials: true,
      });
      const progress = response.data.progress || {};
      await cacheData(cacheKey, progress, 10 * 60 * 1000);
      return progress;
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 10 * 60 * 1000,
  });
  */

  /*
  // Fetch Leaderboard - Removed Authorization header to fix 403 for Email login, increased stale time
  const { data: rankings, isLoading: leaderboardLoading, error: leaderboardError } = useQuery({
    queryKey: ['leaderboard', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `leaderboard-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) {
        return cached;
      }
      const response = await axios.get('/api/leaderboard', {
        headers: {
          'x-csrf-token': csrfToken,
          // Removed 'Authorization' header to fix 403 error for Email login
        },
        withCredentials: true,
      }).catch(err => {
        logger.error('Leaderboard fetch error:', err.response?.data || err.message);
        throw err;
      });
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to fetch leaderboard.');
      await cacheData(cacheKey, response.data.rankings, 5 * 60 * 1000);
      return response.data.rankings;
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 30 * 60 * 1000,
    retry: 1,
    retryDelay: 2000,
    onError: (err) => {
      logger.error('Leaderboard error:', err);
      toast.error('Unable to load leaderboard at this time. Please check your connection and try again.', {
        position: 'top-center',
        autoClose: 5000
      });
    },
  });
  */
  const connectTwitterMutation = useMutation({
    mutationFn: async () => {
      window.location.href = '/api/twitter/connect';
    },
    onError: (err) => {
      logger.error('Connect Twitter error:', err);
      toast.error('Unable to initiate Twitter connection. Please try again or check your network.', {
        position: 'top-center',
        autoClose: 5000
      });
    },
  });
  const disconnectTwitterMutation = useMutation({
    mutationFn: async ({ v2Token } = {}) => {
      const token = v2Token || await debouncedExecuteRecaptcha('disconnect_twitter');
      const response = await axios.post(
        '/api/twitter/connect',
        { action: 'disconnect', uid: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
          withCredentials: true,
        }
      ).catch(err => {
        logger.error('Disconnect Twitter error:', err.response?.data || err.message);
        throw err;
      });
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to disconnect Twitter');
      await clearAllCaches(session.user.id);
    },
    onSuccess: async () => {
      toast.success('Twitter account disconnected successfully. Your profile has been updated.', {
        position: 'top-center',
        autoClose: 5000
      });
      await Promise.all([
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
        /*
        queryClient.invalidateQueries(['leaderboard', session?.user?.id, csrfToken]),
        */
      ]);
      await Promise.all([
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
        /*
        queryClient.refetchQueries(['leaderboard', session?.user?.id, csrfToken]),
        */
      ]);
    },
    onError: (err) => {
      if (err.response?.status === 403 && err.response.data.detail === 'low_score_fallback') {
        // For disconnect, you can add similar fallback logic if needed
        toast.info('Please complete the security check to continue.', { position: 'top-center', autoClose: 4000 });
        return;
      }
      let errorMessage = err.response?.data?.detail || 'Unable to disconnect Twitter at this time.';
      if (err.response?.status === 429) {
        errorMessage = 'Request limit reached. Please wait a moment and try again.';
      } else if (err.response?.status === 403) {
        if (err.response?.data?.detail === 'Invalid CSRF check.') {
          errorMessage = 'Session security issue detected. Please refresh the page.';
        } else if (err.response?.data?.detail?.includes('reCAPTCHA')) {
          errorMessage = 'Security verification failed. Please try the action again. If it persists , try another browser.';
        } else {
          errorMessage = 'Security verification failed. Please try the action again. If it persists, refresh the page.';
        }
      }
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    },
  });
  const connectWalletMutation = useMutation({
    mutationFn: async ({ v2Token } = {}) => {
      if (!window.ethereum) throw new Error('Please install MetaMask.');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const walletAddress = accounts[0];
      const signer = await provider.getSigner();
      const message = `Verify wallet for UID: ${session.user.id}`;
      const signature = await signer.signMessage(message);
      const token = v2Token || await debouncedExecuteRecaptcha('verify-wallet');
      const response = await axios.post(
        '/api/verify-wallet',
        { action: 'verify-wallet', walletAddress, signature, message, uid: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
          withCredentials: true,
        }
      );
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to verify wallet');
      return walletAddress;
    },
    onSuccess: (walletAddress) => {
      toast.success(`Wallet ${walletAddress.slice(0, 6)}... connected successfully.`, {
        position: 'top-center',
        autoClose: 5000
      });
      queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]);
    },
    onError: (err) => {
      if (err.response?.status === 403 && err.response.data.detail === 'low_score_fallback') {
        // Similar fallback for wallet if needed
        toast.info('Please complete the security check to continue.', { position: 'top-center', autoClose: 4000 });
        return;
      }
      toast.error(`Wallet connection failed: ${err.message}. Please ensure MetaMask is installed and try again.`, {
        position: 'top-center',
        autoClose: 5000
      });
    },
  });
  const disconnectWalletMutation = useMutation({
    mutationFn: async ({ v2Token } = {}) => {
      const token = v2Token || await debouncedExecuteRecaptcha('disconnect-wallet');
      const response = await axios.post(
        '/api/verify-wallet',
        { action: 'disconnect-wallet', uid: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
          withCredentials: true,
        }
      );
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to disconnect wallet');
    },
    onSuccess: () => {
      toast.success('Wallet disconnected successfully.', { position: 'top-center', autoClose: 5000 });
      queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]);
    },
    onError: (err) => {
      if (err.response?.status === 403 && err.response.data.detail === 'low_score_fallback') {
        toast.info('Please complete the security check to continue.', { position: 'top-center', autoClose: 4000 });
        return;
      }
      toast.error(`Unable to disconnect wallet: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });
  const debouncedHandleSignOut = useCallback(
    debounce(() => handleSignOut(), 1000, { leading: true, trailing: false }),
    [handleSignOut]
  );
  /*
  // Handle Daily Check-in - Updated to pass {task}
  const handleDailyCheckin = () => {
    setImmediateLoading(true);
    const task = { id: 'daily_checkin', description: 'Daily Check-in', points: 10, task_type: 'daily_checkin' };
    verifyTaskMutation.mutate({ task }, {
      onSettled: () => {
        setImmediateLoading(false);
      },
    });
  };
  */
  // Get Days Active
  const getDaysActive = useCallback(() => {
    return userData?.daysActive || 0;
  }, [userData]);
  /*
  const getPaginatedData = useCallback((data, tab) => {
    const startIndex = (currentPage[tab] - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return data.slice(startIndex, endIndex);
  }, [currentPage]);
  const getTotalPages = useCallback((data) => Math.ceil(data.length / itemsPerPage), []);
  const handlePageChange = useCallback((tab, page) => {
    setCurrentPage((prev) => ({ ...prev, [tab]: page }));
  }, []);
  */
  const getProfilePictureSrc = useCallback((profilePicture) => {
    const isValidUrl = (url) => {
      try {
        new URL(url);
        return true;
      } catch (err) {
        logger.warn(`Invalid URL: ${url}`, err);
        return false;
      }
    };
    if (profilePicture && typeof profilePicture === 'string' && isValidUrl(profilePicture)) {
      return profilePicture;
    }
    return '/fallback-image.webp';
  }, []);
  /*
  const renderUserRow = useCallback(
    (user, index, isCurrentUser = false) => {
      const rank = rankings?.findIndex((u) => u.id === user.id) + 1 || 'N/A';
      const getRankIcon = (r) => {
        if (r === 1) return <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />;
        if (r === 2) return <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />;
        if (r === 3) return <Award className="w-4 h-4 sm:w-5 sm:h-5 text-[#D4D4D4]" />;
        return null;
      };
      const rankIcon = getRankIcon(rank);
      return (
        <motion.tr
          key={user.id}
          className={`border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/10 transition-all duration-300`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.02 }}
        >
          <td className="px-4 py-2 text-[#FFF] text-sm sm:text-base truncate align-middle flex items-center gap-1 min-w-[4rem]">
            {rankIcon}
            {rank}
          </td>
          <td className="px-4 py-2 text-[#FFF] text-sm sm:text-base truncate align-middle min-w-0">
            <div className="flex items-center">
              <Image
                src={getProfilePictureSrc(user.profilePicture)}
                alt={user.googleName || user.twitterHandle || 'User Avatar'}
                width={isMobile ? 24 : 32}
                height={isMobile ? 24 : 32}
                className="rounded-full border border-[#FFFFFF20] mr-3 object-cover shadow-md flex-shrink-0"
              />
              <div className="flex items-center gap-1 truncate min-w-0 ml-1">
                <span className="truncate">{user.googleName || user.twitterHandle || 'Anonymous'}</span>
                {user.twitterHandle && (
                  <a href={`https://x.com/${user.twitterHandle}`} target="_blank" rel="noopener noreferrer">
                    <img src="/logos/x.webp" alt="X Logo" className="ml-1 w-4 h-4 sm:w-5 sm:h-5 text-[#00FFFF] hover:text-emerald-400 flex-shrink-0" />
                  </a>
                )}
                {isCurrentUser && (
                  <span className="ml-2 text-[9px] md:text-[10px] font-semibold text-[#0A0A0A] px-1 py-0.5 rounded-lg border border-[#FFFFFF] bg-gradient-to-r from-[#FFF] to-[#D4D4D4] whitespace-nowrap">
                    You
                  </span>
                )}
              </div>
            </div>
          </td>
          <td className="px-4 py-2 text-[#00FFFF] text-sm sm:text-base text-right truncate align-middle min-w-[5rem]">{user.points || 0}</td>
        </motion.tr>
      );
    },
    [isMobile, rankings, getProfilePictureSrc]
  );
  const handleVerifyTask = useCallback((task) => {
    setImmediateLoading(true);
    verifyTaskMutation.mutate({ task }, {
      onSettled: () => {
        setImmediateLoading(false);
      },
    });
  }, [verifyTaskMutation]);
  */
  const renderProfileSection = useCallback(() => {
    if (userLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <LoadingOverlay isLoading={true} isMobile={isMobile} />
        </div>
      );
    }
    if (userError) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-full flex items-center justify-center text-red-400 text-sm p-4 text-center"
        >
          Error: {userError.message}
        </motion.div>
      );
    }
    if (!userData) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500 text-sm">
          No profile data available.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div className="h-[22vh] rounded-xl p-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] relative">
            <div className="absolute top-1 right-1 p-2 flex gap-1 items-center z-10">
              <motion.button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['userData', session?.user?.id, csrfToken] })}
                className="p-1 rounded-lg bg-[#FFFFFF]/10 hover:bg-emerald-400/20 transition-all duration-300 z-10 border border-[#FFFFFF20]"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Refresh Profile"
              >
                <RefreshCw className="w-4 h-4 text-[#FFF]" />
              </motion.button>
              <motion.button
                onClick={onSignOut}
                disabled={isSigningOut}
                className={`p-1 rounded-lg bg-[#FFFFFF]/10 ${isSigningOut ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-400/20'} z-10 border border-[#FFFFFF20]`}
                whileHover={{ scale: isSigningOut ? 1 : 1.05 }}
                whileTap={{ scale: isSigningOut ? 1 : 0.9 }}
                aria-label="Sign out"
              >
                {isSigningOut ? (
                  <span className="text-[8px] sm:text-[10px] text-[#FFF]">Signing out...</span>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4 text-red-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                )}
              </motion.button>
            </div>
            <div className="relative mb-3">
              <div className={`relative w-20 h-20 mx-auto border-4 rounded-3xl overflow-hidden ${userData.tier === 'Premium' ? 'border-emerald-400' : 'border-[#D4D4D4]'} border-b-transparent`}>
                <Image
                  src={getProfilePictureSrc(userData.profilePicture)}
                  alt={userData.googleName || userData.twitterHandle || 'User Avatar'}
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className={`w-[60px] absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-[#0A0A0A]/80 border-2 ${userData.tier === 'Premium' ? 'border-emerald-400' : 'border-[#D4D4D4]'} rounded-full px-2 py-0.5 flex items-center justify-center`}>
                <span className={`text-[9px] font-bold ${userData.tier === 'Premium' ? 'text-emerald-400' : 'text-[#D4D4D4]'}`}>
                  {userData.tier}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1 mb-3">
              <h4 className="text-sm sm:text-base font-bold text-[#FFF] bg-gradient-to-r from-[#00FFFF] to-emerald-400 bg-clip-text text-transparent">
                {userData.googleName}
              </h4>
              <div className="flex items-center gap-2 text-[#D4D4D4] w-full justify-center">
                <span className="text-[10px] sm:text-[11px]">
                  {showEmail ? fullInfo : maskedInfo}
                </span>
                <motion.button
                  onClick={() => setShowEmail(!showEmail)}
                  className="p-1 rounded-lg hover:bg-[#FFFFFF]/10 transition-colors"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {showEmail ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </motion.button>
              </div>
            </div>
          </div>
          <div className="h-[22vh] rounded-xl p-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] relative">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <img src="/logos/x.webp" alt="X Logo" className="w-7 h-7 text-[#00FFFF] m-2" />
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${userData.twitterHandle ? 'text-emerald-400' : 'text-[#D4D4D4]'}`}>
                {userData.twitterHandle ? <Check className="w-3 h-3 text-emerald-400" /> : null}
                {userData.twitterHandle ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            {userData.twitterHandle && (
              <div className="absolute bottom-3 left-3">
                <a
                  href={`https://x.com/${userData.twitterHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="m-2 text-[#FFF] text-sm font-semibold underline hover:decoration-emerald-400 transition-colors"
                >
                  @{userData.twitterHandle}
                </a>
              </div>
            )}
            <motion.button
              onClick={() => userData.twitterHandle ? disconnectTwitterMutation.mutate({}) : connectTwitterMutation.mutate()}
              disabled={disconnectTwitterMutation.isLoading || connectTwitterMutation.isLoading}
              className={`absolute bottom-3 right-3 px-4 py-2 rounded-xl text-[9px] sm:text-[11px] font-medium transition-all duration-300 flex items-center justify-center gap-1 shadow-lg ${userData.twitterHandle
                ? 'bg-red-400/20 text-[#FFF] hover:from-red-500/20 hover:to-red-400/20 border border-red-400/40'
                : 'text-[#FFF] border border-[#00FFFF]/50 bg-[#FFFFFF]/10 hover:bg-[#00FFFF]/20'
                }`}
              whileHover={{ scale: (disconnectTwitterMutation.isLoading || connectTwitterMutation.isLoading) ? 1 : 1 }}
              whileTap={{ scale: (disconnectTwitterMutation.isLoading || connectTwitterMutation.isLoading) ? 1 : 0.97 }}
            >
              {disconnectTwitterMutation.isLoading || connectTwitterMutation.isLoading ? (
                <BlinkingDots />
              ) : userData.twitterHandle ? (
                <>
                  Disconnect
                  <svg className="w-3 h-3 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </>
              ) : (
                <>
                  Connect
                  <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
                </>
              )}
            </motion.button>
          </div>
          {userData?.walletAddress ? renderWalletSection() : null}
          {/* Commented out points section for synchronization */}
          <div className="relative h-[22vh] rounded-xl p-3 bg-gradient-to-br from-black/80 to-gray-900/80 border border-white/20 shadow-lg shadow-black/20 flex flex-col items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-xl z-10">
              <span className="text-white text-lg font-medium">Coming Soon</span>
            </div>
            {/* <span className="absolute top-3 left-3 m-2 text-white/80 text-xs uppercase">POINTS</span> */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-white text-2xl sm:text-3xl font-bold">
                {userData?.points || 0}
              </span>
            </div>
            {/* <div className="flex flex-row absolute bottom-3 right-3 text-white/70 text-[10px] flex items-center gap-1">
              <span>Days Active: </span>
              <span className="text-white font-bold">{getDaysActive()}</span>
              <span className={`flex ml-4 items-center gap-1 text-[10px] ${userData.streak >= 7 ? 'text-orange-400' : 'text-white/70'}`}>
                {userData.streak >= 7 && <Flame className="w-3 h-3 text-orange-500 animate-pulse" />}
                Streak:
                <span className="text-white font-bold">{userData.streak}</span>
              </span>
            </div> */}
          </div>
        </div>
      </div>
    );
  }, [userData, userLoading, userError, isMobile, session, csrfToken, queryClient, isSigningOut, showEmail, showWallet, getDaysActive, getProfilePictureSrc, handleCopyWallet, connectTwitterMutation, disconnectTwitterMutation, immediateLoading/*
  , verifyTaskMutation
  */]);
  /*
  // Render Tasks Section - Cards in 3-column grid
  const renderTasksSection = useCallback(() => {
    if (!userData?.twitterHandle) {
      return (
        <motion.div
          className="h-full flex items-center justify-center p-6 min-h-[calc(45vh-1rem)] bg-gradient-to-br from-black/90 to-gray-900/90 rounded-b-xl border-t border-white/15 shadow-2xl shadow-black/30"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
        >
          <div className="text-center max-w-md flex flex-col items-center justify-center gap-4">
            <p className="text-sm text-white/80">
              Connect your X (Twitter) account to unlock tasks.
            </p>
            <motion.button
              onClick={() => connectTwitterMutation.mutate()}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-neon-blue border border-neon-blue/50 bg-gradient-to-r from-white/10 to-white/5 hover:bg-neon-blue/20 transition-all duration-300 shadow-lg flex items-center justify-center gap-2"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Connect
              <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
            </motion.button>
          </div>
        </motion.div>
      );
    }
    if (tasksLoading || taskProgressLoading) {
      return (
        <div className="relative h-full">
          <LoadingOverlay
            isLoading={true}
            isMobile={isMobile}
            className="absolute inset-0 z-10 h-full"
          />
          <div className="h-full flex items-center justify-center">
            <Spinner className="h-8 w-8 text-[#00FFFF]" />
          </div>
        </div>
      );
    }
    if (tasksError || taskProgressError) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-full flex items-center justify-center text-red-400 text-sm p-4 text-center"
        >
          Error loading tasks: {tasksError?.message || taskProgressError?.message}
        </motion.div>
      );
    }
    if (!tasks?.length) {
      return (
        <div className="h-full flex items-center justify-center text-[#D4D4D4] text-sm p-4 text-center">
          No tasks available.
        </div>
      );
    }
    return (
      <div className="relative h-full p-4 space-y-4 overflow-y-auto hide-scrollbar">
        <DailyCheckinBar
          last7Days={userData.last7Days}
          streak={userData.streak}
          onCheckin={handleDailyCheckin}
          isLoading={immediateLoading || verifyTaskMutation.isLoading}
          userData={userData}
          twitterConnected={!!userData.twitterHandle}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((task, index) => {
            const isCompleted = (task.is_daily && (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions) ||
              (!task.is_daily && taskProgress?.[task.id]?.completionCount >= task.max_completions);
            return (
              <motion.div
                key={task.id}
                className="h-[22vh] rounded-xl p-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] relative overflow-hidden"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.02 }}
              >
                <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
                  <span className="text-emerald-400 font-bold text-sm">+{task.points}</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-[#FFF] font-semibold text-sm truncate flex-1">{task.description}</h4>
                </div>
                {task.is_daily && (
                  <p className="text-xs text-[#D4D4D4] mb-3 truncate">
                    Daily ({taskProgress?.[task.id]?.completionCount || 0}/{task.max_completions})
                  </p>
                )}
                <div className="absolute bottom-3 left-3 right-3">
                  {task.task_type === 'follow' && !followedTasks.has(task.id) ? (
                    <motion.button
                      onClick={() => handleFollow(task.id)}
                      className="w-full px-3 py-2 bg-emerald-400/20 text-[#FFF] rounded-lg text-xs font-medium hover:from-[#00FFFF]/20 hover:to-emerald-400/20 transition-all duration-300 flex items-center justify-center gap-1 border border-emerald-400/40"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
                      Follow
                    </motion.button>
                  ) : (
                    <motion.button
                      onClick={() => handleVerifyTask(task)}
                      disabled={
                        immediateLoading ||
                        verifyTaskMutation.isLoading ||
                        !userData?.twitterHandle ||
                        isCompleted
                      }
                      className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 flex items-center justify-center gap-1 shadow-lg relative overflow-hidden border ${immediateLoading ||
                        verifyTaskMutation.isLoading ||
                        !userData?.twitterHandle ||
                        isCompleted
                        ? 'bg-[#FFFFFF]/10 text-[#FFF]/50 cursor-not-allowed opacity-50 border-[#FFFFFF20]'
                        : 'bg-emerald-400/20 text-[#FFF] hover:from-emerald-500/20 hover:to-emerald-400/20 border-emerald-400/40'
                        }`}
                      whileHover={{
                        scale:
                          immediateLoading ||
                            verifyTaskMutation.isLoading ||
                            !userData?.twitterHandle ||
                            isCompleted
                            ? 1
                            : 1.05,
                      }}
                      whileTap={{
                        scale:
                          immediateLoading ||
                            verifyTaskMutation.isLoading ||
                            !userData?.twitterHandle ||
                            isCompleted
                            ? 1
                            : 0.95,
                      }}
                    >
                      {(immediateLoading || verifyTaskMutation.isLoading) ? (
                        <BlinkingDots />
                      ) : isCompleted ? (
                        <>
                          <Check className="w-3 h-3" />
                          Completed
                        </>
                      ) : !userData?.twitterHandle ? (
                        <>
                          <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
                          Connect Twitter
                        </>
                      ) : (
                        <>
                          <Trophy className="w-3 h-3" />
                          Verify
                        </>
                      )}
                      {(immediateLoading || verifyTaskMutation.isLoading) && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#FFFFFF]/10 to-transparent animate-shimmer"></div>
                      )}
                    </motion.button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    );
  }, [tasks, tasksLoading, taskProgressLoading, tasksError, taskProgress, verifyTaskMutation, userData, isMobile, followedTasks, immediateLoading, handleVerifyTask, connectTwitterMutation, handleDailyCheckin]);
  */
  /*
  // Render Leaderboard Section - Increased sizes
  const renderLeaderboardSection = useCallback(() => {
    const leaderboardUsers = rankings?.filter(u => u.id !== (session?.user?.id || '')) || [];
    if (leaderboardLoading) {
      return (
        <div className="relative h-full">
          <LoadingOverlay
            isLoading={true}
            isMobile={isMobile}
            className="absolute inset-0 z-10 h-full"
          />
          <div className="h-full flex items-center justify-center">
            <Spinner className="h-8 w-8 text-[#00FFFF]" />
          </div>
        </div>
      );
    }
    if (leaderboardError) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-full flex items-center justify-center text-red-400 text-sm p-4 text-center gap-2"
        >
          Error: {leaderboardError.message}
          <button
            onClick={() => window.location.reload()}
            className="px-2 py-1 bg-[#00FFFF]/20 text-[#FFF] rounded-lg text-sm font-medium hover:from-emerald-400/20 hover:to-[#00FFFF]/20 transition-colors shadow-lg shadow-[#00FFFF]/25 border border-[#00FFFF]/40"
          >
            Retry
          </button>
        </motion.div>
      );
    }
    if (!rankings?.length) {
      return (
        <div className="h-full flex items-center justify-center text-[#D4D4D4] text-sm p-4 text-center">
          No ranking data available.
        </div>
      );
    }
    return (
      <div className="relative h-full p-4 overflow-y-auto hide-scrollbar flex flex-col">
        <div className="overflow-auto mb-4 max-h-[calc(100vh-12rem)]">
          <table className="w-full text-sm sm:text-base bg-[#0A0A0A]/80 rounded-xl table-fixed">
            <thead className="border-b border-[#FFFFFF10] bg-[#0A0A0A]/80 backdrop-blur-md">
              <tr>
                <th className={`${isMobile ? 'w-[15%]' : 'w-20'} px-4 py-2 text-[#FFF] text-left font-semibold truncate align-middle min-w-[4rem]`}>Rank</th>
                <th className={`${isMobile ? 'w-[65%]' : 'flex-1'} px-4 py-2 text-[#FFF] text-left font-semibold truncate align-middle min-w-0`}>User</th>
                <th className={`${isMobile ? 'w-[20%]' : 'w-20'} px-4 py-2 text-[#FFF] text-right font-semibold truncate align-middle min-w-[5rem]`}>Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#FFFFFF10]">
              {userData && renderUserRow(userData, 0, true)}
              {getPaginatedData(leaderboardUsers, 'leaderboard').map((user, index) => renderUserRow(user, index, false))}
            </tbody>
          </table>
        </div>
        {leaderboardUsers.length > itemsPerPage && (
          <div className="flex justify-end gap-2 p-2 rounded-xl shadow-inner">
            <motion.button
              onClick={() => handlePageChange('leaderboard', currentPage.leaderboard - 1)}
              disabled={currentPage.leaderboard === 1}
              className={`px-1 py-0.5 text-xs font-medium text-[#FFF] border border-[#FFFFFF20] bg-[#FFFFFF]/10 rounded-lg ${currentPage.leaderboard === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#00FFFF]/20'}`}
              whileHover={{ scale: currentPage.leaderboard === 1 ? 1 : 1.05 }}
              whileTap={{ scale: currentPage.leaderboard === 1 ? 1 : 0.95 }}
            >
              &lt;
            </motion.button>
            <span className="text-xs text-[#D4D4D4] self-center">
              {currentPage.leaderboard} / {getTotalPages(leaderboardUsers)}
            </span>
            <motion.button
              onClick={() => handlePageChange('leaderboard', currentPage.leaderboard + 1)}
              disabled={currentPage.leaderboard === getTotalPages(leaderboardUsers)}
              className={`px-1 py-0.5 text-xs font-medium text-[#FFF] border border-[#FFFFFF20] bg-[#FFFFFF]/10 rounded-lg ${currentPage.leaderboard === getTotalPages(leaderboardUsers) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#00FFFF]/20'}`}
              whileHover={{ scale: currentPage.leaderboard === getTotalPages(leaderboardUsers) ? 1 : 1.05 }}
              whileTap={{ scale: currentPage.leaderboard === getTotalPages(leaderboardUsers) ? 1 : 0.95 }}
            >
              &gt;
            </motion.button>
          </div>
        )}
      </div>
    );
  }, [leaderboardLoading, leaderboardError, rankings, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange, renderUserRow, session]);
  */
  // Handle Twitter redirect callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('twitterConnected') === 'true' && status === 'authenticated') {
      const cacheKey = `userData-${session.user.id}`;
      /*
      const leaderboardCacheKey = `leaderboard-${session.user.id}`;
      */
      Promise.all([
        clearCache(cacheKey),
        /*
        clearCache(leaderboardCacheKey),
        */
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
        /*
        queryClient.invalidateQueries(['leaderboard', session?.user?.id, csrfToken]),
        */
      ])
        .then(() => {
          return Promise.all([
            queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
            /*
            queryClient.refetchQueries(['leaderboard', session?.user?.id, csrfToken]),
            */
          ]);
        })
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          toast.success('X (Twitter) connected successfully! Your profile is now updated.', {
            position: 'top-center',
            autoClose: 5000
          });
        })
        .catch((err) => {
          logger.error('Error handling Twitter connection callback:', err);
          toast.error('Data refresh failed after X (Twitter) connection. Please refresh the page.', {
            position: 'top-center',
            autoClose: 5000,
          });
        });
    }
  }, [session, csrfToken, queryClient, status]);
  const handleManualCacheClear = async () => {
    try {
      await clearAllCaches(session.user.id);
      toast.success('Local cache cleared successfully. Reloading profile...', { position: 'top-center', autoClose: 3000 });
      window.location.reload();
    } catch (err) {
      logger.error('Error clearing cache:', err);
      toast.error('Failed to clear cache. Please refresh the page manually.', { position: 'top-center', autoClose: 5000 });
    }
  };

  if (!session) {
    return <LoginPrompt />;
  }
  const overallLoading = immediateLoading /*
  || verifyTaskMutation.isLoading
  */;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="font-inter w-full max-w-9xl mx-auto p-2 sm:p-3 bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col h-[calc(100vh-3rem)] overflow-y-auto hide-scrollbar"
    >
      <ToastContainer
        position="top-center"
        autoClose={5000}
        theme="dark"
        toastStyle={{
          backgroundColor: "rgba(0, 0, 0, 0.9)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "16px",
        }}
      />
      <div className="flex flex-col flex-1 gap-4 sm:gap-5">
        <motion.div
          className="bg-gradient-to-r from-black/40 to-gray-900/40 flex flex-col shadow-xl relative flex-1"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          {/* <div className="border-b border-white/15 bg-black/50 rounded-t-xl flex h-[32px] sm:h-[40px] overflow-hidden">
            {['profile'].map((tab) => {
              const isActive = activeTab === tab;
              return (
                <motion.button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 text-[10px] sm:text-xs font-bold text-white uppercase tracking-wider py-2 relative transition-all duration-300 flex items-center justify-center gap-1 ${isActive
                    ? 'text-white shadow-lg'
                    : 'text-white/70 hover:text-neon-blue'
                    }`}
                >
                  {tab === 'profile' && <User className="w-3 h-3 sm:w-4 sm:h-4" />}
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {isActive && (
                    <motion.div
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-white to-emerald-400 rounded-full"
                      layoutId="profileTabIndicator"
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    />
                  )}
                </motion.button>
              );
            })}
          </div> */}
          <div className="flex-1 overflow-hidden relative">
            <AnimatePresence mode="wait">
              {activeTab === 'profile' && (
                <motion.div
                  key="profile"
                  className="h-full overflow-y-auto hide-scrollbar"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {renderProfileSection()}
                </motion.div>
              )}
              /*
              {activeTab === 'tasks' && (
                <motion.div
                  key="tasks"
                  className="h-full"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {renderTasksSection()}
                </motion.div>
              )}
              {activeTab === 'leaderboard' && (
                <motion.div
                  key="leaderboard"
                  className="h-full"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {renderLeaderboardSection()}
                </motion.div>
              )}
              */
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
      {/* v2 Fallback Modal */}
      <AnimatePresence>
        {showV2Modal && (
          <motion.div
            className="fixed inset-0 bg-[#0A0A0A]/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setShowV2Modal(false);
              setPendingTask(null);
              if (recaptchaV2Ref.current) recaptchaV2Ref.current.reset();
            }}
          >
            <motion.div
              className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[#FFF] font-bold mb-4 text-sm">Security Verification</h3>
              <p className="text-[#D4D4D4] mb-6 text-xs">To protect your account, please verify you are human by checking the box below.</p>
              <ReCAPTCHA
                ref={recaptchaV2Ref}
                sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY} // Use same or separate V2 key
                onChange={handleV2Change}
                size="normal"
              />
              <motion.button
                onClick={() => {
                  setShowV2Modal(false);
                  setPendingTask(null);
                  if (recaptchaV2Ref.current) recaptchaV2Ref.current.reset();
                }}
                className="mt-4 px-4 py-2 bg-[#FFFFFF]/10 text-[#FFF] rounded-lg hover:bg-[#FFFFFF]/20 text-xs transition-colors border border-[#FFFFFF20]"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .animate-pulse {
          animation: ${isMobile ? 'none' : 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .animate-shimmer {
          background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.1) 50%, transparent 100%);
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @media (max-width: 640px) {
          .text-base { font-size: 0.875rem; }
          .text-lg { font-size: 1rem; }
          .text-xl { font-size: 1rem; }
          .text-2xl { font-size: 1.25rem; }
          .text-[11px] { font-size: 9px; }
          .text-[9px] { font-size: 7px; }
          .text-[8px] { font-size: 6px; }
          .h-[52px] { height: 48px; }
          .min-h-[100px] { min-height: 80px; }
        }
        @media (min-width: 641px) and (max-width: 1024px) {
          .grid-cols-3 { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </motion.div>
  );
}