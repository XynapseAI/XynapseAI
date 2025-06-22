import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';

export default function Header({ activeTab, setActiveTab, handleSignOut }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const tabs = [
    { id: 'market', label: 'Market' },
    { id: 'ai', label: 'AI' },
    { id: 'point', label: 'Point' },
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'task', label: 'Task' },
    { id: 'profile', label: 'Profile' },

  ];

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Toggle menu and handle tab selection
  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    setIsMenuOpen(false);
  };

  // Handle matrix and shuffle effect on hover
  const handleMouseEnter = (e) => {
    const container = e.currentTarget.querySelector('.matrix-text');
    if (container) {
      container.classList.add('active');
      const spans = container.querySelectorAll('span');
      const positions = Array.from(spans).map(span => span.offsetLeft); // Lấy vị trí ban đầu
      const charCount = spans.length;

      // Tạo 3 mảng chỉ số ngẫu nhiên cho 3 lần xáo trộn
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
        if (span.textContent !== '\u00A0') { // Bỏ qua khoảng trắng
          // Tính offset cho 3 lần xáo trộn
          const targetIndex1 = shuffledIndices1[index];
          const targetIndex2 = shuffledIndices2[index];
          const targetIndex3 = shuffledIndices3[index];
          const offset1 = positions[targetIndex1] - positions[index];
          const offset2 = positions[targetIndex2] - positions[index];
          const offset3 = positions[targetIndex3] - positions[index];

          // Áp dụng các biến CSS
          span.style.setProperty('--shuffle-offset-1', `${offset1}px`);
          span.style.setProperty('--shuffle-offset-2', `${offset2}px`);
          span.style.setProperty('--shuffle-offset-3', `${offset3}px`);

          // Áp dụng tất cả animations
          span.classList.add(
            'animate-matrix-flip',
            'animate-flicker',
            'animate-shuffle-position',
            `animation-delay-${(index % 13) + 1}`
          );
        }
      });

      // Reset after 1.5s
      setTimeout(() => {
        container.classList.remove('active');
        spans.forEach((span) => {
          span.classList.remove(
            'animate-matrix-flip',
            'animate-flicker',
            'animate-shuffle-position',
            ...Array.from(span.classList).filter(c => c.startsWith('animation-delay-'))
          );
          span.style.removeProperty('--shuffle-offset-1');
          span.style.removeProperty('--shuffle-offset-2');
          span.style.removeProperty('--shuffle-offset-3');
        });
      }, 400); // Đồng bộ với thời gian animation
    }
  };

  // Hamburger icon animation variants
  const lineVariants = {
    closed: { rotate: 0, y: 0, opacity: 1, transition: { duration: 0.3 } },
    openTop: { rotate: 45, y: 8, transition: { duration: 0.3 } },
    openBottom: { rotate: -45, y: -8, transition: { duration: 0.3 } },
    hidden: { opacity: 0, transition: { duration: 0.3 } },
  };

  // Menu animation variants
  const menuVariants = {
    closed: { x: '-100%', opacity: 0, transition: { duration: 0.3, ease: 'easeInOut' } },
    open: { x: 0, opacity: 1, transition: { duration: 0.3, ease: 'easeInOut' } },
  };

  // Render matrix text
  const renderMatrixText = (text) => {
    return text.split('').map((char, index) => (
      <span
        key={index}
        className={`inline-block transform-style-3d transition-transform-opacity duration-300 ease-in-out ${char === ' ' ? '' : `animation-delay-${(index % 13) + 1}`
          }`}
      >
        {char === ' ' ? '\u00A0' : char}
      </span>
    ));
  };

  return (
    <header className="h-200 sm:h-[7vh] bg-gray-900/90 border-b-2 rounded-xl p-3 flex justify-between items-center sticky top-0 z-20 font-plexmono">
      {/* Hamburger Icon (Mobile Only) */}
      <div className="block sm:hidden">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="w-8 h-8 flex flex-col justify-center items-center"
          aria-label="Toggle menu"
        >
          <motion.span
            className="w-6 h-0.5 bg-white mb-1.5"
            variants={lineVariants}
            animate={isMenuOpen ? 'openTop' : 'closed'}
          />
          <motion.span
            className="w-6 h-0.5 bg-white mb-1.5"
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

      {/* Tabs (Desktop) */}
      <div className="hidden sm:flex space-x-2">
        {tabs.map((tab) => (
          <motion.button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onMouseEnter={handleMouseEnter}
            className={`group px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-300 border border-white/20 text-white backdrop-blur-md  perspective-1000 ${activeTab === tab.id ? 'bg-tech text-black' : ''
              }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span className="matrix-text inline-block">
              {renderMatrixText(tab.label)}
            </span>
          </motion.button>
        ))}
      </div>

      {/* Sign Out Button */}
      <button
        onClick={handleSignOut}
        className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-300 border border-white/20 text-red backdrop-blur-md"
      >
        Log Out
      </button>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            ref={menuRef}
            className="fixed top-0 left-0 w-3/4 max-w-xs h-full bg-gray-800/95 backdrop-blur-md z-30 flex flex-col p-4 sm:hidden border-r border-white/10"
            initial="closed"
            animate="open"
            exit="closed"
            variants={menuVariants}
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">Menu</h2>
              <button
                onClick={() => setIsMenuOpen(false)}
                className="text-white text-xl"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <nav className="flex flex-col space-y-2">
              {tabs.map((tab) => (
                <motion.button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  onMouseEnter={handleMouseEnter}
                  className={`group w-full text-left px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 border border-white/20 bg-white/10 text-neon-purple backdrop-blur-md hover:bg-white/15 hover:shadow-glow-neon perspective-1000 ${activeTab === tab.id ? 'bg-white text-black' : ''
                    }`}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <span className="matrix-text inline-block group-hover:text-neon-blue">
                    {renderMatrixText(tab.label)}
                  </span>
                </motion.button>
              ))}
              <motion.button
                onClick={() => {
                  handleSignOut();
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-300 border border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/15 hover:shadow-glow-neon"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Đăng Xuất
              </motion.button>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlay when menu is open */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            className="fixed inset-0 bg-black/50 z-20 sm:hidden"
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