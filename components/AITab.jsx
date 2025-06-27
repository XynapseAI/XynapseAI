import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ClipboardIcon, MagnifyingGlassIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

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
          const response = await axios.get(`/api/daily-ai-interactions?uid=${session.user.id}&interactionType=chat`);
          if (response.data.success) {
            setDailyInteractions(Math.min(response.data.pointsCount, maxDailyInteractions));
            setTotalDailyChats(response.data.totalCount);
          }
        } catch (err) {
          console.error('Error fetching daily interactions:', err);
          setError('Failed to fetch daily interaction count.');
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
      console.log('reCAPTCHA token generated:', { action, token });
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
          setTimeout(() => {
            setCopiedStates((prev) => ({ ...prev, [id]: false }));
          }, 2000);
        });
      }
    } catch (err) {
      console.error('Error copying text:', err);
      setError('Failed to copy content.');
    }
  };

  const handleSendPrompt = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('Please enter a prompt.');
      return;
    }

    if (status !== 'authenticated') {
      setError('Please log in to interact with the AI.');
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

      const response = await axios.post(apiEndpoint, {
        prompt,
        deepSearch: useDeepSearch,
        tokenSymbol,
        recaptchaToken,
      });
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
              headers: { 'X-Recaptcha-Token': interactionRecaptchaToken },
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
      } else if (err.response?.status === 422 && err.response?.data?.error?.code === 'VALIDATION') {
        console.warn('Brave Search API validation error:', err.response.data);
        setError('Unable to fetch web information. Please try again.');
      } else if (err.response?.status === 400) {
        setError(err.response?.data?.errors?.map((e) => e.msg).join(', ') || 'Invalid request. Please check your input.');
      } else {
        setError(err.response?.data?.detail || `Unable to get response from ${selectedModel}.`);
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
      const minHeight = window.innerWidth < 768 ? 22 : 38; // 32px on mobile, 48px on PC
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), 200); // Max height 120px
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [prompt]);

  const [toggleButtonWidth, setToggleButtonWidth] = useState(0);

  useEffect(() => {
    if (toggleButtonRef.current) {
      const updateWidth = () => {
        setToggleButtonWidth(toggleButtonRef.current.offsetWidth);
      };
      updateWidth();
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
  }, []);

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
    return () => document.addEventListener('mousedown', handleClickOutside);
  }, [isModelMenuOpen]);

  const markdownComponents = {
    p: ({ children }) => <div className="my-2 whitespace-pre-wrap">{children}</div>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-neon-blue hover:underline">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <table className="border-collapse border border-white/20 w-full my-2">{children}</table>
    ),
    th: ({ children }) => (
      <th className="border border-white/20 px-2 py-1 bg-gray-700/50 backdrop-blur-sm text-white text-xs md:text-sm">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border border-white/20 px-2 py-1 text-white text-xs md:text-sm">{children}</td>
    ),
    code: ({ inline, className, children, ...props }) => {
      const codeRef = useRef(null);
      const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;
      if (inline) {
        return (
          <code className={`${className || ''} bg-gray-900/80 p-0.5 rounded text-gray-200 backdrop-blur-sm text-xs md:text-sm`} {...props}>
            {children}
          </code>
        );
      }
      return (
        <div className="my-2 border border-white/10 rounded-md overflow-hidden">
          <div className="flex items-center justify-between bg-gray-900/95 px-2 py-1">
            <div className="flex items-center">
              <span className="text-gray-600 mr-1 text-xs md:text-sm">&lt;/&gt;</span>
              <span className="text-gray-400 text-xs md:text-sm font-medium">{getCodeTitle(prompt)}</span>
            </div>
            <button
              onClick={() => copyToClipboard(codeRef, codeId)}
              className="text-gray-600 hover:text-blue-400 transition-colors duration-200"
              title="Copy code"
            >
              {copiedStates[codeId] ? <CheckIcon className="h-4 w-4 md:h-5 w-5" /> : <ClipboardIcon className="h-4 w-4 md:h-5 w-5" />}
            </button>
          </div>
          <pre className="bg-gray-900/95 p-2 overflow-x-auto whitespace-pre-wrap">
            <code ref={codeRef} className={`${className || ''} text-gray-200 text-xs md:text-sm`} {...props}>
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
      className={`font-jetbrains w-full max-w-screen-md md:max-w-full ${isMobile ? 'h-[calc(100vh-4rem)]' : 'h-[calc(100vh-2rem)]'} mx-auto p-1 md:p-4 rounded-xl shadow-card overflow-y-auto custom-scrollbar flex flex-col`}
    >
      {/* Header */}
      <div className="p-2 bg-tech border-b border-white/10 flex justify-between items-center shrink-0">
        <span className="text-[10px] md:text-xs text-gray-400">
          Daily Points: {dailyInteractions}/{maxDailyInteractions}
          {totalDailyChats >= maxTotalDailyChats && ' (Limit)'}
        </span>
        <div className="relative">
          <button
            ref={toggleButtonRef}
            onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
            className="px-2 py-1 md:px-2 md:py-1 rounded-lg text-[10px] md:text-[10px] font-medium transition-all duration-300 border border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/15 hover:shadow-glow-neon"
          >
            {selectedModel}
          </button>
          {isModelMenuOpen && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-[calc(100%+0.25rem)] bg-gray-800/95 rounded-lg shadow-lg p-2 z-20 backdrop-blur-md border border-white/20 w-32"
              style={{
                left: '-60%',
                transform: 'translateX(-50%)',
              }}
            >
              {models.map((model) => (
                <button
                  key={model}
                  onClick={() => {
                    setSelectedModel(model);
                    setIsModelMenuOpen(false);
                  }}
                  className={`w-full text-center px-1 py-1/2 rounded-xs text-[10px] md:text-xs transition-all duration-300 backdrop-blur-md ${selectedModel === model
                    ? 'bg-white text-black'
                    : 'text-white hover:bg-white/15 hover:shadow-glow-neon'
                    }`}
                >
                  {model}
                </button>
              ))}
            </motion.div>
          )}
        </div>
        <button
          onClick={() => setUseDeepSearch(!useDeepSearch)}
          className={`px-2 py-1 md:px-1 md:py-1/2 rounded-lg text-[10px] md:text-xs font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${useDeepSearch
            ? 'bg-white text-black'
            : ' text-white hover:shadow-glow-neon'
            } flex items-center`}
          title="Toggle real-time web search"
        >
          <MagnifyingGlassIcon className="h-3 w-3 md:h-4 w-4 mr-1" />
          DeepSearch
        </button>
      </div>

      {/* Chat Content */}
      <div
        className="flex-1 p-1 md:p-4 overflow-y-auto custom-scrollbar"
        ref={chatContainerRef}
        style={{ maxHeight: isMobile ? 'calc(100vh - 14rem)' : 'calc(100vh - 2rem)' }}
      >
        {error && !error.includes('maximum of 50 daily chats') && (
          <div className="text-xs md:text-xs text-red-500 mb-2 p-2 bg-red-900/20 rounded-md border border-red-500/50">
            {error}
          </div>
        )}
        {chatHistory.length === 0 && !isLoading && (
          <div className="text-[10px] md:text-xs text-gray-600 text-center">
            Start a conversation by entering a prompt below.
          </div>
        )}
        {chatHistory.map((message, index) => (
          <div
            key={index}
            className={`mb-2 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] md:max-w-[70%] px-3 md:px-3 rounded-lg text-[10px] md:text-xs overflow-y-auto custom-scrollbar ${message.role === 'user'
                ? 'bg-blue-500/20 text-white'
                : 'text-white backdrop-blur-md'
                } relative group`}
            >
              {message.role === 'assistant' && index === chatHistory.length - 1 && typingText ? (
                <div className="max-h-[200px] md:max-h-[400px] overflow-y-auto custom-scrollbar">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={markdownComponents}
                  >
                    {typingText}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="max-h-[200px] md:max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
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
                <div className="mt-1 flex items-center justify-between flex-wrap">
                  <div className="flex items-center">
                    {message.links?.length > 0 && (
                      <>
                        <h5 className="text-xs md:text-sm font-bold text-white mr-1">Refs:</h5>
                        {message.links.map((link, idx) => (
                          <a
                            key={idx}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link}
                            className="inline-block mx-0.5"
                          >
                            <img
                              src={getFaviconUrl(link)}
                              alt="Website favicon"
                              className="w-4 h-4 md:w-5 h-5 rounded-sm"
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
          </div>
        ))}
        {isLoading && (
          <div className="mb-2 flex justify-start">
            <div className="max-w-[85%] p-2 md:p-4 bg-gray-800/95 text-white text-xs md:text-sm rounded-lg flex items-center backdrop-blur-md">
              <div className="wave-loading mt-2">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Prompt */}
      <div className="p-2 md:p-4 border-t border-white/10 shrink-0">
        <form onSubmit={handleSendPrompt} className="flex items-center gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your prompt..."
            className="flex-1 px-2 py-1 md:px-3 md:py-2 bg-gray-900/95 text-white rounded-lg text-xs placeholder:text-xs placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-neon-blue/50 backdrop-blur-md border border-gray-400 resize-none whitespace-pre-wrap overflow-y-auto custom-scrollbar"
            rows={1}
            disabled={isLoading || totalDailyChats >= maxTotalDailyChats}
            ref={textareaRef}
            style={{
              minHeight: '24px',
              maxHeight: '120px',
              lineHeight: '1.4',
              touchAction: 'manipulation',
              WebkitTextSizeAdjust: '100%', // Prevent text size adjustment on mobile
            }}
          />
          <button
            type="submit"
            className={`px-2 py-1 md:px-3 md:py-2 rounded-lg text-[10px] md:text-xs font-medium transition-all duration-300 border border-gray-400 backdrop-blur-md flex items-center justify-center ${isLoading || totalDailyChats >= maxTotalDailyChats
                ? 'bg-gray-600 text-gray-200 cursor-not-allowed'
                : 'bg-white/10 text-white hover:bg-white/15 hover:shadow-glow-neon'
              }`}
            disabled={isLoading || totalDailyChats >= maxTotalDailyChats}
            style={{ minHeight: '20px' }}
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </form>
      </div>
      <ToastContainer position="top-center" autoClose={3000} />

      {/* Wave Loading Effect */}
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .wave-loading {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .dot {
          display: inline-block;
          width: 5px;
          height: 5px;
          background-color: #00bfff;
          border-radius: 50%;
          animation: wave 1s ease-in-out infinite;
        }
        .dot:nth-child(2) {
          animation-delay: 0.2s;
        }
        .dot:nth-child(3) {
          animation-delay: 0.4s;
        }
        @keyframes wave {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }
      `}</style>
    </motion.div>
  );
}