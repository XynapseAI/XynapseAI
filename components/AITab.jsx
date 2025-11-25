'use client';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ClipboardIcon, MagnifyingGlassIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Image from 'next/image';

export default function AITab({ recaptchaRef }) {
  const { data: session, status } = useSession();
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('Grok 3');
  const [prompt, setPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [useDeepSearch, setUseDeepSearch] = useState(false);
  const [typingText, setTypingText] = useState('');
  const [searchLinks, setSearchLinks] = useState([]);
  const [copiedStates, setCopiedStates] = useState({});
  const [dailyInteractions, setDailyInteractions] = useState(0);
  const [totalDailyChats, setTotalDailyChats] = useState(0);
  const chatContainerRef = useRef(null);
  const toggleButtonRef = useRef(null);
  const textareaRef = useRef(null);
  const menuRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  const models = ['Grok 3', 'GPT 4o', 'Gemini-2.5'];
  const maxDailyInteractions = 5;
  const maxTotalDailyChats = 50;

  useEffect(() => {
    async function fetchDailyInteractions() {
      if (session?.user?.id) {
        try {
          const response = await axios.get(`/api/daily-ai-interactions?uid=${session.user.id}&interactionType=chat`, {
            headers: {
              'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
            },
            withCredentials: true,
          });
          if (response.data.success) {
            setDailyInteractions(Math.min(response.data.pointsCount, maxDailyInteractions));
            setTotalDailyChats(response.data.totalCount);
          }
        } catch (err) {
          console.error('Error fetching daily interactions:', err.response?.data || err.message);
          setError('Failed to fetch daily interaction count: ' + (err.response?.data?.detail || err.message));
        }
      }
    }
    fetchDailyInteractions();
  }, [session]);

  const executeRecaptcha = async (action = 'chat') => {
    if (!recaptchaRef.current) {
      throw new Error('reCAPTCHA not initialized.');
    }
    try {
      const token = await recaptchaRef.current.executeAsync({ action });
      console.log('reCAPTCHA token generated:', { action, token: token.substring(0, 8) + '...' });
      return token;
    } catch (error) {
      console.error('reCAPTCHA execution error:', error);
      throw new Error('Failed to execute reCAPTCHA.');
    }
  };

  const getFaviconUrl = (url) => {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
      return '/favicon.ico';
    }
  };

  const getCodeTitle = (prompt) => {
    if (!prompt) return '@';
    const cleanPrompt = prompt.replace(/[<>{}]/g, '').trim().slice(0, 30);
    const keywords = ['code', 'script', 'program', 'function', 'program', 'analyze', 'build'];
    const keyTerm = cleanPrompt
      .split(' ')
      .find((word) => keywords.some((kw) => word.toLowerCase().includes(kw)));
    return keyTerm ? keyTerm.charAt(0).toUpperCase() + keyTerm.slice(1) : '@';
  };

  const copyToClipboard = (codeRef, id) => {
    try {
      if (codeRef.current) {
        const codeText = codeRef.current.innerText;
        navigator.clipboard.writeText(codeText).then(() => {
          setCopiedStates((prev) => ({ ...prev, [id]: true }));
          toast.success('Code copied to clipboard!', {
            position: 'top-center',
            autoClose: 3000,
          });
          setTimeout(() => {
            setCopiedStates((prev) => ({ ...prev, [id]: false }));
          }, 2000);
        });
      }
    } catch (err) {
      console.error('Error copying text:', err);
      setError('Failed to copy content.');
      toast.error('Failed to copy code.', {
        position: 'top-center',
        autoClose: 3000,
      });
    }
  };

  const handleSendPrompt = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('Please enter a prompt.');
      toast.error('Please enter a prompt.', {
        position: 'top-center',
        autoClose: 3000,
      });
      return;
    }

    if (status !== 'authenticated') {
      setError('Please log in to interact with the AI.');
      toast.error('Please log in to interact with the AI.', {
        position: 'top-center',
        autoClose: 3000,
      });
      return;
    }

    if (totalDailyChats >= maxTotalDailyChats) {
      toast.error('You have reached the maximum of 50 daily chats. Try again tomorrow.', {
        position: 'top-center',
        autoClose: 3000,
      });
      return;
    }

    const userMessage = { role: 'user', content: prompt };
    setChatHistory((prev) => [...prev, userMessage]);
    setPrompt('');
    setIsLoading(true);
    setError(null);
    setTypingText('');
    setSearchLinks([]);

    try {
      console.log(`Sending prompt to ${selectedModel} API:`, { prompt, deepSearch: useDeepSearch });

      let apiEndpoint;
      switch (selectedModel.toLowerCase()) {
        case 'grok 3':
          apiEndpoint = '/api/grok';
          break;
        case 'gpt 4o':
          apiEndpoint = '/api/openai';
          break;
        case 'gemini-2.5':
          apiEndpoint = '/api/gemini';
          break;
        default:
          throw new Error('Unsupported model');
      }

      const tokenSymbol = prompt.match(/bitcoin|eth|sol|ada|xrp|doge|crypto/i)?.[0]?.toUpperCase();
      const recaptchaToken = await executeRecaptcha('chat');

      const response = await axios.post(
        apiEndpoint,
        {
          prompt,
          deepSearch: useDeepSearch,
          tokenSymbol,
          recaptchaToken,
        },
        {
          headers: {
            'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
          },
          withCredentials: true,
        }
      );
      console.log(`${selectedModel} API response:`, response.data);
      const { answer, links } = response.data;

      const assistantMessage = { role: 'assistant', content: answer, links: useDeepSearch ? links : [], prompt };
      setChatHistory((prev) => [...prev, assistantMessage]);
      setSearchLinks(useDeepSearch ? links : []);

      if (session?.user?.id) {
        console.log('Saving AI interaction for user:', session.user.id);
        try {
          const interactionRecaptchaToken = await executeRecaptcha('ai_interaction');
          const interactionRes = await axios.post(
            '/api/ai-interaction',
            {
              uid: session.user.id,
              query: prompt,
              response: answer,
              interactionType: 'chat',
            },
            {
              headers: {
                'x-csrf-token': process.env.NEXT_PUBLIC_CSRF_TOKEN || '7b3a9f8c2d6e4b1a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3a2c1d0e9f8a7',
                'X-Recaptcha-Token': interactionRecaptchaToken,
              },
              withCredentials: true,
            }
          );
          console.log('Saved AI interaction:', interactionRes.data);
          if (interactionRes.data.pointsAwarded > 0) {
            setDailyInteractions((prev) => Math.min(prev + 1, maxDailyInteractions));
          }
          setTotalDailyChats((prev) => prev + 1);
        } catch (interactionError) {
          console.error('Error saving AI interaction:', interactionError.response?.data || interactionError.message);
          setError(`Failed to save AI interaction: ${interactionError.response?.data?.detail || interactionError.message}`);
        }
      }
    } catch (err) {
      console.error(`Error calling ${selectedModel} API:`, err.response?.data || err.message);
      if (err.response?.status === 429) {
        setError('API rate limit exceeded. Please try again later.');
        toast.error('API rate limit exceeded. Please try again later.', {
          position: 'top-center',
          autoClose: 3000,
        });
      } else if (err.response?.status === 422 && err.response?.data?.error?.code === 'VALIDATION') {
        console.warn('Brave Search API validation error:', err.response.data);
        setError('Unable to fetch web information. Please try again.');
        toast.error('Unable to fetch web information. Please try again.', {
          position: 'top-center',
          autoClose: 3000,
        });
      } else if (err.response?.status === 400) {
        setError(err.response?.data?.errors?.map((e) => e.msg).join(', ') || 'Invalid request. Please check your input.');
        toast.error(err.response?.data?.errors?.map((e) => e.msg).join(', ') || 'Invalid request. Please check your input.', {
          position: 'top-center',
          autoClose: 3000,
        });
      } else {
        setError(err.response?.data?.detail || `Unable to get response from ${selectedModel}.`);
        toast.error(err.response?.data?.detail || `Unable to get response from ${selectedModel}.`, {
          position: 'top-center',
          autoClose: 3000,
        });
      }
    } finally {
      setIsLoading(false);
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt(e);
    }
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant' && !isLoading) {
      const lastMessage = chatHistory[chatHistory.length - 1].content;
      let index = 0;
      setTypingText('');

      const typingInterval = setInterval(() => {
        if (index < lastMessage.length) {
          setTypingText((prev) => prev + lastMessage[index]);
          index++;
        } else {
          clearInterval(typingInterval);
          setTypingText('');
        }
      }, 2);

      return () => clearInterval(typingInterval);
    }
  }, [chatHistory, isLoading]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, typingText, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const minHeight = isMobile ? 24 : 24; // Adjusted to match Send button height
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), 120);
      textareaRef.current.style.height = `${newHeight}px`;
      textareaRef.current.style.overflowY = newHeight >= 120 ? 'auto' : 'hidden';
    }
  }, [prompt, isMobile]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        isModelMenuOpen &&
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        toggleButtonRef.current &&
        !toggleButtonRef.current.contains(event.target)
      ) {
        setIsModelMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isModelMenuOpen]);

  const markdownComponents = {
    p: ({ children }) => <div className="my-2 whitespace-pre-wrap text-[9px] md:text-[10px]">{children}</div>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-neon-blue hover:underline">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <table className="border-collapse border border-white/10 w-full my-2">{children}</table>
    ),
    th: ({ children }) => (
      <th className="border border-white/10 px-2 py-1 bg-gray-900/50 backdrop-blur-lg text-white text-[9px] md:text-[10px]">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border border-white/10 px-2 py-1 text-white text-[9px] md:text-[10px]">{children}</td>
    ),
    code: ({ inline, className, children, ...props }) => {
      const codeRef = useRef(null);
      const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;
      if (inline) {
        return (
          <code className={`${className || ''} bg-gray-900/80 p-0.5 rounded text-gray-200 backdrop-blur-lg text-[9px] md:text-[10px]`} {...props}>
            {children}
          </code>
        );
      }
      return (
        <div className="my-2 border border-white/10 rounded-lg overflow-hidden shadow-glow-neon">
          <div className="flex items-center justify-between bg-gray-900/95 px-2 py-1">
            <div className="flex items-center">
              <span className="text-gray-400 mr-1 text-[9px] md:text-[10px]">&lt;/&gt;</span>
              <span className="text-gray-400 text-[9px] md:text-[10px] font-medium">{getCodeTitle(prompt)}</span>
            </div>
            <motion.button
              onClick={() => copyToClipboard(codeRef, codeId)}
              className="text-gray-400 hover:text-neon-blue transition-colors duration-200"
              title="Copy code"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              {copiedStates[codeId] ? <CheckIcon className="h-3 w-3 md:h-4 w-4" /> : <ClipboardIcon className="h-3 w-3 md:h-4 w-4" />}
            </motion.button>
          </div>
          <pre className="bg-gray-900/95 p-2 overflow-x-auto whitespace-pre-wrap">
            <code ref={codeRef} className={`${className || ''} text-gray-200 text-[9px] md:text-[10px]`} {...props}>
              {children}
            </code>
          </pre>
        </div>
      );
    },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`font-inter w-full h-full mx-auto mt-0 md:mt-4 bg-galaxy backdrop-blur-lg shadow-glow-neon ${isMobile ? 'h-[calc(45vh)] min-h-[calc(45vh)]' : 'h-[calc(100vh)] min-h-[calc(95vh)]'} flex flex-col overflow-hidden`}
    >
      {/* Header */}
      <div className="p-2 bg-gray-900/50 border-b border-white/10 flex items-center shrink-0 rounded-t-lg">
        <span className="text-[9px] md:text-[10px] text-gray-500">
          Daily Points: {dailyInteractions}/{maxDailyInteractions}
          {totalDailyChats >= maxTotalDailyChats && ' (Limit)'}
        </span>
        <div className="flex-1 flex justify-center">
          <div className="relative" ref={toggleButtonRef}>
            <motion.button
              onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
              className="px-2 py-1 md:px-2 md:py-1 rounded-full border-2 border-gray-500 text-[9px] md:text-[10px] font-medium bg-gray-900/50 text-white backdrop-blur-md hover:shadow-glow-neon"
              whileHover={{ scale: 1 }}
              whileTap={{ scale: 0.95 }}
            >
              {selectedModel}
            </motion.button>
            {isModelMenuOpen && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute top-[calc(100%+0.25rem)] bg-gray-900/95 rounded-lg shadow-glow-neon p-2 z-20 backdrop-blur-lg border border-white/10 w-32"
                style={{
                  left: '-20%',
                  transform: 'translateX(-50%)',
                }}
              >
                {models.map((model) => (
                  <motion.button
                    key={model}
                    onClick={() => {
                      setSelectedModel(model);
                      setIsModelMenuOpen(false);
                    }}
                    className={`w-full text-center px-2 py-1 rounded-md text-[9px] md:text-[10px] transition-all duration-300 backdrop-blur-md ${selectedModel === model
                      ? 'bg-neon-blue/20 text-white border border-neon-blue/50'
                      : 'text-white'
                      }`}
                    whileHover={{ scale: 1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {model}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </div>
        </div>
        <motion.button
          onClick={() => setUseDeepSearch(!useDeepSearch)}
          className={`px-2 py-1 md:px-2 md:py-1 rounded-full text-[9px] md:text-[10px] font-medium transition-all duration-300 border border-white/20 backdrop-blur-md flex items-center ${useDeepSearch
            ? 'bg-white text-black border-neon-blue/50'
            : 'text-white hover:bg-gray-900/70 hover:shadow-glow-neon'
            }`}
          title="Toggle real-time web search"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <MagnifyingGlassIcon className="h-3 w-3 md:h-4 w-4 mr-1" />
          DeepSearch
        </motion.button>
      </div>

      {/* Chat Content */}
      <div
        className="flex-1 p-2 md:p-4 overflow-y-auto custom-scrollbar bg-gradient-to-b from-gray-900/50 to-gray-800/50 rounded-b-lg"
        ref={chatContainerRef}
        style={{ maxHeight: isMobile ? 'calc(100vh)' : 'calc(100vh - 10rem)' }}
      >
        {error && !error.includes('maximum of 50 daily chats') && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-[9px] md:text-[10px] mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center shadow-glow-neon-red"
          >
            {error}
          </motion.div>
        )}
        {chatHistory.length === 0 && !isLoading && (
          <div className="text-[9px] md:text-[10px] text-gray-400 text-center p-4">
            Start a conversation by entering a prompt below.
          </div>
        )}
        {chatHistory.map((message, index) => (
          <motion.div
            key={index}
            className={`mb-2 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div
              className={`max-w-[85%] md:max-w-[70%] p-3 rounded-lg text-[9px] md:text-[10px] overflow-y-auto custom-scrollbar group ${message.role === 'user'
                ? 'bg-neon-blue/20 text-white border border-neon-blue/50'
                : 'bg-gray-900/50 text-white backdrop-blur-lg border border-white/10'
                } relative`}
            >
              <span
                className={`absolute bottom-0 left-0 w-full h-0.5 origin-left transition-transform duration-300 ${message.role === 'user' ? 'group-hover:scale-x-100' : ''
                  }`}
              />
              {message.role === 'assistant' && index === chatHistory.length - 1 && typingText ? (
                <div className="max-h-[400px] md:max-h-[600px] overflow-y-auto custom-scrollbar">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={markdownComponents}
                  >
                    {typingText}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="max-h-[200px] md:max-h-[400px] overflow-y-auto custom-scrollbar">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={markdownComponents}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              )}
              {message.role === 'assistant' && (message.links?.length > 0 || message.content) && (
                <div className="mt-2 flex items-center justify-between overflow-y-auto custom-scrollbar flex-wrap">
                  <div className="flex items-center overflow-y-auto custom-scrollbar">
                    {message.links?.length > 0 && (
                      <>
                        <h5 className="text-[9px] md:text-[10px] font-bold text-white mr-1">Sources:</h5>
                        {message.links.map((link, idx) => (
                          <a
                            key={idx}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link}
                            className="inline-block mx-0.5"
                          >
                            <Image
                              src={getFaviconUrl(link)}
                              alt="Website favicon"
                              width={16}
                              height={16}
                              className="rounded-full border border-white/20"
                              onError={(e) => (e.target.src = '/favicon.ico')}
                            />
                          </a>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <div className="mb-2 flex justify-start">
            <div className="max-w-[85%] p-3 bg-gray-900/50 text-white text-[9px] md:text-[10px] rounded-xl flex items-center backdrop-blur-lg">
              <div className="flex items-center gap-2">
                <div className="relative w-6 h-6">
                  <div className="absolute inset-0 border-2 border-neon-blue/50 border-t-neon-blue rounded-full animate-spin"></div>
                  <Image
                    src="/logos/logo-scan.webp"
                    alt="Loading Logo"
                    width={24}
                    height={24}
                    className="absolute inset-0 w-4 h-4 m-1 object-contain animate-pulse"
                    onError={() => console.log(`Failed to load loading logo: /logos/logo-scan.webp`)}
                  />
                </div>
                <span>Loading...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Prompt */}
      <div className="p-2 md:p-4 border-t border-white/10 shrink-0 bg-gray-900/50 rounded-b-lg">
        <form onSubmit={handleSendPrompt} className="flex items-center gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your prompt..."
            className="flex-1 px-3 py-1 bg-gray-900/50 text-white rounded-lg text-[9px] md:text-[10px] placeholder:text-[9px] md:placeholder:text-[10px] placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-neon-blue/50 backdrop-blur-lg border border-white/10 resize-none overflow-y-auto custom-scrollbar"
            rows={1}
            disabled={isLoading || totalDailyChats >= maxTotalDailyChats}
            ref={textareaRef}
            style={{
              minHeight: '24px',
              maxHeight: '120px',
              lineHeight: '1.4',
              touchAction: 'manipulation',
              WebkitTextSizeAdjust: '100%',
            }}
          />
          <motion.button
            type="submit"
            className={`px-2 py-1 md:px-3 md:py-1 rounded-lg text-[9px] md:text-[10px] font-medium transition-all duration-300 border border-white/20 backdrop-blur-md flex items-center justify-center ${isLoading || totalDailyChats >= maxTotalDailyChats
              ? 'bg-gray-900/50 text-white/50 cursor-not-allowed opacity-50'
              : 'text-white hover:bg-gray-900/70 hover:shadow-glow-neon'
              }`}
            disabled={isLoading || totalDailyChats >= maxTotalDailyChats}
            whileHover={{ scale: isLoading || totalDailyChats >= maxTotalDailyChats ? 1 : 1.05 }}
            whileTap={{ scale: isLoading || totalDailyChats >= maxTotalDailyChats ? 1 : 0.95 }}
            style={{ minHeight: '24px' }}
          >
            {isLoading ? '...' : 'Send'}
          </motion.button>
        </form>
      </div>
      <ToastContainer position="top-center" autoClose={3000} />

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .shadow-glow-neon {
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.3), 0 0 16px rgba(255, 255, 255, 0.1);
        }
        .shadow-glow-neon-red {
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.3), 0 0 16px rgba(239, 68, 68, 0.1);
        }
        .shadow-glow-neon-blue {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.1);
        }
        .bg-tech {
          background: linear-gradient(145deg, #1a1a1a, #2a2a2a);
        }
        @media (max-width: 640px) {
          .flex-col {
            flex-direction: column;
          }
          .text-[10px] {
            font-size: 8px;
          }
          .text-[9px] {
            font-size: 7px;
          }
          .max-h-[400px] {
            max-height: 200px;
          }
          .w-2 {
            width: 12px;
          }
          .h-2 {
            height: 12px;
          }
          textarea.custom-scrollbar, .flex-1.custom-scrollbar {
            overflow-y: auto !important;
          }
        }
      `}</style>
    </motion.div>
  );
}