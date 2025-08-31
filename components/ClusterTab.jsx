"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
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

const BITCOIN_LOGO = "/logos/bitcoin.png";

const isDev = process.env.NODE_ENV === "development";
const logger = {
  log: (message, data) => {
    if (isDev) {
      console.log(message, data);
    }
  },
  error: (message, data) => {
    console.error(message, data);
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
  const { data: session, status } = useSession();
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
        // Suppress toast for non-critical error
        // toast.error(`Failed to load BTC price: ${err.message}`, { position: "top-center", autoClose: 3000 });
      } finally {
        setIsLoadingBtcPrice(false);
      }
    };
    fetchBtcPrice();
  }, []);

  useEffect(() => {
    const mappedId = mapExchangeId(exchangeIdFromQuery);
    fetchExchangeData(exchangeIdFromQuery, mappedId);
    if (btcPrice) {
      fetchVolumeHistory(mappedId);
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
        // Suppress toast for non-critical error
        // toast.error(`Failed to load chain logos: ${err.message}`, { position: "top-center", autoClose: 3000 });
      }
    };
    fetchChainLogos();
  }, []);

  useEffect(() => {
    if (status === "authenticated" && walletData.length > 0) {
      const evmWallets = walletData.filter((w) => w.chain?.toLowerCase() !== "bitcoin");
      fetchTransactions(evmWallets, 1000000);
    }
  }, [walletData, status]);

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

            // Check cache first
            const cacheResponse = await fetch(`/api/cache?key=coingecko_token_details_${address}`, {
              headers: { "Content-Type": "application/json" },
              credentials: "include",
            });
            const cacheResult = await cacheResponse.json();
            if (cacheResponse.ok && cacheResult.success && cacheResult.data) {
              logger.log(`Cache hit for token details: ${address}`);
              return [address, cacheResult.data];
            }

            // Fetch from CoinGecko
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
            // Return fallback data to prevent UI breakage
            return [
              address,
              {
                image: { thumb: "/fallback-image.png" },
                symbol: address.slice(0, 6).toUpperCase(), // Use first 6 chars as fallback symbol
              },
            ];
          }
        }),
      ).then((pairs) => {
        const images = {};
        const symbols = {};
        pairs.forEach(([address, data]) => {
          images[address] = data.image?.thumb || data.image || "/fallback-image.png";
          symbols[address] = data.symbol?.toUpperCase() || address.slice(0, 6).toUpperCase();
        });
        setTokenImages(images);
        setTokenSymbols(symbols);
        logger.log("Updated token images and symbols:", { images, symbols });
      });
    }
  }, [portfolioData]);

  useEffect(() => {
    if (status === "authenticated" && selectedWallet) {
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
  }, [selectedWallet, status]);

  const fetchExchangeData = async (originalId, mappedId) => {
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
      setExchangeData(result.data);
      logger.log("Fetched exchange data:", { mappedId, data: result.data });
    } catch (err) {
      const fallback = {
        name: originalId.charAt(0).toUpperCase() + originalId.slice(1),
        image: `/icons/${originalId.toLowerCase()}.png`,
        country: "N/A",
        year_established: "N/A",
        trust_score: "N/A",
        trade_volume_24h_btc: 0,
        centralized: true,
        twitter_handle: null,
        url: null,
      };
      setExchangeData(fallback);
      const errorMessage = err.message || "Unknown error fetching exchange data";
      logger.error("Error fetching exchange data:", { originalId, mappedId, error: errorMessage, stack: err.stack });
      setError(errorMessage); // Set error for UI display
    } finally {
      setIsLoadingExchange(false);
    }
  };

  const fetchVolumeHistory = async (exchangeId) => {
    if (!btcPrice) {
      logger.warn("BTC price not available, skipping volume history fetch", { exchangeId });
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
      setVolumeHistory(convertedData);
      logger.log("Fetched volume history:", { exchangeId, btcPrice, convertedData });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching volume history";
      logger.error("Error fetching volume history:", { exchangeId, error: errorMessage, stack: err.stack });
      setVolumeHistory([]); // Ensure empty state for chart
      setError(errorMessage); // Set error for UI display
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
      setPortfolioData([]);
      setWalletData([]);
      setError(errorMessage); // Set error for UI display
    } finally {
      setIsLoadingPortfolio(false);
      setIsLoadingWallets(false);
    }
  };

  const fetchTransactions = async (input, minValueUsd = null) => {
    if (status !== "authenticated") {
      setTransactionsError("Please log in to access transaction data.");
      setIsLoadingTransactions(false);
      return;
    }
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

      logger.log("Starting fetchTransactions", { walletAddresses, requestBody });

      const response = await fetch(`/api/sim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
        },
        credentials: "include",
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(50000), // Add timeout
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMessage = `Failed to fetch transactions: ${response.status} ${response.statusText}`;
        try {
          const result = JSON.parse(text);
          errorMessage = result.detail || errorMessage;
        } catch {
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

        // Bỏ qua dấu '[' đầu tiên nếu là chunk đầu
        if (isFirstChunk) {
          buffer = buffer.trim().replace(/^\[/, '');
          isFirstChunk = false;
        }

        // Xử lý từng object hoàn chỉnh trong buffer
        let pos = 0;
        while (pos < buffer.length) {
          // Bỏ qua khoảng trắng, dấu phẩy, và các ký tự không liên quan
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
                console.warn(`Failed to parse object: ${parseError.message}`, { objStr });
              }
            } else {
              // Object chưa hoàn chỉnh, giữ lại phần còn lại của buffer
              break;
            }
          } else {
            // Nếu không phải object, có thể là lỗi, bỏ qua
            pos++;
          }
        }

        // Cập nhật buffer với phần còn lại chưa parse
        buffer = buffer.slice(pos).trim();
      }

      // Xử lý buffer cuối nếu có
      if (buffer) {
        buffer = buffer.replace(/\]$/, '').trim(); // Bỏ dấu ']' cuối nếu có
        if (buffer.startsWith('{')) {
          try {
            const parsed = JSON.parse(buffer);
            if (!parsed.detail) {
              transactionsData.push(parsed);
            } else {
              throw new Error(parsed.detail);
            }
          } catch (e) {
            console.error(`Error parsing final buffer: ${e.message}`, { buffer });
          }
        }
      }

      logger.log("Parsed transactions data:", { transactionsData });
      setTransactions(transactionsData);
      logger.log("Fetched transactions:", { walletAddresses, minValueUsd, data: transactionsData });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching transactions";
      logger.error("Error fetching transactions:", { input, minValueUsd, error: errorMessage, stack: err.stack });
      setTransactions([]);
      setTransactionsError(errorMessage);
      toast.error(errorMessage, { position: "top-center", autoClose: 3000 });
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  const fetchWalletTransactions = async (walletAddress) => {
    if (status !== "authenticated") {
      setWalletTransactionsError("Please log in to access wallet transactions.");
      setIsLoadingWalletTransactions(false);
      return;
    }
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
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
        },
        credentials: "include",
        body: JSON.stringify({
          action: "transactions",
          addresses: [walletAddress],
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

        // Bỏ qua dấu '[' đầu tiên nếu là chunk đầu
        if (isFirstChunk) {
          buffer = buffer.trim().replace(/^\[/, '');
          isFirstChunk = false;
        }

        // Xử lý từng object hoàn chỉnh trong buffer
        let pos = 0;
        while (pos < buffer.length) {
          // Bỏ qua khoảng trắng, dấu phẩy, và các ký tự không liên quan
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
                console.warn(`Failed to parse object: ${parseError.message}`, { objStr });
              }
            } else {
              // Object chưa hoàn chỉnh, giữ lại phần còn lại của buffer
              break;
            }
          } else {
            // Nếu không phải object, có thể là lỗi, bỏ qua
            pos++;
          }
        }

        // Cập nhật buffer với phần còn lại chưa parse
        buffer = buffer.slice(pos).trim();
      }

      // Xử lý buffer cuối nếu có
      if (buffer) {
        buffer = buffer.replace(/\]$/, '').trim(); // Bỏ dấu ']' cuối nếu có
        if (buffer.startsWith('{')) {
          try {
            const parsed = JSON.parse(buffer);
            if (!parsed.detail) {
              transactionsData.push(parsed);
            } else {
              throw new Error(parsed.detail);
            }
          } catch (e) {
            console.error(`Error parsing final buffer: ${e.message}`, { buffer });
          }
        }
      }

      logger.log("Parsed wallet transactions data:", { transactionsData });
      setWalletTransactions(transactionsData);
      logger.log("Fetched wallet transactions:", { walletAddress, data: transactionsData });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching wallet transactions";
      logger.error("Error fetching wallet transactions:", { walletAddress, error: errorMessage, stack: err.stack });
      setWalletTransactions([]);
      setWalletTransactionsError(errorMessage);
    } finally {
      setIsLoadingWalletTransactions(false);
    }
  };

  const fetchWalletBalances = async (walletAddress) => {
    if (status !== "authenticated") {
      setWalletBalancesError("Please log in to access wallet balances.");
      setIsLoadingWalletBalances(false);
      return;
    }
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
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
        },
        credentials: "include",
        body: JSON.stringify({
          action: "wallet-balances",
          address: walletAddress,
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

        // Bỏ qua dấu '[' đầu tiên nếu là chunk đầu
        if (isFirstChunk) {
          buffer = buffer.trim().replace(/^\[/, '');
          isFirstChunk = false;
        }

        // Xử lý từng object hoàn chỉnh trong buffer
        let pos = 0;
        while (pos < buffer.length) {
          // Bỏ qua khoảng trắng, dấu phẩy, và các ký tự không liên quan
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
                console.warn(`Failed to parse object: ${parseError.message}`, { objStr });
              }
            } else {
              // Object chưa hoàn chỉnh, giữ lại phần còn lại của buffer
              break;
            }
          } else {
            // Nếu không phải object, có thể là lỗi, bỏ qua
            pos++;
          }
        }

        // Cập nhật buffer với phần còn lại chưa parse
        buffer = buffer.slice(pos).trim();
      }

      // Xử lý buffer cuối nếu có
      if (buffer) {
        buffer = buffer.replace(/\]$/, '').trim(); // Bỏ dấu ']' cuối nếu có
        if (buffer.startsWith('{')) {
          try {
            const parsed = JSON.parse(buffer);
            if (!parsed.detail) {
              balancesData.push(parsed);
            } else {
              throw new Error(parsed.detail);
            }
          } catch (e) {
            console.error(`Error parsing final buffer: ${e.message}`, { buffer });
          }
        }
      }

      logger.log("Parsed wallet balances data:", { balancesData });
      setWalletBalances(balancesData);
      logger.log("Fetched wallet balances:", { walletAddress, data: balancesData });
    } catch (err) {
      const errorMessage = err.message || "Unknown error fetching wallet balances";
      logger.error("Error fetching wallet balances:", { walletAddress, error: errorMessage, stack: err.stack });
      setWalletBalances([]);
      setWalletBalancesError(errorMessage);
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
          key: `${addr}-${index}`,
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
      const metadataChains = new Set(
        (item.metadata || []).map((token) => token.chain?.toLowerCase()).filter(Boolean),
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

  const truncateAddressWithHover = (address, nameTag) => {
    const truncated = truncateAddress(address).text;
    return (
      <div className="flex items-center gap-2 group relative">
        <span className="truncate">{nameTag !== "N/A" ? nameTag : truncated}</span>
        <motion.button
          onClick={(e) => {
            e.stopPropagation(); // Prevent click from bubbling up to parent
            navigator.clipboard.writeText(address);
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
    );
  };

  const renderPortfolioContent = () => {
    return (
      <div className="flex flex-col" ref={portfolioRef}>
        <div className="overflow-y-auto max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] hide-scrollbar">
          <LoadingOverlay isLoading={isLoadingPortfolio} isMobile={isMobile} />
          {isLoadingPortfolio ? (
            <SkeletonLoader count={5} isMobile={isMobile} />
          ) : groupedPortfolio.length > 0 ? (
            <table className="w-full table-fixed text-[8px] sm:text-[10px]">
              <thead className="border-b border-white/10 bg-black/5">
                <tr>
                  <th className={`${isMobile ? "w-[20%]" : "w-[25%]"} px-2 py-1 text-white text-left font-semibold ml-2 m-1 truncate`}>Token</th>
                  <th className={`${isMobile ? "w-[30%]" : "w-[25%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>Balance</th>
                  <th className={`${isMobile ? "w-[30%]" : "w-[25%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>Value ({currency.toUpperCase()})</th>
                  <th className={`${isMobile ? "w-[20%]" : "w-[25%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {groupedPortfolio.map((group, index) => (
                  <motion.tr
                    key={group.key}
                    className="border-t border-white/10 hover:bg-white/5 transition-all duration-300"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                  >
                    <td className="px-2 py-2 text-white truncate">
                      <img
                        src={group.logo || (group.token_address === "bitcoin" ? BITCOIN_LOGO : "/fallback-image.png")}
                        alt={`${group.symbol} logo`}
                        className="w-4 h-4 inline mr-2 rounded-full"
                        onError={(e) => (e.target.src = "/fallback-image.png")}
                      />
                      {group.symbol || (group.token_address === "bitcoin" ? "BTC" : group.token_address)}
                    </td>
                    <td className="px-2 py-2 text-white truncate">
                      <span className="font-semibold">{group.total_balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                    </td>
                    <td className="px-2 py-2 text-white truncate">
                      <span className="font-semibold">{formatPrice(group.total_balance_usd || 0, currency, 2)}</span>
                    </td>
                    <td className="px-2 py-2 text-white truncate">
                      <span className="font-semibold">{group.percentage.toFixed(2)}%</span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[10px] sm:text-xs text-white/60 text-center">No portfolio data available for this exchange.</p>
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
      <div className="overflow-y-auto max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] hide-scrollbar">
        <LoadingOverlay isLoading={isLoadingWallets} isMobile={isMobile} />
        {isLoadingWallets ? (
          <SkeletonLoader count={5} isMobile={isMobile} />
        ) : uniqueWalletData.length > 0 ? (
          <table className="w-full table-fixed text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-black/5">
              <tr>
                <th className={`${isMobile ? "w-[50%]" : "w-[60%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>Wallet</th>
                <th className={`${isMobile ? "w-[30%]" : "w-[20%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>Value ({currency.toUpperCase()})</th>
                <th className={`${isMobile ? "w-[20%]" : "w-[20%]"}-2 py-1 text-white text-left font-semibold m-1 truncate`}>Percentage</th>
              </tr>
            </thead>
            <tbody>
              {uniqueWalletData.map((wallet, index) => {
                const percentage = totalValue > 0 ? ((Number(wallet.total_value_usd) || 0) / totalValue) * 100 : 0;
                const isBitcoinAddress = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(wallet.holder_address);
                return (
                  <motion.tr
                    key={wallet.key}
                    className="border-t border-white/10 hover:bg-white/5 transition-all duration-300"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                  >
                    <td className="px-2 py-2 text-white truncate">
                      <div className="flex items-center gap-2">
                        {isBitcoinAddress && (
                          <img
                            src={BITCOIN_LOGO}
                            alt="Bitcoin logo"
                            className="w-4 h-4 inline rounded-full"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                        )}
                        <img
                          src={wallet.image}
                          alt="Wallet logo"
                          className="w-4 h-4 inline mr-2 rounded-full"
                          onError={(e) => (e.target.src = "/fallback-image.png")}
                        />
                        <button
                          onClick={() => handleWalletClick(wallet.holder_address)}
                          className="text-white hover:text-white/80 no-hover-effect truncate"
                        >
                          {truncateAddressWithHover(wallet.holder_address, wallet.name_tag)}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-white truncate">
                      <span className="font-semibold">{formatPrice(Number(wallet.total_value_usd) || 0, currency, 2)}</span>
                    </td>
                    <td className="px-2 py-2 text-white truncate">
                      <span className="font-semibold">{percentage.toFixed(2)}%</span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-[10px] sm:text-xs text-white/60 text-center">No wallet data available for this exchange.</p>
        )}
      </div>
    );
  };

  const renderTransactionsContent = () => {
    if (status !== "authenticated") {
      return <LoginPrompt />;
    }
    logger.log("Rendering transactions:", { transactions, transactionsError, isLoadingTransactions });
    return (
      <div className="overflow-y-auto max-h-[calc(50vh)] sm:max-h-[calc(50vh-5rem)] hide-scrollbar">
        <LoadingOverlay isLoading={isLoadingTransactions} isMobile={isMobile} />
        {isLoadingTransactions ? (
          <SkeletonLoader count={5} isMobile={isMobile} />
        ) : transactionsError ? (
          <p className="text-[10px] sm:text-xs text-red-400 text-center p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
            Error: {transactionsError}
          </p>
        ) : transactions.length > 0 ? (
          <table className="w-full table-fixed text-[8px] sm:text-[10px]">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className={`${isMobile ? "w-[20%]" : "w-[15%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>Token</th>
                <th className={`${isMobile ? "w-[35%]" : "w-[40%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>From/To</th>
                <th className={`${isMobile ? "w-[20%]" : "w-[15%]"} px-2 py-1 text-white text-center font-semibold m-1 truncate`}>Token Value</th>
                <th className={`${isMobile ? "w-[15%]" : "w-[15%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>Value ({currency.toUpperCase()})</th>
                <th className={`${isMobile ? "w-[10%]" : "w-[15%]"} px-2 py-1 text-white text-left font-semibold m-1 truncate`}>Details</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, index) => {
                logger.log("Processing transaction:", { tx, index });
                const chainName = typeof tx.chain === "string" ? tx.chain.toLowerCase() : (tx.chain_id || "unknown").toString().toLowerCase();
                if (chainName === "bitcoin") return null;

                const fromWallet = uniqueWalletData.find((w) => w.holder_address?.toLowerCase() === tx.from?.toLowerCase()) || {};
                const toWallet = uniqueWalletData.find((w) => w.holder_address?.toLowerCase() === tx.to?.toLowerCase()) ||

                  {};
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
                const tokenSymbol = tx.token_metadata?.symbol || tx.token || "Unknown";
                const typeDisplay = tx.type ? tx.type.charAt(0).toUpperCase() + tx.type.slice(1) : "Other";
                let displayValue = Number(tx.value || 0).toLocaleString("en-US", { maximumFractionDigits: 1 });
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
                    className="border-t border-white/10 hover:bg-white/5 transition-all duration-300"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                  >
                    <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] truncate">
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
                        <span className="truncate">{tokenSymbol}</span>
                      </div>
                    </td>
                    <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] truncate">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 group relative">
                          <img
                            src={fromNtag.image}
                            alt="From wallet logo"
                            className="w-3 h-3 inline rounded-full"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                          <button
                            onClick={() => handleWalletClick(tx.from)}
                            className="text-white hover:text-white/80 no-hover-effect truncate"
                          >
                            {truncateAddressWithHover(tx.from, fromNtag.name)}
                          </button>
                        </div>
                        <div className="flex items-center gap-2 group relative">
                          <img
                            src={toNtag.image}
                            alt="To wallet logo"
                            className="w-3 h-3 inline rounded-full"
                            onError={(e) => (e.target.src = "/fallback-image.png")}
                          />
                          <button
                            onClick={() => handleWalletClick(tx.to)}
                            className="text-white hover:text-white/80 no-hover-effect truncate"
                          >
                            {truncateAddressWithHover(tx.to, toNtag.name)}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center truncate">
                      juxtapose
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
                        <span className="truncate font-semibold">{displayValue}</span>
                      </div>
                    </td>
                    <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] truncate">
                      <span className="font-semibold">{formatPrice(Number(tx.value_usd) || 0, currency, 2)}</span>
                    </td>
                    <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] truncate">
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
                        <span className="text-[8px] sm:text-[9px] text-white/60 truncate">
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
          <p className="text-[10px] sm:text-xs text-white/60 text-center">No large transactions available for this exchange.</p>
        )
        }
      </div >
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
          Unable to load data. Please try again later.
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
              <p className="text-[10px] sm:text-xs text-white/60 text-center">No exchange data available. Please select another exchange.</p>
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
              <p className="text-[10px] sm:text-xs text-white/60 text-center">No volume data available for this exchange.</p>
            )}
          </div>
        </motion.div>

        <div className="flex flex-col md:flex-row gap-4 flex-1">
          <motion.div
            className="flex-1 border border-white/10 rounded-xl bg-white/5 flex flex-col"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="p-0 border-b border-white/10 bg-black/5 flex gap-4 items-end h-[48px]">
              <motion.button
                onClick={() => setActiveTab("portfolio")}
                className={`text-xs font-bold text-white uppercase tracking-wider px-4 py-2 no-hover-effect flex items-center ${activeTab === "portfolio" ? "border-b-2 border-white" : "text-white/80 hover:text-white"}`}
                whileHover={{ scale: 1.05 }}
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2V12H2C2 6.47715 6.47715 2 12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12H12V2C17.5228 2 22 6.47715 22 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Portfolio
              </motion.button>
              <motion.button
                onClick={() => setActiveTab("wallets")}
                className={`text-xs font-bold text-white uppercase tracking-wider px-4 py-2 no-hover-effect flex items-center ${activeTab === "wallets" ? "border-b-2 border-white" : "text-white/80 hover:text-white"}`}
                whileHover={{ scale: 1.05 }}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Wallets
              </motion.button>
            </div>
            {activeTab === "portfolio" ? renderPortfolioContent() : renderWalletsContent()}
          </motion.div>

          <motion.div
            className="flex-1 border border-white/10 rounded-xl bg-white/5 flex flex-col"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <div className="p-3.5 border-b border-white/10 bg-black/5 flex items-center">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
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
              image: w.image || (w.chains?.includes("bitcoin") ? BITCOIN_LOGO : "/fallback-image.png"),
            },
          }), {})}
          isMobile={isMobile}
          chainLogos={chainLogos} // Pass chainLogos state
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