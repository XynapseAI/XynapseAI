// components/ProfileTab.jsx
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import { signOut } from 'next-auth/react';
import { ethers } from 'ethers';
import { logger } from '../utils/logger';

export default function ProfileTab({ recaptchaRef }) {
  const { data: session, status } = useSession();
  const [userData, setUserData] = useState(null);
  const [error, setError] = useState(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [isDisconnectingWallet, setIsDisconnectingWallet] = useState(false);
  const [recaptchaTokens, setRecaptchaTokens] = useState({});
  const [csrfToken, setCsrfToken] = useState(null);
  const [jwtToken, setJwtToken] = useState(null);

  // Fetch CSRF and JWT tokens with retry logic
  useEffect(() => {
    async function fetchTokens() {
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          attempts++;
          logger.info(`Attempting to fetch CSRF and JWT (attempt ${attempts})`);
          const [csrfResponse, jwtResponse] = await Promise.all([
            axios.get('/api/csrf-token', { withCredentials: true }),
            axios.get('/api/auth/jwt', { withCredentials: true }),
          ]);

          const csrf = csrfResponse.data.csrfToken;
          const jwt = jwtResponse.data.token;

          if (!csrf || !jwt) {
            throw new Error('Invalid token data');
          }

          setCsrfToken(csrf);
          setJwtToken(jwt);
          logger.info('Successfully fetched CSRF and JWT', {
            csrfToken: csrf.substring(0, 8) + '...',
            jwtToken: jwt.substring(0, 8) + '...',
          });
          setError(null);
          return;
        } catch (err) {
          logger.error(`Error fetching tokens (attempt ${attempts}):`, {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data,
          });
          if (attempts === maxAttempts) {
            setError(`Failed to fetch CSRF or JWT after ${maxAttempts} attempts: ${err.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    if (status === 'authenticated') {
      fetchTokens();
    }
  }, [status]);

  // Execute reCAPTCHA
  const executeRecaptcha = async (action) => {
    if (!recaptchaRef.current) {
      throw new Error('reCAPTCHA not initialized');
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await recaptchaRef.current.reset(); // Reset reCAPTCHA for fresh token
        const token = await recaptchaRef.current.executeAsync();
        if (!token) throw new Error('Empty reCAPTCHA token');
        logger.info(`Generated reCAPTCHA token (attempt ${attempt}) for ${action}`, {
          token: token.substring(0, 8) + '...',
        });
        setRecaptchaTokens((prev) => ({ ...prev, [action]: token }));
        return token;
      } catch (err) {
        logger.warn(`Error generating reCAPTCHA token (attempt ${attempt}) for ${action}:`, {
          message: err.message,
        });
        if (attempt === 3) throw new Error(`Failed to generate reCAPTCHA token after 3 attempts: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error('Unable to generate reCAPTCHA token');
  };

  // Fetch user data
  useEffect(() => {
    async function fetchUserData() {
      if (status !== 'authenticated' || !session?.user?.id) {
        logger.warn('Invalid session or missing user ID:', { status, userId: session?.user?.id });
        return;
      }
      logger.info('Starting fetchUserData with user ID:', session.user.id);
      try {
        const token = await executeRecaptcha('get_user');
        const response = await axios.get(`/api/user?uid=${encodeURIComponent(session.user.id)}`, {
          headers: { 'X-Recaptcha-Token': token },
          withCredentials: true,
        });
        if (!response.data.success) {
          throw new Error(
            response.data.detail ||
            response.data.errors?.map((e) => e.msg).join(', ') ||
            'Unable to fetch user data'
          );
        }
        logger.info('Fetched user data:', response.data.user);
        setUserData(response.data.user);
        setError(null);
      } catch (err) {
        logger.error('Error fetching user data:', {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });
        if (err.response?.status === 404) {
          setError('User not found. Signing out...');
          await signOut({ redirect: false });
          window.location.href = '/auth/signin';
        } else {
          setError(
            err.response?.status === 403
              ? `Access denied: ${err.response?.data?.detail || 'Please try again later'}`
              : `Unable to load profile: ${err.message}`
          );
        }
      }
    }
    fetchUserData();
  }, [status, session?.user?.id]);

  // Connect wallet
  const handleConnectWallet = async () => {
    if (!window.ethereum) {
      setError('Please install MetaMask.');
      logger.error('MetaMask not installed');
      return;
    }
    if (!csrfToken || !jwtToken) {
      setError('CSRF token or JWT not fetched');
      logger.error('Missing CSRF token or JWT for wallet connection');
      return;
    }
    setIsConnectingWallet(true);
    setError(null);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const walletAddress = accounts[0];
      const signer = await provider.getSigner();
      const message = `Verify wallet for UID: ${session.user.id}`;
      const signature = await signer.signMessage(message);
      const token = await executeRecaptcha('verify-wallet');

      logger.info('Sending wallet verification request:', {
        csrfToken: csrfToken.substring(0, 8) + '...',
        jwtToken: jwtToken.substring(0, 8) + '...',
        walletAddress: walletAddress.substring(0, 8) + '...',
        recaptchaToken: token.substring(0, 8) + '...',
      });

      const response = await axios.post(
        '/api/verify-wallet',
        {
          action: 'verify-wallet',
          walletAddress,
          signature,
          message,
          uid: session.user.id,
          recaptchaToken: token,
        },
        {
          headers: {
            'X-CSRF-Token': csrfToken,
            Authorization: `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.detail || 'Unable to verify wallet');
      }
      logger.info('Wallet connected successfully:', { walletAddress });
      setUserData({ ...userData, walletAddress });
    } catch (err) {
      logger.error('Error connecting wallet:', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      setError(`Unable to connect wallet: ${err.response?.data?.detail || err.message}`);
    } finally {
      setIsConnectingWallet(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  // Disconnect wallet
  const handleDisconnectWallet = async () => {
    if (!csrfToken || !jwtToken) {
      setError('CSRF token or JWT not fetched');
      logger.error('Missing CSRF token or JWT for wallet disconnection');
      return;
    }
    setIsDisconnectingWallet(true);
    setError(null);
    try {
      const token = await executeRecaptcha('disconnect-wallet');
      const response = await axios.post(
        '/api/verify-wallet',
        {
          action: 'disconnect-wallet',
          uid: session.user.id,
          recaptchaToken: token,
        },
        {
          headers: {
            'X-CSRF-Token': csrfToken,
            Authorization: `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.detail || 'Unable to disconnect wallet');
      }
      logger.info('Wallet disconnected successfully');
      setUserData({ ...userData, walletAddress: null });
    } catch (err) {
      logger.error('Error disconnecting wallet:', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      setError(`Unable to disconnect wallet: ${err.message}`);
    } finally {
      setIsDisconnectingWallet(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  // Disconnect Twitter
  const handleDisconnectTwitter = async () => {
    try {
      await signOut({ redirect: false });
      setUserData(null);
      setError(null);
      logger.info('Twitter disconnected successfully');
      window.location.href = '/auth/signin';
    } catch (err) {
      logger.error('Error disconnecting Twitter:', {
        message: err.message,
        stack: err.stack,
      });
      setError('Unable to disconnect Twitter');
    }
  };

  // Calculate days active
  const getDaysActive = () => {
    if (!userData?.lastConnected) return 0;
    const lastConnectedDate = new Date(userData.lastConnected);
    const currentDate = new Date();
    const diffTime = Math.abs(currentDate - lastConnectedDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  if (status === 'loading') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-plexmono w-[90%] min-h-[calc(100vh-4rem)] max-w-7xl mx-auto p-2 sm:p-6 bg-gray-900/95 rounded-xl shadow-card overflow-y-auto custom-scrollbar mt-14 sm:mt-0 backdrop-blur-md "
      >
        <p className="text-sm text-gray-600 text-center">Loading...</p>
      </motion.div>
    );
  }

  if (!session) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-plexmono w-[90%] min-h-[calc(100vh-4rem)] max-w-7xl mx-auto p-2 sm:p-6 bg-gray-900/95 rounded-xl shadow-card overflow-y-auto custom-scrollbar mt-14 sm:mt-0 backdrop-blur-md"
      >
        <p className="text-sm text-gray-600 text-center">Please sign in to view your profile.</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="font-plexmono w-[100%] min-h-[calc(100vh)] max-w-10xl mx-auto p-2 sm:p-6 bg-tech rounded-xl shadow-card overflow-y-auto custom-scrollbar mt-12 sm:mt-0 backdrop-blur-md"
    >
      <div className="w-full rounded-xl shadow-card backdrop-blur-md p-6 mt-6">
        {error && <p className="text-red-500 text-sm mb-4">Error: {error}</p>}
        {!userData && !error && (
          <p className="text-sm text-gray-600 text-center">Loading profile...</p>
        )}
        {userData && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm font-bold text-white mb-3">Twitter</h3>
              <div className="flex items-center">
                <img
                  src={userData.twitterPFP || '/default-avatar.png'}
                  alt={userData.twitterHandle}
                  className="w-20 h-20 border border-white rounded-2xl mr-3"
                />
                <span className="text-sm text-white">{userData.twitterHandle || 'Not connected'}</span>
              </div>
              <button
                onClick={handleDisconnectTwitter}
                className="mt-4 px-4 py-2 rounded-xl text-sm font-medium bg-white/10 text-red-500 hover:bg-white/15 transition-all duration-300 border border-white/20 backdrop-blur-md"
              >
                Disconnect Twitter
              </button>
            </div>
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm font-bold text-white mb-3">Wallet</h3>
              <p className="text-sm text-white truncate">{userData.walletAddress || 'Not connected'}</p>
              <button
                onClick={handleConnectWallet}
                disabled={isConnectingWallet || userData.walletAddress}
                className={`mt-4 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${isConnectingWallet || userData.walletAddress
                    ? 'bg-white/10 text-white/50 cursor-not-allowed opacity-50'
                    : 'bg-white/10 text-white hover:bg-white/15 hover:shadow-glow-neon'
                  }`}
              >
                {isConnectingWallet ? 'Connecting...' : 'Connect Wallet'}
              </button>
              {userData.walletAddress && (
                <button
                  onClick={handleDisconnectWallet}
                  disabled={isDisconnectingWallet}
                  className={`mt-4 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${isDisconnectingWallet
                      ? 'bg-white/10 text-white/50 cursor-not-allowed opacity-50'
                      : 'bg-white/10 text-red-500 hover:bg-white/15'
                    }`}
                >
                  {isDisconnectingWallet ? 'Disconnecting...' : 'Disconnect Wallet'}
                </button>
              )}
            </div>
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm font-bold text-white mb-3">Points</h3>
              <p className="text-5xl font-bold text-green-500 text-center mb-3">{userData.points || 12}</p>
            </div>
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm font-bold text-white mb-3">Days Active</h3>
              <p className="text-sm font-bold text-green-500 text-center mb-12">{getDaysActive()}</p>
            </div>
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm font-bold text-white mb-3">Tier</h3>
              <p className="text-sm text-white">{userData.tier || 'Basic'}</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}