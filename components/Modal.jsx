import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

const Modal = ({ isOpen, onClose, title, content, links = [], isMobile, isLoading = false }) => {
  // State for dynamic log messages
  const [logMessages, setLogMessages] = useState([]);
  const sources = [
    'Fetching tweets from X...',
    'Analyzing market trends...',
    'Querying Brave API for web data...',
    'Processing AI interactions...',
    'Synthesizing insights...',
  ];

  // Simulate log updates during loading
  useEffect(() => {
    if (!isLoading) {
      setLogMessages([]);
      return;
    }

    const interval = setInterval(() => {
      setLogMessages((prev) => {
        const nextIndex = prev.length % sources.length;
        return [...prev, { text: sources[nextIndex], id: Date.now() }].slice(-5); // Keep last 5 messages
      });
    }, 1500);

    return () => clearInterval(interval);
  }, [isLoading]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm font-saira"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            className={`relative bg-black/80 border border-white/20 rounded-2xl p-4 sm:p-6 w-full max-w-[90%] sm:max-w-3xl ${isMobile ? 'h-[80vh]' : 'max-h-[80vh]'
              } overflow-y-auto custom-scrollbar`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Loading Overlay */}
            {isLoading && (
              <motion.div
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-10 rounded-2xl p-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.3 }}
              >
                <div className="w-full max-w-md bg-black/10 backdrop-blur-xl border border-white/20 rounded-xl p-4 relative overflow-hidden shadow-2xl animate-pulse-slow">
                  {/* Scanning Animation */}
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan" />
                  {/* Pulsing Blur Overlay */}
                  <div className="absolute inset-0 bg-emerald-400 backdrop-blur-sm animate-pulse opacity-50" />
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <h3 className="text-white text-sm sm:text-base font-semibold">Processing Data</h3>
                  </div>
                  <div className="h-40 overflow-y-hidden custom-scrollbar log-container relative">
                    <AnimatePresence>
                      {logMessages.map((log, index) => (
                        <motion.p
                          key={log.id}
                          className={`text-white/80 text-xs sm:text-sm font-mono mb-2 ${
                            index === logMessages.length - 1
                              ? 'text-blue-400 font-semibold animate-pulse'
                              : 'text-white/60'
                          }`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.3 }}
                        >
                          <span className="text-blue-500">&gt;</span> {log.text}
                        </motion.p>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Close Button */}
            <motion.button
              onClick={onClose}
              className="absolute top-3 right-3 text-white/60 hover:text-white rounded-full w-8 h-8 flex items-center justify-center border border-white/10 bg-white/5 backdrop-blur-md hover:bg-blue-500/20 transition-all duration-300"
              aria-label="Close modal"
              whileHover={{ scale: 1.05, rotate: 90 }}
              whileTap={{ scale: 0.95 }}
            >
              <X size={20} />
            </motion.button>

            {/* Title */}
            <h4 className="text-base sm:text-lg font-bold text-white mb-4 uppercase tracking-wider bg-gradient-to-r from-blue-500/20 to-transparent p-2 rounded">
              {title}
            </h4>

            {/* Content */}
            <div className="text-sm sm:text-base text-white/90 mb-4 max-h-[60vh] sm:max-h-[65vh] overflow-y-auto pr-2 custom-scrollbar">
              {typeof content === 'string' ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    a: (props) => {
                      const { href, children } = props;
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-500 hover:text-blue-400 transition-all duration-200"
                        >
                          {children}
                        </a>
                      );
                    },
                    table: (props) => (
                      <table className="border-collapse border border-white/10 w-full table-auto mb-4 bg-white/5 backdrop-blur-md">
                        {props.children}
                      </table>
                    ),
                    th: (props) => (
                      <th className="border border-white/10 px-3 py-2 text-white text-left bg-white/5 backdrop-blur-md text-sm">
                        {props.children}
                      </th>
                    ),
                    td: (props) => (
                      <td className="border border-white/10 px-3 py-2 text-white/80 text-sm">{props.children}</td>
                    ),
                    code: (props) => {
                      const { className, children } = props;
                      return (
                        <code
                          className={`${className || ''} rounded text-white/80 bg-white/5 backdrop-blur-md p-1 text-xs sm:text-sm`}
                        >
                          {children}
                        </code>
                      );
                    },
                    h1: (props) => (
                      <h1 className="text-xl sm:text-2xl font-bold mt-4 mb-2 text-white">{props.children}</h1>
                    ),
                    h2: (props) => (
                      <h2 className="text-lg sm:text-xl font-semibold mt-3 mb-1 text-white">{props.children}</h2>
                    ),
                    p: (props) => <p className="mb-2">{props.children}</p>,
                  }}
                >
                  {content}
                </ReactMarkdown>
              ) : (
                <div className="text-white/90">{content}</div>
              )}
            </div>

            {/* Links */}
            {links && links.length > 0 && (
              <div>
                <h5 className="text-sm sm:text-base font-bold text-white mb-2 uppercase tracking-wider">References:</h5>
                <ul className="list-none">
                  {links.map((link, index) => (
                    <li key={index} className="mb-1">
                      <a
                        href={typeof link === 'string' ? link : link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-blue-500 hover:text-blue-400 transition-all duration-200"
                      >
                        {typeof link === 'string'
                          ? link.length > 50
                            ? `${link.slice(0, 50)}...`
                            : link
                          : link.text || (link.url.length > 50 ? `${link.url.slice(0, 50)}...` : link.url)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>

          <style jsx>{`
            .custom-scrollbar::-webkit-scrollbar {
              width: 6px;
              height: 6px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, 0.3);
              border-radius: 3px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
              background: rgba(255, 255, 255, 0.5);
            }
            .log-container {
              -webkit-mask-image: linear-gradient(to bottom, transparent 0%, white 20%, white 80%, transparent 100%);
              mask-image: linear-gradient(to bottom, transparent 0%, white 20%, white 80%, transparent 100%);
            }
            @media (max-width: 640px) {
              .max-w-3xl {
                max-width: 95%;
              }
              .max-h-[65vh] {
                max-height: 70vh;
              }
              .w-8 {
                width: 1.5rem;
                height: 1.5rem;
              }
              .text-base {
                font-size: 0.875rem;
              }
              .text-sm {
                font-size: 0.75rem;
              }
              .text-xs {
                font-size: 0.625rem;
              }
            }
            @keyframes scan {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(100%);
              }
            }
            .animate-scan {
              animation: scan 2s linear infinite;
            }
            .animate-pulse-slow {
              animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default React.memo(Modal);