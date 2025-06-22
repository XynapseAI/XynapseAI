// components/AITab.jsx
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ClipboardIcon, MagnifyingGlassIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { ToastContainer, toast } from 'react-toastify'; // Add this
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
  const [totalDailyChats, setTotalDailyChats] = useState(0); // New state for total chats
  const chatContainerRef = useRef(null);
  const toggleButtonRef = useRef(null);
  const textareaRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  const models = ['Grok 3', 'GPT 4o', 'Gemini-2.5'];
  const maxDailyInteractions = 5; // Points awarded for first 5 interactions
  const maxTotalDailyChats = 50; // Total chat limit per day

  useEffect(() => {
    async function fetchDailyInteractions() {
      if (session?.user?.id) {
        try {
          const response = await axios.get(`/api/daily-ai-interactions?uid=${session.user.id}&interactionType=chat`);
          if (response.data.success) {
            setDailyInteractions(Math.min(response.data.pointsCount, maxDailyInteractions));
            setTotalDailyChats(response.data.totalCount); // Set total chat count
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
        autoClose: 5000,
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
          setTotalDailyChats((prev) => prev + 1); // Increment total chat count
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
      }, 5);

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
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [prompt]);

  const markdownComponents = {
    p: ({ children }) => <div className="my-4 whitespace-pre-wrap">{children}</div>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-neon-blue hover:underline">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <table className="border-collapse border border-white/20 w-full my-4">{children}</table>
    ),
    th: ({ children }) => (
      <th className="border border-white/20 px-4 py-2 bg-gray-700/50 backdrop-blur-sm text-white">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border border-white/20 px-4 py-2 text-white">{children}</td>
    ),
    code: ({ inline, className, children, ...props }) => {
      const codeRef = useRef(null);
      const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;
      if (inline) {
        return (
          <code className={`${className || ''} bg-gray-900/80 p-1 rounded text-gray-200 backdrop-blur-sm`} {...props}>
            {children}
          </code>
        );
      }
      return (
        <div className="my-4 border border-white/10 rounded-md overflow-hidden">
          <div className="flex items-center justify-between bg-gray-900/95 px-3 py-2">
            <div className="flex items-center">
              <span className="text-gray-600 mr-2">&lt;/&gt;</span>
              <span className="text-gray-400 text-sm font-medium">{getCodeTitle(prompt)}</span>
            </div>
            <button
              onClick={() => copyToClipboard(codeRef, codeId)}
              className="text-gray-600 hover:text-blue-400 transition-colors duration-200"
              title="Copy code"
            >
              {copiedStates[codeId] ? <CheckIcon className="h-5 w-5" /> : <ClipboardIcon className="h-5 w-5" />}
            </button>
          </div>
          <pre className="bg-gray-900/95 p-3 overflow-x-auto whitespace-pre-wrap">
            <code ref={codeRef} className={`${className || ''} text-gray-200 text-sm`} {...props}>
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
      className="font-plexmono w-[100%] h-[calc(100vh-6rem)] max-h-[calc(100vh-4rem)] sm:h-[calc(100vh-6rem)] max-w-10xl mx-auto p-2 sm:p-4 rounded-xl shadow-card overflow-y-auto overflow-x-hidden custom-scrollbar sm:mt-0 backdrop-blur-md flex flex-col"
    >
      {/* Header */}
      <div className="p-2 bg-tech border-b border-white/10 flex justify-between items-center relative shrink-0">
        <div className="w-1/3">
          <span className="text-sm text-gray-400">
            Daily Points: {dailyInteractions}/{maxDailyInteractions}
            {totalDailyChats >= maxTotalDailyChats && ' (Limit reached)'}
          </span>
        </div>
        <div className="w-1/3 flex justify-center">
          <button
            ref={toggleButtonRef}
            onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
            className="px-3 py-1 rounded-xl text-xs font-medium transition-all duration-300 border border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/15 hover:shadow-glow-neon"
          >
            {selectedModel}
          </button>
        </div>
        <div className="w-1/3 flex justify-end">
          <button
            onClick={() => setUseDeepSearch(!useDeepSearch)}
            className={`px-3 py-1 rounded-xl text-xs sm:text-xs font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${useDeepSearch
              ? 'bg-white text-black'
              : 'bg-white/10 text-white hover:bg-white/15 hover:shadow-glow-neon'
              }`}
            title="Toggle real-time web search"
          >
            <MagnifyingGlassIcon className="h-4 w-4 inline-block mr-1" />
            DeepSearch
          </button>
        </div>
        {isModelMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-12 bg-gray-800/95 rounded-xl shadow-card p-2 w-28 z-20 backdrop-blur-md border border-white/10 model-menu"
            style={{
              left: toggleButtonRef.current
                ? `${toggleButtonRef.current.getBoundingClientRect().left +
                toggleButtonRef.current.offsetWidth / 2 -
                (isMobile ? 70 : 108)}px`
                : '50_measure',
              transform: toggleButtonRef.current ? 'none' : 'translateX(-50%)',
              width: isMobile ? '7rem' : '7rem',
            }}
          >
            {models.map((model) => (
              <button
                key={model}
                onClick={() => {
                  setSelectedModel(model);
                  setIsModelMenuOpen(false);
                }}
                className={`w-full text-center px-3 py-1 rounded-lg text-xs transition-all duration-300 backdrop-blur-md ${selectedModel === model
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

      {/* Chat Content */}
      <div
        className="flex-1 p-3 overflow-y-auto custom-scrollbar"
        ref={chatContainerRef}
        style={{ maxHeight: 'calc(100vh - 12rem)' }}
      >
        {error && !error.includes('maximum of 50 daily chats') && (
          <div className="text-sm text-red-500 mb-3 p-3 bg-red-900/20 rounded-md border border-red-500/50">
            {error}
          </div>
        )}
        {chatHistory.length === 0 && !isLoading && (
          <div className="text-sm text-gray-600 text-center">
            Start a conversation by entering a prompt below.
          </div>
        )}
        {chatHistory.map((message, index) => (
          <div
            key={index}
            className={`mb-3 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] p-3 rounded-xl text-sm overflow-y-auto custom-scrollbar ${message.role === 'user'
                ? 'max-w-[40%] bg-blue-500/20 text-white'
                : 'max-w-[70%] text-white backdrop-blur-md'
                } relative group`}
            >
              {message.role === 'assistant' && index === chatHistory.length - 1 && typingText ? (
                <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={markdownComponents}
                  >
                    {typingText}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
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
                <div className="mt-2 flex items-center justify-between flex-wrap">
                  <div className="flex items-center">
                    {message.links?.length > 0 && (
                      <>
                        <h5 className="text-xs font-bold text-white mr-2">References:</h5>
                        {message.links.map((link, idx) => (
                          <a
                            key={idx}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link}
                            className="inline-block mx-1"
                          >
                            <img
                              src={getFaviconUrl(link)}
                              alt="Website favicon"
                              className="w-5 h-5 rounded-sm"
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
          <div className="mb-3 flex justify-start">
            <div className="max-w-[70%] p-4 bg-gray-800/95 text-white text-sm rounded-xl flex items-center backdrop-blur-md">
              <div className="wave-loading">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Prompt */}
      <div className="p-3 border-t border-white/10 shrink-0">
        <form onSubmit={handleSendPrompt} className="flex">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your prompt..."
            className="flex-1 px-4 py-2 bg-gray-900/95 text-white rounded-l-xl text-sm placeholder-gray-600 focus:outline-none focus:ring-2 backdrop-blur-md border border-green-400 resize-none whitespace-pre-wrap overflow-y-auto custom-scrollbar"
            rows={1}
            disabled={isLoading || totalDailyChats >= maxTotalDailyChats}
            ref={textareaRef}
            style={{ maxHeight: '15rem', minHeight: '2.5rem', lineHeight: '1.5' }}
          />
          <button
            type="submit"
            className={`px-4 py-2 rounded-r-xl text-sm font-medium transition-all duration-300 border border-green-400 backdrop-blur-md ${isLoading || totalDailyChats >= maxTotalDailyChats
              ? 'bg-gray-600 text-gray-200 cursor-not-allowed'
              : 'bg-white/10 text-white hover:bg-white/15 hover:shadow-glow-neon'
              }`}
            disabled={isLoading || totalDailyChats >= maxTotalDailyChats}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
      <ToastContainer position="top-center" autoClose={5000} />

      {/* Wave Loading Effect */}
      <style jsx>{`
        .model-menu {
          left: 50%;
          transform: translateX(-50%);
        }

        @media (max-width: 640px) {
          .model-menu {
            left: 50%;
            transform: translateX(-50%);
            width: 6rem;
          }
        }

        .wave-loading {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .dot {
          display: inline-block;
          width: 6px;
          height: 6px;
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
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }
      `}</style>
    </motion.div>
  );
}