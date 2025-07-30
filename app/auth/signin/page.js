// app/auth/signin/page.js
'use client';

import { useEffect, useState } from 'react';
import { signIn, getProviders } from 'next-auth/react';
import { motion } from 'framer-motion';
import styles from '../../dashboard/page.module.css'; // Reuse dashboard styles

export default function SignIn() {
  const [providers, setProviders] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchProviders() {
      const response = await getProviders();
      setProviders(response);
    }
    fetchProviders();
  }, []);

  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    try {
      await signIn('email', { email, callbackUrl: '/dashboard' });
    } catch{
      setError('Failed to sign in with email. Please try again.');
    }
  };

  if (!providers) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className={`h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-jetbrains relative ${styles['container']}`}
    >
      <motion.div
        className={`absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800 ${styles['stars-background']}`}
        animate={{
          background: [
            'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
            'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(0, 191, 255, 0.1))',
            'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
          ],
        }}
        transition={{ duration: 15, repeat: Infinity, repeatType: 'reverse' }}
      >
        <div className={styles['stars-layer-1']} />
        <div className={styles['stars-layer-2']} />
        <div className={styles['stars-layer-3']} />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={`relative z-10 bg-gray-900/30 backdrop-blur-lg p-6 md:p-8 rounded-2xl border border-white/10 ${styles['shadow-glow-neon']} max-w-md w-full mx-4`}
      >
        <div className="text-center">
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-2xl md:text-3xl font-bold text-white uppercase mb-4"
          >
            Sign In
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-[14px] md:text-sm text-gray-400 mb-6"
          >
            Sign in with Google or Email to access your dashboard.
          </motion.p>
          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="signin-input"
              required
            />
            <button type="submit" className="signin-button">
              Sign in with Email
            </button>
          </form>
          {providers.google && (
            <button
              onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
              className="signin-provider-button mt-4"
            >
              Sign in with Google
            </button>
          )}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className={`mt-4 text-red-400 text-[14px] md:text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center ${styles['shadow-glow-neon-red']}`}
            >
              Error: {error}
            </motion.div>
          )}
        </div>
      </motion.div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className="absolute bottom-2 left-2 text-[14px] text-gray-600 z-10"
      >
        Protected by reCAPTCHA. See{' '}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-blue hover:underline"
        >
          Privacy Policy
        </a>{' '}
        &{' '}
        <a
          href="https://policies.google.com/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-blue hover:underline"
        >
          Terms
        </a>{' '}
        of Google.
      </motion.p>
    </motion.div>
  );
}