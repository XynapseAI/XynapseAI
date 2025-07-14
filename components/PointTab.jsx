import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import Image from 'next/image';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function PointTab({ userData, error: propError, loading, handleAnalyzeTweets, isAnalyzing, recaptchaRef }) {
  const { data: session } = useSession();
  const [pointHistory, setPointHistory] = useState([]);
  const [aiPoints, setAiPoints] = useState(0);
  const [taskPoints, setTaskPoints] = useState(0);
  const [aiGrowth, setAiGrowth] = useState({ value: 0, color: 'gray' });
  const [taskGrowth, setTaskGrowth] = useState({ value: 0, color: 'gray' });
  const [error, setError] = useState(propError);

  const executeRecaptcha = async (action = 'fetch_points', retries = 4) => {
    if (!recaptchaRef.current) {
      throw new Error('reCAPTCHA not initialized');
    }
    try {
      await recaptchaRef.current.reset();
      const token = await Promise.race([
        recaptchaRef.current.executeAsync({ action }).then(token => {
          if (!token) throw new Error('Empty reCAPTCHA token');
          return token;
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 60000)),
      ]);
      console.log('reCAPTCHA token generated:', { action, token: token.substring(0, 8) + '...' });
      return token;
    } catch (error) {
      if (retries > 0 && (error.message.includes('timeout') || error.message.includes('network'))) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        return executeRecaptcha(action, retries - 1);
      }
      throw new Error(`reCAPTCHA failed after ${5 - retries} attempts: ${error.message}`);
    }
  };

  useEffect(() => {
    async function fetchData() {
      if (!session?.user?.id) return;

      try {
        const recaptchaToken = await executeRecaptcha('get_user');
        const csrfToken = localStorage.getItem('csrfToken');
        if (!csrfToken) throw new Error('CSRF token not found');

        const userResponse = await axios.get(`/api/user?uid=${session.user.id}`, {
          headers: {
            'x-csrf-token': csrfToken,
            'X-Recaptcha-Token': recaptchaToken,
          },
          withCredentials: true,
        });

        if (userResponse.data.success) {
          setAiPoints(userResponse.data.user.aiPoints || 0);
          setTaskPoints(userResponse.data.user.taskPoints || 0);

          const historyRecaptchaToken = await executeRecaptcha('get_point_history');
          const historyResponse = await axios.get(`/api/point-history?uid=${session.user.id}`, {
            headers: {
              'x-csrf-token': csrfToken,
              'X-Recaptcha-Token': historyRecaptchaToken,
            },
            withCredentials: true,
          });

          const history = historyResponse.data.history || [];
          setPointHistory(history.map(item => ({
            ...item,
            tweetPoints: userResponse.data.user.tweetPoints || 0,
            aiPoints: item.aiPoints || 0,
            taskPoints: userResponse.data.user.taskPoints || 0,
          })));

          const todayAiPoints = userResponse.data.user.aiPoints || 0;
          const yesterdayAiPoints = history.length > 1 ? history[history.length - 2]?.aiPoints || 0 : 0;
          const aiGrowthValue = ((todayAiPoints - yesterdayAiPoints) / (yesterdayAiPoints || 1)) * 100;
          setAiGrowth({
            value: aiGrowthValue.toFixed(2),
            color: aiGrowthValue > 0 ? 'neon-green' : aiGrowthValue < 0 ? 'red-400' : 'gray-400',
          });

          const todayTaskPoints = userResponse.data.user.taskPoints || 0;
          const yesterdayTaskPoints = history.length > 1 ? history[history.length - 2]?.taskPoints || 0 : 0;
          const taskGrowthValue = ((todayTaskPoints - yesterdayTaskPoints) / (yesterdayTaskPoints || 1)) * 100;
          setTaskGrowth({
            value: taskGrowthValue.toFixed(2),
            color: taskGrowthValue > 0 ? 'neon-green' : taskGrowthValue < 0 ? 'red-400' : 'gray-400',
          });
        } else {
          throw new Error('Invalid user data.');
        }
      } catch (err) {
        console.error('Error fetching point data:', err.response?.data || err.message);
        setPointHistory([]);
        setAiPoints(0);
        setTaskPoints(0);
        setError(
          err.response?.status === 429
            ? 'API rate limit exceeded. Please try again later.'
            : err.response?.status === 403
              ? `Access denied: ${err.response?.data?.detail || 'Please try again.'}`
              : err.response?.status === 500 && err.response?.data?.detail?.includes('does not exist')
                ? 'System error: Database table missing. Please contact support.'
                : `Failed to load point data: ${err.response?.data?.detail || err.message}`
        );
      }
    }
    fetchData();
  }, [session]);

  const handleAnalyzeTweetsWithRecaptcha = async () => {
    try {
      const token = await executeRecaptcha('analyze_tweets');
      const csrfToken = localStorage.getItem('csrfToken');
      if (!csrfToken) throw new Error('CSRF token not found');
      await handleAnalyzeTweets({ recaptchaToken: token });
      setError(null);
    } catch (err) {
      console.error('Error analyzing tweets:', err.response?.data || err.message);
      setError(
        err.message.includes('reCAPTCHA')
          ? 'reCAPTCHA verification failed. Please try again.'
          : `Failed to analyze tweets: ${err.response?.data?.detail || err.message}`
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="font-jetbrains w-full max-w-10xl mx-auto bg-galaxy backdrop-blur-lg p-4 md:p-6 shadow-glow-neon h-[calc(100vh)] overflow-y-auto custom-scrollbar"
    >
      <div className="w-full flex flex-col gap-4">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-10 h-10">
                <div className="absolute inset-0 border-2 border-neon-blue/50 border-t-neon-blue rounded-full animate-spin"></div>
                <Image
                  src="/logos/logo-scan.png"
                  alt="Loading Logo"
                  width={40}
                  height={40}
                  className="absolute inset-0 w-7 h-7 m-1.5 object-contain animate-pulse"
                  onError={() => console.log(`Failed to load loading logo: /logos/logo-scan.png`)}
                />
              </div>
              <p className="text-[10px] text-gray-500 font-medium animate-pulse">Loading point data...</p>
            </div>
          </div>
        )}
        {(error || propError) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[10px] md:text-sm mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center shadow-glow-neon-red"
          >
            Error: {error || propError}
          </motion.div>
        )}
        {!loading && !(error || propError) && (
          <>
            <motion.div
              className="rounded-2xl border border-white/10 bg-gray-900/50 backdrop-blur-lg p-4 md:p-6 shadow-glow-neon"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <h2 className="text-[12px] md:text-sm font-bold text-white mb-4 uppercase tracking-wider">Point History</h2>
              <div className="h-64 bg-gradient-to-br from-gray-900/70 to-gray-800/50 rounded-lg p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pointHistory} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid stroke="#ffffff1a" strokeDasharray="5 5" />
                    <XAxis
                      dataKey="date"
                      stroke="#ffffff"
                      tick={{ fontSize: 9, fill: '#ffffff' }}
                      angle={-45}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis stroke="#ffffff" tick={{ fontSize: 9, fill: '#ffffff' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1a1a',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '0.5rem',
                        padding: '0.5rem',
                        boxShadow: '0 0 8px rgba(0, 191, 255, 0.3)',
                      }}
                      labelStyle={{ color: '#ffffff' }}
                      itemStyle={{ color: '#ffffff' }}
                      cursor={{ stroke: '#00BFFF', strokeWidth: 1 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="tweetPoints"
                      stroke="#00BFFF"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ fill: '#00BFFF', r: 4, stroke: '#ffffff', strokeWidth: 1 }}
                      name="Tweet Points"
                    />
                    <Line
                      type="monotone"
                      dataKey="aiPoints"
                      stroke="#FFD700"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ fill: '#FFD700', r: 4, stroke: '#ffffff', strokeWidth: 1 }}
                      name="AI Points"
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
            </motion.div>
            <div className="flex-1 flex flex-col sm:flex-row gap-4">
              <motion.div
                className="flex-1 rounded-2xl border border-white/10 bg-gray-900/50 backdrop-blur-lg p-4 md:p-6 shadow-glow-neon hover:bg-gray-900/70 min-h-[150px]"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <h3 className="text-[10px] md:text-sm font-bold text-white mb-3 uppercase tracking-wider">Total Points</h3>
                <p className="text-3xl md:text-4xl font-bold text-neon-blue text-center mb-4">{userData?.points || 0}</p>
                <motion.button
                  onClick={handleAnalyzeTweetsWithRecaptcha}
                  className={`w-full px-3 py-1.5 rounded-full text-[9px] md:text-xs font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${
                    isAnalyzing || loading
                      ? 'bg-white/10 text-white/50 cursor-not-allowed opacity-50'
                      : 'text-white hover:bg-white/20 hover:shadow-glow-neon'
                  }`}
                  whileHover={{ scale: isAnalyzing || loading ? 1 : 1.05 }}
                  whileTap={{ scale: isAnalyzing || loading ? 1 : 0.95 }}
                  disabled={isAnalyzing || loading}
                >
                  {isAnalyzing ? 'Processing...' : 'Analyze Tweets'}
                </motion.button>
              </motion.div>
              <motion.div
                className="flex-1 rounded-2xl border border-white/10 bg-gray-900/50 backdrop-blur-lg p-4 md:p-6 shadow-glow-neon hover:bg-gray-900/70 min-h-[150px] flex flex-col items-center justify-center"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <h3 className="text-[10px] md:text-sm font-bold text-white mb-3 uppercase tracking-wider">AI Points</h3>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-3xl md:text-4xl font-bold text-neon-blue">{aiPoints}</p>
                  <motion.p
                    className={`text-[9px] md:text-xs font-semibold text-${aiGrowth.color} ${aiGrowth.value != 0 ? 'animate-pulse' : ''}`}
                    animate={{ opacity: aiGrowth.value != 0 ? [1, 0.7, 1] : 1 }}
                    transition={{ duration: 1.5, repeat: aiGrowth.value != 0 ? Infinity : 0 }}
                  >
                    {aiGrowth.value}% {aiGrowth.value > 0 ? '↑' : aiGrowth.value < 0 ? '↓' : '–'}
                  </motion.p>
                </div>
              </motion.div>
              <motion.div
                className="flex-1 rounded-2xl border border-white/10 bg-gray-900/50 backdrop-blur-lg p-4 md:p-6 shadow-glow-neon hover:bg-gray-900/70 min-h-[150px] flex flex-col items-center justify-center"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <h3 className="text-[10px] md:text-sm font-bold text-white mb-3 uppercase tracking-wider">Task Points</h3>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-3xl md:text-4xl font-bold text-neon-blue">{taskPoints}</p>
                  <motion.p
                    className={`text-[9px] md:text-xs font-semibold text-${taskGrowth.color} ${taskGrowth.value != 0 ? 'animate-pulse' : ''}`}
                    animate={{ opacity: taskGrowth.value != 0 ? [1, 0.7, 1] : 1 }}
                    transition={{ duration: 1.5, repeat: taskGrowth.value != 0 ? Infinity : 0 }}
                  >
                    {taskGrowth.value}% {taskGrowth.value > 0 ? '↑' : taskGrowth.value < 0 ? '↓' : '–'}
                  </motion.p>
                </div>
              </motion.div>
            </div>
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
        .shadow-glow-neon-blue {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.1);
        }
        .bg-tech {
          background: linear-gradient(145deg, #1a1a1a, #2a2a2a);
        }
        @media (max-width: 640px) {
          .flex-col {
            flex-direction: column;
          }
          .min-h-[150px] {
            min-height: 120px;
          }
          .text-4xl {
            font-size: 1.875rem;
          }
          .text-3xl {
            font-size: 1.5rem;
          }
          .text-[10px] {
            font-size: 8px;
          }
          .text-[9px] {
            font-size: 7px;
          }
          .h-64 {
            height: 48rem;
          }
        }
      `}</style>
    </motion.div>
  );
}