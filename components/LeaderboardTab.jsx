'use client';

import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import Image from 'next/image';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

// LoadingOverlay component (adapted from MarketTab)
const LoadingOverlay = ({ loadingStates = {}, isMobile }) => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  const messages = [
    ...(loadingStates.loading ? ['Loading rankings...'] : []),
  ].filter(Boolean);

  useEffect(() => {
    if (messages.length === 0) return;

    const interval = setInterval(() => {
      setCurrentMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [messages.length]);

  if (messages.length === 0) return null;

  return (
    <div className={`fixed inset-0 flex items-center justify-center z-50 ${
      isMobile ? 'bg-gray-900/70' : 'bg-gray-900/30 backdrop-blur-lg'
    }`}>
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-8 h-8"> {/* Smaller size for LoadingOverlay */}
          <div className={`absolute inset-0 border-2 rounded-full animate-spin ${
            isMobile ? 'border-gray-400 border-t-white' : 'border-neon-blue/50 border-t-white'
          }`}></div>
          <Image
            src="/logos/logo-scan.png"
            alt="Loading Logo"
            width={24}
            height={24}
            className={`absolute inset-0 w-5 h-5 m-1.5 object-contain ${isMobile ? '' : 'animate-pulse'}`}
            onError={() => console.log(`Failed to load loading logo: /logos/logo-scan.png`)}
          />
        </div>
        <p className="text-[8px] md:text-[9px] text-gray-400 font-medium">
          {messages[currentMessageIndex] || 'Processing...'}
        </p>
      </div>
    </div>
  );
};

export default function LeaderboardTab({ topPlayers, loading, error: propError, recaptchaRef }) {
  const { data: session, status } = useSession();
  const [userInfo, setUserInfo] = useState(null);
  const [tabError, setTabError] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [creators, setCreators] = useState([]);
  const [aiRank, setAiRank] = useState([]);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 640); // Add isMobile state

  // Handle window resize to update isMobile
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Use topPlayers prop instead of refetching /api/connect-data
  useEffect(() => {
    if (topPlayers) {
      setRankings(topPlayers.rankings || []);
      setCreators(topPlayers.creators || []);
      setAiRank(topPlayers.aiRank || []);
    }
  }, [topPlayers]);

  // Fetch user data
  useEffect(() => {
    async function fetchUserData() {
      if (status !== 'authenticated' || !session?.user?.id) return;
      try {
        if (!recaptchaRef.current) throw new Error('reCAPTCHA not ready');
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
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }
        if (!recaptchaToken) throw new Error('Failed to generate reCAPTCHA token');

        const userResponse = await axios.get(`${API_BASE_URL}/api/user?uid=${encodeURIComponent(session.user.id)}`, {
          headers: {
            'X-Recaptcha-Token': recaptchaToken,
          },
          withCredentials: true,
        });
        if (!userResponse.data.success) {
          throw new Error(userResponse.data.detail || 'Failed to fetch user information');
        }
        setUserInfo(userResponse.data.user);
      } catch (err) {
        console.error('Error fetching user data:', err.response?.data || err.message);
        setUserInfo(null);
        setTabError(`Failed to load user information: ${err.response?.data?.detail || err.message}`);
      }
    }
    fetchUserData();
  }, [status, session, recaptchaRef]);

  // Sync propError to tabError
  useEffect(() => {
    setTabError(propError);
  }, [propError]);

  const getUserRank = (user, list) => {
    if (!user || !list.length) return null;
    const userIndex = list.findIndex((u) => u.id === user.id);
    return userIndex !== -1 ? userIndex + 1 : null;
  };

  const renderUserRow = (user, index, isCurrentUser = false, list = rankings) => {
    const rank = isCurrentUser ? getUserRank(user, list) || 'N/A' : index + 1;
    const rankStyles = {
      1: isMobile ? 'bg-gradient-to-r from-blue-400/20 to-transparent border-blue-400/50 h-1/2 mb-1' : 'bg-gradient-to-r from-blue-400/20 to-transparent border-blue-400/50 shadow-glow-neon-blue mb-1',
      2: isMobile ? 'bg-gradient-to-r from-gray-400/20 to-transparent border-gray-400/50' : 'bg-gradient-to-r from-gray-400/20 to-transparent border-gray-400/50 shadow-glow-neon',
      3: isMobile ? 'bg-gradient-to-r from-pink-400/20 to-transparent border-pink-400/50' : 'bg-gradient-to-r from-pink-400/20 to-transparent border-pink-400/50 shadow-glow-neon-pink',
    };

    return (
      <motion.a
        key={user.id}
        href={`https://x.com/${user.twitterHandle}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`grid grid-cols-12 gap-1 p-1 rounded-xl font-jetbrains transition-all duration-300 border border-white/10 ${
          isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-lg hover:bg-gray-900/70'
        } ${rankStyles[rank] || ''} ${isCurrentUser ? (isMobile ? '' : ' ') : ''}`}
        whileHover={{ scale: 1 }}
        whileTap={{ scale: 0.98 }}
      >
        {/* Sliding underline effect on hover */}
        <span className={`absolute bottom-0 left-0 w-full h-0.5 bg-neon-blue transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100`} />
        <div className="col-span-2 text-[9px] md:text-[10px] text-white flex items-center ml-2">{rank}</div>
        <div className="col-span-6 flex items-center">
          <Image
            src={user.twitterPFP && user.twitterPFP.startsWith('http') ? user.twitterPFP : '/default-avatar.png'}
            alt={user.twitterHandle || 'User Avatar'}
            width={24}
            height={24}
            className="rounded-xl border border-white/20 mr-2 object-cover"
            onError={(e) => {
              console.log(`Failed to load Twitter PFP: ${user.twitterPFP}`);
              e.target.src = '/default-avatar.png';
            }}
          />
          <span className="font-jetbrains text-[9px] md:text-[10px] text-white truncate flex items-center">
            {user.twitterHandle || 'Anonymous'}
            {isCurrentUser && (
              <span className={`ml-2 text-[8px] md:text-[9px] font-medium text-neon-blue px-1.5 py-0.5 rounded-full border border-neon-blue/50 ${
                isMobile ? 'bg-gray-900' : 'bg-gray-900/80 backdrop-blur-md'
              }`}>
                You
              </span>
            )}
          </span>
        </div>
        <div className="col-span-4 p-1 mr-2 text-right text-[10px] md:text-[11px] text-neon-blue uppercase">{user.points || 0}</div>
      </motion.a>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`font-jetbrains w-full mt-12 max-w-10xl mx-auto h-[calc(100vh)] overflow-hidden ${
        isMobile ? 'bg-galaxy' : 'bg-galaxy'
      }`}
    >
      <LoadingOverlay loadingStates={{ loading }} isMobile={isMobile} />
      <div className={`w-full rounded-xl p-2 md:p-3 ${
        isMobile ? 'backdrop-blur-lg' : 'backdrop-blur-lg'
      }`}>
        <h3 className="text-[12px] md:text-sm font-bold text-white mb-4 text-center uppercase tracking-wider">
          Top 100 Rankings
        </h3>
        {(tabError || propError) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-red-400 text-[10px] md:text-sm mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center ${
              isMobile ? '' : ''
            }`}
          >
            Error: {tabError || propError}
          </motion.div>
        )}
        {!loading && !(tabError || propError) && rankings.length === 0 && (
          <div className={`text-center text-gray-400 text-[10px] md:text-sm p-1 rounded-xl border border-white/10 ${
            isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-lg'
          }`}>
            <p>No ranking data available.</p>
          </div>
        )}
        {!loading && rankings.length > 0 && (
          <>
            <div className="grid grid-cols-12 gap-2 text-[9px] md:text-[10px] text-gray-400 mb-2">
              <div className="col-span-2">Rank</div>
              <div className="col-span-6">User</div>
              <div className="col-span-4 text-right">Points</div>
            </div>
            {userInfo && renderUserRow(userInfo, -1, true, rankings)}
            {rankings.map((user, index) => renderUserRow(user, index, false, rankings))}
          </>
        )}
      </div>
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .shadow-glow-neon {
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.3), 0 0 16px rgba(255, 255, 255, 0.1);
        }
        .shadow-glow-neon-red {
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.3), 0 0 16px rgba(239, 68, 68, 0.1);
        }
        .shadow-glow-neon-yellow {
          box-shadow: 0 0 8px rgba(251, 191, 36, 0.3), 0 0 16px rgba(251, 191, 36, 0.1);
        }
        .shadow-glow-neon-orange {
          box-shadow: 0 0 8px rgba(255, 147, 0, 0.3), 0 0 16px rgba(255, 147, 0, 0.1);
        }
        .shadow-glow-neon-blue {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.1);
        }
        .bg-tech {
          background: linear-gradient(145deg, #1a1a1a, #2a2a2a);
        }
        .animate-pulse {
          animation: ${isMobile ? 'none' : 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
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
          .grid-cols-12 {
            grid-template-columns: 2fr 6fr 4fr;
          }
          .p-2 {
            padding: 1rem;
          }
          .text-[10px] {
            font-size: 8px;
          }
          .text-[9px] {
            font-size: 7px;
          }
          .text-[12px] {
            font-size: 10px;
          }
          .text-sm {
            font-size: 12px;
          }
        }
      `}</style>
    </motion.div>
  );
}