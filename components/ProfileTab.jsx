// components/ProfileTab.jsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Trophy, Award, Flame, User, Crown, Calendar, Info, Check, Coins, Shield, Users } from 'lucide-react';
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
    <span className="w-1 h-1 bg-white/70 rounded-full animate-bounce"></span>
    <span className="w-1 h-1 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
    <span className="w-1 h-1 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
  </div>
);

// Action Loading Overlay for central screen loading during check-in and verify
const ActionLoadingOverlay = ({ isLoading }) => (
  <AnimatePresence>
    {isLoading && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      >
        <div className="bg-gradient-to-br from-black/90 to-gray-900/90 backdrop-blur-xl border border-white/20 rounded-xl p-6 flex flex-col items-center gap-3 max-w-sm mx-4">
          <Spinner className="h-8 w-8" color="text-blue-400" />
          <span className="text-white text-sm font-medium text-center">Verifying your action...</span>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
)

// Daily Check-in Bar Component - Updated to disable if not twitterConnected
const DailyCheckinBar = ({ last7Days, streak, onCheckin, isLoading, userData, twitterConnected }) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayIndex = new Date().getDay();
  const [tooltipVisible, setTooltipVisible] = useState(false);

  // Sửa: Không reverse ở backend nữa, last7Days = [oldest (7 days ago) ... today (index 6)]
  // Đảo ngược ở frontend để left: past, right: today cho UX tốt
  const displayLast7Days = [...last7Days].reverse(); // Bây giờ index 0 = today (left? Wait no: reverse lại để index 0=oldest left, index6=today right
  // Wait: last7Days gốc [oldest...today], reverse() -> [today...oldest], nhưng để left past: không reverse, index0=oldest left.
  // Để fix: giữ last7Days [oldest...today], index0 left=oldest, index6 right=today
  const isTodayChecked = last7Days[last7Days.length - 1]; // index 6 = today

  const handleCheckinClick = () => {
    if (!twitterConnected) {
      toast.info('Please connect your X (Twitter) account first to unlock check-in.', { position: 'top-center', autoClose: 4000 });
      return;
    }
    onCheckin();
  };

  // Sửa dayIndex cho left=oldest (index=0: 6 days back), right=today (index=6: 0 back)
  const getDayIndex = (index) => {
    const daysBack = 6 - index; // index 0: daysBack=6, index6: daysBack=0
    return (todayIndex - daysBack + 7) % 7;
  };

  return (
    <div className="w-full bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-white/15 rounded-xl p-3 mb-2 shadow-lg shadow-black/20">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-1">
          <Calendar className="w-4 h-4 text-blue-400" />
          <h3 className="text-white font-bold text-[12px]">Daily Check-in</h3>
        </div>
        <div className="relative">
          <Info
            className="w-4 h-4 text-gray-400 cursor-help"
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
          />
          {tooltipVisible && (
            <div className="absolute top-full right-0 mt-1 p-2 bg-gradient-to-br from-black/95 to-gray-900/95 border border-white/20 rounded-lg text-[10px] sm:text-[11px] text-white/90 z-50 w-48 shadow-lg">
              Maintain a 7-day streak to earn double points (20 pts/day) và unlock exclusive rewards! Breaking the streak resets to normal (10 pts).
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-around items-center">
        {last7Days.map((checked, index) => {
          const dayIndex = getDayIndex(index);
          return (
            <div key={index} className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold transition-all duration-300 ${checked
                ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-black shadow-lg shadow-gray-300/25'
                : 'bg-gradient-to-br from-white/10 to-white/5 text-white/50 border border-white/20'
                }`}>
                {checked ? (
                  <Check className="w-3 h-3 text-black" />
                ) : (
                  days[dayIndex]
                )}
              </div>
              {/* Sửa: Button chỉ ở index cuối (today, index=6), nếu !checked */}
              {index === last7Days.length - 1 && !checked && (
                <motion.button
                  onClick={handleCheckinClick}
                  disabled={isLoading || !twitterConnected}
                  className={`mt-1 px-2 py-1 rounded-full text-[9px] font-semibold transition-all duration-300 flex items-center justify-center gap-1 ${isLoading || !twitterConnected
                    ? 'bg-gradient-to-r from-gray-600 to-gray-700 text-white/70 cursor-not-allowed relative overflow-hidden'
                    : 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 shadow-lg shadow-blue-500/25'
                    }`}
                  whileHover={{ scale: (isLoading || !twitterConnected) ? 1 : 1.05 }}
                  whileTap={{ scale: (isLoading || !twitterConnected) ? 1 : 0.95 }}
                >
                  {isLoading ? (
                    <BlinkingDots />
                  ) : !twitterConnected ? (
                    'Connect Twitter'
                  ) : (
                    'Check-in'
                  )}
                  {(isLoading || !twitterConnected) && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer"></div>
                  )}
                </motion.button>
              )}
            </div>
          );
        })}
      </div>
      {streak >= 7 && (
        <div className="flex items-center justify-center mt-3 gap-1">
          <Flame className="w-4 h-4 text-orange-500 animate-pulse" />
          <span className="text-orange-400 font-bold text-sm">Streak: {streak} days - Double Points Active!</span>
        </div>
      )}
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <motion.div
        className="bg-gradient-to-br from-black/95 to-gray-900/95 backdrop-blur-xl border border-white/20 p-3 rounded-2xl text-white text-sm font-medium shadow-2xl"
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
  const [immediateLoading, setImmediateLoading] = useState(false);
  const [showV2Modal, setShowV2Modal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // {type, data}
  const v2Ref = useRef(null);
  const itemsPerPage = 10;

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
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // reCAPTCHA v2 fallback effect - Updated to handle all pending actions
  useEffect(() => {
    let widgetId;
    if (showV2Modal && v2Ref.current && window?.grecaptcha) {
      widgetId = grecaptcha.render(v2Ref.current, {
        sitekey: process.env.NEXT_PUBLIC_RECAPTCHA_V2_SITE_KEY || process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
        theme: 'dark',
        callback: async (token) => {
          if (pendingAction) {
            const commonHeaders = {
              'x-csrf-token': csrfToken,
              'Content-Type': 'application/json',
            };
            const commonConfig = {
              headers: commonHeaders,
              withCredentials: true,
            };
            try {
              switch (pendingAction.type) {
                case 'verifyTask':
                  const verifyResponse = await axios.post('/api/twitter/verify-task', {
                    taskId: pendingAction.data.id,
                    userId: session?.user?.id,
                    recaptchaV2Token: token,
                  }, commonConfig);
                  if (verifyResponse.data.success) {
                    toast.success(`${pendingAction.data.description} verified successfully! You've earned ${verifyResponse.data.pointsEarned} points.`, {
                      position: 'top-center',
                      autoClose: 5000,
                    });
                    const userCacheKey = `userData-${session?.user?.id}`;
                    const progressCacheKey = `taskProgress-${session?.user?.id}`;
                    Promise.all([
                      clearCache(userCacheKey),
                      clearCache(progressCacheKey),
                    ]);
                    Promise.all([
                      queryClient.invalidateQueries(['taskProgress', session?.user?.id, csrfToken]),
                      queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
                    ]);
                    Promise.all([
                      queryClient.refetchQueries(['taskProgress', session?.user?.id, csrfToken]),
                      queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
                    ]);
                  } else {
                    toast.error(verifyResponse.data.detail || 'Failed to verify task');
                  }
                  break;
                case 'disconnectTwitter':
                  const disconnectTwitterResponse = await axios.post('/api/twitter/connect', {
                    action: 'disconnect',
                    uid: session?.user?.id,
                    recaptchaV2Token: token,
                  }, commonConfig);
                  if (disconnectTwitterResponse.data.success) {
                    toast.success('Twitter account disconnected successfully. Your profile has been updated.', {
                      position: 'top-center',
                      autoClose: 5000,
                    });
                    clearAllCaches(session?.user?.id);
                    Promise.all([
                      queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
                      queryClient.invalidateQueries(['leaderboard', session?.user?.id, csrfToken]),
                    ]);
                    Promise.all([
                      queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
                      queryClient.refetchQueries(['leaderboard', session?.user?.id, csrfToken]),
                    ]);
                  } else {
                    toast.error(disconnectTwitterResponse.data.detail || 'Unable to disconnect Twitter at this time.');
                  }
                  break;
                case 'disconnectWallet':
                  const disconnectWalletResponse = await axios.post('/api/verify-wallet', {
                    action: 'disconnect-wallet',
                    uid: session?.user?.id,
                    recaptchaV2Token: token,
                  }, commonConfig);
                  if (disconnectWalletResponse.data.success) {
                    toast.success('Wallet disconnected successfully.', { position: 'top-center', autoClose: 5000 });
                    queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]);
                  } else {
                    toast.error(disconnectWalletResponse.data.detail || 'Unable to disconnect wallet.');
                  }
                  break;
                case 'createCharge':
                  const createChargeResponse = await axios.post('/api/coinbase/create-charge', {
                    userId: session.user.id,
                    plan: 'premium',
                  }, {
                    ...commonConfig,
                    headers: {
                      ...commonHeaders,
                      'X-Recaptcha-V2-Token': token,
                    },
                  });
                  if (createChargeResponse.data.success) {
                    window.location.href = createChargeResponse.data.hostedUrl;
                    await queryClient.invalidateQueries(['userData', session?.user?.id]);
                  } else {
                    toast.error(createChargeResponse.data.detail || 'Unable to create charge');
                  }
                  break;
                case 'connectWallet':
                  if (!window.ethereum) {
                    toast.error('Please install MetaMask to connect your wallet.');
                    break;
                  }
                  try {
                    const provider = new ethers.BrowserProvider(window.ethereum);
                    const accounts = await provider.send('eth_requestAccounts', []);
                    const walletAddress = accounts[0];
                    const signer = await provider.getSigner();
                    const message = `Verify wallet for UID: ${session.user.id}`;
                    const signature = await signer.signMessage(message);
                    const connectWalletResponse = await axios.post('/api/verify-wallet', {
                      action: 'verify-wallet',
                      walletAddress,
                      signature,
                      message,
                      uid: session.user.id,
                      recaptchaV2Token: token,
                    }, commonConfig);
                    if (connectWalletResponse.data.success) {
                      toast.success(`Wallet ${walletAddress.slice(0, 6)}... connected successfully.`, {
                        position: 'top-center',
                        autoClose: 5000
                      });
                      queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]);
                    } else {
                      toast.error(connectWalletResponse.data.detail || 'Failed to connect wallet');
                    }
                  } catch (walletErr) {
                    toast.error(`Wallet connection failed: ${walletErr.message}`);
                  }
                  break;
                default:
                  toast.error('Unknown action for fallback');
              }
            } catch (err) {
              toast.error(err.response?.data?.detail || 'Fallback verification failed');
            }
          }
          setShowV2Modal(false);
          setPendingAction(null);
          if (widgetId) grecaptcha.reset(widgetId);
        },
        'expired-callback': () => {
          toast.error('reCAPTCHA expired. Please try again.');
          setShowV2Modal(false);
          setPendingAction(null);
          if (widgetId) grecaptcha.reset(widgetId);
        },
      });
    }
    return () => {
      if (widgetId) grecaptcha.reset(widgetId);
    };
  }, [showV2Modal, pendingAction, csrfToken, session, queryClient]);

  const onSignOut = async () => {
    setIsSigningOut(true);
    await handleSignOut();
    setIsSigningOut(false);
  };

  const handleFollow = (taskId) => {
    const followUrl = `https://x.com/intent/follow?screen_name=XynapseAI`;
    window.open(followUrl, '_blank');
    setFollowedTasks(prev => new Set([...prev, taskId]));
    toast.info('Redirecting to X. Please follow @XynapseAI and return to verify your action.', {
      position: 'top-center',
      autoClose: 6000
    });
  };

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
      // FIXED: Use startsWith
      if (err.response?.status === 403 && err.response?.data?.detail?.startsWith('reCAPTCHA verification failed')) {
        setPendingAction({ type: 'createCharge' });
        setShowV2Modal(true);
        return;
      }
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

      // Removed reCAPTCHA for faster initial load - only for mutations
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
    staleTime: 5 * 60 * 1000, // Increased stale time for better caching
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
  }, [userData, session, csrfToken, queryClient]);

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
      toast.success('Twitter account disconnected successfully. Your profile has been updated.', {
        position: 'top-center',
        autoClose: 5000
      });
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
      // FIXED: Use startsWith
      if (err.response?.status === 403 && err.response?.data?.detail?.startsWith('reCAPTCHA verification failed')) {
        setPendingAction({ type: 'disconnectTwitter' });
        setShowV2Modal(true);
        return;
      }
      let errorMessage = err.response?.data?.detail || 'Unable to disconnect Twitter at this time.';
      if (err.response?.status === 429) {
        errorMessage = 'Request limit reached. Please wait a moment and try again.';
      } else if (err.response?.status === 403) {
        if (err.response?.data?.detail === 'Invalid CSRF check.') {
          errorMessage = 'Session security issue detected. Please refresh the page.';
        } else if (err.response?.data?.detail?.includes('reCAPTCHA')) {
          errorMessage = 'Security verification failed. Please complete the challenge and try again.';
        } else {
          errorMessage = 'Security verification failed. Please try the action again. If it persists, refresh the page.';
        }
      }
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
      toast.success(`Wallet ${walletAddress.slice(0, 6)}... connected successfully.`, {
        position: 'top-center',
        autoClose: 5000
      });
      queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]);
    },
    onError: (err) => {
      // FIXED: Use startsWith
      if (err.response?.status === 403 && err.response?.data?.detail?.startsWith('reCAPTCHA verification failed')) {
        setPendingAction({ type: 'connectWallet' });
        setShowV2Modal(true);
        return;
      }
      toast.error(`Wallet connection failed: ${err.message}. Please ensure MetaMask is installed and try again.`, {
        position: 'top-center',
        autoClose: 5000
      });
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
      // FIXED: Use startsWith
      if (err.response?.status === 403 && err.response?.data?.detail?.startsWith('reCAPTCHA verification failed')) {
        setPendingAction({ type: 'disconnectWallet' });
        setShowV2Modal(true);
        return;
      }
      toast.error(`Unable to disconnect wallet: ${err.message}`, { position: 'top-center', autoClose: 5000 });
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
      toast.success(`${task.description} verified successfully! You've earned ${data.pointsEarned} points.`, {
        position: 'top-center',
        autoClose: 5000
      });

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
    onError: (err, variables) => {
      const task = variables?.task || { task_type: 'unknown' };
      const detail = err.response?.data?.detail;
      // FIXED: Use startsWith for flexible matching
      if (err.response?.status === 403 && detail?.startsWith('reCAPTCHA verification failed')) {
        setPendingAction({ type: 'verifyTask', data: task });
        setShowV2Modal(true);
        return;
      }
      let errorMessage = `Verification unsuccessful for ${task.description || 'this task'}. Please try again.`;

      if (err.response?.status === 429) {
        errorMessage = 'X (Twitter) rate limit exceeded. Please wait 1-2 minutes and try again.';
      } else if (err.response?.status === 403) {
        if (detail === 'Invalid CSRF check.') {
          errorMessage = 'Session security issue detected. Please refresh the page and try again.';
        } else if (detail?.includes('reCAPTCHA')) {
          errorMessage = 'Security verification failed. Please complete the challenge and try again.';
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

  // Handle Daily Check-in
  const handleDailyCheckin = () => {
    setImmediateLoading(true);
    const task = { id: 'daily_checkin', description: 'Daily Check-in', points: 10, task_type: 'daily_checkin' };
    verifyTaskMutation.mutate(task, {
      onSettled: () => {
        setImmediateLoading(false);
      },
    });
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

  const renderUserRow = useCallback(
    (user, index, isCurrentUser = false) => {
      const rank = isCurrentUser ? rankings.findIndex((u) => u.id === user.id) + 1 || 'N/A' : index + 1;
      const getRankIcon = (r) => {
        if (r === 1) return <Trophy className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-yellow-500" />;
        if (r === 2) return <Flame className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-orange-400" />;
        if (r === 3) return <Award className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-gray-500" />;
        return null;
      };
      const rankIcon = getRankIcon(rank);

      return (
        <motion.tr
          key={user.id}
          className={`border-t border-white/15 hover:bg-gradient-to-r hover:from-white/5 hover:to-gray-800/5 transition-all duration-300`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.02 }}
        >
          <td className="px-3 py-3 text-white text-[11px] sm:text-[11px] truncate align-middle flex items-center gap-1">
            {rankIcon}
            {rank}
          </td>
          <td className="px-3 py-3 text-white text-[9px] sm:text-[11px] truncate align-middle">
            <div className="flex items-center">
              <Image
                src={getProfilePictureSrc(user.profilePicture)}
                alt={user.googleName || user.twitterHandle || 'User Avatar'}
                width={isMobile ? 14 : 16}
                height={isMobile ? 14 : 16}
                className="rounded-sm border border-white/15 mr-2 object-cover shadow-md"
              />
              <div className="flex items-center gap-1 truncate ml-1">
                <span>{user.googleName || user.twitterHandle || 'Anonymous'}</span>
                {user.twitterHandle && (
                  <a href={`https://x.com/${user.twitterHandle}`} target="_blank" rel="noopener noreferrer">
                    <img src="/logos/x.webp" alt="X Logo" className="ml-1 w-2 h-2 sm:w-3 sm:h-3 text-blue-400 hover:text-blue-300" />
                  </a>
                )}
                {isCurrentUser && (
                  <span className="ml-2 text-[7px] sm:text-[8px] font-medium text-neon-blue px-2 py-0.4 sm:0.5 rounded-full border border-neon-blue/50 bg-gradient-to-r from-neon-blue/10 to-neon-blue/5">
                    You
                  </span>
                )}
              </div>
            </div>
          </td>
          <td className="px-3 py-3 text-neon-blue text-[7px] sm:text-[8px] text-right truncate align-middle">{user.points || 0}</td>
        </motion.tr>
      );
    },
    [isMobile, rankings, getProfilePictureSrc]
  );

  const handleVerifyTask = useCallback((task) => {
    setImmediateLoading(true);
    verifyTaskMutation.mutate(task, {
      onSettled: () => {
        setImmediateLoading(false);
      },
    });
  }, [verifyTaskMutation]);

  // Render Tasks Section - Removed small connect prompt (now handled in tab content)
  const renderTasksSection = useCallback(
    () => (
      <div className="relative bg-gradient-to-br from-black/90 to-gray-900/90 rounded-b-xl overflow-y-auto min-h-[calc(45vh)] sm:min-h-[calc(45vh)] max-h-[calc(50vh)] sm:max-h-[calc(45vh-4rem)] hide-scrollbar border border-white/15 shadow-2xl shadow-black/30">
        <LoadingOverlay
          isLoading={tasksLoading || taskProgressLoading}
          isMobile={isMobile}
          className="absolute inset-0 z-10 h-full"
        />
        <LoadingOverlay
          isLoading={immediateLoading || verifyTaskMutation.isLoading}
          isMobile={isMobile}
          className="absolute inset-0 z-20 h-full"
        />
        {tasksError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[9px] sm:text-[11px] p-2 bg-gradient-to-br from-red-500/10 to-red-600/10 border border-red-500/20 rounded-lg text-center h-full flex items-center justify-center relative z-0 shadow-lg"
          >
            Error: {tasksError.message}
          </motion.div>
        )}
        {!tasks?.length && !tasksError && !(tasksLoading || taskProgressLoading) && (
          <p className="text-[9px] sm:text-[11px] text-white/60 text-center p-4 h-full flex items-center justify-center relative z-0">
            No tasks available.
          </p>
        )}
        {tasks?.length > 0 && (
          <>
            <div className="overflow-x-auto relative z-0">
              <table className="w-full text-[9px] sm:text-[11px] bg-gradient-to-br from-black/70 to-gray-900/70 rounded-b-xl table-fixed">
                <thead className="bg-gradient-to-r from-black/80 to-gray-900/80">
                  <tr>
                    <th className={`${isMobile ? 'w-[50%]' : 'w-[60%]'} px-3 py-3 text-white text-left font-semibold truncate border-b border-white/15`}>Task</th>
                    <th className={`${isMobile ? 'w-[20%]' : 'w-[20%]'} px-3 py-3 text-white text-left font-semibold truncate border-b border-white/15`}>Points</th>
                    <th className={`${isMobile ? 'w-[30%]' : 'w-[20%]'} px-3 py-3 text-white text-left font-semibold truncate border-b border-white/15`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {getPaginatedData(tasks, 'tasks').map((task, index) => {
                    const isCompleted = (task.is_daily && (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions) ||
                      (!task.is_daily && taskProgress?.[task.id]?.completionCount >= task.max_completions);
                    return (
                      <motion.tr
                        key={task.id}
                        className="border-t border-white/15 hover:bg-gradient-to-r hover:from-white/10 hover:to-gray-800/10 transition-all duration-300"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.02 }}
                      >
                        <td className="px-3 py-3 text-white truncate">
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
                              on X
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
                        <td className="px-3 py-3 text-neon-green font-semibold">+{task.points}</td>
                        <td className="px-3 py-3 text-white">
                          <div className="flex gap-2">
                            {task.task_type === 'follow' && !followedTasks.has(task.id) ? (
                              <motion.button
                                onClick={() => handleFollow(task.id)}
                                className="px-2 py-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-[9px] sm:text-[11px] font-medium hover:from-blue-700 hover:to-purple-700 shadow-lg shadow-blue-500/25 transition-all duration-300 flex items-center gap-1"
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
                                className={`px-2 py-1 rounded-lg text-[9px] sm:text-[11px] font-medium transition-all duration-300 flex items-center justify-center gap-1 shadow-lg relative overflow-hidden ${immediateLoading ||
                                  verifyTaskMutation.isLoading ||
                                  !userData?.twitterHandle ||
                                  isCompleted
                                  ? 'bg-gradient-to-r from-gray-600 to-gray-700 text-white/50 cursor-not-allowed opacity-50'
                                  : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700'
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
                                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer"></div>
                                )}
                              </motion.button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {tasks?.length > itemsPerPage && (
              <div className="flex justify-end gap-2 mt-2 p-2 bg-gradient-to-r from-white/10 to-gray-800/10 rounded-xl relative z-0 shadow-inner">
                <motion.button
                  onClick={() => handlePageChange('tasks', currentPage.tasks - 1)}
                  disabled={currentPage.tasks === 1}
                  className={`px-2 py-1 text-[9px] sm:text-[11px] font-medium text-white border border-white/15 bg-gradient-to-r from-white/10 to-white/5 rounded-lg ${currentPage.tasks === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
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
                  className={`px-2 py-1 text-[9px] sm:text-[11px] font-medium text-white border border-white/15 bg-gradient-to-r from-white/10 to-white/5 rounded-lg ${currentPage.tasks === getTotalPages(tasks) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
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
    [tasks, tasksLoading, taskProgressLoading, tasksError, taskProgress, verifyTaskMutation, userData, isMobile, currentPage, getPaginatedData, getTotalPages, handlePageChange, followedTasks, immediateLoading, handleVerifyTask]
  );

  // Render Leaderboard Section
  const renderLeaderboardSection = useCallback(
    () => (
      <div className="relative bg-gradient-to-br from-black/90 to-gray-900/90 rounded-b-xl overflow-y-auto min-h-[calc(45vh)] sm:min-h-[calc(45vh)] max-h-[calc(50vh)] sm:max-h-[calc(45vh-4rem)] hide-scrollbar border border-white/15 shadow-2xl shadow-black/30">
        <LoadingOverlay
          isLoading={leaderboardLoading}
          isMobile={isMobile}
          className="absolute inset-0 z-10 h-full"
        />
        {leaderboardError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[9px] sm:text-[11px] p-4 bg-gradient-to-br from-red-500/10 to-red-600/10 border border-red-500/20 rounded-lg text-center h-full flex items-center justify-center gap-2 relative z-0 shadow-lg"
          >
            Error: {leaderboardError.message}
            <button
              onClick={() => window.location.reload()}
              className="px-2 py-1 bg-gradient-to-r from-neon-blue to-blue-600 text-black rounded-lg text-[9px] sm:text-[11px] font-medium hover:from-blue-500 hover:to-blue-700 transition-colors shadow-lg"
            >
              Retry
            </button>
          </motion.div>
        )}
        {!leaderboardLoading && !leaderboardError && rankings?.length === 0 && (
          <p className="text-[9px] sm:text-[11px] text-white/60 text-center p-4 h-full flex items-center justify-center relative z-0">
            No ranking data available.
          </p>
        )}
        {!leaderboardLoading && rankings?.length > 0 && (
          <>
            <div className="overflow-x-auto relative z-0">
              <table className="w-full text-[9px] sm:text-[11px] bg-gradient-to-br from-black/70 to-gray-900/70 rounded-b-xl table-fixed">
                <thead className="bg-gradient-to-r from-black/80 to-gray-900/80">
                  <tr>
                    <th className={`${isMobile ? 'w-[20%]' : 'w-[15%]'} px-3 py-3 text-white text-left font-semibold truncate align-middle border-b border-white/15`}>Rank</th>
                    <th className={`${isMobile ? 'w-[60%]' : 'w-[65%]'} px-3 py-3 text-white text-left font-semibold truncate align-middle border-b border-white/15`}>User</th>
                    <th className={`${isMobile ? 'w-[20%]' : 'w-[20%]'} px-3 py-3 text-white text-right font-semibold truncate align-middle border-b border-white/15`}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {userData && renderUserRow(userData, -1, true)}
                  {getPaginatedData(rankings, 'leaderboard').map((user, index) => renderUserRow(user, index, false))}
                </tbody>
              </table>
            </div>
            {rankings?.length > itemsPerPage && (
              <div className="flex justify-end gap-2 mt-2 p-2 bg-gradient-to-r from-white/10 to-gray-800/10 rounded-xl relative z-0 shadow-inner">
                <motion.button
                  onClick={() => handlePageChange('leaderboard', currentPage.leaderboard - 1)}
                  disabled={currentPage.leaderboard === 1}
                  className={`px-2 py-1 text-[9px] sm:text-[11px] font-medium text-white border border-white/15 bg-gradient-to-r from-white/10 to-white/5 rounded-lg ${currentPage.leaderboard === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
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
                  className={`px-2 py-1 text-[9px] sm:text-[11px] font-medium text-white border border-white/15 bg-gradient-to-r from-white/10 to-white/5 rounded-lg ${currentPage.leaderboard === getTotalPages(rankings) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
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

  if (status === 'loading' || csrfLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-2 bg-gradient-to-br from-black/90 to-gray-900/90 rounded-2xl flex flex-col h-[calc(100vh-3rem)] overflow-y-auto hide-scrollbar border border-white/15 shadow-2xl"
      >
        <LoadingOverlay isLoading={true} isMobile={isMobile} />
      </motion.div>
    );
  }

  if (!session) {
    return <LoginPrompt />;
  }

  const overallLoading = immediateLoading || verifyTaskMutation.isLoading;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-4 bg-gradient-to-br from-black to-gray-900 flex flex-col h-[calc(100vh-4rem)] overflow-y-auto hide-scrollbar relative border border-white/10 rounded-2xl shadow-2xl"
    >
      <ActionLoadingOverlay isLoading={overallLoading} />
      <AnimatePresence>
        {showV2Modal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gradient-to-br from-gray-900/95 to-black/95 border border-white/20 rounded-2xl p-6 max-w-md w-full text-center shadow-2xl"
            >
              <h3 className="text-white font-bold mb-4 text-lg">Verify You're Human</h3>
              <p className="text-gray-300 mb-4 text-sm">Please complete the security challenge below to continue.</p>
              <div ref={v2Ref} className="g-recaptcha mb-4"></div>
              <motion.button
                onClick={() => {
                  setShowV2Modal(false);
                  setPendingAction(null);
                }}
                className="px-4 py-2 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-lg hover:from-gray-500 hover:to-gray-600 transition-colors shadow-lg"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
      <div className="flex flex-col flex-1 gap-2">
        <motion.div
          className="min-h-[25vh] flex flex-col relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="p-2 sm:p-0 rounded-xl relative flex-1 flex flex-col justify-center border border-white/10 shadow-lg">
            <div className="relative flex-1 flex items-center justify-center min-h-[25vh]">
              <LoadingOverlay
                isLoading={userLoading}
                isMobile={isMobile}
                className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-xl"
              />
              {userError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-[8px] sm:text-[10px] p-2 text-center mb-2 bg-gradient-to-br from-red-500/10 to-red-600/10 rounded-lg border border-red-500/20 relative z-0 w-full shadow-lg"
                >
                  Error: {userError.message}
                </motion.div>
              )}
              {userData && (
                <div className="relative z-0 w-full">
                  <div className="absolute top-3 right-3">
                    <motion.button
                      onClick={onSignOut}
                      disabled={isSigningOut}
                      className={`p-1 rounded-lg bg-gradient-to-r from-white/10 to-white/5 ${isSigningOut ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-500/30'}`}
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
                      src={getProfilePictureSrc(userData.profilePicture)}
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
                    <div className="rounded-xl p-3 bg-gradient-to-br from-black/80 to-gray-900/80 border border-white/20 shadow-lg shadow-black/20">
                      <h5 className="font-bold text-white uppercase mb-2 flex items-center gap-1">
                        <User className="w-4 h-4" />
                        Account Info
                      </h5>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-white/70">Tier:</span>
                          <div className="flex items-center gap-1">
                            {userData.tier === 'Basic' ? (
                              <>
                                <Shield className="w-3 h-3 text-white/80" />
                                <span className="text-white/80">{userData.tier}</span>
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
                    <div className="rounded-xl p-3 bg-gradient-to-br from-black/80 to-gray-900/80 border border-white/20 shadow-lg shadow-black/20 relative">
                      <h5 className="font-bold text-white uppercase mb-2 flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        Social
                      </h5>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1">
                            <img src="/logos/google.webp" alt="Google Logo" className="w-3 h-3" />
                            <span className="text-white/70">Google:</span>
                            <span className="text-neon-blue truncate max-w-32">{userData.email}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1">
                            <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3 text-blue-400" />
                            <span className="text-white/70">(Twitter):</span>
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
                                  className={`p-1 rounded-lg bg-gradient-to-r from-white/10 to-white/5 ${disconnectTwitterMutation.isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-500/40'}`}
                                  whileHover={{ scale: disconnectTwitterMutation.isLoading ? 1 : 1.05 }}
                                  whileTap={{ scale: disconnectTwitterMutation.isLoading ? 1 : 0.95 }}
                                  title="Disconnect X"
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
                      </div>
                      {!userData.twitterHandle && (
                        <motion.button
                          onClick={() => connectTwitterMutation.mutate()}
                          className="absolute bottom-2 right-2 px-3 py-1 rounded-xl text-[9px] sm:text-[11px] font-medium text-neon-blue border border-neon-blue/50 bg-gradient-to-r from-white/10 to-white/5 hover:bg-neon-blue/20 transition-all duration-300 shadow-lg"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          Connect <img src="/logos/x.webp" alt="X Logo" className="inline w-3 h-3 mr-1" />
                        </motion.button>
                      )}
                    </div>
                    <div className="rounded-xl p-3 bg-gradient-to-br from-black/80 to-gray-900/80 border border-white/20 shadow-lg shadow-black/20">
                      <h5 className="font-bold text-white uppercase mb-2 flex items-center gap-1">
                        <Coins className="w-4 h-4 text-yellow-400" />
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
          </div>
        </motion.div>

        {/* Daily Check-in Bar - Pass twitterConnected prop */}
        {userData && (
          <DailyCheckinBar
            last7Days={userData.last7Days}
            streak={userData.streak}
            onCheckin={handleDailyCheckin}
            isLoading={overallLoading}
            userData={userData}
            twitterConnected={!!userData.twitterHandle}
          />
        )}

        {/* Tab Navigation - Enhanced with moving indicator */}
        <motion.div
          className="border border-white/15 rounded-xl bg-gradient-to-r from-black/40 to-gray-900/40 flex flex-col shadow-xl relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="border-b border-white/15 bg-gradient-to-r from-black/30 to-gray-900/30 flex h-[32px] sm:h-[40px] overflow-hidden">
            {['tasks', 'leaderboard'].map((tab) => {
              const isActive = activeTab === tab;
              return (
                <motion.button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 text-[10px] sm:text-xs font-bold text-white uppercase tracking-wider py-2 relative transition-all duration-300 flex items-center justify-center gap-1 ${isActive
                    ? 'text-white shadow-lg bg-gradient-to-r from-white/10 to-white/5'
                    : 'text-white/70 hover:text-neon-blue hover:bg-white/5'
                    }`}
                >
                  {tab === 'tasks' && <svg className="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2V12H2C2 6.47715 6.47715 2 12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12H12V2C17.5228 2 22 6.47715 22 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>}
                  {tab === 'leaderboard' && <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>}
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
          </div>
          {/* Sửa: Connect prompt - thêm min-h để cân đối với tab content, border shadow */}
          {!userData?.twitterHandle ? (
            <motion.div
              className="flex-1 flex items-center justify-center p-6 min-h-[calc(45vh-4rem)] bg-gradient-to-br from-black/90 to-gray-900/90 rounded-b-xl border-t border-white/15 shadow-2xl shadow-black/30" // Thêm min-h, shadow
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="text-center max-w-md flex flex-col items-center justify-center gap-4"> {/* Thêm gap và center */}
                <p className="text-[11px] sm:text-base text-white/80">
                  Connect your X (Twitter) account to unlock tasks, check-ins, and rewards.
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
          ) : (
            <AnimatePresence mode="wait">
              {activeTab === 'tasks' && renderTasksSection()}
              {activeTab === 'leaderboard' && renderLeaderboardSection()}
            </AnimatePresence>
          )}
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