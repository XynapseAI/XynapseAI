"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { motion } from "framer-motion"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts"
import { createPortal } from "react-dom"
import "highlight.js/styles/github-dark.css"
import { useMarketTabLogic } from "./MarketTabLogic"
import WalletBalances from "./WalletBalances"
import Modal from "./Modal"
import UniversalSearch from "./UniversalSearch"
import "../styles/MarketTab.css"
import { ToastContainer } from "react-toastify"
import "react-toastify/dist/ReactToastify.css"
import { formatDistanceToNow } from "date-fns"
import { GECKOTERMINAL_CHAIN_MAPPING, CHAIN_ID_TO_NAME } from "../utils/constants"
import {
  SkeletonLoader,
  getExplorerUrls,
  formatPrice,
  truncateAddress,
  isValidToken,
  LoadingOverlay,
} from "../utils/helpers"
import "react-loading-skeleton/dist/skeleton.css"
import { useCurrency } from './CurrencyContext';

const logger = {
  log: (message, data) => {
    if (process.env.NODE_ENV === "development") {
      console.log(message, data)
    }
  },
  error: (message, data) => {
    console.error(message, data)
  },
}

const CustomTooltip = ({ active, payload, label, currency }) => {
  if (active && payload && payload.length) {
    return (
      <motion.div
        className="bg-black/95 backdrop-blur-xl border border-white/20 p-3 rounded-2xl text-white text-sm font-medium shadow-2xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <p className="text-white/70 text-xs mb-1">{label}</p>
        <p className="text-white font-semibold">
          Price: <span className="text-emerald-400">{formatPrice(payload[0].value, currency, 8)}</span>
        </p>
      </motion.div>
    )
  }
  return null
}

const MarketTab = ({ recaptchaRef, initialTokenSlug, onTokenSelect, toast, initialTokenData }) => {
  const { data: session } = useSession()
  const { currency } = useCurrency();
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
    setIsLoadingWalletBalances,
    lastDexFetchTime,
    trendingTokens,
    isLoadingTrending,
    trendingError,
    NON_EVM_CHAINS,
  } = useMarketTabLogic({ recaptchaRef, toast, initialTokenData, toast })

  const dropdownRef = useRef(null)
  const chainDropdownRef = useRef(null)
  const prevTradesRef = useRef([])
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false)
  const [isChartLoading, setIsChartLoading] = useState(false)
  const [activeMarketTab, setActiveMarketTab] = useState("cex")
  const [showTrades, setShowTrades] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [selectedPool, setSelectedPool] = useState(null)
  const [highLowData, setHighLowData] = useState({ high: null, low: null, percentageChange: null })
  const [hoveredToken, setHoveredToken] = useState(null)
  const [isTrendingHovered, setIsTrendingHovered] = useState(false)
  const trendingRef = useRef(null)
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
  const [tooltipToken, setTooltipToken] = useState(null)
  const tokenRefs = useRef({})
  const lastFetchedSlugRef = useRef(null)

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

  useEffect(() => {
    if (initialTokenSlug !== lastFetchedSlugRef.current || trendingTokens.length === 0) {
      fetchTrendingTokens((err) => {
        if (err) {
          console.error("Failed to fetch trending tokens:", { error: err.message })
          toast.error("Failed to load trending tokens.", { position: "top-center", autoClose: 3000 })
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
          logger.log("Fetched token by slug:", { slug: initialTokenSlug, token: result.data })
        } catch (err) {
          logger.error("Error fetching token by slug:", { slug: initialTokenSlug, error: err.message })
          toast.error(`Failed to load token: ${err.message}`, { position: "top-center", autoClose: 3000 })
        } finally {
          setIsChartLoading(false)
        }
      }
      fetchTokenBySlug()
    }
  }, [initialTokenSlug, setSelectedToken])

  const updateTooltipPosition = (tokenId, index) => {
    const tokenElement = tokenRefs.current[`${tokenId}-${index}`]
    if (tokenElement) {
      const rect = tokenElement.getBoundingClientRect()
      setTooltipPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + rect.width / 2 + window.scrollX,
      })
    }
  }

  const TrendingTooltip = ({ token, position }) => {
    if (!token) return null

    return createPortal(
      <motion.div
        className="fixed z-50 bg-black/95 backdrop-blur-xl border border-white/30 p-4 rounded-2xl text-white shadow-2xl"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          transform: "translateX(-50%)",
        }}
        initial={{ opacity: 0, y: 10, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.9 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <img
            src={token.large || "/placeholder.svg"}
            alt={`${token.symbol} logo`}
            className="w-8 h-8"
            onError={(e) => {
              logger.error("Token large logo failed to load:", { symbol: token.symbol, src: token.large })
              e.target.src = "/fallback-image.png"
            }}
          />
          <div>
            <div className="font-bold text-sm text-white">{token.symbol.toUpperCase()}</div>
            <div className="text-white/60 text-xs">Rank #{token.market_cap_rank || "N/A"}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <span className="text-white/60 block">Price (USD)</span>
            <span className="font-semibold text-white">${token.price.toFixed(4)}</span>
          </div>
          <div className="space-y-1">
            <span className="text-white/60 block">24h Change</span>
            <span
              className={`font-semibold ${token.price_change_percentage_24h >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {token.price_change_percentage_24h.toFixed(2)}%
            </span>
          </div>
        </div>
      </motion.div>,
      document.body,
    )
  }

  const handleTokenSelect = (token) => {
    debouncedHandleTokenSelect(token)
    if (onTokenSelect && token.id) {
      onTokenSelect(token.id)
    }
  }

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
    const imageUrl = chain?.image || "/fallback-image.png"
    return imageUrl
  }

  const handleDexTabClick = () => {
    if (dexRequestCount >= 5 && Date.now() - lastDexRequestTime < 60 * 1000) {
      toast.error("Too many DEX requests. Please wait a minute and try again.", {
        position: "top-center",
        autoClose: 5000,
      })
      return
    }
    setActiveMarketTab("dex")
    setShowTrades(false)
    if (selectedToken) {
      const { chain, tokenAddress } = getDefaultChainAndAddress(selectedToken, selectedChain)
      if (chain && tokenAddress) {
        fetchDexData(chain, tokenAddress)
      }
    }
  }

  const handlePoolClick = (poolAddress) => {
    if (process.env.NODE_ENV === "development") {
      console.log("handlePoolClick called with poolAddress:", poolAddress)
      console.log("dexData.pools:", dexData.pools)
      console.log("dexData.poolTokens:", dexData.poolTokens)
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
        console.log("Pool not found for address:", poolAddress)
      }
      toast.error("Pool data not available.", { position: "top-center", autoClose: 3000 })
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
      return <p className="text-sm text-white/70 text-center">No pool data available.</p>
    }

    const tokens = Object.values(selectedPool.tokens)
    if (tokens.length < 2) {
      return <p className="text-sm text-white/70 text-center">Insufficient token data for this pool.</p>
    }

    const [token1, token2] = tokens

    return (
      <div className="text-sm text-white/90">
        <h4 className="text-2xl font-bold text-white mb-6 text-center">
          {token1.symbol}/{token2.symbol}
        </h4>
        <div className="flex flex-col sm:flex-row justify-between gap-6">
          <div className="flex-1 min-w-0">
            <h5 className="text-lg font-bold text-white mb-4 flex items-center justify-center gap-3">
              <img
                src={token1.image_url || "/placeholder.svg"}
                alt={`${token1.symbol} logo`}
                className="w-8 h-8 rounded-full ring-2 ring-white/20"
                onError={(e) => (e.target.src = "/fallback-image.png")}
              />
              {token1.symbol}
            </h5>
            <div className="space-y-4 text-center">
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4">
                <div className="text-white/60 text-xs mb-1">Transaction Score</div>
                <div className="text-emerald-400 font-semibold">{token1.transaction_score || "N/A"}</div>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4">
                <div className="font-bold text-white mb-3">HOLDERS</div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Total Count:</span>
                    <span className="text-white">{token1.holders?.count?.toLocaleString() || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Top 10:</span>
                    <span className="text-white">{token1.holders?.distribution_percentage?.top_10 || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">11-30:</span>
                    <span className="text-white">{token1.holders?.distribution_percentage?.["11_30"] || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">31-50:</span>
                    <span className="text-white">{token1.holders?.distribution_percentage?.["31_50"] || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Rest:</span>
                    <span className="text-white">{token1.holders?.distribution_percentage?.rest || "N/A"}%</span>
                  </div>
                  <div className="text-white/40 text-xs pt-2 border-t border-white/10">
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
            <h5 className="text-lg font-bold text-white mb-4 flex items-center justify-center gap-3">
              <img
                src={token2.image_url || "/placeholder.svg"}
                alt={`${token2.symbol} logo`}
                className="w-8 h-8 rounded-full ring-2 ring-white/20"
                onError={(e) => (e.target.src = "/fallback-image.png")}
              />
              {token2.symbol}
            </h5>
            <div className="space-y-4 text-center">
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4">
                <div className="text-white/60 text-xs mb-1">Transaction Score</div>
                <div className="text-emerald-400 font-semibold">{token2.transaction_score || "N/A"}</div>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4">
                <div className="font-bold text-white mb-3">HOLDERS</div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Total Count:</span>
                    <span className="text-white">{token2.holders?.count?.toLocaleString() || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Top 10:</span>
                    <span className="text-white">{token2.holders?.distribution_percentage?.top_10 || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">11-30:</span>
                    <span className="text-white">{token2.holders?.distribution_percentage?.["11_30"] || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">31-50:</span>
                    <span className="text-white">{token2.holders?.distribution_percentage?.["31_50"] || "N/A"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Rest:</span>
                    <span className="text-white">{token2.holders?.distribution_percentage?.rest || "N/A"}%</span>
                  </div>
                  <div className="text-white/40 text-xs pt-2 border-t border-white/10">
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
          toast.error(err.message, { position: "top-center", autoClose: 3000 })
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
          console.log("fetchHighLowData:", {
            percentageField: currencyField,
            fallbackField: fallback,
            percentageChange,
            currency,
            high: highLow.high,
            low: highLow.low,
            selectedTokenPercentageFields: {
              "1h": {
                currency: selectedToken.price_change_percentage_1h_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_1h,
              },
              "24h": {
                currency: selectedToken.price_change_percentage_24h_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_24h,
              },
              "7d": {
                currency: selectedToken.price_change_percentage_7d_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_7d,
              },
              "30d": {
                currency: selectedToken.price_change_percentage_30d_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_30d,
              },
              "90d": {
                currency: selectedToken.price_change_percentage_90d_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_90d,
              },
              "1y": {
                currency: selectedToken.price_change_percentage_1y_in_currency?.[currency],
                fallback: selectedToken.price_change_percentage_1y,
              },
            },
          })
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
            toast.error(err.message, { position: "top-center", autoClose: 3000 })
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`font-saira w-full max-w-9xl mx-auto mt-4 p-2 sm:p-4 h-[calc(100vh)] bg-black/80 backdrop-blur-3xl ${isMobile ? 'pb-8 overflow-y-auto' : ''}`}
    >
      <div className="w-full mb-1 mt-2 sm:mt-1">
        <div className="flex flex-col gap-2">
          <div className="flex flex-row items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 flex-shrink-0 bg-gradient-to-r from-white/10 to-white/5 backdrop-blur-sm">
              <motion.div
                className=" p-1.5"
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-[8px] sm:text-[10px] font-bold text-white uppercase tracking-wider">Crypto</h2>
              </motion.div>
              <div className="h-6 w-px bg-white/20"></div>
              <motion.button
                className="text-[8px] sm:text-[10px] font-bold text-white/50 uppercase cursor-not-allowed flex items-center gap-1 transition-colors duration-300 px-2 py-1"
                disabled
                aria-label="Stock tab (coming soon)"
                whileHover={{ scale: 1.02 }}
              >
                Stock <span className="text-[6px] sm:text-[8px] text-white/30">(Soon)</span>
              </motion.button>
            </div>

            {/* Controls */}
            <div className="flex flex-row items-center gap-4 flex-1 justify-end">
              {/* Chain Selector */}
              <div className="relative" ref={chainDropdownRef}>
                <motion.button
                  onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
                  className={`text-white px-1.5 sm:px-2 py-0.5 sm:py-1 text-[8px] sm:text-[10px] flex items-center gap-1 sm:gap-2 border-2 border-white/20 bg-white/5 backdrop-blur-xl hover:bg-white/10 transition-all duration-300 rounded-xl min-w-[120px] ${selectedToken?.id && ["bitcoin", "ethereum"].includes(selectedToken.id.toLowerCase())
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                    }`}
                  disabled={
                    !selectedToken ||
                    (selectedToken.id && ["bitcoin", "ethereum"].includes(selectedToken.id.toLowerCase()))
                  }
                  aria-label="Select chain"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
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
                          e.target.src = "/fallback-image.png"
                        }}
                      />
                      <span className="text-[8px] sm:text-[10px] font-medium truncate">
                        {chains.find((c) => c.value === selectedChain)?.label || "Chain"}
                      </span>
                    </>
                  ) : (
                    <div className="w-3 sm:w-4 h-3 sm:h-4 bg-white/20 rounded-full animate-pulse"></div>
                  )}
                  <motion.span
                    className="text-[8px] sm:text-[10px] ml-auto"
                    animate={{ rotate: isChainDropdownOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {isChainDropdownOpen ? "▲" : "▼"}
                  </motion.span>
                </motion.button>
                {isChainDropdownOpen && (
                  <motion.div
                    className="absolute z-50 mt-2 w-32 sm:w-48 max-h-48 sm:max-h-64 overflow-y-auto border border-white/20 bg-black/90 backdrop-blur-2xl rounded-lg shadow-2xl"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {getAvailableChains().length === 0 ? (
                      <div className="px-3 py-2 text-white/60 text-[8px] sm:text-[10px]">No supported chains available</div>
                    ) : (
                      getAvailableChains()
                        .filter((chain) => process.env.NODE_ENV === "development" || !chain.testnet)
                        .map((chain) => (
                          <motion.button
                            key={chain.value}
                            onClick={() => handleChainSelect(chain.value)}
                            className="flex items-center w-full text-left px-3 py-2 hover:bg-white/10 text-white text-[8px] sm:text-[10px] font-medium transition-all duration-300 first:rounded-t-lg last:rounded-b-lg"
                            whileHover={{ x: 4 }}
                          >
                            <img
                              src={chain.image || "/placeholder.svg"}
                              alt={`${chain.label} logo`}
                              className="w-3 sm:w-4 h-3 sm:h-4 rounded-full mr-2 ring-1 ring-white/20"
                              onError={(e) => {
                                logger.error("Dropdown chain logo failed to load:", {
                                  chain: chain.value,
                                  src: chain.image,
                                })
                                e.target.src = "/fallback-image.png"
                              }}
                            />
                            {chain.label}
                          </motion.button>
                        ))
                    )}
                  </motion.div>
                )}
              </div>

              {/* Universal Search */}
              <UniversalSearch
                onSelect={handleSearchSelect}
                placeholder="Search wallets, nametags, or exchanges..."
                className="flex-1 w-full"
                size="default"
              />
            </div>
          </div>

          {/* Trending Tokens Ticker */}
          <div
            className="relative w-full rounded-lg trending-container"
            ref={trendingRef}
          >
            {isLoadingTrending && !trendingTokens?.length ? (
              <div className="flex items-center justify-center h-8">
              </div>
            ) : trendingError ? (
              <div className="text-center">
                <p className="text-red-400 text-[10px] mb-2">{trendingError}</p>
                <motion.button
                  onClick={() => fetchTrendingTokens()}
                  className="px-4 py-1 text-white text-[10px] border border-white/20 rounded-xl hover:bg-white/10 transition-all duration-300"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Retry
                </motion.button>
              </div>
            ) : trendingTokens.length === 0 ? (
              <div className="text-white/60 text-[10px] text-center"></div>
            ) : (
              <motion.div
                className="flex items-center whitespace-nowrap w-full"
                animate={isTrendingHovered ? { x: 0 } : { x: ["0%", "-100%"] }}
                transition={{
                  x: {
                    repeat: Number.POSITIVE_INFINITY,
                    repeatType: "loop",
                    duration: trendingTokens.length * 4,
                    ease: "linear",
                  },
                }}
                style={{ display: "inline-flex" }}
                onMouseEnter={() => {
                  setIsTrendingHovered(true)
                  logger.log("Mouse entered trending container")
                }}
                onMouseLeave={() => {
                  setIsTrendingHovered(false)
                  setTooltipToken(null)
                  logger.log("Mouse left trending container")
                }}
                onTouchStart={() => {
                  setIsTrendingHovered(true)
                  logger.log("Touch start on trending container")
                }}
                onTouchEnd={() => {
                  setIsTrendingHovered(false)
                  setTooltipToken(null)
                  logger.log("Touch end on trending container")
                }}
              >
                {[...trendingTokens, ...trendingTokens].map((token, index) => (
                  <motion.div
                    key={`${token.id}-${index}`}
                    ref={(el) => (tokenRefs.current[`${token.id}-${index}`] = el)}
                    className="relative mx-2 sm:mx-2.5 mr-2 flex items-center gap-1 px-1.5 py-0.5 cursor-pointer transition-all duration-300"
                    onClick={() => {
                      handleTokenSelect(token)
                      logger.log("Clicked trending token:", { id: token.id, index })
                    }}
                    onMouseEnter={() => {
                      setHoveredToken(`${token.id}-${index}`)
                      setTooltipToken(token)
                      updateTooltipPosition(token.id, index)
                      logger.log("Hover token:", { id: token.id, index })
                    }}
                    onMouseLeave={() => {
                      setHoveredToken(null)
                      setTooltipToken(null)
                      logger.log("Leave token:", { id: token.id, index })
                    }}
                    onTouchStart={() => {
                      setHoveredToken(`${token.id}-${index}`)
                      setTooltipToken(token)
                      updateTooltipPosition(token.id, index)
                      logger.log("Touch token:", { id: token.id, index })
                    }}
                    onTouchEnd={() => {
                      setHoveredToken(null)
                      setTooltipToken(null)
                      logger.log("Leave token:", { id: token.id, index })
                    }}
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <img
                      src={token.thumb || token.image?.thumb || "/fallback-image.png"}
                      alt={`${token.symbol} logo`}
                      className="w-3 sm:w-4 h-3 sm:h-4 rounded-full"
                      onError={(e) => {
                        logger.error("Token logo failed to load:", { symbol: token.symbol, src: token.thumb })
                        e.target.src = "/fallback-image.png"
                      }}
                    />
                    <span className="text-white text-[8px] sm:text-[10px] font-medium">{token.symbol.toUpperCase()}</span>
                    <span
                      className={`text-[8px] sm:text-[9px] font-medium ${token.price_change_percentage_24h >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {token.price_change_percentage_24h >= 0 ? "+" : ""}
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
        <motion.div
          className="text-[10px] sm:text-xs text-red-400 text-center p-2 sm:p-4 bg-red-500/10 border border-red-500/20 rounded-lg mb-2"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Error: {error}
        </motion.div>
      )}

      {!loading && !error && tokens.length > 0 && (
        <div
          className={`flex flex-col md:grid md:grid-cols-2 gap-4 sm:gap-4 h-[calc(100%-4rem)] sm:h-[calc(100%-1rem)] ${isMobile ? "space-y-4 overflow-y-auto hide-scrollbar" : ""}`}
        >
          {/* Left Column - Token Info & Chart */}
          <div className="flex flex-col gap-4 max-h-full min-h-[800px] sm:max-h-full overflow-y-auto hide-scrollbar">
            {/* Token Information Panel */}
            <motion.div
              className="border border-white/10 p-4 sm:p-4 rounded-xl min-h-[280px] sm:min-h-[310px] sm:max-h-[310px] overflow-y-auto custom-scrollbar bg-white/5 backdrop-blur-xl relative"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <LoadingOverlay
                isLoading={isLoadingSelectedToken && !localCache.current[`token-metadata-${selectedToken?.id}`]?.data}
                isMobile={isMobile}
              />
              {isLoadingSelectedToken && !localCache.current[`token-metadata-${selectedToken?.id}`]?.data ? (
                <div className="h-full flex items-center justify-center">{/* Loading handled by LoadingOverlay */}</div>
              ) : selectedToken || localCache.current[`token-metadata-${selectedToken?.id}`]?.data ? (
                <div className="relative">
                  <div className="absolute top-1 right-1 w-32 sm:w-40" ref={dropdownRef}>
                    <motion.button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="text-white px-2 sm:px-2 py-1 sm:py-1 text-[10px] sm:text-xs flex items-center w-full border-2 border-white/20 bg-white/5 hover:bg-white/10 transition-all duration-300 rounded-xl"
                      aria-label="Select token"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
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
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                          {(
                            selectedToken?.symbol ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol
                          )?.toUpperCase() || "Token"}
                        </>
                      ) : (
                        "Select Token"
                      )}
                      <motion.span
                        className="ml-auto text-[10px] sm:text-xs"
                        animate={{ rotate: isDropdownOpen ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        {isDropdownOpen ? "▲" : "▼"}
                      </motion.span>
                    </motion.button>
                    {isDropdownOpen && (
                      <motion.div
                        className="absolute bg-black/95 backdrop-blur-2xl mt-2 w-full max-h-40 sm:max-h-48 overflow-y-auto border border-white/20 rounded-lg shadow-2xl z-50 hide-scrollbar"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <input
                          type="text"
                          placeholder="Search token (e.g, BTC)"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-white px-3 py-1 sm:py-1.5 w-full text-[8px] sm:text-[10px] border-b border-white/10 bg-transparent focus:outline-none rounded-t-lg"
                        />
                        <div className="p-2">
                          {(searchQuery ? searchResults : tokens.slice(0, 30)).filter(isValidToken).map((token) => (
                            <motion.button
                              key={token.id}
                              onClick={() => handleTokenSelect(token)}
                              className="flex items-center w-full text-left px-3 py-1.5 hover:bg-white/10 text-white text-[8px] sm:text-[10px] transition-all duration-300 rounded"
                              whileHover={{ x: 4 }}
                            >
                              {token.image && (
                                <img
                                  src={token.image || "/placeholder.svg"}
                                  alt={`${token.symbol} logo`}
                                  className="w-4 sm:w-5 h-4 sm:h-5 rounded-full mr-2"
                                  onError={(e) => (e.target.src = "/fallback-image.png")}
                                />
                              )}
                              <div>
                                <div className="font-medium">{token.name}</div>
                                <div className="text-[8px] sm:text-[10px] text-white/60">{token.symbol?.toUpperCase() || "Token"}</div>
                              </div>
                            </motion.button>
                          ))}
                          {(searchQuery ? searchResults : tokens.slice(0, 30)).filter(isValidToken).length === 0 && (
                            <p className="text-[8px] sm:text-[10px] text-white/60 text-center p-2">No tokens found</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </div>
                  <div className="mb-2 sm:mb-2">
                    <div className="flex items-center gap-2">
                      {(selectedToken?.image ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.image) && (
                          <motion.img
                            src={
                              selectedToken?.image ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.image
                            }
                            alt={`${selectedToken?.symbol || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.symbol} logo`}
                            className="w-6 sm:w-7 h-6 sm:h-7"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.4 }}
                          />
                        )}
                      <div>
                        <h4 className="text-base sm:text-sm font-bold text-white tracking-tight">
                          {selectedToken?.name || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.name}
                          <span className="text-white/60 ml-2">
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
                            <span className="text-[10px] sm:text-xs text-white/60 px-2 py-1 rounded-lg">
                              Rank #
                              {selectedToken?.market_cap_rank ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.market_cap_rank}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-2 mb-2 sm:mb-2">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-sm sm:text-sm font-bold text-white">
                          {formatPrice(
                            selectedToken?.current_price?.[currency] ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.current_price?.[currency],
                            currency,
                            8,
                          )}
                        </p>
                        <span
                          className={`text-[9px] sm:text-[9px] font-medium px-3 py-1 rounded-xl ${(
                            selectedToken?.price_change_percentage_24h_in_currency?.[currency] ||
                            localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.price_change_percentage_24h_in_currency?.[currency]
                          ) >= 0
                            ? "text-emerald-400 bg-emerald-400/10"
                            : "text-red-400 bg-red-400/10"
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
                          <motion.a
                            href={`https://twitter.com/${selectedToken?.links?.twitter_screen_name || localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.twitter_screen_name}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 bg-white/10 rounded-xl hover:bg-white/20 transition-all duration-300"
                            title="Twitter"
                            whileHover={{ scale: 1.1, y: -2 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            <img
                              src="/logos/x.png"
                              alt="Twitter"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.png")}
                            />
                          </motion.a>
                        )}
                      {(selectedToken?.links?.chat_url?.[0] ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.chat_url?.[0]) && (
                          <motion.a
                            href={
                              selectedToken?.links?.chat_url?.[0] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.chat_url?.[0]
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 bg-white/10 rounded-xl hover:bg-white/20 transition-all duration-300"
                            title="Discord"
                            whileHover={{ scale: 1.1, y: -2 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            <img
                              src="/logos/discord.png"
                              alt="Discord"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.png")}
                            />
                          </motion.a>
                        )}
                      {(selectedToken?.links?.homepage?.[0] ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.homepage?.[0]) && (
                          <motion.a
                            href={
                              selectedToken?.links?.homepage?.[0] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.homepage?.[0]
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 bg-white/10 rounded-xl hover:bg-white/20 transition-all duration-300"
                            title="Website"
                            whileHover={{ scale: 1.1, y: -2 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            <img
                              src="/logos/website.png"
                              alt="Website"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.png")}
                            />
                          </motion.a>
                        )}
                      {(selectedToken?.links?.repos_url?.github?.[0] ||
                        localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.repos_url?.github?.[0]) && (
                          <motion.a
                            href={
                              selectedToken?.links?.repos_url?.github?.[0] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.links?.repos_url?.github?.[0]
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 bg-white/10 rounded-xl hover:bg-white/20 transition-all duration-300"
                            title="GitHub"
                            whileHover={{ scale: 1.1, y: -2 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            <img
                              src="/logos/github.png"
                              alt="GitHub"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.png")}
                            />
                          </motion.a>
                        )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                    <div className="bg-white/5 rounded-xl p-2">
                      <h5 className="text-[9px] sm:text-[9px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-white/10 to-transparent p-1">
                        Market Stats
                      </h5>
                      <div className="space-y-1 text-[10px] sm:text-[10px]">
                        <div className="flex justify-between">
                          <span className="text-white/60">Market Cap:</span>
                          <span className="text-white font-semibold">
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
                          <span className="text-white/60">FDV:</span>
                          <span className="text-white font-semibold">
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
                          <span className="text-white/60">24h Volume:</span>
                          <span className="text-white font-semibold">
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
                    <div className="bg-white/5 rounded-xl p-2">
                      <h5 className="text-[9px] sm:text-[9px] font-bold text-white uppercase mb-2 tracking-wider bg-gradient-to-r from-white/10 to-transparent p-1">
                        Supply Stats
                      </h5>
                      <div className="space-y-1 text-[10px] sm:text-[10px]">
                        <div className="flex justify-between">
                          <span className="text-white/60">Circulating:</span>
                          <span className="text-white font-semibold">
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
                          <span className="text-white/60">Total Supply:</span>
                          <span className="text-white font-semibold">
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
                          <span className="text-white/60">Max Supply:</span>
                          <span className="text-white font-semibold">
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
                    <div className="bg-white/5 rounded-xl p-2 sm:col-span-2">
                      <h5 className="text-[9px] sm:text-[9px] font-bold text-white uppercase mb-1 tracking-wider bg-gradient-to-r from-white/10 to-transparent p-1">
                        Price Range (24h)
                      </h5>
                      <div className="flex justify-between items-center gap-2 text-[10px] sm:text-[9px]">
                        <div className="flex-1 text-center">
                          <span className="text-white/60 block mb-0.5">ATH</span>
                          <span
                            className={`font-semibold ${typeof (
                              selectedToken?.ath?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath?.[currency]
                            ) === "number"
                              ? (
                                selectedToken?.ath_change_percentage?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.ath_change_percentage?.[currency]
                              ) >= 0
                                ? "text-red-400"
                                : "text-emerald-400"
                              : "text-white"
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
                          <span className="text-white/60 block mb-0.5">ATL</span>
                          <span
                            className={`font-semibold ${typeof (
                              selectedToken?.atl?.[currency] ||
                              localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl?.[currency]
                            ) === "number"
                              ? (
                                selectedToken?.atl_change_percentage?.[currency] ||
                                localCache.current[`token-metadata-${selectedToken?.id}`]?.data?.atl_change_percentage?.[currency]
                              ) >= 0
                                ? "text-red-400"
                                : "text-emerald-400"
                              : "text-white"
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
                          <span className="text-white/60 block mb-0.5">24H High</span>
                          <span className="text-emerald-400 font-semibold">
                            {formatPrice(highLowData.high, currency, 8)}
                          </span>
                        </div>
                        <div className="flex-1 text-center">
                          <span className="text-white/60 block mb-0.5">24H Low</span>
                          <span className="text-red-400 font-semibold">
                            {formatPrice(highLowData.low, currency, 8)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-[10px] sm:text-xs text-white/60 text-center">Please select a token to view details.</p>
                </div>
              )}
            </motion.div>

            {/* Chart Panel */}
            <motion.div
              className="border border-white/10 p-2 sm:p-2 rounded-xl flex-1 min-h-[320px] sm:min-h-[280px] max-h-[200px] sm:max-h-[280px] bg-white/5 backdrop-blur-xl overflow-y-auto  hide-scrollbar"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <LoadingOverlay isLoading={isChartLoading} isMobile={isMobile} />
              <div className="flex flex-col items-center mb-1 sm:mb-2 mt-4 sm:mt-0">
                <div className="flex flex-col sm:flex-row justify-between items-center w-full max-w-[90%] sm:max-w-[600px] gap-2 sm:gap-3">
                  <div className="flex space-x-2 mb-2 sm:mb-0 justify-start sm:justify-center w-full sm:w-auto">
                    <motion.button
                      onClick={debouncedHandleAnalysis}
                      className={`px-2 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-all duration-300 border rounded-xl ${selectedToken && dailyMarketInteractions < 5
                        ? "text-white border-white/20 bg-white/5 hover:bg-white/10"
                        : "text-white/40 border-white/10 cursor-not-allowed opacity-50"
                        }`}
                      disabled={!selectedToken || dailyMarketInteractions >= 5}
                      aria-label="Analyze token"
                      whileHover={{ scale: selectedToken && dailyMarketInteractions < 5 ? 1.05 : 1 }}
                      whileTap={{ scale: selectedToken && dailyMarketInteractions < 5 ? 0.95 : 1 }}
                    >
                      Analyze Token
                    </motion.button>
                    <motion.button
                      onClick={debouncedHandlePrediction}
                      className={`px-2 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-all duration-300 border rounded-xl ${selectedToken && dailyMarketInteractions < 5
                        ? "text-black border-white bg-white hover:bg-white/90"
                        : "text-white/40 border-white/10 cursor-not-allowed opacity-50"
                        }`}
                      disabled={!selectedToken || dailyMarketInteractions >= 5}
                      aria-label="Predict token price"
                      whileHover={{ scale: selectedToken && dailyMarketInteractions < 5 ? 1.05 : 1 }}
                      whileTap={{ scale: selectedToken && dailyMarketInteractions < 5 ? 0.95 : 1 }}
                    >
                      Price Prediction
                    </motion.button>
                  </div>
                  <div className="flex items-center justify-center gap-2 sm:gap-4 mt-2 sm:mt-6 mb-2 sm:mb-0">
                    <div className="text-[8px] sm:text-[9px] text-white/90 text-center">
                      <div className="text-white/60 mb-1">Price Change</div>
                      <div
                        className={`font-bold ${highLowData.percentageChange !== "N/A" && typeof highLowData.percentageChange === "number"
                          ? highLowData.percentageChange >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                          : "text-white/60"
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
                        className="text-white px-2 sm:px-3 py-1 sm:py-1.5 text-[8px] sm:text-[9px] border-2 border-white/20 bg-white/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/30"
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
              ) : priceHistory && priceHistory.length > 0 ? (
                <div className="h-48 sm:h-58">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={priceHistory} margin={{ top: 10, right: 15, bottom: 5, left: isMobile ? 0 : 10 }}>
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
                        isAnimationActive={true}
                        animationDuration={1500}
                      />
                      {priceHistory.length > 0 && (
                        <ReferenceDot
                          x={priceHistory[priceHistory.length - 1].title}
                          y={priceHistory[priceHistory.length - 1].price}
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
                  <p className="text-[10px] sm:text-xs text-white/60 text-center">
                    {selectedToken
                      ? "No price data available for this token."
                      : "Please select a token to view the chart."}
                  </p>
                </div>
              )}
              <div className="absolute top-1 right-1 flex items-center group p-2">
                <img src="/logos/CG.png" alt="CG Logo" className="w-4 sm:w-4 h-4 sm:h-4 object-contain opacity-60" />
                <span className="absolute right-20 sm:right-20 text-[8px] sm:text-[9px] text-white/60 opacity-0 translate-x-4 group-hover:opacity-100 group-hover:-translate-x-0 transition-all duration-300 whitespace-nowrap flex items-center">
                  Data powered by
                  <img src="/logos/CG_1.png" alt="CG_1 Logo" className="w-12 sm:w-12 h-12 sm:h-12 object-contain ml-2" />
                </span>
              </div>
            </motion.div>
          </div>

          {/* Right Column - Market Data Tabs */}
          <motion.div
            className="flex flex-col border border-white/10 rounded-xl min-h-[600px] sm:min-h-[500px] sm:max-h-full bg-white/5 market-tab-container hide-scrollbar"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            {selectedToken ? (
              <>
                <div className="flex w-full text-[10px] sm:text-[12px] border-b border-white/10 bg-white/5">
                  <motion.button
                    onClick={() => {
                      setActiveMarketTab("holders")
                      setShowTrades(false)
                    }}
                    className={`flex-1 px-6 py-2 font-semibold transition-all duration-300 relative p-1 ${activeMarketTab === "holders" ? "text-white" : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    whileHover={{ y: -1 }}
                    transition={{ duration: 0.2 }}
                  >
                    TOP HOLDERS
                    {activeMarketTab === "holders" && (
                      <motion.div
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"
                        layoutId="activeTab"
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                      />
                    )}
                  </motion.button>
                  <motion.button
                    onClick={() => {
                      setActiveMarketTab("cex")
                      setShowTrades(false)
                    }}
                    className={`flex-1 px-6 py-2 font-semibold transition-all duration-300 relative p-1 ${activeMarketTab === "cex" ? "text-white" : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    whileHover={{ y: -1 }}
                    transition={{ duration: 0.2 }}
                  >
                    CEX MARKETS
                    {activeMarketTab === "cex" && (
                      <motion.div
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"
                        layoutId="activeTab"
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                      />
                    )}
                  </motion.button>
                  <motion.button
                    onClick={handleDexTabClick}
                    className={`flex-1 px-6 py-2 font-semibold transition-all duration-300 relative p-1 ${activeMarketTab === "dex" ? "text-white" : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    whileHover={{ y: -1 }}
                    transition={{ duration: 0.2 }}
                  >
                    DEX TRADES
                    {activeMarketTab === "dex" && (
                      <motion.div
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"
                        layoutId="activeTab"
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                      />
                    )}
                  </motion.button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto hide-scrollbar">
                  {activeMarketTab === "dex" && (
                    <div className="p-4 text-right text-[10px] text-white/60 border-b border-white/10">
                      <span className="bg-white/5 px-2 py-1 rounded-lg">
                        Last Updated:{" "}
                        {lastDexFetchTime
                          ? new Date(lastDexFetchTime).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                          : "N/A"}
                      </span>
                    </div>
                  )}

                  {activeMarketTab === "holders" && (
                    <div className="flex-1 overflow-y-auto tab-content hide-scrollbar">
                      <LoadingOverlay isLoading={isLoadingOnChain} isMobile={isMobile} />
                      <div className="flex justify-center items-center p-2 border-b border-white/10 bg-white/5">
                        <h4 className="text-xs font-bold text-white text-center uppercase tracking-wider flex items-center gap-2">
                          Top 100
                          {selectedToken.image && (
                            <img
                              src={selectedToken.image || "/placeholder.svg"}
                              alt={`${selectedToken.symbol} logo`}
                              className="w-6 h-6"
                              onError={(e) => {
                                logger.error("Token logo failed to load:", {
                                  symbol: selectedToken.symbol,
                                  src: selectedToken.image,
                                })
                                e.target.src = "/icons/default.png"
                              }}
                            />
                          )}
                          {selectedToken.symbol?.toUpperCase()} Holders
                        </h4>
                      </div>
                      {isLoadingOnChain ? (
                        <div className="text-sm text-white/60 text-center p-6">
                          {/* Loading handled by LoadingOverlay */}
                        </div>
                      ) : onChainError && !NON_EVM_CHAINS.includes(selectedToken?.id.toLowerCase()) ? (
                        <div className="text-sm text-center p-6">
                          <p className="text-red-400">{onChainError}</p>
                        </div>
                      ) : onChainData.topHolders && onChainData.topHolders.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[9px] sm:text-[11px]">
                            <thead className="top-0 z-10 border-b border-white/10 bg-white/5">
                              <tr>
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 fill-white/60"
                                      viewBox="0 0 24 24"
                                    >
                                      <path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z" />
                                    </svg>
                                    Balance
                                  </div>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {onChainData.topHolders.slice(0, 100).map((holder, index) => {
                                const isNonEvmChain = NON_EVM_CHAINS.includes(selectedToken?.id.toLowerCase())
                                const address = holder.address?.toLowerCase()
                                const { text: displayText, image } = truncateAddress(
                                  holder.address,
                                  nameTags,
                                  holder.source,
                                )
                                const isValidAddress =
                                  holder.address &&
                                  (holder.address.match(/^0x[a-fA-F0-9]{40}$/) || // EVM address
                                    holder.address.match(/^(1|3|bc1)[a-zA-Z0-9]+$/)) // Non-EVM (e.g., Bitcoin)

                                return (
                                  <motion.tr
                                    key={index}
                                    className="border-t border-white/10 hover:bg-white/5 transition-all duration-300"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: index * 0.02 }}
                                  >
                                    <td className="px-4 py-3 text-white">
                                      <div className="flex items-center gap-3 group relative">
                                        {image && (
                                          <img
                                            src={image || "/placeholder.svg"}
                                            alt={`${displayText} logo`}
                                            className="w-6 h-6 flex-shrink-0 rounded-full"
                                            onError={(e) => {
                                              logger.error("Name tag image failed to load:", {
                                                address,
                                                src: image,
                                              })
                                              e.target.src = "/icons/default.png"
                                            }}
                                          />
                                        )}
                                        {isNonEvmChain && isValidAddress ? (
                                          <a
                                            href={`https://blockchair.com/${selectedToken?.id.toLowerCase()}/address/${holder.address}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-white hover:text-white/80 transition-colors font-medium"
                                            title={holder.address}
                                          >
                                            {displayText}
                                          </a>
                                        ) : (
                                          <span
                                            className={`text-white font-medium ${isValidAddress ? "cursor-pointer hover:text-white/80 transition-colors" : "cursor-default"}`}
                                            onClick={() => isValidAddress && handleAddressClick(holder.address)}
                                            title={displayText}
                                          >
                                            {displayText}
                                          </span>
                                        )}
                                        {isValidAddress && (
                                          <motion.button
                                            onClick={() => {
                                              navigator.clipboard.writeText(holder.address)
                                              toast.success("Address copied!", { autoClose: 2000 })
                                            }}
                                            className="absolute right-0 text-white/40 hover:text-white/80 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10"
                                            title="Copy address"
                                            whileHover={{ scale: 1.1 }}
                                            whileTap={{ scale: 0.9 }}
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
                                          </motion.button>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 font-bold text-white">
                                      <span className="px-2 py-1 rounded-lg">
                                        {Math.floor(holder.balance).toLocaleString("en-US")}
                                      </span>
                                    </td>
                                  </motion.tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-sm text-white/60 text-center p-6">
                          {NON_EVM_CHAINS.includes(selectedToken?.id.toLowerCase())
                            ? `Top holders data for ${selectedToken?.symbol?.toUpperCase()} is unavailable.`
                            : `No top holders data available for ${selectedToken?.symbol?.toUpperCase() || "selected token"} on ${chains.find((c) => c.value === selectedChain)?.label || "selected chain"
                            }.`}
                        </div>
                      )}
                    </div>
                  )}

                  {activeMarketTab === "cex" && (
                    <div className="flex-1 overflow-x-auto overflow-y-auto tab-content hide-scrollbar">
                      <LoadingOverlay isLoading={isLoadingTickers && !tickerData?.length} isMobile={isMobile} />
                      {tickerError ? (
                        <div className="text-[10px] sm:text-xs text-center p-6">
                          <p className="text-red-400 mb-4">{tickerError}</p>
                          <motion.button
                            onClick={() => fetchTickerData(selectedToken?.id)}
                            className="px-4 py-2 text-white text-sm border border-white/20 rounded-xl hover:bg-white/10 transition-all duration-300"
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
                          <table className="w-full text-[9px] sm:text-[11px]">
                            <thead className="top-0 z-10 border-b border-white/10 bg-white/5">
                              <tr>
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <motion.tr
                                  key={`${ticker.market.identifier}-${ticker.base}-${ticker.target}-${index}`}
                                  className="border-t border-white/10 hover:bg-white/5 transition-all duration-300"
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ duration: 0.3, delay: index * 0.02 }}
                                >
                                  <td className="px-4 py-3 text-white">
                                    <div className="flex items-center gap-3">
                                      {ticker.market.logo && (
                                        <img
                                          src={ticker.market.logo || "/placeholder.svg"}
                                          alt={`${ticker.market.name} logo`}
                                          className="w-6 h-6 flex-shrink-0 rounded-full"
                                          onError={(e) => (e.target.src = "/fallback-image.png")}
                                        />
                                      )}
                                      <a
                                        href={ticker.trade_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-white hover:text-white/80 transition-colors font-medium truncate"
                                        title={ticker.market.name}
                                      >
                                        {ticker.market.name}
                                      </a>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-white/90 font-medium">
                                    <span className="bg-white/5 px-2 py-1 rounded-lg">
                                      {ticker.base}/{ticker.target}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-white font-semibold">
                                    {ticker.converted_last.usd != null
                                      ? formatPrice(ticker.converted_last.usd, "usd", 8)
                                      : "N/A"}
                                  </td>
                                  <td className="px-4 py-3 text-white/90">
                                    $
                                    {ticker.converted_volume.usd?.toLocaleString("en-US", {
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 0,
                                    }) || "N/A"}
                                  </td>
                                  <td className="px-4 py-3 text-white/70 text-[10px] sm:text-xs">
                                    {ticker.last_traded_at
                                      ? new Date(ticker.last_traded_at).toLocaleTimeString("en-US", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                      : "N/A"}
                                  </td>
                                </motion.tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        !isLoadingTickers && (
                          <div className="text-sm text-white/60 text-center p-6">
                            {selectedToken
                              ? `No CEX data available for ${selectedToken.symbol?.toUpperCase() || "selected token"}.`
                              : "Please select a token to view CEX data."}
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {/* DEX Tab */}
                  {activeMarketTab === "dex" && (
                    <div className="flex-1 overflow-y-auto tab-content hide-scrollbar">
                      <LoadingOverlay isLoading={isLoadingDex && !dexData.trades?.length} isMobile={isMobile} />
                      {dexError ? (
                        <div className="text-[10px] text-xs text-center p-6">
                          <p className="text-red-400 mb-4">{dexError}</p>
                          <motion.button
                            onClick={() => {
                              const { chain, tokenAddress } = getDefaultChainAndAddress(selectedToken, selectedChain)
                              if (chain && tokenAddress) {
                                fetchDexData(chain, tokenAddress)
                              }
                            }}
                            className="px-4 py-2 text-white text-sm border border-white/20 rounded-xl hover:bg-white/10 transition-all duration-300"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            Retry
                          </motion.button>
                        </div>
                      ) : isLoadingDex && !dexData.trades?.length ? (
                        <SkeletonLoader count={5} isMobile={isMobile} />
                      ) : dexData.trades.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[9px] sm:text-[11px]">
                            <thead className="top-0 z-10 border-b border-white/10 bg-white/5">
                              <tr>
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-center font-semibold">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                <th className="px-3 py-1.5 text-white text-left font-semibold">
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-5 w-5 stroke-white/60 fill-none"
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
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ duration: 0.3, ease: "easeOut", delay: index * 0.02 }}
                                  className="border-t border-white/10 hover:bg-white/5 transition-all duration-300"
                                >
                                  <td className="px-4 py-3 text-white">
                                    <div className="flex items-center gap-2">
                                      {selectedToken?.image && (
                                        <img
                                          src={selectedToken.image || "/placeholder.svg"}
                                          alt={`${selectedToken.symbol} logo`}
                                          className="w-6 h-6 rounded-full flex-shrink-0"
                                          onError={(e) => (e.target.src = "/fallback-image.png")}
                                        />
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-white">
                                    <div className="flex items-center gap-2 group relative">
                                      <a
                                        href={
                                          getExplorerUrls(selectedChain, trade.tx_hash, trade.tx_from_address)
                                            .addressUrl
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-white hover:text-white/80 transition-colors font-medium"
                                        title={trade.tx_from_address}
                                      >
                                        {(() => {
                                          if (!trade.tx_from_address || typeof trade.tx_from_address !== "string")
                                            return "N/A"
                                          return `${trade.tx_from_address.slice(0, 6)}...${trade.tx_from_address.slice(-4)}`
                                        })()}
                                      </a>
                                      {trade.tx_from_address && typeof trade.tx_from_address === "string" && (
                                        <motion.button
                                          onClick={() => {
                                            navigator.clipboard.writeText(trade.tx_from_address)
                                            toast.success("Address copied!", { autoClose: 2000 })
                                          }}
                                          className="absolute right-0 text-white/40 hover:text-white/80 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10"
                                          title="Copy address"
                                          whileHover={{ scale: 1.1 }}
                                          whileTap={{ scale: 0.9 }}
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
                                        </motion.button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-white">
                                    <div className="flex items-center gap-2 group relative">
                                      <a
                                        href={
                                          getExplorerUrls(selectedChain, trade.tx_hash, trade.to_token_address)
                                            .addressUrl
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-white hover:text-white/80 transition-colors font-medium"
                                        title={trade.to_token_address}
                                      >
                                        {(() => {
                                          if (!trade.to_token_address || typeof trade.to_token_address !== "string")
                                            return "N/A"
                                          return `${trade.to_token_address.slice(0, 6)}...${trade.to_token_address.slice(-4)}`
                                        })()}
                                      </a>
                                      {trade.to_token_address && typeof trade.to_token_address === "string" && (
                                        <motion.button
                                          onClick={() => {
                                            navigator.clipboard.writeText(trade.to_token_address)
                                            toast.success("Address copied!", { autoClose: 2000 })
                                          }}
                                          className="absolute right-0 text-white/40 hover:text-white/80 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10"
                                          title="Copy address"
                                          whileHover={{ scale: 1.1 }}
                                          whileTap={{ scale: 0.9 }}
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
                                        </motion.button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-white">
                                    <div className="flex flex-col gap-1">
                                      <span className="font-semibold">
                                        {Math.floor(
                                          Number.parseFloat(
                                            trade.kind === "sell"
                                              ? trade.from_token_amount
                                              : trade.to_token_amount || 0,
                                          ),
                                        ).toLocaleString("en-US")}{" "}
                                        {(() => {
                                          const tokenAddress =
                                            trade.kind === "sell" ? trade.from_token_address : trade.to_token_address
                                          return tokenAddress.toLowerCase() ===
                                            selectedToken?.detail_platforms?.[
                                              chains.find((c) => c.value === selectedChain)?.coingeckoId
                                            ]?.contract_address?.toLowerCase()
                                            ? selectedToken?.symbol?.toUpperCase()
                                            : "Token"
                                        })()}
                                      </span>
                                      <div className="flex items-center gap-2 text-xs">
                                        <span className="text-white/60">
                                          ${Math.floor(Number.parseFloat(trade.volume_in_usd)).toLocaleString("en-US")}
                                        </span>
                                        <span
                                          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${trade.kind === "buy" ? "bg-emerald-400/20 text-emerald-400" : "bg-red-500/40 text-red-500"}`}
                                        >
                                          {trade.kind.charAt(0).toUpperCase() + trade.kind.slice(1)}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-white text-center">
                                    <div className="flex flex-col gap-1 items-center group relative">
                                      <a
                                        href={
                                          getExplorerUrls(selectedChain, trade.tx_hash, trade.tx_from_address).txUrl
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        title={trade.tx_hash}
                                        className="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 transition-all duration-300"
                                      >
                                        <img
                                          src="/logos/etherscan-logo.png"
                                          alt="Etherscan"
                                          className="w-4 h-4"
                                          onError={(e) => (e.target.src = "/fallback-image.png")}
                                        />
                                      </a>
                                      <span className="text-[10px] text-white/60 text-center">
                                        {formatDistanceToNow(new Date(trade.block_timestamp), { addSuffix: true })}
                                      </span>
                                      {trade.tx_hash && typeof trade.tx_hash === "string" && (
                                        <motion.button
                                          onClick={() => {
                                            navigator.clipboard.writeText(trade.tx_hash)
                                            toast.success("Transaction hash copied!", { autoClose: 2000 })
                                          }}
                                          className="absolute right-0 text-white/40 hover:text-white/80 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10"
                                          title="Copy transaction hash"
                                          whileHover={{ scale: 1.1 }}
                                          whileTap={{ scale: 0.9 }}
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
                                        </motion.button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-white">
                                    <motion.button
                                      onClick={() => trade.pool_address && handlePoolClick(trade.pool_address)}
                                      className="flex items-center gap-2 text-[10px] sm:text-xs hover:bg-white/10 p-2 rounded-xl transition-all duration-300"
                                      title={
                                        dexData.pools.find((p) => p.attributes.address === trade.pool_address)
                                          ?.attributes.name || "View Pool Details"
                                      }
                                      disabled={!trade.pool_address || !dexData.poolTokens[trade.pool_address]}
                                      whileHover={{ scale: 1.05 }}
                                      whileTap={{ scale: 0.95 }}
                                    >
                                      {(() => {
                                        const poolTokens =
                                          trade.pool_address && typeof trade.pool_address === "string"
                                            ? dexData.poolTokens[trade.pool_address] || {}
                                            : {}
                                        const tokenAddresses = Object.keys(poolTokens)
                                        const token1 = tokenAddresses[0] ? poolTokens[tokenAddresses[0]] : null
                                        const token2 = tokenAddresses[1] ? poolTokens[tokenAddresses[1]] : null
                                        return token1 && token2 ? (
                                          <div className="flex items-center gap-2">
                                            <img
                                              src={token1.image_url || "/placeholder.svg"}
                                              alt={`${token1.symbol} logo`}
                                              className="w-5 h-5 rounded-full flex-shrink-0"
                                              onError={(e) => (e.target.src = "/fallback-image.png")}
                                            />
                                            <span className="text-white/40">/</span>
                                            <img
                                              src={token2.image_url || "/placeholder.svg"}
                                              alt={`${token2.symbol} logo`}
                                              className="w-5 h-5 rounded-full flex-shrink-0"
                                              onError={(e) => (e.target.src = "/fallback-image.png")}
                                            />
                                          </div>
                                        ) : (
                                          <span className="text-white/60">N/A</span>
                                        )
                                      })()}
                                    </motion.button>
                                  </td>
                                </motion.tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        !isLoadingDex && (
                          <div className="text-sm text-white/60 text-center p-6">
                            No DEX data available for {selectedToken?.symbol?.toUpperCase() || "selected token"} on{" "}
                            {chains.find((c) => c.value === selectedChain)?.label || "selected chain"}.
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <SkeletonLoader count={5} isMobile={isMobile} />
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Additional Components - keeping existing functionality */}
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
      <Modal
        isOpen={!!analysis}
        onClose={() => {
          setAnalysis(null)
          setAnalysisLinks([])
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
        links={[
          `https://www.geckoterminal.com/${GECKOTERMINAL_CHAIN_MAPPING[selectedChain]}/pools/${selectedPool?.address}`,
        ]}
        isMobile={isMobile}
      />

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
    </motion.div>
  )
}

export default React.memo(MarketTab)
