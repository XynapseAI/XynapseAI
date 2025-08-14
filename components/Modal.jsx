// components/Modal.jsx
import React from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

const Modal = ({ isOpen, onClose, title, content, links = [], isMobile }) => {
  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease: 'easeInOut' }}
      className="fixed inset-0 flex items-center justify-center z-50 font-saira bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`p-3 sm:p-4 rounded-xl max-w-[90%] sm:max-w-3xl w-full relative my-3 border border-white/10 bg-white/5 backdrop-blur-md shadow-neon-sm overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <motion.button
          onClick={onClose}
          className="absolute top-2 sm:top-3 right-2 sm:right-3 text-white rounded-full w-6 h-6 flex items-center justify-center border border-white/10 bg-white/5 backdrop-blur-md hover:bg-neon-blue/20 transition-all duration-300"
          aria-label="Close modal"
          whileHover={{ scale: 1.05, rotate: 90 }}
          whileTap={{ scale: 0.95 }}
        >
          ✕
        </motion.button>
        <h4 className="text-[10px] sm:text-[12px] font-bold text-white mb-2 uppercase tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-1 rounded">
          {title}
        </h4>
        <div className="text-[9px] sm:text-[10px] text-white/80 mb-3 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
          {typeof content === 'string' ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer" className="text-neon-blue hover:text-neon-blue/80 transition-all duration-200">
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <table className="border-collapse border border-white/10 w-full table-auto mb-2 bg-white/5 backdrop-blur-md">{children}</table>
                ),
                th: ({ children }) => (
                  <th className="border border-white/10 px-2 sm:px-3 py-1 text-white text-left bg-white/5 backdrop-blur-md text-[9px] sm:text-[10px]">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="border border-white/10 px-2 sm:px-3 py-1 text-white/80 text-[9px] sm:text-[10px]">{children}</td>
                ),
                code: ({ className, children }) => (
                  <code className={`${className || ''} rounded text-white/80 bg-white/10 backdrop-blur-md p-1 text-[8px] sm:text-[9px]`}>
                    {children}
                  </code>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          ) : (
            content
          )}
        </div>
        {links.length > 0 && (
          <div>
            <h5 className="text-[9px] sm:text-[10px] font-bold text-white mb-1 uppercase tracking-wider">References:</h5>
            <ul className="list-none">
              {links.map((link, index) => (
                <li key={index} className="mb-1">
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[9px] sm:text-[10px] text-neon-blue hover:text-neon-blue/80 transition-all duration-200"
                  >
                    {link.length > 30 ? `${link.slice(0, 30)}...` : link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

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
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .shadow-neon-sm {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.1);
        }
        @media (max-width: 640px) {
          .max-w-3xl {
            max-width: 95%;
          }
          .max-h-80 {
            max-height: 60vh;
          }
          .w-6 {
            width: 1.25rem;
            height: 1.25rem;
          }
          .text-[12px] {
            font-size: 10px;
          }
          .text-[10px] {
            font-size: 8px;
          }
          .text-[9px] {
            font-size: 7px;
          }
          .text-[8px] {
            font-size: 6px;
          }
        }
      `}</style>
    </motion.div>
  );
};

export default React.memo(Modal);