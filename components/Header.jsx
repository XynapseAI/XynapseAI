// components/Header.jsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Power, Search } from 'lucide-react';
import { useCurrency } from './CurrencyContext';
import { logger } from '../utils/serverLogger';
import '../styles/globals.css'

export default function Header({ activeTab, setActiveTab, handleSignOut, selectedAddress }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const router = useRouter();
  let currency = 'usd';
  let setCurrency = () => console.warn('setCurrency not available');
  let availableCurrencies = ['usd', 'eur', 'btc'];
  try {
    const context = useCurrency();
    if (context) {
      ({ currency, setCurrency, availableCurrencies } = context);
    } else {
      console.error('CurrencyContext is not available. Using fallback values.');
    }
  } catch (err) {
    console.error('Error accessing CurrencyContext:', err);
  }

  const tabs = [
    { id: 'market', label: 'Market' },
    { id: 'cluster', label: 'Cluster' },
    { id: 'treemap', label: 'Treemap' },
    { id: 'watchlists', label: 'Watchlists' },
    { id: 'profile', label: 'Profile' },
    { id: 'ai', label: 'AI' },
  ];

  // Handle click outside to close menu or search dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle exchange search
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearchDropdownOpen(false);
      return;
    }
    try {
      const response = await fetch(`/api/coingecko?action=exchange-search&query=${encodeURIComponent(searchQuery)}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Failed to search exchanges');
      setSearchResults(result.data || []);
      setIsSearchDropdownOpen(true);
      logger.log('Exchange search results:', { query: searchQuery, results: result.data });
    } catch (err) {
      logger.error('Error searching exchanges:', { query: searchQuery, error: err.message });
      setSearchResults([]);
      setIsSearchDropdownOpen(false);
    }
  };

  // Handle exchange selection
  const handleExchangeSelect = (exchange) => {
    router.push(`/cluster?exchangeId=${exchange.id}`, { scroll: false });
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchDropdownOpen(false);
  };

  // Handle tab navigation
  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    const query = tabId === 'watchlists' && selectedAddress
      ? `tab=${tabId}&address=${encodeURIComponent(selectedAddress)}`
      : `tab=${tabId}`;
    router.push(`/dashboard?${query}`, { scroll: false });
    setIsMenuOpen(false);
  };

  // Matrix text animation
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
    openTop: { rotate: 45, y: 6, transition: { duration: 0.3 } },
    openBottom: { rotate: -45, y: -6, transition: { duration: 0.3 } },
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
        className={`inline-block transform-style-3d transition-transform-opacity duration-300 ease-in-out ${char === ' ' ? '' : `animation-delay-${(index % 13) + 1}`}`}
      >
        {char === ' ' ? '\u00A0' : char}
      </span>
    ));
  };

  return (
    <header className="h-[4vh] sm:h-[5vh] bg-white/5 backdrop-blur-xs border-b border-white/10 rounded-b-xl flex justify-between items-center sticky top-0 z-20 font-saira">
      {/* Mobile Menu Toggle */}
      <div className="block sm:hidden">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="w-5 h-5 flex flex-col justify-center items-center ml-4"
          aria-label="Toggle menu"
        >
          <motion.span
            className="w-5 h-0.5 bg-white mb-1"
            variants={lineVariants}
            animate={isMenuOpen ? 'openTop' : 'closed'}
          />
          <motion.span
            className="w-5 h-0.5 bg-white mb-1"
            variants={lineVariants}
            animate={isMenuOpen ? 'hidden' : 'closed'}
          />
          <motion.span
            className="w-5 h-0.5 bg-white"
            variants={lineVariants}
            animate={isMenuOpen ? 'openBottom' : 'closed'}
          />
        </button>
      </div>

      {/* Desktop Tabs */}
      <div className="hidden sm:flex justify-center items-end flex-grow h-full">
        {tabs.map((tab, index) => (
          <div key={tab.id} className="flex items-end">
            <motion.button
              onClick={() => handleTabClick(tab.id)}
              onMouseEnter={handleMouseEnter}
              className={`group w-[100px] px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium uppercase no-hover-effect ${activeTab === tab.id ? 'text-white border-b-2 border-white' : 'text-white/80 hover:text-white'}`}
            >
              <span className="matrix-text">{renderMatrixText(tab.label)}</span>
            </motion.button>
          </div>
        ))}
      </div>

      {/* Desktop Right Section: Currency Selector, Sign Out */}
      <div className="flex items-center gap-2 sm:gap-3 p-2 mr-2">
        <select
          id="currency-select"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="hidden sm:block text-white px-1.5 py-1 text-[8px] sm:text-[9px] border border-white/10 bg-white/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-neon-blue/10 transition-all duration-300 no-hover-effect custom-scrollbar hide-scrollbar"
        >
          {availableCurrencies.map((curr) => (
            <option key={curr} value={curr} className="bg-black text-[9px]">
              {curr.toUpperCase()}
            </option>
          ))}
        </select>
        {/* <motion.button
          onClick={handleSignOut}
          className="flex w-5 sm:w-6 h-5 sm:h-6 rounded-full text-red-400 flex items-center justify-center border border-white/10 bg-white/5 backdrop-blur-md transition-all duration-300 no-hover-effect"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Sign out"
        >
          <Power size={14} />
        </motion.button> */}
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            ref={menuRef}
            className="fixed top-0 left-0 w-full max-w-[70%] sm:max-w-xs h-[100vh] bg-black/90 backdrop-blur-3xl z-30 flex flex-col p-3 sm:hidden rounded-r-xl border-r border-white/10 shadow-neon-sm"
            initial="closed"
            animate="open"
            exit="closed"
            variants={menuVariants}
          >
            <div className="flex justify-between items-center mb-3">
              <img
                src="/logos/logo-landscape.png" // Replace with the actual path to your PNG image
                alt="Menu"
                className="h-14 w-auto" // Adjust size as needed
              />
              <div className="flex items-center gap-2">
                <select
                  id="mobile-currency-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="text-white px-2 py-1 text-[9px] border border-white/10 bg-white/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-neon-blue/50 backdrop-blur-md transition-all duration-300 no-hover-effect custom-scrollbar hide-scrollbar"
                >
                  {availableCurrencies.map((curr) => (
                    <option key={curr} value={curr} className="bg-black text-[9px]">
                      {curr.toUpperCase()}
                    </option>
                  ))}
                </select>
                {/* <button
                  onClick={() => setIsMenuOpen(false)}
                  className="text-white text-[12px] font-bold no-hover-effect"
                  aria-label="Close menu"
                >
                  ✕
                </button> */}
              </div>
            </div>
            <nav className="flex flex-col space-y-2 flex-grow overflow-y-auto custom-scrollbar">
              {tabs.map((tab, index) => (
                <div key={tab.id} className="w-full">
                  <motion.button
                    onClick={() => handleTabClick(tab.id)}
                    onMouseEnter={handleMouseEnter}
                    className={`w-full text-left px-2 py-1 m-2 text-xs font-medium transition-all duration-300 uppercase no-hover-effect ${activeTab === tab.id ? 'text-white border-b-2 border-white' : 'text-white/80 hover:text-white'}`}
                  >
                    <span className="matrix-text">{renderMatrixText(tab.label)}</span>
                  </motion.button>
                  {index < tabs.length - 1 && (
                    <span className="w-full h-px bg-white/20 my-2"></span>
                  )}
                </div>
              ))}
            </nav>
            {/* <motion.button
              onClick={handleSignOut}
              className="self-end mt-3 w-5 h-5 rounded-full text-red-400 flex items-center justify-center border border-white/10 bg-white/5 backdrop-blur-md transition-all duration-300 no-hover-effect"
              aria-label="Sign out"
            >
              <Power size={14} />
            </motion.button> */}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            className="fixed inset-0 z-20 sm:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setIsMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .shadow-neon-sm {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.15);
        }
        .animate-matrix-flip {
          animation: matrix-flip 0.4s ease-in-out;
        }
        .animate-flicker {
          animation: flicker 0.4s ease-in-out;
        }
        .animate-shuffle-position {
          animation: shuffle-position 0.4s ease-in-out;
        }
        @keyframes matrix-flip {
          0% {
            transform: rotateY(0deg);
          }
          50% {
            transform: rotateY(180deg);
          }
          100% {
            transform: rotateY(360deg);
          }
        }
        @keyframes flicker {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.6;
          }
        }
        @keyframes shuffle-position {
          0% {
            transform: translateX(0);
          }
          50% {
            transform: translateX(var(--shuffle-offset-1, 0));
          }
          75% {
            transform: translateX(var(--shuffle-offset-2, 0));
          }
          100% {
            transform: translateX(var(--shuffle-offset-3, 0));
          }
        }
        .animation-delay-1 { animation-delay: 0.05s; }
        .animation-delay-2 { animation-delay: 0.1s; }
        .animation-delay-3 { animation-delay: 0.15s; }
        .animation-delay-4 { animation-delay: 0.2s; }
        .animation-delay-5 { animation-delay: 0.25s; }
        .animation-delay-6 { animation-delay: 0.3s; }
        .animation-delay-7 { animation-delay: 0.35s; }
        .animation-delay-8 { animation-delay: 0.4s; }
        .animation-delay-9 { animation-delay: 0.45s; }
        .animation-delay-10 { animation-delay: 0.5s; }
        .animation-delay-11 { animation-delay: 0.55s; }
        .animation-delay-12 { animation-delay: 0.6s; }
        .animation-delay-13 { animation-delay: 0.65s; }
        @media (max-width: 640px) {
          .matrix-text span {
            font-size: 8px;
          }
          .animation-delay-1 { animation-delay: 0.04s; }
          .animation-delay-2 { animation-delay: 0.08s; }
          .animation-delay-3 { animation-delay: 0.12s; }
          .animation-delay-4 { animation-delay: 0.16s; }
          .animation-delay-5 { animation-delay: 0.2s; }
          .animation-delay-6 { animation-delay: 0.24s; }
          .animation-delay-7 { animation-delay: 0.28s; }
          .animation-delay-8 { animation-delay: 0.32s; }
          .animation-delay-9 { animation-delay: 0.36s; }
          .animation-delay-10 { animation-delay: 0.4s; }
          .animation-delay-11 { animation-delay: 0.44s; }
          .animation-delay-12 { animation-delay: 0.48s; }
          .animation-delay-13 { animation-delay: 0.52s; }
        }
      `}</style>
    </header>
  );
}