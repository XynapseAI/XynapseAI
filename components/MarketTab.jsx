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
import WalletBalances from './WalletBalances';
import Modal from './Modal';
import '../styles/MarketTab.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { formatDistanceToNow } from 'date-fns';
import { GECKOTERMINAL_CHAIN_MAPPING, CHAIN_ID_TO_NAME, CHAIN_EXPLORER_MAP } from '../utils/constants';
import { SkeletonLoader, getExplorerUrls, formatPrice, truncateAddress, truncateHash, isValidToken } from '../utils/helpers';
import 'react-loading-skeleton/dist/skeleton.css';

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

const CustomTooltip = ({ active, payload, label, currency }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-black/80 p-2 rounded border border-white/20 text-white text-sm backdrop-blur-lg font-jetbrains">
        <p>{label}</p>
        <p>
          Price: <span className="font-bold">{formatPrice(Math.floor(payload[0].value), currency)}</span>
        </p>
      </div>
    );
  }
  return null;
};

const MarketTab = ({ recaptchaRef, initialTokenSlug, onTokenSelect, toast, initialTokenData }) => {
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
    setSelectedToken,
    setSelectedWallet,
    setWalletBalances,
    setTransactions,
    setWalletBalancesError,
    setTransactionsError,
    fetchPublicTreasuryData,
    fetchTickerData,
    fetchPriceHistory,
    fetchTrendingTokens,
    isLoadingSelectedToken,
    localCache,
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
    trendingTokens,
    isLoadingTrending,
    trendingError,
    NON_EVM_CHAINS,
  } = useMarketTabLogic({ recaptchaRef, toast, initialTokenData, toast });

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
  const [hoveredToken, setHoveredToken] = useState(null);
  const [isTrendingHovered, setIsTrendingHovered] = useState(false);
  const trendingRef = useRef(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [tooltipToken, setTooltipToken] = useState(null);
  const tokenRefs = useRef({});
  const lastFetchedSlugRef = useRef(null);
  const [availableCurrencies] = useState([
    'usd', 'eth', 'btc', 'eur', 'bnb', 'cny', 'gbp', 'hkd', 'idr', 'jpy',
    'krw', 'kwd', 'mmk', 'mxn', 'myr', 'ngn', 'nok', 'nzd', 'pln', 'rub',
    'sar', 'sek', 'sgd', 'sol', 'thb', 'try', 'twd', 'uah', 'vef', 'vnd',
    'xag', 'xau'
  ]);

  useEffect(() => {
    if (
      initialTokenSlug !== lastFetchedSlugRef.current ||
      trendingTokens.length === 0
    ) {
      fetchTrendingTokens((err) => {
        if (err) {
          console.error('Failed to fetch trending tokens:', { error: err.message });
          toast.error('Failed to load trending tokens.', { position: 'top-center', autoClose: 3000 });
        }
      });
      lastFetchedSlugRef.current = initialTokenSlug;
    }
  }, [initialTokenSlug, fetchTrendingTokens, trendingTokens.length, toast]);

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

  const updateTooltipPosition = (tokenId, index) => {
    const tokenElement = tokenRefs.current[`${tokenId}-${index}`];
    if (tokenElement) {
      const rect = tokenElement.getBoundingClientRect();
      setTooltipPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + rect.width / 2 + window.scrollX,
      });
    }
  };

  const TrendingTooltip = ({ token, position }) => {
    if (!token) return null;

    return createPortal(
      <motion.div
        className="trending-tooltip border border-white/20 bg-black/80 p-2 rounded-xl text-white font-jetbrains backdrop-blur-lg shadow-neon-lg"
        style={{
          position: 'absolute',
          top: `${position.top}px`,
          left: `${position.left}px`,
          transform: 'translateX(-50%)',
          zIndex: 1000,
        }}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 5 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex items-center gap-1 mb-1">
          <img
            src={token.large}
            alt={`${token.symbol} logo`}
            className="w-5 h-5 rounded-full"
            onError={(e) => {
              logger.error('Token large logo failed to load:', { symbol: token.symbol, src: token.large });
              e.target.src = '/fallback-image.png';
            }}
          />
          <div>
            <div className="font-bold text-[10px]">{token.symbol.toUpperCase()}</div>
            <div className="text-gray-500 text-[8px]">Rank: {token.market_cap_rank || 'N/A'}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 text-[9px]">
          <div>
            <span className="text-gray-400">Price (USD):</span>
            <span className="block font-medium">${token.price.toFixed(4)}</span>
          </div>
          <div>
            <span className="text-gray-500">24h Change:</span>
            <span
              className={`block font-medium ${token.price_change_percentage_24h >= 0 ? 'text-green-500' : 'text-red-500'}`}
            >
              {token.price_change_percentage_24h.toFixed(2)}%
            </span>
          </div>
        </div>
      </motion.div>,
      document.body
    );
  };

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
    return () => window.removeEventListener('resize', checkMobile);
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
    if (selectedToken && timeRange && currency) {
      logger.log('Fetching price history:', { tokenId: selectedToken.id, days: timeRange, currency });
      setIsChartLoading(true);
      const { chain } = getAvailableChains().find((c) => c.value === selectedChain) || {};
      const tokenId = chain && selectedToken.detail_platforms[chains.find((c) => c.value === chain)?.coingeckoId]?.contract_address
        ? `${chains.find((c) => c.value === chain)?.coingeckoId}/${selectedToken.detail_platforms[chains.find((c) => c.value === chain)?.coingeckoId].contract_address}`
        : selectedToken.id;
      fetchPriceHistory(tokenId, timeRange, currency, (err, data) => {
        if (err) {
          logger.error('Price history fetch failed:', { error: err.message });
          toast.error(err.message, { position: 'top-center', autoClose: 3000 });
        }
        setIsChartLoading(false);
      });
    }
  }, [selectedToken, timeRange, currency, selectedChain, fetchPriceHistory, getAvailableChains, chains]);

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
      <div className="w-full mb-1 mt-2 sm:mt-1 h-auto">
        <div className="flex flex-col gap-2">
          <div className="flex flex-row items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 flex-shrink-0">
              <h2 className="text-[8px] sm:text-[10px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-1.5 rounded">
                Crypto
              </h2>
              <span className="text-gray-400">|</span>
              <button
                className="text-[8px] sm:text-[10px] font-bold text-gray-400 uppercase cursor-not-allowed flex items-center gap-1 transition-colors duration-300"
                disabled
                aria-label="Stock tab (coming soon)"
              >
                Stock <span className="text-[6px] sm:text-[8px] text-gray-500">(Soon)</span>
              </button>
            </div>
            <div className="flex flex-row items-center gap-2 sm:gap-3 flex-1 justify-end">
              <div className="relative" ref={chainDropdownRef}>
                <motion.button
                  onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
                  className={`text-white px-1.5 sm:px-2 py-0.5 sm:py-1 text-[8px] sm:text-[10px] flex items-center gap-1 sm:gap-2 border-2 border-white/10 bg-black/60 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300 rounded-xl w-auto ${selectedToken?.id && ['bitcoin', 'ethereum'].includes(selectedToken.id.toLowerCase())
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                    }`}
                  disabled={
                    !selectedToken ||
                    (selectedToken.id && ['bitcoin', 'ethereum'].includes(selectedToken.id.toLowerCase()))
                  }
                  aria-label="Select chain"
                  whileHover={{ scale: 1 }}
                >
                  {selectedChain ? (
                    <>
                      <img
                        src={getPlatformImage(selectedChain)}
                        alt={`${chains.find((c) => c.value === selectedChain)?.label || 'Chain'} logo`}
                        className="w-3 sm:w-4 h-3 sm:h-4 rounded-full"
                        onError={(e) => {
                          logger.error('Chain logo failed to load:', {
                            chain: selectedChain,
                            src: getPlatformImage(selectedChain),
                          });
                          e.target.src = '/fallback-image.png';
                        }}
                      />
                      <span className="text-[8px] sm:text-[10px] font-medium truncate">
                        {chains.find((c) => c.value === selectedChain)?.label || 'Chain'}
                      </span>
                    </>
                  ) : (
                    <div className="w-3 sm:w-4 h-3 sm:h-4 bg-gray-700 rounded-full animate-pulse"></div>
                  )}
                  <span className="text-[8px] sm:text-[10px] ml-auto">{isChainDropdownOpen ? '▲' : '▼'}</span>
                </motion.button>
                {isChainDropdownOpen && (
                  <div className="absolute z-50 mt-2 w-32 sm:w-48 max-h-48 sm:max-h-64 overflow-y-auto custom-scrollbar border border-white/10 bg-black/60 backdrop-blur-2xl rounded-lg shadow-neon-lg">
                    {getAvailableChains().length === 0 ? (
                      <div className="px-3 py-2 text-gray-400 text-[8px] sm:text-[10px]">
                        No supported chains available
                      </div>
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
                            className="flex items-center w-full text-left px-3 py-2 hover:bg-neon-blue/20 text-white text-[8px] sm:text-[10px] font-medium transition-all duration-300 rounded"
                            whileHover={{ scale: 1.02 }}
                          >
                            <img
                              src={chain.image}
                              alt={`${chain.label} logo`}
                              className="w-3 sm:w-4 h-3 sm:h-4 rounded-full mr-2"
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
              <div className="relative flex items-center flex-1 max-w-[150px]">
                <input
                  type="text"
                  placeholder="Search wallet (0x...)"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  className="text-white px-2 sm:px-3 py-0.5 sm:py-1 text-[8px] sm:text-[10px] w-full border-2 border-white/10 bg-black/60 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-neon-blue/50 transition-all duration-300 rounded-xl pr-6 sm:pr-8"
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
                  className="absolute right-1 sm:right-2 text-white p-0.5 sm:p-1 hover:bg-neon-blue/30 transition-all duration-300 rounded"
                  aria-label="Search wallet"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-2.5 sm:h-3 w-2.5 sm:w-3"
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
          <div className="relative w-full trending-container" ref={trendingRef}>
            {isLoadingTrending && !trendingTokens?.length ? (
              <div className="flex items-center justify-start h-8 gap-2">
                {/* SkeletonLoader commented out as in original */}
              </div>
            ) : trendingError ? (
              <div className="text-[10px] text-center">
                <p className="text-red-500">{trendingError}</p>
                <motion.button
                  onClick={() => fetchTrendingTokens()}
                  className="mt-2 px-4 py-1 text-white text-[10px] border border-neon-blue/50 rounded-xl hover:bg-neon-blue/30"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Retry
                </motion.button>
              </div>
            ) : trendingTokens.length === 0 ? (
              <div className="text-gray-400 text-[10px] text-center">No trending tokens available.</div>
            ) : (
              <motion.div
                className="flex items-center whitespace-nowrap w-full"
                animate={isTrendingHovered ? { x: 0 } : { x: ['0%', '-100%'] }}
                transition={{
                  x: {
                    repeat: Infinity,
                    repeatType: 'loop',
                    duration: trendingTokens.length * 4,
                    ease: 'linear',
                  },
                }}
                style={{ display: 'inline-flex' }}
                onMouseEnter={() => {
                  setIsTrendingHovered(true);
                  logger.log('Mouse entered trending container');
                }}
                onMouseLeave={() => {
                  setIsTrendingHovered(false);
                  setTooltipToken(null);
                  logger.log('Mouse left trending container');
                }}
                onTouchStart={() => {
                  setIsTrendingHovered(true);
                  logger.log('Touch start on trending container');
                }}
                onTouchEnd={() => {
                  setIsTrendingHovered(false);
                  setTooltipToken(null);
                  logger.log('Touch end on trending container');
                }}
              >
                {[...trendingTokens, ...trendingTokens].map((token, index) => (
                  <motion.div
                    key={`${token.id}-${index}`}
                    ref={(el) => (tokenRefs.current[`${token.id}-${index}`] = el)}
                    className="relative mx-2 sm:mx-2.5 flex items-center gap-1 px-1.5 py-0.5 bg-black/60 backdrop-blur-md rounded-lg cursor-pointer"
                    onClick={() => {
                      handleTokenSelect(token);
                      logger.log('Clicked trending token:', { id: token.id, index });
                    }}
                    onMouseEnter={() => {
                      setHoveredToken(`${token.id}-${index}`);
                      setTooltipToken(token);
                      updateTooltipPosition(token.id, index);
                      logger.log('Hover token:', { id: token.id, index });
                    }}
                    onMouseLeave={() => {
                      setHoveredToken(null);
                      setTooltipToken(null);
                      logger.log('Leave token:', { id: token.id, index });
                    }}
                    onTouchStart={() => {
                      setHoveredToken(`${token.id}-${index}`);
                      setTooltipToken(token);
                      updateTooltipPosition(token.id, index);
                      logger.log('Touch token:', { id: token.id, index });
                    }}
                    onTouchEnd={() => {
                      setHoveredToken(null);
                      setTooltipToken(null);
                      logger.log('Leave token:', { id: token.id, index });
                    }}
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 1 }}
                  >
                    <img
                      src={token.thumb || token.image?.thumb || '/fallback-image.png'}
                      alt={`${token.symbol} logo`}
                      className="w-3 sm:w-4 h-3 sm:h-4 rounded-full"
                      onError={(e) => {
                        logger.error('Token logo failed to load:', { symbol: token.symbol, src: token.thumb });
                        e.target.src = '/fallback-image.png';
                      }}
                    />
                    <span className="text-white text-[8px] sm:text-[10px] font-medium">
                      {token.symbol.toUpperCase()}
                    </span>
                    <span
                      className={`text-[8px] sm:text-[9px] font-medium ${token.price_change_percentage_24h >= 0 ? 'text-green-500' : 'text-red-500'}`}
                    >
                      {token.price_change_percentage_24h.toFixed(2)}%
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            )}
            <TrendingTooltip token={tooltipToken} position={tooltipPosition} />
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
          <div
            className={`flex flex-col gap-2 sm:gap-4 max-h-[800px] min-h-[780px] sm:max-h-[calc(100%-3rem)] overflow-y-auto custom-scrollbar`}
          >
            <div
              className={`border border-white/10 p-4 sm:p-4 rounded-xl min-h-[280px] sm:min-h-[290px] sm:max-h-[290px] overflow-y-auto custom-scrollbar bg-black/60 backdrop-blur-2xl relative`}
            >
              {isLoadingSelectedToken && !localCache.current[`token-metadata-${selectedToken?.id}`]?.data ? (
                <SkeletonLoader count={5} isMobile={isMobile} />
              ) : selectedToken || localCache.current[`token-metadata-${selectedToken?.id}`]?.data ? (
                <div className="relative">
                  <div className="absolute top-1 right-1 w-32 sm:w-40" ref={dropdownRef}>
                    <motion.button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className={`text-white px-2 sm:px-2 py-1 sm:py-1 text-[10px] sm:text-xs flex items-center w-full border-2 border-white/10 bg-black/60 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300 rounded-xl`}
                      aria-label="Select token"
                      whileHover={{ scale: 1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      {selectedToken || localCache.current[`token-metadata-${selectedToken?.id}`]?.data ? (
                        <>
                          <img
                            src={selectedToken?.image || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.image}
                            alt={`${selectedToken?.symbol || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol} logo`}
                            className="w-4 sm:w-5 h-4 sm:h-5 rounded-full mr-2"
                            onError={(e) => (e.target.src = '/fallback-image.png')}
                          />
                          {(selectedToken?.symbol || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol)?.toUpperCase() || 'Token'}
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
                            .filter(isValidToken)
                            .map((token) => (
                              <motion.button
                                key={token.id}
                                onClick={() => handleTokenSelect(token)}
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
                            <p className="text-[8px] sm:text-[10px] text-gray-400 text-center p-2"></p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mb-2 sm:mb-2">
                    <div className="flex items-center gap-2">
                      {(selectedToken?.image || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.image) && (
                        <motion.img
                          src={selectedToken?.image || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.image}
                          alt={`${selectedToken?.symbol || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol} logo`}
                          className="w-6 sm:w-7 h-6 sm:h-7 rounded-full"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.4 }}
                        />
                      )}
                      <div>
                        <h4 className="text-base sm:text-sm font-bold text-white tracking-tight">
                          {(selectedToken?.name || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.name)} (
                          {(selectedToken?.symbol || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol)?.toUpperCase() || 'Token'})
                        </h4>
                        {(selectedToken?.market_cap_rank || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap_rank) && (
                          <span className="text-[10px] sm:text-xs text-gray-400">
                            Rank #{selectedToken?.market_cap_rank || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap_rank}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-2 mb-2 sm:mb-2">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <p className="text-sm sm:text-sm font-bold text-yellow">
                          {formatPrice(
                            Math.floor(selectedToken?.current_price?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.current_price?.[currency]),
                            currency
                          )}
                        </p>
                        <span
                          className={`text-[9px] sm:text-[9px] font-medium ${(selectedToken?.price_change_percentage_24h_in_currency?.[currency] ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.price_change_percentage_24h_in_currency?.[currency]) >= 0
                            ? 'text-green-500'
                            : 'text-red-500'
                            }`}
                        >
                          {(selectedToken?.price_change_percentage_24h_in_currency?.[currency] ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.price_change_percentage_24h_in_currency?.[currency]) != null
                            ? `${(selectedToken?.price_change_percentage_24h_in_currency?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.price_change_percentage_24h_in_currency?.[currency]).toFixed(2)}% (24h)`
                            : 'N/A'}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-end items-end">
                      <div className="flex items-center gap-2">
                        <label htmlFor="currency-select" className="text-[10px] sm:text-[10px] text-gray-500">Currency:</label>
                        <select
                          id="currency-select"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                          className="text-white px-2 py-1 text-[10px] sm:text-[10px] border-2 border-white/10 bg-black/60 backdrop-blur-2xl rounded-xl focus:outline-none focus:ring-2 focus:ring-neon-blue/50 custom-scrollbar"
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
                      <div className="grid grid-cols-1 gap-1 sm:gap-2 text-[10px] sm:text-[9px]">
                        <p className="text-gray-500">
                          Market Cap:{' '}
                          <span className="text-white font-semibold">
                            {(selectedToken?.market_cap?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap?.[currency]) != null
                              ? `${currency.toUpperCase()} ${(selectedToken?.market_cap?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap?.[currency]).toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          Fully Diluted Valuation:{' '}
                          <span className="text-white font-semibold">
                            {(selectedToken?.fully_diluted_valuation?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.fully_diluted_valuation?.[currency]) != null
                              ? `${currency.toUpperCase()} ${(selectedToken?.fully_diluted_valuation?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.fully_diluted_valuation?.[currency]).toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          24h Volume:{' '}
                          <span className="text-white font-semibold">
                            {(selectedToken?.total_volume?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.total_volume?.[currency]) != null
                              ? `${currency.toUpperCase()} ${(selectedToken?.total_volume?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.total_volume?.[currency]).toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div>
                      <h5 className="text-[11px] sm:text-[10px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-1">
                        Supply Stats
                      </h5>
                      <div className="grid grid-cols-1 gap-1 sm:gap-2 text-[10px] sm:text-[9px]">
                        <p className="text-gray-500">
                          Circulating Supply:{' '}
                          <span className="text-white font-semibold">
                            {(selectedToken?.circulating_supply ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.circulating_supply) != null
                              ? `${(selectedToken?.circulating_supply ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.circulating_supply).toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          Total Supply:{' '}
                          <span className="text-white font-semibold">
                            {(selectedToken?.total_supply ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.total_supply) != null
                              ? `${(selectedToken?.total_supply ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.total_supply).toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          Max Supply:{' '}
                          <span className="text-white font-semibold">
                            {(selectedToken?.max_supply ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.max_supply) != null
                              ? `${(selectedToken?.max_supply ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.max_supply).toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div>
                      <h5 className="text-[11px] sm:text-[10px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-1">
                        All-Time Stats
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-2 text-[10px] sm:text-[9px]">
                        <p className="text-gray-500">
                          ATH:{' '}
                          <span
                            className={
                              typeof (selectedToken?.ath?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath?.[currency]) === 'number'
                                ? (selectedToken?.ath_change_percentage?.[currency] ||
                                  localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath_change_percentage?.[currency]) >= 0
                                  ? 'text-red-500'
                                  : 'text-green-500'
                                : 'text-white'
                            }
                          >
                            {typeof (selectedToken?.ath?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath?.[currency]) === 'number'
                              ? `${currency.toUpperCase()} ${(selectedToken?.ath?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath?.[currency]).toLocaleString('en-US')}`
                              : 'N/A'}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          ATL:{' '}
                          <span
                            className={
                              typeof (selectedToken?.atl?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl?.[currency]) === 'number'
                                ? (selectedToken?.atl_change_percentage?.[currency] ||
                                  localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl_change_percentage?.[currency]) >= 0
                                  ? 'text-red-500'
                                  : 'text-green-500'
                                : 'text-white'
                            }
                          >
                            {typeof (selectedToken?.atl?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl?.[currency]) === 'number'
                              ? `${currency.toUpperCase()} ${(selectedToken?.atl?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl?.[currency]).toLocaleString('en-US')}`
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
                  <div className="absolute bottom-2 right-2 flex gap-2 social-links">
                    {(selectedToken?.links?.twitter_screen_name || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.twitter_screen_name) && (
                      <a
                        href={`https://twitter.com/${selectedToken?.links?.twitter_screen_name || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.twitter_screen_name}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80"
                        title="Twitter"
                      >
                        <img
                          src="/logos/x.png"
                          alt="Twitter"
                          className="w-3 h-3"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                        />
                      </a>
                    )}
                    {(selectedToken?.links?.chat_url?.[0] || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.chat_url?.[0]) && (
                      <a
                        href={selectedToken?.links?.chat_url?.[0] || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.chat_url?.[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80"
                        title="Discord"
                      >
                        <img
                          src="/logos/discord.png"
                          alt="Discord"
                          className="w-3 h-3"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                        />
                      </a>
                    )}
                    {(selectedToken?.links?.homepage?.[0] || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.homepage?.[0]) && (
                      <a
                        href={selectedToken?.links?.homepage?.[0] || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.homepage?.[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80"
                        title="Website"
                      >
                        <img
                          src="/logos/website.png"
                          alt="Website"
                          className="w-3 h-3"
                          onError={(e) => (e.target.src = '/fallback-image.png')}
                        />
                      </a>
                    )}
                    {(selectedToken?.links?.repos_url?.github?.[0] || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.repos_url?.github?.[0]) && (
                      <a
                        href={selectedToken?.links?.repos_url?.github?.[0] || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.repos_url?.github?.[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neon-blue hover:text-neon-blue/80"
                        title="GitHub"
                      >
                        <img
                          src="/logos/github.png"
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
              className="border border-white/10 p-2 sm:p-3 rounded-xl flex-1 min-h-[320px] sm:min-h-[280px] max-h-[200px] sm:max-h-[280px] bg-black/60 backdrop-blur-2xl overflow-y-auto custom-scrollbar"
            >
              <div className="flex flex-col items-center mb-2 sm:mb-2 mt-4 sm:mt-0">
                <div className="flex flex-col sm:flex-row justify-between items-center w-full max-w-[90%] sm:max-w-[600px] gap-2 sm:gap-3">
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
                  <div className="flex items-center justify-center gap-2 sm:gap-4 mt-2 sm:mt-6 mb-2 sm:mb-0">
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
                <div className="h-48 sm:h-58 flex items-center justify-center">
                  {/* <SkeletonLoader
                    count={1}
                    isMobile={isMobile}
                    className="w-full h-full rounded-lg bg-gray-800/50 animate-pulse"
                  /> */}
                </div>
              ) : priceHistory && priceHistory.length > 0 ? (
                <div className="h-48 sm:h-58">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={priceHistory} margin={{ top: 10, right: 15, bottom: 5, left: isMobile ? 0 : 10 }}>
                      <XAxis dataKey="title" stroke="#FFFFFF" tick={false} hide={true} />
                      <YAxis
                        stroke="#FFFFFF"
                        tick={{ fontSize: isMobile ? 6 : 8, fill: '#FFFFFF' }}
                        domain={[(dataMin) => dataMin * 0.99, (dataMax) => dataMax * 1.01]}
                        width={isMobile ? 50 : 60}
                        tickCount={10}
                        tickFormatter={(value) => {
                          return `${currency.toUpperCase()} ${Math.floor(value).toLocaleString('en-US')}`;
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
          <div
            className={`flex flex-col border border-white/10 rounded-xl max-h-[50vh] min-h-[80vh] sm:max-h-[calc(100%-5rem)] overflow-y-auto custom-scrollbar bg-black/60 backdrop-blur-2xl shadow-neon-sm`}
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
                    className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-[11px] font-medium transition-all duration-500 ease-in-out ${activeMarketTab === 'holders' ? 'border-b-2 border-white' : 'text-white hover:bg-neon-blue/30'
                      }`}
                    whileHover={{ scale: 1 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                  >
                    TOP HOLDERS
                  </motion.button>
                  <motion.button
                    onClick={() => {
                      setActiveMarketTab('cex');
                      setShowTrades(false);
                    }}
                    className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-[11px] font-medium transition-all duration-500 ease-in-out ${activeMarketTab === 'cex' ? 'border-b-2 border-white' : 'text-white hover:bg-neon-blue/30'
                      }`}
                    whileHover={{ scale: 1 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                  >
                    CEX
                  </motion.button>
                  <motion.button
                    onClick={handleDexTabClick}
                    className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-[11px] font-medium transition-all duration-500 ease-in-out ${activeMarketTab === 'dex' ? 'border-b-2 border-white' : 'text-white hover:bg-neon-blue/30'
                      }`}
                    whileHover={{ scale: 1 }}
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
                      <div className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
                        Loading top holders data...
                      </div>
                    ) : onChainError ? (
                      <div className="text-[10px] sm:text-xs text-center p-2 sm:p-4">
                        <p className="text-red-500">{onChainError}</p>
                      </div>
                    ) : onChainData.topHolders && onChainData.topHolders.length > 0 ? (
                      <table className="w-full text-[10px] sm:text-[11px]">
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
                                    {Math.floor(holder.balance).toLocaleString('en-US')}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
                        No top holders data available for {selectedToken?.symbol?.toUpperCase() || 'selected token'} on{' '}
                        {chains.find((c) => c.value === selectedChain)?.label || 'selected chain'}.
                      </p>
                    )}
                  </div>
                )}
                {activeMarketTab === 'cex' && (
                  <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar smooth-scroll">
                    {tickerError ? (
                      <div className="text-[10px] sm:text-xs text-center p-2 sm:p-4">
                        <p className="text-red-500">{tickerError}</p>
                        <motion.button
                          onClick={() => fetchTickerData(selectedToken?.id)}
                          className="mt-2 px-4 py-1 text-white text-[10px] sm:text-xs border border-neon-blue/50 rounded-xl hover:bg-neon-blue/30"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          Retry
                        </motion.button>
                      </div>
                    ) : isLoadingTickers && !tickerData?.length ? (
                      <SkeletonLoader count={5} isMobile={isMobile} />
                    ) : tickerData.length > 0 ? (
                      <div className="table-container">
                        <table className="w-full text-[10px] sm:text-[11px]">
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
                                    {ticker.converted_last.usd != null ? `$${Math.floor(ticker.converted_last.usd).toLocaleString('en-US')}` : 'N/A'}
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
                    {dexError ? (
                      <div className="text-[10px] sm:text-xs text-center p-2 sm:p-4">
                        <p className="text-red-500">{dexError}</p>
                        <motion.button
                          onClick={() => {
                            const { chain, tokenAddress } = getDefaultChainAndAddress(selectedToken, selectedChain);
                            if (chain && tokenAddress) {
                              fetchDexData(chain, tokenAddress);
                            }
                          }}
                          className="mt-2 px-4 py-1 text-white text-[10px] sm:text-xs border border-neon-blue/50 rounded-xl hover:bg-neon-blue/30"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          Retry
                        </motion.button>
                      </div>
                    ) : isLoadingDex && !dexData.trades?.length ? (
                      <SkeletonLoader count={5} isMobile={isMobile} />
                    ) : dexData.trades.length > 0 ? (
                      <table className="w-full text-[10px] sm:text-[11px]">
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
                                    d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"
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
                            <th className="px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium w-[80px] sm:w-[100px]">
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
                                  {/* <span className="truncate">
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
                                  </span> */}
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
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[100px] sm:w-[120px]">
                                <div className="flex flex-col gap-0.5">
                                  <span className="truncate">
                                    {Math.floor(parseFloat(trade.kind === 'sell' ? trade.from_token_amount : trade.to_token_amount || 0)).toLocaleString('en-US')}{' '}
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
                                  <div className="flex items-center gap-1 text-[8px] sm:text-[9px]">
                                    <span className="truncate text-gray-500">
                                      ${Math.floor(parseFloat(trade.volume_in_usd)).toLocaleString('en-US')}
                                    </span>
                                    <span
                                      className={`inline-block px-1 py-0.5 rounded-full font-medium ${trade.kind === 'buy' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}
                                    >
                                      {trade.kind.charAt(0).toUpperCase() + trade.kind.slice(1)}
                                    </span>
                                  </div>
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
                                  <span className="truncate text-[9px] sm:text-[9px] text-gray-500 text-center">
                                    {formatDistanceToNow(new Date(trade.block_timestamp), { addSuffix: true })}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 sm:px-3 py-1 sm:py-2 text-gray-200 w-[80px] sm:w-[100px]">
                                <motion.button
                                  onClick={() => trade.pool_address && handlePoolClick(trade.pool_address)}
                                  className="flex items-center gap-1 text-[10px] sm:text-xs"
                                  title={
                                    dexData.pools.find((p) => p.attributes.address === trade.pool_address)?.attributes
                                      .name || 'View Pool Details'
                                  }
                                  disabled={!trade.pool_address || !dexData.poolTokens[trade.pool_address]}
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
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
                                      <div className="flex items-center gap-1">
                                        <img
                                          src={token1.image_url}
                                          alt={`${token1.symbol} logo`}
                                          className="w-4 sm:w-5 h-4 sm:h-5 rounded-full flex-shrink-0"
                                          onError={(e) => (e.target.src = '/fallback-image.png')}
                                        />
                                        <span className="text-gray-400">/</span>
                                        <img
                                          src={token2.image_url}
                                          alt={`${token2.symbol} logo`}
                                          className="w-4 sm:w-5 h-4 sm:h-5 rounded-full flex-shrink-0"
                                          onError={(e) => (e.target.src = '/fallback-image.png')}
                                        />
                                      </div>
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
    </motion.div>
  );
};

export default React.memo(MarketTab);