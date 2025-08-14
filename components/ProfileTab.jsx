// components/ProfileTab.jsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { useSession, signOut } from 'next-auth/react';
import Image from 'next/image';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ethers } from 'ethers';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { cacheData, getCachedData, clearCache } from '../utils/indexedDB';
import { LoadingOverlay } from '@/utils/helpers';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function ProfileTab({ recaptchaRef }) {
  const { data: session, status } = useSession();
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 640);
  const [activeTab, setActiveTab] = useState('tasks');
  const [currentPage, setCurrentPage] = useState({ tasks: 1, leaderboard: 1, points: 1 });
  const itemsPerPage = 10;

  // Handle responsive design
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Execute reCAPTCHA
  const executeRecaptcha = useCallback(
    async (action, retries = 4) => {
      if (process.env.NODE_ENV === 'development') return 'development-token';
      if (!recaptchaRef.current) throw new Error('reCAPTCHA not initialized');
      try {
        await recaptchaRef.current.reset();
        const token = await Promise.race([
          recaptchaRef.current.executeAsync({ action }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 30000)),
        ]);
        if (!token) throw new Error('Empty reCAPTCHA token');
        return token;
      } catch (error) {
        if (retries > 0 && (error.message.includes('timeout') || error.message.includes('network'))) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          return executeRecaptcha(action, retries - 1);
        }
        throw new Error(`reCAPTCHA failed after ${5 - retries} attempts: ${error.message}`);
      }
    },
    [recaptchaRef]
  );

  // Fetch CSRF Token
  const { data: csrfToken, isLoading: csrfLoading } = useQuery({
    queryKey: ['csrfToken'],
    queryFn: async () => {
      const response = await axios.get('/api/csrf-token', { withCredentials: true });
      if (!response.data.csrfToken) throw new Error('Empty CSRF token received');
      return response.data.csrfToken;
    },
    retry: 3,
    retryDelay: 2000,
    enabled: status === 'authenticated',
    onSuccess: (csrf) => localStorage.setItem('csrfToken', csrf),
  });

  // Fetch User Data
  const { data: userData, isLoading: userLoading, error: userError } = useQuery({
    queryKey: ['userData', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `userData-${session.user.id}`;
      const cached = await getCachedData(cacheKey);
      if (cached) return cached;

      const token = await executeRecaptcha('get_user');
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
      };
      await cacheData(cacheKey, user, 24 * 60 * 60 * 1000);
      return user;
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 5 * 60 * 1000,
    onError: async (err) => {
      if (err.response?.status === 404) {
        await signOut({ redirect: false });
        window.location.href = '/auth/signin';
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

      const response = await axios.get('/api/tasks', {
        headers: {
          'x-csrf-token': csrfToken || process.env.NEXT_PUBLIC_CSRF_TOKEN,
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

      const token = await executeRecaptcha('task_progress');
      const response = await axios.get(`/api/task-progress?uid=${session.user.id}`, {
        headers: {
          'x-csrf-token': csrfToken || process.env.NEXT_PUBLIC_CSRF_TOKEN,
          'X-Recaptcha-Token': token,
        },
        withCredentials: true,
      });
      const progress = response.data.progress.reduce((acc, completion) => {
        const completionDate = new Date(completion.completedAt);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        if (completionDate >= today) {
          acc[completion.taskId] = completion.completionCount;
        }
        return acc;
      }, {});
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

      const recaptchaToken = await executeRecaptcha('get_user');
      const userResponse = await axios.get(`/api/user?uid=${session.user.id}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'X-Recaptcha-Token': recaptchaToken,
        },
        withCredentials: true,
      });

      if (!userResponse.data.success) throw new Error('Invalid user data.');
      const taskPoints = userResponse.data.user.taskPoints || 0;

      const historyRecaptchaToken = await executeRecaptcha('get_point_history');
      const historyResponse = await axios.get(`/api/point-history?uid=${session.user.id}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'X-Recaptcha-Token': historyRecaptchaToken,
        },
        withCredentials: true,
      });

      const history = (historyResponse.data.history || []).map((item) => ({
        ...item,
        taskPoints: item.taskPoints || 0,
        date: new Date(item.date).toLocaleDateString(),
      }));

      const todayTaskPoints = taskPoints;
      const yesterdayTaskPoints = history.length > 1 ? history[history.length - 2]?.taskPoints || 0 : 0;
      const taskGrowthValue = ((todayTaskPoints - yesterdayTaskPoints) / (yesterdayTaskPoints || 1)) * 100;
      const taskGrowth = {
        value: taskGrowthValue.toFixed(2),
        color: taskGrowthValue > 0 ? 'neon-green' : taskGrowthValue < 0 ? 'red-400' : 'gray-400',
      };

      const data = { history, taskPoints, taskGrowth };
      await cacheData(cacheKey, data, 10 * 60 * 1000);
      return data;
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
      if (cached) return cached;

      const token = await executeRecaptcha('connect_data');
      const response = await axios.get('/api/connect-data', {
        headers: {
          'x-csrf-token': csrfToken,
          'X-Recaptcha-Token': token,
        },
        withCredentials: true,
      });
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to fetch leaderboard.');
      await cacheData(cacheKey, response.data.rankings, 5 * 60 * 1000);
      return response.data.rankings;
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 5 * 60 * 1000,
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
      const token = await executeRecaptcha('verify-wallet');

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
      setUserData((prev) => ({ ...prev, walletAddress }));
    },
    onError: (err) => {
      toast.error(`Unable to connect wallet: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  // Handle Wallet Disconnection
  const disconnectWalletMutation = useMutation({
    mutationFn: async () => {
      const token = await executeRecaptcha('disconnect-wallet');
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
      setUserData((prev) => ({ ...prev, walletAddress: null }));
    },
    onError: (err) => {
      toast.error(`Unable to disconnect wallet: ${err.message}`, { position: 'top-center', autoClose: 5000 });
    },
  });

  // Handle Sign Out
  const handleSignOut = useCallback(async () => {
    try {
      await signOut({ redirect: false });
      await clearCache(`userData-${session.user.id}`);
      await clearCache(`tasks-${session.user.id}`);
      await clearCache(`taskProgress-${session.user.id}`);
      await clearCache(`pointHistory-${session.user.id}`);
      await clearCache(`leaderboard-${session.user.id}`);
      localStorage.removeItem('csrfToken');
      window.location.href = '/auth/signin';
    } catch (err) {
      toast.error('Unable to sign out', { position: 'top-center', autoClose: 5000 });
    }
  }, [session]);

  // Handle Task Verification
  const verifyTaskMutation = useMutation({
    mutationFn: async (task) => {
      const token = await executeRecaptcha('verify_task');
      const response = await axios.post(
        '/api/verify-task',
        { taskId: task.id, userId: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': csrfToken || process.env.NEXT_PUBLIC_CSRF_TOKEN },
          withCredentials: true,
        }
      );
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to verify task');
      return response.data;
    },
    onSuccess: (data, task) => {
      toast.success(`Task ${task.id} verified! +${task.points} points`, { position: 'top-center', autoClose: 5000 });
      setTaskProgress((prev) => ({
        ...prev,
        [task.id]: data.completionCount || prev[task.id] || 0,
      }));
    },
    onError: (err) => {
      toast.error(
        err.response?.status === 429
          ? 'API rate limit exceeded. Please try again later.'
          : err.message.includes('reCAPTCHA')
            ? 'reCAPTCHA verification failed. Please try again.'
            : `Verification failed: ${err.message}`,
        { position: 'top-center', autoClose: 5000 }
      );
    },
  });

  // Handle Analyze Tweets
  const analyzeTweetsMutation = useMutation({
    mutationFn: async () => {
      const token = await executeRecaptcha('analyze_tweets');
      const response = await axios.post(
        '/api/analyze-tweets',
        { userId: session.user.id, recaptchaToken: token },
        {
          headers: { 'x-csrf-token': csrfToken },
          withCredentials: true,
        }
      );
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to analyze tweets');
      return response.data;
    },
    onSuccess: (data) => {
      toast.success('Tweets analyzed successfully.', { position: 'top-center', autoClose: 5000 });
      setUserData((prev) => ({
        ...prev,
        tweetPoints: data.tweetPoints || prev.tweetPoints,
        points: data.totalPoints || prev.points,
      }));
    },
    onError: (err) => {
      toast.error(
        err.message.includes('reCAPTCHA')
          ? 'reCAPTCHA verification failed. Please try again.'
          : `Failed to analyze tweets: ${err.message}`,
        { position: 'top-center', autoClose: 5000 }
      );
    },
  });

  // Handle Clear Cache
  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const cacheKeys = [
        `userData-${session.user.id}`,
        `tasks-${session.user.id}`,
        `taskProgress-${session.user.id}`,
        `pointHistory-${session.user.id}`,
        `leaderboard-${session.user.id}`,
      ];
      await Promise.all(cacheKeys.map((key) => clearCache(key)));
      await axios.post('/api/clear-cache', { cacheKeys }, { headers: { 'x-csrf-token': csrfToken } });
    },
    onSuccess: () => {
      toast.success('Cache cleared successfully.', { position: 'top-center', autoClose: 5000 });
    },
    onError: () => {
      toast.error('Failed to clear cache.', { position: 'top-center', autoClose: 5000 });
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
        1: 'bg-gradient-to-r from-neon-blue/20 to-transparent border-neon-blue/50 shadow-neon-sm',
        2: 'bg-gradient-to-r from-gray-400/20 to-transparent border-gray-400/50 shadow-neon-sm',
        3: 'bg-gradient-to-r from-pink-400/20 to-transparent border-pink-400/50 shadow-neon-sm',
      };

      return (
        <motion.a
          key={user.id}
          href={`https://x.com/${user.twitterHandle || 'unknown'}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`grid grid-cols-12 p-2 rounded-xl font-saira transition-all duration-300 border border-white/20 bg-black/70 ${rankStyles[rank] || ''} ${isCurrentUser ? '' : ''}`}
        >
          <div className="col-span-2 text-[9px] sm:text-[10px] text-white flex items-center ml-2">{rank}</div>
          <div className="col-span-6 flex items-center">
            <Image
              src={getProfilePictureSrc(user.profile_picture)}
              alt={user.google_name || 'User Avatar'}
              width={24}
              height={24}
              className="rounded-xl border border-white/10 mr-2 object-cover"
            />
            <span className="text-[9px] sm:text-[10px] text-white truncate flex items-center">
              {user.google_name || 'Anonymous'}
              {isCurrentUser && (
                <span
                  className="ml-2 text-[8px] sm:text-[9px] font-medium text-neon-blue px-2 py-0.5 rounded-full border border-neon-blue/50 bg-white/5 backdrop-blur-md"
                >
                  You
                </span>
              )}
            </span>
          </div>
          <div className="col-span-4 p-1 mr-2 text-right text-[9px] sm:text-[10px] text-neon-blue uppercase">{user.points || 0}</div>
        </motion.a>
      );
    },
    [isMobile, rankings, getProfilePictureSrc]
  );

  // Render Tasks Section
  const renderTasksSection = useCallback(() => (
    <motion.div
      key="tasks"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full p-2 sm:p-3 rounded-xl bg-black/70 backdrop-blur-md border border-white/5 shadow-neon-sm"
    >
      <div className="relative min-h-[calc(100vh-12rem)]">
        <LoadingOverlay isLoading={tasksLoading || taskProgressLoading} message="Loading tasks..." isMobile={isMobile} />
        {/* <h2 className="text-[9px] sm:text-[10px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-1 rounded">Tasks</h2> */}
        {tasksError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[9px] sm:text-[10px] mb-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center min-h-[calc(100vh-12rem)] flex items-center justify-center"
          >
            Error: {tasksError.message}
          </motion.div>
        )}
        {!tasks?.length && !tasksError && !(tasksLoading || taskProgressLoading) && (
          <p className="text-[9px] sm:text-[10px] text-white/60 text-center p-2 sm:p-3 min-h-[calc(100vh-12rem)] flex items-center justify-center">No tasks available.</p>
        )}
        {tasks?.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
              {getPaginatedData(tasks, 'tasks').map((task) => (
                <motion.div
                  key={task.id}
                  className="p-2 sm:p-3 bg-white/5 rounded-xl border border-white/10 backdrop-blur-md flex flex-col shadow-neon-sm"
                >
                  <div className="flex-1">
                    <h3 className="text-[9px] sm:text-[10px] font-semibold text-white mb-1">{task.id} {task.isDaily ? `(Daily ${taskProgress?.[task.id] || 0}/${task.maxCompletions})` : ''}</h3>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px] sm:text-[10px] text-neon-green">+{task.points} Points</span>
                    <motion.button
                      onClick={() => verifyTaskMutation.mutate(task)}
                      disabled={verifyTaskMutation.isLoading || (task.isDaily && (taskProgress?.[task.id] || 0) >= task.maxCompletions)}
                      className={`px-2 sm:px-3 py-1 rounded-xl text-[9px] sm:text-[10px] font-medium transition-all duration-300 border border-white/10 bg-white/5 backdrop-blur-md ${verifyTaskMutation.isLoading || (task.isDaily && (taskProgress?.[task.id] || 0) >= task.maxCompletions)
                        ? 'text-white/50 cursor-not-allowed opacity-50'
                        : 'text-white hover:bg-neon-blue/20'
                        }`}
                    >
                      {verifyTaskMutation.isLoading ? 'Verifying...' : 'Verify'}
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-2 sm:mt-3">
              <motion.button
                onClick={() => handlePageChange('tasks', currentPage.tasks - 1)}
                disabled={currentPage.tasks === 1}
                className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl ${currentPage.tasks === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
                  }`}
                whileHover={{ scale: currentPage.tasks === 1 ? 1 : 1.05 }}
                whileTap={{ scale: currentPage.tasks === 1 ? 1 : 0.95 }}
              >
                &lt;
              </motion.button>
              <span className="text-[9px] sm:text-[10px] text-white/60 mt-1">{currentPage.tasks} / {getTotalPages(tasks)}</span>
              <motion.button
                onClick={() => handlePageChange('tasks', currentPage.tasks + 1)}
                disabled={currentPage.tasks === getTotalPages(tasks)}
                className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl ${currentPage.tasks === getTotalPages(tasks) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
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
    </motion.div>
  ), [tasks, tasksLoading, taskProgressLoading, tasksError, taskProgress, verifyTaskMutation, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange]);

  // Render Leaderboard Section
  const renderLeaderboardSection = useCallback(() => (
    <motion.div
      key="leaderboard"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full p-2 sm:p-3 rounded-xl bg-black/70 backdrop-blur-md border border-white/5 shadow-neon-sm"
    >
      <div className="relative min-h-[calc(100vh-12rem)]">
        <LoadingOverlay isLoading={leaderboardLoading} message="Loading rankings..." isMobile={isMobile} />
        {/* <h2 className="text-[9px] sm:text-[10px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-1 rounded">Leaderboard</h2> */}
        {leaderboardError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[9px] sm:text-[10px] mb-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center min-h-[calc(100vh-12rem)] flex items-center justify-center"
          >
            Error: {leaderboardError.message}
            <button onClick={() => window.location.reload()} className="ml-2 px-2 py-1 bg-neon-blue text-black rounded-xl text-[9px] sm:text-[10px]">
              Retry
            </button>
          </motion.div>
        )}
        {!leaderboardLoading && !leaderboardError && rankings?.length === 0 && (
          <div className="text-center text-white/60 text-[9px] sm:text-[10px] p-2 sm:p-3 rounded-lg border border-white/10 bg-white/5 backdrop-blur-md min-h-[calc(100vh-12rem)] flex items-center justify-center">
            No ranking data available.
          </div>
        )}
        {!leaderboardLoading && rankings?.length > 0 && (
          <>
            <div className="grid grid-cols-12 gap-2 text-[9px] sm:text-[10px] text-white/60 mb-2">
              <div className="col-span-2">Rank</div>
              <div className="col-span-6">User</div>
              <div className="col-span-4 text-right">Points</div>
            </div>
            {userData && renderUserRow(userData, -1, true)}
            {getPaginatedData(rankings, 'leaderboard').map((user, index) => renderUserRow(user, index, false))}
            <div className="flex justify-end gap-2 mt-2 sm:mt-3">
              <motion.button
                onClick={() => handlePageChange('leaderboard', currentPage.leaderboard - 1)}
                disabled={currentPage.leaderboard === 1}
                className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl ${currentPage.leaderboard === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
                  }`}
                whileHover={{ scale: currentPage.leaderboard === 1 ? 1 : 1.05 }}
                whileTap={{ scale: currentPage.leaderboard === 1 ? 1 : 0.95 }}
              >
                &lt;
              </motion.button>
              <span className="text-[9px] sm:text-[10px] text-white/60">{currentPage.leaderboard} / {getTotalPages(rankings)}</span>
              <motion.button
                onClick={() => handlePageChange('leaderboard', currentPage.leaderboard + 1)}
                disabled={currentPage.leaderboard === getTotalPages(rankings)}
                className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl ${currentPage.leaderboard === getTotalPages(rankings) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
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
    </motion.div>
  ), [leaderboardLoading, leaderboardError, rankings, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange, renderUserRow]);

  // Render Points Section
  const renderPointsSection = useCallback(() => (
    <motion.div
      key="points"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full p-2 sm:p-3 rounded-xl bg-white/5 backdrop-blur-md border border-black/80 shadow-neon-sm"
    >
      <div className="relative min-h-[calc(100vh-12rem)]">
        <LoadingOverlay isLoading={pointLoading} message="Loading point data..." isMobile={isMobile} />
        {/* <h2 className="text-[9px] sm:text-[10px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-1 rounded">Point History</h2> */}
        {pointError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[9px] sm:text-[10px] mb-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center min-h-[calc(100vh-12rem)] flex items-center justify-center"
          >
            Error: {pointError.message}
          </motion.div>
        )}
        {!pointLoading && !pointError && (
          <>
            <div className="h-64 bg-white/5 rounded-xl p-2 sm:p-3 mb-2 sm:mb-3 border border-white/10 backdrop-blur-md shadow-neon-sm">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pointData?.history} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke="#ffffff1a" strokeDasharray="5 5" />
                  <XAxis dataKey="date" stroke="#ffffff" tick={{ fontSize: isMobile ? 8 : 9, fill: '#ffffff' }} angle={-45} textAnchor="end" height={50} />
                  <YAxis stroke="#ffffff" tick={{ fontSize: isMobile ? 8 : 9, fill: '#ffffff' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#00000033',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '0.5rem',
                      padding: '0.5rem',
                      boxShadow: '0 0 8px rgba(0, 191, 255, 0.3)',
                    }}
                    labelStyle={{ color: '#ffffff', fontSize: isMobile ? 8 : 9 }}
                    itemStyle={{ color: '#ffffff', fontSize: isMobile ? 8 : 9 }}
                    cursor={{ stroke: '#00BFFF', strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="taskPoints"
                    stroke="#00FF00"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ fill: '#00FF00', r: 4, stroke: '#ffffff', strokeWidth: 1 }}
                    name="Task Points"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <motion.div
                className="flex-1 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-2 sm:p-3 min-h-[100px] shadow-neon-sm"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <h3 className="text-[9px] sm:text-[10px] font-bold text-white mb-2 uppercase tracking-wider">Total Points</h3>
                <p className="text-xl sm:text-2xl font-bold text-neon-blue text-center">{userData?.points || 0}</p>
              </motion.div>
              <motion.div
                className="flex-1 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-2 sm:p-3 min-h-[100px] flex flex-col items-center justify-center shadow-neon-sm"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <h3 className="text-[9px] sm:text-[10px] font-bold text-white mb-2 uppercase tracking-wider">Task Points</h3>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-xl sm:text-2xl font-bold text-neon-blue">{pointData?.taskPoints || 0}</p>
                  <motion.p
                    className={`text-[9px] sm:text-[10px] font-semibold text-${pointData?.taskGrowth.color} ${pointData?.taskGrowth.value != 0 ? 'animate-pulse' : ''}`}
                    animate={{ opacity: pointData?.taskGrowth.value != 0 ? [1, 0.7, 1] : 1 }}
                    transition={{ duration: 1.5, repeat: pointData?.taskGrowth.value != 0 ? Infinity : 0 }}
                  >
                    {pointData?.taskGrowth.value}% {pointData?.taskGrowth.value > 0 ? '↑' : pointData?.taskGrowth.value < 0 ? '↓' : '–'}
                  </motion.p>
                </div>
              </motion.div>
            </div>
            <div className="flex justify-end gap-2 mt-2 sm:mt-3">
              <motion.button
                onClick={() => handlePageChange('points', currentPage.points - 1)}
                disabled={currentPage.points === 1}
                className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl ${currentPage.points === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
                whileHover={{ scale: currentPage.points === 1 ? 1 : 1.05 }}
                whileTap={{ scale: currentPage.points === 1 ? 1 : 0.95 }}
              >
                &lt;
              </motion.button>
              <span className="text-[9px] sm:text-[10px] text-white/60">{currentPage.points} / {getTotalPages(pointData?.history || [])}</span>
              <motion.button
                onClick={() => handlePageChange('points', currentPage.points + 1)}
                disabled={currentPage.points === getTotalPages(pointData?.history || [])}
                className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl ${currentPage.points === getTotalPages(pointData?.history || []) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
                whileHover={{ scale: currentPage.points === getTotalPages(pointData?.history || []) ? 1 : 1.05 }}
                whileTap={{ scale: currentPage.points === getTotalPages(pointData?.history || []) ? 1 : 0.95 }}
              >
                &gt;
              </motion.button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  ), [pointLoading, pointError, pointData, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange]);

  if (status === 'loading' || csrfLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        className="font-saira w-full max-w-7xl mx-auto bg-white/5 backdrop-blur-md p-2 sm:p-3 h-[calc(100vh)] overflow-hidden rounded-xl border border-white/10 shadow-neon-sm"
      >
        <LoadingOverlay isLoading={true} message="Loading profile..." isMobile={isMobile} />
      </motion.div>
    );
  }

  if (!session) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        className="font-saira w-full max-w-7xl mx-auto bg-white/5 backdrop-blur-md p-2 sm:p-3 h-[calc(100vh)] overflow-hidden rounded-xl border border-white/10 shadow-neon-sm"
      >
        <div className="text-center text-white/60 text-[9px] sm:text-[10px] p-2 sm:p-3 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md min-h-[calc(100vh-12rem)] flex items-center justify-center">
          <p>Please sign in to view your profile.</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className="font-saira w-full max-w-9xl mx-auto bg-white/5 backdrop-blur-md p-2 sm:p-3 h-[calc(100vh)] overflow-y-auto custom-scrollbar rounded-xl border border-white/10 shadow-neon-sm"
    >
      <ToastContainer position="top-center" autoClose={5000} theme="dark" />
      <div className="w-full h-full flex flex-col gap-2 sm:gap-3">
        {/* Profile Information */}
        <div className="relative">
          <LoadingOverlay isLoading={userLoading} message="Loading profile..." isMobile={isMobile} />
          {userError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-red-400 text-[9px] sm:text-[10px] mb-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center"
            >
              Error: {userError.message}
            </motion.div>
          )}
          {userData && (
            <motion.div
              className="w-full sm:w-[80%] mx-auto rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row border border-white/20 bg-black/70 backdrop-blur-xl"
            >
              {/* Left: Google Account Logo, Name, Email, Wallet */}
              <div className="flex flex-col items-center sm:items-start sm:w-1/2">
                <Image
                  src={getProfilePictureSrc(userData.profilePicture)}
                  alt={userData.googleName || 'Google User'}
                  width={32}
                  height={32}
                  className="rounded-xl border border-white/10 mb-2"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[9px] sm:text-[10px] text-white truncate">{userData.googleName || userData.email}</span>
                  <span
                    className={`text-[8px] sm:text-[9px] font-medium px-2 py-0.5 rounded-full border ${userData.isPremium ? 'text-yellow-400 border-yellow-400/50 bg-yellow-400/10' : 'text-gray-200 border-gray-200/50 bg-white/5'}`}
                  >
                    {userData.tier || 'Basic'}
                  </span>
                </div>
                <p className="text-[8px] sm:text-[9px] text-white/60 mt-1">{userData.email}</p>
                <div className="flex items-center gap-2 mt-2 w-full justify-center sm:items-center sm:justify-between">
                  <motion.button
                    onClick={() => connectWalletMutation.mutate()}
                    disabled={connectWalletMutation.isLoading || userData.walletAddress}
                    className={`px-2 sm:px-3 py-1 rounded-xl text-[9px] sm:text-[10px] font-medium transition-all duration-300 border border-neon-green/50 bg-white/5 backdrop-blur-md ${connectWalletMutation.isLoading || userData.walletAddress
                      ? 'text-neon-green/50 cursor-not-allowed opacity-50'
                      : 'text-neon-green hover:bg-neon-green/20'
                      }`}
                    whileHover={{ scale: connectWalletMutation.isLoading || userData.walletAddress ? 1 : 1.05 }}
                    whileTap={{ scale: connectWalletMutation.isLoading || userData.walletAddress ? 1 : 0.95 }}
                  >
                    {connectWalletMutation.isLoading ? 'Connecting...' : 'Connect Wallet'}
                  </motion.button>
                  {userData.walletAddress && (
                    <motion.button
                      onClick={() => disconnectWalletMutation.mutate()}
                      disabled={disconnectWalletMutation.isLoading}
                      className={`px-2 sm:px-3 py-1 rounded-xl text-[9px] sm:text-[10px] font-medium transition-all duration-300 ${disconnectWalletMutation.isLoading ? 'text-red-400/50 cursor-not-allowed opacity-50' : 'text-red-400 hover:bg-red-400/20'}`}
                    >
                      {disconnectWalletMutation.isLoading ? 'Disconnecting...' : 'Disconnect'}
                    </motion.button>
                  )}
                </div>
              </div>

              {/* Right: Points, Days Active */}
              <div className="flex flex-col sm:w-1/2 mt-3 sm:mt-0 items-center sm:items-end justify-between">
                <motion.button
                  onClick={handleSignOut}
                  className="absolute top-2 sm:top-3 right-2 sm:right-3 text-red-400 rounded-xl w-6 h-6 flex items-center justify-center transition-all duration-300"
                  aria-label="Sign out"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 sm:h-4 w-3 sm:w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#F87171"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                </motion.button>
                <div className="flex items-end h-full">
                  <p className="text-[9px] sm:text-[10px] text-white">
                    Points: <span className="text-neon-blue">{userData.points || 0}</span> / Days Active: <span className="text-neon-blue">{getDaysActive()}</span>
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-center gap-1 sm:gap-2 bg-black/80">
          {['tasks', 'leaderboard', 'points'].map((tab) => (
            <motion.button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-[10px] font-medium transition-all duration-300 uppercase rounded-lg ${activeTab === tab ? 'border-b-2 border-white text-white' : 'text-white/60'}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </motion.button>
          ))}
        </div>

        {/* Tab Content with AnimatePresence */}
        <AnimatePresence mode="wait">
          {activeTab === 'tasks' && renderTasksSection()}
          {activeTab === 'leaderboard' && renderLeaderboardSection()}
          {activeTab === 'points' && renderPointsSection()}
        </AnimatePresence>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .shadow-neon-sm {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.1);
        }
        .animate-pulse {
          animation: ${isMobile ? 'none' : 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
        }
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        @media (max-width: 640px) {
          .w-[80%] {
            width: 100%;
          }
          .min-h-[120px] {
            min-height: 80px;
          }
          .text-2xl {
            font-size: 1rem;
          }
          .text-xl {
            font-size: 0.875rem;
          }
          .text-[10px] {
            font-size: 8px;
          }
          .text-[9px] {
            font-size: 7px;
          }
          .text-[8px] {
            font-size: 6px;
          }
          .h-64 {
            height: 20rem;
          }
          .grid-cols-3 {
            grid-template-columns: 1fr;
          }
          .grid-cols-12 {
            font-size: 7px;
          }
          .w-6 {
            width: 1.25rem;
            height: 1.25rem;
          }
          .w-32 {
            width: 24px;
            height: 24px;
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