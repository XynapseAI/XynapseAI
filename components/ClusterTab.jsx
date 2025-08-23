"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
import useSWR from "swr";
import axios from "axios";
import axiosRetry from "axios-retry";
import { cacheData, getCachedData } from "../utils/indexedDB";
import "../styles/MarketTab.css";
import "react-loading-skeleton/dist/skeleton.css";

const BITCOIN_LOGO = "/logos/bitcoin.png";

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.code === "ECONNABORTED" || error.response?.status >= 500,
});

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
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState("portfolio");
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [selectedChain, setSelectedChain] = useState("all");
  const [toggledToken, setToggledToken] = useState(null);
  const portfolioRef = useRef(null);
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

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
    return () => window.addEventListener("resize", checkMobile);
  }, []);

  const fetchData = useCallback(async (url, cacheKey, ttl = 4 * 3600 * 1000) => {
    try {
      const cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        logger.log(`Cache hit for ${cacheKey}`, { cachedData });
        return cachedData;
      }
    } catch (error) {
      logger.warn(`IndexedDB not available or cache miss for ${cacheKey}`, { error });
    }

    try {
      logger.log(`Fetching data from ${url}`);
      const response = await axios.get(url, {
        headers: { "Content-Type": "application/json" },
        withCredentials: true,
        timeout: 30000,
      });
      logger.log(`Raw API response for ${url}`, { response: response.data });
      if (!response.data.success) {
        throw new Error(response.data.detail || `Failed to fetch data from ${url}`);
      }
      const data = response.data; // Use response.data directly, not response.data.data
      await cacheData(cacheKey, data, ttl);
      logger.log(`Fetched and cached data for ${cacheKey}`, { data });
      return data;
    } catch (error) {
      logger.error(`Error fetching data from ${url}: ${error.message}`, { error });
      throw error;
    }
  }, []);

  const fetchSimData = useCallback(async (payload, cacheKey, ttl = 4 * 3600 * 1000) => {
    try {
      const cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        logger.log(`Cache hit for ${cacheKey}`, { cachedData });
        return cachedData;
      }
    } catch (error) {
      logger.warn(`IndexedDB not available or cache miss for ${cacheKey}`, { error });
    }

    try {
      logger.log(`Fetching sim data for ${payload.action}`, { payload });
      const response = await axios.post(`${API_BASE_URL}/api/sim`, payload, {
        headers: { "Content-Type": "application/json" },
        withCredentials: true,
        timeout: 30000,
      });
      logger.log(`Raw API response for sim ${payload.action}`, { response: response.data });
      if (!response.data.success) {
        throw new Error(response.data.detail || `Failed to fetch data for ${payload.action}`);
      }
      const data = response.data.data;
      await cacheData(cacheKey, data, ttl);
      logger.log(`Fetched and cached data for ${cacheKey}`, { data });
      return data;
    } catch (error) {
      logger.error(`Error fetching sim data for ${payload.action}: ${error.message}`, { error });
      throw error;
    }
  }, []);

  const { data: btcPriceData, error: btcPriceError, isValidating: btcPriceValidating } = useSWR(
    ["btcPrice"],
    () => fetchData(`${API_BASE_URL}/api/coingecko?action=coin-details&id=bitcoin`, "btc_price"),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const mappedId = mapExchangeId(exchangeIdFromQuery);
  const { data: exchangeData, error: exchangeError, isValidating: exchangeValidating } = useSWR(
    ["exchangeData", mappedId],
    () => fetchData(`${API_BASE_URL}/api/coingecko?action=exchange-details&id=${mappedId}`, `exchange_${mappedId}`),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const { data: volumeHistoryData, error: volumeError, isValidating: volumeValidating } = useSWR(
    btcPriceData ? ["volumeHistory", mappedId, btcPriceData?.market_data?.current_price?.usd] : null,
    () => {
      const btcPrice = btcPriceData?.market_data?.current_price?.usd;
      if (!btcPrice) throw new Error("BTC price not available");
      return fetchData(
        `${API_BASE_URL}/api/coingecko?action=volume-chart&id=${mappedId}&days=7`,
        `volume_${mappedId}`,
        24 * 3600 * 1000
      ).then((data) =>
        data.map(([timestamp, volume]) => ({
          title: new Date(timestamp).toLocaleDateString(),
          volume: (Number(volume) || 0) * btcPrice,
        }))
      );
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const { data: portfolioAndWalletsData, error: portfolioError, isValidating: portfolioValidating } = useSWR(
    ["portfolioWallets", exchangeIdFromQuery],
    () => fetchData(`${API_BASE_URL}/api/token-cluster?exchange=${exchangeIdFromQuery}`, `portfolio_${exchangeIdFromQuery}`),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
      onSuccess: (data) => {
        logger.log("Portfolio and wallets data fetched:", { portfolio: data?.portfolio, wallets: data?.wallets });
      },
      onError: (error) => {
        logger.error("Failed to fetch portfolio and wallets data:", { error: error.message });
      },
    }
  );

  const { data: chainLogosData, error: chainLogosError } = useSWR(
    ["chainLogos"],
    () => fetchData(`${API_BASE_URL}/api/coingecko/chains`, "chain_logos"),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 24 * 3600 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const { data: tokenInfoData, error: tokenInfoError, isValidating: tokenInfoValidating } = useSWR(
    portfolioAndWalletsData?.portfolio?.length > 0 ? ["tokenInfo", portfolioAndWalletsData.portfolio] : null,
    async () => {
      const uniqueTokens = [...new Set(portfolioAndWalletsData.portfolio.map((item) => item.token_address))];
      const tokenInfo = {};
      for (const address of uniqueTokens) {
        const cacheKey = `coingecko_token_details_${address}`;
        try {
          if (address.toLowerCase() === "bitcoin") {
            tokenInfo[address] = { image: { thumb: BITCOIN_LOGO }, symbol: "BTC" };
            continue;
          }
          const data = await fetchData(
            `${API_BASE_URL}/api/coingecko?action=token-details&address=${address}`,
            cacheKey,
            4 * 3600 * 1000
          );
          tokenInfo[address] = data;
        } catch (err) {
          logger.error(`Error fetching token data for ${address}:`, { error: err.message });
          tokenInfo[address] = { image: { thumb: "/fallback-image.png" }, symbol: address };
        }
      }
      logger.log("Token info fetched:", { tokenInfo });
      return tokenInfo;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const { data: transactionsData, error: transactionsError, isValidating: transactionsValidating } = useSWR(
    portfolioAndWalletsData?.wallets?.length > 0 ? ["transactions", portfolioAndWalletsData.wallets] : null,
    () => {
      const walletAddresses = portfolioAndWalletsData.wallets
        .filter((w) => w.chain?.toLowerCase() !== "bitcoin")
        .map((w) => w.holder_address)
        .filter(Boolean);
      if (!walletAddresses.length) {
        logger.warn("No valid EVM wallet addresses for transactions");
        return [];
      }
      return fetchSimData(
        {
          action: "transactions",
          addresses: walletAddresses,
          minValueUsd: 1000000,
          limit: 1000,
        },
        `transactions_${exchangeIdFromQuery}`
      );
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
      onSuccess: (data) => {
        logger.log("Transactions data fetched:", { transactions: data });
      },
      onError: (error) => {
        logger.error("Failed to fetch transactions data:", { error: error.message });
      },
    }
  );

  const { data: walletBalancesData, error: walletBalancesError, isValidating: walletBalancesValidating } = useSWR(
    selectedWallet && /^0x[a-fA-F0-9]{40}$/.test(selectedWallet) ? ["walletBalances", selectedWallet] : null,
    () =>
      fetchSimData(
        {
          action: "wallet-balances",
          address: selectedWallet,
          limit: 2000,
        },
        `wallet_balances_${selectedWallet}`
      ),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const { data: walletTransactionsData, error: walletTransactionsError, isValidating: walletTransactionsValidating } = useSWR(
    selectedWallet && /^0x[a-fA-F0-9]{40}$/.test(selectedWallet) ? ["walletTransactions", selectedWallet] : null,
    () =>
      fetchSimData(
        {
          action: "transactions",
          addresses: [selectedWallet],
          limit: 1000,
        },
        `wallet_transactions_${selectedWallet}`
      ),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  useEffect(() => {
    if (btcPriceError) logger.error("BTC price error:", { error: btcPriceError.message });
    if (exchangeError) logger.error("Exchange data error:", { error: exchangeError.message });
    if (volumeError) logger.error("Volume history error:", { error: volumeError.message });
    if (portfolioError) logger.error("Portfolio/wallets error:", { error: portfolioError.message });
    if (chainLogosError) logger.error("Chain logos error:", { error: chainLogosError.message });
    if (tokenInfoError) logger.error("Token info error:", { error: tokenInfoError.message });
    if (transactionsError) logger.error("Transactions error:", { error: transactionsError.message });
    if (walletBalancesError) logger.error("Wallet balances error:", { error: walletBalancesError.message });
    if (walletTransactionsError) logger.error("Wallet transactions error:", { error: walletTransactionsError.message });
  }, [
    btcPriceError,
    exchangeError,
    volumeError,
    portfolioError,
    chainLogosError,
    tokenInfoError,
    transactionsError,
    walletBalancesError,
    walletTransactionsError,
  ]);

  const btcPrice = btcPriceData?.market_data?.current_price?.usd || 0;
  const portfolioData = portfolioAndWalletsData?.portfolio || [];
  const walletData = portfolioAndWalletsData?.wallets || [];
  const volumeHistory = volumeHistoryData || [];
  const transactions = transactionsData || [];
  const walletBalances = walletBalancesData || [];
  const walletTransactions = walletTransactionsData || [];

  useEffect(() => {
    logger.log("Current state:", {
      exchangeIdFromQuery,
      portfolioDataLength: portfolioData.length,
      walletDataLength: walletData.length,
      transactionsLength: transactions.length,
      portfolioValidating,
      transactionsValidating,
      selectedChain,
      portfolioAndWalletsData,
    });
  }, [portfolioData, walletData, transactions, portfolioValidating, transactionsValidating, exchangeIdFromQuery, selectedChain, portfolioAndWalletsData]);

  const chainLogos = useMemo(() => {
    if (!chainLogosData) return { bitcoin: BITCOIN_LOGO };
    const logos = chainLogosData.reduce((acc, chain) => {
      acc[chain.id.toLowerCase()] = chain.image?.thumb || "/fallback-image.png";
      return acc;
    }, {});
    logos["bitcoin"] = BITCOIN_LOGO;
    return logos;
  }, [chainLogosData]);

  const tokenImages = useMemo(() => {
    if (!tokenInfoData) return {};
    const images = {};
    Object.entries(tokenInfoData).forEach(([address, data]) => {
      images[address] = data.image?.thumb || data.image || "/fallback-image.png";
    });
    return images;
  }, [tokenInfoData]);

  const tokenSymbols = useMemo(() => {
    if (!tokenInfoData) return {};
    const symbols = {};
    Object.entries(tokenInfoData).forEach(([address, data]) => {
      symbols[address] = data.symbol?.toUpperCase() || address;
    });
    return symbols;
  }, [tokenInfoData]);

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
  };

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
          token_count: wallet.token_count || 0,
          chain: wallet.chain || "unknown",
          key: `${addr}-${index}`,
        });
      } else {
        const existing = walletMap.get(addr);
        existing.total_value_usd += Number(wallet.total_value_usd) || 0;
        existing.token_count = (existing.token_count || 0) + (wallet.token_count || 0);
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
      const metadataChains = new Set(
        (item.chain_details || []).map((token) => token.chain?.toLowerCase()).filter(Boolean)
      );

      return {
        ...item,
        key: `${item.token_address}-${index}`,
        percentage: totalValue > 0 ? ((Number(item.total_balance_usd) || 0) / totalValue) * 100 : 0,
        symbol: item.symbol || tokenSymbols[item.token_address] || item.token_address,
        logo: item.logo || tokenImages[item.token_address] || "/fallback-image.png",
        chains: Array.from(metadataChains),
      };
    });

    const filtered = selectedChain === "all" ? grouped : grouped.filter((item) =>
      item.chains.some((chain) => chain === selectedChain.toLowerCase())
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
      (item.chain_details || []).forEach((token) => {
        if (token.chain) chainSet.add(token.chain.toLowerCase());
      });
    });
    walletData.forEach((wallet) => {
      if (wallet.chain) chainSet.add(wallet.chain.toLowerCase());
    });
    return Array.from(chainSet).map((value) => ({
      value,
      label: value === "all" ? "All Chains" : CHAIN_ID_TO_NAME[value.toLowerCase()] || value,
      image: value === "bitcoin" ? BITCOIN_LOGO : chainLogos[value.toLowerCase()] || "/fallback-image.png",
    }));
  }, [portfolioData, walletData, chainLogos]);

  const renderPortfolioContent = () => {
    logger.log("Rendering Portfolio content:", { portfolioDataLength: portfolioData.length, groupedPortfolioLength: groupedPortfolio.length });
    return (
      <div className="flex flex-col" ref={portfolioRef}>
        <div className="overflow-y-auto max-h-[calc(50vh-5rem)] hide-scrollbar">
          <LoadingOverlay isLoading={portfolioValidating} isMobile={isMobile} />
          {portfolioValidating ? (
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
            <p className="text-[10px] sm:text-xs text-white/60 text-center">
              {portfolioError ? `Failed to load portfolio data: ${portfolioError.message}` : "No portfolio data available for this exchange."}
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderWalletsContent = () => {
    logger.log("Rendering Wallets content:", { walletDataLength: walletData.length, uniqueWalletDataLength: uniqueWalletData.length });
    const totalValue = uniqueWalletData.reduce((sum, wallet) => sum + (Number(wallet.total_value_usd) || 0), 0);
    return (
      <div className="overflow-y-auto max-h-[calc(50vh-5rem)] hide-scrollbar">
        <LoadingOverlay isLoading={portfolioValidating} isMobile={isMobile} />
        {portfolioValidating ? (
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
                const displayAddress = /^0x[a-fA-F0-9]{40}$/.test(wallet.holder_address)
                  ? wallet.holder_address
                  : wallet.holder_address;
                const isBitcoinAddress = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(wallet.holder_address);
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
                        {isBitcoinAddress && (
                          <img
                            src={BITCOIN_LOGO}
                            alt="Bitcoin logo"
                            className="w-4 h-4 inline rounded-full"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                        )}
                        <button
                          onClick={() => handleWalletClick(wallet.holder_address)}
                          className="text-white hover:text-white/80 no-hover-effect"
                        >
                          {displayAddress}
                        </button>

                        <motion.button
                          onClick={() => {
                            navigator.clipboard.writeText(wallet.holder_address);
                            toast.success("Address copied!", { autoClose: 2000 });
                          }}
                          className="text-white/40 hover:text-white/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg no-hover-effect"
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
          <p className="text-[10px] sm:text-xs text-white/60 text-center">
            {portfolioError ? `Failed to load wallet data: ${portfolioError.message}` : "No wallet data available for this exchange."}
          </p>
        )}
      </div>
    );
  };

  const renderTransactionsContent = () => {
    logger.log("Rendering Transactions content:", { transactionsLength: transactions.length });
    return (
      <div className="overflow-y-auto max-h-[calc(50vh-5rem)] hide-scrollbar">
        <LoadingOverlay isLoading={transactionsValidating} isMobile={isMobile} />
        {transactionsValidating ? (
          <SkeletonLoader count={5} isMobile={isMobile} />
        ) : transactions.length > 0 ? (
          <table className="w-full text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Token</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">From</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">To</th>
                <th className="px-2 py-1 text-white text-center font-semibold m-1">Token Value</th>
                <th className="px-2 py-1 text-white text-left font-semibold m-1">Value ({currency.toUpperCase()})</th>
                <th className="px-2 py-1 text-white text-left font-semibold w-[120px] sm:w-[140px] m-1">Details</th>
              </tr>
            </thead>
            <tbody>
              {transactions
                .filter((tx) => tx.type !== "approve")
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
                  const tokenSymbol = tx.token_metadata?.symbol || "Unknown";
                  const typeDisplay = tx.type ? tx.type.charAt(0).toUpperCase() + tx.type.slice(1) : "Other";
                  let displayValue = Number(tx.value).toLocaleString("en-US", { maximumFractionDigits: 1 });
                  let tokenLogo = tx.token_metadata?.logo || "/fallback-image.png";

                  if (tx.type === "swap" && tx.swap_details) {
                    const sent = tx.swap_details.sent[0];
                    const received = tx.swap_details.received[0];
                    if (sent && received) {
                      displayValue = `${Number(sent.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${sent.symbol} → ${Number(received.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${received.symbol}`;
                      tokenSymbol = `${sent.symbol}/${received.symbol}`;
                      tokenLogo = sent.logo || received.logo || "/fallback-image.png";
                    } else if (sent) {
                      displayValue = `${Number(sent.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${sent.symbol}`;
                      tokenSymbol = sent.symbol;
                      tokenLogo = sent.logo || "/fallback-image.png";
                    } else if (received) {
                      displayValue = `${Number(received.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${received.symbol}`;
                      tokenSymbol = received.symbol;
                      tokenLogo = received.logo || "/fallback-image.png";
                    }
                  } else if (tx.type === "other") {
                    displayValue = tx.value || "N/A";
                  }

                  return (
                    <motion.tr
                      key={`${tx.hash}-${index}`}
                      className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.02 }}
                    >
                      <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px]">
                        <div className="flex items-center gap-2 relative">
                          <div className="relative flex-shrink-0">
                            <img
                              src={tokenLogo}
                              alt={`${tokenSymbol} logo`}
                              width={isMobile ? 14 : 16}
                              height={isMobile ? 14 : 16}
                              className="rounded-full"
                              onError={(e) => (e.target.src = "/fallback-image.png")}
                              loading="lazy"
                            />
                            <img
                              src={chainLogos[chain] || "/fallback-image.png"}
                              alt={`${CHAIN_ID_TO_NAME[chain] || chain || "Unknown"} logo`}
                              width={isMobile ? 8 : 10}
                              height={isMobile ? 8 : 10}
                              className="rounded-full absolute top-0 left-0"
                              style={{ transform: "translate(-25%, -25%)" }}
                              onError={(e) => (e.target.src = "/fallback-image.png")}
                              loading="lazy"
                            />
                          </div>
                          <span>{tokenSymbol}</span>
                        </div>
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px]">
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
                      <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px]">
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
                      <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span
                            className={`inline-flex px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] sm:text-[9px] font-medium ${tx.type === "receive"
                                ? "bg-neon-green/20 text-neon-green"
                                : tx.type === "send"
                                  ? "bg-neon-blue/20 text-neon-blue"
                                  : tx.type === "swap"
                                    ? "bg-purple-400/20 text-purple-400"
                                    : "bg-white/20 text-white/60"
                              }`}
                          >
                            {typeDisplay}
                          </span>
                          <span>{displayValue}</span>
                        </div>
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px]">
                        {formatPrice(Number(tx.value_usd) || 0, currency, 2)}
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] w-[120px] sm:w-[140px]">
                        <div className="flex flex-col items-center justify-center gap-0.5">
                          <a href={txUrl} target="_blank" rel="noopener noreferrer">
                            <img
                              src="/logos/etherscan-logo.png"
                              alt="Explorer"
                              width={isMobile ? 12 : 14}
                              height={isMobile ? 12 : 14}
                              className="rounded-full"
                              onError={(e) => (e.target.src = "/fallback-image.png")}
                              loading="lazy"
                            />
                          </a>
                          <span className="text-[8px] sm:text-[9px] text-white/60">
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
          <p className="text-[10px] sm:text-xs text-white/60 text-center mt-10">
            {transactionsError ? `Failed to load transactions: ${transactionsError.message}` : "No large transactions available for this exchange."}
          </p>
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

      <div className="flex flex-col flex-1 gap-4 sm:gap-6">
        <motion.div
          className="border border-white/10 rounded-xl bg-white/5 backdrop-blur-xl flex flex-col md:flex-row"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex-1 p-4">
            <LoadingOverlay isLoading={exchangeValidating || btcPriceValidating} isMobile={isMobile} />
            {exchangeValidating || btcPriceValidating ? (
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
                    Total Value: {formatPrice(totalPortfolioValue, currency, 2)}
                  </h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white/5 rounded-xl p-3">
                    <h5 className="text-[10px] font-bold text-white uppercase mb-2">Exchange Info</h5>
                    <div className="space-y-2 text-[10px] sm:text-xs">
                      <div className="flex justify-between">
                        <span className="text-white/60">Country:</span>
                        <span className="text-white">{exchangeData.country || "Not available"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Year Established:</span>
                        <span className="text-white">{exchangeData.year_established || "Not available"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Trust Score:</span>
                        <span className="text-white">{exchangeData.trust_score || "Not available"}</span>
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
                            : "Not available"}
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
              <p className="text-[10px] sm:text-xs text-white/60 text-center">
                {exchangeError ? `Failed to load exchange data: ${exchangeError.message}` : "No exchange data available. Please select another exchange."}
              </p>
            )}
          </div>
          <div className="flex-1 p-4">
            <LoadingOverlay isLoading={volumeValidating} isMobile={isMobile} />
            {volumeValidating ? (
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
                      <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[10px] sm:text-xs text-white/60 text-center">
                {volumeError ? `Failed to load volume data: ${volumeError.message}` : "No volume data available for this exchange."}
              </p>
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
          isLoading={walletBalancesValidating}
          error={walletBalancesError ? "Failed to load wallet balances" : null}
          onClose={handleCloseWalletBalances}
          transactions={walletTransactions}
          isLoadingTransactions={walletTransactionsValidating}
          transactionsError={walletTransactionsError ? "Failed to load wallet transactions" : null}
          fetchTransactions={() => { }}
          chains={chains}
          setSelectedWallet={setSelectedWallet}
          setWalletBalances={setWalletBalances}
          setTransactions={setWalletTransactions}
          setWalletBalancesError={() => { }}
          setTransactionsError={() => { }}
          setWalletAddress={setSelectedWallet}
          setIsLoadingWalletBalances={() => { }}
          nameTags={uniqueWalletData.reduce((acc, w) => ({
            ...acc,
            [w.holder_address?.toLowerCase()]: {
              name: w.name_tag || "N/A",
              image: w.image || (w.chain?.toLowerCase() === "bitcoin" ? BITCOIN_LOGO : "/fallback-image.png"),
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