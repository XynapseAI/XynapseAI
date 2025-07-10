import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function LeaderboardTab({ topPlayers, loading, error: propError, recaptchaRef }) {
  const { data: session, status } = useSession();
  const [userInfo, setUserInfo] = useState(null);
  const [tabError, setTabError] = useState(null);
  const [rankings, setRankings] = useState([]);

  useEffect(() => {
    async function fetchConnectData() {
      try {
        const response = await axios.get(`${API_BASE_URL}/connect-data`, {
          headers: {
            'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
          },
          withCredentials: true,
        });
        if (response.data.success) {
          setRankings(response.data.rankings || []);
        } else {
          throw new Error(response.data.detail || 'Failed to fetch connect data');
        }
      } catch (err) {
        console.error('Error fetching connect data:', err.response?.data || err.message);
        setTabError(`Unable to load player list: ${err.response?.data?.detail || err.message}`);
      }
    }

    if (status === 'authenticated') {
      fetchConnectData();
    }
  }, [status]);

  useEffect(() => {
    async function fetchUserData() {
      if (status !== 'authenticated' || !session?.user?.id) return;
      try {
        if (!recaptchaRef.current) throw new Error('reCAPTCHA not ready');
        let recaptchaToken = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await recaptchaRef.current.reset();
            recaptchaToken = await recaptchaRef.current.executeAsync({ action: 'get_user' });
            if (recaptchaToken) break;
          } catch (err) {
            if (attempt === 3) throw new Error('Failed to generate reCAPTCHA token after 3 attempts');
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        if (!recaptchaToken) throw new Error('Failed to generate reCAPTCHA token');

        const userResponse = await axios.get(`${API_BASE_URL}/user?uid=${encodeURIComponent(session.user.id)}`, {
          headers: {
            'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
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
        setTabError(`Failed to load user information: ${err.response?.data?.detail || err.message}`);
      }
    }
    fetchUserData();
  }, [status, session]);

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
    return (
      <a
        key={user.id}
        href={`https://x.com/${user.twitterHandle}`}
        target="_blank"
        rel="noopener noreferrer"
        className="grid grid-cols-12 gap-2 p-1 font-jetbrains hover:bg-white/15 rounded-lg transition-all duration-300 border border-white/10 backdrop-blur-md"
      >
        <div className="col-span-2 text-[10px] md:text-xs text-white">{rank}</div>
        <div className="col-span-6 flex items-center">
          <img
            src={user.twitterPFP || '/default-avatar.png'}
            alt={user.twitterHandle}
            className="w-5 h-5 md:w-6 h-6 rounded-full mr-1 md:mr-2 object-fit: cover"
          />
          <span className="font-jetbrains text-[10px] md:text-xs text-white flex items-center">
            {user.twitterHandle || 'Anonymous'}
            {isCurrentUser && (
              <span className="ml-1 text-[8px] md:text-[10px] font-medium text-white bg-blue-500 px-1 rounded">
                You
              </span>
            )}
          </span>
        </div>
        <div className="col-span-4 text-right text-[10px] md:text-xs text-white">{user.points || 0}</div>
      </a>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="font-jetbrains w-full max-w-screen-md md:max-w-full h-[calc(100vh-2rem)] mx-auto p-2 md:p-4 rounded-xl shadow-card overflow-y-auto custom-scrollbar"
    >
      <div className="w-full rounded-xl p-3 md:p-4 overflow-y-auto custom-scrollbar backdrop-blur-md border border-white/10">
        <h3 className="text-lg md:text-sm font-bold text-white mb-2 md:mb-3 text-center uppercase">Top 100 Rankings</h3>
        {loading && <p className="text-xs md:text-sm text-gray-600">Loading...</p>}
        {(tabError || propError) && (
          <p className="text-xs md:text-sm text-red-500">Error: {tabError || propError}</p>
        )}
        {!loading && !(tabError || propError) && rankings.length === 0 && (
          <p className="text-xs md:text-sm text-gray-600">No ranking data.</p>
        )}
        <div className="grid grid-cols-12 gap-2 text-sm md:text-sm text-gray-400">
          <div className="col-span-2">Rank</div>
          <div className="col-span-6">User</div>
          <div className="col-span-4 text-right">Points</div>
        </div>
        {userInfo && renderUserRow(userInfo, -1, true, rankings)}
        {rankings.map((user, index) => renderUserRow(user, index, false, rankings))}
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