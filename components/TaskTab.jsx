import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';

export default function TaskTab({ recaptchaRef }) {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState([]);
  const [isVerifying, setIsVerifying] = useState({});
  const [error, setError] = useState(null);
  const [taskProgress, setTaskProgress] = useState({});

  useEffect(() => {
    async function fetchTasks() {
      try {
        const response = await axios.get('/api/tasks');
        if (response.data.success) {
          const tasksWithDefault = response.data.tasks.map(task => ({
            ...task,
            description: task.description || 'No description available',
          }));
          setTasks(tasksWithDefault);
        } else {
          throw new Error('Failed to fetch tasks.');
        }
      } catch (err) {
        setError('Failed to load tasks.');
      }
    }
    fetchTasks();
  }, []);

  useEffect(() => {
    async function fetchTaskProgress() {
      if (session?.user?.id) {
        try {
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);
          const response = await axios.get(`/api/task-progress?uid=${session.user.id}`, {
            withCredentials: true,
          });
          const progress = response.data.progress.reduce((acc, completion) => {
            const completionDate = new Date(completion.completedAt);
            if (completionDate >= today) {
              acc[completion.taskId] = completion.completionCount;
            }
            return acc;
          }, {});
          setTaskProgress(progress);
        } catch (err) {
          setError('Failed to load task progress.');
        }
      }
    }
    fetchTaskProgress();
  }, [session]);

  const executeRecaptcha = async () => {
    if (!recaptchaRef.current) {
      throw new Error('reCAPTCHA not initialized');
    }
    try {
      const token = await recaptchaRef.current.executeAsync({ action: 'verify_task' });
      return token;
    } catch (error) {
      throw new Error('Failed to execute reCAPTCHA');
    } finally {
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
    }
  };

  const handleVerifyTask = async (task) => {
    if (!session?.user?.id) {
      setError('Please sign in');
      return;
    }
    setIsVerifying((prev) => ({ ...prev, [task.id]: true }));
    setError(null);
    try {
      const token = await executeRecaptcha();
      const response = await axios.post('/api/verify-task', {
        taskId: task.id,
        userId: session.user.id,
        taskType: task.type,
        link: task.link,
        recaptchaToken: token,
      });
      if (response.data.success) {
        setTaskProgress((prev) => ({
          ...prev,
          [task.id]: response.data.completionCount || prev[task.id] || 0,
        }));
        alert(`Task "${task.description}" verified! +${task.points} points`);
      } else {
        setError(response.data.message || 'Failed to verify task');
      }
    } catch (err) {
      setError(
        err.response?.status === 429
          ? 'API rate limit exceeded. Please try again later.'
          : err.message.includes('reCAPTCHA')
          ? 'reCAPTCHA verification failed. Please try again.'
          : err.response?.data?.detail || 'Verification failed'
      );
    } finally {
      setIsVerifying((prev) => ({ ...prev, [task.id]: false }));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="font-courier w-full max-w-screen-md md:max-w-full h-[calc(100vh-4rem)] mx-auto p-2 md:p-4 rounded-xl shadow-card overflow-y-auto custom-scrollbar"
    >
      <div className="w-full rounded-xl shadow-card p-3 md:p-6 backdrop-blur-md border border-gray-400">
        <h2 className="text-base md:text-lg font-bold text-white uppercase mb-3 md:mb-4">Tasks</h2>
        {error && <p className="text-red-500 text-xs md:text-sm mb-3 md:mb-4">Error: {error}</p>}
        {!tasks.length && !error && (
          <p className="text-xs md:text-sm text-gray-600 text-center">Loading tasks...</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="p-3 md:p-4 bg-gray-800/50 rounded-lg border border-white/10 backdrop-blur-md flex flex-col"
            >
              <div className="flex-1">
                <h3 className="text-xs md:text-sm font-semibold text-white mb-2">
                  {task.isDaily && typeof task.description === 'string'
                    ? task.description.replace(
                        /\(\d+\/\d+\)/,
                        `(${taskProgress[task.id] || 0}/${task.maxCompletions})`
                      )
                    : task.description}
                </h3>
                {task.link && (
                  <a
                    href={task.link.startsWith('http') ? task.link : `https://x.com/${task.link.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs md:text-sm text-neon-blue hover:underline"
                  >
                    {task.link}
                  </a>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs md:text-xs text-green">+{task.points} Points</span>
                <button
                  onClick={() => handleVerifyTask(task)}
                  disabled={isVerifying[task.id] || (task.isDaily && (taskProgress[task.id] || 0) >= task.maxCompletions)}
                  className={`px-2 py-1 md:px-3 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${
                    isVerifying[task.id] || (task.isDaily && (taskProgress[task.id] || 0) >= task.maxCompletions)
                      ? 'bg-white/10 text-white/50 cursor-not-allowed opacity-50'
                      : 'bg-white/10 text-white hover:bg-white/15 hover:shadow-glow-neon'
                  }`}
                >
                  {isVerifying[task.id] ? 'Verifying...' : 'Verify'}
                </button>
              </div>
            </div>
          ))}
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