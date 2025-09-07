// components/Modal.jsx
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import sanitizeHtml from 'sanitize-html';

const Modal = ({ isOpen, onClose, title, content, links = [], isMobile, isLoading = false, logs = [], actionType = 'analyze' }) => {
  const [logMessages, setLogMessages] = useState([]);
  const prevLogsRef = useRef(logs);
  const prevIsLoadingRef = useRef(isLoading);

  useEffect(() => {
    if (isLoading !== prevIsLoadingRef.current || logs !== prevLogsRef.current) {
      if (logs.length > 0) {
        setLogMessages(logs.map(text => ({ text, id: Date.now() + Math.random() })));
      } else if (isLoading) {
        const sources = actionType === 'predict' ? [
          'Generating predictions...',
          'Processing market data...',
          'Calculating trends...',
          'Evaluating patterns...',
          'Formulating insights...',
        ] : [
          'Analyzing data...',
          'Processing information...',
          'Examining trends...',
          'Evaluating metrics...',
          'Synthesizing results...',
        ];
        const interval = setInterval(() => {
          setLogMessages((prev) => {
            const nextIndex = prev.length % sources.length;
            return [...prev, { text: sources[nextIndex], id: Date.now() }].slice(-5);
          });
        }, 1500);
        return () => clearInterval(interval);
      } else if (logMessages.length > 0) {
        setLogMessages([]);
      }
    }
    prevLogsRef.current = logs;
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, logs, logMessages.length, actionType]);

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
            {isLoading && (
              <motion.div
                className="absolute inset-0 flex items-center justify-center bg-black/90 z-10 rounded-2xl"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.3 }}
              >

                <div className="w-[90%] sm:w-[95%] h-[25%] sm:h-[80%] bg-black/10 backdrop-blur-xl border border-white/20 rounded-xl p-10 relative overflow-hidden shadow-2xl animate-pulse-slow">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan" />
                  <div className="absolute inset-0 bg-black/10 backdrop-blur-sm animate-pulse opacity-50" />
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <h3 className="text-white text-sm sm:text-base font-semibold">
                      {actionType === 'predict' ? 'Predicting' : 'Analyzing'}
                    </h3>
                  </div>
                  <div className="h-20 overflow-y-hidden custom-scrollbar log-container relative">
                    <AnimatePresence>
                      {logMessages.map((log, index) => (
                        <motion.p
                          key={log.id}
                          className={`text-white/80 text-[10px] sm:text-xs font-saira mb-2 ${index === logMessages.length - 1
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

            <motion.button
              onClick={onClose}
              className="absolute top-3 right-3 text-white/60 hover:text-white rounded-full w-8 h-8 flex items-center justify-center border border-white/10 bg-white/5 backdrop-blur-md hover:bg-blue-500/20 transition-all duration-300"
              aria-label="Close modal"
              whileHover={{ scale: 1.05, rotate: 90 }}
              whileTap={{ scale: 0.95 }}
            >
              <X size={20} />
            </motion.button>

            <h4 className="text-base sm:text-lg font-bold text-white mb-4 uppercase tracking-wider bg-gradient-to-r from-blue-500/20 to-transparent p-2 rounded">
              {title}
            </h4>

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

            {links && links.length > 0 && (
              <div>
                <h5 className="text-sm sm:text-base font-bold text-white mb-2 uppercase tracking-wider">References:</h5>
                <ul className="list-none space-y-4">
                  {links.map((link, index) => {
                    const displayText =
                      typeof link === 'string'
                        ? link.length > 50
                          ? `${link.slice(0, 50)}...`
                          : link
                        : link.text && link.text !== 'undefined'
                          ? link.text
                          : link.url || 'Untitled';
                    const displayUrl = typeof link === 'string' ? link : link.url;
                    const displayDescription =
                      typeof link === 'string'
                        ? 'No description available'
                        : link.description && link.description !== 'undefined'
                          ? link.description
                          : 'No description available';
                    const displayImage = typeof link === 'string' ? null : link.image;

                    return (
                      <li key={index} className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-start gap-3 hover:bg-white/10 transition-all">
                        {displayImage && (
                          <img
                            src={displayImage}
                            alt={displayText}
                            className="w-16 h-16 object-cover rounded-md flex-shrink-0"
                            onError={(e) => { e.target.src = '/placeholder-image.png'; }}
                          />
                        )}
                        <div className="flex-grow">
                          <a
                            href={displayUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-blue-500 hover:text-blue-400 transition-all duration-200 font-semibold"
                          >
                            {sanitizeHtml(displayText, { allowedTags: [], allowedAttributes: {} })}
                          </a>
                          <p className="text-xs text-white/60 mt-1">
                            {sanitizeHtml(displayDescription, { allowedTags: [], allowedAttributes: {} })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

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
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default React.memo(Modal);