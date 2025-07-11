import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import { signOut } from 'next-auth/react';
import { ethers } from 'ethers';

export default function ProfileTab({ recaptchaRef }) {
  const { data: session, status } = useSession();
  const [userData, setUserData] = useState(null);
  const [error, setError] = useState(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [isDisconnectingWallet, setIsDisconnectingWallet] = useState(false);
  const [csrfToken, setCsrfToken] = useState(null);

  useEffect(() => {
    async function fetchCsrfToken() {
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const response = await axios.get('/api/csrf-token', { withCredentials: true });
          const csrf = response.data.csrfToken;
          if (!csrf) throw new Error('Empty CSRF token received');
          setCsrfToken(csrf);
          localStorage.setItem('csrfToken', csrf); // Đồng bộ với Dashboard
          setError(null);
          return;
        } catch (err) {
          attempts++;
          if (attempts === maxAttempts) {
            setError(`Failed to fetch CSRF token after ${maxAttempts} attempts: ${err.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    if (status === 'authenticated') {
      fetchCsrfToken();
    }
  }, [status]);

  const executeRecaptcha = async (action) => {
    if (!recaptchaRef.current) {
      throw new Error('reCAPTCHA not initialized');
    }
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await recaptchaRef.current.reset();
        const token = await recaptchaRef.current.executeAsync({ action });
        if (!token) throw new Error('Empty reCAPTCHA token');
        return token;
      } catch (err) {
        if (attempt === 5) throw new Error(`Failed to generate reCAPTCHA token for ${action} after 5 attempts: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    throw new Error(`Unable to generate reCAPTCHA token for ${action}`);
  };

  useEffect(() => {
    async function fetchUserData() {
      if (status !== 'authenticated' || !session?.user?.id || !csrfToken) {
        return;
      }
      try {
        const token = await executeRecaptcha('get_user');
        const response = await axios.get(`/api/user?uid=${encodeURIComponent(session.user.id)}`, {
          headers: {
            'x-csrf-token': csrfToken,
            'X-Recaptcha-Token': token,
          },
          withCredentials: true,
        });
        if (!response.data.success) {
          throw new Error(
            response.data.detail ||
            response.data.errors?.map((e) => e.msg).join(', ') ||
            'Unable to fetch user data'
          );
        }
        setUserData(response.data.user);
        setError(null);
      } catch (err) {
        console.error('Error fetching user data:', err);
        if (err.response?.status === 404) {
          setError('User not found. Signing out...');
          await signOut({ redirect: false });
          window.location.href = '/auth/signin';
        } else if (err.response?.status === 403) {
          setError(`Access denied: ${err.response?.data?.detail || 'Invalid CSRF or reCAPTCHA. Please try again.'}`);
        } else {
          setError(`Unable to load profile: ${err.message}`);
        }
      }
    }
    fetchUserData();
  }, [status, session?.user?.id, csrfToken]);

  const handleConnectWallet = async () => {
    if (!window.ethereum) {
      setError('Please install MetaMask.');
      return;
    }
    if (!csrfToken) {
      setError('CSRF token not fetched');
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
            'x-csrf-token': csrfToken,
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.detail || 'Unable to verify wallet');
      }
      setUserData({ ...userData, walletAddress });
    } catch (err) {
      console.error('Wallet connection error:', err);
      setError(`Unable to connect wallet: ${err.response?.data?.detail || err.message}`);
    } finally {
      setIsConnectingWallet(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  const handleDisconnectWallet = async () => {
    if (!csrfToken) {
      setError('CSRF token not fetched');
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
            'x-csrf-token': csrfToken,
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.detail || 'Unable to disconnect wallet');
      }
      setUserData({ ...userData, walletAddress: null });
    } catch (err) {
      console.error('Wallet disconnection error:', err);
      setError(`Unable to disconnect wallet: ${err.response?.data?.detail || err.message}`);
    } finally {
      setIsDisconnectingWallet(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  const handleDisconnectTwitter = async () => {
    try {
      await signOut({ redirect: false });
      setUserData(null);
      setError(null);
      setCsrfToken(null);
      localStorage.removeItem('csrfToken');
      window.location.href = '/auth/signin';
    } catch (err) {
      console.error('Twitter disconnection error:', err);
      setError('Unable to disconnect Twitter');
    }
  };

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
        className="font-jetbrains w-full max-w-screen-md md:max-w-full h-[calc(100vh-4rem)] mx-auto p-2 md:p-6 bg-gray-900/95 rounded-xl shadow-card overflow-y-auto custom-scrollbar"
      >
        <p className="text-sm md:text-base text-gray-600 text-center">Loading...</p>
      </motion.div>
    );
  }

  if (!session) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-jetbrains w-full max-w-screen-md md:max-w-full h-[calc(100vh-4rem)] mx-auto p-2 md:p-6 bg-gray-900/95 rounded-xl shadow-card overflow-y-auto custom-scrollbar"
      >
        <p className="text-sm md:text-base text-gray-600 text-center">Please sign in to view your profile.</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="font-jetbrains w-full max-w-screen-md md:max-w-full h-[calc(100vh-4rem)] mx-auto p-2 md:p-6 rounded-xl shadow-card overflow-y-auto custom-scrollbar"
    >
      <div className="w-full rounded-xl shadow-card backdrop-blur-md p-4 md:p-6">
        {error && <p className="text-red-500 text-sm md:text-base mb-4">Error: {error}</p>}
        {!userData && !error && (
          <p className="text-sm md:text-base text-gray-600 text-center">Loading profile...</p>
        )}
        {userData && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 bg-tech backdrop-blur-md">
              <h3 className="text-sm md:text-base font-bold text-white mb-3">TWITTER (X)</h3>
              <div className="flex items-center mb-10">
                <img
                  src={userData.twitterPFP || '/default-avatar.png'}
                  alt={userData.twitterHandle}
                  className="w-12 h-12 md:w-16 md:h-16 border border-white rounded-xl mr-2 md:mr-3"
                />
                <span className="text-xs md:text-sm text-white">{userData.twitterHandle || 'Not connected'}</span>
              </div>
              <button
                onClick={handleDisconnectTwitter}
                className="w-full mt-2 px-3 py-1 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all duration-300 border border-red-500/50 backdrop-blur-md text-red-500 hover:bg-red-500/10"
              >
                Disconnect Twitter
              </button>
            </div>
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm md:text-base font-bold text-white mb-3">WALLET</h3>
              <p className="text-xs md:text-sm text-white truncate">{userData.walletAddress || 'Not connected'}</p>
              <button
                onClick={handleConnectWallet}
                disabled={isConnectingWallet || userData.walletAddress}
                className={`w-full mt-3 md:mt-4 px-3 py-1 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${
                  isConnectingWallet || userData.walletAddress
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
                  className={`w-full mt-2 px-3 py-1 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all duration-300 border border-red-500/50 backdrop-blur-md ${
                    isDisconnectingWallet
                      ? 'text-white/50 cursor-not-allowed opacity-50'
                      : 'text-red-500 hover:bg-red-500/10'
                  }`}
                >
                  {isDisconnectingWallet ? 'Disconnecting...' : 'Disconnect'}
                </button>
              )}
            </div>
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm md:text-base font-bold text-white mb-3">POINTS</h3>
              <p className="text-3xl md:text-5xl font-bold text-green-500 text-center mb-10">{userData.points || 0}</p>
            </div>
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm md:text-base font-bold text-white mb-3">DAYS ACTIVE</h3>
              <p className="text-xl md:text-2xl font-bold text-green-500 text-center">{getDaysActive()}</p>
            </div>
            <div className="rounded-xl p-4 flex flex-col justify-between transition-all duration-300 border border-white/10 backdrop-blur-md">
              <h3 className="text-sm md:text-base font-bold text-white mb-3">TIER</h3>
              <p className="text-xs md:text-sm text-center text-white">{userData.tier || 'Basic'}</p>
            </div>
          </div>
        )}
      </div>
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
      `}</style>
    </motion.div>
  );
}