"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { formatDistanceToNow } from "date-fns";
import { useCurrency } from "./CurrencyContext";
import { useRouter, useSearchParams } from "next/navigation";
import UniversalSearch from "./UniversalSearch";
import WalletBalances from "./WalletBalances";
import { CHAIN_ID_TO_NAME } from "../utils/constants";
import { SkeletonLoader, formatPrice, truncateAddress, LoadingOverlay, getExplorerUrls } from "../utils/helpers";
import "../styles/MarketTab.css";
import "react-loading-skeleton/dist/skeleton.css";

const BITCOIN_LOGO = "/logos/bitcoin.png";

const logger = {
  log: (message, data) => {
    if (process.env.NODE_ENV === "development") {
      console.log(message, data || {});
    }
  },
  error: (message, data) => {
    console.error(message, data || {});
  },
};

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
          Volume: <span className="text-emerald-400">{formatLargeNumber(payload[0].value, currency, 2)} {currency.toUpperCase()}</span>
        </p>
      </motion.div>
    );
  }
  return null;
};

const ClusterTab = ({ recaptchaRef, initialExchangeId }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const exchangeIdFromQuery = searchParams.get("exchangeId") || initialExchangeId || "binance";
  const { currency } = useCurrency();
  const [exchangeData, setExchangeData] = useState(null);
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
  const [tokenImages, setTokenImages] = useState({});
  const [tokenSymbols, setTokenSymbols] = useState({});
  const [chainLogos, setChainLogos] = useState({});
  const [activeTab, setActiveTab] = useState("portfolio");
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [walletBalances, setWalletBalances] = useState([]);
  const [walletTransactions, setWalletTransactions] = useState([]);
  const [isLoadingWalletBalances, setIsLoadingWalletBalances] = useState(false);
  const [isLoadingWalletTransactions, setIsLoadingWalletTransactions] = useState(false);
  const [walletBalancesError, setWalletBalancesError] = useState(null);
  const [walletTransactionsError, setWalletTransactionsError] = useState(null);
  const [btcPrice, setBtcPrice] = useState(null);
  const [isLoadingBtcPrice, setIsLoadingBtcPrice] = useState(false);
  const [selectedChain, setSelectedChain] = useState("all");
  const [toggledToken, setToggledToken] = useState(null);
  const portfolioRef = useRef(null);

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

  useEffect(() => {
    const fetchBtcPrice = async () => {
      setIsLoadingBtcPrice(true);
      try {
        const response = await fetch(`/api/coingecko?action=coin-details&id=bitcoin`, {
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        const result = await response.json();
        if (response.ok && result.data?.market_data?.current_price?.usd) {
          setBtcPrice(result.data.market_data.current_price.usd);
          logger.log("Fetched BTC price:", { price: result.data.market_data.current_price.usd });
        } else {
          throw new Error("Failed to fetch BTC price");
        }
      } catch (err) {
        logger.error("Error fetching BTC price:", { error: err.message, stack: err.stack });
        setBtcPrice(0);
        toast.error(`Failed to load BTC price: ${err.message}`, { position: "top-center", autoClose: 3000 });
      } finally {
        setIsLoadingBtcPrice(false);
      }
    };
    fetchBtcPrice();
  }, []);

  useEffect(() => {
    const mappedId = mapExchangeId(exchangeIdFromQuery);
    fetchExchangeData(mappedId);
    if (btcPrice) {
      fetchVolumeHistory(mappedId); // Only fetch volume history when btcPrice is available
    }
    fetchPortfolioAndWallets(exchangeIdFromQuery);
  }, [exchangeIdFromQuery, currency, btcPrice]);

  useEffect(() => {
    const fetchChainLogos = async () => {
      try {
        const response = await fetch("/api/coingecko/chains", {
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Failed to fetch chain data");
        const logos = result.data.reduce((acc, chain) => {
          acc[chain.id.toLowerCase()] = chain.image?.thumb || "/fallback-image.png";
          return acc;
        }, {});
        logos["bitcoin"] = BITCOIN_LOGO;
        setChainLogos(logos);
        logger.log("Fetched chain logos:", { data: logos });
      } catch (err) {
        logger.error("Error fetching chain logos:", { error: err.message, stack: err.stack });
        toast.error(`Failed to load chain logos: ${err.message}`, { position: "top-center", autoClose: 3000 });
      }
    };
    fetchChainLogos();
  }, []);

  useEffect(() => {
    if (walletData.length > 0) {
      const evmWallets = walletData.filter((w) => w.chain?.toLowerCase() !== "bitcoin");
      fetchTransactions(evmWallets, 1000000);
    }
  }, [walletData]);

  useEffect(() => {
    if (portfolioData.length > 0) {
      logger.log("Processing portfolio data for token images:", { portfolioData });
      const uniqueTokens = [...new Set(portfolioData.map((item) => item.token_address))];
      Promise.all(
        uniqueTokens.map(async (address) => {
          try {
            if (address.toLowerCase() === "bitcoin") {
              logger.log(`Using hardcoded Bitcoin details for address: ${address}`);
              return [
                address,
                {
                  image: { thumb: "/logos/bitcoin.png" },
                  symbol: "BTC",
                },
              ];
            }

            const cacheResponse = await fetch(`/api/cache?key=coingecko_token_details_${address}`, {
              headers: { "Content-Type": "application/json" },
              credentials: "include",
            });
            const cacheResult = await cacheResponse.json();
            if (cacheResponse.ok && cacheResult.success && cacheResult.data) {
              logger.log(`Cache hit for token details: ${address}`);
              return [address, cacheResult.data];
            }

            const response = await fetch(`/api/coingecko?action=token-details&address=${address}`, {
              headers: { "Content-Type": "application/json" },
              credentials: "include",
            });
            const result = await response.json();
            if (response.ok && result.success && result.data) {
              await fetch(`/api/cache`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  key: `coingecko_token_details_${address}`,
                  action: "set",
                  data: result.data,
                  ttl: 4 * 3600 * 1000,
                }),
              });
              logger.log(`Fetched and cached token details for address: ${address}`);
              return [address, result.data];
            }
            throw new Error(result.detail || "Invalid response from CoinGecko API");
          } catch (err) {
            logger.error(`Error fetching token data for ${address}:`, { error: err.message, stack: err.stack });
            return [address, { image: { thumb: "/fallback-image.png" }, symbol: address }];
          }
        }),
      ).then((pairs) => {
        const images = {};
        const symbols = {};
        pairs.forEach(([address, data]) => {
          images[address] = data.image?.thumb || data.image || "/fallback-image.png";
          symbols[address] = data.symbol?.toUpperCase() || address;
        });
        setTokenImages(images);
        setTokenSymbols(symbols);
        logger.log("Updated token images and symbols:", { images, symbols });
      });
    }
  }, [portfolioData]);

  useEffect(() => {
    if (selectedWallet) {
      logger.log("Triggering fetch for selected wallet:", { selectedWallet });
      if (/^0x[a-fA-F0-9]{40}$/.test(selectedWallet)) {
        fetchWalletBalances(selectedWallet);
        fetchWalletTransactions(selectedWallet);
      } else {
        setWalletBalances([]);
        setWalletTransactions([]);
        setWalletBalancesError("Balance data not available for Bitcoin addresses");
        setWalletTransactionsError("Transaction data not available for Bitcoin addresses");
      }
    }
  }, [selectedWallet]);

  const fetchExchangeData = async (exchangeId) => {
    setIsLoadingExchange(true);
    try {
      const response = await fetch(`/api/coingecko?action=exchange-details&id=${exchangeId}`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || `Failed to fetch exchange data for ${exchangeId}`);
      }
      if (!result.data) {
        throw new Error(`No data found for exchange: ${exchangeId}`);
      }
      setExchangeData(result.data);
      logger.log("Fetched exchange data:", { exchangeId, data: result.data });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching exchange data";
      logger.error("Error fetching exchange data:", { exchangeId, error: errorMessage, stack: err.stack });
      setError(errorMessage);
      toast.error(`Failed to load exchange data: ${errorMessage}`, { position: "top-center", autoClose: 3000 });
    } finally {
      setIsLoadingExchange(false);
    }
  };

 const fetchVolumeHistory = async (exchangeId) => {
  if (!btcPrice) {
    logger.warn("BTC price not available, skipping volume history fetch", { exchangeId });
    return; // Skip fetch if btcPrice is not available
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
      volume: (Number(volume) || 0) * btcPrice, // Convert BTC to USD
    }));
    setVolumeHistory(convertedData);
    logger.log("Fetched volume history:", { exchangeId, btcPrice, convertedData });
  } catch (err) {
    const errorMessage = err.message || "Unknown error fetching volume history";
    logger.error("Error fetching volume history:", { exchangeId, error: errorMessage, stack: err.stack });
    setError(errorMessage);
    toast.error(`Failed to load volume data: ${errorMessage}`, { position: "top-center", autoClose: 3000 });
  } finally {
    setIsLoadingVolume(false);
  }
};

  const fetchPortfolioAndWallets = async (exchangeId) => {
    setIsLoadingPortfolio(true);
    setIsLoadingWallets(true);
    try {
      const response = await fetch(`/api/token-cluster?exchange=${exchangeId}`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
      logger.log("API response for portfolio/wallets:", {
        exchangeId,
        portfolio: result.portfolio,
        wallets: result.wallets,
      });
      if (!result.portfolio || !result.wallets) {
        throw new Error(`No portfolio or wallet data found for exchange: ${exchangeId}`);
      }
      setPortfolioData(result.portfolio || []);
      setWalletData(result.wallets || []);
      logger.log("Fetched portfolio and wallet data:", {
        exchangeId,
        portfolioCount: result.portfolio.length,
        walletCount: result.wallets.length,
      });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching portfolio/wallet data";
      logger.error("Error fetching portfolio/wallet data:", { exchangeId, error: errorMessage, stack: err.stack });
      setError(errorMessage);
      toast.error(`Failed to load portfolio/wallet data: ${errorMessage}`, { position: "top-center", autoClose: 3000 });
    } finally {
      setIsLoadingPortfolio(false);
      setIsLoadingWallets(false);
    }
  };

  const fetchTransactions = async (input, minValueUsd = null) => {
    setIsLoadingTransactions(true);
    setTransactionsError(null);
    try {
      const walletAddresses = Array.isArray(input)
        ? input
          .filter((w) => w.chain?.toLowerCase() !== "bitcoin")
          .map((w) => (typeof w === "string" ? w : w.holder_address))
          .filter(Boolean)
        : [input].filter(Boolean);
      if (!walletAddresses.length) {
        throw new Error("No valid wallet addresses provided");
      }

      const requestBody = {
        action: "transactions",
        addresses: walletAddresses,
      };
      if (minValueUsd !== null) {
        requestBody.minValueUsd = minValueUsd;
      }

      const response = await fetch(`/api/sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(requestBody),
      });
      const text = await response.text();
      logger.log("Raw transactions response:", { walletAddresses, response: text });
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON response from transactions API");
      }
      if (!response.ok) throw new Error(result.detail || "Failed to fetch transactions");
      const transactionsData = result.data || [];
      logger.log("Parsed transactions data:", { transactionsData });
      setTransactions(transactionsData);
      logger.log("Fetched transactions:", { walletAddresses, minValueUsd, data: transactionsData });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching transactions";
      logger.error("Error fetching transactions:", { input, minValueUsd, error: errorMessage, stack: err.stack });
      setError(errorMessage);
      toast.error(`Failed to load transactions: ${errorMessage}`, { position: "top-center", autoClose: 3000 });
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  const fetchWalletTransactions = async (walletAddress) => {
    setIsLoadingWalletTransactions(true);
    setWalletTransactionsError(null);
    try {
      if (!walletAddress) {
        throw new Error("No wallet address provided");
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        throw new Error("Transaction data only available for EVM addresses");
      }

      const response = await fetch(`/api/sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "transactions",
          addresses: [walletAddress],
          limit: 1000,
        }),
      });
      const text = await response.text();
      logger.log("Raw wallet transactions response:", { walletAddress, response: text, status: response.status });
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON response from wallet transactions API");
      }
      if (!response.ok) {
        throw new Error(result.detail || `Failed to fetch transactions for wallet ${walletAddress}`);
      }
      const transactionsData = result.data || [];
      setWalletTransactions(transactionsData);
      logger.log("Fetched wallet transactions:", { walletAddress, data: transactionsData });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching wallet transactions";
      logger.error("Error fetching wallet transactions:", { walletAddress, error: errorMessage, stack: err.stack });
      setWalletTransactionsError(errorMessage);
      toast.error(`Failed to load wallet transactions: ${errorMessage}`, { position: "top-center", autoClose: 3000 });
    } finally {
      setIsLoadingWalletTransactions(false);
    }
  };

  const fetchWalletBalances = async (walletAddress) => {
    setIsunion
    setIsLoadingWalletBalances(true);
    setWalletBalancesError(null);
    logger.log("Starting fetchWalletBalances", { walletAddress });
    try {
      if (!walletAddress) {
        throw new Error("No wallet address provided");
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        throw new Error("Balance data only available for EVM addresses");
      }

      const response = await fetch(`/api/sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "wallet-balances",
          address: walletAddress,
          limit: 2000,
        }),
      });
      const text = await response.text();
      logger.log("Raw wallet balances response:", { walletAddress, response: text, status: response.status });
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON response from wallet balances API");
      }
      if (!response.ok) {
        throw new Error(result.detail || `Failed to fetch wallet balances: ${response.statusText}`);
      }
      if (!result.success || !result.data) {
        throw new Error(result.detail || "No balance data returned");
      }
      logger.log("Parsed wallet balances:", { walletAddress, data: result.data });
      setWalletBalances(result.data || []);
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching wallet balances";
      logger.error("Error fetching wallet balances:", { walletAddress, error: errorMessage, stack: err.stack });
      setWalletBalancesError(errorMessage);
      toast.error(`Failed to load wallet balances: ${errorMessage}`, { position: "top-center", autoClose: 3000 });
      setWalletBalances([]);
    } finally {
      setIsLoadingWalletBalances(false);
    }
  };

  const handleSearchSelect = (result) => {
    if (result.type === "exchange" || result.type === "organization") {
      const mappedId = mapExchangeId(result.exchangeId || result.id);
      router.push(`/cluster?exchangeId=${mappedId}`, { scroll: false });
    } else if (result.type === "wallet" || result.type === "nametag") {
      const address = result.address?.toLowerCase();
      if (
        /^0x[a-fA-F0-9]{40}$/.test(address) ||
        /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(address)
      ) {
        logger.log("Selected wallet address from search:", { address });
        setSelectedWallet(address);
      } else {
        logger.error("Invalid wallet address selected:", { address });
        toast.error("Invalid wallet address", { position: "top-center", autoClose: 3000 });
      }
    }
  };

  const handleWalletClick = (address) => {
    setSelectedWallet(address);
  };

  const handleCloseWalletBalances = () => {
    setSelectedWallet(null);
    setWalletBalances([]);
    setWalletTransactions([]);
    setWalletBalancesError(null);
    setWalletTransactionsError(null);
  };

  // Gộp ví trùng lặp trong walletData
  const uniqueWalletData = useMemo(() => {
    logger.log("Processing walletData for deduplication:", { walletData });
    const walletMap = new Map();

    walletData.forEach((wallet, index) => {
      const addr = wallet.holder_address?.toLowerCase();
      if (!addr) return;

      if (!walletMap.has(addr)) {
        walletMap.set(addr, {
          holder_address: wallet.holder_address,
          exchange_name: wallet.exchange_name,
          name_tag: wallet.name_tag || "N/A",
          image: wallet.image || (wallet.chain?.toLowerCase() === "bitcoin" ? BITCOIN_LOGO : "/fallback-image.png"),
          total_value_usd: Number(wallet.total_value_usd) || 0,
          key: `${addr}-${index}`, // Unique key for rendering
        });
      } else {
        const existing = walletMap.get(addr);
        existing.total_value_usd += Number(wallet.total_value_usd) || 0;
      }
    });

    const deduplicated = Array.from(walletMap.values());
    logger.log("Deduplicated wallet data:", { deduplicated });
    return deduplicated;
  }, [walletData]);

  const groupedPortfolio = useMemo(() => {
    logger.log("Processing portfolio data for chain details:", { portfolioData });
    const totalValue = portfolioData.reduce((sum, item) => sum + (Number(item.total_balance_usd) || 0), 0);

    const grouped = portfolioData.map((item, index) => {
      // Extract unique chains from metadata for filtering purposes
      const metadataChains = new Set(
        (item.metadata || []).map((token) => token.chain?.toLowerCase()).filter(Boolean),
      );

      return {
        ...item,
        key: `${item.token_address}-${index}`,
        percentage: totalValue > 0 ? ((Number(item.total_balance_usd) || 0) / totalValue) * 100 : 0,
        symbol: item.symbol || tokenSymbols[item.token_address] || item.token_address,
        logo: item.logo || tokenImages[item.token_address] || "/fallback-image.png",
        chains: Array.from(metadataChains), // Keep chains for filtering
      };
    });

    const filtered = selectedChain === "all" ? grouped : grouped.filter((item) =>
      item.chains.some((chain) => chain === selectedChain.toLowerCase()),
    );

    logger.log("Grouped portfolio after processing:", { filtered, selectedChain });
    return filtered;
  }, [portfolioData, selectedChain, tokenImages, tokenSymbols]);

  const totalPortfolioValue = useMemo(() => {
    return groupedPortfolio.reduce((sum, item) => sum + (Number(item.total_balance_usd) || 0), 0);
  }, [groupedPortfolio]);

  const chains = useMemo(() => {
    const chainSet = new Set(["all"]);
    portfolioData.forEach((item) => {
      (item.metadata || []).forEach((token) => {
        if (token.chain) chainSet.add(token.chain.toLowerCase());
      });
    });
    walletData.forEach((wallet) => {
      (wallet.metadata || []).forEach((token) => {
        if (token.chain) chainSet.add(token.chain.toLowerCase());
      });
    });
    return Array.from(chainSet).map((value) => ({
      value,
      label: value === "all" ? "All Chains" : CHAIN_ID_TO_NAME[value.toLowerCase()] || value,
      image: value === "bitcoin" ? BITCOIN_LOGO : chainLogos[value.toLowerCase()] || "/fallback-image.png",
    }));
  }, [portfolioData, walletData, chainLogos]);

  const renderPortfolioContent = () => {
    return (
      <div className="flex flex-col" ref={portfolioRef}>
        <div className="overflow-y-auto max-h-[calc(50vh-5rem)] hide-scrollbar">
          <LoadingOverlay isLoading={isLoadingPortfolio} isMobile={isMobile} />
          {isLoadingPortfolio ? (
            <SkeletonLoader count={5} isMobile={isMobile} />
          ) : groupedPortfolio.length > 0 ? (
            <table className="w-full text-[8px] sm:text-[10px]">
              <thead className="border-b border-white/10 bg-black/5">
                <tr>
                  <th className="px-2 py-1 text-white text-left font-semibold ml-2 m-1">Token</th>
                  <th className="px-2 py-1 text-white text-left font-semibold m-1">Balance</th>
                  <th className="px-2 py-1 text-white text-left font-semibold m-1">Value ({currency.toUpperCase()})</th>
                  <th className="px-2 py-1 text-white text-left font-semibold m-1">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {groupedPortfolio.map((group, index) => (
                  <motion.tr
                    key={group.key}
                    className="border-t border-white/10 hover:bg-white/5"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                  >
                    <td className="px-2 py-2 text-white">
                      <img
                        src={group.logo || (group.token_address === "bitcoin" ? BITCOIN_LOGO : "/fallback-image.png")}
                        alt={`${group.symbol} logo`}
                        className="w-4 h-4 inline mr-2 rounded-full"
                        onError={(e) => (e.target.src = "/fallback-image.png")}
                      />
                      {group.symbol || (group.token_address === "bitcoin" ? "BTC" : group.token_address)}
                    </td>
                    <td className="px-2 py-2 text-white">
                      {group.total_balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-2 text-white">{formatPrice(group.total_balance_usd || 0, currency, 2)}</td>
                    <td className="px-2 py-2 text-white">{group.percentage.toFixed(2)}%</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[10px] sm:text-xs text-white/60 text-center">No portfolio data available.</p>
          )}
        </div>
      </div>
    );
  };

  const renderWalletsContent = () => {
    const totalValue = uniqueWalletData.reduce((sum, wallet) => sum + (Number(wallet.total_value_usd) || 0), 0);
    return (
      <div className="overflow-y-auto max-h-[calc(50vh-5rem)] hide-scrollbar">
        <LoadingOverlay isLoading={isLoadingWallets} isMobile={isMobile} />
        {isLoadingWallets ? (
          <SkeletonLoader count={5} isMobile={isMobile} />
        ) : uniqueWalletData.length > 0 ? (
          <table className="w-full text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-black/5">
              <tr>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Wallet Address</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Name Tag</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Value ({currency.toUpperCase()})</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Percentage</th>
              </tr>
            </thead>
            <tbody>
              {uniqueWalletData.map((wallet, index) => {
                const percentage = totalValue > 0 ? ((Number(wallet.total_value_usd) || 0) / totalValue) * 100 : 0;
                return (
                  <motion.tr
                    key={wallet.key}
                    className="border-t border-white/10"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                  >
                    <td className="px-2 py-2 text-white">
                      <div className="flex items-center gap-2 group relative">
                        <button
                          onClick={() => handleWalletClick(wallet.holder_address)}
                          className="text-white hover:text-white/80 no-hover-effect"
                        >
                          {truncateAddress(wallet.holder_address).text}
                        </button>
                        <motion.button
                          onClick={() => {
                            navigator.clipboard.writeText(wallet.holder_address);
                            toast.success("Address copied!", { autoClose: 2000 });
                          }}
                          className="ml-1 text-white/40 hover:text-white/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg no-hover-effect"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
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
                        </motion.button>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-white">
                      <img
                        src={wallet.image}
                        alt="Wallet logo"
                        className="w-4 h-4 inline mr-2 rounded-full"
                        onError={(e) => (e.target.src = "/fallback-image.png")}
                      />
                      {wallet.name_tag}
                    </td>
                    <td className="px-2 py-2 text-white">{formatPrice(Number(wallet.total_value_usd) || 0, currency, 2)}</td>
                    <td className="px-2 py-2 text-white">{percentage.toFixed(2)}%</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-[10px] sm:text-xs text-white/60 text-center">No wallet data available.</p>
        )}
      </div>
    );
  };

  const renderTransactionsContent = () => {
    return (
      <div className="overflow-y-auto max-h-[calc(50vh-5rem)] hide-scrollbar">
        <LoadingOverlay isLoading={isLoadingTransactions} isMobile={isMobile} />
        {isLoadingTransactions ? (
          <SkeletonLoader count={5} isMobile={isMobile} />
        ) : transactions.length > 0 ? (
          <table className="w-full text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className="px-2 py-1 text-white text-left font-semibold w-[60px] sm:w-[80px] m-1">Chain</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Token</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">From</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">To</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Value ({currency.toUpperCase()})</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Token Value</th>
                <th className="px-2 py-1 text-white text-left font-semibold w-[120px] sm:w-[140px] m-1">Details</th>
              </tr>
            </thead>
            <tbody>
              {transactions
                .filter((tx) => tx.type !== "approve") // Filter out approve transactions
                .map((tx, index) => {
                  const chainName = typeof tx.chain === "string" ? tx.chain.toLowerCase() : (tx.chain_id || "unknown").toString().toLowerCase();
                  if (chainName === "bitcoin") return null;

                  const fromWallet = uniqueWalletData.find((w) => w.holder_address?.toLowerCase() === tx.from?.toLowerCase()) || {};
                  const toWallet = uniqueWalletData.find((w) => w.holder_address?.toLowerCase() === tx.to?.toLowerCase()) || {};
                  const fromNtag = {
                    name: fromWallet.name_tag || "N/A",
                    image: fromWallet.image || (chainName === "bitcoin" ? BITCOIN_LOGO : "/fallback-image.png"),
                  };
                  const toNtag = {
                    name: toWallet.name_tag || "N/A",
                    image: toWallet.image || (chainName === "bitcoin" ? BITCOIN_LOGO : "/fallback-image.png"),
                  };
                  const chain = chainName !== "unknown" ? chainName : "ethereum";
                  const { txUrl } = getExplorerUrls(chain, tx.hash || "", "");

                  logger.log("Transaction data:", {
                    hash: tx.hash,
                    value_usd: tx.value_usd,
                    value: tx.value,
                    formatted_value_usd: formatPrice(Number(tx.value_usd) || 0, currency, 2),
                  });

                  return (
                    <motion.tr
                      key={`${tx.hash}-${index}`}
                      className="border-t border-white/10"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.02 }}
                    >
                      <td className="px-2 py-2 text-white w-[60px] sm:w-[80px]">
                        <img
                          src={chainLogos[chain] || "/fallback-image.png"}
                          alt={`${CHAIN_ID_TO_NAME[chain] || chain || "Unknown"} logo`}
                          className="w-4 h-4 inline rounded-full"
                          onError={(e) => (e.target.src = "/fallback-image.png")}
                        />
                      </td>
                      <td className="px-2 py-2 text-white">
                        <div className="flex items-center gap-2">
                          <img
                            src={tx.token_metadata?.logo || "/fallback-image.png"}
                            alt={`${tx.token_metadata?.symbol || "Unknown"} logo`}
                            className="w-4 h-4 inline rounded-full"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                          <span>{tx.token_metadata?.symbol || "Unknown"}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-white">
                        <div className="flex items-center gap-2 group relative">
                          <img
                            src={fromNtag.image}
                            alt="From wallet logo"
                            className="w-4 h-4 inline mr-2 rounded-full"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                          <button
                            onClick={() => handleWalletClick(tx.from)}
                            className="text-white hover:text-white/80 no-hover-effect"
                          >
                            {fromNtag.name !== "N/A" ? fromNtag.name : truncateAddress(tx.from).text}
                          </button>
                          <motion.button
                            onClick={() => {
                              navigator.clipboard.writeText(tx.from);
                              toast.success("Address copied!", { autoClose: 2000 });
                            }}
                            className="ml-1 text-white/40 hover:text-white/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg no-hover-effect"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            aria-label="Copy from address"
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
                        </div>
                      </td>
                      <td className="px-2 py-2 text-white">
                        <div className="flex items-center gap-2 group relative">
                          <img
                            src={toNtag.image}
                            alt="To wallet logo"
                            className="w-4 h-4 inline mr-2 rounded-full"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                          <button
                            onClick={() => handleWalletClick(tx.to)}
                            className="text-white hover:text-white/80 no-hover-effect"
                          >
                            {toNtag.name !== "N/A" ? toNtag.name : truncateAddress(tx.to).text}
                          </button>
                          <motion.button
                            onClick={() => {
                              navigator.clipboard.writeText(tx.to);
                              toast.success("Address copied!", { autoClose: 2000 });
                            }}
                            className="ml-1 text-white/40 hover:text-white/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg no-hover-effect"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            aria-label="Copy to address"
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
                        </div>
                      </td>
                      <td className="px-2 py-2 text-white">{formatPrice(Number(tx.value_usd) || 0, currency, 2)}</td>
                      <td className="px-2 py-2 text-white">
                        {Number(tx.value).toLocaleString("en-US", { maximumFractionDigits: 6 })}
                      </td>
                      <td className="px-2 py-2 text-white w-[120px] sm:w-[140px]">
                        <div className="flex flex-col items-center justify-center gap-1">
                          <motion.a
                            href={txUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block no-hover-effect"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            <img
                              src="/logos/etherscan-logo.png"
                              alt="Explorer"
                              className="w-3 h-3"
                              onError={(e) => (e.target.src = "/fallback-image.png")}
                            />
                          </motion.a>
                          <span className="text-[7px] sm:text-[7px]">
                            {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : "N/A"}
                          </span>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
            </tbody>
          </table>
        ) : (
          <p className="text-[10px] sm:text-xs text-white/60 text-center">No large transactions available.</p>
        )}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-2 bg-black/80 flex flex-col h-[calc(100vh-3rem)] overflow-y-auto hide-scrollbar"
    >
      <div className="w-full mb-2">
        <UniversalSearch
          onSelect={handleSearchSelect}
          placeholder="Search wallets, nametags, or exchanges..."
          className="max-w-[300px]"
          size="default"
        />
      </div>

      {error && (
        <motion.div
          className="text-[10px] sm:text-xs text-red-400 text-center p-2 sm:p-4 bg-red-500/10 border border-red-500/20 rounded-lg mb-2"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          Error: {error}
        </motion.div>
      )}

      <div className="flex flex-col flex-1 gap-4 sm:gap-6">
        <motion.div
          className="border border-white/10 rounded-xl bg-white/5 backdrop-blur-xl flex flex-col md:flex-row"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex-1 p-4">
            <LoadingOverlay isLoading={isLoadingExchange || isLoadingBtcPrice} isMobile={isMobile} />
            {isLoadingExchange || isLoadingBtcPrice ? (
              <SkeletonLoader count={3} isMobile={isMobile} />
            ) : exchangeData ? (
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    <img
                      src={exchangeData.image || "/fallback-image.png"}
                      alt={`${exchangeData.name} logo`}
                      className="w-6 sm:w-8 h-6 sm:h-8 rounded-full"
                      onError={(e) => (e.target.src = "/fallback-image.png")}
                    />
                    <h4 className="text-base sm:text-lg font-bold text-white">{exchangeData.name}</h4>
                  </div>
                  <h4 className="ml-12 sm:ml-0 text-xs sm:text-lg font-bold text-white tracking-wider">
                    Total Value : {formatPrice(totalPortfolioValue, currency, 2)}
                  </h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white/5 rounded-xl p-3">
                    <h5 className="text-[10px] font-bold text-white uppercase mb-2">Exchange Info</h5>
                    <div className="space-y-2 text-[10px] sm:text-xs">
                      <div className="flex justify-between">
                        <span className="text-white/60">Country:</span>
                        <span className="text-white">{exchangeData.country || "N/A"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Year Established:</span>
                        <span className="text-white">{exchangeData.year_established || "N/A"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Trust Score:</span>
                        <span className="text-white">{exchangeData.trust_score || "N/A"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <h5 className="text-[10px] font-bold text-white uppercase mb-2">Trading Volume</h5>
                    <div className="space-y-2 text-[10px] sm:text-xs">
                      <div className="flex justify-between">
                        <span className="text-white/60">24h USD Volume:</span>
                        <span className="text-white">
                          {btcPrice && exchangeData.trade_volume_24h_btc
                            ? formatPrice(Number(exchangeData.trade_volume_24h_btc) * btcPrice, currency, 2)
                            : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Centralized:</span>
                        <span className="text-white">{exchangeData.centralized ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  {exchangeData.twitter_handle && (
                    <motion.a
                      href={`https://twitter.com/${exchangeData.twitter_handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 bg-white/10 rounded-xl hover:bg-white/20"
                      whileHover={{ scale: 1.1, y: -2 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <img src="/logos/x.png" alt="Twitter" className="w-3 h-3" />
                    </motion.a>
                  )}
                  {exchangeData.url && (
                    <motion.a
                      href={exchangeData.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 bg-white/10 rounded-xl hover:bg-white/20"
                      whileHover={{ scale: 1.1, y: -2 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <img src="/logos/website.png" alt="Website" className="w-3 h-3" />
                    </motion.a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[10px] sm:text-xs text-white/60 text-center">Please select an exchange.</p>
            )}
          </div>
          <div className="flex-1 p-4">
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
                    tickFormatter={(value) => formatLargeNumber(value, currency, 0)} // Use compact format for Y-axis
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
                      <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[10px] sm:text-xs text-white/60 text-center">No volume data available.</p>
            )}
          </div>
        </motion.div>

        <div className="flex flex-col md:flex-row gap-4 flex-1">
          <motion.div
            className="flex-1 border border-white/10 rounded-xl bg-white/5 backdrop-blur-xl flex flex-col"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="p-0 border-b border-white/10 bg-white/5 flex gap-4 items-end h-[48px]">
              <motion.button
                onClick={() => setActiveTab("portfolio")}
                className={`text-xs font-bold text-white uppercase tracking-wider px-4 py-2 no-hover-effect ${activeTab === "portfolio" ? "border-b-2 border-white" : "text-white/80 hover:text-white"}`}
              >
                Portfolio
              </motion.button>
              <motion.button
                onClick={() => setActiveTab("wallets")}
                className={`text-xs font-bold text-white uppercase tracking-wider px-4 py-2 no-hover-effect ${activeTab === "wallets" ? "border-b-2 border-white" : "text-white/80 hover:text-white"}`}
              >
                Wallets
              </motion.button>
            </div>
            {activeTab === "portfolio" ? renderPortfolioContent() : renderWalletsContent()}
          </motion.div>

          <motion.div
            className="flex-1 border border-white/10 rounded-xl bg-white/5 backdrop-blur-xl flex flex-col"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <div className="p-4 border-b border-white/10 bg-white/5">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Large Flow</h4>
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
          fetchTransactions={fetchWalletTransactions}
          chains={chains}
          setSelectedWallet={setSelectedWallet}
          setWalletBalances={setWalletBalances}
          setTransactions={setWalletTransactions}
          setWalletBalancesError={setWalletBalancesError}
          setTransactionsError={setWalletTransactionsError}
          setWalletAddress={setSelectedWallet}
          nameTags={uniqueWalletData.reduce((acc, w) => ({
            ...acc,
            [w.holder_address?.toLowerCase()]: {
              name: w.name_tag || "N/A",
              image: w.image || (w.chains.includes("bitcoin") ? BITCOIN_LOGO : "/fallback-image.png"),
            },
          }), {})}
          isMobile={isMobile}
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