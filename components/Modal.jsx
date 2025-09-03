import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

const Modal = ({ isOpen, onClose, title, content, links = [], isMobile, isLoading = false }) => {
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
            className={`relative bg-black/80 border border-white/20 rounded-2xl p-4 sm:p-6 w-full max-w-[90%] sm:max-w-3xl ${
              isMobile ? 'h-[80vh]' : 'max-h-[80vh]'
            } overflow-y-auto custom-scrollbar`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Loading Overlay */}
            {isLoading && (
              <motion.div
                className="absolute inset-0 flex items-center justify-center bg-black/80 z-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-10 h-10 border-4 border-t-transparent border-white rounded-full animate-spin" />
                  <p className="text-white/80 text-sm">Processing data...</p>
                </div>
              </motion.div>
            )}

            {/* Close Button */}
            <motion.button
              onClick={onClose}
              className="absolute top-3 right-3 text-white/60 hover:text-white rounded-full w-8 h-8 flex items-center justify-center border border-white/10 bg-white/5 backdrop-blur-md hover:bg-neon-blue/20 transition-all duration-300"
              aria-label="Close modal"
              whileHover={{ scale: 1.05, rotate: 90 }}
              whileTap={{ scale: 0.95 }}
            >
              <X size={20} />
            </motion.button>

            {/* Title */}
            <h4 className="text-base sm:text-lg font-bold text-white mb-4 uppercase tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-2 rounded">
              {title}
            </h4>

            {/* Content */}
            <div className="text-sm sm:text-base text-white/90 mb-4 max-h-[60vh] sm:max-h-[65vh] overflow-y-auto pr-2 custom-scrollbar">
              {typeof content === 'string' ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80 transition-all duration-200"
                      >
                        {children}
                      </a>
                    ),
                    table: ({ children }) => (
                      <table className="border-collapse border border-white/10 w-full table-auto mb-4 bg-white/5 backdrop-blur-md">
                        {children}
                      </table>
                    ),
                    th: ({ children }) => (
                      <th className="border border-white/10 px-3 py-2 text-white text-left bg-white/5 backdrop-blur-md text-sm">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-white/10 px-3 py-2 text-white/80 text-sm">{children}</td>
                    ),
                    code: ({ className, children }) => (
                      <code
                        className={`${
                          className || ''
                        } rounded text-white/80 bg-white/10 backdrop-blur-md p-1 text-xs sm:text-sm`}
                      >
                        {children}
                      </code>
                    ),
                    h1: ({ children }) => <h1 className="text-xl sm:text-2xl font-bold mt-4 mb-2 text-white">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-lg sm:text-xl font-semibold mt-3 mb-1 text-white">{children}</h2>,
                    p: ({ children }) => <p className="mb-2">{children}</p>,
                  }}
                >
                  {content}
                </ReactMarkdown>
              ) : (
                <div className="text-white/90">{content}</div>
              )}
            </div>

            {/* Links */}
            {links.length > 0 && (
              <div>
                <h5 className="text-sm sm:text-base font-bold text-white mb-2 uppercase tracking-wider">References:</h5>
                <ul className="list-none">
                  {links.map((link, index) => (
                    <li key={index} className="mb-1">
                      <a
                        href={typeof link === 'string' ? link : link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-neon-blue hover:text-neon-blue/80 transition-all duration-200"
                      >
                        {typeof link === 'string'
                          ? link.length > 50
                            ? `${link.slice(0, 50)}...`
                            : link
                          : link.text || link.url.length > 50
                          ? `${link.url.slice(0, 50)}...`
                          : link.url}
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
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default React.memo(Modal);