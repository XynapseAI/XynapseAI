// pages/auth/signin.jsx
'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Head from 'next/head';
import { motion } from 'framer-motion';
import MatrixHoverEffect from '../../components/MatrixHoverEffect';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.xynapseai.net';

export default function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState(null);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError('Failed to sign in with Twitter. Please try again or contact support.');
      console.error('Sign-in error from query:', errorParam);
    }
  }, [searchParams]);

  const handleSignInTwitter = async () => {
    try {
      console.log('Initiating Twitter sign-in');
      await signIn('twitter', { callbackUrl: `${APP_URL}/dashboard/leaderboard` });
    } catch (error) {
      console.error('Twitter sign-in error:', error);
      setError(`Failed to sign in with Twitter: ${error.message || 'System error'}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className="h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-jetbrains relative"
    >
      <Head>
        <title>Sign In - Xynapse AI</title>
        <meta name="description" content="Sign in with Twitter to access the Xynapse AI dashboard" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800"
        animate={{
          background: [
            'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
            'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(0, 191, 255, 0.1))',
            'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
          ],
        }}
        transition={{ duration: 15, repeat: Infinity, repeatType: 'reverse' }}
      >
        <div className="absolute inset-0 stars-layer-1" />
        <div className="absolute inset-0 stars-layer-2" />
        <div className="absolute inset-0 stars-layer-3" />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 bg-gray-900/30 backdrop-blur-lg p-6 md:p-8 rounded-2xl border border-white/10 shadow-glow-neon max-w-md w-full mx-4"
      >
        <div className="text-center">
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-2xl md:text-3xl font-bold text-white uppercase mb-4"
          >
            Sign In to Xynapse AI
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-[10px] md:text-sm text-gray-400 mb-6"
          >
            Sign in with Twitter to access your profile and manage your account.
          </motion.p>
          <motion.button
            onClick={handleSignInTwitter}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="w-full px-6 py-3 bg-gray-900/50 border border-neon-blue text-neon-blue rounded-full text-[10px] md:text-sm font-medium uppercase shadow-glow-neon hover:bg-neon-blue/20 transition-all duration-300"
          >
            <MatrixHoverEffect text="Sign in with Twitter" hoverColor="#00BFFF" />
          </motion.button>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-4 text-red-400 text-[10px] md:text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center shadow-glow-neon-red"
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
        className="absolute bottom-2 left-2 text-[9px] md:text-[10px] text-gray-600 z-10"
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
      <style jsx>{`
        .shadow-glow-neon {
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.3), 0 0 16px rgba(255, 255, 255, 0.1);
        }
        .shadow-glow-neon-red {
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.3), 0 0 16px rgba(239, 68, 68, 0.1);
        }
        .stars-layer-1,
        .stars-layer-2,
        .stars-layer-3 {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: transparent;
          pointer-events: none;
        }
        .stars-layer-1 {
          background: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 800' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='200' cy='100' r='2' fill='rgba(255,255,255,0.4)'/%3E%3Ccircle cx='300' cy='600' r='1' fill='rgba(255,255,255,0.3)'/%3E%3Ccircle cx='500' cy='300' r='1.5' fill='rgba(255,255,255,0.5)'/%3E%3Ccircle cx='800' cy='500' r='2' fill='rgba(255,255,255,0.4)'/%3E%3Ccircle cx='1000' cy='200' r='1' fill='rgba(255,255,255,0.3)'/%3E%3C/svg%3E");
          animation: moveStars 100s linear infinite;
        }
        .stars-layer-2 {
          background: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 800' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='150' cy='400' r='1.5' fill='rgba(255,255,255,0.5)'/%3E%3Ccircle cx='400' cy='200' r='2' fill='rgba(255,255,255,0.4)'/%3E%3Ccircle cx='600' cy='700' r='1' fill='rgba(255,255,255,0.3)'/%3E%3Ccircle cx='900' cy='300' r='1.5' fill='rgba(255,255,255,0.5)'/%3E%3C/svg%3E");
          animation: moveStars 150s linear infinite;
        }
        .stars-layer-3 {
          background: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 800' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='250' cy='500' r='1' fill='rgba(255,255,255,0.3)'/%3E%3Ccircle cx='450' cy='100' r='1.5' fill='rgba(255,255,255,0.5)'/%3E%3Ccircle cx='700' cy='400' r='2' fill='rgba(255,255,255,0.4)'/%3E%3Ccircle cx='1100' cy='600' r='1' fill='rgba(255,255,255,0.3)'/%3E%3C/svg%3E");
          animation: moveStars 200s linear infinite;
        }
        @keyframes moveStars {
          0% { transform: translateY(0); }
          100% { transform: translateY(-1000px); }
        }
        @media (max-width: 640px) {
          .text-3xl { font-size: 1.5rem; }
          .text-2xl { font-size: 1.25rem; }
        }
      `}</style>
    </motion.div>
  );
}