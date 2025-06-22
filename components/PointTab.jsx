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
  const [recaptchaToken, setRecaptchaToken] = useState(null);
  const [tokenTimestamp, setTokenTimestamp] = useState(null);

  const executeRecaptcha = async (action = 'fetch_points', retries = 3) => {
    const now = Date.now();
    if (recaptchaToken && tokenTimestamp && now - tokenTimestamp < 120000 && retries === 3) {
      console.log('Tái sử dụng token reCAPTCHA:', { action, token: recaptchaToken.substring(0, 8) + '...' });
      return recaptchaToken;
    }
    if (!recaptchaRef.current) {
      throw new Error('reCAPTCHA chưa được khởi tạo.');
    }
    try {
      const token = await Promise.race([
        recaptchaRef.current.executeAsync(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 15000)),
      ]);
      console.log('Tạo token reCAPTCHA:', { action, token: token.substring(0, 8) + '...' });
      setRecaptchaToken(token);
      setTokenTimestamp(now);
      return token;
    } catch (error) {
      console.error('Lỗi thực thi reCAPTCHA:', error);
      if (retries > 0 && error.message.includes('timeout')) {
        console.log(`Retrying reCAPTCHA (${retries} attempts left)`);
        return executeRecaptcha(action, retries - 1);
      }
      throw new Error('Không thể thực thi reCAPTCHA.');
    } finally {
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
    }
  };

  useEffect(() => {
    async function fetchData() {
      try {
        if (session?.user?.id) {
          let recaptchaToken;
          try {
            recaptchaToken = await executeRecaptcha('get_user');
          } catch (recaptchaError) {
            setError('Không thể xác minh reCAPTCHA. Vui lòng thử lại.');
            return;
          }
          const response = await axios.get(`/api/user?uid=${session.user.id}`, {
            headers: { 'X-Recaptcha-Token': recaptchaToken },
            withCredentials: true,
          });
          if (response.data.success) {
            setAiPoints(response.data.user.aiPoints || 0);
            setTaskPoints(response.data.user.taskPoints || 0);
            let historyRecaptchaToken;
            try {
              historyRecaptchaToken = await executeRecaptcha('get_point_history');
            } catch (recaptchaError) {
              setError('Không thể xác minh reCAPTCHA cho lịch sử điểm. Vui lòng thử lại.');
              return;
            }
            const historyResponse = await axios.get(`/api/point-history?uid=${session.user.id}`, {
              headers: { 'X-Recaptcha-Token': historyRecaptchaToken },
              withCredentials: true,
            });
            const history = historyResponse.data.history || [];
            setPointHistory(history.map(item => ({
              ...item,
              tweetPoints: 0,
              aiPoints: item.aiPoints || 0,
              taskPoints: 0,
            })));

            const todayAiPoints = response.data.user.aiPoints || 0;
            const yesterdayAiPoints = history.length > 1 ? history[history.length - 2]?.aiPoints || 0 : 0;
            const aiGrowthValue = ((todayAiPoints - yesterdayAiPoints) / (yesterdayAiPoints || 1)) * 100;
            setAiGrowth({
              value: aiGrowthValue.toFixed(2),
              color: aiGrowthValue > 0 ? 'green' : aiGrowthValue < 0 ? 'red' : 'gray',
            });

            const todayTaskPoints = response.data.user.taskPoints || 0;
            const yesterdayTaskPoints = history.length > 1 ? history[history.length - 2]?.taskPoints || 0 : 0;
            const taskGrowthValue = ((todayTaskPoints - yesterdayTaskPoints) / (yesterdayTaskPoints || 1)) * 100;
            setTaskGrowth({
              value: taskGrowthValue.toFixed(2),
              color: taskGrowthValue > 0 ? 'green' : taskGrowthValue < 0 ? 'red' : 'gray',
            });
          }
        }
      } catch (err) {
        console.error('Error fetching point data:', {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });
        setError(
          err.response?.status === 429
            ? 'Vượt quá giới hạn API. Vui lòng thử lại sau.'
            : err.response?.status === 403
            ? 'Xác minh reCAPTCHA thất bại hoặc truy cập bị từ chối. Vui lòng thử lại.'
            : err.response?.status === 500 && err.response?.data?.detail?.includes('index missing')
            ? 'Lỗi hệ thống: Thiếu index Firestore. Vui lòng liên hệ hỗ trợ.'
            : 'Không thể tải dữ liệu điểm.'
        );
      }
    }
    fetchData();
  }, [session]);

  const handleAnalyzeTweetsWithRecaptcha = async () => {
    try {
      const token = await executeRecaptcha();
      await handleAnalyzeTweets({ recaptchaToken: token });
      setError(null);
    } catch (err) {
      console.error('Tweet analysis error:', err);
      setError(
        err.message.includes('reCAPTCHA')
          ? 'reCAPTCHA verification failed. Please try again.'
          : 'Failed to analyze tweets. Please try again.'
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="font-plexmono w-[100%] min-h-[calc(100vh-4rem)] max-w-10xl mx-auto p-2 sm:p-6 rounded-xl shadow-card overflow-y-auto custom-scrollbar mt-14 sm:mt-0 backdrop-blur-md flex flex-col"
    >
      <div className="w-full mx-auto h-full flex flex-col">
        {/* Chart */}
        <div className="rounded-xl border border-gray-400 shadow-card p-4 mb-6 backdrop-blur-md">
          <h2 className="text-lg font-bold text-white mb-4">Point History</h2>
          <div className="h-64 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pointHistory} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid stroke="#404040" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke="#FFFFFF"
                  tick={{ fontSize: 12, fill: '#FFFFFF' }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis stroke="#FFFFFF" tick={{ fontSize: 12, fill: '#FFFFFF' }} />
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
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ fill: '#00BFFF', r: 4 }}
                  name="Tweet Points"
                />
                <Line
                  type="monotone"
                  dataKey="aiPoints"
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ fill: '#FFFFFF', r: 4 }}
                  name="AI Points"
                />
                <Line
                  type="monotone"
                  dataKey="taskPoints"
                  stroke="#00FF00"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ fill: '#00FF00', r: 4 }}
                  name="Task Points"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Metrics */}
        <div className="flex-1 flex flex-col sm:flex-row space-y-6 sm:space-y-0 sm:space-x-6">
          {/* Total Points */}
          <div className="flex-1 rounded-xl shadow-card p-6 flex flex-col justify-between bg-tech backdrop-blur-md border border-gray-400">
            <h3 className="text-base font-semibold text-white">Total Points</h3>
            <p className="text-4xl font-bold text text-center">{userData?.points || 0}</p>
            {error && <p className="text-red-500 text-xs mt-2">Error: {error}</p>}
            <button
              onClick={handleAnalyzeTweetsWithRecaptcha}
              className={`mt-4 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${
                isAnalyzing || loading
                  ? 'bg-white/10 text-white/50 cursor-not-allowed opacity-50'
                  : 'bg-white/10 text-white hover:bg-white/15 hover:shadow-glow-neon'
              }`}
              disabled={isAnalyzing || loading}
            >
              {isAnalyzing ? 'Processing...' : 'Analyze Tweets'}
            </button>
          </div>

          {/* AI Points */}
          <div className="flex-1 rounded-xl shadow-card p-6 backdrop-blur-md bg-tech border border-gray-400 flex flex-col justify-between">
            <h3 className="text-base font-semibold text-white mb-4">AI Points</h3>
            <div className="flex text-center justify-center items-center mb-6">
              <p className="text-5xl font-bold text text-center">{aiPoints}</p>
              <p className={`text-xs font-semibold text-${aiGrowth.color} mt-4 ml-2`}>
                {aiGrowth.value}% {aiGrowth.value > 0 ? '↑' : aiGrowth.value < 0 ? '↓' : '–'}
              </p>
            </div>
          </div>

          {/* Task Points */}
          <div className="flex-1 rounded-xl shadow-card p-6 bg-tech backdrop-blur-md border border-gray-400 flex flex-col justify-between">
            <h3 className="text-base font-semibold text-white mb-4">Task Points</h3>
            <div className="flex text-center justify-center items-center mb-6">
              <p className="text-5xl font-bold text text-center">{taskPoints}</p>
              <p className={`text-xs font-semibold text-${taskGrowth.color} mt-4 ml-2`}>
                {taskGrowth.value}% {taskGrowth.value > 0 ? '↑' : taskGrowth.value < 0 ? '↓' : '–'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}