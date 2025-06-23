import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function LeaderboardTab({ topPlayers, loading, error: propError, recaptchaRef }) {
  const { data: session, status } = useSession();
  const [userInfo, setUserInfo] = useState(null);
  const [tabError, setTabError] = useState(null);
  const [creators, setCreators] = useState([]);
  const [aiRank, setAiRank] = useState([]);
  const [rankings, setRankings] = useState([]);

  useEffect(() => {
    if (topPlayers) {
      if (Array.isArray(topPlayers)) {
        setRankings(topPlayers);
        setCreators([]);
        setAiRank([]);
      } else {
        setCreators(topPlayers.creators?.slice(0, 10) || []);
        setAiRank(topPlayers.aiRank?.slice(0, 10) || []);
        setRankings(topPlayers.rankings || []);
      }
    }
  }, [topPlayers]);

  useEffect(() => {
    async function fetchUserData() {
      if (status !== 'authenticated' || !session?.user?.id) return;
      try {
        if (!recaptchaRef.current) throw new Error('reCAPTCHA not ready');
        let recaptchaToken = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            recaptchaToken = await recaptchaRef.current.executeAsync();
            if (recaptchaToken) break;
          } catch (err) {
            if (attempt === 3) throw new Error('Failed to generate reCAPTCHA token after 3 attempts');
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        if (!recaptchaToken) throw new Error('Failed to generate reCAPTCHA token');

        const userResponse = await axios.get(`${API_BASE_URL}/user?uid=${encodeURIComponent(session.user.id)}`, {
          headers: { 'X-Recaptcha-Token': recaptchaToken },
          withCredentials: true,
        });
        if (!userResponse.data.success) {
          throw new Error(userResponse.data.detail || 'Failed to fetch user information');
        }
        setUserInfo(userResponse.data.user);
      } catch (err) {
        setTabError(`Failed to load user information: ${err.message}`);
      } finally {
        if (recaptchaRef.current) recaptchaRef.current.reset();
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
        className="grid grid-cols-12 gap-2 p-2 hover:bg-white/15 rounded-lg transition-all duration-300 border border-white/10 backdrop-blur-md"
      >
        <div className="col-span-2 text-sm text-white">{rank}</div>
        <div className="col-span-6 flex items-center">
          <img
            src={user.twitterPFP || '/default-avatar.png'}
            alt={user.twitterHandle}
            className="w-6 h-6 rounded-full mr-2"
          />
          <span className="text-sm text-white flex items-center">
            {user.twitterHandle || 'Anonymous'}
            {isCurrentUser && (
              <span className="ml-2 text-xs font-medium text-white bg-blue-500 px-2 py-1 rounded">
                You
              </span>
            )}
            {user.isCreator && !isCurrentUser && (
              <span className="ml-2 text-xs font-medium bg-red text-white px-2 py-1 rounded">
                Creator+
              </span>
            )}
            {user.isAiRank && !isCurrentUser && (
              <span className="ml-2 text-xs font-medium text-white bg-yellow-500 px-2 py-1 rounded">
                AI Hunter
              </span>
            )}
          </span>
        </div>
        <div className="col-span-4 text-right text-sm text-white">{user.points || 0}</div>
      </a>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="font-plexmono w-[95%] min-h-[calc(100vh-4rem)] max-w-8xl mx-auto p-2 sm:p-4 rounded-xl shadow-card overflow-y-auto custom-scrollbar mt-14 sm:mt-0 backdrop-blur-md"
    >
      <div className="w-full flex flex-col lg:flex-row gap-4 mb-4">
        <div className="w-full lg:w-1/2 rounded-xl p-4 overflow-y-auto custom-scrollbar bg-tech backdrop-blur-md border border-white/10">
          <h3 className="text-xl font-bold text-white mb-3 uppercase">Creator Rank</h3>
          {loading && <p className="text-sm text-gray-600">Loading...</p>}
          {(tabError || propError) && (
            <p className="text-sm text-red-500">Error: {tabError || propError}</p>
          )}
          {!loading && !(tabError || propError) && creators.length === 0 && (
            <p className="text-sm text-gray-600">No top creators.</p>
          )}
          <div className="grid grid-cols-12 gap-2 text-lg text-gray-600">
            <div className="col-span-2">Rank</div>
            <div className="col-span-6">User</div>
            <div className="col-span-4 text-right">Points</div>
          </div>
          {userInfo && userInfo.isCreator && renderUserRow(userInfo, -1, true, creators)}
          {creators.map((user, index) => renderUserRow(user, index, false, creators))}
        </div>
        <div className="w-full lg:w-1/2 rounded-xl p-4 overflow-y-auto custom-scrollbar bg-tech backdrop-blur-md border border-white/10">
          <h3 className="text-xl font-bold text-white mb-3 uppercase">AI Rank</h3>
          {loading && <p className="text-sm text-gray-600">Loading...</p>}
          {(tabError || propError) && (
            <p className="text-sm text-red-500">Error: {tabError || propError}</p>
          )}
          {!loading && !(tabError || propError) && aiRank.length === 0 && (
            <p className="text-sm text-gray-600">No AI rank users.</p>
          )}
          <div className="grid grid-cols-12 gap-2 text-lg text-gray-600">
            <div className="col-span-2">Rank</div>
            <div className="col-span-6">User</div>
            <div className="col-span-4 text-right">Points</div>
          </div>
          {userInfo && userInfo.isAiRank && renderUserRow(userInfo, -1, true, aiRank)}
          {aiRank.map((user, index) => renderUserRow(user, index, false, aiRank))}
        </div>
      </div>

      <div className="flex flex-col w-full rounded-xl p-4 overflow-y-auto custom-scrollbar bg-tech backdrop-blur-md border border-white/10">
        <h3 className="text-xl font-bold text-white mb-3 text-center uppercase">Top 100 Rankings</h3>
        {loading && <p className="text-sm text-gray-600">Loading...</p>}
        {(tabError || propError) && (
          <p className="text-sm text-red-500">Error: {tabError || propError}</p>
        )}
        {!loading && !(tabError || propError) && rankings.length === 0 && (
          <p className="text-sm text-gray-600">No ranking data.</p>
        )}
        <div className="grid grid-cols-12 gap-2 text-lg text-gray-400">
          <div className="col-span-2">Rank</div>
          <div className="col-span-6">User</div>
          <div className="col-span-4 text-right">Points</div>
        </div>
        {userInfo && renderUserRow(userInfo, -1, true, rankings)}
        {rankings.map((user, index) => renderUserRow(user, index, false, rankings))}
      </div>
    </motion.div>
  );
}