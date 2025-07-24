'use client';

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
      if (!session?.user?.id) return;
      try {
        const response = await axios.get('/api/tasks', {
          headers: {
            'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
          },
          withCredentials: true,
        });
        if (response.data.success) {
          setTasks(response.data.tasks);
        } else {
          throw new Error(response.data.detail || 'Failed to fetch tasks.');
        }
      } catch (err) {
        console.error('Error fetching tasks:', err.response?.data || err.message);
        setError(`Failed to load tasks: ${err.response?.data?.detail || err.message}`);
      }
    }
    fetchTasks();
  }, [session]);

  useEffect(() => {
    async function fetchTaskProgress() {
      if (!session?.user?.id) return;
      try {
        const token = await executeRecaptcha('task_progress');
        const response = await axios.get(`/api/task-progress?uid=${session.user.id}`, {
          headers: {
            'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
            'X-Recaptcha-Token': token,
          },
          withCredentials: true,
        });
        const progress = response.data.progress.reduce((acc, completion) => {
          const completionDate = new Date(completion.completedAt);
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);
          if (completionDate >= today) {
            acc[completion.taskId] = completion.completionCount;
          }
          return acc;
        }, {});
        setTaskProgress(progress);
      } catch (err) {
        console.error('Error fetching task progress:', err.response?.data || err.message);
        setError(`Failed to load task progress: ${err.response?.data?.detail || err.message}`);
      }
    }
    fetchTaskProgress();
  }, [session]);

  const executeRecaptcha = async (action) => {
    if (!recaptchaRef.current) {
      throw new Error('reCAPTCHA not initialized');
    }
    try {
      const token = await recaptchaRef.current.executeAsync({ action });
      console.log('reCAPTCHA token generated:', { action, token: token.substring(0, 8) + '...' });
      return token;
    } catch (error) {
      console.error('reCAPTCHA execution error:', error);
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
      const token = await executeRecaptcha('verify_task');
      const response = await axios.post(
        '/api/verify-task',
        {
          taskId: task.id,
          userId: session.user.id,
          recaptchaToken: token,
        },
        {
          headers: {
            'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
          },
          withCredentials: true,
        }
      );
      if (response.data.success) {
        setTaskProgress((prev) => ({
          ...prev,
          [task.id]: response.data.completionCount || prev[task.id] || 0,
        }));
        alert(`Task ${task.id} verified! +${task.points} points`);
      } else {
        setError(response.data.detail || 'Failed to verify task');
      }
    } catch (err) {
      console.error('Error verifying task:', err.response?.data || err.message);
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
      className="font-jetbrains w-full max-w-screen-md md:max-w-full h-[calc(100vh-4rem)] mx-auto p-2 md:p-4 rounded-xl shadow-card overflow-y-auto custom-scrollbar"
    >
      <div className="w-full rounded-xl shadow-card p-3 md:p-6 backdrop-blur-md border border-gray-400">
        <h2 className="text-base md:text-lg font-bold text-white uppercase mb-3 md:mb-4">Tasks</h2>
        {error && <p className="text-red-500 text-xs md:text-sm mb-3 md:mb-4">Error: {error}</p>}
        {!tasks.length && !error && (
          <p className="text-xs md:text-sm text-gray-600 text-center">No tasks available.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="p-3 md:p-4 bg-gray-800/50 rounded-lg border border-white/10 backdrop-blur-md flex flex-col"
            >
              <div className="flex-1">
                <h3 className="text-xs md:text-sm font-semibold text-white mb-2">
                  Task {task.id} {task.isDaily ? `(Daily ${taskProgress[task.id] || 0}/${task.maxCompletions})` : ''}
                </h3>
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