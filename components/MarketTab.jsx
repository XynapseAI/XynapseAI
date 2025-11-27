// Upgraded components/MarketTab.jsx (Optimized for 2025: Lighter, Smoother)
"use client"
import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { useSession } from "next-auth/react"
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts"
import { createPortal } from "react-dom"
import "highlight.js/styles/github-dark.css"
import { useMarketTabLogic } from "./MarketTabLogic"
import { SkeletonLoader } from "../utils/helpers" // For Suspense loading
import "../styles/MarketTab.css"
import { ToastContainer } from "react-toastify"
import "react-toastify/dist/ReactToastify.css"
import { formatDistanceToNow } from "date-fns"
import { GECKOTERMINAL_CHAIN_MAPPING, CHAIN_ID_TO_NAME } from "../utils/constants"
import {
  getExplorerUrls,
  formatPrice,
  truncateAddress,
  isValidToken,
  LoadingOverlay,
} from "../utils/helpers"
import "react-loading-skeleton/dist/skeleton.css"
import { useCurrency } from './CurrencyContext';
import { logger } from '../utils/clientLogger';
import remarkGfm from 'remark-gfm';
import ReactMarkdown from "react-markdown";
import { Virtuoso } from 'react-virtuoso';
// Dynamic imports for heavy components (Next.js 15 opt)
const WalletBalances = dynamic(() => import("./WalletBalances"), {
  ssr: false,
  loading: () => <SkeletonLoader count={3} />
});
const Modal = dynamic(() => import("./Modal"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-64"><SkeletonLoader height={20} width={200} /></div>
});
const LoginPrompt = dynamic(() => import('./LoginPrompt'), { ssr: false });
const UniversalSearch = dynamic(() => import("./UniversalSearch"), { ssr: false });
const CustomTooltip = ({ active, payload, label, currency }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] p-3 rounded-2xl text-[#FFF] text-sm font-medium shadow-2xl transition-opacity duration-200">
        <p className="text-[#D4D4D4] text-xs mb-1">{label}</p>
        <p className="text-[#FFF] font-semibold">
          Price: <span className="text-emerald-400">{formatPrice(payload[0].value, currency, 8)}</span>
        </p>
      </div>
    )
  }
  return null
}
// Downsample function for large chart data (built-in JS, no dep)
const downsampleData = (data, maxPoints = 200) => {
  if (!data || data.length <= maxPoints) return data;
  const step = Math.floor(data.length / maxPoints);
  return data.filter((_, i) => i % step === 0);
};
const MarketTab = ({ recaptchaRef, initialTokenSlug, onTokenSelect, toast, initialTokenData }) => {
  const { data: session } = useSession()
  const { currency } = useCurrency();
  const [autoAnimateRef] = useAutoAnimate() // Returns [ref, enableFn]; we use ref only
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
    fetchOnChainData,
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
    setIsLoadingWalletBalances,
    lastDexFetchTime,
    trendingTokens,
    isLoadingTrending,
    trendingError,
    NON_EVM_CHAINS,
    analysisLogs,
    setIsAnalyzing,
    setIsPredicting,
    mempoolTransactions,
    isLoadingMempool,
    mempoolError,
    fetchMempoolTransactions,
    loadMoreDex,
    hasMoreDex,
    isLoadingMoreDex,
    setIsLoadingMoreDex,
    setHasMoreDex,
    currentDexPage,
    setCurrentDexPage,
    getPaginatedTrades,
    goToDexPage,
    getTotalDexPages,
    setDexData,
    fetchTrendingTokens,
    isLoadingPage,
    setIsLoadingPage,
    loadMoreDexData,
  } = useMarketTabLogic({ recaptchaRef, toast, initialTokenData, toast })
  const dropdownRef = useRef(null)
  const chainDropdownRef = useRef(null)
  const prevTradesRef = useRef([])
  const trendingRef = useRef(null)
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false)
  const [isChartLoading, setIsChartLoading] = useState(false)
  const [activeMarketTab, setActiveMarketTab] = useState("holders")
  const [showTrades, setShowTrades] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [selectedPool, setSelectedPool] = useState(null)
  const [highLowData, setHighLowData] = useState({ high: null, low: null, percentageChange: null })
  const [hoveredToken, setHoveredToken] = useState(null)
  const [isTrendingHovered, setIsTrendingHovered] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
  const [tooltipToken, setTooltipToken] = useState(null)
  const tokenRefs = useRef({})
  const lastFetchedSlugRef = useRef(null)
  // AutoAnimate refs for lists
  const holdersListRef = useRef(null)
  const tradesListRef = useRef(null)
  const tickersListRef = useRef(null)
  const trendingListRef = useRef(null)
  // Map exchange IDs to match ClusterTab's EXCHANGE_MAPPING
  const EXCHANGE_MAPPING = {
    okx: "okex",
    bybit: "bybit_spot",
    binance: "binance",
    coinbase: "coinbase-exchange",
    kraken: "kraken",
    huobi: "huobi-global",
    kucoin: "kucoin",
    "gate.io": "gate-io",
    bitfinex: "bitfinex",
    uniswap: "uniswap",
    mtgox: "mtgox",
  };
  const mapExchangeId = (id) => EXCHANGE_MAPPING[id.toLowerCase()] || id.toLowerCase();
  // Helper function to get explorer URL and logo
  const getExplorerInfo = (chain, txHash, address) => {
    if (chain === 'bitcoin') {
      return {
        url: `https://mempool.space/tx/${txHash}`,
        logo: '/logos/mempool-logo.webp'
      };
    } else {
      const explorerUrls = getExplorerUrls(chain, txHash, address);
      return {
        url: explorerUrls.txUrl,
        logo: '/logos/etherscan-logo.webp'
      };
    }
  };
  // Helper function to get name tag info
  const getNameTagInfo = (address, chain) => {
    const normalizedAddress = address?.toLowerCase();
    if (!normalizedAddress) return { nameTag: null, image: null };
    if (chain === 'bitcoin') {
      // For Bitcoin, use btcNameTags from MarketTabLogic
      // Since btcNameTags is not directly available, we'll use the existing structure
      const nameTagData = nameTags[normalizedAddress] || {};
      return {
        nameTag: nameTagData.nameTag || null,
        image: nameTagData.image || null
      };
    } else {
      // For EVM chains, use existing nameTags
      const nameTagData = nameTags[normalizedAddress] || {};
      return {
        nameTag: nameTagData.nameTag || null,
        image: nameTagData.image || null
      };
    }
  };
  useEffect(() => {
    if (initialTokenSlug !== lastFetchedSlugRef.current || trendingTokens.length === 0) {
      fetchTrendingTokens((err) => {
        if (err) {
          console.error("Failed to fetch trending tokens:")
        }
      })
      lastFetchedSlugRef.current = initialTokenSlug
    }
  }, [initialTokenSlug, fetchTrendingTokens, trendingTokens.length, toast])
  useEffect(() => {
    if (initialTokenSlug) {
      const fetchTokenBySlug = async () => {
        setIsChartLoading(true)
        try {
          const response = await fetch(`/api/coingecko/token/${initialTokenSlug}`, {
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
          })
          const result = await response.json()
          if (!response.ok) {
            throw new Error(result.detail || "Failed to fetch token data")
          }
          setSelectedToken(result.data)
        } catch (err) {
          logger.error("Error fetching token by slug:", { slug: initialTokenSlug, error: err.message })
        } finally {
          setIsChartLoading(false)
        }
      }
      fetchTokenBySlug()
    }
  }, [initialTokenSlug, setSelectedToken])
  const updateTooltipPosition = useCallback((tokenId, index) => {
    const tokenElement = tokenRefs.current[`${tokenId}-${index}`];
    if (tokenElement) {
      const rect = tokenElement.getBoundingClientRect();
      setTooltipPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + rect.width / 2 + window.scrollX,
      });
    }
  }, []);
  const TrendingTooltip = ({ token, position }) => {
    if (!token) return null;
    return createPortal(
      <div
        className="fixed z-50 bg-[#0A0A0A]/40 backdrop-blur-md border border-[#FFFFFF20] p-4 rounded-2xl text-[#FFF] shadow-2xl transition-all duration-200"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          transform: "translateX(-50%)",
          opacity: token ? 1 : 0,
          visibility: token ? 'visible' : 'hidden',
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <Image
            src={token.large || "/placeholder.svg"}
            alt={`${token.symbol} logo`}
            className="w-8 h-8"
            width={32}
            height={32}
            unoptimized
          />
          <div>
            <div className="font-bold text-sm text-[#FFF]">{token.symbol.toUpperCase()}</div>
            <div className="text-[#D4D4D4] text-xs">Rank #{token.market_cap_rank || "N/A"}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <span className="text-[#D4D4D4] block">Price (USD)</span>
            <span className="font-semibold text-[#FFF]">${token.price.toFixed(4)}</span>
          </div>
          <div className="space-y-1">
            <span className="text-[#D4D4D4] block">24h Change</span>
            <span
              className={`font-semibold ${token.price_change_percentage_24h >= 0 ? "text-emerald-400" : "text-red-500"}`}
            >
              {token.price_change_percentage_24h.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>,
      document.body,
    )
  }
  const handleTokenSelect = (token) => {
    if (session) {
      debouncedHandleTokenSelect(token);
    } else {
      setSelectedToken(token);
    }
    if (onTokenSelect && token.id) {
      onTokenSelect(token.id);
    }
  };
  const handleChainSelect = useCallback(
    (chainValue) => {
      setSelectedChain(chainValue)
      setIsChainDropdownOpen(false)
    },
    [setSelectedChain, setIsChainDropdownOpen],
  )
  const getPlatformImage = (chainValue) => {
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || "ethereum"
    const chain = chains.find((c) => c.value === chainName)
    const imageUrl = chain?.image || "/fallback-image.webp"
    return imageUrl
  }
  const handleDexTabClick = useCallback(() => {
    if (!session) {
      setActiveMarketTab("dex");
      setShowTrades(false);
      return;
    }
    if (dexRequestCount >= 5 && Date.now() - lastDexRequestTime < 60 * 1000) {
      return;
    }
    setActiveMarketTab("dex");
    setShowTrades(false);
    if (selectedToken) {
      if (selectedToken.id === "bitcoin") {
        fetchMempoolTransactions(); // Ensure full load for Bitcoin
      } else {
        const { chain, tokenAddress } = getDefaultChainAndAddress(selectedToken, selectedChain);
        if (chain && tokenAddress) {
          fetchDexData(chain, tokenAddress, 1); // Load initial with page=1
        }
      }
    }
  }, [session, dexRequestCount, lastDexRequestTime, selectedToken, selectedChain, fetchMempoolTransactions, fetchDexData, getDefaultChainAndAddress, setActiveMarketTab, setShowTrades]);
  const handlePoolClick = (poolAddress) => {
    if (process.env.NODE_ENV === "development") {
    }
    const pool = dexData.pools.find((p) => p.attributes.address === poolAddress)
    if (pool) {
      setSelectedPool({
        address: poolAddress,
        tokens: dexData.poolTokens[poolAddress] || {},
        name: pool.attributes.name,
      })
    } else {
      if (process.env.NODE_ENV === "development") {
      }
    }
  }
  // Handle search result selection
  const handleSearchSelect = (result) => {
    if (result.type === "wallet" || result.type === "nametag") {
      const address = result.address?.toLowerCase();
      if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
        logger.log("Selected wallet address from search:", { address });
        setSelectedWallet(address);
        setWalletAddress(address);
      } else {
        logger.error("Invalid wallet address selected:", { address });
        toast.error("Invalid wallet address", { position: "top-center", autoClose: 3000 });
      }
    } else if (result.type === "exchange" || result.type === "organization") {
      const mappedId = mapExchangeId(result.exchangeId || result.id);
      window.open(`/cluster?exchangeId=${mappedId}`, '_blank');
    }
  }
  const renderPoolModalContent = () => {
    if (!selectedPool || !selectedPool.tokens) {
      return <p className="text-sm text-[#D4D4D4] text-center">No pool data available.</p>
    }
    const tokens = Object.values(selectedPool.tokens)
    if (tokens.length < 2) {
      return <p className="text-sm text-[#D4D4D4] text-center">Insufficient token data for this pool.</p>
    }
    const [token1, token2] = tokens
    return (
      <div className="text-sm text-[#FFF]">
        <h4 className="text-2xl font-bold text-[#FFF] mb-6 text-center">
          {token1.symbol}/{token2.symbol}
        </h4>
        <div className="flex flex-col sm:flex-row justify-between gap-6">
          <div className="flex-1 min-w-0">
            <h5 className="text-lg font-bold text-[#FFF] mb-4 flex items-center justify-center gap-3">
              <Image
                src={token1.image_url}
                alt={`${token1.symbol} logo`}
                className="w-8 h-8 rounded-full"
                width={32}
                height={32}
                unoptimized
              />
              {token1.symbol}
            </h5>
            <div className="space-y-4 text-center">
              <div className="bg-[#FFFFFF]/5 backdrop-blur-md rounded-xl p-4">
                <div className="text-[#D4D4D4] text-xs mb-1">Transaction Score</div>
                <div className="text-emerald-400 font-semibold">{token1.transaction_score || "N/A"}</div>
              </div>
              <div className="bg-[#FFFFFF]/5 backdrop-blur-md rounded-xl p-4">
                <div className="font-bold text-[#FFF] mb-3">HOLDERS</div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">Total Count:</span>
                    <span className="text-[#FFF]">{token1.holders?.count?.toLocaleString() || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">Top 10:</span>
                    <span className="text-[#FFF]">{token1.holders?.distribution_percentage?.top_10 || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">11-30:</span>
                    <span className="text-[#FFF]">{token1.holders?.distribution_percentage?.["11_30"] || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">31-50:</span>
                    <span className="text-[#FFF]">{token1.holders?.distribution_percentage?.["31_50"] || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">Rest:</span>
                    <span className="text-[#FFF]">{token1.holders?.distribution_percentage?.rest || "N/A"}%</span>
                  </div>
                  <div className="text-[#D4D4D4] text-xs pt-2 border-t border-[#FFFFFF10]">
                    Last Updated:{" "}
                    {token1.holders?.last_updated
                      ? new Date(token1.holders.last_updated).toLocaleString("en-US")
                      : "N/A"}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h5 className="text-lg font-bold text-[#FFF] mb-4 flex items-center justify-center gap-3">
              <Image
                src={token2.image_url}
                alt={`${token2.symbol} logo`}
                className="w-8 h-8 rounded-full ring-2 ring-[#FFFFFF20]"
                width={32}
                height={32}
                unoptimized
              />
              {token2.symbol}
            </h5>
            <div className="space-y-4 text-center">
              <div className="bg-[#FFFFFF]/5 backdrop-blur-md rounded-xl p-4">
                <div className="text-[#D4D4D4] text-xs mb-1">Transaction Score</div>
                <div className="text-emerald-400 font-semibold">{token2.transaction_score || "N/A"}</div>
              </div>
              <div className="bg-[#FFFFFF]/5 backdrop-blur-md rounded-xl p-4">
                <div className="font-bold text-[#FFF] mb-3">HOLDERS</div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">Total Count:</span>
                    <span className="text-[#FFF]">{token2.holders?.count?.toLocaleString() || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">Top 10:</span>
                    <span className="text-[#FFF]">{token2.holders?.distribution_percentage?.top_10 || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">11-30:</span>
                    <span className="text-[#FFF]">{token2.holders?.distribution_percentage?.["11_30"] || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">31-50:</span>
                    <span className="text-[#FFF]">{token2.holders?.distribution_percentage?.["31_50"] || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#D4D4D4]">Rest:</span>
                    <span className="text-[#FFF]">{token2.holders?.distribution_percentage?.rest || "N/A"}%</span>
                  </div>
                  <div className="text-[#D4D4D4] text-xs pt-2 border-t border-[#FFFFFF10]">
                    Last Updated:{" "}
                    {token2.holders?.last_updated
                      ? new Date(token2.holders.last_updated).toLocaleString("en-US")
                      : "N/A"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 640)
    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])
  useEffect(() => {
    prevTradesRef.current = dexData.trades
  }, [dexData.trades])
  useEffect(() => {
    if (selectedToken && timeRange && currency) {
      logger.log("Fetching price history:", { tokenId: selectedToken.id, days: timeRange, currency })
      setIsChartLoading(true)
      const tokenId = selectedToken.id
      fetchPriceHistory(tokenId, timeRange, currency, (err, data) => {
        if (err) {
          logger.error("Price history fetch failed:", { error: err.message })
        }
        setIsChartLoading(false)
      })
    }
  }, [selectedToken, timeRange, currency, fetchPriceHistory])
  useEffect(() => {
    if (!selectedToken) return
    const fetchHighLowData = async () => {
      try {
        const percentageFieldMap = {
          0.5: { currency: "price_change_percentage_1h_in_currency", fallback: "price_change_percentage_1h" },
          1: { currency: "price_change_percentage_24h_in_currency", fallback: "price_change_percentage_24h" },
          7: { currency: "price_change_percentage_7d_in_currency", fallback: "price_change_percentage_7d" },
          30: { currency: "price_change_percentage_30d_in_currency", fallback: "price_change_percentage_30d" },
          90: { currency: "price_change_percentage_90d_in_currency", fallback: "price_change_percentage_90d" },
          365: { currency: "price_change_percentage_1y_in_currency", fallback: "price_change_percentage_1y" },
        }
        const { currency: currencyField, fallback } = percentageFieldMap[timeRange] || {
          currency: "price_change_percentage_24h_in_currency",
          fallback: "price_change_percentage_24h",
        }
        const percentageChange =
          timeRange === "0.5" ? "N/A" : (selectedToken[currencyField]?.[currency] ?? selectedToken[fallback] ?? "N/A")
        const highLow = {
          high: selectedToken.high_24h?.[currency] ?? "N/A",
          low: selectedToken.low_24h?.[currency] ?? "N/A",
        }
        if (process.env.NODE_ENV === "development") {
        }
        setHighLowData({ high: highLow.high, low: highLow.low, percentageChange })
        setIsChartLoading(true)
        const tokenId = selectedToken.id
        const days =
          timeRange === "0.5"
            ? 1
            : timeRange === "1"
              ? 1
              : timeRange === "7"
                ? 7
                : timeRange === "30"
                  ? 30
                  : timeRange === "90"
                    ? 90
                    : 365
        await fetchPriceHistory(tokenId, days, (err, data) => {
          if (err) {
            logger.error("Price history fetch failed:", { error: err.message })
          }
          setIsChartLoading(false)
        })
      } catch (error) {
        logger.error("Error in fetchHighLowData:", { error: error.message })
        setHighLowData({
          high: selectedToken.high_24h?.[currency] ?? "N/A",
          low: selectedToken.low_24h?.[currency] ?? "N/A",
          percentageChange: "N/A",
        })
        setIsChartLoading(false)
        toast.error("Failed to fetch market data.", { position: "top-center", autoClose: 3000 })
      }
    }
    fetchHighLowData()
  }, [selectedToken, timeRange, currency, fetchPriceHistory])
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is outside token dropdown
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
      // Check if click is outside chain dropdown
      if (chainDropdownRef.current && !chainDropdownRef.current.contains(event.target)) {
        setIsChainDropdownOpen(false);
      }
    };
    // Add event listeners for both click (PC) and touchstart (mobile)
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    // Cleanup event listeners on component unmount
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [setIsDropdownOpen, setIsChainDropdownOpen]);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible'); // Trigger CSS animation nếu cần
        }
      });
    }, { threshold: 0.1 });
    const sections = document.querySelectorAll('.tab-content, .chart-panel'); // Class cho sections heavy
    sections.forEach(sec => observer.observe(sec));
    return () => observer.disconnect();
  }, []);
  // Memoized chart data (downsample for perf)
  const chartData = useMemo(() => downsampleData(priceHistory), [priceHistory])
  // Memoized sortedTrades (enhance perf)
  const sortedTrades = useMemo(() => {
    if (!dexData.trades || dexData.trades.length === 0) return [];
    return [...dexData.trades].sort((a, b) => new Date(b.block_timestamp) - new Date(a.block_timestamp));
  }, [dexData.trades]);
  // New: Handle next/prev page
  const handleNextPage = useCallback(() => {
    const totalPages = getTotalDexPages();
    if (currentDexPage < totalPages) {
      goToDexPage(currentDexPage + 1);
    }
  }, [currentDexPage, getTotalDexPages, goToDexPage]);
  const handlePrevPage = useCallback(() => {
    if (currentDexPage > 1) {
      goToDexPage(currentDexPage - 1);
    }
  }, [currentDexPage, goToDexPage]);
  // Tab indicator style (CSS-based, no layoutId)
  const tabIndicatorStyle = useMemo(() => {
    const width = '33.333%';
    let left = '0%';
    if (activeMarketTab === 'cex') left = '33.333%';
    else if (activeMarketTab === 'dex') left = '66.666%';
    return { left, width, transition: 'left 0.3s ease-in-out' };
  }, [activeMarketTab]);
  return (
    <section
      ref={trendingListRef} // AutoAnimate for trending
      className={`font-inter w-full max-w-9xl mx-auto mt-4 p-2 sm:p-4 h-[calc(100vh)] bg-[#0A0A0A]/80 backdrop-blur-md ${isMobile ? 'pb-8 overflow-y-auto' : ''} animate-fadeIn`} // CSS initial fade
      aria-label="Cryptocurrency Market Data"
    >
      <div className="w-full mb-1 mt-2 sm:mt-1">
        <div className="flex flex-col gap-2">
          <div className="flex flex-row items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 flex-shrink-0 bg-gradient-to-r from-[#FFFFFF]/10 to-[#FFFFFF]/5 backdrop-blur-md">
              <div className="p-1.5 group hover:scale-102 transition-transform duration-200"> {/* CSS hover */}
                <h2 className="text-[8px] sm:text-[10px] font-bold text-[#FFF] uppercase tracking-wider">Crypto</h2>
              </div>
            </div>
            {/* Controls */}
            <div className="flex flex-row items-center gap-4 flex-1 justify-end">
              {/* Chain Selector */}
              <div className="relative" ref={chainDropdownRef}>
                <button
                  onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
                  className={`bg-[#0A0A0A]/40 backdrop-blur-md text-[#FFF] px-1.5 sm:px-2 py-1 sm:py-1 text-[8px] sm:text-[10px] flex items-center gap-1 sm:gap-2 border-2 border-[#FFFFFF20] hover:bg-[#FFFFFF]/10 transition-all duration-300 rounded-lg min-w-[120px] group hover:scale-102 active:scale-98 ${selectedToken?.id && ["bitcoin", "ethereum"].includes(selectedToken.id.toLowerCase())
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                    }`} // CSS scale
                  disabled={
                    !selectedToken ||
                    (selectedToken.id && ["bitcoin", "ethereum"].includes(selectedToken.id.toLowerCase()))
                  }
                  aria-label={`Select blockchain network for ${selectedToken?.name || 'token'}`}
                >
                  {selectedChain ? (
                    <>
                      <img
                        src={getPlatformImage(selectedChain) || "/placeholder.svg"}
                        alt={`${chains.find((c) => c.value === selectedChain)?.label || "Chain"} logo`}
                        className="w-3 sm:w-4 h-3 sm:h-4 rounded-full"
                        onError={(e) => {
                          logger.error("Chain logo failed to load:", {
                            chain: selectedChain,
                            src: getPlatformImage(selectedChain),
                          })
                          e.target.src = "/fallback-image.webp"
                        }}
                      />
                      <span className="text-[8px] sm:text-[10px] font-medium truncate">
                        {chains.find((c) => c.value === selectedChain)?.label || "Chain"}
                      </span>
                    </>
                  ) : (
                    <div className="w-3 sm:w-4 h-3 sm:h-4 bg-[#FFFFFF20] rounded-full animate-pulse"></div>
                  )}
                  <span className={`text-[8px] sm:text-[10px] ml-auto transition-transform duration-200 ${isChainDropdownOpen ? 'rotate-180' : ''}`}>
                    {isChainDropdownOpen ? "▲" : "▼"}
                  </span>
                </button>
                {isChainDropdownOpen && (
                  <div
                    className="bg-[#0A0A0A]/80 backdrop-blur-xl shadow-xl absolute z-50 mt-2 w-32 sm:w-48 max-h-48 sm:max-h-64 overflow-y-auto border border-[#FFFFFF20] rounded-lg shadow-2xl animate-slideDown" // CSS anim
                  >
                    {getAvailableChains().length === 0 ? (
                      <div className="px-3 py-2 text-[#D4D4D4] text-[8px] sm:text-[10px]">No supported chains available</div>
                    ) : (
                      getAvailableChains()
                        .filter((chain) => process.env.NODE_ENV === "development" || !chain.testnet)
                        .map((chain) => (
                          <button
                            key={chain.value}
                            onClick={() => handleChainSelect(chain.value)}
                            className="flex items-center w-full text-left px-3 py-2 hover:bg-[#FFFFFF]/10 text-[#FFF] text-[8px] sm:text-[10px] font-medium transition-all duration-300 first:rounded-t-lg last:rounded-b-lg group hover:translate-x-1" // CSS translate
                            whileHover={{ x: 4 }}
                          >
                            <img
                              src={chain.image || "/placeholder.svg"}
                              alt={`${chain.label} logo`}
                              className="w-3 sm:w-4 h-3 sm:h-4 rounded-full mr-2 ring-1 ring-[#FFFFFF20]"
                              onError={(e) => {
                                logger.error("Dropdown chain logo failed to load:", {
                                  chain: chain.value,
                                  src: chain.image,
                                })
                                e.target.src = "/fallback-image.webp"
                              }}
                            />
                            {chain.label}
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>
              {/* Universal Search */}
              <UniversalSearch
                onSelect={handleSearchSelect}
                placeholder="Search wallets, nametags, or exchanges..."
                className="flex-1 w-full"
                size="default"
                aria-label="Search for cryptocurrency wallets, nametags, or exchanges"
              />
            </div>
          </div>
          {/* Trending Tokens Ticker */}
          <section
            className="relative w-full rounded-lg trending-container overflow-hidden"
            ref={autoAnimateRef}
            aria-label="Trending Cryptocurrencies"
          >
            {isLoadingTrending && !trendingTokens?.length ? (
              <div className="flex items-center justify-center h-8">
                <SkeletonLoader count={1} height={20} width="100%" />
              </div>
            ) : trendingError ? (
              <div className="text-center p-2">
                <p className="text-red-500 text-[10px] mb-2">{trendingError}</p>
                <button
                  onClick={() => fetchTrendingTokens()}
                  className="px-4 py-1 text-[#FFF] text-[10px] border border-[#FFFFFF20] rounded-xl hover:bg-[#FFFFFF]/10 transition-all duration-300 group hover:scale-105 active:scale-95"
                >
                  Retry
                </button>
              </div>
            ) : trendingTokens.length === 0 ? (
              <div className="text-[#D4D4D4] text-[10px] text-center p-2">No trending data</div>
            ) : (
              <div className="overflow-hidden h-8 flex items-center">
                <div
                  className="flex items-center whitespace-nowrap"
                  style={{
                    display: "inline-flex",
                    width: "max-content",
                    animation: isTrendingHovered ? 'none' : 'marquee 40s linear infinite'
                  }}
                  onMouseEnter={() => setIsTrendingHovered(true)}
                  onMouseLeave={() => {
                    setIsTrendingHovered(false);
                    setTooltipToken(null);
                  }}
                  onTouchStart={() => setIsTrendingHovered(true)}
                  onTouchEnd={() => {
                    setIsTrendingHovered(false);
                    setTooltipToken(null);
                  }}
                >
                  {[...trendingTokens, ...trendingTokens].map((token, index) => (
                    <div
                      key={`${token.id}-${index}`}
                      ref={(el) => (tokenRefs.current[`${token.id}-${index}`] = el)}
                      className="relative mx-2 sm:mx-2.5 flex items-center gap-1 px-1.5 py-0.5 cursor-pointer transition-all duration-300 group hover:scale-105 hover:-translate-y-0.5"
                      onClick={() => handleTokenSelect(token)}
                      onMouseEnter={() => {
                        setHoveredToken(`${token.id}-${index}`);
                        setTooltipToken(token);
                        updateTooltipPosition(token.id, index);
                      }}
                      onMouseLeave={() => {
                        setHoveredToken(null);
                        setTooltipToken(null);
                      }}
                      onTouchStart={() => {
                        setHoveredToken(`${token.id}-${index}`);
                        setTooltipToken(token);
                        updateTooltipPosition(token.id, index);
                      }}
                      onTouchEnd={() => {
                        setHoveredToken(null);
                        setTooltipToken(null);
                      }}
                    >
                      <Image
                        src={token.thumb || token.image?.thumb || "/fallback-image.webp"}
                        alt={`${token.symbol} logo`}
                        className="w-3 sm:w-4 h-3 sm:h-4 rounded-lg"
                        width={16}
                        height={16}
                        unoptimized
                      />
                      <span className="text-[#FFF] text-[8px] sm:text-[10px] font-medium">{token.symbol.toUpperCase()}</span>
                      <span
                        className={`text-[8px] sm:text-[9px] font-medium ${token.price_change_percentage_24h >= 0 ? "text-emerald-400" : "text-red-500"}`}
                      >
                        {token.price_change_percentage_24h >= 0 ? "+" : ""}
                        {token.price_change_percentage_24h.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <TrendingTooltip token={tooltipToken} position={tooltipPosition} />
          </section>
        </div>
      </div>
      {error && (
        <div
          className="text-[10px] sm:text-xs text-red-500 text-center p-2 sm:p-4 bg-red-500/10 border border-red-500/20 rounded-lg mb-2 animate-slideDown"
        >
          An error occurred while loading data. Please try again later.
        </div>
      )}
      {!loading && !error && tokens.length > 0 && (
        <div
          className={`flex flex-col md:grid md:grid-cols-2 gap-4 sm:gap-4 h-[calc(100%-4rem)] sm:h-[calc(100%-1rem)] ${isMobile ? "space-y-4 overflow-y-auto hide-scrollbar" : ""}`}
        >
          {/* Left Column - Token Info & Chart */}
          <div className="flex flex-col gap-4 max-h-full min-h-[800px] sm:max-h-full overflow-y-auto hide-scrollbar">
            {/* Token Information Panel */}
            <div
              className="border border-[#FFFFFF20] p-4 sm:p-4 rounded-xl min-h-[280px] sm:min-h-[310px] sm:max-h-[310px] overflow-y-auto custom-scrollbar bg-[#0A0A0A]/80 backdrop-blur-md relative animate-slideInLeft shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]" // CSS anim
            >
              <LoadingOverlay
                isLoading={
                  isLoadingSelectedToken &&
                  !localCache.current[`token-metadata-${selectedToken?.id}`]?.data &&
                  selectedToken // Only show if a token is selected
                }
                isMobile={isMobile}
                className="h-full w-full"
              />
              {isLoadingSelectedToken && !localCache.current[`token-metadata-${selectedToken?.id}`]?.data ? (
                <div className="h-full flex items-center justify-center">{/* Loading handled by LoadingOverlay */}</div>
              ) : selectedToken || localCache.current[`token-metadata-${selectedToken?.id}`]?.data ? (
                <div className="relative">
                  <div className="absolute top-1 right-1 w-32 sm:w-40" ref={dropdownRef}>
                    <button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="text-[#FFF] px-2 sm:px-2 py-1 sm:py-1 text-[10px] sm:text-xs flex items-center w-full border-2 border-[#FFFFFF20] bg-[#FFFFFF]/5 hover:bg-[#FFFFFF]/10 transition-all duration-300 rounded-xl group hover:scale-102 active:scale-98" // CSS
                      aria-label="Select token"
                    >
                      {selectedToken || localCache.current[`token-metadata-${selectedToken?.id}`]?.data ? (
                        <>
                          <img
                            src={
                              selectedToken?.image ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.image
                            }
                            alt={`${selectedToken?.symbol || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol} logo`}
                            className="w-4 sm:w-5 h-4 sm:h-5 mr-2"
                            onError={(e) => (e.target.src = "/fallback-image.webp")}
                          />
                          {(
                            selectedToken?.symbol ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol
                          )?.toUpperCase() || "Token"}
                        </>
                      ) : (
                        "Select Token"
                      )}
                      <span className={`ml-auto text-[10px] sm:text-xs transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}>
                        {isDropdownOpen ? "▲" : "▼"}
                      </span>
                    </button>
                    {isDropdownOpen && (
                      <div
                        className="bg-[#0A0A0A]/80 backdrop-blur-xl shadow-2xl absolute mt-2 w-full max-h-40 sm:max-h-48 overflow-y-auto border border-[#FFFFFF20] rounded-lg shadow-2xl z-50 hide-scrollbar animate-slideDown" // CSS
                      >
                        <input
                          type="text"
                          placeholder="Search token (e.g, BTC)"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#FFF] px-3 py-1 sm:py-1.5 w-full text-[8px] sm:text-[10px] border-b border-[#FFFFFF10] bg-transparent focus:outline-none rounded-t-lg"
                        />
                        <div className="p-2">
                          {(searchQuery ? searchResults : tokens.slice(0, 30)).filter(isValidToken).map((token) => (
                            <button
                              key={token.id}
                              onClick={() => handleTokenSelect(token)}
                              className="flex items-center w-full text-left px-3 py-1.5 hover:bg-[#FFFFFF]/10 text-[#FFF] text-[8px] sm:text-[10px] transition-all duration-300 rounded group hover:translate-x-1" // CSS
                            >
                              {token.image && (
                                <img
                                  src={token.image || "/placeholder.svg"}
                                  alt={`${token.symbol} logo`}
                                  className="w-4 sm:w-5 h-4 sm:h-5 rounded-full mr-2"
                                  onError={(e) => (e.target.src = "/fallback-image.webp")}
                                />
                              )}
                              <div>
                                <div className="font-medium">{token.name}</div>
                                <div className="text-[8px] sm:text-[10px] text-[#D4D4D4]">{token.symbol?.toUpperCase() || "Token"}</div>
                              </div>
                            </button>
                          ))}
                          {(searchQuery ? searchResults : tokens.slice(0, 30)).filter(isValidToken).length === 0 && (
                            <p className="text-[8px] sm:text-[10px] text-[#D4D4D4] text-center p-2">No tokens found</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mb-2 sm:mb-2">
                    <div className="flex items-center gap-2">
                      {(selectedToken?.image ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.image) && (
                          <img
                            src={
                              selectedToken?.image ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.image
                            }
                            alt={`${selectedToken?.symbol || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol} logo`}
                            className="w-6 sm:w-7 h-6 sm:h-7 transition-transform duration-400" // CSS scale/opacity
                            style={{ transform: 'scale(1)', opacity: 1 }} // Simulate anim
                            onError={(e) => (e.target.src = "/fallback-image.webp")}
                          />
                        )}
                      <div>
                        <h4 className="text-base sm:text-sm font-bold text-[#FFF] tracking-tight">
                          {selectedToken?.name || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.name}
                          <span className="text-[#D4D4D4] ml-2">
                            (
                            {(
                              selectedToken?.symbol ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol
                            )?.toUpperCase() || "Token"}
                            )
                          </span>
                        </h4>
                        {(selectedToken?.market_cap_rank ||
                          localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap_rank) && (
                            <span className="text-[10px] sm:text-xs text-[#D4D4D4] px-2 py-1 rounded-lg">
                              Rank #
                              {selectedToken?.market_cap_rank ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap_rank}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-2 mb-2 sm:mb-0">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-lg sm:text-xl font-bold text-[#FFF]">
                          {formatPrice(
                            selectedToken?.current_price?.[currency] ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.current_price?.[currency],
                            currency,
                            8,
                          )}
                        </p>
                        <span
                          className={`text-[8px] sm:text-[9px] font-medium px-3 py-1 rounded-xl ${(
                            selectedToken?.price_change_percentage_24h_in_currency?.[currency] ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.price_change_percentage_24h_in_currency?.[currency]
                          ) >= 0
                            ? "text-emerald-400 bg-emerald-400/10"
                            : "text-red-500 bg-red-500/10"
                            }`}
                        >
                          {(selectedToken?.price_change_percentage_24h_in_currency?.[currency] ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.price_change_percentage_24h_in_currency?.[currency]) != null
                            ? `${(
                              selectedToken?.price_change_percentage_24h_in_currency?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.price_change_percentage_24h_in_currency?.[currency]
                            ) >= 0
                              ? "+"
                              : ""
                            }${(
                              selectedToken?.price_change_percentage_24h_in_currency?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.price_change_percentage_24h_in_currency?.[currency]
                            ).toFixed(2)}% (24h)`
                            : "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-end items-end gap-2">
                      {(selectedToken?.links?.twitter_screen_name ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.twitter_screen_name) && (
                          <a
                            href={`https://twitter.com/${selectedToken?.links?.twitter_screen_name || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.twitter_screen_name}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 bg-[#FFFFFF]/10 rounded-lg hover:bg-[#FFFFFF]/20 transition-all duration-300 group" // CSS
                            title="Twitter"
                          >
                            <img
                              src="/logos/x.webp"
                              alt="Twitter"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.webp")}
                            />
                          </a>
                        )}
                      {(selectedToken?.links?.chat_url?.[0] ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.chat_url?.[0]) && (
                          <a
                            href={
                              selectedToken?.links?.chat_url?.[0] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.chat_url?.[0]
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 bg-[#FFFFFF]/10 rounded-lg hover:bg-[#FFFFFF]/20 transition-all duration-300 group"
                            title="Discord"
                          >
                            <img
                              src="/logos/discord.webp"
                              alt="Discord"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.webp")}
                            />
                          </a>
                        )}
                      {(selectedToken?.links?.homepage?.[0] ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.homepage?.[0]) && (
                          <a
                            href={
                              selectedToken?.links?.homepage?.[0] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.homepage?.[0]
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 bg-[#FFFFFF]/10 rounded-lg hover:bg-[#FFFFFF]/20 transition-all duration-300 group"
                            title="Website"
                          >
                            <img
                              src="/logos/website.webp"
                              alt="Website"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.webp")}
                            />
                          </a>
                        )}
                      {(selectedToken?.links?.repos_url?.github?.[0] ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.repos_url?.github?.[0]) && (
                          <a
                            href={
                              selectedToken?.links?.repos_url?.github?.[0] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.repos_url?.github?.[0]
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 bg-[#FFFFFF]/10 rounded-lg hover:bg-[#FFFFFF]/20 transition-all duration-300 group"
                            title="GitHub"
                          >
                            <img
                              src="/logos/github.webp"
                              alt="GitHub"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.webp")}
                            />
                          </a>
                        )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                    <div className="bg-[#FFFFFF]/5 rounded-xl p-2">
                      <h5 className="text-[9px] sm:text-[9px] font-bold text-[#FFF] uppercase mb-2 tracking-wider bg-gradient-to-r from-[#FFFFFF]/10 to-transparent rounded-l-sm p-1">
                        Market Stats
                      </h5>
                      <div className="space-y-1 text-[10px] sm:text-[10px]">
                        <div className="flex justify-between">
                          <span className="text-[#D4D4D4]">Market Cap:</span>
                          <span className="text-[#FFF] font-semibold">
                            {(selectedToken?.market_cap?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap?.[currency]) != null
                              ? `${currency.toUpperCase()} ${(
                                selectedToken?.market_cap?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap?.[currency]
                              ).toLocaleString("en-US")}`
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#D4D4D4]">FDV:</span>
                          <span className="text-[#FFF] font-semibold">
                            {(selectedToken?.fully_diluted_valuation?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.fully_diluted_valuation?.[currency]) != null
                              ? `${currency.toUpperCase()} ${(
                                selectedToken?.fully_diluted_valuation?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.fully_diluted_valuation?.[currency]
                              ).toLocaleString("en-US")}`
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#D4D4D4]">24h Volume:</span>
                          <span className="text-[#FFF] font-semibold">
                            {(selectedToken?.total_volume?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.total_volume?.[currency]) != null
                              ? `${currency.toUpperCase()} ${(
                                selectedToken?.total_volume?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.total_volume?.[currency]
                              ).toLocaleString("en-US")}`
                              : "N/A"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="bg-[#FFFFFF]/5 rounded-xl p-2">
                      <h5 className="text-[9px] sm:text-[9px] font-bold text-[#FFF] uppercase mb-2 tracking-wider bg-gradient-to-r from-[#FFFFFF]/10 to-transparent rounded-l-sm p-1">
                        Supply Stats
                      </h5>
                      <div className="space-y-1 text-[10px] sm:text-[10px]">
                        <div className="flex justify-between">
                          <span className="text-[#D4D4D4]">Circulating:</span>
                          <span className="text-[#FFF] font-semibold">
                            {(selectedToken?.circulating_supply ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.circulating_supply) != null
                              ? `${(
                                selectedToken?.circulating_supply ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.circulating_supply
                              ).toLocaleString("en-US")}`
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#D4D4D4]">Total Supply:</span>
                          <span className="text-[#FFF] font-semibold">
                            {(selectedToken?.total_supply ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.total_supply) != null
                              ? `${(
                                selectedToken?.total_supply ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.total_supply
                              ).toLocaleString("en-US")}`
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#D4D4D4]">Max Supply:</span>
                          <span className="text-[#FFF] font-semibold">
                            {(selectedToken?.max_supply ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.max_supply) != null
                              ? `${(
                                selectedToken?.max_supply ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.max_supply
                              ).toLocaleString("en-US")}`
                              : "N/A"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="bg-[#FFFFFF]/5 rounded-xl p-2 sm:col-span-2">
                      <h5 className="text-[9px] sm:text-[9px] font-bold text-[#FFF] uppercase mb-1 tracking-wider bg-gradient-to-r from-[#FFFFFF]/10 to-transparent rounded-l-sm p-1">
                        Price Range (24h)
                      </h5>
                      <div className="flex justify-between items-center gap-2 text-[10px] sm:text-[9px]">
                        <div className="flex-1 text-center">
                          <span className="text-[#D4D4D4] block mb-0.5">ATH</span>
                          <span
                            className={`font-semibold ${typeof (
                              selectedToken?.ath?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath?.[currency]
                            ) === "number"
                              ? (
                                selectedToken?.ath_change_percentage?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath_change_percentage?.[currency]
                              ) >= 0
                                ? "text-red-500"
                                : "text-emerald-400"
                              : "text-[#FFF]"
                              }`}
                          >
                            {typeof (
                              selectedToken?.ath?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath?.[currency]
                            ) === "number"
                              ? `${currency.toUpperCase()} ${(
                                selectedToken?.ath?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath?.[currency]
                              ).toLocaleString("en-US")}`
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex-1 text-center">
                          <span className="text-[#D4D4D4] block mb-0.5">ATL</span>
                          <span
                            className={`font-semibold ${typeof (
                              selectedToken?.atl?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl?.[currency]
                            ) === "number"
                              ? (
                                selectedToken?.atl_change_percentage?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl_change_percentage?.[currency]
                              ) >= 0
                                ? "text-red-500"
                                : "text-emerald-400"
                              : "text-[#FFF]"
                              }`}
                          >
                            {typeof (
                              selectedToken?.atl?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl?.[currency]
                            ) === "number"
                              ? `${currency.toUpperCase()} ${(
                                selectedToken?.atl?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl?.[currency]
                              ).toLocaleString("en-US")}`
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex-1 text-center">
                          <span className="text-[#D4D4D4] block mb-0.5">24H High</span>
                          <span className="text-emerald-400 font-semibold">
                            {formatPrice(highLowData.high, currency, 8)}
                          </span>
                        </div>
                        <div className="flex-1 text-center">
                          <span className="text-[#D4D4D4] block mb-0.5">24H Low</span>
                          <span className="text-red-500 font-semibold">
                            {formatPrice(highLowData.low, currency, 8)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-[10px] sm:text-xs text-[#D4D4D4] text-center">Please select a token to view details.</p>
                </div>
              )}
            </div>
            {/* Chart Panel */}
            <div
              className="border border-[#FFFFFF20] p-2 sm:p-2 rounded-xl flex-1 min-h-[320px] sm:min-h-[280px] max-h-[200px] sm:max-h-[280px] bg-[#0A0A0A]/80 backdrop-blur-md overflow-hidden relative animate-slideInLeft shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]" // CSS
            >
              <LoadingOverlay
                isLoading={isChartLoading && selectedToken}
                isMobile={isMobile}
                className="h-full w-full"
              />
              <div className="flex flex-col items-center mb-1 sm:mb-2 mt-4 sm:mt-0">
                <div className="flex flex-col sm:flex-row justify-between items-center w-full max-w-[90%] sm:max-w-[600px] gap-2 sm:gap-3">
                  <div className="flex space-x-2 mb-2 sm:mb-0 justify-start sm:justify-center w-full sm:w-auto">
                    <button
                      onClick={debouncedHandleAnalysis}
                      className={`px-2 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-all duration-300 border rounded-xl group ${selectedToken
                        ? 'text-[#FFF] border-[#FFFFFF20] bg-[#FFFFFF]/5 hover:bg-[#FFFFFF]/10'
                        : 'text-[#D4D4D4] border-[#FFFFFF10] cursor-not-allowed opacity-50'
                        }`}
                      disabled={!selectedToken}
                      aria-label="Analyze token"
                    >
                      Analyze
                    </button>
                    <button
                      onClick={debouncedHandlePrediction}
                      className={`px-2 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-all duration-300 border rounded-xl group ${selectedToken
                        ? 'text-black border-[#FFF] bg-[#D4D4D4] hover:bg-[#D4D4D4]/90'
                        : 'text-[#D4D4D4] border-[#FFFFFF10] cursor-not-allowed opacity-50'
                        }`}
                      disabled={!selectedToken}
                      aria-label="Predict token price"
                    >
                      Prediction
                    </button>
                  </div>
                  <div className="flex items-center justify-center gap-2 sm:gap-4 mt-2 sm:mt-6 mb-2 sm:mb-0">
                    <div className="text-[8px] sm:text-[9px] text-[#FFF] text-center">
                      <div className="text-[#D4D4D4] mb-1">Price Change</div>
                      <div
                        className={`font-bold ${highLowData.percentageChange !== "N/A" && typeof highLowData.percentageChange === "number"
                          ? highLowData.percentageChange >= 0
                            ? "text-emerald-400"
                            : "text-red-500"
                          : "text-[#D4D4D4]"
                          }`}
                      >
                        {highLowData.percentageChange !== "N/A" && typeof highLowData.percentageChange === "number"
                          ? `${highLowData.percentageChange >= 0 ? "+" : ""}${highLowData.percentageChange.toFixed(2)}% (${timeRange === "0.5"
                            ? "1H"
                            : timeRange === "1"
                              ? "1D"
                              : timeRange === "7"
                                ? "7D"
                                : timeRange === "30"
                                  ? "1M"
                                  : timeRange === "90"
                                    ? "3M"
                                    : "1Y"
                          })`
                          : "N/A"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <select
                        value={timeRange}
                        onChange={(e) => setTimeRange(e.target.value)}
                        className="text-[#FFF] px-2 sm:px-3 py-1 sm:py-1.5 text-[8px] sm:text-[9px] border-2 border-[#FFFFFF20] bg-[#FFFFFF]/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFF]/30"
                      >
                        {["1D", "7D", "1M", "3M", "1Y"].map((range, idx) => (
                          <option key={range} value={["1", "7", "30", "90", "365"][idx]} className="bg-black">
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
                </div>
              ) : chartData && chartData.length > 0 ? (
                <div className="h-48 sm:h-58">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 15, bottom: 0, left: isMobile ? 0 : 10 }}>
                      <XAxis dataKey="title" stroke="#FFFFFF" tick={false} hide={true} />
                      <YAxis
                        stroke="#FFFFFF"
                        tick={{ fontSize: isMobile ? 6 : 8, fill: "#FFFFFF" }}
                        domain={[(dataMin) => dataMin * 0.99, (dataMax) => dataMax * 1.01]}
                        width={isMobile ? 50 : 60}
                        tickCount={10}
                        tickFormatter={(value) => {
                          return `${currency.toUpperCase()} ${Math.floor(value).toLocaleString("en-US")}`
                        }}
                      />
                      <Tooltip content={<CustomTooltip currency={currency} />} />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#FFFFFF"
                        fill="url(#chartGradient)"
                        strokeWidth={3}
                        isAnimationActive={false}
                        animationDuration={1500}
                      />
                      {chartData.length > 0 && (
                        <ReferenceDot
                          x={chartData[chartData.length - 1].title}
                          y={chartData[chartData.length - 1].price}
                          r={4}
                          fill="#FFFFFF"
                          stroke="#FFFFFF"
                          strokeWidth={3}
                          className="animate-pulse"
                        />
                      )}
                      <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-48 sm:h-58 flex items-center justify-center">
                  <p className="text-[10px] sm:text-xs text-[#D4D4D4] text-center">
                    {selectedToken
                      ? "No price data available for this token."
                      : "Please select a token to view the chart."}
                  </p>
                </div>
              )}
              <div className="absolute top-1 right-1 flex items-center group p-2">
                <img src="/logos/CG.webp" alt="CG Logo" className="w-4 sm:w-4 h-4 sm:h-4 object-contain opacity-60" />
                <span className="absolute right-20 sm:right-20 text-[8px] sm:text-[9px] text-[#D4D4D4] opacity-0 translate-x-4 group-hover:opacity-100 group-hover:-translate-x-0 transition-all duration-300 whitespace-nowrap flex items-center">
                  Data powered by
                  <img src="/logos/CG_1.webp" alt="CG_1 Logo" className="w-12 sm:w-12 h-12 sm:h-12 object-contain ml-2" />
                </span>
              </div>
            </div>
          </div>
          {/* Right Column - Market Data Tabs */}
          <div
            className="flex flex-col border border-[#FFFFFF20] rounded-xl min-h-[600px] sm:min-h-[500px] max-h-full sm:max-h-[605px] bg-[#0A0A0A]/80 market-tab-container hide-scrollbar relative animate-slideInRight shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]" // CSS
          >
            {selectedToken ? (
              <>
                <div className="flex w-full text-[10px] sm:text-[12px] bg-[#FFFFFF]/5 rounded-t-xl relative" role="tablist">
                  <button
                    onClick={() => {
                      setActiveMarketTab("holders")
                      setShowTrades(false)
                    }}
                    className={`flex-1 px-6 py-2 font-semibold transition-all duration-300 relative p-1 group ${activeMarketTab === "holders" ? "text-[#FFF]" : "text-[#D4D4D4] hover:text-[#FFF] hover:bg-[#FFFFFF]/5"
                      }`}
                    role="tab"
                    aria-selected={activeMarketTab === "holders"}
                    aria-controls="holders-panel"
                    id="holders-tab"
                  >
                    TOP HOLDERS
                  </button>
                  <button
                    onClick={() => {
                      setActiveMarketTab("cex")
                      setShowTrades(false)
                    }}
                    className={`flex-1 px-6 py-2 font-semibold transition-all duration-300 relative p-1 group ${activeMarketTab === "cex" ? "text-[#FFF]" : "text-[#D4D4D4] hover:text-[#FFF] hover:bg-[#FFFFFF]/5"
                      }`}
                    role="tab"
                    aria-selected={activeMarketTab === "cex"}
                    aria-controls="cex-panel"
                    id="cex-tab"
                  >
                    CEX
                  </button>
                  <button
                    onClick={handleDexTabClick}
                    className={`flex-1 px-6 py-2 font-semibold transition-all duration-300 relative p-1 group${activeMarketTab === "dex" ? "text-[#FFF]" : "text-[#D4D4D4] hover:text-[#FFF] hover:bg-[#FFFFFF]/5"
                      }`}
                    role="tab"
                    aria-selected={activeMarketTab === "dex"}
                    aria-controls="dex-panel"
                    id="dex-tab"
                  >
                    ON-CHAIN
                  </button>
                </div>
                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto hide-scrollbar relative min-h-[500px] sm:min-h-[400px]">
                  <div
                    id="holders-panel"
                    role="tabpanel"
                    aria-labelledby="holders-tab"
                    className={`flex-1 overflow-y-auto tab-content custom-scrollbar hide-scrollbar relative min-h-[500px] sm:min-h-[400px] ${activeMarketTab !== "holders" ? "hidden" : ""}`}
                  >
                    {activeMarketTab === "holders" && (
                      <div className="flex-1 tab-content relative min-h-[500px] sm:min-h-[400px]" ref={autoAnimateRef}>
                        {session ? (
                          <>
                            <LoadingOverlay isLoading={isLoadingOnChain} isMobile={isMobile} className="!absolute h-full w-full" />
                            <div className="flex justify-center items-center p-2 border-b border-[#FFFFFF10] bg-[#FFFFFF]/5">
                              <h4 className="text-xs font-bold text-[#FFF] text-center uppercase tracking-wider flex items-center gap-2">
                                Top 100
                                {selectedToken.image && (
                                  <img
                                    src={selectedToken.image || "/placeholder.svg"}
                                    alt={`${selectedToken.symbol} logo`}
                                    className="w-5 h-5"
                                    onError={(e) => {
                                      logger.error("Token logo failed to load:", {
                                        symbol: selectedToken.symbol,
                                        src: selectedToken.image,
                                      })
                                      e.target.src = "/icons/default.webp"
                                    }}
                                  />
                                )}
                                {selectedToken.symbol?.toUpperCase()} Holders
                              </h4>
                            </div>
                            {isLoadingOnChain ? (
                              <div className="text-sm text-[#D4D4D4] text-center p-6">
                                {/* Loading handled by LoadingOverlay */}
                              </div>
                            ) : onChainError && !NON_EVM_CHAINS.includes(selectedToken?.id.toLowerCase()) ? (
                              <div className="text-sm text-center p-6">
                                <p className="text-[#D4D4D4]">Unable to load top holders data. Please try again.</p>
                              </div>
                            ) : onChainData.topHolders && onChainData.topHolders.length > 0 ? (
                              <div className="flex flex-col h-[600px]">
                                <div className="flex bg-[#0A0A0A]/80 border-b border-[#FFFFFF10] p-2 font-semibold text-[#FFF] text-[10px] sticky top-0 z-10">
                                  <div className="flex-1">Address/Name</div>
                                  <div className="w-28 text-right">Balance</div>
                                </div>
                                <Virtuoso
                                  style={{ height: '100%', overflow: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                                  className="hide-scrollbar"
                                  data={onChainData.topHolders.slice(0, 100)}
                                  itemContent={(index, holder) => {
                                    const isBitcoin = selectedToken?.id.toLowerCase() === 'bitcoin';
                                    const address = holder.address?.toLowerCase();
                                    const { text: displayText, image, shortAddress } = truncateAddress(
                                      holder.address,
                                      nameTags,
                                      isBitcoin ? 'Blockchair' : undefined
                                    );
                                    const isValidAddress =
                                      holder.address &&
                                      (holder.address.match(/^0x[a-fA-F0-9]{40}$/) || holder.address.match(/^(1|3|bc1)[a-zA-Z0-9]+$/));
                                    const HolderRow = React.memo(() => (
                                      <div
                                        className="flex border-t border-[#FFFFFF10] bg-[#0A0A0A]/80 px-3 py-2 text-[9px] sm:text-[11px]"
                                      >
                                        <div className="flex-1 flex items-center gap-2 group relative">
                                          {image && (
                                            <img
                                              src={image}
                                              alt={`${displayText} logo`}
                                              className="w-5 h-5 sm:w-6 sm:h-6 rounded-md"
                                              onError={(e) => e.target.style.display = 'none'}
                                            />
                                          )}
                                          {isBitcoin && isValidAddress ? (
                                            <a
                                              href={`https://mempool.space/address/${holder.address}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-[#FFF] hover:text-[#FFF]/80 transition-colors font-medium"
                                              title={holder.address}
                                            >
                                              <div className="flex flex-col">
                                                {displayText !== shortAddress && <span className="text-[9px] sm:text-[11px]">{displayText}</span>}
                                                <span className="text-[9px] sm:text-[11px] text-gray-500">{shortAddress}</span>
                                              </div>
                                            </a>
                                          ) : (
                                            <span
                                              className={`text-[#FFF] font-medium ${isValidAddress ? "cursor-pointer hover:text-[#FFF]/80 transition-colors" : "cursor-default"} text-[10px]`}
                                              onClick={() => isValidAddress && handleAddressClick(holder.address)}
                                              title={holder.address}
                                            >
                                              <div className="flex flex-col">
                                                {displayText !== shortAddress && <span className="text-[9px] sm:text-[11px]">{displayText}</span>}
                                                <span className="text-[9px] sm:text-[11px] text-gray-500">{shortAddress}</span>
                                              </div>
                                            </span>
                                          )}
                                          {isValidAddress && (
                                            <button
                                              onClick={() => {
                                                navigator.clipboard.writeText(holder.address);
                                                toast.success("Address copied!", { autoClose: 2000 });
                                              }}
                                              className="absolute right-0 text-[#D4D4D4] hover:text-[#FFF]/80 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-[#FFFFFF]/10 group hover:scale-110 active:scale-90" // CSS
                                              title="Copy address"
                                            >
                                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                        <div className="w-28 text-right font-bold text-[#FFF] text-[10px]">
                                          <span>{Math.floor(holder.balance).toLocaleString("en-US")}</span>
                                        </div>
                                      </div>
                                    ));
                                    return <HolderRow key={`${holder.address}-${index}`} />; // Stable key
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="text-sm text-[#D4D4D4] text-center p-6">
                                {NON_EVM_CHAINS.includes(selectedToken?.id.toLowerCase())
                                  ? `Top holders data for ${selectedToken?.symbol?.toUpperCase()} is unavailable.`
                                  : `No top holders data available for ${selectedToken?.symbol?.toUpperCase() || "selected token"} on ${chains.find((c) => c.value === selectedChain)?.label || "selected chain"}.`}
                              </div>
                            )}
                          </>
                        ) : (
                          <LoginPrompt />
                        )}
                      </div>
                    )}
                  </div>
                  <div
                    id="cex-panel"
                    role="tabpanel"
                    aria-labelledby="cex-tab"
                    className={`flex-1 overflow-x-auto overflow-y-auto tab-content custom-scrollbar hide-scrollbar relative min-h-[500px] sm:min-h-[400px] ${activeMarketTab !== "cex" ? "hidden" : ""}`}
                  >
                    {activeMarketTab === "cex" && (
                      <div className="flex-1 overflow-x-auto overflow-y-auto tab-content custom-scrollbar hide-scrollbar relative min-h-[500px] sm:min-h-[400px]" ref={autoAnimateRef}>
                        <LoadingOverlay isLoading={isLoadingTickers && !tickerData?.length} isMobile={isMobile} className="!absolute h-full w-full" />
                        {tickerError ? (
                          <div className="text-[10px] sm:text-xs text-center p-6">
                            <p className="text-[#D4D4D4] mb-4">Unable to load CEX markets data. Please try again.</p>
                            <button
                              onClick={() => fetchTickerData(selectedToken?.id)}
                              className="px-4 py-2 text-[#FFF] text-sm border border-[#FFFFFF20] rounded-xl hover:bg-[#FFFFFF]/10 transition-all duration-300 group hover:scale-105 active:scale-95"
                            >
                              Retry
                            </button>
                          </div>
                        ) : isLoadingTickers && !tickerData?.length ? (
                          <SkeletonLoader count={5} isMobile={isMobile} />
                        ) : tickerData.length > 0 ? (
                          <Virtuoso
                            style={{ height: '600px', overflow: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            className="hide-scrollbar"
                            data={tickerData.slice(0, 30)}
                            itemContent={(index, ticker) => {
                              const TickerRow = React.memo(() => (
                                <div
                                  className="flex border-t border-[#FFFFFF10] hover:bg-[#0A0A0A]/80 px-3 py-2 text-[9px] sm:text-[11px]"
                                >
                                  <div className="flex-[2] flex items-center justify-center gap-2">
                                    {ticker.market.logo && (
                                      <img
                                        src={ticker.market.logo}
                                        alt={`${ticker.market.name} logo`}
                                        className="w-5 h-5 rounded-md"
                                        onError={(e) => e.target.style.display = 'none'}
                                      />
                                    )}
                                    <a
                                      href={ticker.trade_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[#FFF] hover:text-[#FFF]/80 transition-colors font-medium truncate text-[9px] sm:text-[11px]"
                                      title={ticker.market.name}
                                    >
                                      {ticker.market.name}
                                    </a>
                                  </div>
                                  <div className="flex-1 text-center text-[#FFF] font-medium text-[9px] sm:text-[11px]">
                                    <span className="bg-[#FFFFFF]/5 px-1.5 py-0.5 rounded-md">{ticker.base}/{ticker.target}</span>
                                  </div>
                                  <div className="flex-1 text-center text-[#FFF] font-semibold text-[9px] sm:text-[11px]">
                                    {ticker.converted_last.usd != null ? formatPrice(ticker.converted_last.usd, "usd", 8) : "N/A"}
                                  </div>
                                  <div className="flex-1 text-center text-[#FFF] text-[9px] sm:text-[11px]">
                                    ${ticker.converted_volume.usd?.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || "N/A"}
                                  </div>
                                  <div className="flex-1 text-center text-[#D4D4D4] text-[9px] sm:text-[11px]">
                                    {ticker.last_traded_at ? new Date(ticker.last_traded_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "N/A"}
                                  </div>
                                </div>
                              ));
                              return <TickerRow key={`${ticker.market.identifier + ticker.base + ticker.target}-${index}`} />; // Stable key
                            }}
                            components={{
                              Header: () => (
                                <div className="flex bg-[#0A0A0A]/80 border-b border-[#FFFFFF10] p-2 font-semibold text-[#FFF] text-[9px] sm:text-[11px]">
                                  <div className="flex-[2] text-center">Market</div>
                                  <div className="flex-1 text-center">Pair</div>
                                  <div className="flex-1 text-center">Price</div>
                                  <div className="flex-1 text-center">Volume</div>
                                  <div className="flex-1 text-center">Last Traded</div>
                                </div>
                              ),
                            }}
                          />
                        ) : (
                          !isLoadingTickers && (
                            <div className="text-sm text-[#D4D4D4] text-center p-6">
                              {selectedToken
                                ? `No CEX data available for ${selectedToken.symbol?.toUpperCase() || "selected token"}.`
                                : "Please select a token to view CEX data."}
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                  <div
                    id="dex-panel"
                    role="tabpanel"
                    aria-labelledby="dex-tab"
                    className={`flex-1 overflow-y-auto tab-content custom-scrollbar hide-scrollbar relative min-h-[500px] sm:min-h-[400px] ${activeMarketTab !== "dex" ? "hidden" : ""}`}
                  >
                    {activeMarketTab === "dex" && (
                      <>
                        <div className="p-2 text-[9px] text-[#D4D4D4] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0 sticky top-0 bg-[#0A0A0A]/80 z-10 border-b border-[#FFFFFF10]">
                          <div className="flex items-center justify-start gap-1 order-1 sm:order-1 text-[8px]">
                            <button
                              onClick={handlePrevPage}
                              disabled={currentDexPage === 1 || isLoadingPage}
                              className="px-1 py-0.5 text-[#D4D4D4] hover:text-[#FFF] disabled:opacity-30 disabled:cursor-not-allowed bg-[#FFFFFF]/5 rounded transition-all group hover:scale-105 active:scale-95"
                              title="Previous Page"
                            >
                              ‹
                            </button>
                            <span className="px-2 py-0.5 bg-[#FFFFFF]/10 rounded text-[#FFF]">
                              Page {currentDexPage} / {getTotalDexPages()}
                            </span>
                            <button
                              onClick={handleNextPage}
                              disabled={currentDexPage >= getTotalDexPages() || isLoadingPage}
                              className="px-1 py-0.5 text-[#D4D4D4] hover:text-[#FFF] disabled:opacity-30 disabled:cursor-not-allowed bg-[#FFFFFF]/5 rounded transition-all group hover:scale-105 active:scale-95"
                              title="Next Page"
                            >
                              ›
                            </button>
                          </div>
                          <span className="px-2 py-0.5 order-2 sm:order-2 text-right">
                            Last Updated:{" "}
                            {lastDexFetchTime
                              ? new Date(lastDexFetchTime).toLocaleTimeString("en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex-1 overflow-y-auto tab-content custom-scrollbar hide-scrollbar relative min-h-[500px] sm:min-h-[400px]" ref={autoAnimateRef}>
                          {session ? (
                            <>
                              <LoadingOverlay
                                isLoading={
                                  (selectedToken?.id === "bitcoin" ? isLoadingMempool : isLoadingDex || isLoadingMoreDex || isLoadingPage) &&
                                  !(selectedToken?.id === "bitcoin" ? mempoolTransactions : dexData.trades)?.length
                                }
                                isMobile={isMobile}
                                className="!absolute h-full w-full"
                              />
                              {(() => {
                                const isBitcoin = selectedToken?.id.toLowerCase() === 'bitcoin';
                                const trades = isBitcoin ? mempoolTransactions : sortedTrades;
                                const handleLoadMore = () => {
                                  if (isBitcoin) return;
                                  loadMoreDexData();
                                };
                                return trades.length > 0 ? (
                                  <>
                                    <div className="flex flex-col h-[600px]">
                                      <div className="flex bg-[#0A0A0A]/80 border-b border-[#FFFFFF10] p-2 font-semibold text-[#FFF] text-[9px] sm:text-[11px] sticky top-0 z-10">
                                        {!isBitcoin && (
                                          <>
                                            <div className="flex-1 text-center">Tx/Time</div>
                                            <div className="flex-[2] text-center">From Address</div>
                                            <div className="flex-[2] text-center">To Address</div>
                                            <div className="flex-1 text-center">Value</div>
                                            <div className="flex-1 text-center">Status</div>
                                            <div className="flex-1 text-center">Chain</div>
                                          </>
                                        )}
                                        {isBitcoin && (
                                          <>
                                            <div className="flex-1 text-center">Tx/Time</div>
                                            <div className="flex-[2] text-center">From Address</div>
                                            <div className="flex-[2] text-center">To Address</div>
                                            <div className="flex-1 text-center">Value</div>
                                            <div className="flex-1 text-center">Fee</div>
                                          </>
                                        )}
                                      </div>
                                      <Virtuoso
                                        style={{ height: '100%', overflow: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                                        className="hide-scrollbar"
                                        data={trades}
                                        itemContent={(index, item) => {
                                          const txHash = isBitcoin ? item.txid : item.tx_hash;
                                          const timestamp = isBitcoin ? item.timestamp * 1000 : item.block_timestamp;
                                          const chain = isBitcoin ? 'bitcoin' : item.chain;
                                          const explorerInfo = getExplorerInfo(chain, txHash, null);
                                          const fromAddressInfo = getNameTagInfo(isBitcoin ? item.inputs?.[0]?.address : item.tx_from_address?.address, chain);
                                          const toAddressInfo = getNameTagInfo(isBitcoin ? item.outputs?.[0]?.address : item.to_token_address?.address, chain);
                                          const TradeRow = React.memo(() => (
                                            <div
                                              className="flex border-t border-[#FFFFFF10] bg-[#0A0A0A]/80 py-1.5 px-2 text-[9px] sm:text-[11px]"
                                            >
                                              {/* Tx/Time */}
                                              <div className="flex-1 flex flex-col gap-1 items-center justify-center group relative">
                                                <a href={explorerInfo.url} target="_blank" rel="noreferrer" className="p-1 rounded-md hover:bg-[#FFFFFF]/10 transition-all duration-300">
                                                  <img src={explorerInfo.logo} alt="Explorer" className="w-3 h-3 rounded" onError={(e) => e.target.style.display = 'none'} />
                                                </a>
                                                <span className="text-[7px] sm:text-[9px] text-[#D4D4D4] text-center">{formatDistanceToNow(new Date(timestamp), { addSuffix: true })}</span>
                                                {txHash && (
                                                  <button
                                                    onClick={() => {
                                                      navigator.clipboard.writeText(txHash);
                                                      toast.success("Transaction hash copied!", { autoClose: 2000 });
                                                    }}
                                                    className="absolute right-0 top-0 text-[#D4D4D4] hover:text-[#FFF]/80 opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-[#FFFFFF]/10 group hover:scale-110 active:scale-90"
                                                    title="Copy transaction hash"
                                                  >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                  </button>
                                                )}
                                              </div>
                                              {/* From Address */}
                                              <div className="flex-[2] flex items-center justify-center gap-2 group relative">
                                                {fromAddressInfo.image && <img src={fromAddressInfo.image} alt={`${fromAddressInfo.nameTag || 'Address'} logo`} className="w-3 h-3 rounded-md" onError={(e) => e.target.style.display = 'none'} />}
                                                <a
                                                  href={isBitcoin ? `https://mempool.space/address/${item.inputs?.[0]?.address}` : getExplorerUrls(chain, null, item.tx_from_address?.address).addressUrl}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="text-[#FFF] hover:text-[#FFF]/80 transition-colors font-medium text-[9px] sm:text-[11px]"
                                                  title={isBitcoin ? item.inputs?.[0]?.address : item.tx_from_address?.address}
                                                >
                                                  {fromAddressInfo.nameTag ? (
                                                    <span className="flex items-center gap-1">
                                                      <span className="text-[10px]">{fromAddressInfo.nameTag}</span>
                                                    </span>
                                                  ) : (
                                                    <span className="text-[9px] sm:text-[11px]">{isBitcoin ? `${item.inputs?.[0]?.address?.slice(0, 6)}...${item.inputs?.[0]?.address?.slice(-4)}` : `${item.tx_from_address?.address?.slice(0, 6)}...${item.tx_from_address?.address?.slice(-4)}`}</span>
                                                  )}
                                                </a>
                                                <button
                                                  onClick={() => navigator.clipboard.writeText(isBitcoin ? item.inputs?.[0]?.address : item.tx_from_address?.address) && toast.success("Address copied!", { autoClose: 2000 })}
                                                  className="absolute right-0 text-[#D4D4D4] hover:text-[#FFF]/80 opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-[#FFFFFF]/10 group hover:scale-110 active:scale-90"
                                                  title="Copy address"
                                                >
                                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                  </svg>
                                                </button>
                                              </div>
                                              {/* To Address */}
                                              <div className="flex-[2] flex items-center justify-center gap-2 group relative">
                                                {toAddressInfo.image && <img src={toAddressInfo.image} alt={`${toAddressInfo.nameTag || 'Address'} logo`} className="w-3 h-3 rounded-md" onError={(e) => e.target.style.display = 'none'} />}
                                                <a
                                                  href={isBitcoin ? `https://mempool.space/address/${item.outputs?.[0]?.address}` : getExplorerUrls(chain, null, item.to_token_address?.address).addressUrl}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="text-[#FFF] hover:text-[#FFF]/80 transition-colors font-medium text-[10px]"
                                                  title={isBitcoin ? item.outputs?.[0]?.address : item.to_token_address?.address}
                                                >
                                                  {toAddressInfo.nameTag ? (
                                                    <span className="flex items-center gap-1">
                                                      <span className="text-[10px]">{toAddressInfo.nameTag}</span>
                                                    </span>
                                                  ) : (
                                                    <span className="text-[10px]">{isBitcoin ? `${item.outputs?.[0]?.address?.slice(0, 6)}...${item.outputs?.[0]?.address?.slice(-4)}` : `${item.to_token_address?.address?.slice(0, 6)}...${item.to_token_address?.address?.slice(-4)}`}</span>
                                                  )}
                                                </a>
                                                <button
                                                  onClick={() => navigator.clipboard.writeText(isBitcoin ? item.outputs?.[0]?.address : item.to_token_address?.address) && toast.success("Address copied!", { autoClose: 2000 })}
                                                  className="absolute right-0 text-[#D4D4D4] hover:text-[#FFF]/80 opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-[#FFFFFF]/10 group hover:scale-110 active:scale-90"
                                                  title="Copy address"
                                                >
                                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                  </svg>
                                                </button>
                                              </div>
                                              {/* Value */}
                                              <div className="flex-1 flex flex-col gap-1 items-center justify-center text-[10px]">
                                                <span className="font-semibold flex items-center gap-2 text-[8px] sm:text-[10px]">
                                                  {isBitcoin ? (
                                                    <>
                                                      {(item.value_btc || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                      <img src="/logos/bitcoin.webp" alt="BTC" className="w-3 h-3 rounded" onError={(e) => e.target.style.display = 'none'} />
                                                      <span>BTC</span>
                                                    </>
                                                  ) : (
                                                    <>
                                                      {(Number.parseFloat(item.to_token_amount || 0) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                      {selectedToken?.symbol?.toUpperCase()}
                                                    </>
                                                  )}
                                                </span>
                                                <div className="flex items-center gap-2 text-[7px] sm:text-[9px]">
                                                  <span className="text-[#D4D4D4]">${(Number.parseFloat(isBitcoin ? item.value_usd : item.volume_in_usd || 0) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </div>
                                              </div>
                                              {/* Fee/Status */}
                                              <div className="flex-1 flex flex-col gap-1 items-center justify-center text-center text-[9px] sm:text-[11px]">
                                                {isBitcoin && (
                                                  <div className="text-[7px] sm:text-[9px] text-[#D4D4D4] text-center">Fee: {item.fee.toLocaleString("en-US")} sat</div>
                                                )}
                                                {isBitcoin ? (
                                                  <span className={`px-1 py-0.5 rounded-full text-[7px] sm:text-[9px] font-semibold text-center ${item.status.confirmed ? "bg-emerald-400/10 text-emerald-400" : "bg-yellow-500/10 text-yellow-500"}`}>
                                                    {item.status.confirmed ? "Confirmed" : "Pending"}
                                                  </span>
                                                ) : (
                                                  <span className="px-1 py-0.5 rounded-full text-[7px] sm:text-[9px] font-semibold text-center bg-emerald-400/10 text-emerald-400">
                                                    Success
                                                  </span>
                                                )}
                                              </div>
                                              {!isBitcoin && (
                                                <div className="flex-1 flex items-center justify-center">
                                                  <img
                                                    src={`/logos/${item.chain}.webp`}
                                                    alt={`${item.chain} logo`}
                                                    className="w-4 h-4 rounded"
                                                    onError={(e) => { e.target.src = "/logos/ethereum.webp"; }}
                                                  />
                                                </div>
                                              )}
                                            </div>
                                          ));
                                          return <TradeRow key={`${item.tx_hash || item.txid}-${index}`} />; // Stable key
                                        }}
                                        endReached={loadMoreDexData} // Infinite scroll
                                      />
                                    </div>
                                  </>
                                ) : (
                                  !(isBitcoin ? isLoadingMempool : isLoadingDex || isLoadingMoreDex || isLoadingPage) && (
                                    <div className="text-[9px] sm:text-[11px] text-[#D4D4D4] text-center p-6">
                                      No {isBitcoin ? "mempool transactions" : "DEX data"} available for{" "}
                                      {selectedToken?.symbol?.toUpperCase() || "selected token"} on{" "}
                                      {isBitcoin
                                        ? "Bitcoin network"
                                        : chains.find((c) => c.value === selectedChain)?.label || "selected chain"}.
                                    </div>
                                  )
                                );
                              })()}
                            </>
                          ) : (
                            <LoginPrompt />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center relative min-h-[500px] sm:min-h-[400px]">
                <LoadingOverlay isLoading={true} isMobile={isMobile} className="!absolute h-full w-full" />
                <SkeletonLoader count={5} isMobile={isMobile} />
              </div>
            )}
          </div>
        </div>
      )}
      {/* Dynamic WalletBalances */}
      <Suspense fallback={<SkeletonLoader count={2} />}>
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
            setSelectedWallet(null)
            setWalletBalances([])
            setTransactions(null)
            setWalletBalancesError(null)
            setTransactionsError(null)
            setWalletAddress("")
          }}
          isMobile={isMobile}
          fetchOnChainData={fetchOnChainData}
          setIsLoadingWalletBalances={setIsLoadingWalletBalances}
        />
      </Suspense>
      <Suspense fallback={null}>
        <Modal
          isOpen={isAnalyzing || !!analysis}
          onClose={() => {
            setAnalysis(null);
            setAnalysisLinks([]);
            setIsAnalyzing(false);
          }}
          title="Market Analysis"
          content={
            <div className="prose prose-invert max-w-none text-[#FFF] leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ node, ...props }) => <h1 className="text-xl sm:text-2xl font-bold mt-4 mb-2" {...props} />,
                  h2: ({ node, ...props }) => <h2 className="text-lg sm:text-xl font-semibold mt-3 mb-1" {...props} />,
                  p: ({ node, ...props }) => <p className="mb-2" {...props} />,
                  table: ({ node, ...props }) => (
                    <table className="table-auto w-full border-collapse border border-[#FFFFFF20] my-2" {...props} />
                  ),
                  th: ({ node, ...props }) => (
                    <th className="border border-[#FFFFFF20] px-4 py-2 bg-[#FFFFFF]/5" {...props} />
                  ),
                  td: ({ node, ...props }) => (
                    <td className="border border-[#FFFFFF20] px-4 py-2" {...props} />
                  ),
                  a: ({ node, href, ...props }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-500 hover:text-blue-400"
                      {...props}
                    />
                  ),
                }}
              >
                {analysis || 'Analyzing data...'}
              </ReactMarkdown>
            </div>
          }
          links={analysisLinks}
          isMobile={isMobile}
          isLoading={isAnalyzing}
          logs={analysisLogs}
          actionType="analyze"
        />
      </Suspense>
      {/* Modal for Price Prediction */}
      <Suspense fallback={null}>
        <Modal
          isOpen={isPredicting || !!prediction}
          onClose={() => {
            setPrediction(null);
            setIsPredicting(false);
          }}
          title="Price Prediction"
          content={
            <div className="prose prose-invert max-w-none text-[#FFF] leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ node, ...props }) => <h1 className="text-xl sm:text-2xl font-bold mt-4 mb-2" {...props} />,
                  h2: ({ node, ...props }) => <h2 className="text-lg sm:text-xl font-semibold mt-3 mb-1" {...props} />,
                  p: ({ node, ...props }) => <p className="mb-2" {...props} />,
                  table: ({ node, ...props }) => (
                    <table className="table-auto w-full border-collapse border border-[#FFFFFF20] my-2" {...props} />
                  ),
                  th: ({ node, ...props }) => (
                    <th className="border border-[#FFFFFF20] px-4 py-2 bg-[#FFFFFF]/5" {...props} />
                  ),
                  td: ({ node, ...props }) => (
                    <td className="border border-[#FFFFFF20] px-4 py-2" {...props} />
                  ),
                  a: ({ node, href, ...props }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-500 hover:text-blue-400"
                      {...props}
                    />
                  ),
                }}
              >
                {prediction || 'Generating prediction...'}
              </ReactMarkdown>
            </div>
          }
          isMobile={isMobile}
          isLoading={isPredicting}
          logs={analysisLogs}
          actionType="predict"
        />
      </Suspense>
      {/* Pool Details Modal */}
      <Suspense fallback={null}>
        <Modal
          isOpen={!!selectedPool}
          onClose={() => setSelectedPool(null)}
          title="Pool Details"
          content={renderPoolModalContent()}
          links={[
            `https://www.geckoterminal.com/${GECKOTERMINAL_CHAIN_MAPPING[selectedChain]}/pools/${selectedPool?.address}`,
          ]}
          isMobile={isMobile}
        />
      </Suspense>
      {/* Toast Container */}
      <ToastContainer
        position="top-center"
        autoClose={5000}
        theme="dark"
        toastStyle={{
          backgroundColor: "rgba(0, 0, 0, 0.9)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "16px",
        }}
      />
    </section>
  )
}
export default React.memo(MarketTab, (prev, next) => {
  return prev.selectedToken?.id === next.selectedToken?.id && prev.initialTokenSlug === next.initialTokenSlug;
});

<style jsx global>{`
  /* Scrollbar mượt */
  .custom-scrollbar::-webkit-scrollbar {
    width: 5px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.25);
    border-radius: 3px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.4);
  }
`}</style>