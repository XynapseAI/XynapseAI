'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Power, Search, BarChart3, Network, Activity, List, User } from 'lucide-react';
import { useCurrency } from './CurrencyContext';
import { logger } from '../utils/clientLogger';
import '../styles/globals.css';

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
    { id: 'market', label: 'Market', icon: BarChart3 },
    { id: 'cluster', label: 'Cluster', icon: Network },
    { id: 'graph', label: 'Graph', icon: Activity },
    { id: 'watchlists', label: 'Watchlists', icon: List },
    { id: 'profile', label: 'Profile', icon: User },
  ];

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

  const handleExchangeSelect = (exchange) => {
    router.push(`/dashboard?tab=cluster&clusterId=${exchange.id}`, { scroll: false });
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchDropdownOpen(false);
    setActiveTab('cluster');
  };

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    const clusterId = new URLSearchParams(window.location.search).get('clusterId');
    let query = '';
    if (tabId === 'watchlists' && selectedAddress) {
      query = `tab=${tabId}&address=${encodeURIComponent(selectedAddress)}`;
    } else if (tabId === 'cluster' && clusterId) {
      query = `tab=${tabId}&clusterId=${encodeURIComponent(clusterId)}`;
    } else {
      query = `tab=${tabId}`;
    }
    const path = `/dashboard?${query}`;
    router.push(path, { scroll: false });
    setIsMenuOpen(false);
  };

  const handleMouseEnter = (e, tabLabel) => {
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
    <header className="h-[5vh] sm:h-[6vh] bg-gradient-to-br from-black/80 to-gray-900/80 backdrop-blur-xl border border-white/10 rounded-b-xl flex justify-between items-center sticky top-0 z-50 font-saira shadow-2xl">
      <div className="block sm:hidden px-4">
        <motion.button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="w-6 h-6 flex flex-col justify-center items-center relative"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Toggle menu"
        >
          <motion.span
            className="w-6 h-0.5 bg-white/80 rounded-full mb-1 origin-center"
            variants={lineVariants}
            animate={isMenuOpen ? 'openTop' : 'closed'}
            transition={{ duration: 0.2 }}
          />
          <motion.span
            className="w-6 h-0.5 bg-white/80 rounded-full mb-1 origin-center"
            variants={lineVariants}
            animate={isMenuOpen ? 'hidden' : 'closed'}
            transition={{ duration: 0.2 }}
          />
          <motion.span
            className="w-6 h-0.5 bg-white/80 rounded-full origin-center"
            variants={lineVariants}
            animate={isMenuOpen ? 'openBottom' : 'closed'}
            transition={{ duration: 0.2 }}
          />
        </motion.button>
      </div>

      <div className="hidden sm:flex justify-center items-end flex-grow h-full px-4">
        <AnimatePresence mode="wait">
          <motion.nav
            className="flex items-center space-x-1"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <motion.button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  onMouseEnter={(e) => handleMouseEnter(e, tab.label)}
                  className={`group relative flex items-center gap-1 px-3 py-2 text-[10px] font-semibold uppercase rounded-lg transition-all duration-300 ease-out border border-transparent ${isActive
                      ? 'text-neon-blue'
                      : 'text-white/70 hover:text-white'
                    }`}
                >
                  <Icon className={`w-3 h-3 flex-shrink-0 ${isActive ? 'text-white/80' : 'text-white/70 group-hover:text-white'}`} />
                  <span className={`matrix-text relative overflow-hidden ${isActive ? 'text-white/80' : ''}`}>
                    {renderMatrixText(tab.label)}
                  </span>
                  {isActive && (
                    <motion.div
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-white to-emerald-400 rounded-full"
                      layoutId="activeTabIndicator"
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    />
                  )}
                </motion.button>
              );
            })}
          </motion.nav>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            ref={menuRef}
            className="fixed top-0 left-0 w-full max-w-[80vw] h-[100vh] bg-gradient-to-br from-black/90 to-gray-900/90 backdrop-blur-xl z-50 flex flex-col p-4 sm:hidden rounded-r-xl border-r border-white/10 shadow-2xl shadow-neon-blue/20 overflow-y-auto hide-scrollbar"
            initial="closed"
            animate="open"
            exit="closed"
            variants={menuVariants}
          >
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-white/10">
              <img
                src="/logos/logo-landscape.webp"
                alt="Menu"
                className="h-12 w-auto"
              />
              <motion.button
                onClick={() => setIsMenuOpen(false)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Power className="w-4 h-4 text-white/70" />
              </motion.button>
            </div>
            <nav className="flex flex-col space-y-2 flex-grow">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <motion.button
                    key={tab.id}
                    onClick={() => handleTabClick(tab.id)}
                    onMouseEnter={(e) => handleMouseEnter(e, tab.label)}
                    className={`relative w-full flex items-center gap-2 px-3 py-3 text-sm font-semibold transition-all duration-300 rounded-lg border border-transparent ${isActive
                        ? 'text-neon-blue'
                        : 'text-white/70 hover:text-white hover:bg-white/5 hover:border-white/5'
                      }`}
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-neon-blue' : 'text-white/70'}`} />
                    <span className={`matrix-text flex-1 ${isActive ? 'text-neon-blue' : ''}`}>{renderMatrixText(tab.label)}</span>
                    {isActive && (
                      <motion.div
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-neon-blue to-purple-500 rounded-full"
                        layoutId="activeTabIndicator"
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      />
                    )}
                  </motion.button>
                );
              })}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            className="fixed inset-0 z-40 sm:hidden bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setIsMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .matrix-text {
          position: relative;
          overflow: hidden;
        }
        .matrix-text.active span {
          color: #00bfff !important;
        }
        .animate-matrix-flip {
          animation: matrix-flip 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        .animate-flicker {
          animation: flicker 0.4s ease-in-out;
        }
        .animate-shuffle-position {
          animation: shuffle-position 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        @keyframes matrix-flip {
          0% { transform: rotateY(0deg) translateX(0); opacity: 1; }
          50% { transform: rotateY(180deg) translateX(var(--shuffle-offset-1, 0)); opacity: 0.7; }
          75% { transform: rotateY(270deg) translateX(var(--shuffle-offset-2, 0)); opacity: 0.4; }
          100% { transform: rotateY(360deg) translateX(var(--shuffle-offset-3, 0)); opacity: 1; }
        }
        @keyframes flicker {
          0%, 100% { opacity: 1; filter: brightness(1); }
          50% { opacity: 0.6; filter: brightness(1.2); }
        }
        @keyframes shuffle-position {
          0% { transform: translateX(0); }
          33% { transform: translateX(var(--shuffle-offset-1, 0)); }
          66% { transform: translateX(var(--shuffle-offset-2, 0)); }
          100% { transform: translateX(var(--shuffle-offset-3, 0)); }
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
            font-size: 9px;
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
        @media (prefers-reduced-motion: reduce) {
          .animate-matrix-flip, .animate-flicker, .animate-shuffle-position {
            animation: none;
          }
        }
      `}</style>
    </header>
  );
}