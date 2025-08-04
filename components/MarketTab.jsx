'use client';

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
import 'react-loading-skeleton/dist/skeleton.css';


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

const isValidToken = (token) => {
  if (!token.image || token.image === '') return false;
  const invalidNamePatterns = [
    /https?:\/\//i, // Matches URLs
    /<[^>]+>/, // Matches HTML tags
    /[\n\r\t]/, // Matches newlines or tabs
    /[^a-zA-Z0-9\s\-$]/, // Matches non-alphanumeric characters except spaces, $, and -
  ];
  return !invalidNamePatterns.some((pattern) => pattern.test(token.name || token.symbol));
};

const formatPrice = (price, currency = 'usd') => {
  if (price == null || isNaN(price)) return 'N/A';
  let fractionDigits = 2;
  if (price < 0.0001) {
    fractionDigits = 6;
  } else if (price < 0.01) {
    fractionDigits = 4;
  }
  return `${currency.toUpperCase()} ${price.toLocaleString('en-US', {
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

const SkeletonLoader = ({ count = 5, isMobile }) => (
  <div className="space-y-2 sm:space-y-3 p-2 sm:p-4">
    {[...Array(count)].map((_, index) => (
      <div key={index} className="flex items-center gap-2 sm:gap-4">
        <div className="w-6 sm:w-8 h-6 sm:h-8 bg-gray-700/50 rounded-full animate-pulse"></div>
        <div className="flex-1 space-y-1 sm:space-y-2">
          <div className="h-3 sm:h-4 bg-gray-700/50 rounded animate-pulse"></div>
          <div className="h-3 sm:h-4 bg-gray-700/50 rounded animate-pulse w-3/4"></div>
        </div>
      </div>
    ))}
  </div>
);

// Modal component
const Modal = ({ isOpen, onClose, title, content, links = [], isMobile }) => {
  if (!isOpen) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
      className="fixed inset-0 flex items-center justify-center z-50 font-jetbrains bg-black/80 backdrop-blur-xl"
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
  const [activeTab, setActiveTab] = useState('portfolio'); useEffect(() => {
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
  }, [activeTab, transactions, isLoadingTransactions, transactionsError, fetchTransactions, walletAddress]); if (!walletAddress) return null; const getPlatformImage = (chainValue) => {
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    const chain = chains.find((c) => c.value === chainName);
    const imageUrl = chain?.image || '/fallback-image.png';
    logger.log('getPlatformImage:', { chainValue, chainName, imageUrl, found: !!chain });
    return imageUrl;
  }; const getChainLabel = (chainValue) => {
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    return chains.find((c) => c.value === chainName)?.label || chainName;
  }; const { text: displayWalletAddress, image: walletImage } = truncateAddress(walletAddress, nameTags); const formatNumber = (value, decimals = 6) => {
    if (value == null || isNaN(value)) return 'N/A';
    return Number(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };  // Filter valid tokens for Portfolio tab
  const validBalances = balances.filter((balance) =>
    isValidToken({ image: balance.logo, symbol: balance.symbol })
  );  // Filter valid transactions for Activity tab
  const validTransactions = transactions?.filter((tx) =>
    isValidToken({ image: tx.token_metadata?.logo, symbol: tx.token })
  ) || [];



  const overlayContent = (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease: 'easeInOut' }}
      className="fixed inset-0 flex items-center justify-center z-50 font-jetbrains bg-black/80 backdrop-blur-xs"
    >
      <div
        ref={walletBalancesRef}
        className={`p-6 max-w-6xl w-[95%] rounded-xl relative max-h-[80vh] min-h-[80vh] overflow-hidden custom-scrollbar border border-white/10 bg-black/60 backdrop-blur-2xl shadow-neon-lg`}
      >
        <div className="sticky top-0 z-10 p-3 bg-black/70 backdrop-blur-md">
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
              className="text-white text-lg font-bold rounded-full w-10 h-10 flex items-center justify-center bg-black/60 border border-white/10 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
              aria-label="Close balances"
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
            >
              ✕
            </motion.button>
          </div>
          <div className="flex space-x-2 mb-3">
            <motion.button
              onClick={() => setActiveTab('portfolio')}
              className={`px-2 py-1 sm:px-4 sm:py-1.5 rounded-xl text-[10px] sm:text-xs font-medium transition-all duration-300 border-2 border-white/10 ${activeTab === 'portfolio' ? 'bg-white text-black shadow-neon' : 'text-white hover:bg-white/20'}`}
              whileHover={{ scale: 1 }}
            >
              Portfolio
            </motion.button>
            <motion.button
              onClick={() => setActiveTab('activity')}
              className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all duration-300 border-2 border-white/10 ${activeTab === 'activity' ? 'bg-white text-black shadow-neon' : 'text-white hover:bg-white/20'}`}
              whileHover={{ scale: 1 }}
            >
              Activity
            </motion.button>
          </div>
        </div>


        <div className="overflow-y-auto max-h-[calc(80vh-100px)] rounded-lg custom-scrollbar">
          {activeTab === 'portfolio' && (
            <>
              {isLoading ? (
                <div className="space-y-3 p-4">
                  {[...Array(5)].map((_, index) => (
                    <div key={index} className="flex items-center gap-4">
                      <div className="w-8 h-8 bg-gray-700/50 rounded-full animate-pulse"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-700/50 rounded animate-pulse"></div>
                        <div className="h-4 bg-gray-700/50 rounded animate-pulse w-3/4"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <p className="text-sm text-red-400 text-center bg-red-500/10 p-3 rounded">Error: {error}</p>
              ) : validBalances.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed">
                    <thead className="text-[10px] sm:text-[xs] sticky top-0 z-10 border-b border-white/10 bg-black/70 backdrop-blur-md uppercase">
                      <tr>
                        <th className="px-2 py-2 text-white text-left font-medium w-[30%]">
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                        <th className="px-2 py-2 text-white text-left font-medium w-[35%]">
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 fill-neon-blue"
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z"
                              />
                            </svg>
                            Amount
                          </div>
                        </th>
                        <th className="px-2 py-2 text-white text-left font-medium w-[35%]">
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M7 12l3-3 3 3 5-5m0 0h-5m5 0v5"
                              />
                            </svg>
                            Value (USD)
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {validBalances.map((balance, index) => (
                        <tr
                          key={`${balance.chain}-${balance.address}-${index}`}
                          className="border-t border-white/10 hover:bg-white/10 transition-all duration-300"
                        >
                          <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs">
                            <div className="flex items-center space-x-1 relative">
                              {balance.logo && (
                                <img
                                  src={balance.logo}
                                  alt={`${balance.symbol} logo`}
                                  className="w-4 h-4 sm:w-6 sm:h-6 rounded-full flex-shrink-0"
                                  onError={(e) => {
                                    logger.error('Token logo failed to load:', {
                                      symbol: balance.symbol,
                                      src: balance.logo,
                                    });
                                    e.target.src = '/fallback-image.png';
                                  }}
                                />
                              )}
                              <img
                                src={getPlatformImage(balance.chain)}
                                alt={`${balance.chain} logo`}
                                className="w-2 h-2 sm:w-3 sm:h-3 rounded-full absolute left-3 top-[2px] sm:left-4 sm:top-[2px]"
                                onError={(e) => {
                                  logger.error('Platform logo failed to load:', {
                                    chain: balance.chain,
                                    src: getPlatformImage(balance.chain),
                                  });
                                  e.target.src = '/fallback-image.png';
                                }}
                              />
                              <div className="text-[9px] sm:text-[10px] flex flex-col items-start pl-6 sm:pl-7">
                                <span>{balance.symbol || 'Unknown'} {balance.address === 'native' ? '' : ''}</span>
                                {balance.price_usd != null && (
                                  <span className="text-[8px] sm:text-[10px] text-gray-400">{formatPrice(balance.price_usd)}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs">
                            {balance.amount != null
                              ? balance.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })
                              : 'N/A'}
                          </td>
                          <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs">
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
                <p className="text-xs text-gray-400 text-center p-4">No valid balances found for this wallet.</p>
              )}
            </>
          )}


          {activeTab === 'activity' && (
            <>
              {isLoadingTransactions ? (
                <div className="space-y-3 p-4">
                  {[...Array(5)].map((_, index) => (
                    <div key={index} className="flex items-center gap-4">
                      <div className="w-8 h-8 bg-gray-700/50 rounded-full animate-pulse"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-700/50 rounded animate-pulse"></div>
                        <div className="h-4 bg-gray-700/50 rounded animate-pulse w-3/4"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : transactionsError ? (
                <p className="text-xs text-red-400 text-center bg-red-500/10 p-3 rounded">Error: {transactionsError}</p>
              ) : validTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed">
                    <thead className="text-[10px] sm:text-[xs] sticky top-0 z-10 border-b border-white/10 bg-black/70 backdrop-blur-md uppercase">
                      <tr>
                        <th className="px-2 py-2 text-white text-left font-medium w-[15%]">
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                        <th className="px-2 py-2 text-white text-left font-medium w-[30%]">
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                        <th className="px-2 py-2 text-white text-left font-medium w-[25%]">
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 fill-neon-blue"
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z"
                              />
                            </svg>
                            Value
                          </div>
                        </th>
                        <th className="px-2 py-2 text-white text-center font-medium w-[30%]">
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                      </tr>
                    </thead>
                    <tbody>
                      {validTransactions.map((tx, index) => {
                        const chainName = CHAIN_ID_TO_NAME[tx.chain] || tx.chain || 'ethereum';
                        const { txUrl, addressUrl } = getExplorerUrls(chainName, tx.hash, tx.type === 'receive' ? tx.from : tx.to);
                        const { text: displayAddress, image: addressImage } = truncateAddress(
                          tx.type === 'receive' ? tx.from : tx.to,
                          nameTags
                        );
                        return (
                          <tr
                            key={`${tx.chain}-${tx.hash}-${index}`}
                            className="border-t border-white/10 hover:bg-white/10 transition-all duration-300"
                          >
                            <td className={`px-2 py-2 text-gray-200 text-[9px] sm:text-xs ${isMobile ? 'w-[15%]' : 'w-[15%]'}`}>
                              <div className="flex flex-col items-start space-y-1 relative">
                                {tx.token_metadata?.logo && (
                                  <img
                                    src={tx.token_metadata.logo}
                                    alt={`${tx.token} logo`}
                                    className="w-4 h-4 sm:w-6 sm:h-6 rounded-full flex-shrink-0"
                                    onError={(e) => {
                                      logger.error('Token logo failed to load:', {
                                        symbol: tx.token,
                                        src: tx.token_metadata.logo,
                                      });
                                      e.target.src = '/fallback-image.png';
                                    }}
                                  />
                                )}
                                <img
                                  src={getPlatformImage(tx.chain)}
                                  alt={`${chainName} logo`}
                                  className="w-2 h-2 sm:w-3 sm:h-3 rounded-full absolute left-3 top-[2px] sm:left-4 sm:top-[2px]"
                                  onError={(e) => {
                                    logger.error('Transaction chain logo failed to load:', {
                                      chain: tx.chain,
                                      chainName,
                                      src: getPlatformImage(tx.chain),
                                    });
                                    e.target.src = '/fallback-image.png';
                                  }}
                                />
                                <span className="pl-6 sm:pl-7 text-[8px] sm:text-[10px]">{tx.token || 'Unknown'}</span>
                              </div>
                            </td>
                            <td className={`px-2 py-2 text-gray-200 text-[9px] sm:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                              <div className="flex flex-col items-center space-y-1">
                                <span
                                  className={`inline-flex px-1.5 py-0.5 rounded-lg text-[7px] sm:text-[8px] font-medium flex-shrink-0 ${tx.type === 'receive' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'}`}
                                >
                                  {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                                </span>
                                <div className="flex items-center justify-center space-x-2">
                                  {addressImage && (
                                    <img
                                      src={addressImage}
                                      alt={`${displayAddress} logo`}
                                      className="w-2 h-2 sm:w-4 sm:h-4 rounded-full flex-shrink-0"
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
                                    className="text-[8px] sm:text-xs text-neon-blue hover:underline"
                                    title={tx.type === 'receive' ? tx.from : tx.to}
                                    onClick={() => handleAddressClick(tx.type === 'receive' ? tx.from : tx.to)}
                                  >
                                    {displayAddress}
                                  </a>
                                </div>
                              </div>
                            </td>
                            <td className={`px-2 py-2 text-gray-200 text-[9px] sm:text-xs ${isMobile ? 'w-[25%]' : 'w-[25%]'}`}>
                              {formatNumber(tx.value)}
                            </td>
                            <td className={`px-2 py-2 text-gray-200 text-[8px] sm:text-xs text-center ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                              <div className="flex flex-col items-center gap-0.5">
                                <a href={txUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                                  <img
                                    src="/logos/etherscan-logo.png"
                                    alt="Etherscan"
                                    className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 object-contain"
                                    onError={(e) => (e.target.src = '/fallback-image.png')}
                                  />
                                </a>
                                <span className="text-[7px] sm:text-[10px] text-gray-500 text-center">
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
                !isLoadingTransactions
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>); return createPortal(overlayContent, document.body);
};



const CustomTooltip = ({ active, payload, label, currency }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-black/80 p-2 rounded border border-white/20 text-white text-sm backdrop-blur-lg font-jetbrains">
        <p>{label}</p>
        <p>
          Price: <span className="font-bold">{formatPrice(payload[0].value, currency)}</span>
        </p>
      </div>
    );
  }
  return null;
};

const MarketTab = ({ recaptchaRef, initialTokenSlug, onTokenSelect }) => {
  const { data: session } = useSession();
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
    setSelectedToken, // Add this to the destructured props
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
  const [currency, setCurrency] = useState('usd');
  const [highLowData, setHighLowData] = useState({ high: null, low: null, percentageChange: null });
  const [availableCurrencies] = useState([
    'usd', 'eth', 'btc', 'eur', 'bnb', 'cny', 'gbp', 'hkd', 'idr', 'jpy',
    'krw', 'kwd', 'mmk', 'mxn', 'myr', 'ngn', 'nok', 'nzd', 'pln', 'rub',
    'sar', 'sek', 'sgd', 'sol', 'thb', 'try', 'twd', 'uah', 'vef', 'vnd',
    'xag', 'xau'
  ]);

  useEffect(() => {
    if (initialTokenSlug) {
      const fetchTokenBySlug = async () => {
        setIsChartLoading(true);
        try {
          const response = await fetch(`/api/coingecko/token/${initialTokenSlug}`, {
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
          });
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.detail || 'Failed to fetch token data');
          }
          setSelectedToken(result.data);
          logger.log('Fetched token by slug:', { slug: initialTokenSlug, token: result.data });
        } catch (err) {
          logger.error('Error fetching token by slug:', { slug: initialTokenSlug, error: err.message });
          toast.error(`Failed to load token: ${err.message}`, { position: 'top-center', autoClose: 3000 });
        } finally {
          setIsChartLoading(false);
        }
      };
      fetchTokenBySlug();
    }
  }, [initialTokenSlug, setSelectedToken]);

  // Handle token selection with URL update
  const handleTokenSelect = (token) => {
    debouncedHandleTokenSelect(token);
    if (onTokenSelect && token.id) {
      onTokenSelect(token.id);
    }
  };

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
    return () => window.removeEventListener('resize', checkMobile); // Fixed cleanup
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
          toast.error(err.message, { position: 'top-center', autoClose: 3000 });
        }
        setIsChartLoading(false);
      });
    }
  }, [selectedToken, timeRange, selectedChain, fetchPriceHistory, getAvailableChains, chains]);

  useEffect(() => {
    if (!selectedToken) return;

    const fetchHighLowData = async () => {
      try {
        const percentageFieldMap = {
          '0.5': { currency: 'price_change_percentage_1h_in_currency', fallback: 'price_change_percentage_1h' },
          '1': { currency: 'price_change_percentage_24h_in_currency', fallback: 'price_change_percentage_24h' },
          '7': { currency: 'price_change_percentage_7d_in_currency', fallback: 'price_change_percentage_7d' },
          '30': { currency: 'price_change_percentage_30d_in_currency', fallback: 'price_change_percentage_30d' },
          '90': { currency: 'price_change_percentage_90d_in_currency', fallback: 'price_change_percentage_90d' },
          '365': { currency: 'price_change_percentage_1y_in_currency', fallback: 'price_change_percentage_1y' },
        };

        const { currency: currencyField, fallback } = percentageFieldMap[timeRange] || {
          currency: 'price_change_percentage_24h_in_currency',
          fallback: 'price_change_percentage_24h',
        };
        const percentageChange = timeRange === '0.5' ? 'N/A' : selectedToken[currencyField]?.[currency] ?? selectedToken[fallback] ?? 'N/A';
        const highLow = {
          high: selectedToken.high_24h?.[currency] ?? 'N/A',
          low: selectedToken.low_24h?.[currency] ?? 'N/A',
        };

        if (process.env.NODE_ENV === 'development') {
          console.log('fetchHighLowData:', {
            percentageField: currencyField,
            fallbackField: fallback,
            percentageChange,
            currency,
            high: highLow.high,
            low: highLow.low,
            selectedTokenPercentageFields: {
              '1h': {
                currency: selectedToken.price_change_percentage_1h_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_1h,
              },
              '24h': {
                currency: selectedToken.price_change_percentage_24h_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_24h,
              },
              '7d': {
                currency: selectedToken.price_change_percentage_7d_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_7d,
              },
              '30d': {
                currency: selectedToken.price_change_percentage_30d_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_30d,
              },
              '90d': {
                currency: selectedToken.price_change_percentage_90d_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_90d,
              },
              '1y': {
                currency: selectedToken.price_change_percentage_1y_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_1y,
              },
            },
          });
        }

        setHighLowData({ high: highLow.high, low: highLow.low, percentageChange });

        setIsChartLoading(true);
        const tokenId = selectedToken.id;
        const days = timeRange === '0.5' ? 1 : timeRange === '1' ? 1 : timeRange === '7' ? 7 : timeRange === '30' ? 30 : timeRange === '90' ? 90 : 365;
        await fetchPriceHistory(tokenId, days, (err, data) => {
          if (err) {
            logger.error('Price history fetch failed:', { error: err.message });
            toast.error(err.message, { position: 'top-center', autoClose: 3000 });
          }
          setIsChartLoading(false);
        });
      } catch (error) {
        logger.error('Error in fetchHighLowData:', { error: error.message });
        setHighLowData({
          high: selectedToken.high_24h?.[currency] ?? 'N/A',
          low: selectedToken.low_24h?.[currency] ?? 'N/A',
          percentageChange: 'N/A',
        });
        setIsChartLoading(false);
        toast.error('Failed to fetch market data.', { position: 'top-center', autoClose: 3000 });
      }
    };

    fetchHighLowData();
  }, [selectedToken, timeRange, currency, fetchPriceHistory]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className={`font-jetbrains w-full max-w-9xl mx-auto mt-4 p-2 sm:p-4 h-[calc(100vh)] bg-black/60 backdrop-blur-2xl shadow-neon-lg ${isMobile ? 'pb-8 overflow-y-auto' : ''}`}
    >
      {/* Header Section */}
      <div className="w-full mb-1 mt-2 sm:mt-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[10px] sm:text-[10px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-2 rounded">Crypto</h2>
            <span className="text-gray-400">|</span>
            <button
              className="text-[10px] sm:text-[10px] font-bold text-gray-400 uppercase cursor-not-allowed flex items-center gap-1 transition-colors duration-300"
              disabled
              aria-label="Stock tab (coming soon)"
            >
              Stock <span className="text-[7px] sm:text-[8px] text-gray-500">(Soon)</span>
            </button>
          </div>
          <div className="flex flex-row items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {/* Select Chain */}
            <div className="relative flex-1" ref={chainDropdownRef}>
              <motion.button
                onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
                className={`text-white px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs flex items-center gap-1 sm:gap-2 border-2 border-white/10 bg-black/60 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300 rounded-xl w-full ${selectedToken?.id && ['bitcoin', 'ethereum'].includes(selectedToken.id.toLowerCase())
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
                  }`}
                disabled={!selectedToken || (selectedToken.id && ['bitcoin', 'ethereum'].includes(selectedToken.id.toLowerCase()))}
                aria-label="Select chain"
                whileHover={{ scale: 1 }}
              >
                {selectedChain ? (
                  <>
                    <img
                      src={getPlatformImage(selectedChain)}
                      alt={`${chains.find((c) => c.value === selectedChain)?.label || 'Chain'} logo`}
                      className="w-4 sm:w-5 h-4 sm:h-5 rounded-full"
                      onError={(e) => {
                        logger.error('Chain logo failed to load:', {
                          chain: selectedChain,
                          src: getPlatformImage(selectedChain),
                        });
                        e.target.src = '/fallback-image.png';
                      }}
                    />
                    <span className="text-[10px] sm:text-xs font-medium truncate">
                      {chains.find((c) => c.value === selectedChain)?.label || 'Chain'}
                    </span>
                  </>
                ) : (
                  <div className="w-4 sm:w-5 h-4 sm:h-5 bg-gray-700 rounded-full animate-pulse"></div>
                )}
                <span className="text-[10px] sm:text-xs ml-auto">{isChainDropdownOpen ? '▲' : '▼'}</span>
              </motion.button>
              {isChainDropdownOpen && (
                <div
                  className="absolute z-50 mt-2 w-full sm:w-48 max-h-48 sm:max-h-64 overflow-y-auto custom-scrollbar border border-white/10 bg-black/60 backdrop-blur-2xl rounded-lg shadow-neon-lg"
                >
                  {getAvailableChains().length === 0 ? (
                    <div className="px-3 py-2 text-gray-400 text-[10px] sm:text-xs">No supported chains available</div>
                  ) : (
                    getAvailableChains()
                      .filter((chain) => process.env.NODE_ENV === 'development' || !chain.testnet)
                      .map((chain) => (
                        <motion.button
                          key={chain.value}
                          onClick={() => {
                            setSelectedChain(chain.value);
                            setIsChainDropdownOpen(false);
                          }}
                          className="flex items-center w-full text-left px-3 py-2 hover:bg-neon-blue/20 text-white text-[10px] sm:text-xs font-medium transition-all duration-300 rounded"
                          whileHover={{ scale: 1.02 }}
                        >
                          <img
                            src={chain.image}
                            alt={`${chain.label} logo`}
                            className="w-4 sm:w-5 h-4 sm:h-5 rounded-full mr-2"
                            onError={(e) => {
                              logger.error('Dropdown chain logo failed to load:', {
                                chain: chain.value,
                                src: chain.image,
                              });
                              e.target.src = '/fallback-image.png';
                            }}
                          />
                          {chain.label}
                        </motion.button>
                      ))
                  )}
                </div>
              )}
            </div>
            {/* Currency Select */}
            {/* <div className="relative flex-1">
              <select
                id="currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="text-white px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs border border-white/10 bg-black/60 backdrop-blur-2xl rounded-sm focus:outline-none focus:ring-2 focus:ring-neon-blue/50 custom-scrollbar w-full"
              >
                {availableCurrencies.map((curr) => (
                  <option key={curr} value={curr}>
                    {curr.toUpperCase()}
                  </option>
                ))}
              </select>
            </div> */}
            {/* Search Wallet */}
            <div className="relative flex items-center flex-[2]">
              <input
                type="text"
                placeholder="Search wallet (0x...)"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                className="text-white px-3 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs w-full border-2 border-white/10 bg-black/60 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-neon-blue/50 transition-all duration-300 rounded-xl pr-8 sm:pr-10"
                aria-label="Wallet address"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
                    handleWalletSearch();
                  }
                }}
              />
              <motion.button
                onClick={() => {
                  if (walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
                    handleWalletSearch();
                  }
                }}
                className="absolute right-2 text-white p-1 sm:p-1.5 hover:bg-neon-blue/30 transition-all duration-300 rounded"
                aria-label="Search wallet"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 sm:h-4 w-3 sm:w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-[10px] sm:text-xs text-red-500 text-center p-2 sm:p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          Error: {error}
        </p>
      )}

      {!loading && !error && tokens.length > 0 && (
        <div className={`flex flex-col md:grid md:grid-cols-2 gap-2 sm:gap-4 h-[calc(100%-4rem)] sm:h-[calc(100%-1rem)] ${isMobile ? 'space-y-4' : ''}`}>
          {/* Right Section: Token Info and Chart */}
          <div
            className={`flex flex-col gap-2 sm:gap-4 max-h-[800px] min-h-[780px] sm:max-h-[calc(100%-3rem)] overflow-y-auto custom-scrollbar`}
          >
            {/* Token Info */}
            <div
              className={`border border-white/10 p-2 sm:p-4 rounded-lg min-h-[260px] sm:min-h-[150px] overflow-y-auto custom-scrollbar bg-black/60 backdrop-blur-2xl relative`}
            >
              {selectedToken ? (
                <div className="relative">
                  <div className="absolute top-1 right-1 w-32 sm:w-40" ref={dropdownRef}>
                    <motion.button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className={`text-white px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs flex items-center w-full border-2 border-white/10 bg-black/60 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300 rounded-xl`}
                      aria-label="Select token"
                      whileHover={{ scale: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      {selectedToken ? (
                        <>
                          <img
                            src={selectedToken.image}
                            alt={`${selectedToken.symbol} logo`}
                            className="w-4 sm:w-5 h-4 sm:h-5 rounded-full mr-2"
                            onError={(e) => (e.target.src = '/fallback-image.png')}
                          />
                          {selectedToken.symbol?.toUpperCase() || 'Token'}/USD
                        </>
                      ) : (
                        'Select Token'
                      )}
                      <span className="ml-auto text-[10px] sm:text-xs">{isDropdownOpen ? '▲' : '▼'}</span>
                    </motion.button>
                    {isDropdownOpen && (
                      <div
                        className={`absolute bg-black/60 backdrop-blur-2xl mt-2 w-full max-h-40 sm:max-h-48 overflow-y-auto custom-scrollbar border border-white/10 rounded-lg shadow-neon-sm z-50`}
                      >
                        <input
                          type="text"
                          placeholder="Search token (e.g, BTC)"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          ref={searchInputRef}
                          className={`text-white px-3 py-1 sm:py-1.5 w-full text-[8px] sm:text-[10px] border-b border-white/10 bg-black/60 backdrop-blur-md focus:outline-none rounded-t-lg`}
                        />
                        <div className="p-2">
                          {(searchQuery ? searchResults : tokens.slice(0, 30))
                            .filter(isValidToken) // Apply the filter
                            .map((token) => (
                              <motion.button
                                key={token.id}
                                onClick={() => handleTokenSelect(token)} // Use the new handleTokenSelect
                                className="flex items-center w-full text-left px-3 py-1.5 hover:bg-neon-blue/20 text-white text-[8px] sm:text-[10px] transition-all duration-300 rounded"
                                whileHover={{ scale: 1 }}
                              >
                                {token.image && (
                                  <img
                                    src={token.image}
                                    alt={`${token.symbol} logo`}
                                    className="w-4 sm:w-5 h-4 sm:h-5 rounded-full mr-2"
                                    onError={(e) => (e.target.src = '/fallback-image.png')}
                                  />
                                )}
                                {token.name} ({token.symbol?.toUpperCase() || 'Token'})
                              </motion.button>
                            ))}
                          {(searchQuery ? searchResults : tokens.slice(0, 30)).filter(isValidToken).length === 0 && (
                            <p className="text-[8px] sm:text-[10px] text-gray-400 text-center p-2">No valid tokens found.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mb-2 sm:mb-4">
                    <div className="flex items-center gap-2">
                      {selectedToken.image && (
                        <motion.img
                          src={selectedToken.image}
                          alt={`${selectedToken.symbol} logo`}
                          className="w-6 sm:w-8 h-6 sm:h-8 rounded-full"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.4 }}
                        />
                      )}
                      <div>
                        <h4 className="text-base sm:text-lg font-bold text-white tracking-tight">
                          {selectedToken.name} ({selectedToken.symbol?.toUpperCase() || 'Token'})
                        </h4>
                        {selectedToken.market_cap_rank && (
                          <span className="text-[10px] sm:text-xs text-gray-400">Rank #{selectedToken.market_cap_rank}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 mb-2 sm:mb-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <p className="text-sm sm:text-lg font-bold text-yellow">{formatPrice(selectedToken.current_price?.[currency], currency)}</p>
                        <span
                          className={`text-[9px] sm:text-[10px] font-medium ${selectedToken.price_change_percentage_24h_in_currency?.[currency] >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}
                        >
                          {selectedToken.price_change_percentage_24h_in_currency?.[currency] != null
                            ? `${selectedToken.price_change_percentage_24h_in_currency[currency].toFixed(2)}% (24h)`
                            : 'N/A'}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-end items-end">
                      <div className="flex items-center gap-2">
                        <label htmlFor="currency-select" className="text-[10px] sm:text-xs text-gray-500">Currency:</label>
                        <select
                          id="currency-select"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                          className="text-white px-2 py-1 text-[10px] sm:text-xs border-2 border-white/10 bg-black/60 backdrop-blur-2xl rounded-xl focus:outline-none focus:ring-2 focus:ring-neon-blue/50 custom-scrollbar"
                        >
                          {availableCurrencies.map((curr) => (
                            <option key={curr} value={curr}>
                              {curr.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                    <div>
                      <h5 className="text-[11px] sm:text-[10px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-1">
                        Market Stats
                      </h5>
                      <div className="grid grid-cols-1 gap-1 sm:gap-2 text-[10px] sm:text-[10px]">
                        <p className="text-gray-500">
                          Market Cap:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.market_cap?.[currency] != null
                              ? `${currency.toUpperCase()} ${selectedToken.market_cap[currency].toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          Fully Diluted Valuation:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.fully_diluted_valuation?.[currency] != null
                              ? `${currency.toUpperCase()} ${selectedToken.fully_diluted_valuation[currency].toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          24h Volume:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.total_volume?.[currency] != null
                              ? `${currency.toUpperCase()} ${selectedToken.total_volume[currency].toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div>
                      <h5 className="text-[11px] sm:text-[10px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-1">
                        Supply Stats
                      </h5>
                      <div className="grid grid-cols-1 gap-1 sm:gap-2 text-[10px] sm:text-[10px]">
                        <p className="text-gray-500">
                          Circulating Supply:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.circulating_supply != null
                              ? `${selectedToken.circulating_supply.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          Total Supply:{' '}
                          <span className="text-white font-semibold">
                            {selectedToken.total_supply != null
                              ? `${selectedToken.total_supply.toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
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
                      <h5 className="text-[11px] sm:text-[10px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-1">
                        All-Time Stats
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-2 text-[10px] sm:text-[10px]">
                        <p className="text-gray-500">
                          ATH:{' '}
                          <span
                            className={
                              typeof selectedToken.ath?.[currency] === 'number'
                                ? selectedToken.ath_change_percentage?.[currency] >= 0
                                  ? 'text-red-500'
                                  : 'text-green-500'
                                : 'text-white'
                            }
                          >
                            {typeof selectedToken.ath?.[currency] === 'number'
                              ? `${currency.toUpperCase()} ${selectedToken.ath[currency].toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          ATL:{' '}
                          <span
                            className={
                              typeof selectedToken.atl?.[currency] === 'number'
                                ? selectedToken.atl_change_percentage?.[currency] >= 0
                                  ? 'text-red-500'
                                  : 'text-green-500'
                                : 'text-white'
                            }
                          >
                            {typeof selectedToken.atl?.[currency] === 'number'
                              ? `${currency.toUpperCase()} ${selectedToken.atl[currency].toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          24H High:{' '}
                          <span className="text-green-500 font-semibold">
                            {formatPrice(highLowData.high, currency)}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          24H Low:{' '}
                          <span className="text-red-500 font-semibold">
                            {formatPrice(highLowData.low, currency)}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* Social Links (Moved to bottom-right) */}
                  <div className="absolute bottom-2 right-2 flex gap-2 social-links">
                    {selectedToken.links?.twitter_screen_name && (
                      <a
                        href={`https://twitter.com/${selectedToken.links.twitter_screen_name}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80"
                        title="Twitter"
                      >
                        <img
                          src="/logos/x.png" // Replace with actual Twitter logo path
                          alt="Twitter"
                          className="w-3 h-3"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                        />
                      </a>
                    )}
                    {selectedToken.links?.chat_url?.[0] && (
                      <a
                        href={selectedToken.links.chat_url[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80"
                        title="Discord"
                      >
                        <img
                          src="/logos/discord.png" // Replace with actual Discord logo path
                          alt="Discord"
                          className="w-3 h-3"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                        />
                      </a>
                    )}
                    {selectedToken.links?.homepage?.[0] && (
                      <a
                        href={selectedToken.links.homepage[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80"
                        title="Website"
                      >
                        <img
                          src="/logos/website.png" // Replace with actual Website logo path
                          alt="Website"
                          className="w-3 h-3"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                        />
                      </a>
                    )}
                    {selectedToken.links?.repos_url?.github?.[0] && (
                      <a
                        href={selectedToken.links.repos_url.github[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80"
                        title="GitHub"
                      >
                        <img
                          src="/logos/github.png" // Replace with actual GitHub logo path
                          alt="GitHub"
                          className="w-3 h-3"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                        />
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <SkeletonLoader count={5} isMobile={isMobile} />
              )}
            </div>

            {/* Chart */}
            <div
              className="border border-white/10 p-2 sm:p-4 rounded-lg flex-1 min-h-[320px] sm:min-h-[300px] max-h-[250px] sm:max-h-[350px] bg-black/60 backdrop-blur-2xl shadow-neon-lg overflow-y-auto custom-scrollbar"
            >
              <div className="flex flex-col items-center mb-2 sm:mb-4">
                <div className="flex flex-col sm:flex-row justify-between items-center w-full max-w-[90%] sm:max-w-[600px] gap-2 sm:gap-4">
                  <div className="flex space-x-2 mb-2 sm:mb-0 justify-start sm:justify-center w-full sm:w-auto">
                    <motion.button
                      onClick={debouncedHandleAnalysis}
                      className={`px-2 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-all duration-300 border border-white rounded-xl ${selectedToken && dailyMarketInteractions < 5
                        ? 'text-white'
                        : 'text-gray-400 cursor-not-allowed opacity-50'
                        }`}
                      disabled={!selectedToken || dailyMarketInteractions >= 5}
                      aria-label="Analyze token"
                      whileHover={{ scale: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Analyze
                    </motion.button>
                    <motion.button
                      onClick={debouncedHandlePrediction}
                      className={`px-2 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-all duration-300 border border-neon-blue/50 bg-white rounded-xl ${selectedToken && dailyMarketInteractions < 5
                        ? 'text-black'
                        : 'text-gray-400 cursor-not-allowed opacity-50'
                        }`}
                      disabled={!selectedToken || dailyMarketInteractions >= 5}
                      aria-label="Predict token price"
                      whileHover={{ scale: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Predict
                    </motion.button>
                  </div>
                  <div className="flex items-center justify-center gap-2 sm:gap-4 mt-2 sm:mt-6">
                    <div className="text-[8px] sm:text-[9px] text-gray-200">
                      <p className="text-gray-500 text-center">
                        Change:{' '}
                        <span
                          className={`font-bold ${highLowData.percentageChange !== 'N/A' && typeof highLowData.percentageChange === 'number'
                            ? highLowData.percentageChange >= 0
                              ? 'text-green-500'
                              : 'text-red-500'
                            : 'text-gray-200'
                            }`}
                        >
                          {highLowData.percentageChange !== 'N/A' && typeof highLowData.percentageChange === 'number'
                            ? `${highLowData.percentageChange >= 0 ? '+' : ''}${highLowData.percentageChange.toFixed(2)}% (${timeRange === '0.5' ? '1H' : timeRange === '1' ? '1D' : timeRange === '7' ? '7D' : timeRange === '30' ? '1M' : timeRange === '90' ? '3M' : '1Y'
                            })`
                            : 'N/A'}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <select
                        value={timeRange}
                        onChange={(e) => setTimeRange(e.target.value)}
                        className="text-white p-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[8px] sm:text-[9px] border-2 border-white/10 bg-black/60 backdrop-blur-2xl rounded-xl focus:outline-none focus:ring-2 focus:ring-neon-blue/50 custom-scrollbar"
                      >
                        {['1D', '7D', '1M', '3M', '1Y'].map((range, idx) => (
                          <option key={range} value={['1', '7', '30', '90', '365'][idx]}>
                            {range}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
              {isChartLoading ? (
                <SkeletonLoader count={5} isMobile={isMobile} />
              ) : priceHistory && priceHistory.length > 0 ? (
                <div className="h-48 sm:h-58">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={priceHistory} margin={{ top: 10, right: 15, bottom: 0, left: isMobile ? 0 : 10 }}>
                      <XAxis dataKey="title" stroke="#FFFFFF" tick={false} hide={true} />
                      <YAxis
                        stroke="#FFFFFF"
                        tick={{ fontSize: isMobile ? 6 : 8, fill: '#FFFFFF' }}
                        domain={[(dataMin) => dataMin * 0.99, (dataMax) => dataMax * 1.01]}
                        width={isMobile ? 50 : 60}
                        tickCount={10}
                        tickFormatter={(value) => {
                          const minPrice = Math.min(...priceHistory.map((item) => item.price).filter((p) => p > 0));
                          let fractionDigits = 2;
                          if (minPrice < 0.0001) {
                            fractionDigits = 6;
                          } else if (minPrice < 0.01) {
                            fractionDigits = 4;
                          }
                          return `${currency.toUpperCase()} ${value.toLocaleString('en-US', {
                            minimumFractionDigits: fractionDigits,
                            maximumFractionDigits: fractionDigits,
                          })}`;
                        }}
                      />
                      <Tooltip content={<CustomTooltip currency={currency} />} />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#FFFFFF"
                        fill="url(#neonGradient)"
                        strokeWidth={2}
                        isAnimationActive={true}
                        animationDuration={1000}
                      />
                      {priceHistory.length > 0 && (
                        <ReferenceDot
                          x={priceHistory[priceHistory.length - 1].title}
                          y={priceHistory[priceHistory.length - 1].price}
                          r={4}
                          fill="#FFFFFF"
                          stroke="#FFFFFF"
                          strokeWidth={2}
                          className="animate-pulse"
                        />
                      )}
                      <defs>
                        <linearGradient id="neonGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00BFFF" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#00BFFF" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-[10px] sm:text-xs text-gray-400 text-center flex-1">
                  {selectedToken ? 'No price data available for this token.' : 'Please select a token to view the chart.'}
                </p>
              )}
              <div className="absolute top-1 right-1 flex items-center group p-2">
                <img src="/logos/CG.png" alt="CG Logo" className="w-4 sm:w-4 h-4 sm:h-4 object-contain" />
                <span
                  className="absolute right-20 sm:right-20 text-[8px] sm:text-[9px] text-gray-200 opacity-0 translate-x-4 group-hover:opacity-100 group-hover:-translate-x-0 transition-all duration-300 whitespace-nowrap flex items-center"
                >
                  Data powered by
                  <img src="/logos/CG_1.png" alt="CG_1 Logo" className="w-12 sm:w-12 h-12 sm:h-12 object-contain ml-2" />
                </span>
              </div>
            </div>
          </div>
          {/* Left Section: Top Holders, CEX, DEX */}
          <div
            className={`flex flex-col border border-white/10 max-h-[50vh] min-h-[80vh] sm:max-h-[calc(100%-3rem)] overflow-y-auto custom-scrollbar bg-black/60 backdrop-blur-2xl shadow-neon-sm`}
          >
            {selectedToken ? (
              <>
                <div
                  className={`flex w-full border-b border-white/10 bg-black/60 backdrop-blur-md`}
                >
                  <motion.button
                    onClick={() => {
                      setActiveMarketTab('holders');
                      setShowTrades(false);
                    }}
                    className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition-all duration-500 ease-in-out ${activeMarketTab === 'holders' ? 'border-b-2 border-white' : 'text-white hover:bg-neon-blue/30'
                      }`}
                    whileHover={{ scale: 1.05 }} // Tăng nhẹ scale khi hover
                    whileTap={{ scale: 0.95 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }} // Thêm transition cho motion
                  >
                    TOP HOLDERS
                  </motion.button>
                  <motion.button
                    onClick={() => {
                      setActiveMarketTab('cex');
                      setShowTrades(false);
                    }}
                    className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition-all duration-500 ease-in-out ${activeMarketTab === 'cex' ? 'border-b-2 border-white' : 'text-white hover:bg-neon-blue/30'
                      }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                  >
                    CEX
                  </motion.button>
                  <motion.button
                    onClick={handleDexTabClick}
                    className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition-all duration-500 ease-in-out ${activeMarketTab === 'dex' ? 'border-b-2 border-white' : 'text-white hover:bg-neon-blue/30'
                      }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                  >
                    DEX
                  </motion.button>
                </div>
                {activeMarketTab === 'dex' && (
                  <div className="flex justify-end p-2 sm:p-3 text-[8px] sm:text-[9px] text-gray-400">
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
                      className={`flex justify-center items-center p-2 sm:p-3 border-b border-white/10 bg-black/60 backdrop-blur-md`}
                    >
                      <h4 className="text-[10px] sm:text-xs font-bold text-white text-center uppercase tracking-wider flex items-center gap-2">
                        Top 100
                        {selectedToken.image && (
                          <img
                            src={selectedToken.image}
                            alt={`${selectedToken.symbol} logo`}
                            className="w-4 sm:w-5 h-4 sm:h-5 rounded-full"
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
                    {isLoadingOnChain ? (
                      <SkeletonLoader count={5} isMobile={isMobile} />
                    ) : onChainData.topHolders && onChainData.topHolders.length > 0 ? (
                      <table className="w-full text-[10px] sm:text-xs">
                        <thead
                          className={`sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur-md`}
                        >
                          <tr>
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium min-w-[150px] sm:min-w-[200px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[80px] sm:w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 fill-neon-blue"
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
                                className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
                              >
                                <td className="px-2 sm:px-3 py-1 sm:py-2 text-white min-w-[150px] sm:min-w-[200px]">
                                  <div className="flex items-center gap-2 text-[10px] sm:text-xs">
                                    {image && (
                                      <img
                                        src={image}
                                        alt={`${displayText} logo`}
                                        className="w-4 sm:w-5 h-4 sm:h-5 flex-shrink-0"
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
                                <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 text-[10px] sm:text-xs w-[80px] sm:w-[100px]">
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
                      <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
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
                  <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar smooth-scroll">
                    {tickerError && (
                      <p className="text-[10px] sm:text-xs text-red-500 text-center p-2 sm:p-4 bg-red-500/10 rounded">{tickerError}</p>
                    )}
                    {isLoadingTickers ? (
                      <SkeletonLoader count={5} isMobile={isMobile} />
                    ) : tickerData.length > 0 ? (
                      <div className="table-container">
                        <table className="w-full text-[10px] sm:text-xs">
                          <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur-md">
                            <tr>
                              <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[100px] sm:w-[120px] fixed-column">
                                <div className="flex items-center gap-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                                    viewBox="0 0 24 24"
                                    strokeWidth="2"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M3 6l3 12h12l3-12H3zm9 10v-4m-4 4v-2m8 4v-2"
                                    />
                                  </svg>
                                  Market
                                </div>
                              </th>
                              <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[60px]">
                                <div className="flex items-center gap-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                              <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[80px]">
                                <div className="flex items-center gap-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                              <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[100px] sm:w-[120px]">
                                <div className="flex items-center gap-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                              <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[100px] sm:w-[120px]">
                                <div className="flex items-center gap-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                                className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
                              >
                                <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[100px] sm:w-[120px] fixed-column">
                                  <div className="flex items-center gap-2">
                                    {ticker.market.logo && (
                                      <img
                                        src={ticker.market.logo}
                                        alt={`${ticker.market.name} logo`}
                                        className="w-4 sm:w-5 h-4 sm:h-5 flex-shrink-0"
                                        onError={(e) => (e.target.src = '/fallback-image.png')}
                                      />
                                    )}
                                    <a
                                      href={ticker.trade_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-neon-blue hover:underline truncate max-w-[50px] sm:max-w-[60px]"
                                      title={ticker.market.name}
                                    >
                                      {ticker.market.name}
                                    </a>
                                  </div>
                                </td>
                                <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[60px]">
                                  <span className="truncate">{ticker.base}/{ticker.target}</span>
                                </td>
                                <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[80px]">
                                  <span className="truncate">
                                    {ticker.converted_last.usd != null ? formatPrice(ticker.converted_last.usd) : 'N/A'}
                                  </span>
                                </td>
                                <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[100px] sm:w-[120px]">
                                  <span className="truncate">
                                    $
                                    {ticker.converted_volume.usd?.toLocaleString('en-US', {
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 0,
                                    }) || 'N/A'}
                                  </span>
                                </td>
                                <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[100px] sm:w-[120px]">
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
                      </div>
                    ) : (
                      !isLoadingTickers && (
                        <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
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
                    {dexError && (
                      <p className="text-[10px] sm:text-xs text-red-500 text-center p-2 sm:p-4 bg-red-500/10 rounded">{dexError}</p>
                    )}
                    {isLoadingDex ? (
                      <SkeletonLoader count={5} isMobile={isMobile} />
                    ) : dexData.trades.length > 0 ? (
                      <table className="w-full text-[10px] sm:text-xs">
                        <thead
                          className={`sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur-md`}
                        >
                          <tr>
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[60px] sm:w-[70px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[100px] sm:w-[120px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[100px] sm:w-[120px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[80px] sm:w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[80px] sm:w-[100px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-center font-medium w-[100px] sm:w-[120px]">
                              <div className="flex items-center justify-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[70px] sm:w-[80px]">
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                            <motion.tr
                              key={`${trade.tx_hash}-${index}`}
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, ease: 'easeOut', delay: index * 0.05 }}
                              className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
                            >
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[60px] sm:w-[70px]">
                                <div className="flex items-center gap-2">
                                  {selectedToken?.image && (
                                    <img
                                      src={selectedToken.image}
                                      alt={`${selectedToken.symbol} logo`}
                                      className="w-4 sm:w-5 h-4 sm:h-5 rounded-full flex-shrink-0"
                                      onError={(e) => (e.target.src = '/fallback-image.png')}
                                    />
                                  )}
                                  <span className="truncate">
                                    {(() => {
                                      const tokenAddress =
                                        trade.kind === 'sell' ? trade.from_token_address : trade.to_token_address;
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
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[100px] sm:w-[120px]">
                                <div className="flex items-center gap-2">
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
                                    <motion.button
                                      onClick={() => {
                                        navigator.clipboard.writeText(trade.tx_from_address);
                                        toast.success('Address copied!', { autoClose: 2000 });
                                      }}
                                      className="text-gray-400 hover:text-neon-blue transition-colors flex-shrink-0"
                                      title="Copy address"
                                      whileHover={{ scale: 1.1 }}
                                      whileTap={{ scale: 0.9 }}
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="w-3 sm:w-4 h-3 sm:h-4"
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
                                    </motion.button>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[100px] sm:w-[120px]">
                                <div className="flex items-center gap-2">
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
                                    <motion.button
                                      onClick={() => {
                                        navigator.clipboard.writeText(trade.to_token_address);
                                        toast.success('Address copied!', { autoClose: 2000 });
                                      }}
                                      className="text-gray-400 hover:text-neon-blue transition-colors flex-shrink-0"
                                      title="Copy address"
                                      whileHover={{ scale: 1.1 }}
                                      whileTap={{ scale: 0.9 }}
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="w-3 sm:w-4 h-3 sm:h-4"
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
                                    </motion.button>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[80px] sm:w-[100px]">
                                <div className="flex items-center gap-2">
                                  <span className="truncate">
                                    ${parseFloat(trade.volume_in_usd).toLocaleString('en-US', {
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 0,
                                    })}
                                  </span>
                                  <span
                                    className={`inline-block px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] font-medium flex-shrink-0 ${trade.kind === 'buy' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                                      }`}
                                  >
                                    {trade.kind.charAt(0).toUpperCase() + trade.kind.slice(1)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[80px] sm:w-[100px]">
                                <div className="flex flex-col gap-0.5">
                                  <span className="truncate">
                                    {parseFloat(trade.kind === 'sell' ? trade.from_token_amount : trade.to_token_amount || 0).toLocaleString(
                                      'en-US',
                                      {
                                        maximumFractionDigits: 2,
                                      }
                                    )}{' '}
                                    {(() => {
                                      const tokenAddress =
                                        trade.kind === 'sell' ? trade.from_token_address : trade.to_token_address;
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
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[100px] sm:w-[120px] text-center">
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
                                      className="w-3 sm:w-4 h-3 sm:h-4"
                                      onError={(e) => (e.target.src = '/fallback-image.png')}
                                    />
                                  </a>
                                  <span className="truncate text-[10px] sm:text-xs text-center">
                                    {formatDistanceToNow(new Date(trade.block_timestamp), { addSuffix: true })}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[70px] sm:w-[80px]">
                                <motion.button
                                  onClick={() => trade.pool_address && handlePoolClick(trade.pool_address)}
                                  className="flex items-center gap-2 text-[10px] sm:text-xs text-neon-blue hover:underline truncate max-w-[40px] sm:max-w-[50px]"
                                  title={
                                    dexData.pools.find((p) => p.attributes.address === trade.pool_address)?.attributes
                                      .name || 'View Pool Details'
                                  }
                                  disabled={!trade.pool_address || !dexData.poolTokens[trade.pool_address]}
                                  whileHover={{ scale: 1.1 }}
                                  whileTap={{ scale: 0.9 }}
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
                                          className="w-3 sm:w-4 h-3 sm:h-4 rounded-full flex-shrink-0"
                                          onError={(e) => (e.target.src = '/fallback-image.png')}
                                        />
                                        <span>/</span>
                                        <img
                                          src={token2.image_url}
                                          alt={`${token2.symbol} logo`}
                                          className="w-3 sm:w-4 h-3 sm:h-4 rounded-full flex-shrink-0"
                                          onError={(e) => (e.target.src = '/fallback-image.png')}
                                        />
                                      </>
                                    ) : (
                                      'N/A'
                                    );
                                  })()}
                                </motion.button>
                              </td>
                            </motion.tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      !isLoadingDex && (
                        <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
                          No DEX data available for {selectedToken?.symbol?.toUpperCase() || 'selected token'} on{' '}
                          {chains.find((c) => c.value === selectedChain)?.label || 'selected chain'}.
                        </p>
                      )
                    )}
                  </div>
                )}
              </>
            ) : (
              <SkeletonLoader count={5} isMobile={isMobile} />
            )}
          </div>



          {/* Additional Components */}
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

      {/* ToastContainer for notifications */}
      <ToastContainer position="top-center" autoClose={5000} />

      {/* JSX Styles */}
      <style jsx>{`
  /* Base Neon Shadow for Futuristic Glow */
  .shadow-neon {
    box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.15);
    transition: box-shadow 0.3s ease;
  }

  .shadow-neon-lg {
    box-shadow: 0 0 12px rgba(0, 191, 255, 0.4), 0 0 24px rgba(0, 191, 255, 0.2);
    transition: box-shadow 0.3s ease;
  }

  .shadow-neon:hover {
    box-shadow: 0 0 12px rgba(0, 191, 255, 0.5), 0 0 20px rgba(0, 191, 255, 0.3);
  }

  /* Custom Scrollbar for Sleek Look */
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(0, 191, 255, 0.5);
    border-radius: 3px;
    transition: background 0.3s ease;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 191, 255, 0.8);
  }

  /* Pulse Animation for Loading States */
  .animate-pulse {
    animation: ${isMobile ? 'none' : 'pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  /* Glassmorphism Background */
  .glass-bg {
    background: linear-gradient(135deg, rgba(0, 0, 0, 0.7), rgba(20, 20, 20, 0.5));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  /* Button Hover Effects */
  button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 191, 255, 0.4);
  }

  button:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 1px 4px rgba(0, 191, 255, 0.2);
  }

  /* Table Styling */
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
  }

  th,
  td {
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding: 8px 12px;
    transition: background 0.3s ease;
  }

  th {
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.8), rgba(20, 20, 20, 0.6));
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    position: sticky;
    top: 0;
    z-index: 10;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  tr:hover {
    background: rgba(0, 191, 255, 0.1);
  }

  /* Input Styling */
  input {
    transition: all 0.3s ease;
  }

  input:focus {
    box-shadow: 0 0 8px rgba(0, 191, 255, 0.4);
    border-color: rgba(0, 191, 255, 0.6);
  }

  /* Modal Styling */
  .modal-content {
    background: linear-gradient(135deg, rgba(0, 0, 0, 0.85), rgba(20, 20, 20, 0.65));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 24px;
  }

  /* Chart Styling */
  .recharts-cartesian-grid line {
    stroke: rgba(255, 255, 255, 0.1);
  }

  .recharts-axis line,
  .recharts-axis text {
    stroke: rgba(255, 255, 255, 0.8);
    fill: rgba(255, 255, 255, 0.8);
    font-size: ${isMobile ? '8px' : '10px'};
  }

  /* Neon Gradient for Chart Area */
  .recharts-area {
    fill: url(#neonGradient);
    stroke: #00BFFF;
    stroke-width: 2;
  }

  /* High/Low Container in Chart Section */
  .high-low-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  /* Social Links */
  .social-links {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    align-items: center;
  }

  .social-links a {
    transition: color 0.3s ease;
  }

  .social-links a:hover {
    color: rgba(0, 191, 255, 0.8);
  }

  .social-links img {
    width: 1.25rem;
    height: 1.25rem;
    object-fit: contain;
  }

  /* Smooth Scroll Behavior */
.smooth-scroll {
  scroll-behavior: smooth;
}

/* Fixed Column in Table */
.table-container {
  position: relative;
  overflow-x: auto;
}

.fixed-column {
  position: sticky;
  left: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.8), rgba(20, 20, 20, 0.6));
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 11;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}

/* Enhanced Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  margin: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 191, 255, 0.6);
  border-radius: 4px;
  transition: background 0.3s ease;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 191, 255, 0.9);
}

.custom-scrollbar::-webkit-scrollbar-corner {
  background: transparent;
}
`}</style>
    </motion.div>
  );
};

export default React.memo(MarketTab);