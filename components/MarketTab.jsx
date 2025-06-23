// components/MarketTab.jsx
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

// Custom logger
const logger = {
  log: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
    }
  },
  error: (message, data) => {
  },
};

// Chain explorer mapping
const CHAIN_EXPLORER_MAP = {
  abstract: { baseUrl: 'https://explorer.abstractscan.io', supportsTx: true, supportsAddress: true },
  ancient8: { baseUrl: 'https://scan.ancient8.gg', supportsTx: true, supportsAddress: true },
  ape_chain: { baseUrl: 'https://explorer.apescan.io', supportsTx: true, supportsAddress: true },
  arbitrum: { baseUrl: 'https://arbiscan.io', supportsTx: true, supportsAddress: true },
  arbitrum_nova: { baseUrl: 'https://nova.arbscan.io', supportsTx: true, supportsAddress: true },
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

// Modal component
const Modal = ({ isOpen, onClose, title, content, links = [] }) => {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 font-plexmono"
      onClick={onClose}
    >
      <div
        className="bg-gray-800/95 backdrop-blur-md p-4 sm:p-6 rounded-xl max-w-[90%] sm:max-w-4xl w-full relative my-4 border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-white text-lg sm:text-xl font-bold bg-white/10 border border-white/20 backdrop-blur-md rounded-full w-8 h-8 flex items-center justify-center hover:bg-white/15 transition-all duration-300"
          aria-label="Close modal"
        >
          ✕
        </button>
        <h4 className="text-sm font-bold text-white mb-4">{title}</h4>
        <div className="text-sm text-gray-200 mb-4 prose prose-invert max-h-96 overflow-y-auto pr-2 custom-scrollbar">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <table className="border-collapse border border-white/20 w-full table-auto">{children}</table>
              ),
              th: ({ children }) => (
                <th className="border border-white/20 px-4 py-2 bg-gray-700/50 backdrop-blur-sm text-white text-left">{children}</th>
              ),
              td: ({ children }) => (
                <td className="border border-white/20 px-4 py-2 text-gray-200">{children}</td>
              ),
              code: ({ className, children }) => (
                <code className={`${className || ''} bg-gray-900/80 rounded text-white backdrop-blur-md text-gray-400`}>
                  {children}
                </code>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        {links.length > 0 && (
          <div>
            <h5 className="text-sm font-bold text-white mb-2">References:</h5>
            <ul className="list-none">
              {links.map((link, index) => (
                <li key={index} className="mb-2">
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:underline"
                  >
                    {link.length > 30 ? `${link.slice(0, 30)}...` : link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

// LoadingOverlay component
const LoadingOverlay = ({ message }) => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 font-plexmono">
    <div className="bg-gray-800/95 backdrop-blur-md p-3 rounded-lg border border-white/10 flex flex-col items-center gap-2">
      <p className="text-sm text-white">{message}</p>
      <div className="flex space-x-1.5">
        <div className="w-3 h-3 bg-gray-200 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
        <div className="w-3 h-3 bg-gray-200 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
        <div className="w-3 h-3 bg-gray-200 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
      </div>
    </div>
  </div>
);

// Wallet Balances component
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
  assetPlatforms,
  coingeckoToDuneChainMap,
  platformToChainId,
  setSelectedWallet,
  setWalletBalances,
  setTransactions,
  setWalletBalancesError,
  setTransactionsError,
  setWalletAddress,
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
    if (activeTab === 'transactions' && !transactions && !isLoadingTransactions && !transactionsError) {
      fetchTransactions(walletAddress);
    }
  }, [activeTab, transactions, isLoadingTransactions, transactionsError, fetchTransactions, walletAddress]);

  if (!walletAddress) return null;

  const weiToEth = (wei) => {
    const value = parseInt(wei, 16) || 0;
    return (value / 1e18).toFixed(6);
  };

  const truncateAddress = (address) => {
    if (!address || address === 'None') return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getPlatformImage = (chainValue) => {
    const platformKey = Object.keys(coingeckoToDuneChainMap).find(
      (key) => coingeckoToDuneChainMap[key] === chainValue
    );
    const platform = assetPlatforms.find(
      (p) => p.id === platformKey || p.chain_identifier === parseInt(platformToChainId[chainValue])
    );
    return platform?.image?.thumb || '/fallback-image.png';
  };

  const getExplorerUrls = (chain, hash, address) => {
    const explorer = CHAIN_EXPLORER_MAP[chain] || CHAIN_EXPLORER_MAP.ethereum;
    const txUrl = explorer.supportsTx ? `${explorer.baseUrl}/tx/${hash}` : '#';
    const addressUrl = explorer.supportsAddress ? `${explorer.baseUrl}/address/${address}` : '#';
    return { txUrl, addressUrl };
  };

  const overlayContent = (
    <div className="fixed inset-0 bg-tech flex items-center justify-center z-50 font-plexmono min-h-screen">
      <div
        ref={walletBalancesRef}
        className="bg-black rounded-sm p-4 max-w-6xl w-[90%] border border-gray-500 relative max-h-[80vh] overflow-y-auto custom-scrollbar"
      >
        <div className="flex justify-between items-center mb-4 uppercase">
          <h4 className="text-sm font-bold text-white">
            Wallet Details : {truncateAddress(walletAddress)}
          </h4>
          <button
            onClick={onClose}
            className="text-white text-lg font-bold bg-white/10 border border-white/20 backdrop-blur-md rounded-full w-8 h-8 flex items-center justify-center hover:bg-white/15 transition-all duration-300"
            aria-label="Close balances"
          >
            ✕
          </button>
        </div>
        <div className="flex space-x-2 mb-4">
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`px-2 py-1 rounded-sm text-xs font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${activeTab === 'portfolio' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/15'
              }`}
          >
            Portfolio
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`px-2 py-1 rounded-sm text-xs font-medium transition-all duration-300 border border-white/20 backdrop-blur-md ${activeTab === 'transactions' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/15'
              }`}
          >
            Transactions
          </button>
        </div>
        {activeTab === 'portfolio' && (
          <>
            {isLoading && <p className="text-sm text-gray-400 text-center">Loading portfolio...</p>}
            {error && <p className="text-sm text-red-500 text-center">Error: {error}</p>}
            {!isLoading && !error && balances.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border border-gray-500 table-auto">
                  <thead>
                    <tr>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Chain</th>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Token</th>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Balance</th>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Price (USD)</th>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Value (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((balance, index) => (
                      <tr key={`${balance.chain}-${balance.address}-${index}`}>
                        <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                          <div className="flex items-center justify-center">
                            <img
                              src={getPlatformImage(balance.chain)}
                              alt={`${balance.chain} logo`}
                              className="w-4 h-4 mr-2"
                              onError={(e) => (e.target.src = '/fallback-image.png')}
                            />
                            <span>{balance.chain.charAt(0).toUpperCase() + balance.chain.slice(1)}</span>
                          </div>
                        </td>
                        <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                          <div className="flex items-center justify-center">
                            {balance.logo && (
                              <img
                                src={balance.logo}
                                alt={`${balance.symbol} logo`}
                                className="w-5 h-5 mr-2"
                                onError={(e) => (e.target.src = '/fallback-image.png')}
                              />
                            )}
                            <span>
                              {balance.symbol} {balance.address === 'native' ? '(Native)' : ''}
                            </span>
                          </div>
                        </td>
                        <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                          {balance.amount
                            ? balance.amount.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                            : 'N/A'}
                        </td>
                        <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                          {balance.price_usd
                            ? `$${balance.price_usd.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                            : 'N/A'}
                        </td>
                        <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                          {balance.value_usd
                            ? `$${balance.value_usd.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                            : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !isLoading && <p className="text-sm text-gray-400 text-center">No balances found for this wallet.</p>
            )}
          </>
        )}
        {activeTab === 'transactions' && (
          <>
            {isLoadingTransactions && <p className="text-sm text-gray-400 text-center">Loading transactions...</p>}
            {transactionsError && <p className="text-sm text-red-500 text-center">Error: {transactionsError}</p>}
            {!isLoadingTransactions && !transactionsError && transactions && transactions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border border-gray-500 table-auto">
                  <thead>
                    <tr>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Chain</th>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Hash</th>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Transfer</th>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Value (ETH)</th>
                      <th className="border border-gray-500 px-4 py-2 bg-gray-700 text-white text-center text-xs">Block Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx, index) => {
                      const { txUrl, addressUrl: fromUrl } = getExplorerUrls(tx.chain, tx.hash, tx.from);
                      const { addressUrl: toUrl } = getExplorerUrls(tx.chain, tx.hash, tx.to);
                      return (
                        <tr key={`${tx.chain}-${tx.hash}-${index}`}>
                          <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center flex items-center justify-center">
                            <img
                              src={getPlatformImage(tx.chain)}
                              alt={`${tx.chain} logo`}
                              className="w-4 h-4 mr-2"
                              onError={(e) => (e.target.src = '/fallback-image.png')}
                            />
                            {tx.chain.charAt(0).toUpperCase() + tx.chain.slice(1)}
                          </td>
                          <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                            <a
                              href={txUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline"
                              title={tx.hash}
                            >
                              {truncateAddress(tx.hash)}
                            </a>
                          </td>
                          <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                            <a
                              href={fromUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline"
                              title={tx.from}
                            >
                              {truncateAddress(tx.from)}
                            </a>
                            {' → '}
                            <a
                              href={toUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline"
                              title={tx.to}
                            >
                              {truncateAddress(tx.to)}
                            </a>
                          </td>
                          <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                            {weiToEth(tx.value)}
                          </td>
                          <td className="border border-gray-500 px-4 py-2 text-gray-200 text-xs text-center">
                            {new Date(tx.block_time).toLocaleString('en-US')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              !isLoadingTransactions && <p className="text-sm text-gray-400 text-center">No transactions found for this address.</p>
            )}
          </>
        )}
      </div>
    </div>
  );

  return createPortal(overlayContent, document.body);
};

// CustomTooltip component
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-900/80 p-2 rounded border border-white/20 text-white text-sm backdrop-blur-md font-satoshi">
        <p>{label}</p>
        <p>
          Price: <span className="font-bold">${payload[0].value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
    setAnalysis, // Added
    analysisLinks,
    setAnalysisLinks, // Added
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
    assetPlatforms,
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
    dailyMarketInteractions, // Add this
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
    SUPPORTED_CHAINS,
    COINGECKO_TO_DUNE_CHAIN_MAP,
    PLATFORM_TO_CHAIN_ID,
    setSelectedWallet,
    setWalletBalances,
    setTransactions,
    setWalletBalancesError,
    setTransactionsError,
    fetchPublicTreasuryData,
    fetchTickerData,
  } = useMarketTabLogic({ recaptchaRef, toast });

  const dropdownRef = useRef(null);
  const chainDropdownRef = useRef(null);
  const searchInputRef = useRef(null);
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false);
  const [isWalletSearchOpen, setIsWalletSearchOpen] = useState(false);


  const getPlatformImage = (chainValue) => {
    const platformKey = Object.keys(COINGECKO_TO_DUNE_CHAIN_MAP).find(
      (key) => COINGECKO_TO_DUNE_CHAIN_MAP[key] === chainValue
    );
    const platform = assetPlatforms.find(
      (p) => p.id === platformKey || p.chain_identifier === parseInt(PLATFORM_TO_CHAIN_ID[chainValue])
    );
    return platform?.image?.thumb || '/fallback-image.png';
  };

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="font-plexmono w-[100%] max-w-10xl mx-auto bg-tech p-4 md:p-2 rounded-xl shadow-lg h-[calc(100vh-4rem)]"
    >
      {/* Stock button next to Crypto */}
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xl font-bold text-white uppercase">Crypto</h2>
        <button
          className="text-xl font-bold text-white/50 uppercase cursor-default flex items-center gap-1"
          disabled
          aria-label="Stock tab (coming soon)"
        >
          Stock <span className="text-xs text-white/50">(Soon)</span>
        </button>
      </div>
      {loading && <p className="text-sm text-gray-400 text-center">Loading market data...</p>}
      {error && <p className="text-sm text-red-500 text-center">Error: {error}</p>}
      {!loading && !error && tokens.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 grid-rows-[1fr_1fr] gap-3 h-[calc(100%-2.5rem)] md:overflow-hidden overflow-y-auto hide-scrollbar">
          {/* Top Left: Price Chart */}
          <div className="bg-gray-900/95 rounded-xl shadow-lg p-3 bg-tech backdrop-blur-md border border-white/10 flex flex-col h-full md:max-h-[calc(50vh-4rem)]">
            <div className="flex flex-col sm:flex-row sm:justify-center mb-2 gap-1.5">
              <div className="flex space-x-1.5 justify-center">
                <button
                  onClick={debouncedHandleAnalysis}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 border border-green-500 ${selectedToken && dailyMarketInteractions < 5
                      ? 'text-green-500 hover:bg-white/15 hover:shadow-lg'
                      : 'text-gray-400 cursor-not-allowed opacity-50'
                    }`}
                  disabled={!selectedToken || dailyMarketInteractions >= 5}
                  aria-label="Analyze token"
                >
                  Analyze
                </button>
                <button
                  onClick={debouncedHandlePrediction}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 border border-blue-500 ${selectedToken && dailyMarketInteractions < 5
                      ? 'text-blue-500 hover:bg-white/15 hover:shadow-lg'
                      : 'text-gray-400 cursor-not-allowed opacity-50'
                    }`}
                  disabled={!selectedToken || dailyMarketInteractions >= 5}
                  aria-label="Predict token price"
                >
                  Predict
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-2 justify-end">
              {['12H', '1D', '7D', '1M', '3M', '1Y'].map((range, idx) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(['0.5', '1', '7', '30', '90', '365'][idx])}
                  className={`px-1.5 py-1 rounded-md text-xs transition-all duration-300 border border-white/20 backdrop-blur-md ${timeRange === ['0.5', '1', '7', '30', '90', '365'][idx] ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/15'}`}
                  aria-label={`Select ${range} time range`}
                >
                  {range}
                </button>
              ))}
            </div>
            {priceHistory.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={priceHistory} margin={{ top: 5, right: 15, bottom: 50, left: -15 }}>
                    <CartesianGrid stroke="#404040" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="title"
                      stroke="#FFFFFF"
                      tick={{ fontSize: 8, fill: '#FFFFFF' }}
                      angle={-45}
                      textAnchor="end"
                      height={50}
                      interval={timeRange === '0.5' ? Math.floor(priceHistory.length / 12) : timeRange === '1' ? 0 : 'preserveStartEnd'}
                    />
                    <YAxis
                      stroke="#FFFFFF"
                      tick={{ fontSize: 8, fill: '#FFFFFF' }}
                      domain={['auto', 'auto']}
                      width={50}
                      tickFormatter={(value) => `$${value.toLocaleString('en-US')}`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="price"
                      stroke="#FFFFFF"
                      fillOpacity={0.3}
                      fill="#FFFFFF"
                      strokeWidth={1.5}
                      isAnimationActive={true}
                    />
                    {priceHistory.length > 0 && (
                      <ReferenceDot
                        x={priceHistory[priceHistory.length - 1].title}
                        y={priceHistory[priceHistory.length - 1].price}
                        r={4}
                        fill="#FFFFFF"
                        stroke="#FFFFFF"
                        strokeWidth={1.5}
                        className="animate-pulse"
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center">No price data available.</p>
            )}
          </div>

          {/* Top Right: Token Info */}
          {selectedToken && (
            <div className="bg-gray-800/95 rounded-xl p-3 backdrop-blur-md border border-white/10 flex flex-col h-full md:max-h-[calc(50vh-5rem)] sm:min-h-[300px]">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center">
                  {selectedToken.image && (
                    <img
                      src={selectedToken.image}
                      alt={`${selectedToken.symbol} logo`}
                      className="w-6 h-6 mr-2 rounded-full"
                      onError={(e) => (e.target.src = '/fallback-image.png')}
                    />
                  )}
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {selectedToken.name} ({selectedToken.symbol?.toUpperCase()})
                    </h4>
                    {selectedToken.market_cap_rank && (
                      <span className="text-xs text-gray-400">Rank #{selectedToken.market_cap_rank}</span>
                    )}
                  </div>
                </div>
                <div className="relative w-full sm:w-56" ref={dropdownRef}>
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="bg-white/10 text-white px-3 py-1.5 rounded-lg text-xs flex items-center w-full sm:w-56 border border-white/20 backdrop-blur-md hover:bg-white/15 transition-all duration-300"
                    aria-label="Select token"
                  >
                    {selectedToken ? (
                      <>
                        <img
                          src={selectedToken.image}
                          alt={`${selectedToken.symbol} logo`}
                          className="w-4 h-4 mr-1.5"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                        />
                        {selectedToken.symbol?.toUpperCase()}/USD
                      </>
                    ) : (
                      'Select Token'
                    )}
                    <span className="ml-auto">{isDropdownOpen ? '▲' : '▼'}</span>
                  </button>
                  {isDropdownOpen && (
                    <div className="absolute z-20 bg-gray-800/95 rounded-lg mt-1 w-full sm:w-56 max-h-52 overflow-y-auto custom-scrollbar backdrop-blur-md border border-white/10">
                      <input
                        type="text"
                        placeholder="Search token (e.g., BTC, ETH)"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        ref={searchInputRef}
                        className="bg-gray-700/80 text-white px-3 py-1.5 w-full rounded-t-lg text-xs border-b border-white/20 backdrop-blur-md focus:outline-none"
                      />
                      <div className="p-1.5">
                        {(searchQuery ? searchResults : tokens.slice(0, 20)).map((token) => (
                          <button
                            key={token.id}
                            onClick={() => debouncedHandleTokenSelect(token)}
                            className="flex items-center w-full text-left px-3 py-1.5 hover:bg-white/15 rounded-md text-white text-xs transition-all duration-300"
                          >
                            {token.image && (
                              <img
                                src={token.image}
                                alt={`${token.symbol} logo`}
                                className="w-4 h-4 mr-1.5"
                                onError={(e) => (e.target.src = '/fallback-image.png')}
                              />
                            )}
                            {token.name} ({token.symbol?.toUpperCase()})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Token Info Content */}
              <div className="flex-1 md:overflow-y-auto sm:overflow-hidden">
                {/* Price Section */}
                <div className="mb-2 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <p className="text-lg sm:text-xl font-bold text-white">
                        {selectedToken.current_price != null
                          ? `$${selectedToken.current_price.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                          : 'N/A'}
                      </p>
                      <span
                        className={`text-xs font-medium ${selectedToken.price_change_percentage_24h >= 0 ? 'text-green' : 'text-red'}`}
                      >
                        {selectedToken.price_change_percentage_24h != null
                          ? `${selectedToken.price_change_percentage_24h.toFixed(2)}% (24h)`
                          : 'N/A'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:gap-4 text-xs text-gray-200">
                    <p>
                      24h High:{' '}
                      <span className="text-green font-bold">
                        {selectedToken.high_24h != null
                          ? `$${selectedToken.high_24h.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                          : 'N/A'}
                      </span>
                    </p>
                    <p className="sm:ml-2">
                      24h Low:{' '}
                      <span className="text-red font-bold">
                        {selectedToken.low_24h != null
                          ? `$${selectedToken.low_24h.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                          : 'N/A'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 m-2">
                  <div>
                    <h5 className="text-sm font-bold text-white mb-1 uppercase m-2">Market Stats</h5>
                    <div className="grid grid-cols-1 gap-1 text-xs">
                      <p className="text-gray-200">
                        Market Cap:{' '}
                        <span className="text-white font-bold">
                          {selectedToken.market_cap != null
                            ? `$${selectedToken.market_cap.toLocaleString('en-US')}`
                            : 'N/A'}
                        </span>
                        {selectedToken.market_cap_change_percentage_24h != null && (
                          <span
                            className={`ml-1 text-[10px] ${selectedToken.market_cap_change_percentage_24h >= 0 ? 'text-green' : 'text-red'}`}
                          >
                            ({selectedToken.market_cap_change_percentage_24h.toFixed(2)}%)
                          </span>
                        )}
                      </p>
                      <p className="text-gray-200">
                        Fully Diluted Valuation:{' '}
                        <span className="text-white font-bold">
                          {selectedToken.fully_diluted_valuation != null
                            ? `$${selectedToken.fully_diluted_valuation.toLocaleString('en-US')}`
                            : 'N/A'}
                        </span>
                      </p>
                      <p className="text-gray-200">
                        24h Volume:{' '}
                        <span className="text-white font-bold">
                          {selectedToken.total_volume != null
                            ? `$${selectedToken.total_volume.toLocaleString('en-US')}`
                            : 'N/A'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-bold text-white uppercase m-2">Supply Stats</h5>
                    <div className="grid grid-cols-1 gap-1 text-xs">
                      <p className="text-gray-200">
                        Circulating Supply:{' '}
                        <span className="text-white font-bold">
                          {selectedToken.circulating_supply != null
                            ? `${selectedToken.circulating_supply.toLocaleString('en-US')}`
                            : 'N/A'}
                        </span>
                      </p>
                      <p className="text-gray-200">
                        Total Supply:{' '}
                        <span className="text-white font-bold">
                          {selectedToken.total_supply != null
                            ? `${selectedToken.total_supply.toLocaleString('en-US')}`
                            : 'N/A'}
                        </span>
                      </p>
                      <p className="text-gray-200">
                        Max Supply:{' '}
                        <span className="text-white font-bold">
                          {selectedToken.max_supply != null
                            ? `${selectedToken.max_supply.toLocaleString('en-US')}`
                            : 'N/A'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-bold text-white uppercase mb-2">All-Time Stats</h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                      <p className="text-gray-200">
                        ATH:{' '}
                        <span className={typeof selectedToken.ath === 'number' ? (selectedToken.ath_change_percentage >= 0 ? 'text-green font-bold' : 'text-red font-bold') : 'text-white'}>
                          {typeof selectedToken.ath === 'number'
                            ? `$${selectedToken.ath.toLocaleString('en-US')}`
                            : 'N/A'}
                        </span>
                      </p>
                      <p className="text-gray-200">
                        ATL:{' '}
                        <span className={typeof selectedToken.atl === 'number' ? (selectedToken.atl_change_percentage >= 0 ? 'text-green font-bold' : 'text-red font-bold') : 'text-white'}>
                          {typeof selectedToken.atl === 'number'
                            ? `$${selectedToken.atl.toLocaleString('en-US')}`
                            : 'N/A'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-base font-bold text-white uppercase m-2">Additional Info</h5>
                    <div className="text-xs">
                      <p className="text-gray-200">
                        Last Updated:{' '}
                        <span className="text-white font-bold">
                          {selectedToken.last_updated
                            ? new Date(selectedToken.last_updated).toLocaleString('en-US', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                            : 'N/A'}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Left: Top 100 Holders */}
          {selectedToken && (
            <div className="bg-gray-900 rounded-xl border border-gray-500 flex flex-col h-full md:max-h-[calc(50vh-4rem)] max-h-[calc(50vh-4rem)]">
              {isLoadingOnChain && <LoadingOverlay message="Loading on-chain data..." />}

              <div className="flex-1 overflow-y-auto hide-scrollbar p-3">
                <div className="flex justify-between items-center sticky top-0 mb-2">
                  {/* Left: Chain Dropdown */}
                  <div className="relative" ref={chainDropdownRef}>
                    <button
                      onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
                      className={`bg-white/10 text-white p-1.5 rounded-lg border border-white/20 backdrop-blur-md hover:bg-white/15 transition-all duration-300 flex items-center justify-center ${['bitcoin', 'ethereum'].includes(selectedToken?.id.toLowerCase()) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      disabled={['bitcoin', 'ethereum'].includes(selectedToken?.id.toLowerCase()) || !selectedToken}
                      aria-label="Select chain"
                    >
                      <span className="flex items-center">
                        {selectedChain ? (
                          <>
                            <img
                              src={getPlatformImage(selectedChain)}
                              alt={`${getAvailableChains().find((c) => c.value === selectedChain)?.label || 'Chain'} logo`}
                              className="w-4 h-4 mr-1.5"
                              onError={(e) => (e.target.src = '/fallback-image.png')}
                            />
                            <span className="text-xs">
                              {getAvailableChains().find((c) => c.value === selectedChain)?.label || 'Select Chain'}
                            </span>
                          </>
                        ) : (
                          <div className="w-4 h-4 bg-gray-600 rounded-full mr-1.5"></div>
                        )}
                      </span>
                      <span className="text-xs ml-1.5">{isChainDropdownOpen ? '▲' : '▼'}</span>
                    </button>
                    {isChainDropdownOpen && (
                      <div className="absolute z-20 bg-gray-800/95 rounded-lg mt-1 w-56 max-h-64 overflow-y-auto custom-scrollbar backdrop-blur-md border border-white/10">
                        {getAvailableChains().length === 0 ? (
                          <div className="px-3 py-1.5 text-gray-400 text-xs">No supported chains available</div>
                        ) : (
                          getAvailableChains().map((chain) => (
                            <button
                              key={chain.value}
                              onClick={() => {
                                setSelectedChain(chain.value);
                                setIsChainDropdownOpen(false);
                              }}
                              className="flex items-center w-full text-left px-3 py-1.5 hover:bg-white/15 rounded-md text-white text-xs transition-all duration-300"
                            >
                              <img
                                src={getPlatformImage(chain.value)}
                                alt={`${chain.label} logo`}
                                className="w-4 h-4 mr-1.5"
                                onError={(e) => (e.target.src = '/fallback-image.png')}
                              />
                              {chain.label}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Center: Title */}
                  <div className="flex-grow flex justify-center items-center absolute left-1/2 transform -translate-x-1/2">
                    <h4 className="text-xs font-bold text-white text-center uppercase">
                      Top 100 {selectedToken.symbol?.toUpperCase()} Holders
                    </h4>
                  </div>

                  {/* Right: Search Button and Input */}
                  <div className="flex items-center gap-1.5">
                    {isWalletSearchOpen && (
                      <input
                        type="text"
                        placeholder="0x..."
                        value={walletAddress}
                        onChange={(e) => setWalletAddress(e.target.value)}
                        className="bg-gray-700/80 text-white px-2 py-1.5 rounded-lg text-xs w-32 sm:w-36 border border-white/20 backdrop-blur-md focus:outline-none order-1"
                        aria-label="Wallet address"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
                            handleWalletSearch();
                            setIsWalletSearchOpen(false);
                          }
                        }}
                      />
                    )}
                    <button
                      onClick={() => setIsWalletSearchOpen(!isWalletSearchOpen)}
                      className="text-white p-1.5 rounded-lg transition-all duration-300 border border-white order-2"
                      aria-label="Toggle wallet search"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {onChainData.topHolders && onChainData.topHolders.length > 0 ? (
                  <div className="overflow-x-auto md:max-h-[calc(100%-3rem)] overflow-y-auto hide-scrollbar">
                    <table className="w-full border border-gray-500 table-auto text-xs">
                      <thead>
                        <tr>
                          <th className="border border-gray-500 px-2 py-1 bg-gray-700 text-white text-center">
                            {['bitcoin', 'ethereum'].includes(selectedToken?.id.toLowerCase()) ? 'Company' : 'Address'}
                          </th>
                          <th className="border border-gray-500 px-2 py-1 bg-gray-700 text-white text-center">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {onChainData.topHolders.slice(0, 100).map((holder, index) => {
                          const isPublicTreasury = ['bitcoin', 'ethereum'].includes(selectedToken?.id.toLowerCase());
                          return (
                            <tr key={index}>
                              <td
                                className={`border border-gray-500 px-2 py-1 text-gray-200 font-plexmono text-center break-all ${isPublicTreasury ? 'cursor-default' : 'cursor-pointer hover:text-blue-400'}`}
                                {...(!isPublicTreasury && {
                                  onClick: () => handleAddressClick(holder.address),
                                  title: holder.address,
                                })}
                              >
                                {isPublicTreasury
                                  ? holder.address
                                  : `${holder.address.slice(0, 6)}...${holder.address.slice(-4)}`}
                              </td>
                              <td className="border border-gray-500 px-2 py-1 text-gray-200 text-center">
                                {holder.balance.toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center">
                    {['bitcoin', 'ethereum'].includes(selectedToken?.id.toLowerCase())
                      ? `No public treasury data available for ${selectedToken.symbol?.toUpperCase()}.`
                      : `No top holders data available for ${selectedChain || 'selected chain'}.`}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Bottom Right: Activity */}
          {selectedToken && (
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-500 flex flex-col h-full md:max-h-[calc(50vh-4rem)] max-h-[calc(50vh-4rem)] sm:min-h-[300px] min-h-[400px] overflow-auto hide-scrollbar">
              <h3 className="text-xs font-bold text-white mb-2 text-center">Market Activity</h3>
              {isLoadingTickers && <LoadingOverlay message="Loading ticker data..." />}
              {tickerError && <p className="text-xs text-red-500 text-center flex-1">{tickerError}</p>}
              {!isLoadingTickers && !tickerError && tickerData.length > 0 ? (
                <div className="overflow-x-hidden md:max-h-[calc(100%-2rem)] md:overflow-y-auto hide-scrollbar">
                  <table className="w-full border border-gray-500 table-auto text-xs">
                    <thead>
                      <tr>
                        <th className="border border-gray-500 px-2 py-1 bg-gray-700 text-white text-center min-w-[100px]">Market</th>
                        <th className="border border-gray-500 px-2 py-1 bg-gray-700 text-white text-center min-w-[60px]">Pair</th>
                        <th className="border border-gray-500 px-2 py-1 bg-gray-700 text-white text-center min-w-[80px]">Price (USD)</th>
                        <th className="border border-gray-500 px-2 py-1 bg-gray-700 text-white text-center min-w-[100px]">Volume (USD)</th>
                        <th className="border border-gray-500 px-2 py-1 bg-gray-700 text-white text-center min-w-[80px]">Spread (%)</th>
                        <th className="border border-gray-500 px-2 py-1 bg-gray-700 text-white text-center min-w-[100px]">Last Traded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickerData.slice(0, 10).map((ticker, index) => (
                        <tr key={`${ticker.market.identifier}-${ticker.base}-${ticker.target}-${index}`}>
                          <td className="border border-gray-500 px-2 py-1 text-gray-200 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {ticker.market.logo && (
                                <img
                                  src={ticker.market.logo}
                                  alt={`${ticker.market.name} logo`}
                                  className="w-4 h-4"
                                  onError={(e) => (e.target.src = '/fallback-image.png')}
                                />
                              )}
                              <a
                                href={ticker.trade_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:underline truncate max-w-[80px]"
                                title={ticker.market.name}
                              >
                                {ticker.market.name}
                              </a>
                            </div>
                          </td>
                          <td className="border border-gray-500 px-2 py-1 text-gray-200 text-center">
                            {ticker.base}/{ticker.target}
                          </td>
                          <td className="border border-gray-500 px-2 py-1 text-gray-200 text-center">
                            ${ticker.converted_last.usd?.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }) || 'N/A'}
                          </td>
                          <td className="border border-gray-500 px-2 py-1 text-gray-200 text-center">
                            ${ticker.converted_volume.usd?.toLocaleString('en-US', {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            }) || 'N/A'}
                          </td>
                          <td className="border border-gray-500 px-2 py-1 text-gray-200 text-center">
                            {ticker.bid_ask_spread_percentage?.toFixed(2) || 'N/A'}%
                          </td>
                          <td className="border border-gray-500 px-2 py-1 text-gray-200 text-center">
                            {ticker.last_traded_at
                              ? new Date(ticker.last_traded_at).toLocaleString('en-US', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                              : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !isLoadingTickers && (
                  <p className="text-xs text-gray-400 text-center flex-1">
                    No ticker data available for {selectedToken.symbol?.toUpperCase()}.
                  </p>
                )
              )}
            </div>
          )}

          {/* Wallet Balances Modal */}
          <WalletBalances
            balances={walletBalances}
            walletAddress={selectedWallet}
            isLoading={isLoadingWalletBalances}
            error={walletBalancesError}
            transactions={transactions}
            isLoadingTransactions={isLoadingTransactions}
            transactionsError={transactionsError}
            fetchTransactions={fetchTransactions}
            assetPlatforms={assetPlatforms}
            coingeckoToDuneChainMap={COINGECKO_TO_DUNE_CHAIN_MAP}
            platformToChainId={PLATFORM_TO_CHAIN_ID}
            setSelectedWallet={setSelectedWallet}
            setWalletBalances={setWalletBalances}
            setTransactions={setTransactions}
            setWalletBalancesError={setWalletBalancesError}
            setTransactionsError={setTransactionsError}
            setWalletAddress={setWalletAddress}
            onClose={() => {
              setSelectedWallet(null);
              setWalletBalances([]);
              setTransactions(null);
              setWalletBalancesError(null);
              setTransactionsError(null);
              setWalletAddress('');
            }}
          />

          {/* Modals for Analysis and Prediction */}
          <Modal
            isOpen={!!analysis}
            onClose={() => {
              setAnalysis(null);
              setAnalysisLinks([]);
            }}
            title="Analysis"
            content={analysis}
            links={analysisLinks}
          />
          <Modal
            isOpen={!!prediction}
            onClose={() => setPrediction(null)}
            title="Prediction"
            content={prediction}
          />
          {isAnalyzing && <LoadingOverlay message="Analyzing token..." />}
          {isPredicting && <LoadingOverlay message="Predicting price trend..." />}
        </div>
      )}
      <ToastContainer position="top-center" autoClose={5000} />
    </motion.div>
  );
};

export default React.memo(MarketTab);