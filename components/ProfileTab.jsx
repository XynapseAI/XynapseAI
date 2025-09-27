// components\ProfileTab.jsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Trophy, Award, Flame, User, Crown, Calendar, Info } from 'lucide-react'; // Assume lucide-react installed
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts';
import { ethers } from 'ethers';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { cacheData, getCachedData, clearCache, clearAllCaches } from '../utils/indexedDB';
import { LoadingOverlay } from '@/utils/helpers';
import { debounce } from 'lodash';
import LoginPrompt from './LoginPrompt';
import { logger } from '../utils/clientLogger';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

// Simple spinner component - Increased size for visibility
const Spinner = () => (
  <svg className="animate-spin h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

// Daily Check-in Bar Component
const DailyCheckinBar = ({ last7Days, streak, onCheckin, isLoading, userData }) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayIndex = new Date().getDay();
  const [tooltipVisible, setTooltipVisible] = useState(false);

  return (
    <div className="w-full bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-white/10 rounded-xl p-2 mb-2">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3 text-blue-400" />
          <h3 className="text-white font-bold text-xs">Daily Check-in Streak</h3>
        </div>
        <div className="relative">
          <Info 
            className="w-3 h-3 text-gray-400 cursor-help" 
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
          />
          {tooltipVisible && (
            <div className="absolute top-full right-0 mt-1 p-2 bg-black/90 border border-white/20 rounded-lg text-[10px] sm:text-[11px] text-white/90 z-50 w-48">
              Maintain a 7-day streak to earn double points (20 pts/day) and unlock exclusive rewards! Breaking the streak resets to normal (10 pts).
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-around items-center">
        {last7Days.map((checked, index) => {
          const dayIndex = (todayIndex - index + 7) % 7;
          return (
            <div key={index} className="flex flex-col items-center gap-1">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[8px] font-bold transition-all duration-300 ${
                checked 
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/25' 
                  : 'bg-white/10 text-white/50 border border-white/20'
              }`}>
                {days[dayIndex]}
              </div>
              {index === 0 && (
                <motion.button
                  onClick={onCheckin}
                  disabled={isLoading || checked}
                  className={`mt-1 px-2 py-1 rounded-full text-[8px] font-semibold transition-all duration-300 ${
                    isLoading || checked 
                      ? 'bg-gray-600 text-white/50 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 shadow-lg shadow-blue-500/25'
                  }`}
                  whileHover={{ scale: checked ? 1 : 1.05 }}
                  whileTap={{ scale: checked ? 1 : 0.95 }}
                >
                  {isLoading ? <Spinner className="h-3 w-3" /> : checked ? 'Checked!' : 'Check-in'}
                </motion.button>
              )}
            </div>
          );
        })}
      </div>
      {streak >= 7 && (
        <div className="flex items-center justify-center mt-2 gap-1">
          <Flame className="w-3 h-3 text-orange-500 animate-pulse" />
          <span className="text-orange-400 font-bold text-xs">Streak: {streak} days - Double Points Active!</span>
        </div>
      )}
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <motion.div
        className="bg-black/95 backdrop-blur-xl border border-white/20 p-3 rounded-2xl text-white text-sm font-medium shadow-2xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <p className="text-white/70 text-xs mb-1">{label}</p>
        <p className="text-white font-semibold">
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
  const [activeTab, setActiveTab] = useState('tasks');
  const [currentPage, setCurrentPage] = useState({ tasks: 1, leaderboard: 1 });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [followedTasks, setFollowedTasks] = useState(new Set()); // Track followed tasks
  const itemsPerPage = 10;

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
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const onSignOut = async () => {
    setIsSigningOut(true);
    await handleSignOut();
    setIsSigningOut(false);
  };

  const handleFollow = (taskId) => {
    const followUrl = `https://x.com/intent/follow?screen_name=XynapseAI`;
    window.open(followUrl, '_blank');
    setFollowedTasks(prev => new Set([...prev, taskId]));
    toast.info('Redirecting to Twitter... Follow and return to verify!', { position: 'top-center' });
  };

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
    onSuccess: (csrf) => {
      localStorage.setItem('csrf_token', csrf);
    },
    onError: (err) => {
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Error fetching CSRF token:', err);
      }
      toast.error('Failed to fetch CSRF token. Please try again.', {
        position: 'top-center',
        autoClose: 5000,
      });
    },
  });

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
      logger.error('Create charge error:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
      let errorMessage = 'Failed to initiate payment';
      if (err.message.includes('CSRF token not available')) {
        errorMessage = 'CSRF token not available. Please refresh the page.';
      } else if (err.response?.status === 500) {
        errorMessage = 'Server error. Please check logs or try again later.';
      } else if (err.response?.status === 403) {
        errorMessage = 'Invalid CSRF or authentication. Please refresh.';
      } else if (err.response?.status === 401) {
        errorMessage = 'Session expired. Please log in again.';
      } else if (err.response?.status === 429) {
        errorMessage = 'Too many requests. Please wait a minute and try again.';
      } else {
        errorMessage = err.response?.data?.detail || err.message || 'Failed to initiate payment';
      }
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
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

      const token = await debouncedExecuteRecaptcha('get_user');
      try {
        const response = await axios.get(`/api/user?uid=${encodeURIComponent(session.user.id)}`, {
          headers: {
            'x-csrf-token': csrfToken,
            'X-Recaptcha-Token': token,
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
          daysActive: response.data.user.daysActive || 0,
          streak: response.data.user.streak || 0,
          last7Days: response.data.user.last7Days || [],
        };
        await cacheData(cacheKey, user, 24 * 60 * 60 * 1000);
        return user;
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          logger.error('Error fetching user data:', err.response?.data || err.message);
        }
        throw err;
      }
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 0,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    onError: async (err) => {
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Error fetching user data:', err.response?.data || err.message);
      }
      let errorMessage = 'Failed to fetch user data';
      if (err.response?.status === 429) {
        errorMessage = 'Too many requests. Please wait and try again.';
      } else if (err.response?.status === 403) {
        errorMessage = 'Authentication failed. Please try logging in again.';
        await signOut({ redirect: false });
        window.location.href = '/auth/signin';
      } else if (err.response?.status === 404) {
        errorMessage = 'User not found. Please log in again.';
        await signOut({ redirect: false });
        window.location.href = '/auth/signin';
      } else {
        errorMessage = err.response?.data?.detail || err.message || 'Failed to fetch user data';
      }
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
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
  }, [userData, session, csrfToken, queryClient]);

  // Fetch Tasks
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

  const { data: taskProgress, isLoading: taskProgressLoading, error: taskProgressError } = useQuery({
    queryKey: ['taskProgress', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `taskProgress-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) return cached;

      const token = await debouncedExecuteRecaptcha('task_progress');
      const response = await axios.get(`/api/task-progress?uid=${session.user.id}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'X-Recaptcha-Token': token,
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

  // Fetch Leaderboard
  const { data: rankings, isLoading: leaderboardLoading, error: leaderboardError } = useQuery({
    queryKey: ['leaderboard', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `leaderboard-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) {
        return cached;
      }
      const token = await debouncedExecuteRecaptcha('get_leaderboard');
      const response = await axios.get('/api/leaderboard', {
        headers: {
          'x-csrf-token': csrfToken,
          'X-Recaptcha-Token': token,
          'Authorization': `Bearer ${session?.accessToken}`,
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
      toast.error(`Failed to fetch leaderboard: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  const connectTwitterMutation = useMutation({
    mutationFn: async () => {
      window.location.href = '/api/twitter/connect';
    },
    onError: (err) => {
      logger.error('Connect Twitter error:', err);
      toast.error(`Unable to connect Twitter: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  const disconnectTwitterMutation = useMutation({
    mutationFn: async () => {
      const token = await debouncedExecuteRecaptcha('disconnect_twitter');
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
      toast.success('Twitter disconnected successfully.', { position: 'top-center', autoClose: 5000 });
      await Promise.all([
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['leaderboard', session?.user?.id, csrfToken]),
      ]);
      await Promise.all([
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.refetchQueries(['leaderboard', session?.user?.id, csrfToken]),
      ]);
    },
    onError: (err) => {
      logger.error('Disconnect Twitter mutation error:', err);
      const errorMessage = err.response?.status === 429
        ? 'Too many requests. Please try again later.'
        : err.response?.status === 403
          ? 'Authentication failed. Please try again.'
          : err.response?.data?.detail || 'Unable to disconnect Twitter';
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    },
  });

  const connectWalletMutation = useMutation({
    mutationFn: async () => {
      if (!window.ethereum) throw new Error('Please install MetaMask.');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const walletAddress = accounts[0];
      const signer = await provider.getSigner();
      const message = `Verify wallet for UID: ${session.user.id}`;
      const signature = await signer.signMessage(message);
      const token = await debouncedExecuteRecaptcha('verify-wallet');
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
      toast.success('Wallet connected successfully.', { position: 'top-center', autoClose: 5000 });
      queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]);
    },
    onError: (err) => {
      toast.error(`Unable to connect wallet: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  const disconnectWalletMutation = useMutation({
    mutationFn: async () => {
      const token = await debouncedExecuteRecaptcha('disconnect-wallet');
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
      toast.error(`Unable to connect wallet: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  const debouncedHandleSignOut = useCallback(
    debounce(() => handleSignOut(), 1000, { leading: true, trailing: false }),
    [handleSignOut]
  );

  // Handle Task Verification with delay for follow
  const verifyTaskMutation = useMutation({
    mutationFn: async (task) => {
      if (task.task_type === 'follow') {
        // Delay for realism
        await new Promise(resolve => setTimeout(resolve, 5500));
      }
      const token = await debouncedExecuteRecaptcha('verify_task');
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
    onSuccess: async (data, task) => {
      toast.success(`Task ${task.description} verified! +${data.pointsEarned} points`, { position: 'top-center', autoClose: 5000 });
      
      // Clear IndexedDB cache
      const userCacheKey = `userData-${session.user.id}`;
      const progressCacheKey = `taskProgress-${session.user.id}`;
      await Promise.all([
        clearCache(userCacheKey),
        clearCache(progressCacheKey),
      ]);
      
      // Invalidate và refetch
      await Promise.all([
        queryClient.invalidateQueries(['taskProgress', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
      ]);
      await Promise.all([
        queryClient.refetchQueries(['taskProgress', session?.user?.id, csrfToken]),
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
      ]);
    },
    onError: (err) => {
      let errorMessage = err.response?.status === 429
        ? 'API rate limit exceeded. Please try again later.'
        : err.response?.status === 403
          ? 'Authentication failed. Please try again.'
          : err.message.includes('reCAPTCHA')
            ? 'reCAPTCHA verification failed. Please try again.'
            : err.message.includes('Twitter account not connected')
              ? 'Please connect your Twitter account to perform this task.'
              : err.response?.data?.detail || `Verification failed: ${err.message}`;
      if (err.response?.status === 429) {
        errorMessage = 'Twitter rate limit exceeded. Please wait a moment and try again.';
      } else if (err.response?.status === 403 && err.response?.data?.detail?.includes('Twitter authentication')) {
        errorMessage = 'Twitter authentication issue. Please reconnect your Twitter account.';
      }
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    },
  });

  // Handle Daily Check-in
  const handleDailyCheckin = () => {
    const task = { id: 'daily_checkin', description: 'Daily Check-in', points: 10, task_type: 'daily_checkin' };
    verifyTaskMutation.mutate(task);
  };

  // Get Days Active
  const getDaysActive = useCallback(() => {
    return userData?.daysActive || 0;
  }, [userData]);

  const getPaginatedData = useCallback((data, tab) => {
    const startIndex = (currentPage[tab] - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return data.slice(startIndex, endIndex);
  }, [currentPage]);

  const getTotalPages = useCallback((data) => Math.ceil(data.length / itemsPerPage), []);

  const handlePageChange = useCallback((tab, page) => {
    setCurrentPage((prev) => ({ ...prev, [tab]: page }));
  }, []);

  const getProfilePictureSrc = useCallback((profilePicture, twitterHandle, googleName) => {
    const isValidUrl = (url) => {
      try {
        new URL(url);
        return true;
      } catch (err) {
        logger.warn(`Invalid URL: ${url}`, err);
        return false;
      }
    };

    if (twitterHandle && profilePicture && typeof profilePicture === 'string' && isValidUrl(profilePicture)) {
      return profilePicture;
    }

    if (googleName && profilePicture && typeof profilePicture === 'string' && isValidUrl(profilePicture)) {
      return profilePicture;
    }

    return '/default-avatar.webp';
  }, []);

  const renderUserRow = useCallback(
    (user, index, isCurrentUser = false) => {
      const rank = isCurrentUser ? rankings.findIndex((u) => u.id === user.id) + 1 || 'N/A' : index + 1;
      const getRankIcon = (r) => {
        if (r === 1) return <Trophy className="w-3 h-3 text-yellow-500" />;
        if (r === 2) return <Award className="w-3 h-3 text-gray-400" />;
        if (r === 3) return <Flame className="w-3 h-3 text-orange-500" />;
        return null;
      };
      const rankIcon = getRankIcon(rank);
      const rankStyles = {
        1: 'bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 border-yellow-500/50 text-yellow-400',
        2: 'bg-gradient-to-r from-gray-400/20 to-gray-500/20 border-gray-400/50 text-gray-300',
        3: 'bg-gradient-to-r from-orange-500/20 to-red-500/20 border-orange-500/50 text-orange-400',
      };

      return (
        <motion.tr
          key={user.id}
          className={`border-t border-white/10 hover:bg-white/5 transition-all duration-300 ${rankStyles[rank] || ''}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.02 }}
        >
          <td className="px-3 py-2 text-white text-[9px] sm:text-[11px] truncate flex items-center gap-1">
            {rankIcon}
            {rank}
          </td>
          <td className="px-3 py-2 text-white text-[9px] sm:text-[11px] truncate">
            <div className="flex items-center">
              <Image
                src={getProfilePictureSrc(user.profilePicture, user.twitterHandle, user.googleName)}
                alt={user.googleName || user.twitterHandle || 'User Avatar'}
                width={isMobile ? 14 : 16}
                height={isMobile ? 14 : 16}
                className="rounded-full border border-white/10 mr-2 object-cover"
              />
              <div className="flex items-center gap-1 truncate">
                <span>{user.googleName || user.twitterHandle || 'Anonymous'}</span>
                {user.twitterHandle && (
                  <a href={`https://x.com/${user.twitterHandle}`} target="_blank" rel="noopener noreferrer">
                    <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3 text-blue-400 hover:text-blue-300" />
                  </a>
                )}
                {isCurrentUser && (
                  <span className="ml-2 text-[8px] sm:text-[9px] font-medium text-neon-blue px-2 py-0.5 rounded-full border border-neon-blue/50 bg-white/5">
                    You
                  </span>
                )}
              </div>
            </div>
          </td>
          <td className="px-3 py-2 text-neon-blue text-[9px] sm:text-[11px] text-right truncate">{user.points || 0}</td>
        </motion.tr>
      );
    },
    [isMobile, rankings, getProfilePictureSrc]
  );

  // Render Tasks Section
  const renderTasksSection = useCallback(
    () => (
      <div className="relative bg-gradient-to-br from-black/80 to-gray-900/80 rounded-xl overflow-y-auto min-h-[calc(40vh)] sm:min-h-[calc(25vh)] max-h-[calc(40vh)] sm:max-h-[calc(40vh-4rem)] hide-scrollbar border border-white/10 shadow-2xl">
        <LoadingOverlay
          isLoading={tasksLoading || taskProgressLoading || verifyTaskMutation.isLoading}
          isMobile={isMobile}
          className="h-full"
        />
        {tasksError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[9px] sm:text-[11px] p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-center h-full flex items-center justify-center"
          >
            Error: {tasksError.message}
          </motion.div>
        )}
        {!tasks?.length && !tasksError && !(tasksLoading || taskProgressLoading) && (
          <p className="text-[9px] sm:text-[11px] text-white/60 text-center p-4 h-full flex items-center justify-center">
            No tasks available.
          </p>
        )}
        {tasks?.length > 0 && (
          <>
            {!userData?.twitterHandle && (
              <motion.div
                className="mb-2 p-2 text-center bg-white/5 rounded-xl"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <p className="text-[9px] sm:text-[11px] text-white/80 mb-2">
                  Connect your Twitter account to perform tasks.
                </p>
                <motion.button
                  onClick={() => connectTwitterMutation.mutate()}
                  className="px-3 py-1 rounded-xl text-[9px] sm:text-[11px] font-medium text-neon-blue border border-neon-blue/50 bg-white/5 hover:bg-neon-blue/20 transition-all duration-300 shadow-lg"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <img src="/logos/x.webp" alt="X Logo" className="inline w-3 h-3 mr-1" /> Connect Twitter
                </motion.button>
              </motion.div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[9px] sm:text-[11px] bg-black/50 rounded-xl table-fixed">
                <thead className="border-b border-white/10 bg-gradient-to-r from-black/70 to-gray-800/70">
                  <tr>
                    <th className={`${isMobile ? 'w-[50%]' : 'w-[60%]'} px-3 py-2 text-white text-left font-semibold truncate`}>Task</th>
                    <th className={`${isMobile ? 'w-[20%]' : 'w-[20%]'} px-3 py-2 text-white text-left font-semibold truncate`}>Points</th>
                    <th className={`${isMobile ? 'w-[30%]' : 'w-[20%]'} px-3 py-2 text-white text-left font-semibold truncate`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {getPaginatedData(tasks, 'tasks').map((task, index) => (
                    <motion.tr
                      key={task.id}
                      className="border-t border-white/10 hover:bg-white/10 transition-all duration-300"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.02 }}
                    >
                      <td className="px-3 py-2 text-white truncate">
                        {task.task_type === 'follow' ? (
                          <span className="flex items-center gap-1">
                            <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3 text-blue-400" />
                            Follow{' '}
                            <a
                              href={`https://x.com/intent/follow?screen_name=XynapseAI`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-neon-blue underline hover:text-blue-300"
                            >
                              @XynapseAI
                            </a>{' '}
                            on Twitter
                            {task.is_daily
                              ? ` (Daily ${taskProgress?.[task.id]?.completionCount || 0}/${task.max_completions})`
                              : ''}
                          </span>
                        ) : task.task_type === 'daily_checkin' ? (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-green-400" />
                            Daily Check-in
                            {task.is_daily
                              ? ` (Daily ${taskProgress?.[task.id]?.completionCount || 0}/${task.max_completions})`
                              : ''}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            {task.description}{' '}
                            {task.is_daily
                              ? ` (Daily ${taskProgress?.[task.id]?.completionCount || 0}/${task.max_completions})`
                              : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neon-green font-semibold">+{task.points}</td>
                      <td className="px-3 py-2 text-white">
                        <div className="flex gap-2">
                          {task.task_type === 'follow' && !followedTasks.has(task.id) ? (
                            <motion.button
                              onClick={() => handleFollow(task.id)}
                              className="px-2 py-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-[10px] sm:text-xs font-medium hover:from-blue-700 hover:to-purple-700 shadow-lg transition-all duration-300 flex items-center gap-1"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                            >
                              <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
                              Follow
                            </motion.button>
                          ) : (
                            <motion.button
                              onClick={() => verifyTaskMutation.mutate(task)}
                              disabled={
                                verifyTaskMutation.isLoading ||
                                (!userData?.twitterHandle && task.task_type !== 'daily_checkin') ||
                                (task.is_daily && (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions) ||
                                (!task.is_daily && taskProgress?.[task.id]?.completionCount >= task.max_completions)
                              }
                              className={`px-2 py-1 rounded-lg text-[10px] sm:text-xs font-medium transition-all duration-300 flex items-center gap-1 shadow-lg ${
                                verifyTaskMutation.isLoading ||
                                (!userData?.twitterHandle && task.task_type !== 'daily_checkin') ||
                                (task.is_daily && (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions) ||
                                (!task.is_daily && taskProgress?.[task.id]?.completionCount >= task.max_completions)
                                  ? 'bg-gray-600 text-white/50 cursor-not-allowed opacity-50'
                                  : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700'
                              }`}
                              whileHover={{
                                scale:
                                  verifyTaskMutation.isLoading ||
                                    (!userData?.twitterHandle && task.task_type !== 'daily_checkin') ||
                                    (task.is_daily && (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions) ||
                                    (!task.is_daily && taskProgress?.[task.id]?.completionCount >= task.max_completions)
                                    ? 1
                                    : 1.05,
                              }}
                              whileTap={{
                                scale:
                                  verifyTaskMutation.isLoading ||
                                    (!userData?.twitterHandle && task.task_type !== 'daily_checkin') ||
                                    (task.is_daily && (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions) ||
                                    (!task.is_daily && taskProgress?.[task.id]?.completionCount >= task.max_completions)
                                    ? 1
                                    : 0.95,
                              }}
                            >
                              {verifyTaskMutation.isLoading ? (
                                <>
                                  <Spinner className="h-3 w-3" />
                                  Verifying...
                                </>
                              ) : (
                                <>
                                  <Trophy className="w-3 h-3" />
                                  Verify
                                </>
                              )}
                            </motion.button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tasks?.length > itemsPerPage && (
              <div className="flex justify-end gap-2 mt-2 p-2 bg-white/5 rounded-xl">
                <motion.button
                  onClick={() => handlePageChange('tasks', currentPage.tasks - 1)}
                  disabled={currentPage.tasks === 1}
                  className={`px-2 py-1 text-[9px] sm:text-[11px] font-medium text-white border border-white/10 bg-white/5 rounded-lg ${currentPage.tasks === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
                  whileHover={{ scale: currentPage.tasks === 1 ? 1 : 1.05 }}
                  whileTap={{ scale: currentPage.tasks === 1 ? 1 : 0.95 }}
                >
                  &lt;
                </motion.button>
                <span className="text-[9px] sm:text-[11px] text-white/60 self-center">
                  {currentPage.tasks} / {getTotalPages(tasks)}
                </span>
                <motion.button
                  onClick={() => handlePageChange('tasks', currentPage.tasks + 1)}
                  disabled={currentPage.tasks === getTotalPages(tasks)}
                  className={`px-2 py-1 text-[9px] sm:text-[11px] font-medium text-white border border-white/10 bg-white/5 rounded-lg ${currentPage.tasks === getTotalPages(tasks) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
                  whileHover={{ scale: currentPage.tasks === getTotalPages(tasks) ? 1 : 1.05 }}
                  whileTap={{ scale: currentPage.tasks === getTotalPages(tasks) ? 1 : 0.95 }}
                >
                  &gt;
                </motion.button>
              </div>
            )}
          </>
        )}
      </div>
    ),
    [tasks, tasksLoading, taskProgressLoading, tasksError, taskProgress, verifyTaskMutation, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange, connectTwitterMutation, followedTasks]
  );

  // Render Leaderboard Section
  const renderLeaderboardSection = useCallback(
    () => (
      <div className="relative bg-gradient-to-br from-black/5 to-gray-900/5 rounded-xl overflow-y-auto min-h-[calc(40vh)] sm:min-h-[calc(25vh)] max-h-[calc(40vh)] sm:max-h-[calc(40vh-4rem)] hide-scrollbar border border-white/10 shadow-2xl">
        <LoadingOverlay
          isLoading={leaderboardLoading}
          isMobile={isMobile}
          className="h-full z-50"
        />
        {leaderboardError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[9px] sm:text-[11px] p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-center h-full flex items-center justify-center gap-2"
          >
            Error: {leaderboardError.message}
            <button
              onClick={() => window.location.reload()}
              className="px-2 py-1 bg-neon-blue text-black rounded-lg text-[9px] sm:text-[11px] font-medium hover:bg-blue-600 transition-colors"
            >
              Retry
            </button>
          </motion.div>
        )}
        {!leaderboardLoading && !leaderboardError && rankings?.length === 0 && (
          <p className="text-[9px] sm:text-[11px] text-white/60 text-center p-4 h-full flex items-center justify-center">
            No ranking data available.
          </p>
        )}
        {!leaderboardLoading && rankings?.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[9px] sm:text-[11px] bg-black/10 rounded-xl table-fixed">
                <thead className="border-b border-white/10 bg-gradient-to-r from-black/20 to-gray-800/20">
                  <tr>
                    <th className={`${isMobile ? 'w-[20%]' : 'w-[15%]'} px-3 py-2 text-white text-left font-semibold truncate`}>Rank</th>
                    <th className={`${isMobile ? 'w-[60%]' : 'w-[65%]'} px-3 py-2 text-white text-left font-semibold truncate`}>User</th>
                    <th className={`${isMobile ? 'w-[20%]' : 'w-[20%]'} px-3 py-2 text-white text-right font-semibold truncate`}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {userData && renderUserRow(userData, -1, true)}
                  {getPaginatedData(rankings, 'leaderboard').map((user, index) => renderUserRow(user, index, false))}
                </tbody>
              </table>
            </div>
            {rankings?.length > itemsPerPage && (
              <div className="flex justify-end gap-2 mt-2 p-2 bg-white/5 rounded-xl">
                <motion.button
                  onClick={() => handlePageChange('leaderboard', currentPage.leaderboard - 1)}
                  disabled={currentPage.leaderboard === 1}
                  className={`px-2 py-1 text-[9px] sm:text-[11px] font-medium text-white border border-white/10 bg-white/5 rounded-lg ${currentPage.leaderboard === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
                  whileHover={{ scale: currentPage.leaderboard === 1 ? 1 : 1.05 }}
                  whileTap={{ scale: currentPage.leaderboard === 1 ? 1 : 0.95 }}
                >
                  &lt;
                </motion.button>
                <span className="text-[9px] sm:text-[11px] text-white/60 self-center">
                  {currentPage.leaderboard} / {getTotalPages(rankings)}
                </span>
                <motion.button
                  onClick={() => handlePageChange('leaderboard', currentPage.leaderboard + 1)}
                  disabled={currentPage.leaderboard === getTotalPages(rankings)}
                  className={`px-2 py-1 text-[9px] sm:text-[11px] font-medium text-white border border-white/10 bg-white/5 rounded-lg ${currentPage.leaderboard === getTotalPages(rankings) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
                  whileHover={{ scale: currentPage.leaderboard === getTotalPages(rankings) ? 1 : 1.05 }}
                  whileTap={{ scale: currentPage.leaderboard === getTotalPages(rankings) ? 1 : 0.95 }}
                >
                  &gt;
                </motion.button>
              </div>
            )}
          </>
        )}
      </div>
    ),
    [leaderboardLoading, leaderboardError, rankings, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange, renderUserRow]
  );

  // Handle Twitter redirect callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('twitterConnected') === 'true' && status === 'authenticated') {
      const cacheKey = `userData-${session.user.id}`;
      const leaderboardCacheKey = `leaderboard-${session.user.id}`;
      Promise.all([
        clearCache(cacheKey),
        clearCache(leaderboardCacheKey),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['leaderboard', session?.user?.id, csrfToken]),
      ])
        .then(() => {
          return Promise.all([
            queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
            queryClient.refetchQueries(['leaderboard', session?.user?.id, csrfToken]),
          ]);
        })
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          toast.success('Twitter connected successfully!', { position: 'top-center', autoClose: 5000 });
        })
        .catch((err) => {
          logger.error('Error handling Twitter connection callback:', err);
          toast.error('Failed to refresh data after Twitter connection.', {
            position: 'top-center',
            autoClose: 5000,
          });
        });
    }
  }, [session, csrfToken, queryClient, status]);

  const handleManualCacheClear = async () => {
    try {
      await clearAllCaches(session.user.id);
      toast.success('Cache cleared successfully.', { position: 'top-center', autoClose: 5000 });
      window.location.reload();
    } catch (err) {
      logger.error('Error clearing cache:', err);
      toast.error('Failed to clear cache.', { position: 'top-center', autoClose: 5000 });
    }
  };

  if (status === 'loading' || csrfLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-2 bg-black/80 rounded-2xl flex flex-col h-[calc(100vh-3rem)] overflow-y-auto hide-scrollbar"
      >
        <LoadingOverlay isLoading={true} isMobile={isMobile} />
      </motion.div>
    );
  }

  if (!session) {
    return <LoginPrompt />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-4 bg-gradient-to-br from-black to-gray-900 flex flex-col h-[calc(100vh-6rem)] overflow-y-auto hide-scrollbar"
    >
      <ToastContainer
        position="top-center"
        autoClose={5000}
        theme="dark"
        toastStyle={{
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
        }}
      />
      <div className="flex flex-col flex-1 gap-3 sm:gap-4">
        <motion.div
          className="min-h-[25vh] border border-white/10 rounded-xl flex flex-col relative bg-gradient-to-br from-black/50 to-gray-900/50 shadow-2xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="p-3 rounded-xl">
            <LoadingOverlay isLoading={userLoading} isMobile={isMobile} />
            {userError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-[8px] sm:text-[10px] p-2 text-center mb-2 bg-red-500/10 rounded-lg border border-red-500/20"
              >
                Error: {userError.message}
              </motion.div>
            )}
            {userData && (
              <div>
                <div className="absolute top-3 right-3">
                  <motion.button
                    onClick={onSignOut}
                    disabled={isSigningOut}
                    className={`p-2 rounded-full bg-white/10 ${isSigningOut ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-500/30'}`}
                    whileHover={{ scale: isSigningOut ? 1 : 1.05 }}
                    whileTap={{ scale: isSigningOut ? 1 : 0.9 }}
                    aria-label="Sign out"
                  >
                    {isSigningOut ? (
                      <span className="text-[8px] sm:text-[10px] text-white">Signing out...</span>
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
                <div className="flex items-center gap-2 mb-3">
                  <Image
                    src={getProfilePictureSrc(userData.profilePicture, userData.twitterHandle, userData.googleName)}
                    alt={userData.googleName || userData.twitterHandle || 'User Avatar'}
                    width={40}
                    height={40}
                    className="rounded-xl border-2 border-white/20 shadow-lg"
                  />
                  <h4 className="text-base sm:text-xl font-bold text-white bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                    {userData.googleName || userData.email}
                  </h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-[9px] sm:text-[11px]">
                  <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/20 shadow-lg">
                    <h5 className="font-bold text-white uppercase mb-2 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      Account Info
                    </h5>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-white/70">Tier:</span>
                        <div className="flex items-center gap-1">
                          {userData.tier === 'Basic' ? (
                            <>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="w-3 h-3 text-gray-400"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                              </svg>
                              <span className="text-gray-300">{userData.tier}</span>
                            </>
                          ) : (
                            <>
                              <Crown className="w-3 h-3 text-yellow-400" />
                              <span className="text-yellow-300">{userData.tier}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-white/70">Days Active:</span>
                        <span className="text-white font-semibold flex items-center gap-1">
                          {getDaysActive()}
                          {userData.streak >= 7 && (
                            <Flame className="w-3 h-3 text-orange-500 animate-pulse" />
                          )}
                          {userData.streak >= 7 && <span className="text-orange-400 text-xs">({userData.streak} streak)</span>}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/20 shadow-lg relative">
                    <h5 className="font-bold text-white uppercase mb-2 flex items-center gap-1">
                      <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
                      Social
                    </h5>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-1">
                          <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3 text-blue-400" />
                          <span className="text-white/70">Twitter:</span>
                          {userData.twitterHandle ? (
                            <div className="flex items-center gap-2">
                              <a
                                href={`https://x.com/${userData.twitterHandle}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-neon-blue hover:text-blue-300 flex items-center gap-1"
                              >
                                @{userData.twitterHandle}
                                <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
                              </a>
                              <motion.button
                                onClick={() => disconnectTwitterMutation.mutate()}
                                disabled={disconnectTwitterMutation.isLoading}
                                className={`p-1.5 rounded-full bg-red-500/20 ${disconnectTwitterMutation.isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-500/40'}`}
                                whileHover={{ scale: disconnectTwitterMutation.isLoading ? 1 : 1.05 }}
                                whileTap={{ scale: disconnectTwitterMutation.isLoading ? 1 : 0.95 }}
                                title="Disconnect Twitter"
                              >
                                {disconnectTwitterMutation.isLoading ? (
                                  <span className="text-[8px] text-white">...</span>
                                ) : (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="w-3 h-3 text-red-400"
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
                          ) : (
                            <span className="text-white/50">Not connected</span>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-1">
                          <img src="/logos/google.webp" alt="Google Logo" className="w-3 h-3" />
                          <span className="text-white/70">Google:</span>
                          <span className="text-neon-blue truncate max-w-32">{userData.email}</span>
                        </div>
                      </div>
                    </div>
                    {!userData.twitterHandle && (
                      <motion.button
                        onClick={() => connectTwitterMutation.mutate()}
                        className="absolute bottom-2 right-2 px-3 py-1 rounded-xl text-[9px] sm:text-[11px] font-medium text-neon-blue border border-neon-blue/50 bg-white/5 hover:bg-neon-blue/20 transition-all duration-300 shadow-lg"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <img src="/logos/x.webp" alt="X Logo" className="inline w-3 h-3 mr-1" /> Connect Twitter
                      </motion.button>
                    )}
                  </div>
                  <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/20 shadow-lg">
                    <h5 className="font-bold text-white uppercase mb-2 flex items-center gap-1">
                      <Crown className="w-3 h-3 text-yellow-400" />
                      Points
                    </h5>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-white/70">Total Points:</span>
                        <span className="text-neon-blue text-base font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                          {userData?.points || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Daily Check-in Bar */}
        {userData && (
          <DailyCheckinBar
            last7Days={userData.last7Days}
            streak={userData.streak}
            onCheckin={handleDailyCheckin}
            isLoading={verifyTaskMutation.isLoading}
            userData={userData}
          />
        )}

        {/* Tab Navigation - Enhanced */}
        <motion.div
          className="border border-white/10 rounded-xl bg-gradient-to-r from-black/30 to-gray-900/30 flex flex-col shadow-xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="border-b border-white/10 bg-black/20 flex h-[48px]">
            {['tasks', 'leaderboard'].map((tab) => (
              <motion.button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 text-xs font-bold text-white uppercase tracking-wider py-2 relative transition-all duration-300 flex items-center justify-center gap-1 ${activeTab === tab 
                  ? 'border-b-2 border-white/60 text-white shadow-lg' 
                  : 'text-white/70 hover:text-neon-blue hover:bg-white/5'
                }`}
              >
                {tab === 'tasks' && <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2V12H2C2 6.47715 6.47715 2 12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12H12V2C17.5228 2 22 6.47715 22 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>}
                {tab === 'leaderboard' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </motion.button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            {activeTab === 'tasks' && renderTasksSection()}
            {activeTab === 'leaderboard' && renderLeaderboardSection()}
          </AnimatePresence>
        </motion.div>
      </div>
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