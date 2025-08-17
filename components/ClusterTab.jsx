"use client";

import React, { useState, useEffect, useMemo } from "react";
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
import { SkeletonLoader, formatPrice, truncateAddress, LoadingOverlay , getExplorerUrls } from "../utils/helpers";
import "../styles/MarketTab.css";
import "react-loading-skeleton/dist/skeleton.css";

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
          Volume: <span className="text-emerald-400">{formatPrice(payload[0].value, currency, 2)}</span>
        </p>
      </motion.div>
    );
  }
  return null;
};

const ClusterTab = ({ recaptchaRef, initialExchangeId }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const exchangeIdFromQuery = searchParams.get("exchangeId") || initialExchangeId;
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
  const [nametags, setNametags] = useState({});
  const [toggledTokens, setToggledTokens] = useState({});
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
        toast.error(`Failed to load BTC price: ${err.message}`, { position: "top-center", autoClose: 3000 });
      } finally {
        setIsLoadingBtcPrice(false);
      }
    };
    fetchBtcPrice();
  }, []);

  useEffect(() => {
    if (exchangeIdFromQuery) {
      const mappedId = mapExchangeId(exchangeIdFromQuery);
      fetchExchangeData(mappedId);
      fetchVolumeHistory(mappedId);
      fetchPortfolioAndWallets(exchangeIdFromQuery);
    }
  }, [exchangeIdFromQuery, currency]);

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
      fetchTransactions(walletData, 1000000); // Apply minValueUsd for Large Transactions
      fetchNametags(walletData.map((w) => w.holder_address).filter(Boolean));
    }
  }, [walletData]);

  useEffect(() => {
    if (portfolioData.length > 0) {
      const uniqueTokens = [...new Set(portfolioData.map((item) => item.token_id))];
      Promise.all(
        uniqueTokens.map(async (id) => {
          try {
            const response = await fetch(`/api/coingecko?action=coin-details&id=${id}`, {
              headers: { "Content-Type": "application/json" },
              credentials: "include",
            });
            const result = await response.json();
            if (result.data?.image?.thumb) {
              return [id, result.data.image.thumb];
            }
            return [id, "/fallback-image.png"];
          } catch (err) {
            logger.error(`Error fetching token image for ${id}:`, { error: err.message, stack: err.stack });
            return [id, "/fallback-image.png"];
          }
        }),
      ).then((pairs) => {
        setTokenImages(Object.fromEntries(pairs.filter(([id, img]) => img)));
      });
    }
  }, [portfolioData]);

  useEffect(() => {
    if (selectedWallet) {
      fetchWalletBalances(selectedWallet);
      fetchWalletTransactions(selectedWallet);
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
      setVolumeHistory(
        result.data.map(([timestamp, volume]) => ({
          title: new Date(timestamp).toLocaleDateString(),
          volume: Number(volume) || 0,
        })),
      );
      logger.log("Fetched volume history:", { exchangeId, data: result.data });
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
      if (!result.portfolio || !result.wallets) {
        throw new Error(`No portfolio or wallet data found for exchange: ${exchangeId}`);
      }
      setPortfolioData(result.portfolio || []);
      setWalletData(result.wallets || []);
      logger.log("Fetched portfolio and wallet data:", {
        exchangeId,
        portfolio: result.portfolio,
        wallets: result.wallets,
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
        ? input.map((w) => (typeof w === "string" ? w : w.holder_address)).filter(Boolean)
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

      const response = await fetch(`/api/sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "transactions",
          addresses: [walletAddress],
          limit: 1000, // Match MarketTab's behavior
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
    setIsLoadingWalletBalances(true);
    setWalletBalancesError(null);
    try {
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
      if (!result.success) {
        throw new Error(result.detail || "Failed to fetch wallet balances");
      }
      if (!result.data) {
        throw new Error("No balance data returned");
      }
      setWalletBalances(result.data || []);
      logger.log("Fetched wallet balances:", { walletAddress, data: result.data });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching wallet balances";
      logger.error("Error fetching wallet balances:", { walletAddress, error: errorMessage, stack: err.stack });
      setWalletBalancesError(errorMessage);
      toast.error(`Failed to load wallet balances: ${errorMessage}`, { position: "top-center", autoClose: 3000 });
    } finally {
      setIsLoadingWalletBalances(false);
    }
  };

  const fetchNametags = async (addresses) => {
    try {
      const batchSize = 50;
      const nametagMap = {};
      for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        const response = await fetch("/api/nametags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: batch }),
          credentials: "include",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Failed to fetch nametags");
        for (const [addr, data] of Object.entries(result.data || {})) {
          const dep = data.Labels?.deposit || {};
          nametagMap[addr.toLowerCase()] = {
            name: dep["Name Tag"] || "N/A",
            image: dep.image || "/icons/default.png",
          };
        }
      }
      setNametags(nametagMap);
      logger.log("Fetched nametags:", { addresses, data: nametagMap });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching nametags";
      logger.error("Error fetching nametags:", { error: errorMessage, stack: err.stack });
      toast.error(`Failed to load nametags: ${errorMessage}`, { position: "top-center", autoClose: 3000 });
    }
  };

  const handleSearchSelect = (result) => {
    if (result.type === "exchange" || result.type === "organization") {
      const mappedId = mapExchangeId(result.exchangeId || result.id);
      router.push(`/cluster?exchangeId=${mappedId}`, { scroll: false });
    } else if (result.type === "wallet" || result.type === "nametag") {
      setSelectedWallet(result.address);
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

  const groupedPortfolio = useMemo(() => {
    return portfolioData.reduce((acc, item) => {
      const tokenId = item.token_id || "Unknown";
      if (!acc[tokenId]) {
        acc[tokenId] = {
          token_id: tokenId,
          chains: [],
          total_balance: 0,
          total_value: 0,
          total_percentage: 0,
        };
      }
      const balanceNum = Number(item.total_balance) || 0;
      const valueNum = Number(item.total_balance_usd) || 0;
      const percentageNum = Number(item.percentage) || 0;
      acc[tokenId].chains.push({
        chain: item.chain || "Unknown",
        balance: balanceNum,
        value: valueNum,
        percentage: percentageNum,
      });
      acc[tokenId].total_balance += balanceNum;
      acc[tokenId].total_value += valueNum;
      acc[tokenId].total_percentage += percentageNum;
      return acc;
    }, {});
  }, [portfolioData]);

  const chains = useMemo(() => {
    return Object.entries(chainLogos).map(([value, image]) => ({
      value: value.toLowerCase(),
      label: CHAIN_ID_TO_NAME[value.toLowerCase()] || value,
      image,
    }));
  }, [chainLogos]);

  const renderPortfolioContent = () => {
    return (
      <div className="overflow-y-auto max-h-[calc(50vh-5rem)] hide-scrollbar">
        <LoadingOverlay isLoading={isLoadingPortfolio} isMobile={isMobile} />
        {isLoadingPortfolio ? (
          <SkeletonLoader count={5} isMobile={isMobile} />
        ) : Object.keys(groupedPortfolio).length > 0 ? (
          <table className="w-full text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className="px-2 py-1 text-white text-left font-semibold ml-2">Token</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Chain</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Balance</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Value ({currency.toUpperCase()})</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Percentage</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(groupedPortfolio).map((group, index) => (
                <React.Fragment key={group.token_id}>
                  <motion.tr
                    className={`border-t border-white/10 hover:bg-white/5 ${group.chains.length > 1 ? "cursor-pointer" : ""}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                    onClick={() =>
                      group.chains.length > 1 &&
                      setToggledTokens((prev) => ({
                        ...prev,
                        [group.token_id]: !prev[group.token_id],
                      }))
                    }
                  >
                    <td className="px-2 py-2 text-white">
                      <img
                        src={tokenImages[group.token_id] || "/fallback-image.png"}
                        alt={`${group.token_id} logo`}
                        className="w-4 h-4 inline mr-2 rounded-full"
                        onError={(e) => (e.target.src = "/fallback-image.png")}
                      />
                      {group.token_id}
                    </td>
                    <td className="px-2 py-2 text-white">
                      {group.chains.length > 1 ? (
                        `Multiple (${group.chains.length})`
                      ) : (
                        <>
                          <img
                            src={chainLogos[group.chains[0]?.chain?.toLowerCase()] || "/fallback-image.png"}
                            alt={`${group.chains[0]?.chain || "Unknown"} logo`}
                            className="w-4 h-4 inline mr-2 rounded-full"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                          {/* {group.chains[0]?.chain || "Unknown"} */}
                        </>
                      )}
                    </td>
                    <td className="px-2 py-2 text-white">
                      {group.total_balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-2 text-white">{formatPrice(group.total_value, currency, 2)}</td>
                    <td className="px-2 py-2 text-white">{(group.total_percentage * 100).toFixed(2)}%</td>
                  </motion.tr>
                  <AnimatePresence>
                    {toggledTokens[group.token_id] && (
                      <motion.tr
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <td colSpan={5} className="p-0">
                          <table className="w-full text-[8px] sm:text-[10px] bg-white/5">
                            <thead>
                              <tr className="border-b border-white/10">
                                <th className="px-4 py-1 text-white text-left font-semibold">Chain</th>
                                <th className="px-4 py-1 text-white text-left font-semibold">Balance</th>
                                <th className="px-4 py-1 text-white text-left font-semibold">Value</th>
                                <th className="px-4 py-1 text-white text-left font-semibold">Percentage</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.chains.map((ch, idx) => (
                                <tr key={idx} className="border-t border-white/10">
                                  <td className="px-4 py-2 text-white">
                                    <img
                                      src={chainLogos[ch.chain?.toLowerCase()] || "/fallback-image.png"}
                                      alt={`${ch.chain || "Unknown"} logo`}
                                      className="w-4 h-4 inline mr-2 rounded-full"
                                      onError={(e) => (e.target.src = "/fallback-image.png")}
                                    />
                                    {ch.chain || "Unknown"}
                                  </td>
                                  <td className="px-4 py-2 text-white">
                                    {ch.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-2 text-white">{formatPrice(ch.value, currency, 2)}</td>
                                  <td className="px-4 py-2 text-white">{(ch.percentage * 100).toFixed(2)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </motion.tr>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[10px] sm:text-xs text-white/60 text-center">No portfolio data available.</p>
        )}
      </div>
    );
  };

  const renderWalletsContent = () => {
    return (
      <div className="overflow-y-auto max-h-[calc(50vh-5rem)] hide-scrollbar">
        <LoadingOverlay isLoading={isLoadingWallets} isMobile={isMobile} />
        {isLoadingWallets ? (
          <SkeletonLoader count={5} isMobile={isMobile} />
        ) : walletData.length > 0 ? (
          <table className="w-full text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className="px-2 py-1 text-white text-left font-semibold">Wallet Address</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Name Tag</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Value ({currency.toUpperCase()})</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Percentage</th>
              </tr>
            </thead>
            <tbody>
              {walletData.map((wallet, index) => {
                const addr = wallet.holder_address?.toLowerCase();
                const ntag = nametags[addr] || { name: wallet.name_tag || "N/A", image: "/fallback-image.png" };
                return (
                  <motion.tr
                    key={index}
                    className="border-t border-white/10 hover:bg-white/5"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                  >
                    <td className="px-2 py-2 text-white">
                      <div className="flex items-center gap-2 group relative">
                        <button
                          onClick={() => handleWalletClick(wallet.holder_address)}
                          className="text-white hover:text-white/80"
                        >
                          {truncateAddress(wallet.holder_address).text}
                        </button>
                        <motion.button
                          onClick={() => {
                            navigator.clipboard.writeText(wallet.holder_address);
                            toast.success("Address copied!", { autoClose: 2000 });
                          }}
                          className="absolute right-0 text-white/40 hover:text-white/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10"
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
                        src={ntag.image}
                        alt="Wallet logo"
                        className="w-4 h-4 inline mr-2 rounded-full"
                        onError={(e) => (e.target.src = "/fallback-image.png")}
                      />
                      {ntag.name}
                    </td>
                    <td className="px-2 py-2 text-white">{formatPrice(Number(wallet.balance_usd) || 0, currency, 2)}</td>
                    <td className="px-2 py-2 text-white">{(Number(wallet.percentage) * 100).toFixed(2)}%</td>
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
                <th className="px-2 py-1 text-white text-left font-semibold">Chain</th>
                <th className="px-2 py-1 text-white text-left font-semibold">From</th>
                <th className="px-2 py-1 text-white text-left font-semibold">To</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Value ({currency.toUpperCase()})</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Time</th>
                <th className="px-2 py-1 text-white text-left font-semibold">Hash</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, index) => {
                const fromNtag = nametags[tx.from?.toLowerCase()] || { name: "N/A", image: "/fallback-image.png" };
                const toNtag = nametags[tx.to?.toLowerCase()] || { name: "N/A", image: "/fallback-image.png" };
                const chain = typeof tx.chain === "string" ? tx.chain.toLowerCase() : "ethereum";
                const { txUrl } = getExplorerUrls(chain, tx.hash || "", "");
                return (
                  <motion.tr
                    key={index}
                    className="border-t border-white/10 hover:bg-white/5"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                  >
                    <td className="px-2 py-2 text-white">
                      <img
                        src={chainLogos[chain] || "/fallback-image.png"}
                        alt={`${tx.chain || "Unknown"} logo`}
                        className="w-4 h-4 inline mr-2 rounded-full"
                        onError={(e) => (e.target.src = "/fallback-image.png")}
                      />
                      {/* {tx.chain || "Unknown"} */}
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
                          className="text-white hover:text-white/80"
                        >
                          {fromNtag.name !== "N/A" ? fromNtag.name : truncateAddress(tx.from).text}
                        </button>
                        <motion.button
                          onClick={() => {
                            navigator.clipboard.writeText(tx.from);
                            toast.success("Address copied!", { autoClose: 2000 });
                          }}
                          className="absolute right-0 text-white/40 hover:text-white/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10"
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
                          className="text-white hover:text-white/80"
                        >
                          {toNtag.name !== "N/A" ? toNtag.name : truncateAddress(tx.to).text}
                        </button>
                        <motion.button
                          onClick={() => {
                            navigator.clipboard.writeText(tx.to);
                            toast.success("Address copied!", { autoClose: 2000 });
                          }}
                          className="absolute right-0 text-white/40 hover:text-white/80 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10"
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
                      {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : "N/A"}
                    </td>
                    <td className="px-2 py-2 text-white">
                      <motion.a
                        href={txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                      >
                        <img
                          src="/logos/etherscan-logo.png"
                          alt="Explorer"
                          className="w-4 h-4"
                          onError={(e) => (e.target.src = "/fallback-image.png")}
                        />
                      </motion.a>
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
      className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-4 bg-black/80 flex flex-col h-[calc(100vh-3rem)]"
    >
      <div className="w-full mb-4">
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
                <div className="flex items-center gap-2 mb-4">
                  <img
                    src={exchangeData.image || "/fallback-image.png"}
                    alt={`${exchangeData.name} logo`}
                    className="w-6 sm:w-8 h-6 sm:h-8 rounded-full"
                    onError={(e) => (e.target.src = "/fallback-image.png")}
                  />
                  <h4 className="text-base sm:text-lg font-bold text-white">{exchangeData.name}</h4>
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
                    tickFormatter={(value) => `${currency.toUpperCase()} ${Math.floor(value).toLocaleString("en-US")}`}
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
            <div className="p-4 border-b border-white/10 bg-white/5 flex gap-4">
              <button
                onClick={() => setActiveTab("portfolio")}
                className={`text-xs font-bold text-white uppercase tracking-wider pb-2 ${activeTab === "portfolio" ? "border-b-2 border-white" : ""}`}
              >
                Portfolio
              </button>
              <button
                onClick={() => setActiveTab("wallets")}
                className={`text-xs font-bold text-white uppercase tracking-wider pb-2 ${activeTab === "wallets" ? "border-b-2 border-white" : ""}`}
              >
                Wallets
              </button>
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
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Large Transactions (&gt;{formatPrice(1000000, currency, 0)})
              </h4>
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
          nameTags={nametags}
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