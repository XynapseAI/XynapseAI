'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { Power } from 'lucide-react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import MatrixHoverEffect from './MatrixHoverEffect';

export default function Header({ activeTab, setActiveTab, handleSignOut }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const router = useRouter();

  const tabs = [
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'point', label: 'Points' },
    { id: 'ai', label: 'AI' },
    { id: 'task', label: 'Tasks' },
    { id: 'profile', label: 'Profile' },
    { id: 'market', label: 'Market' },
    { id: 'treemap', label: 'Treemap' },
  ];

  // Handle clicks outside the mobile menu to close it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle tab navigation
  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    router.push(`/dashboard/${tabId}`);
    setIsMenuOpen(false);
  };

  // Animation variants for mobile menu toggle
  const lineVariants = {
    closed: { rotate: 0, y: 0, opacity: 1, transition: { duration: 0.3 } },
    openTop: { rotate: 45, y: 8, transition: { duration: 0.3 } },
    openBottom: { rotate: -45, y: -8, transition: { duration: 0.3 } },
    hidden: { opacity: 0, transition: { duration: 0.3 } },
  };

  // Animation variants for mobile menu
  const menuVariants = {
    closed: { x: '-100%', opacity: 0, transition: { duration: 0.3, ease: 'easeInOut' } },
    open: { x: 0, opacity: 1, transition: { duration: 0.3, ease: 'easeInOut' } },
  };

  return (
    <header className="h-[5vh] sm:h-[6vh] bg-galaxy border-b rounded-b-xl p-3 flex justify-between items-center sticky top-[-10px] z-20 font-jetbrains">
      {/* Logo */}
      <Link href="/">
        <img src="/logos/logo-landscape.png" alt="Xynapse Logo" className="h-8 sm:h-10" />
      </Link>

      {/* Mobile Menu Toggle */}
      <div className="block sm:hidden">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="w-6 h-6 flex flex-col justify-center items-center"
          aria-label="Toggle menu"
        >
          <motion.span
            className="w-6 h-0.5 bg-white mb-1 sm:mb-1.5"
            variants={lineVariants}
            animate={isMenuOpen ? 'openTop' : 'closed'}
          />
          <motion.span
            className="w-6 h-0.5 bg-white mb-1 sm:mb-1.5"
            variants={lineVariants}
            animate={isMenuOpen ? 'hidden' : 'closed'}
          />
          <motion.span
            className="w-6 h-0.5 bg-white"
            variants={lineVariants}
            animate={isMenuOpen ? 'openBottom' : 'closed'}
          />
        </button>
      </div>

      {/* Desktop Navigation */}
      <nav className="hidden sm:flex items-center space-x-2">
        {tabs.map((tab, index) => (
          <div key={tab.id} className="flex items-center">
            <motion.button
              onClick={() => handleTabClick(tab.id)}
              className={`group px-3 py-1.5 text-xs font-medium transition-all duration-300 text-white backdrop-blur-md perspective-1000 ${
                activeTab === tab.id ? 'bg-gray-400 text-black' : 'hover:bg-white/10'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <MatrixHoverEffect text={tab.label} hoverColor="#00BFFF" />
            </motion.button>
            {index < tabs.length - 1 && (
              <span className="h-6 w-px bg-white/30 mx-2"></span>
            )}
          </div>
        ))}
      </nav>

      {/* Desktop Sign-Out Button */}
      <motion.button
        onClick={handleSignOut}
        className="hidden sm:flex fixed bottom-4 right-4 sm:static w-8 h-8 rounded-full text-red-500 flex items-center justify-center backdrop-blur-md z-50 mr-4"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.9 }}
        aria-label="Sign out"
      >
        <Power size={20} />
      </motion.button>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            ref={menuRef}
            className="fixed top-0 left-0 w-full max-w-xs h-2/3 bg-black/80 backdrop-blur-lg z-30 flex flex-col p-4 sm:hidden rounded-xl"
            initial="closed"
            animate="open"
            exit="closed"
            variants={menuVariants}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-white">MENU</h2>
              <button
                onClick={() => setIsMenuOpen(false)}
                className="text-white text-xl"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <nav className="flex flex-col space-y-2 flex-grow overflow-y-auto">
              {tabs.map((tab, index) => (
                <div key={tab.id} className="flex flex-col">
                  <motion.button
                    onClick={() => handleTabClick(tab.id)}
                    className={`group w-2/3 text-left px-2 py-1 md:py-2 text-[10px] md:text-xs font-medium transition-all duration-300 bg-white/10 text-white backdrop-blur-md hover:bg-white/15 hover:shadow-glow-neon perspective-1000 ${
                      activeTab === tab.id ? 'bg-white text-black' : ''
                    }`}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <MatrixHoverEffect text={tab.label} hoverColor="#00BFFF" />
                  </motion.button>
                  {index < tabs.length - 1 && (
                    <span className="w-full h-px bg-white/30 my-2"></span>
                  )}
                </div>
              ))}
            </nav>
            <motion.button
              onClick={handleSignOut}
              className="self-end mt-4 w-8 h-8 rounded-full text-red-500 flex items-center justify-center backdrop-blur-md"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.9 }}
              aria-label="Sign out"
            >
              <Power size={20} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Menu Backdrop */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-20 sm:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setIsMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      <style jsx>{`
        .shadow-glow-neon {
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.3), 0 0 16px rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </header>
  );
}