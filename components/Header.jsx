// components/Header.jsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { Power } from 'lucide-react';

export default function Header({ activeTab, setActiveTab, handleSignOut }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const tabs = [
    { id: 'market', label: 'Market' },
    { id: 'ai', label: 'AI' },
    { id: 'profile', label: 'Profile' },
    { id: 'treemap', label: 'Treemap' },
    { id: 'watchlists', label: 'Watchlists' },
  ];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    setIsMenuOpen(false);
  };

  const handleMouseEnter = (e) => {
    const container = e.currentTarget.querySelector('.matrix-text');
    if (container) {
      container.classList.add('active');
      const spans = container.querySelectorAll('span');
      const positions = Array.from(spans).map((span) => span.offsetLeft);
      const charCount = spans.length;

      const shuffledIndices1 = Array.from({ length: charCount }, (_, i) => i);
      const shuffledIndices2 = Array.from({ length: charCount }, (_, i) => i);
      const shuffledIndices3 = Array.from({ length: charCount }, (_, i) => i);
      for (let i = charCount - 1; i > 0; i--) {
        const j1 = Math.floor(Math.random() * (i + 1));
        const j2 = Math.floor(Math.random() * (i + 1));
        const j3 = Math.floor(Math.random() * (i + 1));
        [shuffledIndices1[i], shuffledIndices1[j1]] = [shuffledIndices1[j1], shuffledIndices1[i]];
        [shuffledIndices2[i], shuffledIndices2[j2]] = [shuffledIndices2[j2], shuffledIndices2[i]];
        [shuffledIndices3[i], shuffledIndices3[j3]] = [shuffledIndices3[j3], shuffledIndices3[i]];
      }

      spans.forEach((span, index) => {
        if (span.textContent !== '\u00A0') {
          const targetIndex1 = shuffledIndices1[index];
          const targetIndex2 = shuffledIndices2[index];
          const targetIndex3 = shuffledIndices3[index];
          const offset1 = positions[targetIndex1] - positions[index];
          const offset2 = positions[targetIndex2] - positions[index];
          const offset3 = positions[targetIndex3] - positions[index];

          span.style.setProperty('--shuffle-offset-1', `${offset1}px`);
          span.style.setProperty('--shuffle-offset-2', `${offset2}px`);
          span.style.setProperty('--shuffle-offset-3', `${offset3}px`);

          span.classList.add(
            'animate-matrix-flip',
            'animate-flicker',
            'animate-shuffle-position',
            `animation-delay-${(index % 13) + 1}`
          );
        }
      });

      setTimeout(() => {
        container.classList.remove('active');
        spans.forEach((span) => {
          span.classList.remove(
            'animate-matrix-flip',
            'animate-flicker',
            'animate-shuffle-position',
            ...Array.from(span.classList).filter((c) => c.startsWith('animation-delay-'))
          );
          span.style.removeProperty('--shuffle-offset-1');
          span.style.removeProperty('--shuffle-offset-2');
          span.style.removeProperty('--shuffle-offset-3');
        });
      }, 400);
    }
  };

  const lineVariants = {
    closed: { rotate: 0, y: 0, opacity: 1, transition: { duration: 0.3 } },
    openTop: { rotate: 45, y: 8, transition: { duration: 0.3 } },
    openBottom: { rotate: -45, y: -8, transition: { duration: 0.3 } },
    hidden: { opacity: 0, transition: { duration: 0.3 } },
  };

  const menuVariants = {
    closed: { x: '-100%', opacity: 0, transition: { duration: 0.3, ease: 'easeInOut' } },
    open: { x: 0, opacity: 1, transition: { duration: 0.3, ease: 'easeInOut' } },
  };

  const renderMatrixText = (text) => {
    return text.split('').map((char, index) => (
      <span
        key={index}
        className={`inline-block transform-style-3d transition-transform-opacity duration-300 ease-in-out underline underline-offset-2 ${char === ' ' ? '' : `animation-delay-${(index % 13) + 1}`
          }`}
      >
        {char === ' ' ? '\u00A0' : char}
      </span>
    ));
  };

  return (
    <header className="h-[4vh] sm:h-[5vh] bg-galaxy border-b rounded-b-xl p-3 flex justify-between items-center sticky top-[-10px] z-20 font-saira">
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

      <div className="hidden sm:flex items-center space-x-2">
        {tabs.map((tab, index) => (
          <div key={tab.id} className="flex items-center">
            <motion.button
              onClick={() => setActiveTab(tab.id)}
              onMouseEnter={handleMouseEnter}
              className={`group px-3 py-1.5 text-[10px] md:text-[10px] font-medium transition-all duration-300 text-white backdrop-blur-md perspective-1000 uppercase ${
                activeTab === tab.id ? 'bg-gradient-to-r from-neon-blue/30 to-transparent text-black' : ''
              }`}
            >
              <span className="matrix-text inline-block underline underline-offset-2">
                {renderMatrixText(tab.label)}
              </span>
            </motion.button>
            {index < tabs.length - 1 && (
              <span className="h-6 w-px bg-white/30 mx-1"></span>
            )}
          </div>
        ))}
      </div>

      <motion.button
        onClick={handleSignOut}
        className="hidden sm:flex fixed bottom-4 right-4 sm:static w-8 h-8 rounded-full text-red flex items-center justify-center backdrop-blur-md z-50 mr-4"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.9 }}
        aria-label="Sign out"
      >
        <Power size={20} />
      </motion.button>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            ref={menuRef}
            className="fixed top-0 left-0 w-full max-w-xs h-full bg-galaxy backdrop-blur-lg z-30 flex flex-col p-4 sm:hidden rounded-r-xl"
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
                    onMouseEnter={handleMouseEnter}
                    className={`group w-1/3 text-left px-2 py-1 md:py-2 text-[10px] md:text-xs font-medium transition-all duration-300 bg-galaxy/90 text-white backdrop-blur-md uppercase ${
                      activeTab === tab.id ? 'bg-gradient-to-r from-neon-blue/30 to-transparent text-black' : ''
                    }`}
                    whileHover={{ scale: 1 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <span className="matrix-text">
                      {renderMatrixText(tab.label)}
                    </span>
                  </motion.button>
                  {index < tabs.length - 1 && (
                    <span className="w-full h-px bg-white/30 my-2"></span>
                  )}
                </div>
              ))}
            </nav>
            <motion.button
              onClick={handleSignOut}
              className="self-end mt-4 w-8 h-8 rounded-full text-red flex items-center justify-center backdrop-blur-md"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.9 }}
              aria-label="Sign out"
            >
              <Power size={20} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

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
    </header>
  );
}