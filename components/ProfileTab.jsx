// components/ProfileTab.jsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { useSession, signOut } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts';
import { ethers } from 'ethers';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { cacheData, getCachedData, clearCache, clearAllCaches } from '../utils/indexedDB';
import { LoadingOverlay } from '@/utils/helpers';
import { debounce } from 'lodash';
import LoginPrompt from './LoginPrompt';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

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
  const [currentPage, setCurrentPage] = useState({ tasks: 1, leaderboard: 1, points: 1 });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const itemsPerPage = 10;

  // Handle responsive design
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

  // Execute reCAPTCHA
  const debouncedExecuteRecaptcha = useCallback(
    async (action, retries = 2) => {
      if (process.env.NODE_ENV === 'development') return 'development-token';
      if (!recaptchaRef.current) {
        console.error('reCAPTCHA ref is null');
        throw new Error('reCAPTCHA not initialized');
      }
      try {
        await recaptchaRef.current.reset();
        const token = await Promise.race([
          recaptchaRef.current.executeAsync({ action }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 30000)),
        ]);
        if (!token) throw new Error('Empty reCAPTCHA token');
        console.log(`reCAPTCHA token for ${action}: ${token.substring(0, 10)}...`);
        return token;
      } catch (error) {
        console.error(`reCAPTCHA error for ${action}: ${error.message}`);
        if (retries > 0 && (error.message.includes('timeout') || error.message.includes('network'))) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return debouncedExecuteRecaptcha(action, retries - 1);
        }
        throw new Error(`reCAPTCHA failed after ${3 - retries} attempts: ${error.message}`);
      }
    },
    [recaptchaRef]
  );

  // Set CSRF cookie
  const setCsrfCookie = (csrfToken) => {
    if (process.env.NODE_ENV === 'development') {
      document.cookie = `csrf_token=dev-csrf; path=/; SameSite=Strict`;
    } else {
      document.cookie = `csrf_token=${csrfToken}; path=/; SameSite=Strict; ${process.env.NODE_ENV === 'production' ? 'Secure' : ''}`;
    }
  };

  // Fetch CSRF Token
  const { data: csrfToken, isLoading: csrfLoading, error: csrfError } = useQuery({
    queryKey: ['csrfToken'],
    queryFn: async () => {
      // Check localStorage first
      const cachedToken = localStorage.getItem('csrfToken');
      if (cachedToken && cachedToken === 'dev-csrf' && process.env.NODE_ENV === 'development') {
        console.log('Using cached CSRF token from localStorage:', cachedToken);
        setCsrfCookie(cachedToken);
        return cachedToken;
      }

      const response = await axios.get(`${API_BASE_URL}/api/csrf-token`, { withCredentials: true }).catch(err => {
        console.error('CSRF token fetch error:', err.response?.status, err.response?.data || err.message);
        if (err.response?.status === 429) {
          throw new Error('Too many requests for CSRF token. Please wait and try again.');
        }
        throw err;
      });
      console.log('CSRF Token fetched:', response.data.csrfToken);
      if (!response.data.csrfToken) throw new Error('Empty CSRF token received');
      setCsrfCookie(response.data.csrfToken); // Set cookie
      return response.data.csrfToken;
    },
    retry: (failureCount, error) => {
      if (error.message.includes('Too many requests')) {
        return false; // Don't retry on 429
      }
      return failureCount < 3;
    },
    retryDelay: 2000,
    enabled: status === 'authenticated',
    staleTime: 24 * 60 * 60 * 1000, // Cache for 1 day
    onSuccess: (csrf) => {
      localStorage.setItem('csrfToken', csrf);
      setCsrfCookie(csrf); // Ensure cookie is set on success
    },
    onError: (err) => {
      console.error('CSRF token fetch failed:', err);
      toast.error(`Failed to fetch CSRF token: ${err.message}`, {
        position: 'top-center',
        autoClose: 5000,
      });
    },
  });

  // Fetch User Data
  const { data: userData, isLoading: userLoading, error: userError } = useQuery({
    queryKey: ['userData', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `userData-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) {
        console.log('Using cached userData:', cached);
        if (cached.twitterHandle && window.location.search.includes('twitterConnected=true')) {
          console.log('Invalidating cache due to recent Twitter connection');
          await clearCache(cacheKey);
          throw new Error('Cache invalidated due to Twitter connection');
        }
        return cached;
      }

      const token = await debouncedExecuteRecaptcha('get_user');
      console.log('Fetching user data with UID:', session.user.id, 'CSRF:', csrfToken, 'Recaptcha:', token.substring(0, 10) + '...');
      const response = await axios.get(`${API_BASE_URL}/api/user?uid=${encodeURIComponent(session.user.id)}`, {
        headers: {
          'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken,
          'X-Recaptcha-Token': token,
        },
        withCredentials: true,
      });
      console.log('User API response:', response.data);
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to fetch user data');
      const user = {
        ...response.data.user,
        isPremium: response.data.user.isPremium || false,
        tier: response.data.user.isPremium ? 'Premium' : response.data.user.tier || 'Basic',
        twitterHandle: response.data.user.twitterHandle || null,
      };
      console.log('Transformed user data:', user);
      await cacheData(cacheKey, user, 24 * 60 * 60 * 1000);
      return user;
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 1 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    onError: async (err) => {
      console.error('Error fetching user data:', err);
      if (err.response?.status === 429) {
        toast.error('Too many requests. Please wait and try again.', {
          position: 'top-center',
          autoClose: 5000,
        });
      } else if (err.response?.status === 404) {
        await signOut({ redirect: false });
        window.location.href = '/auth/signin';
      } else {
        toast.error(`Failed to fetch user data: ${err.message}`, {
          position: 'top-center',
          autoClose: 5000,
        });
      }
    },
  });

  // Fetch Tasks
  const { data: tasks, isLoading: tasksLoading, error: tasksError } = useQuery({
    queryKey: ['tasks', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `tasks-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) return cached;

      const response = await axios.get(`${API_BASE_URL}/api/tasks`, {
        headers: {
          'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken,
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

  // Fetch Task Progress
  const { data: taskProgress, isLoading: taskProgressLoading, error: taskProgressError } = useQuery({
    queryKey: ['taskProgress', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `taskProgress-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) return cached;

      const token = await debouncedExecuteRecaptcha('task_progress');
      const response = await axios.get(`${API_BASE_URL}/api/task-progress?uid=${session.user.id}`, {
        headers: {
          'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken,
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

  // Fetch Point History
  const { data: pointData, isLoading: pointLoading, error: pointError } = useQuery({
    queryKey: ['pointHistory', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `pointHistory-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) return cached;

      const recaptchaToken = await debouncedExecuteRecaptcha('get_point_history');
      const historyResponse = await axios.get(`${API_BASE_URL}/api/point-history?uid=${session.user.id}`, {
        headers: {
          'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken,
          'X-Recaptcha-Token': recaptchaToken,
        },
        withCredentials: true,
      });

      if (!historyResponse.data.success) throw new Error('Invalid point history data.');
      return historyResponse.data;
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
        console.log('Using cached leaderboard:', cached);
        return cached;
      }

      const token = await debouncedExecuteRecaptcha('connect_data');
      console.log('Fetching leaderboard with CSRF:', csrfToken, 'Recaptcha:', token.substring(0, 10) + '...');
      const response = await axios.get(`${API_BASE_URL}/api/connect-data`, {
        headers: {
          'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken,
          'X-Recaptcha-Token': token,
          // Remove Authorization header since server supports session-based auth
        },
        withCredentials: true,
      }).catch(err => {
        console.error('Leaderboard fetch error:', err.response?.data || err.message);
        throw err;
      });
      console.log('Leaderboard API response:', response.data);
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to fetch leaderboard.');
      await cacheData(cacheKey, response.data.rankings, 5 * 60 * 1000);
      return response.data.rankings;
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 30 * 60 * 1000,
    retry: 1,
    retryDelay: 2000,
    onError: (err) => {
      console.error('Leaderboard error:', err);
      toast.error(`Failed to fetch leaderboard: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  // Connect Twitter
  const connectTwitterMutation = useMutation({
    mutationFn: async () => {
      console.log('Initiating Twitter connection for user:', session.user.id);
      window.location.href = '/api/twitter/connect';
    },
    onError: (err) => {
      console.error('Connect Twitter error:', err);
      toast.error(`Unable to connect Twitter: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  // Disconnect Twitter
  const disconnectTwitterMutation = useMutation({
    mutationFn: async () => {
      console.log('Initiating Twitter disconnect for user:', session.user.id);
      const token = await debouncedExecuteRecaptcha('disconnect_twitter');
      console.log('reCAPTCHA Token for disconnect:', token.substring(0, 10) + '...');
      const response = await axios.post(
        `${API_BASE_URL}/twitter/connect`,
        { action: 'disconnect', uid: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken, 'Content-Type': 'application/json' },
          withCredentials: true,
        }
      ).catch(err => {
        console.error('Disconnect Twitter error:', err.response?.data || err.message);
        throw err;
      });
      console.log('Disconnect Twitter response:', response.data);
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to disconnect Twitter');
      await clearAllCaches(session.user.id);
    },
    onSuccess: async () => {
      console.log('Twitter disconnected successfully');
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
      console.error('Disconnect Twitter mutation error:', err);
      const errorMessage = err.response?.status === 429
        ? 'Too many requests. Please try again later.'
        : err.response?.status === 403
          ? 'Authentication failed. Please try again.'
          : err.response?.data?.detail || 'Unable to disconnect Twitter';
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    },
  });

  // Handle Wallet Connection
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
        `${API_BASE_URL}/verify-wallet`,
        { action: 'verify-wallet', walletAddress, signature, message, uid: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken, 'Content-Type': 'application/json' },
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

  // Handle Wallet Disconnection
  const disconnectWalletMutation = useMutation({
    mutationFn: async () => {
      const token = await debouncedExecuteRecaptcha('disconnect-wallet');
      const response = await axios.post(
        `${API_BASE_URL}/verify-wallet`,
        { action: 'disconnect-wallet', uid: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken, 'Content-Type': 'application/json' },
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
      toast.error(`Unable to disconnect wallet: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  const debouncedHandleSignOut = useCallback(
    debounce(() => handleSignOut(), 1000, { leading: true, trailing: false }),
    [handleSignOut]
  );

  // Handle Task Verification
  const verifyTaskMutation = useMutation({
    mutationFn: async (task) => {
      const token = await debouncedExecuteRecaptcha('verify_task');
      const response = await axios.post(
        `${API_BASE_URL}/api/twitter/verify-task`,
        { taskId: task.id, userId: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': process.env.NODE_ENV === 'development' ? 'dev-csrf' : csrfToken, 'Content-Type': 'application/json' },
          withCredentials: true,
        }
      );
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to verify task');
      return response.data;
    },
    onSuccess: (data, task) => {
      toast.success(`Task ${task.description} verified! +${task.points} points`, { position: 'top-center', autoClose: 5000 });
      queryClient.invalidateQueries(['taskProgress', session?.user?.id, csrfToken]);
      queryClient.invalidateQueries(['pointHistory', session?.user?.id, csrfToken]);
      queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]);
    },
    onError: (err) => {
      toast.error(
        err.response?.status === 429
          ? 'API rate limit exceeded. Please try again later.'
          : err.response?.status === 403
            ? 'Authentication failed. Please try again.'
            : err.message.includes('reCAPTCHA')
              ? 'reCAPTCHA verification failed. Please try again.'
              : err.message.includes('Twitter account not connected')
                ? 'Please connect your Twitter account to perform this task.'
                : `Verification failed: ${err.message}`,
        { position: 'top-center', autoClose: 5000 }
      );
    },
  });

  // Get Days Active
  const getDaysActive = useCallback(() => {
    if (!userData?.lastConnected) return 0;
    const lastConnectedDate = new Date(userData.lastConnected);
    const currentDate = new Date();
    const diffTime = Math.abs(currentDate - lastConnectedDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }, [userData]);

  // Pagination
  const getPaginatedData = useCallback((data, tab) => {
    const startIndex = (currentPage[tab] - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return data.slice(startIndex, endIndex);
  }, [currentPage]);

  const getTotalPages = useCallback((data) => Math.ceil(data.length / itemsPerPage), []);

  const handlePageChange = useCallback((tab, page) => {
    setCurrentPage((prev) => ({ ...prev, [tab]: page }));
  }, []);

  // Get Profile Picture Src
  const getProfilePictureSrc = useCallback((profilePicture) => {
    if (profilePicture && profilePicture.startsWith('http')) {
      try {
        const url = new URL(profilePicture);
        const allowedHosts = ['pbs.twimg.com', 'lh3.googleusercontent.com', 'example.com'];
        if (allowedHosts.includes(url.hostname)) {
          return profilePicture;
        }
      } catch (err) {
        console.warn(`Invalid profile picture URL: ${profilePicture}`, err);
      }
    }
    return '/default-avatar.png';
  }, []);

  // Render User Row for Leaderboard
  const renderUserRow = useCallback(
    (user, index, isCurrentUser = false) => {
      const rank = isCurrentUser ? rankings.findIndex((u) => u.id === user.id) + 1 || 'N/A' : index + 1;
      const rankStyles = {
        1: 'bg-gradient-to-r from-neon-blue/20 to-transparent border-neon-blue/50',
        2: 'bg-gradient-to-r from-gray-400/20 to-transparent border-gray-400/50',
        3: 'bg-gradient-to-r from-pink-400/20 to-transparent border-pink-400/50',
      };

      return (
        <motion.tr
          key={user.id}
          className={`border-t border-white/10 hover:bg-white/5 ${rankStyles[rank] || ''}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.02 }}
        >
          <td className="px-2 py-2 text-white text-[8px] sm:text-[10px]">{rank}</td>
          <td className="px-2 py-2 text-white text-[8px] sm:text-[10px]">
            <div className="flex items-center">
              <Image
                src={getProfilePictureSrc(user.profilePicture || user.profile_picture)}
                alt={user.googleName || user.twitterHandle || 'User Avatar'}
                width={16}
                height={16}
                className="rounded-full border border-white/10 mr-2 object-cover"
              />
              <span className="truncate">
                {user.googleName || user.twitterHandle || 'Anonymous'}
                {isCurrentUser && (
                  <span className="ml-2 text-[7px] sm:text-[8px] font-medium text-neon-blue px-2 py-0.5 rounded-full border border-neon-blue/50 bg-white/5">
                    You
                  </span>
                )}
              </span>
            </div>
          </td>
          <td className="px-2 py-2 text-neon-blue text-[8px] sm:text-[10px] text-right">{user.points || 0}</td>
        </motion.tr>
      );
    },
    [isMobile, rankings, getProfilePictureSrc]
  );

  // Render Tasks Section
  const renderTasksSection = useCallback(() => (
    <div className="overflow-y-auto min-h-[calc(50vh)] max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] hide-scrollbar">
      <LoadingOverlay isLoading={tasksLoading || taskProgressLoading} isMobile={isMobile} />
      {tasksError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-red-400 text-[8px] sm:text-[10px] p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-center"
        >
          Error: {tasksError.message}
        </motion.div>
      )}
      {!tasks?.length && !tasksError && !(tasksLoading || taskProgressLoading) && (
        <p className="text-[8px] sm:text-[10px] text-white/60 text-center p-2">No tasks available.</p>
      )}
      {tasks?.length > 0 && (
        <>
          {!userData?.twitterHandle && (
            <motion.div
              className="mb-2 p-2 text-center"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <p className="text-[8px] sm:text-[10px] text-white/80 mb-2">
                Connect your Twitter account to perform tasks.
              </p>
              <motion.button
                onClick={() => connectTwitterMutation.mutate()}
                className="px-3 py-1 rounded-xl text-[8px] sm:text-[10px] font-medium text-neon-blue border border-neon-blue/50 bg-white/5 hover:bg-neon-blue/20 transition-all duration-300"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Connect Twitter
              </motion.button>
            </motion.div>
          )}
          <table className="w-full text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className="px-2.5 py-1.5 text-white text-left font-semibold">Task</th>
                <th className="px-2.5 py-1.5 text-white text-left font-semibold">Points</th>
                <th className="px-2.5 py-1.5 text-white text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {getPaginatedData(tasks, 'tasks').map((task) => (
                <motion.tr
                  key={task.id}
                  className="border-t border-white/10 hover:bg-white/5"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <td className="px-2 py-2 text-white text-xs">
                    {task.description}{' '}
                    {task.is_daily
                      ? `(Daily ${taskProgress?.[task.id]?.completionCount || 0}/${task.max_completions})`
                      : ''}
                    {task.task_type === 'follow' && (
                      <a
                        href={`https://x.com/intent/follow?screen_name=XynapseAI`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[8px] sm:text-xs text-neon-blue underline block mt-1"
                      >
                        Follow @XynapseAI
                      </a>
                    )}
                    {task.task_type === 'retweet' && (
                      <a
                        href={`https://x.com/intent/retweet?tweet_id=${task.target_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[8px] sm:text-xs text-neon-blue underline block mt-1"
                      >
                        Retweet this post
                      </a>
                    )}
                  </td>
                  <td className="px-2 py-2 text-neon-green text-xs">+{task.points}</td>
                  <td className="px-2 py-2 text-xs">
                    <motion.button
                      onClick={() => verifyTaskMutation.mutate(task)}
                      disabled={
                        verifyTaskMutation.isLoading ||
                        (!userData?.twitterHandle && task.task_type !== 'daily_checkin') ||
                        (task.is_daily && (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions) ||
                        (!task.is_daily && taskProgress?.[task.id]?.completionCount >= task.max_completions)
                      }
                      className={`px-3 py-1 rounded-xl text-[8px] sm:text-xs font-medium transition-all duration-300 border border-white/10 bg-white/5 ${verifyTaskMutation.isLoading ||
                        (!userData?.twitterHandle && task.task_type !== 'daily_checkin') ||
                        (task.is_daily && (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions) ||
                        (!task.is_daily && taskProgress?.[task.id]?.completionCount >= task.max_completions)
                        ? 'text-white/50 cursor-not-allowed opacity-50'
                        : 'text-white hover:bg-neon-blue/20'
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
                      {verifyTaskMutation.isLoading ? 'Verifying...' : 'Verify'}
                    </motion.button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 mt-2">
            <motion.button
              onClick={() => handlePageChange('tasks', currentPage.tasks - 1)}
              disabled={currentPage.tasks === 1}
              className={`px-3 py-1 text-[8px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 rounded-xl ${currentPage.tasks === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
                }`}
              whileHover={{ scale: currentPage.tasks === 1 ? 1 : 1.05 }}
              whileTap={{ scale: currentPage.tasks === 1 ? 1 : 0.95 }}
            >
              &lt;
            </motion.button>
            <span className="text-[8px] sm:text-[10px] text-white/60 mt-1">
              {currentPage.tasks} / {getTotalPages(tasks)}
            </span>
            <motion.button
              onClick={() => handlePageChange('tasks', currentPage.tasks + 1)}
              disabled={currentPage.tasks === getTotalPages(tasks)}
              className={`px-3 py-1 text-[8px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 rounded-xl ${currentPage.tasks === getTotalPages(tasks) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
                }`}
              whileHover={{ scale: currentPage.tasks === getTotalPages(tasks) ? 1 : 1.05 }}
              whileTap={{ scale: currentPage.tasks === getTotalPages(tasks) ? 1 : 0.95 }}
            >
              &gt;
            </motion.button>
          </div>
        </>
      )}
    </div>
  ), [tasks, tasksLoading, taskProgressLoading, tasksError, taskProgress, verifyTaskMutation, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange, connectTwitterMutation]);

  // Render Leaderboard Section
  const renderLeaderboardSection = useCallback(() => (
    <div className="overflow-y-auto min-h-[calc(50vh)] max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] hide-scrollbar">
      <LoadingOverlay isLoading={leaderboardLoading} isMobile={isMobile} />
      {leaderboardError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-red-400 text-[8px] sm:text-[10px] p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-center"
        >
          Error: {leaderboardError.message}
          <button
            onClick={() => window.location.reload()}
            className="ml-2 px-2 py-1 bg-neon-blue text-black rounded-xl text-[8px] sm:text-[10px]"
          >
            Retry
          </button>
        </motion.div>
      )}
      {!leaderboardLoading && !leaderboardError && rankings?.length === 0 && (
        <p className="text-[8px] sm:text-[10px] text-white/60 text-center p-2">No ranking data available.</p>
      )}
      {!leaderboardLoading && rankings?.length > 0 && (
        <>
          <table className="w-full text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className="px-2.5 py-1.5 text-white text-left font-semibold">Rank</th>
                <th className="px-2.5 py-1.5 text-white text-left font-semibold">User</th>
                <th className="px-2.5 py-1.5 text-white text-right font-semibold">Points</th>
              </tr>
            </thead>
            <tbody>
              {userData && renderUserRow(userData, -1, true)}
              {getPaginatedData(rankings, 'leaderboard').map((user, index) => renderUserRow(user, index, false))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 mt-2">
            <motion.button
              onClick={() => handlePageChange('leaderboard', currentPage.leaderboard - 1)}
              disabled={currentPage.leaderboard === 1}
              className={`px-3 py-1 text-[8px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 rounded-xl ${currentPage.leaderboard === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
                }`}
              whileHover={{ scale: currentPage.leaderboard === 1 ? 1 : 1.05 }}
              whileTap={{ scale: currentPage.leaderboard === 1 ? 1 : 0.95 }}
            >
              &lt;
            </motion.button>
            <span className="text-[8px] sm:text-[10px] text-white/60 mt-1">
              {currentPage.leaderboard} / {getTotalPages(rankings)}
            </span>
            <motion.button
              onClick={() => handlePageChange('leaderboard', currentPage.leaderboard + 1)}
              disabled={currentPage.leaderboard === getTotalPages(rankings)}
              className={`px-3 py-1 text-[8px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 rounded-xl ${currentPage.leaderboard === getTotalPages(rankings) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
                }`}
              whileHover={{ scale: currentPage.leaderboard === getTotalPages(rankings) ? 1 : 1.05 }}
              whileTap={{ scale: currentPage.leaderboard === getTotalPages(rankings) ? 1 : 0.95 }}
            >
              &gt;
            </motion.button>
          </div>
        </>
      )}
    </div>
  ), [leaderboardLoading, leaderboardError, rankings, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange, renderUserRow]);

  // Render Points Section
  const renderPointsSection = useCallback(() => (
    <div className="flex flex-col gap-4">
      <div className="min-h-[calc(50vh)] max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] bg-white/5 rounded-xl p-2 border border-white/10">
        <LoadingOverlay isLoading={pointLoading} isMobile={isMobile} />
        {pointError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[8px] sm:text-[10px] p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-center"
          >
            Error: {pointError.message}
          </motion.div>
        )}
        {!pointLoading && !pointError && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pointData?.history} margin={{ top: 10, right: 15, bottom: 5, left: isMobile ? 0 : 10 }}>
              <CartesianGrid stroke="#ffffff1a" strokeDasharray="5 5" />
              <XAxis
                dataKey="date"
                stroke="#FFFFFF"
                tick={{ fontSize: isMobile ? 6 : 8, fill: '#FFFFFF' }}
                angle={-45}
                textAnchor="end"
                height={50}
              />
              <YAxis
                stroke="#FFFFFF"
                tick={{ fontSize: isMobile ? 6 : 8, fill: '#FFFFFF' }}
                tickFormatter={(value) => Math.floor(value).toLocaleString('en-US')}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="taskPoints"
                stroke="#FFFFFF"
                fill="url(#chartGradient)"
                strokeWidth={3}
                dot={false}
                activeDot={{ fill: '#FFFFFF', r: 4, stroke: '#FFFFFF', strokeWidth: 3 }}
              />
              <ReferenceDot
                x={pointData?.history[pointData.history.length - 1]?.date}
                y={pointData?.history[pointData.history.length - 1]?.taskPoints}
                r={4}
                fill="#FFFFFF"
                stroke="#FFFFFF"
                strokeWidth={3}
                className="animate-pulse"
              />
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.05} />
                </linearGradient>
              </defs>
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <motion.div
          className="rounded-xl border border-white/10 bg-white/5 p-2 min-h-[100px] flex flex-col items-center justify-center"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <h3 className="text-[8px] sm:text-[10px] font-bold text-white uppercase tracking-wider mb-2">
            Total Points
          </h3>
          <p className="text-xl sm:text-2xl font-bold text-neon-blue">{userData?.points || 0}</p>
        </motion.div>
        <motion.div
          className="rounded-xl border border-white/10 bg-white/5 p-2 min-h-[100px] flex flex-col items-center justify-center"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <h3 className="text-[8px] sm:text-[10px] font-bold text-white uppercase tracking-wider mb-2">
            Task Points
          </h3>
          <div className="flex items-center justify-center gap-2">
            <p className="text-xl sm:text-2xl font-bold text-neon-blue">{pointData?.taskPoints || 0}</p>
            <motion.p
              className={`text-[8px] sm:text-[10px] font-semibold text-${pointData?.taskGrowth.color} ${pointData?.taskGrowth.value != 0 ? 'animate-pulse' : ''
                }`}
              animate={{ opacity: pointData?.taskGrowth.value != 0 ? [1, 0.7, 1] : 1 }}
              transition={{ duration: 1.5, repeat: pointData?.taskGrowth.value != 0 ? Infinity : 0 }}
            >
              {pointData?.taskGrowth.value}%{' '}
              {pointData?.taskGrowth.value > 0 ? '↑' : pointData?.taskGrowth.value < 0 ? '↓' : '–'}
            </motion.p>
          </div>
        </motion.div>
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <motion.button
          onClick={() => handlePageChange('points', currentPage.points - 1)}
          disabled={currentPage.points === 1}
          className={`px-3 py-1 text-[8px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 rounded-xl ${currentPage.points === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
            }`}
          whileHover={{ scale: currentPage.points === 1 ? 1 : 1.05 }}
          whileTap={{ scale: currentPage.points === 1 ? 1 : 0.95 }}
        >
          &lt;
        </motion.button>
        <span className="text-[8px] sm:text-[10px] text-white/60 mt-1">
          {currentPage.points} / {getTotalPages(pointData?.history || [])}
        </span>
        <motion.button
          onClick={() => handlePageChange('points', currentPage.points + 1)}
          disabled={currentPage.points === getTotalPages(pointData?.history || [])}
          className={`px-3 py-1 text-[8px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 rounded-xl ${currentPage.points === getTotalPages(pointData?.history || []) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
            }`}
          whileHover={{ scale: currentPage.points === getTotalPages(pointData?.history || []) ? 1 : 1.05 }}
          whileTap={{ scale: currentPage.points === getTotalPages(pointData?.history || []) ? 1 : 0.95 }}
        >
          &gt;
        </motion.button>
      </div>
    </div>
  ), [pointLoading, pointError, pointData, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange]);

  // Handle Twitter redirect callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('twitterConnected') === 'true' && status === 'authenticated') {
      console.log('Detected Twitter connection callback, clearing cache and refetching data');
      const cacheKey = `userData-${session.user.id}`;
      const leaderboardCacheKey = `leaderboard-${session.user.id}`;
      Promise.all([
        clearCache(cacheKey),
        clearCache(leaderboardCacheKey),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['leaderboard', session?.user?.id, csrfToken]),
      ])
        .then(() => {
          console.log('Cache cleared, refetching queries');
          return Promise.all([
            queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
            queryClient.refetchQueries(['leaderboard', session?.user?.id, csrfToken]),
          ]);
        })
        .then(() => {
          console.log('Queries refetched successfully');
          window.history.replaceState({}, document.title, window.location.pathname);
          toast.success('Twitter connected successfully!', { position: 'top-center', autoClose: 5000 });
        })
        .catch((err) => {
          console.error('Error handling Twitter connection callback:', err);
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
      console.log('Manual cache cleared');
      toast.success('Cache cleared successfully.', { position: 'top-center', autoClose: 5000 });
      window.location.reload();
    } catch (err) {
      console.error('Error clearing cache:', err);
      toast.error('Failed to clear cache.', { position: 'top-center', autoClose: 5000 });
    }
  };

  if (status === 'loading' || csrfLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-2 bg-black/80 flex flex-col h-[calc(100vh-3rem)] overflow-y-auto hide-scrollbar"
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
      className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-2 bg-black/80 flex flex-col h-[calc(100vh-3rem)] overflow-y-auto hide-scrollbar"
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
      <div className="flex flex-col flex-1 gap-4 sm:gap-6">
        <motion.div
          className="min-h-[30vh] border border-white/10 rounded-xl flex flex-col relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="p-4">
            <LoadingOverlay isLoading={userLoading} isMobile={isMobile} />
            {userError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-[8px] sm:text-[10px] p-2 text-center mb-2"
              >
                Error: {userError.message}
                <button
                  onClick={handleManualCacheClear}
                  className="ml-2 px-2 py-1 bg-neon-blue text-black rounded-xl text-[8px] sm:text-[10px]"
                >
                  Clear Cache & Retry
                </button>
              </motion.div>
            )}
            {userData && (
              <div>
                <div className="absolute top-4 right-4">
                  <motion.button
                    onClick={onSignOut}
                    disabled={isSigningOut}
                    className={`p-1 ${isSigningOut ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-500/30'}`}
                    whileHover={{ scale: isSigningOut ? 1 : 1.05 }}
                    whileTap={{ scale: isSigningOut ? 1 : 0.9 }}
                    aria-label="Sign out"
                  >
                    {isSigningOut ? (
                      <span className="text-[8px] sm:text-[10px] text-white">Signing out...</span>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#F87171"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    )}
                  </motion.button>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <Image
                    src={getProfilePictureSrc(userData.profilePicture)}
                    alt={userData.googleName || 'Google User'}
                    width={32}
                    height={32}
                    className="rounded-full border border-white/10"
                  />
                  <h4 className="text-base sm:text-lg font-bold text-white">{userData.googleName || userData.email}</h4>
                </div>
                <div className="text-[9px] sm:text-[11px] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-white/5 rounded-xl p-3">
                    <h5 className="font-bold text-white uppercase mb-2">Account Info</h5>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-white/60">Email:</span>
                        <span className="text-white">{userData.email}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Tier:</span>
                        <span className="text-white">{userData.tier || 'Basic'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Days Active:</span>
                        <span className="text-white">{getDaysActive()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <h5 className="font-bold text-white uppercase mb-2">Connections</h5>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-white/60">Twitter:</span>
                        <span className="text-white">
                          {userData.twitterHandle ? (
                            <a href={`https://x.com/${userData.twitterHandle}`} target="_blank" rel="noopener noreferrer" className="text-neon-blue">
                              @{userData.twitterHandle}
                            </a>
                          ) : (
                            'Not connected'
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <h5 className="font-bold text-white uppercase mb-2">Points</h5>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-white/60">Total Points:</span>
                        <span className="text-neon-blue text-xs">{userData?.points || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  {!userData.twitterHandle && (
                    <motion.button
                      onClick={() => connectTwitterMutation.mutate()}
                      className="p-1 bg-white/10 rounded-xl hover:bg-white/20"
                      whileHover={{ scale: 1.1, y: -2 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <img src="/logos/x.png" alt="Twitter" className="w-3 h-3" />
                    </motion.button>
                  )}
                  {userData.twitterHandle && (
                    <motion.button
                      onClick={() => disconnectTwitterMutation.mutate()}
                      disabled={disconnectTwitterMutation.isLoading}
                      className={`p-1 bg-white/10 rounded-xl ${disconnectTwitterMutation.isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-400/20'}`}
                      whileHover={{ scale: disconnectTwitterMutation.isLoading ? 1 : 1.1, y: disconnectTwitterMutation.isLoading ? 0 : -2 }}
                      whileTap={{ scale: disconnectTwitterMutation.isLoading ? 1 : 0.9 }}
                    >
                      <img src="/logos/x.png" alt="Disconnect Twitter" className="w-3 h-3" />
                    </motion.button>
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Tab Navigation */}
        <motion.div
          className="border border-white/10 rounded-xl bg-black/20 flex flex-col"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="p-0 border-b border-white/10 bg-white/5 flex gap-4 items-end h-[48px]">
            {['tasks', 'leaderboard', 'points'].map((tab) => (
              <motion.button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-xs font-bold text-white uppercase tracking-wider px-4 py-2 no-hover-effect ${activeTab === tab ? 'border-b-2 border-white' : 'text-white/80 hover:text-white'
                  }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </motion.button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            {activeTab === 'tasks' && renderTasksSection()}
            {activeTab === 'leaderboard' && renderLeaderboardSection()}
            {activeTab === 'points' && renderPointsSection()}
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
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        @media (max-width: 640px) {
          .text-base {
            font-size: 0.875rem;
          }
          .text-lg {
            font-size: 1rem;
          }
          .text-xl {
            font-size: 1rem;
          }
          .text-2xl {
            font-size: 1.25rem;
          }
          .text-[10px] {
            font-size: 8px;
          }
          .text-[8px] {
            font-size: 6px;
          }
          .text-[7px] {
            font-size: 5px;
          }
          .h-[200px] {
            height: 150px;
          }
          .grid-cols-2 {
            grid-template-columns: 1fr;
          }
          .w-32 {
            width: 24px;
            height: 24px;
          }
          .min-h-[100px] {
            min-height: 80px;
          }
        }
        @media (min-width: 641px) and (max-width: 1024px) {
          .grid-cols-3 {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </motion.div>
  );
}