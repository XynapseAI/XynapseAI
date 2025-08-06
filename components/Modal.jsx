import React from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import '../styles/MarketTab.css';

const Modal = ({ isOpen, onClose, title, content, links = [], isMobile }) => {
  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
      className="fixed inset-0 flex items-center justify-center z-50 font-jetbrains bg-black/60 backdrop-blur-xl"
      onClick={onClose}
    >
      <div
        className={`p-6 rounded-xl max-w-[90%] sm:max-w-4xl w-full relative my-4 border border-white/10 bg-black/60 backdrop-blur-2xl shadow-neon-lg overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <motion.button
          onClick={onClose}
          className="absolute top-4 right-4 text-white text-lg font-bold rounded-full w-10 h-10 flex items-center justify-center bg-black/60 border border-white/10 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
          aria-label="Close modal"
          whileHover={{ scale: 1.1, rotate: 90 }}
          whileTap={{ scale: 0.9 }}
        >
          ✕
        </motion.button>
        <h4 className="text-sm font-bold text-white mb-4 uppercase tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-2 rounded">
          {title}
        </h4>
        <div className="text-xs md:text-sm text-gray-200 mb-4 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
          {typeof content === 'string' ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer" className="text-neon-blue hover:underline">
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <table className="border-collapse border border-white/10 w-full table-auto mb-2 bg-black/50 backdrop-blur-md">{children}</table>
                ),
                th: ({ children }) => (
                  <th className="border border-white/10 px-4 py-2 text-white text-left bg-black/60 backdrop-blur-md">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="border border-white/10 px-4 py-2 text-gray-200">{children}</td>
                ),
                code: ({ className, children }) => (
                  <code className={`${className || ''} rounded text-gray-200 bg-black/70 backdrop-blur-md p-1`}>
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
            <h5 className="text-sm font-bold text-white mb-2 uppercase tracking-wider">References:</h5>
            <ul className="list-none">
              {links.map((link, index) => (
                <li key={index} className="mb-2">
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs md:text-sm text-neon-blue hover:underline"
                  >
                    {link.length > 30 ? `${link.slice(0, 30)}...` : link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default React.memo(Modal);