import React, { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createPortal } from 'react-dom';
import 'highlight.js/styles/github-dark.css';
import { useMarketTabLogic } from './MarketTabLogic';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { formatDistanceToNow } from 'date-fns';
import { GECKOTERMINAL_CHAIN_MAPPING, CHAIN_ID_TO_NAME } from '../utils/constants';

// Custom logger
const logger = {
  log: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(message, data);
    }
  },
  error: (message, data) => {
    console.error(message, data);
  },
};

const formatPrice = (price) => {
  if (price == null || isNaN(price)) return 'N/A';
  let fractionDigits = 2;
  if (price < 0.0001) {
    fractionDigits = 6;
  } else if (price < 0.01) {
    fractionDigits = 4;
  }
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
};

const truncateAddress = (address, nameTags = {}, source) => {
  if (!address || address === 'None' || typeof address !== 'string') return { text: 'N/A', image: null };
  const normalizedAddress = address.toLowerCase();
  const nameTag = nameTags[normalizedAddress]?.nameTag;
  const image = nameTags[normalizedAddress]?.image || null;

  const isEvmAddress = address.match(/^0x[a-fA-F0-9]{40}$/);

  if (source === 'Blockchair') {
    const shortAddress = isEvmAddress
      ? `${address.slice(0, 6)}...${address.slice(-4)}`
      : `${address.slice(0, 6)}...${address.slice(-6)}`;
    return {
      text: nameTag ? `${nameTag} (${shortAddress})` : shortAddress,
      image,
    };
  }

  if (isEvmAddress) {
    return { text: nameTag || `${address.slice(0, 6)}...${address.slice(-4)}`, image };
  }

  return { text: nameTag || address, image };
};

const truncateHash = (hash, startLength = 6, endLength = 4) => {
  // Handle invalid inputs
  if (!hash || typeof hash !== 'string') {
    return { text: 'N/A' };
  }

  // Truncate to 0x1234...abcd format
  if (hash.length > 12) {
    return {
      text: `${hash.slice(0, startLength)}...${hash.slice(-endLength)}`,
    };
  }

  return { text: hash };
};

// Chain explorer mapping
const CHAIN_EXPLORER_MAP = {
  abstract: { baseUrl: 'https://explorer.abstractscan.io', supportsTx: true, supportsAddress: true },
  ancient8: { baseUrl: 'https://scan.ancient8.gg', supportsTx: true, supportsAddress: true },
  ape_chain: { baseUrl: 'https://explorer.apescan.io', supportsTx: true, supportsAddress: true },
  arbitrum: { baseUrl: 'https://arbiscan.io', supportsTx: true, supportsAddress: true },
  arbitrum_nova: { baseUrl: 'https://nova.arbiscan.io', supportsTx: true, supportsAddress: true },
  avalanche_c: { baseUrl: 'https://snowtrace.io', supportsTx: true, supportsAddress: true },
  avalanche_fuji: { baseUrl: 'https://testnet.snowtrace.io', supportsTx: true, supportsAddress: true },
  base: { baseUrl: 'https://basescan.org', supportsTx: true, supportsAddress: true },
  base_sepolia: { baseUrl: 'https://sepolia.basescan.org', supportsTx: true, supportsAddress: true },
  berachain: { baseUrl: 'https://berascan.io', supportsTx: true, supportsAddress: true },
  blast: { baseUrl: 'https://blastscan.io', supportsTx: true, supportsAddress: true },
  bnb: { baseUrl: 'https://bscscan.com', supportsTx: true, supportsAddress: true },
  bob: { baseUrl: 'https://explorer.gobob.xyz', supportsTx: true, supportsAddress: true },
  boba: { baseUrl: 'https://bobascan.com', supportsTx: true, supportsAddress: true },
  celo: { baseUrl: 'https://celoscan.io', supportsTx: true, supportsAddress: true },
  corn: { baseUrl: 'https://explorer.cornscan.io', supportsTx: true, supportsAddress: true },
  cyber: { baseUrl: 'https://cyberscan.co', supportsTx: true, supportsAddress: true },
  degen: { baseUrl: 'https://explorer.degen.tips', supportsTx: true, supportsAddress: true },
  ethereum: { baseUrl: 'https://etherscan.io', supportsTx: true, supportsAddress: true },
  fantom: { baseUrl: 'https://ftmscan.com', supportsTx: true, supportsAddress: true },
  flare: { baseUrl: 'https://flarescan.com', supportsTx: true, supportsAddress: true },
  gnosis: { baseUrl: 'https://gnosisscan.io', supportsTx: true, supportsAddress: true },
  ham: { baseUrl: 'https://explorer.hamchain.io', supportsTx: true, supportsAddress: true },
  hychain: { baseUrl: 'https://explorer.hychain.com', supportsTx: true, supportsAddress: true },
  ink: { baseUrl: 'https://explorer.inkchain.io', supportsTx: true, supportsAddress: true },
  kaia: { baseUrl: 'https://kaiascan.io', supportsTx: true, supportsAddress: true },
  linea: { baseUrl: 'https://lineascan.build', supportsTx: true, supportsAddress: true },
  lisk: { baseUrl: 'https://liskscan.com', supportsTx: true, supportsAddress: true },
  mantle: { baseUrl: 'https://mantlescan.xyz', supportsTx: true, supportsAddress: true },
  metis: { baseUrl: 'https://andromeda-explorer.metis.io', supportsTx: true, supportsAddress: true },
  mint: { baseUrl: 'https://explorer.mintchain.io', supportsTx: true, supportsAddress: true },
  mode: { baseUrl: 'https://modescan.io', supportsTx: true, supportsAddress: true },
  monad_testnet: { baseUrl: 'https://explorer.monad.xyz', supportsTx: true, supportsAddress: true },
  omni: { baseUrl: 'https://explorer.omni.network', supportsTx: true, supportsAddress: true },
  opbnb: { baseUrl: 'https://opbnbscan.com', supportsTx: true, supportsAddress: true },
  optimism: { baseUrl: 'https://optimistic.etherscan.io', supportsTx: true, supportsAddress: true },
  polygon: { baseUrl: 'https://polygonscan.com', supportsTx: true, supportsAddress: true },
  proof_of_play: { baseUrl: 'https://explorer.proofofplay.io', supportsTx: true, supportsAddress: true },
  rari: { baseUrl: 'https://rarichain.org', supportsTx: true, supportsAddress: true },
  redstone: { baseUrl: 'https://redstonescan.com', supportsTx: true, supportsAddress: true },
  scroll: { baseUrl: 'https://scrollscan.com', supportsTx: true, supportsAddress: true },
  sei: { baseUrl: 'https://seiscan.app', supportsTx: true, supportsAddress: true },
  sepolia: { baseUrl: 'https://sepolia.etherscan.io', supportsTx: true, supportsAddress: true },
  shape: { baseUrl: 'https://shapescan.xyz', supportsTx: true, supportsAddress: true },
  soneium: { baseUrl: 'https://explorer.soneium.org', supportsTx: true, supportsAddress: true },
  sonic: { baseUrl: 'https://sonicscan.io', supportsTx: true, supportsAddress: true },
  superseed: { baseUrl: 'https://superseedscan.io', supportsTx: true, supportsAddress: true },
  swellchain: { baseUrl: 'https://swellscan.io', supportsTx: true, supportsAddress: true },
  unichain: { baseUrl: 'https://unichain-sepolia.explorer.caldera.xyz', supportsTx: true, supportsAddress: true },
  wemix: { baseUrl: 'https://wemixscan.com', supportsTx: true, supportsAddress: true },
  world: { baseUrl: 'https://worldscan.io', supportsTx: true, supportsAddress: true },
  xai: { baseUrl: 'https://xaiscan.io', supportsTx: true, supportsAddress: true },
  zero_network: { baseUrl: 'https://zeroscan.io', supportsTx: true, supportsAddress: true },
  zkevm: { baseUrl: 'https://zkevm.polygonscan.com', supportsTx: true, supportsAddress: true },
  zksync: { baseUrl: 'https://explorer.zksync.io', supportsTx: true, supportsAddress: true },
  zora: { baseUrl: 'https://zora.superscan.network', supportsTx: true, supportsAddress: true },
};

const getExplorerUrls = (chain, hash, address) => {
  const explorer = CHAIN_EXPLORER_MAP[chain] || CHAIN_EXPLORER_MAP.ethereum;
  const txUrl = explorer.supportsTx ? `${explorer.baseUrl}/tx/${hash}` : '#';
  const addressUrl = explorer.supportsAddress ? `${explorer.baseUrl}/address/${address}` : '#';
  return { txUrl, addressUrl };
};

// Modal component
const Modal = ({ isOpen, onClose, title, content, links = [], isMobile }) => {
  if (!isOpen) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="fixed inset-0 flex items-center justify-center z-50 font-jetbrains"
      onClick={onClose}
    >
      <div
        className={`p-4 sm:p-6 rounded-2xl max-w-[90%] sm:max-w-4xl w-full relative my-4 border border-white/10 ${isMobile ? 'bg-gray-900' : 'backdrop-blur-md bg-gray-900/50 shadow-glow-neon'
          }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className={`absolute top-3 right-3 text-white text-lg font-bold rounded-full w-8 h-8 flex items-center justify-center hover:bg-white/10 transition-all duration-300 ${isMobile ? 'bg-gray-900 border border-white/20' : 'bg-gray-900/50 border border-white/20 backdrop-blur-md'
            }`}
          aria-label="Close modal"
        >
          ✕
        </button>
        <h4 className="text-sm font-bold text-white mb-4 uppercase tracking-wide">{title}</h4>
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
                  <table className="border-collapse border border-white/20 w-full table-auto mb-2">{children}</table>
                ),
                th: ({ children }) => (
                  <th className={`border border-white/20 px-4 py-2 text-white text-left mb-2 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-sm'
                    }`}>{children}</th>
                ),
                td: ({ children }) => (
                  <td className="border border-white/20 px-4 py-2 text-gray-200 mb-2">{children}</td>
                ),
                code: ({ className, children }) => (
                  <code className={`${className || ''} rounded text-white text-gray-400 p-1 mb-2 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/80 backdrop-blur-md'
                    }`}>
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
            <h5 className="text-sm font-bold text-white mb-2 uppercase tracking-wide">References:</h5>
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

// LoadingOverlay component
const LoadingOverlay = ({ loadingStates = {}, isMobile }) => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  const messages = [
    ...(loadingStates.loading ? ['Loading market data...'] : []),
    ...(loadingStates.isChartLoading ? ['Loading chart data...'] : []),
    ...(loadingStates.isLoadingOnChain ? ['Loading on-chain data...'] : []),
    ...(loadingStates.isAnalyzing ? ['Analyzing token...'] : []),
    ...(loadingStates.isPredicting ? ['Predicting price trend...'] : []),
  ].filter(Boolean);

  useEffect(() => {
    if (messages.length === 0) return;

    const interval = setInterval(() => {
      setCurrentMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [messages.length]);

  if (messages.length === 0) return null;

  return (
    <div className={`fixed inset-0 flex items-center justify-center z-50 ${isMobile ? 'bg-gray-900/70' : 'bg-gray-900/30 backdrop-blur-sm'
      }`}>
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-10 h-10">
          <div className={`absolute inset-0 border-2 rounded-full animate-spin ${isMobile ? 'border-gray-400 border-t-white' : 'border-neon-blue/50 border-t-white'
            }`}></div>
          <img
            src="/logos/logo-scan.png"
            alt="Loading Logo"
            className={`absolute inset-0 w-7 h-7 m-1.5 object-contain ${isMobile ? '' : 'animate-pulse'}`}
          />
        </div>
        <p className="text-[9px] md:text-[10px] text-gray-400 font-medium">
          {messages[currentMessageIndex] || 'Processing...'}
        </p>
      </div>
    </div>
  );
};

const WalletBalances = ({
  balances,
  walletAddress,
  isLoading,
  error,
  onClose,
  transactions,
  isLoadingTransactions,
  transactionsError,
  fetchTransactions,
  chains,
  setSelectedWallet,
  setWalletBalances,
  setTransactions,
  setWalletBalancesError,
  setTransactionsError,
  setWalletAddress,
  nameTags,
  isMobile,
}) => {
  const walletBalancesRef = useRef(null);
  const [activeTab, setActiveTab] = useState('portfolio');

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (walletBalancesRef.current && !walletBalancesRef.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (
      activeTab === 'activity' &&
      walletAddress &&
      !transactions &&
      !isLoadingTransactions &&
      !transactionsError
    ) {
      logger.log('Fetching transactions for wallet:', { walletAddress });
      fetchTransactions(walletAddress);
    }
    return () => {
      fetchTransactions.cancel && fetchTransactions.cancel();
    };
  }, [activeTab, transactions, isLoadingTransactions, transactionsError, fetchTransactions, walletAddress]);

  if (!walletAddress) return null;

  const getPlatformImage = (chainValue) => {
    // Map numeric chain ID to chain name
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    const chain = chains.find((c) => c.value === chainName);
    const imageUrl = chain?.image || '/fallback-image.png';
    logger.log('getPlatformImage:', { chainValue, chainName, imageUrl, found: !!chain });
    return imageUrl;
  };

  const getChainLabel = (chainValue) => {
    // Map numeric chain ID to chain name
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    return chains.find((c) => c.value === chainName)?.label || chainName;
  };

  const { text: displayWalletAddress, image: walletImage } = truncateAddress(walletAddress, nameTags);

  const formatNumber = (value, decimals = 6) => {
    if (value == null || isNaN(value)) return 'N/A';
    return Number(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  logger.log('WalletBalances rendering:', {
    walletAddress,
    balances: balances.slice(0, 5),
    isLoading,
    error,
    transactionsCount: transactions?.length || 0,
    activeTab,
    walletImage,
  });

  const overlayContent = (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed inset-0 flex items-center justify-center z-50 font-jetbrains min-h-screen"
    >
      <div
        ref={walletBalancesRef}
        className={`p-4 sm:p-6 max-w-6xl w-[90%] rounded-2xl relative max-h-[80vh] min-h-[80vh] overflow-hidden custom-scrollbar border border-white/10 ${isMobile ? 'bg-gray-900' : 'backdrop-blur-xl bg-gray-900/50 shadow-glow-neon'
          }`}
      >
        <div className="sticky top-0 z-10 p-2">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                />
              </svg>
              {walletImage && (
                <img
                  src={walletImage}
                  alt={`${displayWalletAddress} logo`}
                  className="w-5 h-5 rounded-full flex-shrink-0"
                  onError={(e) => {
                    logger.error('Wallet name tag image failed to load:', {
                      address: walletAddress,
                      src: walletImage,
                    });
                    e.target.src = '/icons/default.png';
                  }}
                />
              )}
              <span className="text-sm font-bold text-white tracking-tight">{displayWalletAddress}</span>
            </div>
            <motion.button
              onClick={onClose}
              className={`text-white text-lg font-bold rounded-full w-8 h-8 flex items-center justify-center hover:bg-white/10 transition-all duration-300 ${isMobile ? 'bg-gray-900 border border-white/20' : 'bg-gray-900/50 border border-white/20 backdrop-blur-md'
                }`}
              aria-label="Close balances"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              ✕
            </motion.button>
          </div>
          <div className="flex space-x-2 mb-3">
            <motion.button
              onClick={() => setActiveTab('portfolio')}
              className={`px-3 py-1 rounded-xl text-[10px] md:text-xs font-medium transition-all duration-300 border border-white/20 ${isMobile ? 'bg-gray-900' : 'backdrop-blur-md'
                } ${activeTab === 'portfolio' ? 'bg-white text-black' : 'bg-gray-900/50 text-white hover:bg-white/10'}`}
              whileHover={{ scale: 1 }}
            >
              Portfolio
            </motion.button>
            <motion.button
              onClick={() => setActiveTab('activity')}
              className={`px-3 py-1 rounded-xl text-[10px] md:text-xs font-medium transition-all duration-300 border border-white/20 ${isMobile ? 'bg-gray-900' : 'backdrop-blur-md'
                } ${activeTab === 'activity' ? 'bg-white text-black' : 'bg-gray-900/50 text-white hover:bg-white/10'}`}
              whileHover={{ scale: 1 }}
            >
              Activity
            </motion.button>
          </div>
        </div>
        <div className="overflow-y-auto max-h-[calc(80vh-100px)] rounded-lg custom-scrollbar">
          {activeTab === 'portfolio' && (
            <>
              {isLoading && <p className="text-[9px] md:text-[10px] text-gray-400 text-center">Loading portfolio...</p>}
              {error && <p className="text-sm text-red-500 text-center">Error: {error}</p>}
              {!isLoading && !error && balances?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed">
                    <thead
                      className={`sticky top-0 z-10 border-b border-white/10 uppercase ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-lg'
                        }`}
                    >
                      <tr>
                        <th className="px-2 py-1.5 text-white text-center text-[8px] md:text-xs w-[7%]">
                          <div className="flex items-center justify-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 fill-white flex-shrink-0"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                              />
                            </svg>
                            Chain
                          </div>
                        </th>
                        <th className="px-2 py-1.5 text-white text-left text-[8px] md:text-xs w-[16%]">
                          <div className="flex items-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 fill-white"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
                            </svg>
                            Token
                          </div>
                        </th>
                        <th className="px-2 py-1.5 text-white text-left text-[8px] md:text-xs w-[16%]">
                          <div className="flex items-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 fill-white"
                              viewBox="0 0 24 24"
                            >
                              <path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z" />
                            </svg>
                            Balance
                          </div>
                        </th>
                        <th className="px-2 py-1.5 text-white text-left text-[8px] md:text-xs w-[20%]">
                          <div className="flex items-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-7-7h14V7H5v4z"
                              />
                            </svg>
                            Value
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {balances.map((balance, index) => (
                        <tr
                          key={`${balance.chain}-${balance.address}-${index}`}
                          className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
                        >
                          <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                            <div className="flex flex-col items-center">
                              <img
                                src={getPlatformImage(balance.chain)}
                                alt={`${balance.chain} logo`}
                                className="w-2 h-2 md:w-5 md:h-5 rounded-full flex-shrink-0"
                                onError={(e) => {
                                  logger.error('Platform logo failed to load:', {
                                    chain: balance.chain,
                                    src: getPlatformImage(balance.chain),
                                  });
                                  e.target.src = '/fallback-image.png';
                                }}
                              />
                              <span className="text-[7px] md:text-[10px] text-gray-400 flex-shrink-0">
                                {getChainLabel(balance.chain)}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                            <div className="flex items-center space-x-2">
                              {balance.logo && (
                                <img
                                  src={balance.logo}
                                  alt={`${balance.symbol} logo`}
                                  className="w-3 h-3 md:w-4 md:h-4 rounded-full flex-shrink-0"
                                  onError={(e) => {
                                    logger.error('Token logo failed to load:', {
                                      symbol: balance.symbol,
                                      src: balance.logo,
                                    });
                                    e.target.src = '/fallback-image.png';
                                  }}
                                />
                              )}
                              <div className="flex flex-col items-start">
                                <span>
                                  {balance.symbol || 'Unknown'} {balance.address === 'native' ? '(Native)' : ''}
                                </span>
                                {balance.price_usd != null && (
                                  <span className="text-[6px] text-gray-400">
                                    ({formatPrice(balance.price_usd)})
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                            {balance.amount != null
                              ? balance.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })
                              : 'N/A'}
                          </td>
                          <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-sm">
                            {balance.value_usd != null
                              ? `$${balance.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                              : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !isLoading && <p className="text-[9px] md:text-xs text-gray-400 text-center">No balances found for this wallet.</p>
              )}
            </>
          )}
          {activeTab === 'activity' && (
            <>
              {isLoadingTransactions && (
                <p className="text-[10px] md:text-xs text-gray-400 text-center">Loading activity...</p>
              )}
              {transactionsError && <p className="text-[10px] md:text-sm text-red-500 text-center">Error: {transactionsError}</p>}
              {!isLoadingTransactions && !transactionsError && transactions && transactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed">
                    <thead
                      className={`sticky top-0 z-10 border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-lg'
                        }`}
                    >
                      <tr>
                        <th className={`px-2 py-1.5 text-white text-center text-[8px] md:text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
                          <div className="flex items-center justify-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 fill-white flex-shrink-0"
                              viewBox="0 0 24 24"
                            >
                              <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            Chain
                          </div>
                        </th>
                        <th className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[15%]' : 'w-[15%]'}`}>
                          <div className="flex items-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 fill-white"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
                            </svg>
                            Token
                          </div>
                        </th>
                        <th className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                              />
                            </svg>
                            Address
                          </div>
                        </th>
                        <th className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[15%]' : 'w-[15%]'}`}>
                          <div className="flex items-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-7-7h14V7H5v4z"
                              />
                            </svg>
                            Value
                          </div>
                        </th>
                        <th className={`px-2 py-1.5 text-white text-center text-[8px] md:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center justify-center gap-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3 h-3 md:w-4 md:h-4 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Time
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx, index) => {
                        const chainName = CHAIN_ID_TO_NAME[tx.chain] || tx.chain || 'ethereum';
                        const { txUrl, addressUrl } = getExplorerUrls(chainName, tx.hash, tx.type === 'receive' ? tx.from : tx.to);
                        const { text: displayAddress, image: addressImage } = truncateAddress(
                          tx.type === 'receive' ? tx.from : tx.to,
                          nameTags
                        );

                        return (
                          <tr
                            key={`${tx.chain}-${tx.hash}-${index}`}
                            className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
                          >
                            <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
                              <div className="flex flex-col items-center">
                                <img
                                  src={getPlatformImage(tx.chain)}
                                  alt={`${chainName} logo`}
                                  className={`rounded-full flex-shrink-0 object-contain ${isMobile ? 'w-2.5 h-2.5' : 'w-5 h-5'}`}
                                  onError={(e) => {
                                    logger.error('Transaction chain logo failed to load:', {
                                      chain: tx.chain,
                                      chainName,
                                      src: getPlatformImage(tx.chain),
                                    });
                                    e.target.src = '/fallback-image.png';
                                  }}
                                />
                                <span className="text-[6px] md:text-[10px] text-gray-400 flex-shrink-0">
                                  {getChainLabel(tx.chain)}
                                </span>
                              </div>
                            </td>
                            <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[15%]' : 'w-[15%]'}`}>
                              <div className="flex items-center space-x-2">
                                {tx.token_metadata?.logo && (
                                  <img
                                    src={tx.token_metadata.logo}
                                    alt={`${tx.token} logo`}
                                    className={`rounded-full flex-shrink-0 object-contain ${isMobile ? 'w-2.5 h-2.5' : 'w-4 h-4'}`}
                                    onError={(e) => {
                                      logger.error('Token logo failed to load:', {
                                        symbol: tx.token,
                                        src: tx.token_metadata.logo,
                                      });
                                      e.target.src = '/fallback-image.png';
                                    }}
                                  />
                                )}
                                <span>{tx.token || 'Unknown'}</span>
                              </div>
                            </td>
                            <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                              <div className="flex flex-col items-center space-y-1">
                                <span
                                  className={`inline-flex px-1 py-0.5 md:px-1.5 md:py-0.5 rounded-full text-[6px] md:text-[7px] font-medium flex-shrink-0 ${tx.type === 'receive' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'
                                    }`}
                                >
                                  {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                                </span>
                                <div className="flex items-center justify-center space-x-2">
                                  {addressImage && (
                                    <img
                                      src={addressImage}
                                      alt={`${displayAddress} logo`}
                                      className={`rounded-full flex-shrink-0 object-contain ${isMobile ? 'w-2 h-2' : 'w-4 h-4'}`}
                                      onError={(e) => {
                                        logger.error('Address name tag image failed to load:', {
                                          address: tx.type === 'receive' ? tx.from : tx.to,
                                          src: addressImage,
                                        });
                                        e.target.src = '/icons/default.png';
                                      }}
                                    />
                                  )}
                                  <a
                                    href={addressUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-neon-blue hover:underline"
                                    title={tx.type === 'receive' ? tx.from : tx.to}
                                    onClick={() => handleAddressClick(tx.type === 'receive' ? tx.from : tx.to)}
                                  >
                                    {displayAddress}
                                  </a>
                                </div>
                              </div>
                            </td>
                            <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[15%]' : 'w-[15%]'}`}>
                              {formatNumber(tx.value)}
                            </td>
                            <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs text-center ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                              <div className="flex flex-col items-center gap-0.5">
                                <a href={txUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                                  <img
                                    src="/logos/etherscan-logo.png"
                                    alt="Etherscan"
                                    className={`flex-shrink-0 object-contain ${isMobile ? 'w-2.5 h-2.5' : 'w-4 h-4'}`}
                                    onError={(e) => (e.target.src = '/fallback-image.png')}
                                  />
                                </a>
                                <span className="text-[6px] md:text-[9px] text-gray-400 text-center">
                                  {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                !isLoadingTransactions && (
                  <p className="text-[10px] md:text-xs text-gray-400 text-center">No activity found for this address.</p>
                )
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );

  return createPortal(overlayContent, document.body);
};

// CustomTooltip component (unchanged)
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-900/80 p-2 rounded border border-white/20 text-white text-sm backdrop-blur-md font-jetbrains">
        <p>{label}</p>
        <p>
          Price: <span className="font-bold">{formatPrice(payload[0].value)}</span>
        </p>
      </div>
    );
  }
  return null;
};

const MarketTab = ({ recaptchaRef }) => {
  const {
    tokens,
    loading,
    error,
    selectedToken,
    selectedPair,
    selectedChain,
    analysis,
    setAnalysis,
    analysisLinks,
    setAnalysisLinks,
    prediction,
    setPrediction,
    priceHistory,
    timeRange,
    searchQuery,
    searchResults,
    isDropdownOpen,
    isAnalyzing,
    isPredicting,
    onChainData,
    walletAddress,
    isLoadingOnChain,
    onChainError,
    selectedWallet,
    walletBalances,
    isLoadingWalletBalances,
    walletBalancesError,
    transactions,
    isLoadingTransactions,
    transactionsError,
    tickerData,
    isLoadingTickers,
    tickerError,
    dailyMarketInteractions,
    setDailyMarketInteractions,
    setSearchQuery,
    setIsDropdownOpen,
    setSelectedChain,
    setTimeRange,
    setWalletAddress,
    debouncedHandleTokenSelect,
    debouncedHandleAnalysis,
    debouncedHandlePrediction,
    handleWalletSearch,
    fetchTransactions,
    handleAddressClick,
    getAvailableChains,
    chains,
    setSelectedWallet,
    setWalletBalances,
    setTransactions,
    setWalletBalancesError,
    setTransactionsError,
    fetchPublicTreasuryData,
    fetchTickerData,
    fetchPriceHistory,
    nameTags,
    isLoadingNameTags,
    dexData,
    isLoadingDex,
    dexError,
    fetchDexData,
    dexRequestCount,
    lastDexRequestTime,
    getDefaultChainAndAddress,
    lastDexFetchTime,
    NON_EVM_CHAINS,
  } = useMarketTabLogic({ recaptchaRef, toast });

  const dropdownRef = useRef(null);
  const chainDropdownRef = useRef(null);
  const searchInputRef = useRef(null);
  const prevTradesRef = useRef([]);
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [activeMarketTab, setActiveMarketTab] = useState('cex');
  const [showTrades, setShowTrades] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedPool, setSelectedPool] = useState(null);

  const getPlatformImage = (chainValue) => {
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    const chain = chains.find((c) => c.value === chainName);
    const imageUrl = chain?.image || '/fallback-image.png';
    logger.log('getPlatformImage:', { chainValue, chainName, imageUrl, found: !!chain });
    return imageUrl;
  };



  const handleDexTabClick = () => {
    if (dexRequestCount >= 5 && Date.now() - lastDexRequestTime < 60 * 1000) {
      toast.error('Too many DEX requests. Please wait a minute and try again.', {
        position: 'top-center',
        autoClose: 5000,
      });
      return;
    }
    setActiveMarketTab('dex');
    setShowTrades(false);
    if (selectedToken) {
      const { chain, tokenAddress } = getDefaultChainAndAddress(selectedToken, selectedChain);
      if (chain && tokenAddress) {
        fetchDexData(chain, tokenAddress);
      }
    }
  };

  // Define handlePoolClick
  const handlePoolClick = (poolAddress) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('handlePoolClick called with poolAddress:', poolAddress);
      console.log('dexData.pools:', dexData.pools);
      console.log('dexData.poolTokens:', dexData.poolTokens);
    }
    const pool = dexData.pools.find((p) => p.attributes.address === poolAddress);
    if (pool) {
      setSelectedPool({
        address: poolAddress,
        tokens: dexData.poolTokens[poolAddress] || {},
        name: pool.attributes.name,
      });
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.log('Pool not found for address:', poolAddress);
      }
      toast.error('Pool data not available.', { position: 'top-center', autoClose: 3000 });
    }
  };

  // Modal content for pool details
  const renderPoolModalContent = () => {
    if (!selectedPool || !selectedPool.tokens) {
      return (
        <p className="text-xs text-gray-200 text-center">No pool data available.</p>
      );
    }

    const tokens = Object.values(selectedPool.tokens);
    if (tokens.length < 2) {
      return (
        <p className="text-xs text-gray-200 text-center">Insufficient token data for this pool.</p>
      );
    }

    const [token1, token2] = tokens;

    return (
      <div className="text-xs text-gray-200">
        <h4 className="text-xl font-bold text-white mb-4 text-center">
          {token1.symbol}/{token2.symbol}
        </h4>
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h5 className="text-lg font-bold text-white mb-2 flex items-center justify-center gap-2">
              <img
                src={token1.image_url}
                alt={`${token1.symbol} logo`}
                className="w-6 h-6 rounded-full"
                onError={(e) => (e.target.src = '/fallback-image.png')}
              />
              {token1.symbol}
            </h5>
            <ul className="list-none text-center">
              <li className="p-4">
                <strong>Transaction Score</strong>: <span className="text-green-500">{token1.transaction_score || 'N/A'}</span>
              </li>
              <li>
                <strong className="font-bold uppercase">Holders</strong>
                <ul className="list-none">
                  <li>Total Count: {token1.holders?.count?.toLocaleString() || 'N/A'}</li>
                  <li>Top 10 Holders: {token1.holders?.distribution_percentage?.top_10 || 'N/A'}%</li>
                  <li>11-30 Holders: {token1.holders?.distribution_percentage?.['11_30'] || 'N/A'}%</li>
                  <li>31-50 Holders: {token1.holders?.distribution_percentage?.['31_50'] || 'N/A'}%</li>
                  <li>Rest: {token1.holders?.distribution_percentage?.rest || 'N/A'}%</li>
                  <li className="text-gray-500 text-[10px] p-2">
                    Last Updated:{' '}
                    {token1.holders?.last_updated
                      ? new Date(token1.holders.last_updated).toLocaleString('en-US')
                      : 'N/A'}
                  </li>
                </ul>
              </li>
            </ul>
          </div>
          <div className="flex-1 min-w-0">
            <h5 className="text-lg font-bold text-white mb-2 flex items-center justify-center gap-2">
              <img
                src={token2.image_url}
                alt={`${token2.symbol} logo`}
                className="w-6 h-6 rounded-full"
                onError={(e) => (e.target.src = '/fallback-image.png')}
              />
              {token2.symbol}
            </h5>
            <ul className="list-none text-center">
              <li className="p-4">
                <strong>Transaction Score</strong>: <span className="text-green-500">{token2.transaction_score || 'N/A'}</span>
              </li>
              <li>
                <strong className="font-bold uppercase m-2">Holders</strong>
                <ul className="list-none">
                  <li>Total Count: {token2.holders?.count?.toLocaleString() || 'N/A'}</li>
                  <li>Top 10 Holders: {token2.holders?.distribution_percentage?.top_10 || 'N/A'}%</li>
                  <li>11-30 Holders: {token2.holders?.distribution_percentage?.['11_30'] || 'N/A'}%</li>
                  <li>31-50 Holders: {token2.holders?.distribution_percentage?.['31_50'] || 'N/A'}%</li>
                  <li>Rest: {token2.holders?.distribution_percentage?.rest || 'N/A'}%</li>
                  <li className="text-gray-500 text-[10px] p-2">
                    Last Updated:{' '}
                    {token2.holders?.last_updated
                      ? new Date(token2.holders.last_updated).toLocaleString('en-US')
                      : 'N/A'}
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.addEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    prevTradesRef.current = dexData.trades;
  }, [dexData.trades]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        (!searchInputRef.current || !searchInputRef.current.contains(event.target))
      ) {
        setIsDropdownOpen(false);
      }
      if (chainDropdownRef.current && !chainDropdownRef.current.contains(event.target)) {
        setIsChainDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setIsDropdownOpen]);

  useEffect(() => {
    if (selectedToken && timeRange) {
      logger.log('Fetching price history:', { tokenId: selectedToken.id, days: timeRange });
      setIsChartLoading(true);
      const { chain } = getAvailableChains().find((c) => c.value === selectedChain) || {};
      const tokenId = chain && selectedToken.detail_platforms[chains.find((c) => c.value === chain)?.coingeckoId]?.contract_address
        ? `${chains.find((c) => c.value === chain)?.coingeckoId}/${selectedToken.detail_platforms[chains.find((c) => c.value === chain)?.coingeckoId].contract_address}`
        : selectedToken.id;
      fetchPriceHistory(tokenId, timeRange, (err, data) => {
        if (err) {
          logger.error('Price history fetch failed:', { error: err.message });
        } else {
          logger.log('Price history fetch completed:', { tokenId: selectedToken.id, count: data?.length || 0 });
        }
        setIsChartLoading(false);
      });
    }
  }, [selectedToken, timeRange, selectedChain, fetchPriceHistory, getAvailableChains, chains]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`font-jetbrains w-full max-w-9xl mx-auto mt-4 p-3 md:p-4 h-[calc(100vh)] overflow-hidden ${isMobile ? 'bg-gray-900' : 'bg-gray-900/20 backdrop-blur-xl border border-white/10 shadow-neon'
        }`}
    >
      {/* Header Section */}
      <div className="flex items-center justify-between mb-3 md:mb-2 mt-2 md:mt-2 pb-1">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs md:text-sm font-bold text-white uppercase tracking-wide">Crypto</h2>
          <span className="text-gray-400">|</span>
          <button
            className="text-xs md:text-sm font-bold text-gray-400 uppercase cursor-not-allowed flex items-center gap-1 transition-colors duration-300"
            disabled
            aria-label="Stock tab (coming soon)"
          >
            Stock <span className="text-[10px] md:text-xs text-gray-500">(Soon)</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={chainDropdownRef}>
            <button
              onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
              className={`text-white px-2 py-1 text-xs flex items-center gap-1.5 border border-white/10 hover:bg-white/10 transition-all duration-300 rounded-none ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                } ${['bitcoin', 'ethereum'].includes(selectedToken?.id.toLowerCase())
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
                }`}
              disabled={['bitcoin', 'ethereum'].includes(selectedToken?.id.toLowerCase()) || !selectedToken}
              aria-label="Select chain"
            >
              {selectedChain ? (
                <>
                  <img
                    src={getPlatformImage(selectedChain)}
                    alt={`${chains.find((c) => c.value === selectedChain)?.label || 'Chain'} logo`}
                    className="w-4 h-4 rounded-full"
                    onError={(e) => {
                      logger.error('Chain logo failed to load:', {
                        chain: selectedChain,
                        src: getPlatformImage(selectedChain),
                      });
                      e.target.src = '/fallback-image.png';
                    }}
                  />
                  <span className="text-xs font-medium">
                    {chains.find((c) => c.value === selectedChain)?.label || 'Chain'}
                  </span>
                </>
              ) : (
                <div className="w-4 h-4 bg-gray-600 rounded-full"></div>
              )}
              <span className="text-xs">{isChainDropdownOpen ? '▲' : '▼'}</span>
            </button>
            {isChainDropdownOpen && (
              <div
                className={`absolute z-50 mt-1 w-40 max-h-64 overflow-y-auto custom-scrollbar border border-white/10 rounded-none ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                  }`}
              >
                {getAvailableChains().length === 0 ? (
                  <div className="px-3 py-1.5 text-gray-400 text-xs">No supported chains available</div>
                ) : (
                  getAvailableChains()
                    .filter((chain) => process.env.NODE_ENV === 'development' || !chain.testnet)
                    .map((chain) => (
                      <button
                        key={chain.value}
                        onClick={() => {
                          setSelectedChain(chain.value);
                          setIsChainDropdownOpen(false);
                        }}
                        className="flex items-center w-full text-left px-3 py-1.5 hover:bg-white/10 text-white text-xs font-medium transition-all duration-200 rounded-none"
                      >
                        <img
                          src={chain.image}
                          alt={`${chain.label} logo`}
                          className="w-4 h-4 rounded-full mr-2"
                          onError={(e) => {
                            logger.error('Dropdown chain logo failed to load:', {
                              chain: chain.value,
                              src: chain.image,
                            });
                            e.target.src = '/fallback-image.png';
                          }}
                        />
                        {chain.label}
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="Search wallet (0x...)"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className={`text-white px-3 py-1 text-xs w-36 md:w-60 border border-white/10 focus:outline-none focus:ring-2 focus:ring-neon-blue/50 transition-all duration-300 pr-8 rounded-none ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                }`}
              aria-label="Wallet address"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
                  handleWalletSearch();
                }
              }}
            />
            <button
              onClick={() => {
                if (walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
                  handleWalletSearch();
                }
              }}
              className="absolute right-1.5 text-white p-1 hover:bg-white/10 transition-all duration-300"
              aria-label="Search wallet"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <LoadingOverlay
        loadingStates={{
          loading,
          isLoadingDex,
          isChartLoading,
          isLoadingOnChain,
          isAnalyzing,
          isPredicting,
        }}
        isMobile={isMobile}
      />

      {error && (
        <p className="text-xs text-red-500 text-center p-3 bg-red-500/10 border border-red-500/30 mb-3 rounded-none">
          Error: {error}
        </p>
      )}

      {!loading && !error && tokens.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-[calc(100%-4rem)]">
          {/* Right Section: Token Info and Chart */}
          <div
            className={`flex flex-col gap-3 h-full overflow-y-auto custom-scrollbar ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md shadow-neon'
              }`}
          >
            {/* Token Info */}
            <div
              className={`border border-white/10 p-3 rounded-none min-h-[200px] max-h-[40vh] overflow-y-auto custom-scrollbar ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md shadow-neon'
                }`}
            >
              {selectedToken ? (
                <div className="relative">
                  <div className="absolute top-1 right-1 w-40" ref={dropdownRef}>
                    <button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className={`text-white px-2 py-1 text-xs flex items-center w-full border border-white/10 hover:bg-white/10 transition-all duration-300 rounded-none ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                        }`}
                      aria-label="Select token"
                    >
                      {selectedToken ? (
                        <>
                          <img
                            src={selectedToken.image}
                            alt={`${selectedToken.symbol} logo`}
                            className="w-4 h-4 rounded-full mr-1.5"
                            onError={(e) => (e.target.src = '/fallback-image.png')}
                          />
                          {selectedToken.symbol?.toUpperCase() || 'Token'}/USD
                        </>
                      ) : (
                        'Select Token'
                      )}
                      <span className="ml-auto text-xs">{isDropdownOpen ? '▲' : '▼'}</span>
                    </button>
                    {isDropdownOpen && (
                      <div
                        className={`absolute bg-black mt-1 w-full max-h-48 overflow-y-auto custom-scrollbar border border-white/10 rounded-none ${isMobile ? '' : 'backdrop-blur-md'
                          }`}
                      >
                        <input
                          type="text"
                          placeholder="Search token (e.g, BTC)"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          ref={searchInputRef}
                          className={`text-white px-2 py-1 w-full text-xs border-b border-white/10 focus:outline-none rounded-none ${isMobile ? 'bg-black' : 'bg-black backdrop-blur-md'
                            }`}
                        />
                        <div className="p-1">
                          {(searchQuery ? searchResults : tokens.slice(0, 30)).map((token) => (
                            <button
                              key={token.id}
                              onClick={() => debouncedHandleTokenSelect(token)}
                              className="flex items-center w-full text-left px-2 py-1 hover:bg-white/10 text-white text-xs transition-all duration-200 rounded-none"
                            >
                              {token.image && (
                                <img
                                  src={token.image}
                                  alt={`${token.symbol} logo`}
                                  className="w-4 h-4 rounded-full mr-1.5"
                                  onError={(e) => (e.target.src = '/fallback-image.png')}
                                />
                              )}
                              {token.name} ({token.symbol?.toUpperCase() || 'Token'})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mb-3">
                    <div className="flex items-center gap-2">
                      {selectedToken.image && (
                        <motion.img
                          src={selectedToken.image}
                          alt={`${selectedToken.symbol} logo`}
                          className="w-6 h-6 rounded-full"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.3 }}
                        />
                      )}
                      <div>
                        <h4 className="text-base font-bold text-white tracking-tight">
                          {selectedToken.name} ({selectedToken.symbol?.toUpperCase() || 'Token'})
                        </h4>
                        {selectedToken.market_cap_rank && (
                          <span className="text-xs text-gray-400">Rank #{selectedToken.market_cap_rank}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <p className="text-base font-bold text-white">{formatPrice(selectedToken.current_price)}</p>
                        <span
                          className={`text-xs font-medium ${selectedToken.price_change_percentage_24h >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}
                        >
                          {selectedToken.price_change_percentage_24h != null
                            ? `${selectedToken.price_change_percentage_24h.toFixed(2)}% (24h)`
                            : 'N/A'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:gap-3 text-xs text-gray-200">
                      <p className="text-gray-400">
                        24h High: <span className="text-green-500 font-bold">{formatPrice(selectedToken.high_24h)}</span>
                      </p>
                      <p className="text-gray-400">
                        24h Low: <span className="text-red-500 font-bold">{formatPrice(selectedToken.low_24h)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <h5 className="text-xs font-bold text-white uppercase mb-1.5 tracking-wide bg-gradient-to-r from-neon-blue/20 to-transparent">
                        Market Stats
                      </h5>
                      <div className="grid grid-cols-1 gap-1.5 text-xs">
                        <p className="text-gray-400">
                          Market Cap:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.market_cap != null
                              ? `$${selectedToken.market_cap.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-400">
                          Fully Diluted Valuation:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.fully_diluted_valuation != null
                              ? `$${selectedToken.fully_diluted_valuation.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-400">
                          24h Volume:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.total_volume != null
                              ? `$${selectedToken.total_volume.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-white uppercase mb-1.5 tracking-wide bg-gradient-to-r from-neon-blue/20 to-transparent">
                        Supply Stats
                      </h5>
                      <div className="grid grid-cols-1 gap-1.5 text-xs">
                        <p className="text-gray-400">
                          Circulating Supply:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.circulating_supply != null
                              ? `${selectedToken.circulating_supply.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-400">
                          Total Supply:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.total_supply != null
                              ? `${selectedToken.total_supply.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-400">
                          Max Supply:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.max_supply != null
                              ? `${selectedToken.max_supply.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-white uppercase mb-1.5 tracking-wide bg-gradient-to-r from-neon-blue/20 to-transparent">
                        All-Time Stats
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                        <p className="text-gray-400">
                          ATH:{' '}
                          <span
                            className={
                              typeof selectedToken.ath === 'number'
                                ? selectedToken.ath_change_percentage >= 0
                                  ? 'text-red-500'
                                  : 'text-green-500'
                                : 'text-white'
                            }
                          >
                            {typeof selectedToken.ath === 'number'
                              ? `$${selectedToken.ath.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-400">
                          ATL:{' '}
                          <span
                            className={
                              typeof selectedToken.atl === 'number'
                                ? selectedToken.atl_change_percentage >= 0
                                  ? 'text-red-500'
                                  : 'text-green-500'
                                : 'text-white'
                            }
                          >
                            {typeof selectedToken.atl === 'number'
                              ? `$${selectedToken.atl.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center flex-1">Please select a token to view details.</p>
              )}
            </div>

            {/* Chart */}
            <div
              className={`border border-white/10 p-3 rounded-none flex-1 min-h-[300px] max-h-[60vh] ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md shadow-neon'
                }`}
            >
              <div className="flex justify-between items-center mb-3">
                <div className="flex space-x-1.5">
                  <motion.button
                    onClick={debouncedHandleAnalysis}
                    className={`px-3 py-1 text-xs font-medium transition-all duration-300 border border-white/10 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${selectedToken && dailyMarketInteractions < 5
                        ? 'text-white hover:bg-white/10'
                        : 'text-gray-400 cursor-not-allowed opacity-50'
                      }`}
                    disabled={!selectedToken || dailyMarketInteractions >= 5}
                    aria-label="Analyze token"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Analyze
                  </motion.button>
                  <motion.button
                    onClick={debouncedHandlePrediction}
                    className={`px-3 py-1 text-xs font-medium transition-all duration-300 border border-neon-blue/50 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${selectedToken && dailyMarketInteractions < 5
                        ? 'text-neon-blue hover:bg-neon-blue/10'
                        : 'text-gray-400 cursor-not-allowed opacity-50'
                      }`}
                    disabled={!selectedToken || dailyMarketInteractions >= 5}
                    aria-label="Predict token price"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Predict
                  </motion.button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {['12H', '1D', '7D', '1M', '3M', '1Y'].map((range, idx) => (
                    <motion.button
                      key={range}
                      onClick={() => setTimeRange(['0.5', '1', '7', '30', '90', '365'][idx])}
                      className={`px-1.5 py-0.5 text-[10px] transition-all duration-300 border border-white/10 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${timeRange === ['0.5', '1', '7', '30', '90', '365'][idx]
                          ? 'bg-white text-black'
                          : 'text-white hover:bg-white/10'
                        }`}
                      aria-label={`Select ${range} time range`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {range}
                    </motion.button>
                  ))}
                </div>
              </div>
              {isChartLoading ? (
                <p className="text-xs text-gray-400 text-center flex-1">Loading chart data...</p>
              ) : priceHistory && priceHistory.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={priceHistory} margin={{ top: 10, right: 20, bottom: -20, left: 0 }}>
                      <CartesianGrid stroke="#404040" strokeDasharray="4 4" opacity={0.3} />
                      <XAxis
                        dataKey="title"
                        stroke="#FFFFFF"
                        tick={{ fontSize: 8, fill: '#FFFFFF' }}
                        angle={-45}
                        textAnchor="end"
                        height={70}
                        interval={timeRange === '0.5' ? Math.floor(priceHistory.length / 12) : timeRange === '1' ? 0 : 'preserveStartEnd'}
                      />
                      <YAxis
                        stroke="#FFFFFF"
                        tick={{ fontSize: 8, fill: '#FFFFFF' }}
                        domain={[(dataMin) => dataMin * 0.99, (dataMax) => dataMax * 1.01]}
                        width={60}
                        tickFormatter={(value) => {
                          const minPrice = Math.min(...priceHistory.map((item) => item.price).filter((p) => p > 0));
                          let fractionDigits = 2;
                          if (minPrice < 0.0001) {
                            fractionDigits = 6;
                          } else if (minPrice < 0.01) {
                            fractionDigits = 4;
                          }
                          return `$${value.toLocaleString('en-US', {
                            minimumFractionDigits: fractionDigits,
                            maximumFractionDigits: fractionDigits,
                          })}`;
                        }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#00BFFF"
                        fill="url(#neonGradient)"
                        strokeWidth={2}
                        isAnimationActive={true}
                        animationDuration={1000}
                      />
                      {priceHistory.length > 0 && (
                        <ReferenceDot
                          x={priceHistory[priceHistory.length - 1].title}
                          y={priceHistory[priceHistory.length - 1].price}
                          r={5}
                          fill="#00BFFF"
                          stroke="#FFFFFF"
                          strokeWidth={2}
                          className="animate-pulse"
                        />
                      )}
                      <defs>
                        <linearGradient id="neonGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00BFFF" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#00BFFF" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center flex-1">
                  {selectedToken ? 'No price data available for this token.' : 'Please select a token to view the chart.'}
                </p>
              )}
              <div className="absolute top-1 right-1 flex items-center group">
                <img src="/logos/CG.png" alt="CG Logo" className="w-4 h-4 object-contain" />
                <span
                  className="absolute right-10 text-[10px] text-gray-200 opacity-0 translate-x-2 group-hover:opacity-100 group-hover:-translate-x-0 transition-all duration-300 whitespace-nowrap flex items-center"
                >
                  Data powered by
                  <img src="/logos/CG_1.png" alt="CG_1 Logo" className="w-12 h-12 object-contain ml-1" />
                </span>
              </div>
            </div>
          </div>
          {/* Left Section: Top Holders, CEX, DEX */}
          <div
            className={`flex flex-col border border-white/10 rounded-none overflow-y-auto custom-scrollbar ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md shadow-neon'
              }`}
          >
            {selectedToken ? (
              <>
                <div
                  className={`flex w-full border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                    }`}
                >
                  <motion.button
                    onClick={() => {
                      setActiveMarketTab('holders');
                      setShowTrades(false);
                    }}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 border-r border-white/10 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${activeMarketTab === 'holders'
                        ? 'bg-white text-black shadow-neon'
                        : 'text-white hover:bg-white/10 hover:shadow-neon'
                      }`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Top Holders
                  </motion.button>
                  <motion.button
                    onClick={() => {
                      setActiveMarketTab('cex');
                      setShowTrades(false);
                    }}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 border-r border-white/10 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${activeMarketTab === 'cex'
                        ? 'bg-white text-black shadow-neon'
                        : 'text-white hover:bg-white/10 hover:shadow-neon'
                      }`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    CEX
                  </motion.button>
                  <motion.button
                    onClick={handleDexTabClick}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${activeMarketTab === 'dex'
                        ? 'bg-white text-black shadow-neon'
                        : 'text-white hover:bg-white/10 hover:shadow-neon'
                      }`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    DEX
                  </motion.button>
                </div>
                {activeMarketTab === 'dex' && (
                  <div className="flex justify-end p-2 text-xs text-gray-400">
                    <span className="flex flex-col items-end">
                      <span>Last Updated</span>
                      <span>
                        {lastDexFetchTime
                          ? new Date(lastDexFetchTime).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                          : 'N/A'}
                      </span>
                    </span>
                  </div>
                )}

                {/* Top Holders Tab */}
                {activeMarketTab === 'holders' && (
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div
                      className={`flex justify-center items-center p-2 border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                        }`}
                    >
                      <h4 className="text-xs font-bold text-white text-center uppercase tracking-wide flex items-center gap-2">
                        Top 100
                        {selectedToken.image && (
                          <img
                            src={selectedToken.image}
                            alt={`${selectedToken.symbol} logo`}
                            className="w-4 h-4 rounded-full"
                            onError={(e) => {
                              logger.error('Token logo failed to load:', {
                                symbol: selectedToken.symbol,
                                src: selectedToken.image,
                              });
                              e.target.src = '/icons/default.png';
                            }}
                          />
                        )}
                        {selectedToken.symbol?.toUpperCase()} Holders
                      </h4>
                    </div>
                    {onChainData.topHolders && onChainData.topHolders.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead
                          className={`sticky top-0 z-10 border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                            }`}
                        >
                          <tr>
                            <th className="px-2 py-2 text-white text-left font-medium min-w-[200px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                                  />
                                </svg>
                                Address/Name
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 fill-white"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z"
                                  />
                                </svg>
                                Balance
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {onChainData.topHolders.slice(0, 100).map((holder, index) => {
                            const isNonEvmChain = NON_EVM_CHAINS.includes(selectedToken?.id.toLowerCase());
                            const address = holder.address.toLowerCase();
                            const { text: displayText, image } = truncateAddress(holder.address, nameTags, holder.source);
                            const isValidBtcAddress = holder.address.match(/^(1|3|bc1)[a-zA-Z0-9]+$/);
                            const isValidEvmAddress = holder.address.match(/^0x[a-fA-F0-9]{40}$/);

                            return (
                              <tr
                                key={index}
                                className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
                              >
                                <td className="px-2 py-2 text-white min-w-[200px]">
                                  <div className="flex items-center gap-2 text-xs">
                                    {image && (
                                      <img
                                        src={image}
                                        alt={`${displayText} logo`}
                                        className="w-4 h-4 rounded-full flex-shrink-0"
                                        onError={(e) => {
                                          logger.error('Name tag image failed to load:', {
                                            address,
                                            src: image,
                                          });
                                          e.target.src = '/icons/default.png';
                                        }}
                                      />
                                    )}
                                    {isNonEvmChain && isValidBtcAddress ? (
                                      <a
                                        href={`https://blockchair.com/${selectedToken?.id.toLowerCase()}/address/${holder.address}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-neon-blue hover:underline"
                                        title={holder.address}
                                      >
                                        {displayText}
                                      </a>
                                    ) : (
                                      <span
                                        className={`text-gray-200 ${isValidEvmAddress ? 'cursor-pointer hover:text-neon-blue hover:underline' : 'cursor-default'
                                          }`}
                                        onClick={() => isValidEvmAddress && handleAddressClick(holder.address)}
                                        title={displayText}
                                      >
                                        {displayText}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-gray-200 text-xs w-[100px]">
                                  <span>
                                    {holder.balance.toLocaleString('en-US', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 8,
                                    })}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs text-gray-400 text-center p-4">
                        {isLoadingOnChain
                          ? 'Loading top holders data...'
                          : NON_EVM_CHAINS.includes(selectedToken?.id.toLowerCase())
                            ? `No public treasury data available for ${selectedToken?.symbol?.toUpperCase() || 'selected token'}.`
                            : `No top holders data available for ${selectedToken?.symbol?.toUpperCase() || 'selected token'
                            } on ${chains.find((c) => c.value === selectedChain)?.label || 'selected chain'}.`}
                      </p>
                    )}
                  </div>
                )}

                {/* CEX Tab */}
                {activeMarketTab === 'cex' && (
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {tickerError && <p className="text-xs text-red-500 text-center p-4">{tickerError}</p>}
                    {!isLoadingTickers && !tickerError && tickerData.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead
                          className={`sticky top-0 z-10 border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                            }`}
                        >
                          <tr>
                            <th className="px-2 py-2 text-white text-left font-medium w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3 6l3 12h12l3-12H3zm9 10v-4m-4 4v-2m8 2v-2"
                                  />
                                </svg>
                                Market
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[60px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M8 7h12m0 0l-4-4m4 4l-4 4M4 17h12m0 0l4-4m-4 4l4 4"
                                  />
                                </svg>
                                Pair
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[80px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M7 12l3-3 3 3 5-5m0 0h-5m5 0v5"
                                  />
                                </svg>
                                Price
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M5 8h4v10H5V8zm6 4h4v6h-4v-6zm6-2h4v8h-4v-8z"
                                  />
                                </svg>
                                Volume
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                Last Traded
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {tickerData.slice(0, 30).map((ticker, index) => (
                            <tr
                              key={`${ticker.market.identifier}-${ticker.base}-${ticker.target}-${index}`}
                              className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
                            >
                              <td className="px-2 py-2 text-gray-200 w-[100px]">
                                <div className="flex items-center gap-1">
                                  {ticker.market.logo && (
                                    <img
                                      src={ticker.market.logo}
                                      alt={`${ticker.market.name} logo`}
                                      className="w-4 h-4 flex-shrink-0"
                                      onError={(e) => (e.target.src = '/fallback-image.png')}
                                    />
                                  )}
                                  <a
                                    href={ticker.trade_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-neon-blue hover:underline truncate max-w-[60px]"
                                    title={ticker.market.name}
                                  >
                                    {ticker.market.name}
                                  </a>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[60px]">
                                <span className="truncate">{ticker.base}/{ticker.target}</span>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[80px]">
                                <span className="truncate">
                                  {ticker.converted_last.usd != null ? formatPrice(ticker.converted_last.usd) : 'N/A'}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[100px]">
                                <span className="truncate">
                                  ${ticker.converted_volume.usd?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || 'N/A'}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[100px]">
                                <span className="truncate">
                                  {ticker.last_traded_at
                                    ? new Date(ticker.last_traded_at).toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                    : 'N/A'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      !isLoadingTickers && (
                        <p className="text-xs text-gray-400 text-center p-4">
                          {selectedToken
                            ? `No CEX data available for ${selectedToken.symbol?.toUpperCase() || 'selected token'}.`
                            : 'Please select a token to view CEX data.'}
                        </p>
                      )
                    )}
                  </div>
                )}

                {/* DEX Tab */}
                {activeMarketTab === 'dex' && (
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {dexError && <p className="text-xs text-red-500 text-center p-4">{dexError}</p>}
                    {!isLoadingDex && !dexError && dexData.trades.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead
                          className={`sticky top-0 z-10 border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                            }`}
                        >
                          <tr>
                            <th className="px-2 py-2 text-white text-left font-medium w-[70px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"
                                  />
                                </svg>
                                Token
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[120px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                                  />
                                </svg>
                                From Address
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[120px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                                  />
                                </svg>
                                To Address
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M5 8h4v10H5V8zm6 4h4v6h-4v-6zm6-2h4v8h-4v-8z"
                                  />
                                </svg>
                                Volume (USD)
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M12 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-7-7h14V7H5v4z"
                                  />
                                </svg>
                                Value
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-center font-medium w-[120px]">
                              <div className="flex items-center justify-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                Tx/Time
                              </div>
                            </th>
                            <th className="px-2 py-2 text-white text-left font-medium w-[80px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 stroke-white fill-none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18M6 15h12M9 18h6" />
                                </svg>
                                Pool
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dexData.trades.slice(0, 100).map((trade, index) => (
                            <tr
                              key={`${trade.tx_hash}-${index}`}
                              className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
                            >
                              <td className="px-2 py-2 text-gray-200 w-[70px]">
                                <div className="flex items-center gap-1">
                                  {selectedToken?.image && (
                                    <img
                                      src={selectedToken.image}
                                      alt={`${selectedToken.symbol} logo`}
                                      className="w-4 h-4 rounded-full flex-shrink-0"
                                      onError={(e) => (e.target.src = '/fallback-image.png')}
                                    />
                                  )}
                                  <span className="truncate">
                                    {(() => {
                                      const tokenAddress = trade.kind === 'sell' ? trade.from_token_address : trade.to_token_address;
                                      return tokenAddress.toLowerCase() ===
                                        selectedToken?.detail_platforms?.[
                                          chains.find((c) => c.value === selectedChain)?.coingeckoId
                                        ]?.contract_address?.toLowerCase()
                                        ? selectedToken?.symbol?.toUpperCase()
                                        : 'Token';
                                    })()}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[120px]">
                                <div className="flex items-center gap-1">
                                  <a
                                    href={getExplorerUrls(selectedChain, trade.tx_hash, trade.tx_from_address).addressUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-neon-blue hover:underline truncate cursor-pointer"
                                    title={trade.tx_from_address}
                                  >
                                    {(() => {
                                      if (!trade.tx_from_address || typeof trade.tx_from_address !== 'string') return 'N/A';
                                      return `${trade.tx_from_address.slice(0, 6)}...${trade.tx_from_address.slice(-4)}`;
                                    })()}
                                  </a>
                                  {trade.tx_from_address && typeof trade.tx_from_address === 'string' && (
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(trade.tx_from_address);
                                        toast.success('Address copied!', { autoClose: 2000 });
                                      }}
                                      className="text-gray-400 hover:text-neon-blue transition-colors flex-shrink-0"
                                      title="Copy address"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="w-4 h-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                        />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[120px]">
                                <div className="flex items-center gap-1">
                                  <a
                                    href={getExplorerUrls(selectedChain, trade.tx_hash, trade.to_token_address).addressUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-neon-blue hover:underline truncate cursor-pointer"
                                    title={trade.to_token_address}
                                  >
                                    {(() => {
                                      if (!trade.to_token_address || typeof trade.to_token_address !== 'string') return 'N/A';
                                      return `${trade.to_token_address.slice(0, 6)}...${trade.to_token_address.slice(-4)}`;
                                    })()}
                                  </a>
                                  {trade.to_token_address && typeof trade.to_token_address === 'string' && (
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(trade.to_token_address);
                                        toast.success('Address copied!', { autoClose: 2000 });
                                      }}
                                      className="text-gray-400 hover:text-neon-blue transition-colors flex-shrink-0"
                                      title="Copy address"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="w-4 h-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                        />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[100px]">
                                <div className="flex items-center gap-1">
                                  <span className="truncate">
                                    ${parseFloat(trade.volume_in_usd).toLocaleString('en-US', {
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 0,
                                    })}
                                  </span>
                                  <span
                                    className={`inline-block px-1.5 py-0.5 rounded-full text-[8px] font-medium flex-shrink-0 ${trade.kind === 'buy' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                                      }`}
                                  >
                                    {trade.kind.charAt(0).toUpperCase() + trade.kind.slice(1)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[100px]">
                                <div className="flex flex-col gap-0.5">
                                  <span className="truncate">
                                    {parseFloat(trade.kind === 'sell' ? trade.from_token_amount : trade.to_token_amount || 0).toLocaleString('en-US', {
                                      maximumFractionDigits: 2,
                                    })}{' '}
                                    {(() => {
                                      const tokenAddress = trade.kind === 'sell' ? trade.from_token_address : trade.to_token_address;
                                      return tokenAddress.toLowerCase() ===
                                        selectedToken?.detail_platforms?.[
                                          chains.find((c) => c.value === selectedChain)?.coingeckoId
                                        ]?.contract_address?.toLowerCase()
                                        ? selectedToken?.symbol?.toUpperCase()
                                        : 'Token';
                                    })()}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[120px] text-center">
                                <div className="flex flex-col gap-0.5 items-center">
                                  <a
                                    href={getExplorerUrls(selectedChain, trade.tx_hash, trade.tx_from_address).txUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={trade.tx_hash}
                                    className="flex-shrink-0"
                                  >
                                    <img
                                      src="/logos/etherscan-logo.png"
                                      alt="Etherscan"
                                      className="w-4 h-4"
                                      onError={(e) => (e.target.src = '/fallback-image.png')}
                                    />
                                  </a>
                                  <span className="truncate text-xs text-center">
                                    {formatDistanceToNow(new Date(trade.block_timestamp), { addSuffix: true })}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-gray-200 w-[80px]">
                                <button
                                  onClick={() => trade.pool_address && handlePoolClick(trade.pool_address)}
                                  className="flex items-center gap-1 text-xs text-neon-blue hover:underline truncate max-w-[50px]"
                                  title={
                                    dexData.pools.find((p) => p.attributes.address === trade.pool_address)?.attributes.name ||
                                    'View Pool Details'
                                  }
                                  disabled={!trade.pool_address || !dexData.poolTokens[trade.pool_address]}
                                >
                                  {(() => {
                                    const poolTokens =
                                      trade.pool_address && typeof trade.pool_address === 'string'
                                        ? dexData.poolTokens[trade.pool_address] || {}
                                        : {};
                                    const tokenAddresses = Object.keys(poolTokens);
                                    const token1 = tokenAddresses[0] ? poolTokens[tokenAddresses[0]] : null;
                                    const token2 = tokenAddresses[1] ? poolTokens[tokenAddresses[1]] : null;
                                    return token1 && token2 ? (
                                      <>
                                        <img
                                          src={token1.image_url}
                                          alt={`${token1.symbol} logo`}
                                          className="w-4 h-4 rounded-full flex-shrink-0"
                                          onError={(e) => (e.target.src = '/fallback-image.png')}
                                        />
                                        <span>/</span>
                                        <img
                                          src={token2.image_url}
                                          alt={`${token2.symbol} logo`}
                                          className="w-4 h-4 rounded-full flex-shrink-0"
                                          onError={(e) => (e.target.src = '/fallback-image.png')}
                                        />
                                      </>
                                    ) : (
                                      'N/A'
                                    );
                                  })()}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      !isLoadingDex && (
                        <p className="text-xs text-gray-400 text-center p-4">
                          No DEX data available for {selectedToken?.symbol?.toUpperCase() || 'selected token'} on{' '}
                          {chains.find((c) => c.value === selectedChain)?.label || 'selected chain'}.
                        </p>
                      )
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400 text-center p-4">
                Please select a token to view holders or market data.
              </p>
            )}
          </div>

        

          {/* Components con */}
          <WalletBalances
            balances={walletBalances}
            walletAddress={selectedWallet}
            isLoading={isLoadingWalletBalances}
            error={walletBalancesError}
            transactions={transactions}
            isLoadingTransactions={isLoadingTransactions}
            transactionsError={transactionsError}
            fetchTransactions={fetchTransactions}
            chains={chains}
            setSelectedWallet={setSelectedWallet}
            setWalletBalances={setWalletBalances}
            setTransactions={setTransactions}
            setWalletBalancesError={setWalletBalancesError}
            setTransactionsError={setTransactionsError}
            setWalletAddress={setWalletAddress}
            nameTags={nameTags}
            onClose={() => {
              setSelectedWallet(null);
              setWalletBalances([]);
              setTransactions(null);
              setWalletBalancesError(null);
              setTransactionsError(null);
              setWalletAddress('');
            }}
            isMobile={isMobile}
          />

          <Modal
            isOpen={!!analysis}
            onClose={() => {
              setAnalysis(null);
              setAnalysisLinks([]);
            }}
            title="Analysis"
            content={analysis}
            links={analysisLinks}
            isMobile={isMobile}
          />
          <Modal
            isOpen={!!prediction}
            onClose={() => setPrediction(null)}
            title="Prediction"
            content={prediction}
            isMobile={isMobile}
          />
          <Modal
            isOpen={!!selectedPool}
            onClose={() => setSelectedPool(null)}
            title="Pool Details"
            content={renderPoolModalContent()}
            links={[`https://www.geckoterminal.com/${GECKOTERMINAL_CHAIN_MAPPING[selectedChain]}/pools/${selectedPool?.address}`]}
            isMobile={isMobile}
          />
        </div>
      )}

      <ToastContainer position="top-center" autoClose={5000} />

      <style jsx>{`
      .shadow-neon {
        box-shadow: 0 0 8px rgba(0, 191, 255, 0.3);
      }
      .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
      }
      .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 0;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.4);
      }
      .animate-pulse {
        animation: ${isMobile ? 'none' : 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
      }
      @keyframes pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
    `}</style>
    </motion.div>
  );
};

export default React.memo(MarketTab);