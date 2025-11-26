// components/ClusterTab.jsx
"use client";
import React, { useState, useEffect, useMemo, useRef, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useCallback } from 'react';
import debounce from 'lodash/debounce';
import { motion, AnimatePresence } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { formatDistanceToNow } from "date-fns";
import { useCurrency } from "./CurrencyContext";
import { useRouter, useSearchParams } from "next/navigation";
import UniversalSearch from "./UniversalSearch";
import WalletBalances from "./WalletBalances";
import LoginPrompt from "./LoginPrompt";
import { CHAIN_ID_TO_NAME } from "../utils/constants";
import { SkeletonLoader, formatPrice, truncateAddress, LoadingOverlay, getExplorerUrls } from "../utils/helpers";
import "../styles/MarketTab.css";
import "react-loading-skeleton/dist/skeleton.css";
import { logger } from '../utils/clientLogger';
import { Virtuoso } from 'react-virtuoso';
import useSWR from 'swr';
import { cacheData, getCachedData } from '../utils/indexedDB';
// Define logos for Bitcoin, Dogecoin, and Litecoin
const BITCOIN_LOGO = "/logos/bitcoin.webp";
const DOGECOIN_LOGO = "/logos/dogecoin.webp";
const LITECOIN_LOGO = "/logos/litecoin.webp";
const NAMETAG_LOGOS = {
  "binance cold wallet": "/logos/binance-cold-wallet.webp",
  "kraken-wallet": "/icons/kraken.webp",
  "blackrock-ibit": "/icons/blackrock.webp",
  "fidelity-fbtc": "/icons/fidelity.webp",
  "grayscale": "/icons/grayscale.webp", // Assuming, adjust if needed
  "grayscale-mini": "/icons/grayscale.webp",
  "21shares-arkb": "/icons/21shares.webp",
  "bitwise-bitb": "/icons/bitwise.webp",
  "vaneck-hodl": "/icons/vaneck.webp", // Assuming, adjust if needed
  // Thêm các nametag khác nếu cần
};
const EXCHANGE_MAPPING = {
  okx: "okex",
  bybit: "bybit_spot",
  binance: "binance",
  kraken: "kraken",
  huobi: "huobi-global",
  kucoin: "kucoin",
  "gate.io": "gate-io",
  bitfinex: "bitfinex",
  uniswap: "uniswap",
  mtgox: "mtgox",
};
const normalizeTimestamp = (tx) => {
  // Safely determine chain type
  const chain = typeof tx.chain === 'string' ? tx.chain.toLowerCase() : (tx.chain_id || 'unknown').toString().toLowerCase();
  if (chain === "bitcoin" && tx.timestamp) {
    // Bitcoin timestamp is in seconds
    return Number(tx.timestamp);
  } else if (tx.block_time) {
    // EVM block_time is an ISO string, convert to seconds
    try {
      const date = new Date(tx.block_time);
      if (isNaN(date.getTime())) {
        logger.warn("Invalid block_time date for transaction:", {
          txid: tx.txid || tx.hash,
          block_time: tx.block_time,
          chain,
        });
        return 0;
      }
      return Math.floor(date.getTime() / 1000);
    } catch (e) {
      logger.warn("Error parsing block_time for transaction:", {
        txid: tx.txid || tx.hash,
        block_time: tx.block_time,
        chain,
        error: e.message,
      });
      return 0;
    }
  }
  logger.warn("Missing timestamp for transaction:", {
    txid: tx.txid || tx.hash,
    block_time: tx.block_time,
    timestamp: tx.timestamp,
    chain,
  });
  return 0;
};
const formatLargeNumber = (value, currency, decimals = 2) => {
  const absValue = Math.abs(value);
  if (absValue >= 1e9) {
    return `${currency === "usd" ? "$" : currency}${Number((value / 1e9).toFixed(decimals))}B`;
  } else if (absValue >= 1e6) {
    return `${currency === "usd" ? "$" : currency}${Number((value / 1e6).toFixed(decimals))}M`;
  } else if (absValue >= 1e3) {
    return `${currency === "usd" ? "$" : currency}${Number((value / 1e3).toFixed(decimals))}K`;
  }
  return `${currency === "usd" ? "$" : currency}${Number(value.toFixed(decimals)).toLocaleString("en-US")}`;
};
const mapExchangeId = (id) => EXCHANGE_MAPPING[id.toLowerCase()] || id.toLowerCase();
const setCachedData = async (key, data) => {
  try {
    await cacheData(key, { data, timestamp: Date.now() });
  } catch (err) {
    logger.error(`Error writing cache for ${key}:`, { error: err.message });
  }
};
const CustomTooltip = ({ active, payload, label, currency }) => {
  if (active && payload && payload.length) {
    return (
      <motion.div
        className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] p-3 rounded-2xl text-[#FFF] text-sm font-medium shadow-2xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <p className="text-[#D4D4D4] text-xs mb-1">{label}</p>
        <p className="text-[#FFF] font-semibold">
          Volume: <span className="text-emerald-400">{formatLargeNumber(payload[0].value, currency, 2)} {currency.toUpperCase()}</span>
        </p>
      </motion.div>
    );
  }
  return null;
};
const ClusterTab = ({ recaptchaRef, initialClusterId, activeTab: propActiveTab, setActiveTab: propSetActiveTab }) => {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clusterIdFromQuery = searchParams.get("clusterId") || initialClusterId || "binance";
  const { currency } = useCurrency();
  const [exchangeData, setExchangeData] = useState(null);
  const [clusterImage, setClusterImage] = useState(null);
  const [volumeHistory, setVolumeHistory] = useState([]);
  const [portfolioData, setPortfolioData] = useState([]);
  const [walletData, setWalletData] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [isLoadingExchange, setIsLoadingExchange] = useState(false);
  const [isLoadingVolume, setIsLoadingVolume] = useState(false);
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [isLoadingWallets, setIsLoadingWallets] = useState(false);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [error, setError] = useState(null);
  const [transactionsError, setTransactionsError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [chainLogos, setChainLogos] = useState({});
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [walletBalances, setWalletBalances] = useState([]);
  const [walletTransactions, setWalletTransactions] = useState([]);
  const [isLoadingWalletBalances, setIsLoadingWalletBalances] = useState(false);
  const [isLoadingWalletTransactions, setIsLoadingWalletTransactions] = useState(false);
  const [walletBalancesError, setWalletBalancesError] = useState(null);
  const [walletTransactionsError, setWalletTransactionsError] = useState(null);
  const [btcPrice, setBtcPrice] = useState(null);
  const [dogePrice, setDogePrice] = useState(null);
  const [ltcPrice, setLtcPrice] = useState(null);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [selectedChain, setSelectedChain] = useState("all");
  const [toggledToken, setToggledToken] = useState(null);
  const portfolioRef = useRef(null);
  const [localActiveTab, setLocalActiveTab] = useState("portfolio");
  const [isPending, startTransition] = useTransition();
  const currentActiveTab = propActiveTab !== undefined ? propActiveTab : localActiveTab;
  const currentSetActiveTab = propSetActiveTab !== undefined ? propSetActiveTab : setLocalActiveTab;
  // Handle click outside to close toggle
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (portfolioRef.current && !portfolioRef.current.contains(event.target)) {
        setToggledToken(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  // Fetch chain logos with IndexedDB cache
  useEffect(() => {
    const fetchChainLogos = async () => {
      const cacheKey = `coingecko:chains`;
      const cachedLogos = await getCachedData(cacheKey);
      if (cachedLogos) {
        setChainLogos(cachedLogos);
        logger.info(`Cache hit for chain logos from IndexedDB`);
        return;
      }
      try {
        const response = await fetch("/api/coingecko/chains", {
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Failed to fetch chain data");
        const logos = result.data.reduce((acc, chain) => {
          acc[chain.id.toLowerCase()] = chain.image?.thumb || "/fallback-image.webp";
          return acc;
        }, {});
        logos["bitcoin"] = BITCOIN_LOGO;
        logos["dogecoin"] = DOGECOIN_LOGO;
        logos["litecoin"] = LITECOIN_LOGO;
        setChainLogos(logos);
        await setCachedData(cacheKey, logos);
        logger.log("Fetched and cached chain logos:", { data: logos });
      } catch (err) {
        logger.error("Error fetching chain logos:", { error: err.message, stack: err.stack });
      }
    };
    fetchChainLogos();
  }, []);
  // Fetch coin prices using CoinGecko /simple/price endpoint with IndexedDB cache
  const fetchCoinPrices = async () => {
    setIsLoadingPrices(true);
    const cacheKey = `coingecko:coin-prices:${currency}`;
    const cachedPrices = await getCachedData(cacheKey);
    if (cachedPrices) {
      startTransition(() => {
        setBtcPrice(cachedPrices.bitcoin || 0);
        setDogePrice(cachedPrices.dogecoin || 0);
        setLtcPrice(cachedPrices.litecoin || 0);
      });
      logger.info(`Cache hit for coin prices: bitcoin, dogecoin, litecoin`);
      setIsLoadingPrices(false);
      return;
    }
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,dogecoin,litecoin&vs_currencies=${currency}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Your-App-Name/1.0'
          },
        }
      );
      const result = await response.json();
      if (response.ok) {
        const prices = {
          bitcoin: result.bitcoin?.[currency] || 0,
          dogecoin: result.dogecoin?.[currency] || 0,
          litecoin: result.litecoin?.[currency] || 0,
        };
        startTransition(() => {
          setBtcPrice(prices.bitcoin);
          setDogePrice(prices.dogecoin);
          setLtcPrice(prices.litecoin);
        });
        await setCachedData(cacheKey, prices);
        logger.info(`Fetched and cached coin prices:`, { prices });
      } else {
        throw new Error('Failed to fetch coin prices');
      }
    } catch (err) {
      logger.error(`Error fetching coin prices:`, { error: err.message, stack: err.stack });
      startTransition(() => {
        setBtcPrice(0);
        setDogePrice(0);
        setLtcPrice(0);
      });
      setError('Failed to fetch coin prices');
    } finally {
      setIsLoadingPrices(false);
    }
  };
  // Fetch coin prices and volume history when clusterId or currency changes
  useEffect(() => {
    fetchCoinPrices();
  }, [currency]);
  useEffect(() => {
    const mappedId = mapExchangeId(clusterIdFromQuery);
    if (btcPrice && dogePrice && ltcPrice) {
      fetchVolumeHistory(mappedId);
    }
  }, [clusterIdFromQuery, currency, btcPrice, dogePrice, ltcPrice]);
  // Fetch cluster image from DB using search-clusters API with IndexedDB cache
  const fetchClusterImage = async (clusterId) => {
    const normalizedClusterId = clusterId.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
    const words = normalizedClusterId.split(/\s+/).filter(Boolean);
    const shortQuery = words.length > 1 ? words[words.length - 1] : clusterId.toLowerCase();
    const cacheKey = `cluster:image:${clusterId.toLowerCase()}`;
    const cachedImage = await getCachedData(cacheKey);
    if (cachedImage) {
      setClusterImage(cachedImage);
      logger.info(`Cache hit for cluster image: ${clusterId}`);
      return;
    }
    try {
      const response = await fetch(`/api/search-clusters?query=${encodeURIComponent(shortQuery)}`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const result = await response.json();
      if (response.ok && result.success && result.data && result.data.length > 0) {
        const image = result.data[0].image || `/icons/${shortQuery}.webp`;
        setClusterImage(image);
        await setCachedData(cacheKey, image);
        logger.info(`Fetched and cached cluster image from DB: ${clusterId}`, { image, shortQuery });
      } else {
        const fallback = `/icons/${shortQuery}.webp`;
        setClusterImage(fallback);
        await setCachedData(cacheKey, fallback);
        logger.warn(`No cluster image found in DB for: ${clusterId}, using fallback`, { shortQuery });
      }
    } catch (err) {
      logger.error(`Error fetching cluster image for ${clusterId}:`, { error: err.message, stack: err.stack });
      const fallback = `/icons/${shortQuery}.webp`;
      setClusterImage(fallback);
      await setCachedData(cacheKey, fallback);
    }
  };
  // Fetch exchange data with IndexedDB cache
  const fetchExchangeData = async (originalId, mappedId) => {
    const cacheKey = `coingecko:exchange-details:${mappedId}:${currency}`;
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      startTransition(() => setExchangeData(cachedData));
      logger.info(`Cache hit for exchange data: ${mappedId} from IndexedDB`);
      return;
    }
    setIsLoadingExchange(true);
    try {
      const response = await fetch(`/api/coingecko?action=exchange-details&id=${mappedId}`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || `Failed to fetch exchange data for ${mappedId}`);
      }
      if (!result.data) {
        throw new Error(`No data found for exchange: ${mappedId}`);
      }
      // Validate and process trust_score
      const trustScore = result.data.trust_score !== undefined && result.data.trust_score !== null
        ? Number(result.data.trust_score).toFixed(1) // Ensure trust score is a number with 1 decimal
        : "N/A";
      const exchangeData = {
        ...result.data,
        name: result.data.name || originalId.charAt(0).toUpperCase() + originalId.slice(1),
        image: result.data.image, // Set from CoinGecko if available, otherwise null to fallback to clusterImage
        country: result.data.country || "N/A",
        year_established: result.data.year_established || "N/A",
        trust_score: trustScore,
        trade_volume_24h_btc: Number(result.data.trade_volume_24h_btc) || 0,
        centralized: result.data.centralized !== undefined ? result.data.centralized : true,
        twitter_handle: result.data.twitter_handle || null,
        url: result.data.url || null,
      };
      startTransition(() => setExchangeData(exchangeData));
      await setCachedData(cacheKey, exchangeData);
      logger.log("Fetched and cached exchange data:", { mappedId, trustScore: exchangeData.trust_score, data: exchangeData });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching exchange data";
      const fallback = {
        name: originalId.charAt(0).toUpperCase() + originalId.slice(1),
        image: null, // Use null to fallback to clusterImage
        country: "N/A",
        year_established: "N/A",
        trust_score: "N/A", // Fallback only if API fails completely
        trade_volume_24h_btc: 0,
        centralized: true,
        twitter_handle: null,
        url: null,
      };
      startTransition(() => setExchangeData(fallback));
      await setCachedData(cacheKey, fallback);
      logger.error("Error fetching exchange data:", { originalId, mappedId, error: errorMessage, stack: err.stack });
      setError(errorMessage);
    } finally {
      setIsLoadingExchange(false);
    }
  };
  const debouncedSetTransactions = useCallback(
    debounce((newTransactions) => {
      startTransition(() => {
        setTransactions(newTransactions);
      });
    }, 100),
    [startTransition]
  );
  const debouncedSetWalletTransactions = useCallback(
    debounce((newTransactions) => {
      startTransition(() => {
        setWalletTransactions(newTransactions);
      });
    }, 100),
    [startTransition]
  );
  // Fetch volume history with IndexedDB cache
  const fetchVolumeHistory = async (exchangeId) => {
    if (!btcPrice || !dogePrice || !ltcPrice) {
      logger.warn("Coin prices not available, skipping volume history fetch", { exchangeId });
      startTransition(() => setVolumeHistory([]));
      setIsLoadingVolume(false);
      return;
    }
    const cacheKey = `coingecko:volume-chart:${exchangeId}:7:${currency}`;
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      startTransition(() => setVolumeHistory(cachedData));
      logger.info(`Cache hit for volume history: ${exchangeId} from IndexedDB`);
      setIsLoadingVolume(false);
      return;
    }
    setIsLoadingVolume(true);
    try {
      const response = await fetch(`/api/coingecko?action=volume-chart&id=${exchangeId}&days=7`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Failed to fetch volume data");
      if (!Array.isArray(result.data)) {
        logger.warn("Invalid volume data format:", { exchangeId, data: result.data });
        throw new Error("Volume data is not an array");
      }
      const convertedData = result.data.map(([timestamp, volume]) => ({
        title: new Date(timestamp).toLocaleDateString(),
        volume: (Number(volume) || 0) * btcPrice,
      }));
      startTransition(() => setVolumeHistory(convertedData));
      await setCachedData(cacheKey, convertedData);
      logger.log("Fetched and cached volume history:", { exchangeId, btcPrice, convertedData });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching volume history";
      logger.error("Error fetching volume history:", { exchangeId, error: errorMessage, stack: err.stack });
      startTransition(() => setVolumeHistory([]));
      setError(errorMessage);
    } finally {
      setIsLoadingVolume(false);
    }
  };
  // Fetch portfolio and wallets without prices
  const fetchPortfolioAndWallets = async (clusterId) => {
    setIsLoadingPortfolio(true);
    setIsLoadingWallets(true);
    setError(null); // Clear previous errors
    try {
      logger.info(`Fetching portfolio/wallet data for cluster: ${clusterId}`);
      const csrfToken = document.cookie.split('; ').find(row => row.startsWith('csrf_token='))?.split('=')[1] || 'dev-csrf';
      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      };
      if (status === 'authenticated' && session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
      }
      const response = await fetch(`/api/token-cluster?exchange=${encodeURIComponent(clusterId)}&currency=${encodeURIComponent(currency)}`, {
        headers,
        credentials: 'include',
        signal: AbortSignal.timeout(50000),
      });
      if (!response.ok) {
        const text = await response.text();
        let errorMessage = `Failed to fetch portfolio/wallet data: ${response.status} ${response.statusText}`;
        try {
          const result = JSON.parse(text);
          errorMessage = result.detail || errorMessage;
        } catch {
          errorMessage = `Failed to fetch portfolio/wallet data: Invalid JSON response`;
        }
        throw new Error(errorMessage);
      }
      const result = await response.json();
      logger.log('API response for portfolio/wallets:', {
        clusterId,
        portfolio: result.portfolio,
        wallets: result.wallets,
        message: result.message,
      });
      if (!result.success) {
        throw new Error(result.detail || `No portfolio or wallet data found for cluster: ${clusterId}`);
      }
      // Handle partial or no data with a user-friendly message
      if (result.message) {
        setError(result.message); // Set the message as a warning, not an error
        startTransition(() => {
          setPortfolioData([]);
          setWalletData([]);
        });
        toast.info(result.message, { position: 'top-center', autoClose: 5000 });
        logger.info(`No data returned for cluster: ${clusterId}`, { message: result.message });
      } else {
        startTransition(() => {
          setPortfolioData(result.portfolio || []);
          setWalletData(
            result.wallets.map(wallet => ({
              ...wallet,
              cluster_name: wallet.cluster_name || clusterId.charAt(0).toUpperCase() + clusterId.slice(1),
              image: wallet.image || `/icons/${clusterId.toLowerCase()}.webp` || '/fallback-image.webp',
            })) || []
          );
        });
        logger.log('Fetched portfolio and wallet data:', {
          clusterId,
          portfolioCount: result.portfolio?.length || 0,
          walletCount: result.wallets?.length || 0,
        });
      }
    } catch (err) {
      const errorMessage = err.message || 'Unknown error fetching portfolio/wallet data';
      logger.error('Error fetching portfolio/wallet data:', { clusterId, error: errorMessage, stack: err.stack });
      startTransition(() => {
        setPortfolioData([]);
        setWalletData([]);
      });
      setError(errorMessage);
    } finally {
      setIsLoadingPortfolio(false);
      setIsLoadingWallets(false);
    }
  }
  // Memoized authenticated data
  const memoizedPortfolioData = useMemo(() => portfolioData, [portfolioData, status]);
  const memoizedWalletData = useMemo(() => walletData, [walletData, status]);
  const memoizedTransactions = useMemo(() => transactions, [transactions, status]);
  const memoizedWalletBalances = useMemo(() => walletBalances, [walletBalances, status]);
  const memoizedWalletTransactions = useMemo(() => walletTransactions, [walletTransactions, status]);
  const uniqueWalletData = useMemo(() => {
    logger.log("Processing walletData for deduplication:", { walletData: memoizedWalletData });
    const walletMap = new Map();
    memoizedWalletData.forEach((wallet, index) => {
      const addr = (wallet.holder_address || wallet.name_tag)?.toLowerCase();
      if (!addr) return;
      const chainLower = wallet.chain?.toLowerCase();
      let logo = wallet.image ||
        (chainLower === "bitcoin" ? BITCOIN_LOGO :
          chainLower === "dogecoin" ? DOGECOIN_LOGO :
            chainLower === "litecoin" ? LITECOIN_LOGO :
              "/fallback-image.webp");
      // Check for nametag-specific logos
      const entityIdLower = (wallet.holder_address || wallet.name_tag)?.toLowerCase();
      if (NAMETAG_LOGOS[entityIdLower]) {
        logo = NAMETAG_LOGOS[entityIdLower];
      }
      if (!walletMap.has(addr)) {
        walletMap.set(addr, {
          holder_address: wallet.holder_address || wallet.name_tag, // Use nametag if no address
          display_name: wallet.name_tag || wallet.holder_address || "N/A",
          cluster_name: wallet.cluster_name,
          name_tag: wallet.name_tag || "N/A",
          image: logo,
          total_value_usd: Number(wallet.total_value_usd) || 0,
          token_count: Number(wallet.token_count) || 0,
          key: `${addr}-${index}`,
          chain: wallet.chain,
        });
      } else {
        const existing = walletMap.get(addr);
        existing.total_value_usd += Number(wallet.total_value_usd) || 0;
        existing.token_count += Number(wallet.token_count) || 0;
      }
    });
    const deduplicated = Array.from(walletMap.values());
    logger.log("Deduplicated wallet data:", { deduplicated });
    return deduplicated;
  }, [memoizedWalletData]);
  // SWR for Bitcoin transactions
  const { data: bitcoinTxs, error: bitcoinError, isValidating: bitcoinValidating } = useSWR(
    status === 'authenticated' && clusterIdFromQuery && walletData.length > 0 ? ['bitcoin-transactions', clusterIdFromQuery, walletData.length] : null,
    async () => {
      const mappedId = mapExchangeId(clusterIdFromQuery);
      const cacheKey = `mempool-transactions:${mappedId}`;
      const cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for Bitcoin transactions: ${cacheKey}`);
        return cachedData;
      }
      const response = await fetch(`/api/mempool-transactions?limit=100&maxAge=432000`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
        },
        credentials: "include",
      });
      if (!response.ok) {
        const text = await response.text();
        let errorMessage = `Failed to fetch Bitcoin transactions: ${response.status} ${response.statusText}`;
        try {
          const result = JSON.parse(text);
          errorMessage = result.detail || errorMessage;
        } catch {
          errorMessage = `Failed to fetch Bitcoin transactions: Invalid JSON response`;
        }
        throw new Error(errorMessage);
      }
      const result = await response.json();
      if (!result.success || !Array.isArray(result.data)) {
        throw new Error("Invalid Bitcoin transaction data format");
      }
      const filteredTxs = result.data.filter((tx) => {
        // Normalize Bitcoin addresses for matching (lowercase for legacy and bech32)
        const fromAddresses = tx.inputs.map((input) => input.address.toLowerCase());
        const toAddresses = tx.outputs.map((output) => output.address.toLowerCase());
        const clusterWallets = uniqueWalletData
          .filter((w) => w.chain?.toLowerCase() === "bitcoin")
          .map((w) => {
            let addr = (w.holder_address || w.name_tag || '').toLowerCase();
            // For legacy Bitcoin addresses starting with '1' or '3', ensure full lowercase normalization
            if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr)) {
              addr = addr.toLowerCase(); // Already done, but reinforce
            }
            return addr;
          });
        return (
          fromAddresses.some((addr) => clusterWallets.includes(addr)) ||
          toAddresses.some((addr) => clusterWallets.includes(addr))
        );
      });
      const formattedTxs = filteredTxs.map((tx) => ({
        txid: tx.txid,
        chain: "bitcoin",
        from: tx.inputs[0]?.address || "unknown",
        to: tx.outputs[0]?.address || "unknown",
        value_btc: tx.value_btc || 0,
        value_usd: tx.value_usd || 0,
        timestamp: tx.timestamp || Math.floor(Date.now() / 1000),
        type: "transfer",
        token_metadata: { symbol: "BTC", logo: BITCOIN_LOGO },
      }));
      await setCachedData(cacheKey, formattedTxs);
      logger.log("Fetched and cached Bitcoin transactions:", { clusterId: clusterIdFromQuery, count: formattedTxs.length });
      return formattedTxs;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 5 * 60 * 1000, // 5 minutes
      dedupingInterval: 30 * 1000,
    }
  );
  // SWR for EVM transactions - Optimized: Only fetch from top 10 wallets by value to reduce API calls
  const topEvmWallets = useMemo(() => {
    if (!uniqueWalletData.length) return [];
    const evmWallets = uniqueWalletData
      .filter((w) => !["bitcoin", "dogecoin", "litecoin"].includes(w.chain?.toLowerCase()))
      .sort((a, b) => (Number(b.total_value_usd) || 0) - (Number(a.total_value_usd) || 0)) // Desc by value
      .slice(0, 10) // Top 10
      .map((w) => (typeof w === "string" ? w : w.holder_address))
      .filter(Boolean);
    logger.info(`Optimized EVM wallets for transactions: ${evmWallets.length} top wallets`, { clusterId: clusterIdFromQuery });
    return evmWallets;
  }, [uniqueWalletData, clusterIdFromQuery]);
  const { data: evmTxs, error: evmError, isValidating: evmValidating } = useSWR(
    status === 'authenticated' && topEvmWallets.length > 0 ? ['evm-transactions', topEvmWallets.join(','), currency] : null,
    async () => {
      if (!topEvmWallets.length) return [];
      const cacheKey = `sim:transactions:auth:${topEvmWallets.join(',')}:1000000`;
      const cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for EVM transactions: ${cacheKey}`);
        return cachedData;
      }
      const response = await fetch(`/api/sim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
        },
        credentials: "include",
        body: JSON.stringify({
          action: "transactions",
          addresses: topEvmWallets,
          minValueUsd: 1000000,
        }),
        signal: AbortSignal.timeout(70000),
      });
      if (!response.ok) {
        const text = await response.text();
        let errorMessage = `Failed to fetch transactions: ${response.status} ${response.statusText}`;
        try {
          const result = JSON.parse(text);
          errorMessage = result.detail || errorMessage;
        } catch {
          errorMessage = `Failed to fetch transactions: Invalid JSON response`;
        }
        throw new Error(errorMessage);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let transactionsData = [];
      let buffer = '';
      let isFirstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (isFirstChunk) {
          buffer = buffer.trim().replace(/^\[/, '');
          isFirstChunk = false;
        }
        let pos = 0;
        while (pos < buffer.length) {
          while (pos < buffer.length && (buffer[pos] === ' ' || buffer[pos] === '\n' || buffer[pos] === ',' || buffer[pos] === ']')) {
            pos++;
          }
          if (pos >= buffer.length) break;
          if (buffer[pos] === '{') {
            let openBraces = 1;
            let start = pos;
            pos++;
            while (pos < buffer.length && openBraces > 0) {
              if (buffer[pos] === '{') openBraces++;
              else if (buffer[pos] === '}') openBraces--;
              pos++;
            }
            if (openBraces === 0) {
              const objStr = buffer.substring(start, pos).trim();
              try {
                const parsedObj = JSON.parse(objStr);
                if (parsedObj.detail) {
                  throw new Error(parsedObj.detail);
                }
                transactionsData.push(parsedObj);
              } catch (parseError) {
                logger.warn(`Failed to parse object: ${parseError.message}`, { objStr });
              }
            } else {
              break;
            }
          } else {
            pos++;
          }
        }
        buffer = buffer.slice(pos).trim();
      }
      if (buffer) {
        buffer = buffer.replace(/\]$/, '').trim();
        if (buffer.startsWith('{')) {
          try {
            const parsed = JSON.parse(buffer);
            if (!parsed.detail) {
              transactionsData.push(parsed);
            } else {
              throw new Error(parsed.detail);
            }
          } catch (e) {
            logger.error(`Error parsing final buffer: ${e.message}`, { buffer });
          }
        }
      }
      await setCachedData(cacheKey, transactionsData);
      logger.log("Fetched and cached EVM transactions:", { topEvmWallets: topEvmWallets.length, count: transactionsData.length });
      return transactionsData;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 5 * 60 * 1000, // 5 minutes
      dedupingInterval: 60 * 1000, // Increased to 1 min to reduce re-fetches
    }
  );
  // Combine EVM and Bitcoin transactions
  useEffect(() => {
    if (evmTxs && bitcoinTxs) {
      const combinedTxs = [...evmTxs, ...bitcoinTxs]
        .filter((tx) => tx && (tx.hash || tx.txid)) // Remove invalid transactions
        .sort((a, b) => {
          const timeA = normalizeTimestamp(a);
          const timeB = normalizeTimestamp(b);
          return timeB - timeA; // Sort descending (newer first)
        });
      debouncedSetTransactions(combinedTxs);
    }
  }, [evmTxs, bitcoinTxs, debouncedSetTransactions]);
  useEffect(() => {
    if (evmError || bitcoinError) {
      const errorMessage = evmError?.message || bitcoinError?.message || 'Failed to load transactions';
      setTransactionsError(errorMessage);
    }
  }, [evmError, bitcoinError]);
  // Update loading state for transactions
  useEffect(() => {
    setIsLoadingTransactions(evmValidating || bitcoinValidating);
  }, [evmValidating, bitcoinValidating]);
  // Fetch wallet transactions with SWR and IndexedDB
  const { data: walletTxData, error: walletTxError, isValidating: walletTxValidating } = useSWR(
    status === 'authenticated' && selectedWallet ? ['wallet-transactions', selectedWallet] : null,
    async () => {
      if (!/^0x[a-fA-F0-9]{40}$/.test(selectedWallet)) {
        throw new Error("Transaction data only available for EVM addresses");
      }
      const cacheKey = `sim:transactions:auth:${selectedWallet}:1000`;
      const cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for wallet transactions: ${cacheKey}`);
        return cachedData;
      }
      const response = await fetch(`/api/sim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
        },
        credentials: "include",
        body: JSON.stringify({
          action: "transactions",
          addresses: [selectedWallet],
          limit: 1000,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        let errorMessage = `Failed to fetch wallet transactions: ${response.status} ${response.statusText}`;
        try {
          const result = JSON.parse(text);
          errorMessage = result.detail || errorMessage;
        } catch {
          errorMessage = `Failed to fetch wallet transactions: Invalid JSON response`;
        }
        throw new Error(errorMessage);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let transactionsData = [];
      let buffer = '';
      let isFirstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (isFirstChunk) {
          buffer = buffer.trim().replace(/^\[/, '');
          isFirstChunk = false;
        }
        let pos = 0;
        while (pos < buffer.length) {
          while (pos < buffer.length && (buffer[pos] === ' ' || buffer[pos] === '\n' || buffer[pos] === ',' || buffer[pos] === ']')) {
            pos++;
          }
          if (pos >= buffer.length) break;
          if (buffer[pos] === '{') {
            let openBraces = 1;
            let start = pos;
            pos++;
            while (pos < buffer.length && openBraces > 0) {
              if (buffer[pos] === '{') openBraces++;
              else if (buffer[pos] === '}') openBraces--;
              pos++;
            }
            if (openBraces === 0) {
              const objStr = buffer.substring(start, pos).trim();
              try {
                const parsedObj = JSON.parse(objStr);
                if (parsedObj.detail) {
                  throw new Error(parsedObj.detail);
                }
                transactionsData.push(parsedObj);
                debouncedSetWalletTransactions([...transactionsData]);
              } catch (parseError) {
                logger.warn(`Failed to parse object: ${parseError.message}`, { objStr });
              }
            } else {
              break;
            }
          } else {
            pos++;
          }
        }
        buffer = buffer.slice(pos).trim();
      }
      if (buffer) {
        buffer = buffer.replace(/\]$/, '').trim();
        if (buffer.startsWith('{')) {
          try {
            const parsed = JSON.parse(buffer);
            if (!parsed.detail) {
              transactionsData.push(parsed);
              debouncedSetWalletTransactions([...transactionsData]);
            } else {
              throw new Error(parsed.detail);
            }
          } catch (e) {
            logger.error(`Error parsing final buffer: ${e.message}`, { buffer });
          }
        }
      }
      await setCachedData(cacheKey, transactionsData);
      logger.log("Fetched and cached wallet transactions:", { selectedWallet, data: transactionsData });
      return transactionsData;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 5 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );
  useEffect(() => {
    if (walletTxData) {
      debouncedSetWalletTransactions(walletTxData);
    }
    if (walletTxError) {
      setWalletTransactionsError(walletTxError.message || 'Failed to load wallet transactions');
    }
    setIsLoadingWalletTransactions(walletTxValidating);
  }, [walletTxData, walletTxError, walletTxValidating, debouncedSetWalletTransactions]);
  // Fetch wallet balances with SWR and IndexedDB
  const { data: walletBalancesData, error: walletBalancesErrorSWR, isValidating: walletBalancesValidating } = useSWR(
    status === 'authenticated' && selectedWallet ? ['wallet-balances', selectedWallet] : null,
    async () => {
      if (!/^0x[a-fA-F0-9]{40}$/.test(selectedWallet)) {
        throw new Error("Balance data only available for EVM addresses");
      }
      const cacheKey = `sim:balances:auth:${selectedWallet}`;
      const cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for wallet balances: ${cacheKey}`);
        return cachedData;
      }
      const response = await fetch(`/api/sim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
        },
        credentials: "include",
        body: JSON.stringify({
          action: "wallet-balances",
          address: selectedWallet,
          limit: 2000,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        let errorMessage = `Failed to fetch wallet balances: ${response.status} ${response.statusText}`;
        try {
          const result = JSON.parse(text);
          errorMessage = result.detail || errorMessage;
        } catch {
          errorMessage = `Failed to fetch wallet balances: Invalid JSON response`;
        }
        throw new Error(errorMessage);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let balancesData = [];
      let buffer = '';
      let isFirstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (isFirstChunk) {
          buffer = buffer.trim().replace(/^\[/, '');
          isFirstChunk = false;
        }
        let pos = 0;
        while (pos < buffer.length) {
          while (pos < buffer.length && (buffer[pos] === ' ' || buffer[pos] === '\n' || buffer[pos] === ',' || buffer[pos] === ']')) {
            pos++;
          }
          if (pos >= buffer.length) break;
          if (buffer[pos] === '{') {
            let openBraces = 1;
            let start = pos;
            pos++;
            while (pos < buffer.length && openBraces > 0) {
              if (buffer[pos] === '{') openBraces++;
              else if (buffer[pos] === '}') openBraces--;
              pos++;
            }
            if (openBraces === 0) {
              const objStr = buffer.substring(start, pos).trim();
              try {
                const parsedObj = JSON.parse(objStr);
                if (parsedObj.detail) {
                  throw new Error(parsedObj.detail);
                }
                balancesData.push(parsedObj);
              } catch (parseError) {
                logger.warn(`Failed to parse object: ${parseError.message}`, { objStr });
              }
            } else {
              break;
            }
          } else {
            pos++;
          }
        }
        buffer = buffer.slice(pos).trim();
      }
      if (buffer) {
        buffer = buffer.replace(/\]$/, '').trim();
        if (buffer.startsWith('{')) {
          try {
            const parsed = JSON.parse(buffer);
            if (!parsed.detail) {
              balancesData.push(parsed);
            } else {
              throw new Error(parsed.detail);
            }
          } catch (e) {
            logger.error(`Error parsing final buffer: ${e.message}`, { buffer });
          }
        }
      }
      startTransition(() => setWalletBalances(balancesData));
      await setCachedData(cacheKey, balancesData);
      logger.log("Fetched and cached wallet balances:", { selectedWallet, data: balancesData });
      return balancesData;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 5 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );
  useEffect(() => {
    if (walletBalancesData) {
      startTransition(() => setWalletBalances(walletBalancesData));
    }
    if (walletBalancesErrorSWR) {
      setWalletBalancesError(walletBalancesErrorSWR.message || 'Failed to load wallet balances');
    }
    setIsLoadingWalletBalances(walletBalancesValidating);
  }, [walletBalancesData, walletBalancesErrorSWR, walletBalancesValidating, startTransition]);
  // Trigger fetches with debouncing
  useEffect(() => {
    const mappedId = mapExchangeId(clusterIdFromQuery);
    fetchExchangeData(clusterIdFromQuery, mappedId);
    fetchPortfolioAndWallets(clusterIdFromQuery);
    fetchClusterImage(clusterIdFromQuery);
  }, [clusterIdFromQuery, currency]);
  useEffect(() => {
    if (status === "authenticated" && walletData.length > 0) {
      const evmWallets = walletData.filter(
        (w) => !["bitcoin", "dogecoin", "litecoin"].includes(w.chain?.toLowerCase())
      );
      // SWR handles the fetch
    }
  }, [walletData, status]);
  useEffect(() => {
    if (status === "authenticated" && selectedWallet) {
      logger.log("Triggering fetch for selected wallet:", { selectedWallet });
      if (/^0x[a-fA-F0-9]{40}$/.test(selectedWallet)) {
        // SWR handles the fetch
      } else {
        startTransition(() => {
          setWalletBalances([]);
          setWalletTransactions([]);
        });
        setWalletBalancesError("Balance data not available for non-EVM addresses (Bitcoin, Dogecoin, Litecoin)");
        setWalletTransactionsError("Transaction data not available for non-EVM addresses (Bitcoin, Dogecoin, Litecoin)");
      }
    }
  }, [selectedWallet, status]);
  const handleSearchSelect = (result) => {
    if (result.type === "exchange" || result.type === "organization") {
      const mappedId = mapExchangeId(result.exchangeId || result.id);
      router.push(`/cluster?clusterId=${encodeURIComponent(mappedId)}`, { scroll: false });
      startTransition(() => {
        setExchangeData({
          name: result.name,
          image: result.image || `/icons/${mappedId.toLowerCase()}.webp` || '/fallback-image.webp',
          country: "N/A",
          year_established: "N/A",
          trust_score: "N/A",
          trade_volume_24h_btc: 0,
          centralized: true,
          twitter_handle: null,
          url: null,
        });
      });
    } else if (result.type === "wallet" || result.type === "nametag") {
      const address = result.address?.toLowerCase();
      if (
        /^0x[a-fA-F0-9]{40}$/.test(address) ||
        /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(address) ||
        /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32,33}$/.test(address) ||
        /^L[a-km-zA-HJ-NP-Z1-9]{26,34}$|^ltc1[a-zA-Z0-9]{39,59}$/.test(address)
      ) {
        logger.log("Selected wallet address from search:", { address });
        setSelectedWallet(address);
      } else {
        logger.error("Invalid wallet address selected:", { address });
        toast.error("Invalid wallet address", { position: "top-center", autoClose: 3000 });
      }
    }
  };
  const handleWalletClick = (walletObj) => {
    const address = walletObj.holder_address || walletObj.name_tag;
    if (!address) {
      toast.info("No on-chain address available for this entity", { position: "top-center", autoClose: 3000 });
      return;
    }
    // Check if it's a valid address format
    const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(address) ||
      /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(address) ||
      /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32,33}$/.test(address) ||
      /^L[a-km-zA-HJ-NP-Z1-9]{26,34}$|^ltc1[a-zA-Z0-9]{39,59}$/.test(address);
    if (!isValidAddress) {
      toast.info("No on-chain data available for this nametag", { position: "top-center", autoClose: 3000 });
      return;
    }
    setSelectedWallet(address);
  };
  const handleCloseWalletBalances = () => {
    setSelectedWallet(null);
    startTransition(() => {
      setWalletBalances([]);
      setWalletTransactions([]);
    });
    setWalletBalancesError(null);
    setWalletTransactionsError(null);
  };
  const groupedPortfolio = useMemo(() => {
    logger.log("Processing portfolio data for chain details:", { portfolioData: memoizedPortfolioData });
    const totalValue = memoizedPortfolioData.reduce((sum, item) => sum + (Number(item.total_balance_usd) || 0), 0);
    const grouped = memoizedPortfolioData.map((item, index) => {
      const metadataChains = new Set(
        (item.chain_details || []).map((token) => token.chain?.toLowerCase()).filter(Boolean),
      );
      return {
        ...item,
        key: `${item.token_address}-${index}`,
        percentage: totalValue > 0 ? ((Number(item.total_balance_usd) || 0) / totalValue) * 100 : 0,
        symbol: item.symbol || item.token_address,
        logo: item.logo || "/fallback-image.webp",
        chains: Array.from(metadataChains),
      };
    });
    const filtered = selectedChain === "all" ? grouped : grouped.filter((item) =>
      item.chains.some((chain) => chain === selectedChain.toLowerCase()),
    );
    logger.log("Grouped portfolio after processing:", { filtered, selectedChain });
    return filtered;
  }, [memoizedPortfolioData, selectedChain]);
  const totalPortfolioValue = useMemo(() => {
    return groupedPortfolio.reduce((sum, item) => sum + (Number(item.total_balance_usd) || 0), 0);
  }, [groupedPortfolio]);
  const chains = useMemo(() => {
    const chainSet = new Set(["all"]);
    memoizedPortfolioData.forEach((item) => {
      (item.chain_details || []).forEach((token) => {
        if (token.chain) chainSet.add(token.chain.toLowerCase());
      });
    });
    memoizedWalletData.forEach((wallet) => {
      (wallet.metadata || []).forEach((token) => {
        if (token.chain) chainSet.add(token.chain.toLowerCase());
      });
    });
    return Array.from(chainSet).map((value) => ({
      value,
      label: value === "all" ? "All Chains" : CHAIN_ID_TO_NAME[value.toLowerCase()] || value,
      image: value === "bitcoin" ? BITCOIN_LOGO :
        value === "dogecoin" ? DOGECOIN_LOGO :
          value === "litecoin" ? LITECOIN_LOGO :
            chainLogos[value.toLowerCase()] || "/fallback-image.webp",
    }));
  }, [memoizedPortfolioData, memoizedWalletData, chainLogos]);
  // FIX: Di chuyển logic hiển thị nameTag ra ngoài để áp dụng cho cả Blockchair (Bitcoin)
  const truncateAddressWithHover = (address, nameTag, source) => {
    if (!address || address === 'None' || typeof address !== 'string' || address === 'N/A') {
      return (
        <div className="flex items-center gap-2 group relative">
          <span className="truncate">{nameTag || 'N/A'}</span>
        </div>
      );
    }
    const normalizedAddress = address.toLowerCase();
    let shortAddress;
    // Custom truncation for Bitcoin addresses when source is Blockchair
    if (source === 'Blockchair') {
      // Handle both legacy (1..., 3...) and bech32 (bc1...) Bitcoin addresses
      if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(address)) {
        shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
      } else {
        shortAddress = address; // Fallback for unrecognized formats
      }
    } else {
      // Use existing truncateAddress for EVM and other addresses
      const { text, shortAddress: computedShortAddress } = truncateAddress(address, { [normalizedAddress]: { name: nameTag } }, source);
      shortAddress = computedShortAddress;
    }
    // FIX: Di chuyển ra ngoài để áp dụng cho cả Blockchair - hiển thị nameTag nếu có
    if (nameTag && nameTag !== 'N/A' && nameTag !== address) {
      return (
        <div className="flex items-center gap-2 group relative">
          <span className="truncate">{nameTag}</span>
          <motion.span
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(address);
              toast.success("Address copied!", { autoClose: 2000 });
            }}
            className="ml-1 text-[#D4D4D4] hover:text-[#FFF]/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg cursor-pointer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            role="button"
            aria-label="Copy address"
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
          </motion.span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 group relative">
        <span className="truncate">{shortAddress}</span>
        <motion.span
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(address);
            toast.success("Address copied!", { autoClose: 2000 });
          }}
          className="ml-1 text-[#D4D4D4] hover:text-[#FFF]/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg cursor-pointer"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          role="button"
          aria-label="Copy address"
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
        </motion.span>
      </div>
    );
  };
  const renderPortfolioContent = () => {
    return (
      <div className="flex flex-col relative" ref={portfolioRef}>
        <div className="bg-[#0A0A0A]/80 backdrop-blur-md overflow-y-auto min-h-[calc(50vh)] sm:min-h-[calc(30vh)] max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] hide-scrollbar">
          {isLoadingPortfolio && (
            <LoadingOverlay
              isLoading={isLoadingPortfolio}
              isMobile={isMobile}
              className="h-full z-10"
            />
          )}
          {isLoadingPortfolio ? (
            <SkeletonLoader count={5} isMobile={isMobile} />
          ) : groupedPortfolio.length > 0 ? (
            <table className="w-full table-fixed text-[9px] sm:text-[11px] bg-[#0A0A0A]/80 rounded-xl">
              <thead className="border-b border-[#FFFFFF10] bg-[#0A0A0A]/80 backdrop-blur-md">
                <tr>
                  <th className={`${isMobile ? "w-[25%]" : "w-[25%]"} px-3 py-2 text-[#FFF] text-left font-semibold truncate`}>Token</th>
                  <th className={`${isMobile ? "w-[25%]" : "w-[25%]"} px-3 py-2 text-[#FFF] text-left font-semibold truncate`}>Balance</th>
                  <th className={`${isMobile ? "w-[25%]" : "w-[25%]"} px-3 py-2 text-[#FFF] text-left font-semibold truncate`}>Value ({currency.toUpperCase()})</th>
                  <th className={`${isMobile ? "w-[25%]" : "w-[25%]"} px-3 py-2 text-[#FFF] text-left font-semibold truncate`}>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {groupedPortfolio.map((group, index) => (
                  <motion.tr
                    key={group.key}
                    className="border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/10 transition-all duration-300"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ backgroundColor: "rgba(255, 255, 255, 0.05)" }}
                    transition={{ duration: 0.3, delay: index * 0.01 }}
                  >
                    <td className="px-3 py-2.5 text-[#FFF] truncate">
                      <div className="flex items-center gap-2">
                        <img
                          src={group.logo}
                          alt={`${group.symbol} logo`}
                          className="w-5 h-5 inline mr-2 rounded-full shadow-lg"
                          onError={(e) => (e.target.src = "/fallback-image.webp")}
                        />
                        {group.symbol}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[#FFF] truncate">
                      <span className="font-semibold">{group.total_balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[#FFF] truncate">
                      <span className="font-semibold">{formatPrice(group.total_balance_usd || 0, currency, 2)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[#FFF] truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{group.percentage.toFixed(2)}%</span>
                        <div className="w-full bg-[#FFFFFF]/10 rounded-full h-1.5">
                          <motion.div
                            className="bg-gradient-to-r from-[#00FFFF20] to-emerald-400/20 h-1.5 rounded-full"
                            style={{ width: `${group.percentage}%` }}
                            initial={{ width: 0 }}
                            animate={{ width: `${group.percentage}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[10px] sm:text-sm text-[#D4D4D4] text-center py-4">No portfolio data available for this cluster.</p>
          )}
        </div>
      </div>
    );
  };
  const renderWalletsContent = () => {
    if (status !== "authenticated") {
      return <LoginPrompt />;
    }
    const totalValue = uniqueWalletData.reduce((sum, wallet) => sum + (Number(wallet.total_value_usd) || 0), 0);
    return (
      <div className="relative bg-[#0A0A0A]/80 backdrop-blur-md overflow-y-auto min-h-[calc(50vh)] sm:min-h-[calc(30vh)] max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] hide-scrollbar">
        {isLoadingWallets && (
          <LoadingOverlay
            isLoading={isLoadingWallets}
            isMobile={isMobile}
            className="z-10"
          />
        )}
        {isLoadingWallets ? (
          <SkeletonLoader count={5} isMobile={isMobile} />
        ) : uniqueWalletData.length > 0 ? (
          <table className="w-full table-fixed text-[9px] sm:text-[11px] bg-[#0A0A0A]/80 rounded-xl">
            <thead className="border-b border-[#FFFFFF10] bg-[#0A0A0A]/80 backdrop-blur-md">
              <tr>
                <th className={`${isMobile ? "w-[50%]" : "w-[50%]"} px-3 py-2 text-[#FFF] text-left font-semibold truncate`}>Wallet</th>
                <th className={`${isMobile ? "w-[25%]" : "w-[25%]"} px-3 py-2 text-[#FFF] text-left font-semibold truncate`}>Value ({currency.toUpperCase()})</th>
                <th className={`${isMobile ? "w-[25%]" : "w-[25%]"} px-3 py-2 text-[#FFF] text-left font-semibold truncate`}>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {uniqueWalletData.map((wallet, index) => {
                const percentage = totalValue > 0 ? ((Number(wallet.total_value_usd) || 0) / totalValue) * 100 : 0;
                const chainLower = wallet.chain?.toLowerCase();
                const isSpecialCoin = ["bitcoin", "dogecoin", "litecoin"].includes(chainLower);
                const clusterLogo = wallet.image; // Cluster/nametag logo
                const chainLogo = chainLower === "bitcoin" ? BITCOIN_LOGO :
                  chainLower === "dogecoin" ? DOGECOIN_LOGO :
                    chainLower === "litecoin" ? LITECOIN_LOGO : null;
                return (
                  <motion.tr
                    key={wallet.key}
                    className="border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/10 transition-all duration-300 cursor-pointer"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ backgroundColor: "rgba(255, 255, 255, 0.05)" }}
                    transition={{ duration: 0.3, delay: index * 0.01 }}
                    onClick={() => handleWalletClick(wallet)}
                  >
                    <td className="px-3 py-2.5 text-[#FFF] truncate">
                      <div className="flex items-center gap-1">
                        {/* FIX: Hiển thị hai logo cho BTC/Doge/LTC (cluster bên trái + chain bên phải), một logo cho EVM. Sử dụng object-contain để tránh bóp méo, giảm kích thước trên mobile nếu cần */}
                        {(() => {
                          if (isSpecialCoin && chainLogo) {
                            return (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <img
                                  src={clusterLogo}
                                  alt={`${wallet.cluster_name} logo`}
                                  className={`w-${isMobile ? '3' : '4'} h-${isMobile ? '3' : '4'} rounded-full shadow-lg object-contain flex-shrink-0`}
                                  onError={(e) => (e.target.src = "/fallback-image.webp")}
                                />
                                <img
                                  src={chainLogo}
                                  alt={`${chainLower} logo`}
                                  className={`w-${isMobile ? '3' : '4'} h-${isMobile ? '3' : '4'} rounded-full shadow-lg object-contain flex-shrink-0`}
                                  onError={(e) => (e.target.src = "/fallback-image.webp")}
                                />
                              </div>
                            );
                          } else {
                            return (
                              <img
                                src={clusterLogo}
                                alt={`${wallet.cluster_name} logo`}
                                className={`w-${isMobile ? '3' : '4'} h-${isMobile ? '3' : '4'} rounded-full shadow-lg object-contain flex-shrink-0`}
                                onError={(e) => (e.target.src = "/fallback-image.webp")}
                              />
                            );
                          }
                        })()}
                        <div className="min-w-0 flex-1">
                          {truncateAddressWithHover(wallet.holder_address, wallet.display_name, chainLower === 'bitcoin' ? 'Blockchair' : undefined)}
                        </div>
                      </div>
                    </td>
                    {/* <td className="px-3 py-2.5 text-[#FFF] truncate">
                      <div className="flex items-center gap-1">
                        <img
                          src={chainLogos[chainLower] || "/fallback-image.webp"}
                          alt={`${CHAIN_ID_TO_NAME[chainLower] || chainLower} logo`}
                          className="w-3 h-3 rounded-full"
                          onError={(e) => (e.target.src = "/fallback-image.webp")}
                        />
                        <span className="font-semibold">{CHAIN_ID_TO_NAME[chainLower] || chainLower || "Unknown"}</span>
                      </div>
                    </td> */}
                    <td className="px-3 py-2.5 text-[#FFF] truncate">
                      <span className="font-semibold">{formatPrice(Number(wallet.total_value_usd) || 0, currency, 2)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[#FFF] truncate">
                      <span className="font-semibold">{wallet.token_count || 0}</span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-[10px] sm:text-sm text-[#D4D4D4] text-center py-4">No wallet data available for this cluster.</p>
        )}
      </div>
    );
  };
  const renderTransactionsContent = () => {
    if (status !== "authenticated") {
      return <LoginPrompt />;
    }
    const renderTransactionRow = (index, tx) => {
      // Safely handle chain
      const chainName = typeof tx.chain === 'string' ? tx.chain.toLowerCase() : (tx.chain_id || 'unknown').toString().toLowerCase();
      const isBitcoin = chainName === 'bitcoin';
      const fromWallet = uniqueWalletData.find((w) => (w.holder_address || w.name_tag)?.toLowerCase() === tx.from?.toLowerCase()) || {};
      const toWallet = uniqueWalletData.find((w) => (w.holder_address || w.name_tag)?.toLowerCase() === tx.to?.toLowerCase()) || {};
      const fromNtag = {
        name: fromWallet.name_tag || fromWallet.display_name || 'N/A',
        image: fromWallet.image || (isBitcoin ? BITCOIN_LOGO : '/fallback-image.webp'),
      };
      const toNtag = {
        name: toWallet.name_tag || toWallet.display_name || 'N/A',
        image: toWallet.image || (isBitcoin ? BITCOIN_LOGO : '/fallback-image.webp'),
      };
      const chain = isBitcoin ? 'bitcoin' : chainName !== 'unknown' ? chainName : 'ethereum';
      const { txUrl } = getExplorerUrls(chain, tx.hash || tx.txid || '', '');
      let tokenSymbol = isBitcoin ? 'BTC' : tx.token_metadata?.symbol || tx.token || 'Unknown';
      const typeDisplay = tx.type ? tx.type.charAt(0).toUpperCase() + tx.type.slice(1) : 'Transfer';
      let displayValue = isBitcoin
        ? `${(Number(tx.value_btc) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC`
        : Number(tx.value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
      let tokenLogo = isBitcoin ? BITCOIN_LOGO : tx.token_metadata?.logo || '/fallback-image.webp';
      // Determine transaction type relative to cluster
      const hasFromCluster = !!fromWallet.holder_address || !!fromWallet.name_tag;
      const hasToCluster = !!toWallet.holder_address || !!toWallet.name_tag;
      const isOutgoing = hasFromCluster && !hasToCluster;
      const isIncoming = hasToCluster && !hasFromCluster;
      const isInternal = hasFromCluster && hasToCluster;
      const directionColor = isInternal ? 'text-[#FFF]' : isOutgoing ? 'text-red-400' : isIncoming ? 'text-green-400' : 'text-gray-400';
      // FIX: Custom flow icon - half cylinder on left (rounded rect), reduced height, arrow at end
      const transferIcon = (
        <svg
          className={`w-4 h-4 ${directionColor} flex-shrink-0`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M8 7h12m0 0l-4-4m4 4l-4 4m-4 4H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
      );
      if (!isBitcoin && tx.type === 'swap' && tx.swap_details) {
        const sent = tx.swap_details.sent[0];
        const received = tx.swap_details.received[0];
        if (sent && received) {
          displayValue = `${Number(sent.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${sent.symbol} → ${Number(received.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${received.symbol}`;
          tokenSymbol = `${sent.symbol}/${received.symbol}`;
          tokenLogo = sent.logo || received.logo || '/fallback-image.webp';
        } else if (sent) {
          displayValue = `${Number(sent.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${sent.symbol}`;
          tokenSymbol = sent.symbol;
          tokenLogo = sent.logo || '/fallback-image.webp';
        } else if (received) {
          displayValue = `${Number(received.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${received.symbol}`;
          tokenSymbol = received.symbol;
          tokenLogo = received.logo || '/fallback-image.webp';
        }
      } else if (!isBitcoin && tx.type === 'other') {
        displayValue = tx.value || 'N/A';
      }
      // Use normalized timestamp for display
      const time = normalizeTimestamp(tx);
      // Prepare nameTags for truncateAddress
      const nameTags = {
        [tx.from?.toLowerCase()]: { name: fromNtag.name, image: fromNtag.image },
        [tx.to?.toLowerCase()]: { name: toNtag.name, image: toNtag.image },
      };
      return (
        <motion.div
          key={`${isBitcoin ? tx.txid : tx.hash}-${index}`}
          className="flex border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/10 transition-all duration-300 py-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1 }}
          transition={{ duration: 0.3, delay: index * 0.02 }}
        >
          <div className="w-[15%] sm:w-[15%] px-2 sm:px-3 text-[#FFF]/80 text-[9px] sm:text-[10px] text-center overflow-hidden text-ellipsis">
            <div className="flex flex-col items-center justify-center gap-1 relative">
              <div className="relative flex-shrink-0">
                <img
                  src={tokenLogo}
                  alt={`${tokenSymbol} logo`}
                  width={isMobile ? 14 : 16}
                  height={isMobile ? 14 : 16}
                  className="rounded-full mx-auto shadow-md"
                  onError={(e) => (e.target.src = '/fallback-image.webp')}
                  loading="lazy"
                />
                <img
                  src={chainLogos[chain] || '/fallback-image.webp'}
                  alt={`${CHAIN_ID_TO_NAME[chain] || chain || 'Unknown'} logo`}
                  width={isMobile ? 8 : 10}
                  height={isMobile ? 8 : 10}
                  className="rounded-full absolute top-0 right-0"
                  style={{ transform: 'translate(25%, -25%)' }}
                  onError={(e) => (e.target.src = '/fallback-image.webp')}
                  loading="lazy"
                />
              </div>
              <span className="text-[7px] sm:text-[9px] truncate max-w-[60px] sm:max-w-[80px]">{tokenSymbol}</span>
            </div>
          </div>
          <div className="w-[45%] sm:w-[40%] px-2 sm:px-3 text-[#FFF]/80 text-[8px] sm:text-[10px] text-center overflow-hidden text-ellipsis flex items-center justify-center">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {/* <div className={`flex flex-col items-center gap-0.5 ${directionColor}`}>
                <div className="-mt-0.5">{transferIcon}</div>
              </div> */}
              {/* Wallets stack on right */}
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 group relative">
                  <img
                    src={fromNtag.image}
                    alt="From wallet logo"
                    className="w-3 h-3 rounded-full"
                    onError={(e) => (e.target.src = '/fallback-image.webp')}
                    loading="lazy"
                  />
                  <span
                    onClick={() => handleWalletClick(fromWallet)}
                    className="text-[#FFF] hover:text-[#FFF]/80 cursor-pointer no-hover-effect truncate"
                  >
                    {truncateAddressWithHover(tx.from, fromNtag.name, isBitcoin ? 'Blockchair' : undefined)}
                  </span>
                </div>
                <div className="flex items-center gap-2 group relative">
                  <img
                    src={toNtag.image}
                    alt="To wallet logo"
                    className="w-3 h-3 rounded-full"
                    onError={(e) => (e.target.src = '/fallback-image.webp')}
                    loading="lazy"
                  />
                  <span
                    onClick={() => handleWalletClick(toWallet)}
                    className="text-[#FFF] hover:text-[#FFF]/80 cursor-pointer no-hover-effect truncate"
                  >
                    {truncateAddressWithHover(tx.to, toNtag.name, isBitcoin ? 'Blockchair' : undefined)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="w-[30%] sm:w-[30%] px-2 sm:px-3 text-[#FFF]/80 text-[9px] sm:text-[10px] text-center overflow-hidden text-ellipsis">
            <div className="flex flex-col items-center gap-1">
              <span className={`inline-flex px-1 sm:px-1.5 py-0.5 rounded-full text-[7px] sm:text-[9px] font-medium bg-[#00FFFF20]/20 text-[#00FFFF20]`}>
                {typeDisplay}
              </span>
              <span className="truncate font-semibold text-[8px] sm:text-[10px]">{displayValue}</span>
              <span className="font-semibold">{formatPrice(Number(tx.value_usd) || 0, currency, 2)}</span>
            </div>
          </div>
          <div className="w-[10%] sm:w-[15%] px-2 sm:px-3 text-[#FFF]/80 text-[9px] sm:text-[10px] text-center overflow-hidden text-ellipsis">
            <div className="flex flex-col items-center gap-0.5">
              <a href={txUrl} target="_blank" rel="noopener noreferrer">
                <img
                  src={isBitcoin ? '/logos/mempool-logo.webp' : '/logos/etherscan-logo.webp'}
                  alt="Explorer"
                  width={isMobile ? 12 : 14}
                  height={isMobile ? 12 : 14}
                  className="rounded-xl hover:scale-110 transition-transform"
                  onError={(e) => (e.target.src = '/fallback-image.webp')}
                  loading="lazy"
                />
              </a>
              <span className="text-[6px] sm:text-[9px] text-[#D4D4D4] truncate">
                {(() => {
                  if (time && !isNaN(time)) {
                    try {
                      const date = new Date(time * 1000);
                      if (isNaN(date.getTime())) {
                        logger.warn('Invalid date for transaction:', {
                          txid: tx.txid || tx.hash,
                          time,
                          chain: chainName,
                        });
                        return 'N/A';
                      }
                      return formatDistanceToNow(date, { addSuffix: true });
                    } catch (e) {
                      logger.warn('Error formatting time for transaction:', {
                        txid: tx.txid || tx.hash,
                        time,
                        chain: chainName,
                        error: e.message,
                      });
                      return 'N/A';
                    }
                  }
                  logger.warn('Missing time for transaction:', {
                    txid: tx.txid || tx.hash,
                    time,
                    chain: chainName,
                  });
                  return 'N/A';
                })()}
              </span>
            </div>
          </div>
        </motion.div>
      );
    };
    return (
      <div className="relative overflow-y-auto min-h-[calc(50vh)] sm:min-h-[calc(30vh)] max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] hide-scrollbar bg-[#0A0A0A]/80 backdrop-blur-md rounded-xl">
        {isLoadingTransactions && (
          <LoadingOverlay
            isLoading={isLoadingTransactions}
            isMobile={isMobile}
            className="rounded-xl z-10"
          />
        )}
        {isLoadingTransactions ? (
          <div className="w-full table-fixed text-[9px] sm:text-[11px]">
            <div className="border-b border-[#FFFFFF10] bg-[#0A0A0A]/80 backdrop-blur-md flex">
              <div className="w-[20%] sm:w-[20%] px-3 py-2 text-[#FFF] font-medium text-center">Token</div>
              <div className="w-[40%] sm:w-[40%] px-3 py-2 text-[#FFF] font-medium text-center">From/To</div>
              <div className="w-[25%] sm:w-[25%] px-3 py-2 text-[#FFF] font-medium text-center">Value (Token/USD)</div>
              <div className="w-[15%] sm:w-[15%] px-3 py-2 text-[#FFF] font-medium text-center">Details</div>
            </div>
            <div className="flex items-center justify-center py-8 text-[#D4D4D4] text-center">
              <p className="text-[10px] sm:text-sm">Loading transactions...</p>
            </div>
          </div>
        ) : transactionsError ? (
          <p className="text-[10px] sm:text-sm text-red-400 text-center p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            Error: {transactionsError}
          </p>
        ) : transactions.length > 0 ? (
          <div className="w-full table-fixed text-[9px] sm:text-[11px]">
            <div className="border-b border-[#FFFFFF10] bg-[#0A0A0A]/80 backdrop-blur-md flex">
              <div className="w-[15%] sm:w-[15%] px-3 py-2 text-[#FFF] font-medium text-center">Token</div>
              <div className="w-[45%] sm:w-[40%] px-3 py-2 text-[#FFF] font-medium text-center">From/To</div>
              <div className="w-[30%] sm:w-[30%] px-3 py-2 text-[#FFF] font-medium text-center">Value (Token/USD)</div>
              <div className="w-[10%] sm:w-[15%] px-3 py-2 text-[#FFF] font-medium text-center">Details</div>
            </div>
            <Virtuoso
              className="bg-[#0A0A0A]/80 backdrop-blur-md hide-scrollbar virtuoso-container"
              style={{ height: 'calc(50vh - 5rem)' }}
              data={transactions}
              itemContent={renderTransactionRow}
              overscan={400}
              components={{
                EmptyPlaceholder: () => (
                  <p className="text-[10px] sm:text-xs text-[#D4D4D4] text-center">No transactions available.</p>
                ),
              }}
            />
          </div>
        ) : (
          <p className="text-[10px] sm:text-xs text-[#D4D4D4] text-center">No large transactions available for this cluster.</p>
        )}
      </div>
    );
  };
  // NEW: Function to get trust score badge class (inspired by Arkham/Nansen trust indicators)
  const getTrustScoreBadge = (score) => {
    if (score === "N/A" || !score) return "bg-gray-600 text-[#D4D4D4]";
    const numScore = Number(score);
    if (numScore >= 9) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (numScore >= 7) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    if (numScore >= 5) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    return "bg-red-500/20 text-red-400 border-red-500/30";
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="font-inter w-full max-w-9xl mx-auto p-2 sm:p-3 bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col h-[calc(100vh-3rem)] overflow-y-auto hide-scrollbar"
    >
      <div className="w-full mb-2">
        <UniversalSearch
          onSelect={handleSearchSelect}
          placeholder="Search wallets, nametags, or clusters..."
          className="max-w-[300px]"
          size="default"
        />
      </div>
      {error && (
        <motion.div
          className="text-[9px] sm:text-[10px] text-emerald-400/80 text-center p-1 border border-emerald-400/80 rounded-lg mb-2"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          Some entities without complete organization information may not be displayed. Note: Token/coin data is aggregated from on-chain sources and is for reference only. Certain clusters or organizations may have incomplete data.
        </motion.div>
      )}
      <div className="flex flex-col flex-1 gap-4 sm:gap-5">
        <motion.div
          className="min-h-[30vh] border border-[#FFFFFF20] rounded-xl bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col md:flex-row shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex-1 p-4">
            <LoadingOverlay isLoading={isLoadingExchange || isLoadingPrices} isMobile={isMobile} />
            {isLoadingExchange || isLoadingPrices ? (
              <SkeletonLoader count={3} isMobile={isMobile} />
            ) : exchangeData ? (
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    <motion.img
                      src={exchangeData.image || clusterImage || `/icons/${mapExchangeId(clusterIdFromQuery).toLowerCase()}.webp` || '/fallback-image.webp'}
                      alt={`${exchangeData.name} logo`}
                      className="w-8 sm:w-10 h-8 sm:h-10 rounded-xl shadow-lg"
                      onError={(e) => (e.target.src = "/fallback-image.webp")}
                      whileHover={{ scale: 1.05, rotate: 5 }}
                      transition={{ duration: 0.2 }}
                    />
                    <h4 className="ml-2 text-lg sm:text-xl font-bold text-[#FFF] uppercase tracking-wide">{exchangeData.name}</h4>
                  </div>
                  <motion.div
                    className="ml-12 sm:ml-0"
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                  >
                    <div className="flex items-center gap-1 p-1 bg-[#0A0A0A]/50 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] max-w-full">
                      <div className="flex items-center gap-1 flex-wrap min-w-0">
                        <span className="p-1 flex items-center font-bold text-[#FFF] text-[11px] sm:text-xs whitespace-nowrap">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4 text-emerald-400 flex-shrink-0 m-1"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          Total Value:
                        </span>
                        <span className="font-bold m-1 bg-gradient-to-r from-[#D4D4D4] to-emerald-400 bg-clip-text text-transparent text-xs sm:text-sm truncate">
                          {formatPrice(totalPortfolioValue, currency, 2)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <motion.div
                    className="bg-[#FFFFFF]/5 rounded-xl p-3 border border-[#FFFFFF10] hover:border-[#FFFFFF20] transition-colors"
                  >
                    <h5 className="text-[10px] font-bold text-[#FFF] uppercase mb-2 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Cluster Info
                    </h5>
                    <div className="space-y-2 text-[10px] sm:text-xs">
                      <div className="flex justify-between">
                        <span className="text-[#D4D4D4]">Country:</span>
                        <span className="text-[#FFF]">{exchangeData.country || "Not available"}</span>
                      </div>
                      {/* NEW: Added Trust Score badge, inspired by Arkham's trust indicators */}
                      <div className="flex justify-between items-center">
                        <span className="text-[#D4D4D4]">Trust Score:</span>
                        <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${getTrustScoreBadge(exchangeData.trust_score)}`}>
                          {exchangeData.trust_score || "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#D4D4D4]">Number of Wallets:</span>
                        <span className="text-[#FFF]">{uniqueWalletData.length}</span>
                      </div>
                    </div>
                  </motion.div>
                  <motion.div
                    className="bg-[#FFFFFF]/5 rounded-xl p-3 border border-[#FFFFFF10] hover:border-[#FFFFFF20] transition-colors"
                  >
                    <h5 className="text-[10px] font-bold text-[#FFF] uppercase mb-2 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      Trading Volume
                    </h5>
                    <div className="space-y-2 text-[10px] sm:text-xs">
                      <div className="flex justify-between">
                        <span className="text-[#D4D4D4]">24h USD Volume:</span>
                        <span className="text-[#FFF]">
                          {btcPrice && exchangeData.trade_volume_24h_btc
                            ? formatPrice(Number(exchangeData.trade_volume_24h_btc) * btcPrice, currency, 2)
                            : "Not available"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#D4D4D4]">Centralized:</span>
                        <span className="text-[#FFF]">{exchangeData.centralized ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </motion.div>
                </div>
                <div className="flex gap-2 mt-2">
                  {exchangeData.twitter_handle && (
                    <motion.a
                      href={`https://twitter.com/${exchangeData.twitter_handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 bg-[#FFFFFF]/10 rounded-lg hover:bg-[#FFFFFF]/20 border border-[#FFFFFF20]"
                      whileHover={{ scale: 1.05, y: -2, backgroundColor: "rgba(255,255,255,0.2)" }}
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                    >
                      <img src="/logos/x.webp" alt="Twitter" className="w-3 h-3" />
                    </motion.a>
                  )}
                  {exchangeData.url && (
                    <motion.a
                      href={exchangeData.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 bg-[#FFFFFF]/10 rounded-lg hover:bg-[#FFFFFF]/20 border border-[#FFFFFF20]"
                      whileHover={{ scale: 1.05, y: -2, backgroundColor: "rgba(255,255,255,0.2)" }}
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                    >
                      <img src="/logos/website.webp" alt="Website" className="w-3 h-3" />
                    </motion.a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[10px] sm:text-xs text-[#D4D4D4] text-center">No cluster data available. Please select another cluster.</p>
            )}
          </div>
          <div className="flex-1 p-2 sm:p-4 mr-2 sm:mr-0">
            <LoadingOverlay isLoading={isLoadingVolume} isMobile={isMobile} />
            {isLoadingVolume ? (
              <SkeletonLoader count={1} isMobile={isMobile} />
            ) : volumeHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={volumeHistory} margin={{ top: 10, right: 15, bottom: 5, left: isMobile ? 0 : 10 }}>
                  <XAxis dataKey="title" stroke="#FFFFFF" tick={{ fontSize: isMobile ? 6 : 8 }} />
                  <YAxis
                    stroke="#FFFFFF"
                    tick={{ fontSize: isMobile ? 6 : 8 }}
                    tickFormatter={(value) => formatLargeNumber(value, currency, 0)}
                  />
                  <Tooltip content={<CustomTooltip currency={currency} />} />
                  <Area type="monotone" dataKey="volume" stroke="#FFFFFF" fill="url(#chartGradient)" strokeWidth={3} />
                  <ReferenceDot
                    x={volumeHistory[volumeHistory.length - 1]?.title}
                    y={volumeHistory[volumeHistory.length - 1]?.volume}
                    r={4}
                    fill="#FFFFFF"
                    stroke="#FFFFFF"
                    strokeWidth={3}
                    className="animate-pulse"
                  />
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00FF88" stopOpacity={0.4} /> {/* CHANGED: Neon green gradient for volume */}
                      <stop offset="50%" stopColor="#00AAFF" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[10px] sm:text-xs text-[#D4D4D4] text-center">No volume data available for this cluster.</p>
            )}
          </div>
        </motion.div>
        <div className="flex flex-col md:flex-row gap-4 flex-1">
          <motion.div
            className="flex-1 border border-[#FFFFFF20] rounded-xl bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="p-0 border-b border-[#FFFFFF10] bg-[#0A0A0A]/80 backdrop-blur-md flex gap-4 items-end h-[52px]">
              <motion.button
                onClick={() => {
                  currentSetActiveTab("portfolio");
                  // Update URL preserve subtab
                  router.push(`${window.location.pathname}?tab=cluster&subtab=portfolio&clusterId=${encodeURIComponent(clusterIdFromQuery)}`, { scroll: false });
                }}
                className={`text-xs font-bold text-[#FFF] uppercase tracking-wider px-4 py-2 no-hover-effect flex items-center ${currentActiveTab === "portfolio" ? "border-b-2 border-[#FFF]/60" : "text-[#D4D4D4] hover:text-[#00FFFF20]"}`} // Sử dụng currentActiveTab
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2V12H2C2 6.47715 6.47715 2 12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12H12V2C17.5228 2 22 6.47715 22 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Portfolio
              </motion.button>
              <motion.button
                onClick={() => {
                  currentSetActiveTab("wallets");
                  // Update URL
                  router.push(`${window.location.pathname}?tab=cluster&subtab=wallets&clusterId=${encodeURIComponent(clusterIdFromQuery)}`, { scroll: false });
                }}
                className={`text-xs font-bold text-[#FFF] uppercase tracking-wider px-4 py-2 no-hover-effect flex items-center ${currentActiveTab === "wallets" ? "border-b-2 border-[#FFF]/60" : "text-[#D4D4D4] hover:text-[#00FFFF20]"}`} // Sử dụng currentActiveTab
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Wallets
              </motion.button>
            </div>
            {currentActiveTab === "portfolio" ? renderPortfolioContent() : renderWalletsContent()}
          </motion.div>
          <motion.div
            className="flex-1 border border-[#FFFFFF20] rounded-xl bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <div className="p-2 border-b border-[#FFFFFF10] bg-[#0A0A0A]/80 backdrop-blur-md flex items-center h-[52px]">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <h4 className="text-xs font-bold text-[#FFF] uppercase tracking-wider">Large Flow</h4>
            </div>
            {renderTransactionsContent()}
          </motion.div>
        </div>
      </div>
      {selectedWallet && (
        <WalletBalances
          balances={walletBalances}
          walletAddress={selectedWallet}
          isLoading={isLoadingWalletBalances}
          error={walletBalancesError}
          onClose={handleCloseWalletBalances}
          transactions={walletTransactions}
          isLoadingTransactions={isLoadingWalletTransactions}
          transactionsError={walletTransactionsError}
          chains={chains}
          setSelectedWallet={setSelectedWallet}
          setWalletBalances={setWalletBalances}
          setTransactions={setWalletTransactions}
          setWalletBalancesError={setWalletBalancesError}
          setTransactionsError={setWalletTransactionsError}
          setWalletAddress={setSelectedWallet}
          nameTags={uniqueWalletData.reduce((acc, w) => {
            const normalizedAddress = (w.holder_address || w.name_tag)?.toLowerCase();
            const chainLower = w.chain?.toLowerCase();
            const nameTagLower = w.name_tag?.toLowerCase();
            let image;
            // Ưu tiên logo từ NAMETAG_LOGOS nếu nametag khớp
            if (nameTagLower && NAMETAG_LOGOS[nameTagLower]) {
              image = NAMETAG_LOGOS[nameTagLower];
            } else {
              // Fallback về w.image hoặc logo của chain
              image = w.name_tag_image || w.image ||
                (chainLower === "bitcoin" ? BITCOIN_LOGO :
                  chainLower === "dogecoin" ? DOGECOIN_LOGO :
                    chainLower === "litecoin" ? LITECOIN_LOGO :
                      "/fallback-image.webp");
            }
            return {
              ...acc,
              [normalizedAddress]: {
                name: w.name_tag || w.display_name || "N/A",
                image,
              },
            };
          }, {})}
          isMobile={isMobile}
          chainLogos={chainLogos}
        />
      )}
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
  );
};
export default React.memo(ClusterTab);
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