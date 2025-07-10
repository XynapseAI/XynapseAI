import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';

export default function PointTab({ userData, error: propError, loading, handleAnalyzeTweets, isAnalyzing, recaptchaRef }) {
  const { data: session } = useSession();
  const [pointHistory, setPointHistory] = useState([]);
  const [aiPoints, setAiPoints] = useState(0);
  const [taskPoints, setTaskPoints] = useState(0);
  const [aiGrowth, setAiGrowth] = useState({ value: 0, color: 'gray' });
  const [taskGrowth, setTaskGrowth] = useState({ value: 0, color: 'gray' });
  const [error, setError] = useState(propError);

  const executeRecaptcha = async (action = 'fetch_points', retries = 2) => {
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 30000)),
      ]);
      console.log('reCAPTCHA token generated:', { action, token: token.substring(0, 8) + '...' });
      return token;
    } catch (error) {
      if (retries > 0 && (error.message.includes('timeout') || error.message.includes('network'))) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return executeRecaptcha(action, retries - 1);
      }
      throw new Error(`reCAPTCHA failed after ${2 - retries + 1} attempts: ${error.message}`);
    }
  };

  useEffect(() => {
    async function fetchData() {
      if (!session?.user?.id) return;

      try {
        const recaptchaToken = await executeRecaptcha('get_user');
        const userResponse = await axios.get(`/api/user?uid=${session.user.id}`, {
          headers: {
            'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
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
              'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
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
            color: aiGrowthValue > 0 ? 'green' : aiGrowthValue < 0 ? 'red' : 'gray',
          });

          const todayTaskPoints = userResponse.data.user.taskPoints || 0;
          const yesterdayTaskPoints = history.length > 1 ? history[history.length - 2]?.taskPoints || 0 : 0;
          const taskGrowthValue = ((todayTaskPoints - yesterdayTaskPoints) / (yesterdayTaskPoints || 1)) * 100;
          setTaskGrowth({
            value: taskGrowthValue.toFixed(2),
            color: taskGrowthValue > 0 ? 'green' : taskGrowthValue < 0 ? 'red' : 'gray',
          });
        } else {
          setError('Invalid user data.');
        }
      } catch (err) {
        console.error('Error fetching point data:', err.response?.data || err.message);
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
      className="font-jetbrains w-full h-[calc(100vh-4rem)] max-w-screen-md md:max-w-full mx-auto p-2 md:p-4 rounded-xl shadow-card overflow-y-auto custom-scrollbar"
    >
      <div className="w-full flex flex-col">
        <div className="rounded-xl border border-gray-400 shadow-card p-4 mb-4 backdrop-blur-md">
          <h2 className="text-base font-bold text-white mb-3">Point History</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pointHistory} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid stroke="#404040" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke="#FFFFFF"
                  tick={{ fontSize: 10, fill: '#FFFFFF' }}
                  angle={-45}
                  textAnchor="end"
                  height={50}
                />
                <YAxis stroke="#FFFFFF" tick={{ fontSize: 10, fill: '#FFFFFF' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1A1A1A', border: 'none', borderRadius: '0.5rem', padding: '0.5rem' }}
                  labelStyle={{ color: '#FFFFFF' }}
                  itemStyle={{ color: '#FFFFFF' }}
                  cursor={{ stroke: '#FFFFFF', strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="tweetPoints"
                  stroke="#00BFFF"
                  strokeWidth={1}
                  dot={false}
                  activeDot={{ fill: '#00BFFF', r: 3 }}
                  name="Tweet Points"
                />
                <Line
                  type="monotone"
                  dataKey="aiPoints"
                  stroke="#FFD700"
                  strokeWidth={1}
                  dot={false}
                  activeDot={{ fill: '#FFD700', r: 3 }}
                  name="AI Points"
                />
                <Line
                  type="monotone"
                  dataKey="taskPoints"
                  stroke="#00FF00"
                  strokeWidth={1}
                  dot={false}
                  activeDot={{ fill: '#00FF00', r: 3 }}
                  name="Task Points"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="flex-1 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 rounded-xl shadow-card p-3 flex flex-col justify-between bg-tech backdrop-blur-md border border-gray-400 min-h-[100px]">
            <h3 className="text-sm font-semibold text-white">Total Points</h3>
            <p className="text-4xl md:text-5xl font-bold text-center">{userData?.points || 0}</p>
            {error && <p className="text-red-500 text-xs mt-2">Error: {error}</p>}
            <button
              onClick={handleAnalyzeTweetsWithRecaptcha}
              className={`mt-2 px-3 py-1 rounded-lg text-xs font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${
                isAnalyzing || loading
                  ? 'bg-white/10 text-white/50 cursor-not-allowed opacity-50'
                  : 'bg-white/10 text-white hover:bg-white/15 hover:shadow-glow-neon'
              }`}
              disabled={isAnalyzing || loading}
            >
              {isAnalyzing ? 'Processing...' : 'Analyze Tweets'}
            </button>
          </div>
          <div className="flex-1 rounded-xl shadow-card p-3 backdrop-blur-md bg-tech border border-gray-400 flex flex-col items-center justify-center min-h-[100px]">
            <h3 className="text-sm font-semibold text-white mb-2">AI Points</h3>
            <div className="flex items-center justify-center gap-2 mt-10">
              <p className="text-4xl md:text-5xl font-bold mb-6">{aiPoints}</p>
              <p className={`text-xs font-semibold text-${aiGrowth.color}`}>
                {aiGrowth.value}% {aiGrowth.value > 0 ? '↑' : aiGrowth.value < 0 ? '↓' : '–'}
              </p>
            </div>
          </div>
          <div className="flex-1 rounded-xl shadow-card p-3 backdrop-blur-md bg-tech border border-gray-400 flex flex-col items-center justify-center min-h-[100px]">
            <h3 className="text-sm font-semibold text-white mb-2">Task Points</h3>
            <div className="flex items-center justify-center gap-2 mt-10">
              <p className="text-4xl md:text-5xl font-bold mb-6">{taskPoints}</p>
              <p className={`text-xs font-semibold text-${taskGrowth.color}`}>
                {taskGrowth.value}% {taskGrowth.value > 0 ? '↑' : taskGrowth.value < 0 ? '↓' : '–'}
              </p>
            </div>
          </div>
        </div>
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