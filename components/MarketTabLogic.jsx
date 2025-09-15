'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import debounce from 'lodash.debounce';
import rateLimit from 'axios-rate-limit';
import pLimit from 'p-limit';
import { GECKOTERMINAL_CHAIN_MAPPING, SUPPORTED_CHAINS, CHAIN_MAPPING } from '../utils/constants';
import btcTopHolders from '../public/nametags/bitcoin-top-holders.json';
import btcNameTags from '../public/nametags/btc-top-holders.json';
import bnbNameTags from '../public/nametags/bnb-top-holders.json';
import ethNameTags from '../public/nametags/eth-top-holders.json';
import dogeNameTags from '../public/nametags/dogecoin-top-holders.json';
import ltcNameTags from '../public/nametags/litecoin-top-holders.json';
import useSWR from 'swr';
import Bottleneck from 'bottleneck';
import axiosRetry from 'axios-retry';

const axiosWithRetry = axios.create();
axiosRetry(axiosWithRetry, {
  retries: 5,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 1000 + Math.random() * 100,
  retryCondition: (error) =>
    error.response?.status === 429 ||
    error.response?.status === 503 ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ERR_NETWORK',
});

const cacheLimiter = new Bottleneck({
  maxConcurrent: 15,
  minTime: 200,
  reservoir: 500,
  reservoirRefreshAmount: 500,
  reservoirRefreshInterval: 60 * 1000,
});

const coingeckoAxios = rateLimit(axios.create(), {
  maxRequests: 60,
  perMilliseconds: 60000,
});

axiosRetry(coingeckoAxios, {
  retries: 3,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 1000 + Math.random() * 100, // Exponential backoff with jitter
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
});

const fetcher = async (url, params) => {
  const response = await axios.get(url, { params });
  if (!response.data.success) {
    throw new Error(response.data.detail || 'Failed to fetch market data');
  }
  // Handle streaming response
  if (response.data instanceof ReadableStream) {
    const text = await new Response(response.data).text();
    const parsed = JSON.parse(text);
    if (!parsed.success) {
      throw new Error(parsed.detail || 'Failed to parse market data');
    }
    return parsed.data;
  }
  return response.data.data;
};

// Cache durations
const CACHE_DURATIONS = {
  PRICE: 5 * 60 * 1000,
  METADATA: 4 * 60 * 60 * 1000,
  TRANSACTIONS: 10 * 60 * 1000,
  DEFI_POOL: 4 * 60 * 60 * 1000,
  DEFAULT: 4 * 60 * 60 * 1000,
  TICKERS: 4 * 60 * 60 * 1000,
  TRENDING: 5 * 60 * 60 * 1000,
  NAMETAGS: 48 * 60 * 60 * 1000,
  TOP_HOLDERS: 12 * 60 * 60 * 1000, // 12 h
};

const MEMPOOL_POLLING_INTERVAL = 60 * 1000;

if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === 'production') {
  console.warn('NEXT_PUBLIC_APP_URL is not set, defaulting to https://xynapse-ai.vercel.app');
}

const NON_EVM_CHAINS = ['bitcoin', 'ethereum', 'dogecoin', 'litecoin'];
const BLOCKCHAIR_REQUEST_LIMIT = 60; // Limit of 30 requests per minute
const BLOCKCHAIR_REQUEST_WINDOW = 60 * 1000; // 1 minute
const blockchairRequestTracker = new Map();
const DEX_REQUEST_LIMIT = 50; // Max 5 requests per minute
const DEX_REQUEST_WINDOW = 5 * 60 * 1000; // 1 minute
const dexRequestTracker = new Map();
const limit = pLimit(60);

const COINGECKO_API_KEY = process.env.NEXT_PUBLIC_COINGECKO_API_KEY || '';
const NAME_TAG_CACHE_DURATION = 24 * 60 * 60 * 1000;
const WALLET_SEARCH_LIMIT = 10;
const WALLET_SEARCH_WINDOW = 60 * 1000;
const tokensPerPage = 30;

export const useMarketTabLogic = ({ recaptchaRef, toast, initialTokenSlug, initialTokenData }) => {
  const { data: session, status } = useSession();
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingSelectedToken, setIsLoadingSelectedToken] = useState(false);
  const [error, setError] = useState(null);
  const [selectedToken, setSelectedToken] = useState(initialTokenData || null);
  const [selectedPair, setSelectedPair] = useState(
    initialTokenData ? `${initialTokenData.symbol?.toUpperCase()}/USD` : 'BTC/USD'
  );
  const [selectedChain, setSelectedChain] = useState('ethereum');
  const [analysis, setAnalysis] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [priceHistoryCache, setPriceHistoryCache] = useState({});
  const [timeRange, setTimeRange] = useState('1');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [analysisLinks, setAnalysisLinks] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [onChainData, setOnChainData] = useState({ topHolders: [], whaleActivity: [] });
  const [activeTab, setActiveTab] = useState('top-holders');
  const [walletAddress, setWalletAddress] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState('ethereum');
  const [isLoadingOnChain, setIsLoadingOnChain] = useState(false);
  const [onChainError, setOnChainError] = useState(null);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [walletBalances, setWalletBalances] = useState([]);
  const [isLoadingWalletBalances, setIsLoadingWalletBalances] = useState(false);
  const [walletBalancesError, setWalletBalancesError] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [transactionsError, setTransactionsError] = useState(null);
  const [walletSearchCount, setWalletSearchCount] = useState(0);
  const [lastWalletSearchTime, setLastWalletSearchTime] = useState(0);
  const [tickerData, setTickerData] = useState([]);
  const [isLoadingTickers, setIsLoadingTickers] = useState(false);
  const [tickerError, setTickerError] = useState(null);
  const [dailyMarketInteractions, setDailyMarketInteractions] = useState(0);
  const [tickerCache, setTickerCache] = useState({});
  const [nameTags, setNameTags] = useState({});
  const lastFetchedTokenRef = useRef(initialTokenSlug || null);
  const [isLoadingNameTags, setIsLoadingNameTags] = useState(false);
  const nameTagsRef = useRef({});
  const prevTopHoldersRef = useRef([]);
  const prevAvailableChainsRef = useRef([]);
  const [chains, setChains] = useState([]);
  const [dexData, setDexData] = useState({ pools: [], trades: [], poolTokens: {} });
  const [isLoadingDex, setIsLoadingDex] = useState(false);
  const [dexError, setDexError] = useState(null);
  const [dexRequestCount, setDexRequestCount] = useState(0);
  const [lastDexRequestTime, setLastDexRequestTime] = useState(0);
  const [lastDexFetchTime, setLastDexFetchTime] = useState(null);
  const [blockchairRequestCount, setBlockchairRequestCount] = useState(0);
  const [lastBlockchairRequestTime, setLastBlockchairRequestTime] = useState(0);
  const blockchairCache = useRef({});
  const [trendingTokens, setTrendingTokens] = useState([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(false);
  const [trendingError, setTrendingError] = useState(null);
  const isFetchingChainsRef = useRef(false);
  const lastFetchedChainsRef = useRef(0);
  const [availableCurrencies] = useState([
    'usd', 'eur', 'cny', 'gbp', 'hkd', 'idr', 'jpy', 'krw', 'mxn', 'myr',
    'nok', 'nzd', 'pln', 'rub', 'sar', 'sek', 'sgd', 'thb', 'try', 'twd',
    'uah', 'vnd'
  ]);
  const [currency, setCurrency] = useState('usd');
  const localCache = useRef({});
  const [analysisLogs, setAnalysisLogs] = useState([]);
  const memoizedLogs = useMemo(() => analysisLogs, [analysisLogs]);
  const [mempoolTransactions, setMempoolTransactions] = useState([]);
  const [isLoadingMempool, setIsLoadingMempool] = useState(false);
  const [mempoolError, setMempoolError] = useState(null);
  const mempoolWsRef = useRef(null);
  const mempoolTxCache = useRef(new Set());

  const isTokenPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/token/');

  const getCachedData = async (key, fetchFn, ttl = CACHE_DURATIONS.DEFAULT, retryCount = 0, requiresSession = false, session = null, status = 'unauthenticated') => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://xynapse-ai.vercel.app';

    // Validate session for session-dependent data
    if (requiresSession && status !== 'authenticated') {
      console.error(`Session required but not authenticated for key: ${key}`);
      throw new Error('Authentication required for this data');
    }

    try {
      // Check local cache first
      const localCached = localCache.current[key];
      if (localCached && Date.now() - localCached.timestamp < ttl) {
        if (Date.now() - localCached.timestamp >= ttl) {
          cacheLimiter.schedule(async () => {
            try {
              const freshData = await fetchFn();
              if (freshData) {
                await axios.post(
                  `${API_BASE_URL}/api/cache`,
                  { key, action: 'set', data: freshData, ttl },
                  { timeout: 30000 }
                );
                localCache.current[key] = { data: freshData, timestamp: Date.now() };
                localCache.current[`${key}_last_update`] = Date.now();
              }
            } catch (error) {
              console.error(`Background cache update failed for ${key}:`, error.message);
            }
          });
        }
        return localCached.data || [];
      }

      // Check Redis cache
      try {
        const cacheResponse = await cacheLimiter.schedule(() =>
          axios.post(
            `${API_BASE_URL}/api/cache`,
            { key, action: 'get' },
            { timeout: 30000 }
          )
        );
        if (cacheResponse.data.success && cacheResponse.data.data) {
          localCache.current[key] = { data: cacheResponse.data.data, timestamp: Date.now() };
          localCache.current[`${key}_last_update`] = Date.now();
          if (Date.now() - (localCache.current[`${key}_last_update`] || 0) > ttl * 0.75) {
            cacheLimiter.schedule(async () => {
              try {
                const freshData = await fetchFn();
                if (freshData) {
                  await axios.post(
                    `${API_BASE_URL}/api/cache`,
                    { key, action: 'set', data: freshData, ttl },
                    { timeout: 30000 }
                  );
                  localCache.current[key] = { data: freshData, timestamp: Date.now() };
                  localCache.current[`${key}_last_update`] = Date.now();
                }
              } catch (error) {
                console.error(`Background cache update failed for ${key}:`, error.message);
              }
            });
          }
          return cacheResponse.data.data || [];
        }
      } catch (cacheError) {
        if (cacheError.response?.status === 429 && retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
          return getCachedData(key, fetchFn, ttl, retryCount + 1, requiresSession, session, status);
        }
        console.error(`Redis cache error for ${key}:`, cacheError.message);
      }

      // Fetch new data if no cache is available
      const data = await fetchFn();
      if (data) {
        await cacheLimiter.schedule(() =>
          axios.post(
            `${API_BASE_URL}/api/cache`,
            { key, action: 'set', data, ttl },
            { timeout: 30000 }
          )
        );
        localCache.current[key] = { data, timestamp: Date.now() };
        localCache.current[`${key}_last_update`] = Date.now();
        return data || [];
      }
      throw new Error(`No data returned for ${key}`);
    } catch (error) {
      if (retryCount < 3 && (error.response?.status === 429 || error.code === 'ECONNABORTED')) {
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return getCachedData(key, fetchFn, ttl, retryCount + 1, requiresSession, session, status);
      }
      console.error(`Cache or fetch error for ${key}:`, error.message);
      throw new Error(`Failed to fetch data for ${key}: ${error.message}`);
    }
  };

  // Cache warmup for trending tokens and top tokens
  const warmUpCache = useCallback(async () => {
    const cacheTrending = async () => {
      const cacheKey = `trending-tokens-${currency}`; // Non-session-dependent
      const fetchFn = async () => {
        const response = await axios.get('/api/coingecko', {
          params: { action: 'trending', vs_currency: currency },
          timeout: 15000,
        });
        if (!response.data.success || !Array.isArray(response.data.data)) {
          throw new Error(`Invalid trending data: ${JSON.stringify(response.data)}`);
        }
        return response.data.data;
      };
      await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TRENDING, 0, false, session, status);
    };

    const cacheTopTokens = async () => {
      const cacheKey = `market-info-default-${currency}`; // Non-session-dependent
      const fetchFn = async () => {
        const response = await axios.get('/api/coingecko', {
          params: { start: 1, limit: tokensPerPage, vs_currencies: currency },
          timeout: 15000,
        });
        if (!response.data.success || !Array.isArray(response.data.data)) {
          throw new Error(`Invalid market data: ${JSON.stringify(response.data)}`);
        }
        return response.data.data;
      };
      await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.DEFAULT, 0, false, session, status);
    };
    await Promise.all([cacheTrending(), cacheTopTokens()]);
  }, [currency, session, status]);


  const executeRecaptcha = useCallback(async (action, retries = 3) => {
    if (process.env.NEXT_PUBLIC_DISABLE_RECAPTCHA === 'true') {
      return 'disabled';
    }
    if (!recaptchaRef.current) {
      throw new Error('reCAPTCHA is not available. Please check the configuration.');
    }
    for (let i = 0; i < retries; i++) {
      try {
        const token = await recaptchaRef.current.executeAsync();
        if (!token) {
          throw new Error('No reCAPTCHA token received.');
        }
        return token;
      } catch (err) {
        console.error(`reCAPTCHA attempt ${i + 1} failed for ${action}: ${err.message}`);
        if (i === retries - 1) {
          throw new Error(`reCAPTCHA verification error after ${retries} attempts: ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }, [recaptchaRef]);


  const fetchSupportedChains = useCallback(async (retryCount = 0) => {
    const cacheKey = 'supported-chains'; // Non-session-dependent
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://xynapse-ai.vercel.app';

    // Check local cache
    const cachedChains = localCache.current[cacheKey]?.data;
    if (cachedChains && Date.now() - localCache.current[cacheKey]?.timestamp < 48 * 60 * 60 * 1000) {
      setChains(cachedChains);
      return;
    }

    if (isFetchingChainsRef.current || (Date.now() - lastFetchedChainsRef.current < 48 * 60 * 60 * 1000 && chains.length > 0)) {
      return;
    }

    isFetchingChainsRef.current = true;

    try {
      const cacheResponse = await cacheLimiter.schedule(() =>
        axios.post(
          `${API_BASE_URL}/api/cache`,
          { key: cacheKey, action: 'get' },
          { timeout: 30000 }
        )
      );
      if (cacheResponse.data.success && cacheResponse.data.data) {
        localCache.current[cacheKey] = { data: cacheResponse.data.data, timestamp: Date.now() };
        setChains(cacheResponse.data.data);
        lastFetchedChainsRef.current = Date.now();
        return;
      }
    } catch (cacheError) {
      console.warn(`Redis cache error for supported chains: ${cacheError.message}`);
    }

    try {
      const response = await coingeckoAxios.get('/api/coingecko/chains', {
        timeout: 20000,
      });

      if (!response.data.success || !Array.isArray(response.data.data)) {
        throw new Error('Invalid or empty chain data from API');
      }

      const coingeckoChains = response.data.data;
      const mappedChains = SUPPORTED_CHAINS.map((simChain) => {
        const coingeckoChain = coingeckoChains.find(
          (cg) => CHAIN_MAPPING[cg.id]?.simChain === simChain.value
        );
        const imageUrl = coingeckoChain?.image?.large || '/fallback-image.webp';
        return {
          coingeckoId: coingeckoChain?.id || null,
          value: simChain.value,
          label: simChain.label,
          shortName: coingeckoChain?.shortname || simChain.label.split(' ')[0],
          chainId: simChain.chainId,
          testnet: simChain.testnet || false,
          image: imageUrl,
        };
      });

      localCache.current[cacheKey] = { data: mappedChains, timestamp: Date.now() };
      await cacheLimiter.schedule(() =>
        axios.post(
          `${API_BASE_URL}/api/cache`,
          { key: cacheKey, action: 'set', data: mappedChains, ttl: 48 * 60 * 60 * 1000 },
          { timeout: 30000 }
        )
      );

      setChains(mappedChains);
      lastFetchedChainsRef.current = Date.now();
    } catch (error) {
      console.error(`Failed to fetch supported chains (attempt ${retryCount + 1}):`, error.message);
      if (retryCount < 5 && (error.response?.status === 429 || error.code === 'ECONNABORTED')) {
        const delay = Math.pow(2, retryCount) * 2000 + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return fetchSupportedChains(retryCount + 1);
      }

      const fallbackChains = SUPPORTED_CHAINS.map((chain) => ({
        coingeckoId: Object.keys(CHAIN_MAPPING).find(
          (key) => CHAIN_MAPPING[key].simChain === chain.value
        ) || null,
        value: chain.value,
        label: chain.label,
        shortName: chain.label.split(' ')[0],
        chainId: chain.chainId,
        testnet: chain.testnet || false,
        image: '/fallback-image.webp',
      }));
      localCache.current[cacheKey] = { data: fallbackChains, timestamp: Date.now() };
      setChains(fallbackChains);
      toast.error('Failed to load supported chains, using fallback data', {
        position: 'top-center',
        autoClose: 5000,
      });
    } finally {
      isFetchingChainsRef.current = false;
    }
  }, [toast, session, status]);

  useEffect(() => {
    if (chains.length === 0 && !isFetchingChainsRef.current && Date.now() - lastFetchedChainsRef.current > 48 * 60 * 60 * 1000) {
      fetchSupportedChains();
    }
  }, [fetchSupportedChains, chains.length]);

  const fetchPoolTokenMetadata = useCallback(
    async (chain, poolAddress, retryCount = 0) => {
      const cacheKey = `pool-${GECKOTERMINAL_CHAIN_MAPPING[chain]}-${poolAddress}-session_required`; // Session-dependent
      try {
        const fetchFn = async () => {
          const response = await coingeckoAxios.get(
            `https://api.geckoterminal.com/api/v2/networks/${GECKOTERMINAL_CHAIN_MAPPING[chain]}/pools/${poolAddress}/info`,
            {
              headers: { accept: 'application/json' },
              timeout: 10000,
            }
          );

          const tokenData = response.data.data || [];
          return tokenData.reduce((acc, token) => {
            acc[token.attributes.address] = {
              symbol: token.attributes.symbol,
              image_url: token.attributes.image_url,
              transaction_score: token.attributes.gt_score_details?.transaction || 0,
              holders: token.attributes.holders || {},
            };
            return acc;
          }, {});
        };

        return await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.DEFI_POOL, 0, true, session, status);
      } catch (error) {
        if (retryCount < 3 && error.response?.status === 429) {
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
          return fetchPoolTokenMetadata(chain, poolAddress, retryCount + 1);
        }
        return {};
      }
    },
    [session, status]
  );

  const fetchMempoolTransactions = useCallback(async () => {
    if (selectedToken?.id !== 'bitcoin' || document.visibilityState !== 'visible') {
      setMempoolTransactions([]);
      setIsLoadingMempool(false);
      setMempoolError(null);
      return;
    }

    setIsLoadingMempool(true);
    setMempoolError(null);
    try {
      // Fetch BTC price from CoinGecko
      const btcPriceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { timeout: 10000 });
      const btcPrice = btcPriceResponse.data.bitcoin?.usd || 0;
      if (!btcPrice) {
        setMempoolError('BTC price not available');
        setIsLoadingMempool(false);
        return;
      }

      // Fetch mempool transactions
      const response = await axios.get('/api/mempool-transactions', {
        headers: {
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
        },
        timeout: 50000,
      });

      if (response.data.success && Array.isArray(response.data.data)) {
        const newTxs = response.data.data
          .filter((tx) => {
            const isNew = !mempoolTxCache.current.has(tx.txid);
            const valueUSD = (tx.value_btc * btcPrice) || 0;
            return isNew && valueUSD >= 1000000; // Only take transactions >= 1M USD
          })
          .map((tx) => {
            mempoolTxCache.current.add(tx.txid);
            const inputs = tx.inputs?.map((input) => ({
              address: input.address || 'unknown',
              nameTag: btcNameTags[input.address?.toLowerCase()]?.Labels?.bitcoin?.['Name Tag'] || null,
              image: btcNameTags[input.address?.toLowerCase()]?.Labels?.bitcoin?.image || null,
            })) || [];
            const outputs = tx.outputs?.map((output) => ({
              address: output.address || 'unknown',
              nameTag: btcNameTags[output.address?.toLowerCase()]?.Labels?.bitcoin?.['Name Tag'] || null,
              image: btcNameTags[output.address?.toLowerCase()]?.Labels?.bitcoin?.image || null,
            })) || [];
            return {
              txid: tx.txid,
              value_usd: tx.value_btc * btcPrice,
              value_btc: tx.value_btc,
              timestamp: tx.timestamp || Math.floor(Date.now() / 1000),
              inputs,
              outputs,
              fee: tx.fee || 0,
              size: tx.size || 0,
              status: tx.status || {},
            };
          });

        // Update mempoolTransactions with new data, keeping up to 100 transactions
        setMempoolTransactions((prev) => {
          const updated = [...newTxs, ...prev].slice(0, 100).sort((a, b) => b.timestamp - a.timestamp);
          return updated;
        });
      } else {
        setMempoolError('Invalid mempool transaction data');
      }
    } catch (error) {
      const errorMessage =
        error.response?.status === 401
          ? 'Unauthorized: Please log in again.'
          : error.response?.status === 429
            ? 'Too many requests. Please try again later.'
            : error.response?.data?.detail || `Failed to fetch mempool transactions: ${error.message}`;
      setMempoolError(errorMessage);
      console.error('Mempool transaction fetch error:', { error: errorMessage });
    } finally {
      setIsLoadingMempool(false);
    }
  }, [selectedToken, btcNameTags, session]);



  useEffect(() => {
    if (selectedToken?.id !== 'bitcoin' || document.visibilityState !== 'visible') {
      setMempoolTransactions([]);
      setIsLoadingMempool(false);
      setMempoolError(null);
      return;
    }

    // Call fetch initially
    fetchMempoolTransactions();

    // Set up polling interval
    const interval = setInterval(() => {
      if (selectedToken?.id === 'bitcoin' && document.visibilityState === 'visible') {
        fetchMempoolTransactions();
      }
    }, MEMPOOL_POLLING_INTERVAL);

    return () => clearInterval(interval);
  }, [selectedToken, fetchMempoolTransactions]);

  const fetchNameTag = useCallback(
    async (address) => {
      if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
        return { nameTag: null, image: null };
      }

      const normalizedAddress = address.toLowerCase();
      const cacheKey = `nametag-${normalizedAddress}-session_required`; // Session-dependent
      const cached = nameTagsRef.current[normalizedAddress];
      if (cached && Date.now() - cached.timestamp < NAME_TAG_CACHE_DURATION) {
        return { nameTag: cached.nameTag, image: cached.image };
      }

      try {
        if (status !== 'authenticated') {
          throw new Error('Unauthorized: Please log in to fetch Name Tag.');
        }

        const fetchFn = async () => {
          const response = await axios.get(`/api/nametags`, {
            params: { address: normalizedAddress },
            headers: {
              Authorization: `Bearer ${session?.accessToken}`,
            },
            timeout: 5000,
          });

          if (!response.data.success || !response.data.data?.[normalizedAddress]) {
            const cacheEntry = { nameTag: null, image: null, timestamp: Date.now() };
            nameTagsRef.current[normalizedAddress] = cacheEntry;
            setNameTags((prev) => ({
              ...prev,
              [normalizedAddress]: cacheEntry,
            }));
            return { nameTag: null, image: null };
          }

          const data = response.data.data[normalizedAddress];
          const nameTag = data.Labels?.deposit?.['Name Tag'] || null;
          const image = data.Labels?.deposit?.image || '/icons/default.webp';
          return { nameTag, image, timestamp: Date.now() };
        };

        const result = await getCachedData(cacheKey, fetchFn, NAME_TAG_CACHE_DURATION, 0, true, session, status);
        nameTagsRef.current[normalizedAddress] = result;
        setNameTags((prev) => ({
          ...prev,
          [normalizedAddress]: result,
        }));
        return result;
      } catch (error) {
        console.error(`fetchNameTag error for ${normalizedAddress}:`, {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });

        let errorMessage;
        let showToast = true;
        if (error.response?.status === 401) {
          errorMessage = 'Unauthorized: Please log in again.';
        } else if (error.response?.status === 429) {
          errorMessage = 'Too many requests. Please try again later.';
        } else if (error.response?.status === 404) {
          errorMessage = `Name Tag not found for address ${normalizedAddress}`;
          showToast = false;
        } else {
          errorMessage = error.response?.data?.detail || `Failed to fetch Name Tag: ${error.message}`;
        }

        const cacheEntry = { nameTag: null, image: null, timestamp: Date.now() };
        nameTagsRef.current[normalizedAddress] = cacheEntry;
        setNameTags((prev) => ({
          ...prev,
          [normalizedAddress]: cacheEntry,
        }));

        if (showToast) {
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        }
        return { nameTag: null, image: null };
      }
    },
    [session, status, toast]
  );

  const fetchNameTagsForAddresses = useCallback(
    async (addresses) => {
      if (!addresses || addresses.length === 0) {
        setIsLoadingNameTags(false);
        return;
      }

      setIsLoadingNameTags(true);
      const newNameTags = {};

      // Handle non-EVM addresses (Bitcoin, Dogecoin, Litecoin)
      const nonEvmAddresses = addresses.filter((addr) => !addr.match(/^0x[a-fA-F0-9]{40}$/));
      const nameTagsMap = {
        bitcoin: btcNameTags, // Use btc-top-holders.json for Bitcoin name tags
        dogecoin: dogeNameTags,
        litecoin: ltcNameTags,
        ethereum: ethNameTags,
      };

      nonEvmAddresses.forEach((addr) => {
        const normalizedAddress = addr.toLowerCase();
        let nameTagData = null;
        // Check each chain's name tag JSON file for the address
        for (const [chain, tags] of Object.entries(nameTagsMap)) {
          if (tags[normalizedAddress]?.Labels?.[chain]) {
            nameTagData = tags[normalizedAddress].Labels[chain];
            break;
          }
        }
        newNameTags[normalizedAddress] = {
          nameTag: nameTagData?.['Name Tag'] || null,
          image: nameTagData?.image || null,
          timestamp: Date.now(),
        };
      });

      // Handle EVM addresses with batching
      const evmAddresses = addresses.filter((addr) => addr.match(/^0x[a-fA-F0-9]{40}$/));
      if (evmAddresses.length > 0 && status === 'authenticated') {
        try {
          const batchSize = 50;
          const batches = [];
          for (let i = 0; i < evmAddresses.length; i += batchSize) {
            batches.push(evmAddresses.slice(i, i + batchSize));
          }

          const batchPromises = batches.map((batch) =>
            cacheLimiter.schedule(async () => {
              const cacheKey = `nametags-batch-${batch.join('-')}-session_required`; // Session-dependent
              const fetchFn = async () => {
                const response = await axios.post(
                  `/api/nametags`,
                  { addresses: batch },
                  {
                    headers: {
                      Authorization: `Bearer ${session?.accessToken}`,
                    },
                    timeout: 40000,
                  }
                );
                return response.data.data;
              };
              return await getCachedData(cacheKey, fetchFn, NAME_TAG_CACHE_DURATION, 0, true, session, status);
            })
          );

          const responses = await Promise.allSettled(batchPromises);
          responses.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
              const batchAddresses = batches[index];
              batchAddresses.forEach((address) => {
                const normalizedAddress = address.toLowerCase();
                const data = result.value?.[normalizedAddress];
                const nameTag = data?.Labels?.deposit?.['Name Tag'] || null;
                const image = data?.Labels?.deposit?.image || '/icons/default.webp';
                newNameTags[normalizedAddress] = { nameTag, image, timestamp: Date.now() };
              });
            } else {
              batches[index].forEach((address) => {
                const normalizedAddress = address.toLowerCase();
                newNameTags[normalizedAddress] = { nameTag: null, image: null, timestamp: Date.now() };
              });
            }
          });
        } catch (error) {
          console.error(`fetchNameTagsForAddresses error:`, {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
          });

          const errorMessage =
            error.response?.status === 401
              ? 'Unauthorized: Please log in again.'
              : error.response?.status === 429
                ? 'Too many requests. Please try again later.'
                : error.response?.status === 400
                  ? 'Invalid addresses provided.'
                  : error.response?.data?.detail || `Failed to fetch Name Tags: ${error.message}`;

          evmAddresses.forEach((address) => {
            const normalizedAddress = address.toLowerCase();
            newNameTags[normalizedAddress] = { nameTag: null, image: null, timestamp: Date.now() };
          });

          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        }
      } else if (evmAddresses.length > 0) {
        evmAddresses.forEach((address) => {
          const normalizedAddress = address.toLowerCase();
          newNameTags[normalizedAddress] = { nameTag: null, image: null, timestamp: Date.now() };
        });
      }

      setNameTags((prev) => {
        const updated = { ...prev, ...newNameTags };
        nameTagsRef.current = updated;
        return updated;
      });
      setIsLoadingNameTags(false);
    },
    [session, status, toast]
  );

  const fetchPriceHistory = useCallback(
    debounce(
      async (tokenId, days, callback = () => { }, retryCount = 0) => {
        if (document.visibilityState !== 'visible') {
          callback(null);
          return;
        }
        if (!tokenId || !days) {
          const errorMessage = 'Invalid token ID or days parameter';
          setError(errorMessage);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          callback(new Error(errorMessage));
          return;
        }

        const cacheKey = `price-history-${tokenId}-${days}-${currency}`; // Non-session-dependent
        setIsLoadingSelectedToken(true);

        try {
          const fetchFn = async () => {
            const response = await axios.get('/api/coingecko/market_chart', {
              params: { id: tokenId, days, currency },
              timeout: 30000,
            });

            if (!response.data?.prices || !Array.isArray(response.data.prices) || response.data.prices.length === 0) {
              throw new Error('Invalid or empty price history data');
            }

            const prices = response.data.prices.map(([, price]) => price).filter((p) => p > 0);
            const minPrice = prices.length > 0 ? Math.min(...prices) : 0.01;
            let fractionDigits = 2;
            if (minPrice < 0.0001) {
              fractionDigits = 6;
            } else if (minPrice < 0.01) {
              fractionDigits = 4;
            }

            const priceData = response.data.prices
              .filter(([timestamp]) => typeof timestamp === 'number' && !isNaN(timestamp))
              .map(([timestamp, price]) => ({
                title: new Date(timestamp).toISOString(),
                price: parseFloat(
                  price.toLocaleString('en-US', {
                    minimumFractionDigits: fractionDigits,
                    maximumFractionDigits: fractionDigits,
                  }).replace(/,/g, '')
                ),
              }));

            if (priceData.length === 0) {
              throw new Error('No valid price data after filtering');
            }

            return priceData;
          };

          const priceData = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.PRICE, 0, false, session, status);
          setPriceHistory(priceData);
          callback(null, priceData);
        } catch (err) {
          if (retryCount < 3 && (err.response?.status === 429 || err.response?.status === 503 || err.code === 'ECONNABORTED')) {
            const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
            await new Promise((resolve) => setTimeout(resolve, delay));
            return fetchPriceHistory(tokenId, days, callback, retryCount + 1);
          }
          const errorMessage =
            err.response?.status === 429
              ? 'API rate limit reached. Please wait a minute and try again.'
              : err.response?.status === 401
                ? 'Unable to fetch market data due to authentication issues. Please try again later.'
                : err.response?.data?.detail || `Failed to load price history: ${err.message}`;
          setError(errorMessage);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          callback(err);
          if (!localCache.current[cacheKey]?.data) {
            setPriceHistory([]);
          }
        } finally {
          setIsLoadingSelectedToken(false);
        }
      },
      300,
      { leading: false, trailing: true }
    ),
    [currency, session, status, toast]
  );

  const fetchPublicTreasuryData = useCallback(
    debounce(
      async (tokenSymbol, retryCount = 0) => {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://xynapse-ai.vercel.app';
        const normalizedTokenSymbol = tokenSymbol?.toLowerCase();
        if (!NON_EVM_CHAINS.includes(normalizedTokenSymbol)) {
          setOnChainError(`Chain not supported: ${normalizedTokenSymbol}`);
          setIsLoadingOnChain(false);
          return;
        }

        if (status !== 'authenticated') {
          setIsLoadingOnChain(false);
          return;
        }

        const chain = normalizedTokenSymbol;
        const cacheKey = `top-holders-${chain}-session_required`; // Session-dependent
        setIsLoadingOnChain(true);
        setOnChainError(null);

        try {
          const fetchFn = async () => {
            let topHolders = [];

            // Map token symbol to corresponding JSON file for top holders
            const topHoldersMap = {
              bitcoin: btcTopHolders,
              dogecoin: dogeNameTags,
              litecoin: ltcNameTags,
              ethereum: ethNameTags,
            };

            // Map token symbol to corresponding JSON file for name tags
            const nameTagsMap = {
              bitcoin: btcNameTags,
              dogecoin: dogeNameTags,
              litecoin: ltcNameTags,
              ethereum: ethNameTags,
            };

            const jsonData = topHoldersMap[chain];
            const nameTagData = nameTagsMap[chain];

            if (jsonData) {
              topHolders = Object.values(jsonData).map((holder) => {
                const address = holder.Address.toLowerCase();
                const nameTagEntry = nameTagData?.[address]?.Labels?.[chain];
                return {
                  address,
                  balance: parseFloat(holder.Balance) || 0,
                  share: 0,
                  nameTag: nameTagEntry?.['Name Tag'] || null,
                  image: nameTagEntry?.image || null,
                  source: 'JSON',
                };
              });
            } else {
              throw new Error(`No JSON data available for ${chain}`);
            }

            // Fetch CoinGecko treasury data for Bitcoin and Ethereum
            if (['bitcoin', 'ethereum'].includes(chain)) {
              try {
                const coingeckoResponse = await coingeckoAxios.get(`${API_BASE_URL}/api/coingecko`, {
                  params: { action: 'public-treasury', tokenType: chain },
                  headers: {
                    ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
                  },
                  timeout: 15000,
                });

                if (coingeckoResponse.data.success && Array.isArray(coingeckoResponse.data.data?.companies)) {
                  const treasuryData = coingeckoResponse.data.data.companies.map((company) => {
                    const address = company.address?.toLowerCase() || company.name?.toLowerCase() || 'unknown';
                    const nameTagEntry = nameTagData?.[address]?.Labels?.[chain];
                    return {
                      address,
                      balance: parseFloat(company.total_holdings) || 0,
                      share: parseFloat(company.total_value_usd) / (company.total_holdings || 1) || 0,
                      nameTag: nameTagEntry?.['Name Tag'] || company.name || null,
                      image: nameTagEntry?.image || null,
                      source: 'CoinGecko',
                    };
                  });

                  // Merge with JSON data, avoiding duplicates
                  const uniqueAddresses = new Set(topHolders.map((holder) => holder.address.toLowerCase()));
                  topHolders = [
                    ...topHolders,
                    ...treasuryData.filter((company) => {
                      const addr = company.address.toLowerCase();
                      if (!uniqueAddresses.has(addr) && addr !== 'unknown') {
                        uniqueAddresses.add(addr);
                        return true;
                      }
                      return false;
                    }),
                  ];
                }
              } catch (coingeckoError) {
                console.warn(`Failed to fetch treasury data from CoinGecko for ${chain}:`, coingeckoError.message);
              }
            }

            // Sort by balance and limit to top 100
            topHolders = topHolders.sort((a, b) => b.balance - a.balance).slice(0, 100);

            if (topHolders.length === 0) {
              throw new Error(`No data for ${chain}`);
            }

            return topHolders;
          };

          const topHolders = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TOP_HOLDERS, 0, true, session, status);
          setOnChainData((prev) => ({
            ...prev,
            topHolders,
          }));
        } catch (error) {
          const errorMessage =
            error.response?.status === 429
              ? 'API rate limit exceeded. Please try again later.'
              : error.response?.data?.detail || `Failed to fetch top holders data for ${chain}: ${error.message}`;
          setOnChainError(errorMessage);
          if (retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
            await new Promise((resolve) => setTimeout(resolve, delay));
            fetchPublicTreasuryData(tokenSymbol, retryCount + 1);
          } else {
            toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
            if (!localCache.current[cacheKey]?.data) {
              setOnChainData((prev) => ({
                ...prev,
                topHolders: prev.topHolders, // Preserve existing data
              }));
            }
          }
        } finally {
          setIsLoadingOnChain(false);
          if (recaptchaRef.current) {
            recaptchaRef.current.reset();
          }
        }
      },
      300,
      { leading: false, trailing: true }
    ),
    [session, status, toast, executeRecaptcha]
  );

  const fetchTickerData = useCallback(
    debounce(
      async (tokenId, retryCount = 0) => {
        if (!tokenId || document.visibilityState !== 'visible') return;
        const cacheKey = `ticker-${tokenId}`; // Non-session-dependent
        setIsLoadingTickers(true);
        setTickerError(null);

        try {
          const fetchFn = async () => {
            const response = await coingeckoAxios.get('/api/coingecko', {
              params: {
                action: 'tickers',
                id: tokenId,
                include_exchange_logo: true,
              },
              timeout: 20000,
            });
            if (!response.data.success || !Array.isArray(response.data.data?.tickers)) {
              throw new Error(`Invalid ticker data for ${tokenId}: ${JSON.stringify(response.data)}`);
            }
            return response.data.data.tickers;
          };

          const tickers = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TICKERS, 0, false, session, status);
          setTickerData(tickers || []);
          setTickerError(null);
        } catch (error) {
          if (retryCount < 3 && (error.response?.status === 429 || error.code === 'ECONNABORTED')) {
            const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
            await new Promise((resolve) => setTimeout(resolve, delay));
            return fetchTickerData(tokenId, retryCount + 1);
          }
          const errorMessage =
            error.response?.status === 429
              ? 'CoinGecko API rate limit exceeded. Please try again in a few minutes.'
              : error.response?.status === 404
                ? `No CEX data found for ${tokenId}.`
                : error.response?.data?.detail || `Failed to load CEX data: ${error.message}`;
          setTickerError(errorMessage);
          if (!localCache.current[cacheKey]?.data) {
            setTickerData([]);
          }
        } finally {
          setIsLoadingTickers(false);
        }
      },
      300
    ),
    [session, status]
  );

  const fetchOnChainData = useCallback(
    debounce(
      async (chain, tokenAddress, action, decimalPlace, address, recaptchaToken, retryCount = 0) => {
        if (
          (action === 'top-holders' && (!chain || !tokenAddress || !tokenAddress.match(/^0x[a-fA-F0-9]{40}$/))) ||
          ((action === 'wallet-balances' || action === 'transactions') && !address?.match(/^0x[a-fA-F0-9]{40}$/)) ||
          (typeof document !== 'undefined' && document.visibilityState !== 'visible')
        ) {
          const errorMessage = `Invalid parameters: action=${action}, chain=${chain}, address=${address || tokenAddress}`;
          setOnChainError(errorMessage);
          setIsLoadingOnChain(false);
          setIsLoadingWalletBalances(false);
          setIsLoadingTransactions(false);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          return;
        }

        if (status !== 'authenticated') {
          const errorMessage = 'Please log in to access on-chain data.';
          setOnChainError(errorMessage);
          setIsLoadingOnChain(false);
          setIsLoadingWalletBalances(false);
          setIsLoadingTransactions(false);
          return;
        }

        let simChain = chains.find((c) => c.value === chain)?.value;
        if (!simChain && action === 'top-holders') {
          simChain = 'ethereum';
          console.warn(`Invalid chain: ${chain}, falling back to 'ethereum'`);
        }

        if (!simChain && action !== 'wallet-balances' && action !== 'transactions') {
          const errorMessage = `No valid chain found for ${chain}`;
          console.error(errorMessage);
          setOnChainError(errorMessage);
          setIsLoadingOnChain(false);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          return;
        }

        const cacheKey = `onchain-${simChain || 'wallet'}-${tokenAddress || address}-${action}-session_required`; // Session-dependent
        setIsLoadingOnChain(action === 'top-holders');
        if (action === 'wallet-balances') setIsLoadingWalletBalances(true);
        else if (action === 'transactions') setIsLoadingTransactions(true);

        try {
          const fetchFn = async () => {
            const apiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://xynapse-ai.vercel.app'}/api/sim`;
            const payload = {
              action,
              recaptchaToken,
              ...(simChain && { chain: simChain }),
              ...(tokenAddress && tokenAddress.match(/^0x[a-fA-F0-9]{40}$/) && { tokenAddress }),
              ...(decimalPlace != null && { decimalPlace: Number(decimalPlace) }),
              ...(address && { address }),
            };

            const response = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
                'Content-Type': 'application/json',
                'x-recaptcha-token': recaptchaToken,
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(30000),
            });

            if (!response.ok) {
              const text = await response.text();
              let errorMessage = `Failed to fetch ${action} data: ${response.status} ${response.statusText}`;
              try {
                const result = JSON.parse(text);
                errorMessage = result.detail || errorMessage;
              } catch {
                errorMessage = `Failed to fetch ${action} data: Invalid JSON response`;
              }
              throw new Error(errorMessage);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let data = [];
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
                      data.push(parsedObj);
                    } catch (parseError) {
                      console.warn(`Failed to parse object: ${parseError.message}`, { objStr });
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
                    data.push(parsed);
                  } else {
                    throw new Error(parsed.detail);
                  }
                } catch (e) {
                  console.error(`Error parsing final buffer: ${e.message}`, { buffer });
                }
              }
            }

            return data;
          };

          const ttl = action === 'transactions' ? CACHE_DURATIONS.TRANSACTIONS : CACHE_DURATIONS.DEFAULT;
          const data = await getCachedData(cacheKey, fetchFn, ttl, 0, true, session, status);

          if (action === 'top-holders') {
            setOnChainData((prev) => ({
              ...prev,
              topHolders: data,
            }));
          } else if (action === 'wallet-balances') {
            setWalletBalances(data);
            setWalletBalancesError(null);
          } else if (action === 'transactions') {
            setTransactions(data);
            setTransactionsError(null);
          }
        } catch (error) {
          const errorMessage =
            error.response?.status === 429
              ? 'Too many requests. Please try again later.'
              : error.response?.status === 401
                ? 'Unauthorized: Please log in again.'
                : error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')
                  ? 'reCAPTCHA verification failed. Please try again.'
                  : error.response?.data?.detail || `Failed to fetch ${action} data: ${error.message}`;
          console.error(`Error fetching ${action}:`, { errorMessage, stack: error.stack });
          setOnChainError(errorMessage);
          if (action === 'wallet-balances') {
            setWalletBalancesError(errorMessage);
            setWalletBalances([]);
          } else if (action === 'transactions') {
            setTransactionsError(errorMessage);
            setTransactions([]);
          }
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          if (retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
            await new Promise((resolve) => setTimeout(resolve, delay));
            let newRecaptchaToken = recaptchaToken;
            try {
              newRecaptchaToken = await executeRecaptcha(action);
            } catch (recaptchaError) {
              console.error(`Failed to get reCAPTCHA token on retry ${retryCount + 1}:`, recaptchaError.message);
            }
            fetchOnChainData(chain, tokenAddress, action, decimalPlace, address, newRecaptchaToken, retryCount + 1);
          }
        } finally {
          setIsLoadingOnChain(false);
          if (action === 'wallet-balances') setIsLoadingWalletBalances(false);
          else if (action === 'transactions') setIsLoadingTransactions(false);
          if (recaptchaRef.current) {
            recaptchaRef.current.reset();
          }
        }
      },
      300
    ),
    [chains, session, status, toast, executeRecaptcha]
  );


  const fetchDexData = useCallback(
    debounce(
      async (chain, tokenAddress, retryCount = 0) => {
        if (status !== 'authenticated') {
          const errorMessage = 'Please log in to access DEX data.';
          setDexError(errorMessage);
          setIsLoadingDex(false);
          return;
        }

        if (!chain || !tokenAddress || !tokenAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
          const errorMessage = 'Invalid chain or token address for DEX data';
          setDexError(errorMessage);
          setIsLoadingDex(false);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          return;
        }

        const geckoChain = GECKOTERMINAL_CHAIN_MAPPING[chain];
        if (!geckoChain) {
          const errorMessage = `Unsupported chain for DEX data: ${chain}`;
          setDexError(errorMessage);
          setIsLoadingDex(false);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          return;
        }

        const userId = session?.user?.id || 'anonymous';
        const now = Date.now();
        const userRequests = dexRequestTracker.get(userId) || { count: 0, lastReset: now };

        if (now - userRequests.lastReset >= DEX_REQUEST_WINDOW) {
          dexRequestTracker.set(userId, { count: 1, lastReset: now });
          setDexRequestCount(1);
          setLastDexRequestTime(now);
        } else if (userRequests.count >= DEX_REQUEST_LIMIT) {
          const errorMessage = 'Too many DEX requests. Please wait a minute and try again.';
          setDexError(errorMessage);
          setIsLoadingDex(false);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          return;
        } else {
          dexRequestTracker.set(userId, { count: userRequests.count + 1, lastReset: userRequests.lastReset });
          setDexRequestCount((prev) => prev + 1);
        }

        const cacheKey = `dex-${geckoChain}-${tokenAddress}-session_required`; // Session-dependent
        setIsLoadingDex(true);
        setDexError(null);

        try {
          const fetchFn = async () => {
            const poolResponse = await coingeckoAxios.get(
              `https://api.geckoterminal.com/api/v2/networks/${geckoChain}/tokens/${tokenAddress}/pools?page=1`,
              {
                headers: { accept: 'application/json' },
                timeout: 10000,
              }
            );

            let pools = poolResponse.data?.data || [];
            pools.sort((a, b) => parseFloat(b.attributes.volume_usd.h24) - parseFloat(a.attributes.volume_usd.h24));
            const topPools = pools.slice(0, 3);

            const tradePromises = topPools.map((pool) =>
              limit(() =>
                coingeckoAxios.get(
                  `https://api.geckoterminal.com/api/v2/networks/${geckoChain}/pools/${pool.attributes.address}/trades?trade_volume_in_usd_greater_than=100`,
                  {
                    headers: { accept: 'application/json' },
                    timeout: 10000,
                  }
                ).then((response) => ({
                  status: 'fulfilled',
                  poolAddress: pool.attributes.address,
                  poolName: pool.attributes.name,
                  data: response.data?.data || [],
                })).catch((error) => ({
                  status: 'rejected',
                  poolAddress: pool.attributes.address,
                  poolName: pool.attributes.name,
                  error: {
                    message: error.message,
                    status: error.response?.status,
                    safeMessage: error.response?.status === 429 ? 'Rate limit exceeded' : 'Failed to fetch trades',
                  },
                }))
              )
            );

            const tradeResults = await Promise.allSettled(tradePromises);
            const trades = tradeResults.reduce((acc, result) => {
              if (result.status === 'fulfilled') {
                return acc.concat(
                  result.value.data.map((trade) => ({
                    ...trade.attributes,
                    pool_name: result.value.poolName,
                    pool_address: result.value.poolAddress,
                  }))
                );
              }
              return acc;
            }, []);

            const validTrades = trades.filter((trade) => {
              const isValid = trade.pool_address && typeof trade.pool_address === 'string' && trade.pool_address.match(/^0x[a-fA-F0-9]{40}$/);
              return isValid;
            });

            const poolTokenPromises = topPools.map((pool) =>
              limit(() => fetchPoolTokenMetadata(chain, pool.attributes.address))
            );
            const poolTokenResults = await Promise.allSettled(poolTokenPromises);
            const poolTokens = poolTokenResults.reduce((acc, result, index) => {
              if (result.status === 'fulfilled' && Object.keys(result.value).length > 0) {
                acc[topPools[index].attributes.address] = result.value;
              }
              return acc;
            }, {});

            return { pools: topPools, trades: validTrades, poolTokens };
          };

          const dexData = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.DEFI_POOL, 0, true, session, status);
          setDexData(dexData);
          setLastDexFetchTime(Date.now());
        } catch (error) {
          const safeErrorMessage =
            error.response?.status === 429
              ? 'Too many requests from your IP or API limit exceeded. Please try again later.'
              : error.response?.status === 404
                ? `No DEX data found for token ${tokenAddress} on ${chain}.`
                : 'Failed to load DEX data.';
          setDexError(safeErrorMessage);
          toast.error(safeErrorMessage, { position: 'top-center', autoClose: 5000 });
          if (localCache.current[cacheKey]?.data) {
            setDexData(localCache.current[cacheKey].data);
          } else {
            setDexData({ pools: [], trades: [], poolTokens: {} });
          }
        } finally {
          setIsLoadingDex(false);
        }
      },
      300
    ),
    [session, status, toast, fetchPoolTokenMetadata]
  );

  const fetchTrendingTokens = useCallback(
    debounce(
      async (retryCount = 0) => {
        if (document.visibilityState !== 'visible') return;
        const cacheKey = `trending-tokens-${currency}`; // Non-session-dependent
        setIsLoadingTrending(true);
        setTrendingError(null);

        try {
          const fetchFn = async () => {
            const response = await axios.get('/api/coingecko', {
              params: { action: 'trending', vs_currency: currency },
              timeout: 15000,
            });
            if (!response.data.success || !Array.isArray(response.data.data)) {
              throw new Error(`Invalid or missing trending data: ${JSON.stringify(response.data)}`);
            }
            return response.data.data;
          };

          const tokens = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TRENDING, 0, false, session, status);
          setTrendingTokens(tokens || []);
          setTrendingError(null);
        } catch (error) {
          if (retryCount < 3 && (error.response?.status === 429 || error.response?.status === 404 || error.code === 'ECONNABORTED')) {
            const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
            await new Promise((resolve) => setTimeout(resolve, delay));
            return fetchTrendingTokens(retryCount + 1);
          }
          const errorMessage =
            error.response?.status === 429
              ? 'CoinGecko API rate limit exceeded. Please try again in a few minutes.'
              : error.response?.status === 404
                ? 'No trending token data found.'
                : error.response?.data?.detail || `Failed to load trending tokens: ${error.message}`;
          setTrendingError(errorMessage);
          if (!localCache.current[cacheKey]?.data) {
            setTrendingTokens([]);
          }
          toast.error(errorMessage, { position: 'top-center', autoClose: 3000 });
        } finally {
          setIsLoadingTrending(false);
        }
      },
      1000
    ),
    [currency, session, status, toast]
  );


  const handleAddressClick = useCallback(
    (address) => {
      if (address === 'Unknown') {
        const errorMessage = 'Cannot fetch balances for unknown address.';
        console.error(errorMessage);
        setWalletBalancesError(errorMessage);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      if (selectedToken?.id.toLowerCase() === 'bitcoin') {
        const blockchairUrl = `https://blockchair.com/bitcoin/address/${address}`;
        window.open(blockchairUrl, '_blank', 'noreferrer');
        return;
      }

      if (!address?.match(/^0x[a-fA-F0-9]{40}$/)) {
        const errorMessage = `Invalid address format: ${address}`;
        console.error(errorMessage);
        setWalletBalancesError(errorMessage);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }
      setSelectedWallet(address);
      setWalletBalances([]);
      setTransactions(null);
      setWalletBalancesError(null);
      setTransactionsError(null);
      setIsLoadingWalletBalances(true);

      // Fetch wallet balances with reCAPTCHA
      const fetchBalances = async () => {
        try {
          const recaptchaToken = await executeRecaptcha('wallet-balances');
          await fetchOnChainData(null, null, 'wallet-balances', null, address, recaptchaToken);
        } catch (error) {
          const errorMessage =
            error.response?.status === 401
              ? 'Unauthorized: Please log in again.'
              : error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')
                ? 'reCAPTCHA verification failed. Please try again.'
                : error.response?.status === 429
                  ? 'Too many requests. Please try again later.'
                  : error.response?.data?.detail || `Failed to fetch wallet balances: ${error.message}`;
          console.error(`Error in handleAddressClick:`, { errorMessage, stack: error.stack });
          setWalletBalancesError(errorMessage);
          setIsLoadingWalletBalances(false);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        }
      };

      fetchBalances();
    },
    [fetchOnChainData, selectedToken, toast, executeRecaptcha]
  );

  const handleWalletSearch = useCallback(
    debounce(async () => {
      if (!walletAddress || walletAddress.length !== 42 || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        setWalletBalancesError('Invalid wallet address format.');
        return;
      }
      if (status !== 'authenticated') {
        setWalletBalancesError('Please log in to search wallet.');
        return;
      }
      const now = Date.now();
      if (now - lastWalletSearchTime < WALLET_SEARCH_WINDOW && walletSearchCount >= WALLET_SEARCH_LIMIT) {
        setWalletBalancesError('Too many wallet searches. Please wait a minute and try again.');
        return;
      }
      try {
        const recaptchaToken = await executeRecaptcha('wallet_search');
        if (now - lastWalletSearchTime >= WALLET_SEARCH_WINDOW) {
          setWalletSearchCount(1);
          setLastWalletSearchTime(now);
        } else {
          setWalletSearchCount((prev) => prev + 1);
        }
        setSelectedWallet(walletAddress);
        setWalletBalances([]);
        setTransactions(null);
        setWalletBalancesError(null);
        setTransactionsError(null);
        setIsLoadingWalletBalances(true);
        fetchOnChainData(null, null, 'wallet-balances', null, walletAddress, recaptchaToken);
      } catch (error) {
        setWalletBalancesError(
          error.response?.status === 401
            ? 'Unauthorized: Please log in again.'
            : error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')
              ? 'reCAPTCHA verification failed. Please try again.'
              : error.response?.status === 429
                ? 'Too many requests. Please try again later.'
                : error.response?.data?.detail || 'Failed to search wallet.'
        );
        setIsLoadingWalletBalances(false);
      } finally {
        if (recaptchaRef.current) {
          recaptchaRef.current.reset();
        }
      }
    }, 500),
    [walletAddress, fetchOnChainData, executeRecaptcha, status, walletSearchCount, lastWalletSearchTime, selectedToken, onChainData]
  );

  const fetchTransactions = useCallback(
    async (address, retryCount = 0) => {
      if (!address?.match(/^0x[a-fA-F0-9]{40}$/)) {
        const errorMessage = `Invalid address for transactions: ${address}`;
        console.error(errorMessage);
        setTransactionsError(errorMessage);
        setIsLoadingTransactions(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      try {
        const recaptchaToken = await executeRecaptcha('transactions');
        setIsLoadingTransactions(true);
        setTransactionsError(null);
        await fetchOnChainData(null, null, 'transactions', null, address, recaptchaToken);
      } catch (error) {
        const errorMessage =
          error.response?.status === 401
            ? 'Unauthorized: Please log in again.'
            : error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')
              ? 'reCAPTCHA verification failed. Please try again.'
              : error.response?.status === 429
                ? 'Too many requests. Please try again later.'
                : error.message.includes('reCAPTCHA')
                  ? 'reCAPTCHA verification failed. Please try again.'
                  : error.response?.data?.detail || `Failed to fetch transactions: ${error.message}`;
        console.error(`Error in fetchTransactions:`, { errorMessage, stack: error.stack });
        setTransactionsError(errorMessage);
        setIsLoadingTransactions(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
          fetchTransactions(address, retryCount + 1);
        }
      }
    },
    [fetchOnChainData, executeRecaptcha, toast]
  );

  const getDefaultChainAndAddress = useCallback(
    (token, preferredChain = 'ethereum') => {
      if (!token) {
        console.warn('No token provided for getDefaultChainAndAddress');
        return { chain: 'ethereum', tokenAddress: null, decimalPlace: null };
      }

      const tokenSymbol = token.symbol?.toLowerCase();
      if (NON_EVM_CHAINS.includes(tokenSymbol)) {
        return { chain: tokenSymbol, tokenAddress: null, decimalPlace: null };
      }

      // Special case for BNB
      if (tokenSymbol === 'bnb') {
        const bnbChainAddress = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
        const bnbPlatforms = {
          'binance-smart-chain': {
            address: bnbChainAddress,
            decimal_place: 18,
          },
          'ethereum': {
            address: token.detail_platforms?.ethereum?.contract_address?.toLowerCase() || null,
            decimal_place: token.detail_platforms?.ethereum?.decimal_place || 18,
          },
        };

        // Ensure chains array is not empty
        if (!chains || chains.length === 0) {
          console.warn('Chains array is empty, falling back to BNB chain for BNB');
          return { chain: 'bnb', tokenAddress: bnbChainAddress, decimalPlace: 18 };
        }

        // Filter available chains for BNB, excluding testnets in production
        const availableChains = chains.filter(
          (chain) =>
            bnbPlatforms[chain.value] &&
            bnbPlatforms[chain.value].address?.match(/^0x[a-fA-F0-9]{40}$/) &&
            (process.env.NODE_ENV === 'development' || !chain.testnet)
        );

        // Prefer BNB chain if available, otherwise fall back to Ethereum
        if (
          bnbPlatforms['binance-smart-chain'] &&
          chains.some((net) => net.value === 'bnb') &&
          bnbPlatforms['binance-smart-chain'].address.match(/^0x[a-fA-F0-9]{40}$/)
        ) {
          return {
            chain: 'bnb',
            tokenAddress: bnbPlatforms['binance-smart-chain'].address,
            decimalPlace: bnbPlatforms['binance-smart-chain'].decimal_place,
          };
        } else if (
          bnbPlatforms['ethereum'] &&
          chains.some((net) => net.value === 'ethereum') &&
          bnbPlatforms['ethereum'].address?.match(/^0x[a-fA-F0-9]{40}$/)
        ) {
          return {
            chain: 'ethereum',
            tokenAddress: bnbPlatforms['ethereum'].address,
            decimalPlace: bnbPlatforms['ethereum'].decimal_place,
          };
        }

        setOnChainError('BNB does not have on-chain data available on supported chains.');
        return { chain: 'bnb', tokenAddress: bnbChainAddress, decimalPlace: 18 };
      }

      // Existing logic for other tokens
      if (!chains || chains.length === 0) {
        console.warn('Chains array is empty, falling back to default chain: ethereum');
        return { chain: 'ethereum', tokenAddress: null, decimalPlace: null };
      }

      const normalizedPlatforms = Object.keys(token.detail_platforms || {}).reduce((acc, cgId) => {
        const chain = chains.find((c) => c.coingeckoId === cgId || CHAIN_MAPPING[cgId]?.simChain === c.value);
        if (chain && token.detail_platforms[cgId]?.contract_address?.match(/^0x[a-fA-F0-9]{40}$/)) {
          const decimalPlace = Number(token.detail_platforms[cgId].decimal_place) || 18;
          acc[chain.value] = {
            address: token.detail_platforms[cgId].contract_address.toLowerCase(),
            decimal_place: decimalPlace,
          };
        }
        return acc;
      }, {});

      const availableChains = chains.filter(
        (chain) =>
          normalizedPlatforms[chain.value] &&
          (process.env.NODE_ENV === 'development' || !chain.testnet)
      );

      if (
        normalizedPlatforms[preferredChain] &&
        chains.some((net) => net.value === preferredChain) &&
        normalizedPlatforms[preferredChain].address.match(/^0x[a-fA-F0-9]{40}$/)
      ) {
        return {
          chain: preferredChain,
          tokenAddress: normalizedPlatforms[preferredChain].address,
          decimalPlace: normalizedPlatforms[preferredChain].decimal_place,
        };
      }

      if (availableChains.length > 0) {
        const defaultChain = availableChains[0].value;
        const tokenAddress = normalizedPlatforms[defaultChain].address;
        const decimalPlace = normalizedPlatforms[defaultChain].decimal_place;
        return { chain: defaultChain, tokenAddress, decimalPlace };
      }

      const fallbackTokens = {
        usdc: {
          chain: 'ethereum',
          tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimalPlace: 6,
        },
        dai: {
          chain: 'ethereum',
          tokenAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
          decimalPlace: 18,
        },
        link: {
          chain: 'ethereum',
          tokenAddress: '0x514910771af9ca656af840dff83e8264ecf986ca',
          decimalPlace: 18,
        },
      };

      if (fallbackTokens[tokenSymbol]) {
        return fallbackTokens[tokenSymbol];
      }

      setOnChainError('This token does not have on-chain data available on supported chains.');
      return { chain: 'ethereum', tokenAddress: null, decimalPlace: null };
    },
    [chains, setOnChainError]
  );

  const getAvailableChains = useCallback(() => {
    if (!selectedToken?.detail_platforms) return [];

    const tokenSymbol = selectedToken.symbol?.toLowerCase();
    if (tokenSymbol === 'bnb') {
      const bnbPlatforms = {
        'binance-smart-chain': {
          address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
          decimal_place: 18,
        },
        'ethereum': {
          address: selectedToken.detail_platforms?.ethereum?.contract_address?.toLowerCase() || null,
          decimal_place: selectedToken.detail_platforms?.ethereum?.decimal_place || 18,
        },
      };

      const availableChains = chains.filter(
        (chain) =>
          bnbPlatforms[chain.value] &&
          bnbPlatforms[chain.value].address?.match(/^0x[a-fA-F0-9]{40}$/) &&
          (process.env.NODE_ENV === 'development' || !chain.testnet)
      );
      prevAvailableChainsRef.current = availableChains;
      return availableChains;
    }

    const normalizedPlatforms = Object.keys(selectedToken.detail_platforms).reduce((acc, cgId) => {
      const chain = chains.find((c) => c.coingeckoId === cgId || CHAIN_MAPPING[cgId]?.simChain === c.value);
      if (chain && selectedToken.detail_platforms[cgId]?.contract_address?.match(/^0x[a-fA-F0-9]{40}$/)) {
        const decimalPlace = Number(selectedToken.detail_platforms[cgId].decimal_place) || 18;
        acc[chain.value] = {
          address: selectedToken.detail_platforms[cgId].contract_address.toLowerCase(),
          decimal_place: decimalPlace,
        };
      }
      return acc;
    }, {});

    const availableChains = chains.filter(
      (chain) =>
        normalizedPlatforms[chain.value] &&
        (process.env.NODE_ENV === 'development' || !chain.testnet)
    );

    prevAvailableChainsRef.current = availableChains;
    return availableChains;
  }, [selectedToken, chains]);

  const debouncedHandleTokenSelect = useCallback(
    debounce(async (token, initialTokenData = null, onTokenSelect = null) => {
      if (!token?.id || lastFetchedTokenRef.current === token.id) {
        return;
      }

      const cacheKey = `token-metadata-${token.id}`; // Non-session-dependent
      setIsLoadingSelectedToken(true);

      try {
        const fetchFn = async () => {
          const recaptchaToken = await executeRecaptcha('coin_details');
          const response = await axios.get('/api/coingecko', {
            params: {
              action: 'coin-details',
              id: token.id,
              recaptchaToken,
              vs_currencies: availableCurrencies.join(','),
            },
          });

          let responseData = response.data;
          if (response.data instanceof ReadableStream) {
            const text = await new Response(response.data).text();
            responseData = JSON.parse(text);
          }

          if (!responseData.success) {
            throw new Error(responseData.detail || 'Failed to fetch coin details');
          }

          return {
            id: responseData.data.id,
            symbol: responseData.data.symbol,
            name: responseData.data.name,
            image: responseData.data.image?.large,
            current_price: responseData.data.market_data?.current_price || {},
            market_cap: responseData.data.market_data?.market_cap || {},
            total_volume: responseData.data.market_data?.total_volume || {},
            high_24h: responseData.data.market_data?.high_24h || {},
            low_24h: responseData.data.market_data?.low_24h || {},
            price_change_percentage_1h_in_currency: responseData.data.market_data?.price_change_percentage_1h_in_currency || {},
            price_change_percentage_24h_in_currency: responseData.data.market_data?.price_change_percentage_24h_in_currency || {},
            price_change_percentage_7d_in_currency: responseData.data.market_data?.price_change_percentage_7d_in_currency || {},
            price_change_percentage_14d_in_currency: responseData.data.market_data?.price_change_percentage_14d_in_currency || {},
            price_change_percentage_30d_in_currency: responseData.data.market_data?.price_change_percentage_30d_in_currency || {},
            price_change_percentage_60d_in_currency: responseData.data.market_data?.price_change_percentage_60d_in_currency || {},
            price_change_percentage_90d_in_currency: responseData.data.market_data?.price_change_percentage_90d_in_currency || {},
            price_change_percentage_1y_in_currency: responseData.data.market_data?.price_change_percentage_1y_in_currency || {},
            price_change_percentage_24h: responseData.data.market_data?.price_change_percentage_24h,
            price_change_24h: responseData.data.market_data?.price_change_24h || {},
            market_cap_change_24h: responseData.data.market_data?.market_cap_change_24h || {},
            market_cap_change_percentage_24h: responseData.data.market_data?.market_cap_change_percentage_24h,
            circulating_supply: responseData.data.market_data?.circulating_supply,
            total_supply: responseData.data.market_data?.total_supply,
            max_supply: responseData.data.market_data?.max_supply,
            fully_diluted_valuation: responseData.data.market_data?.fully_diluted_valuation || {},
            ath: responseData.data.market_data?.ath || {},
            ath_change_percentage: responseData.data.market_data?.ath_change_percentage || {},
            ath_date: responseData.data.market_data?.ath_date || {},
            atl: responseData.data.market_data?.atl || {},
            atl_change_percentage: responseData.data.market_data?.atl_change_percentage || {},
            atl_date: responseData.data.market_data?.atl_date || {},
            roi: responseData.data.roi || responseData.data.roi,
            last_updated: responseData.data.last_updated,
            market_cap_rank: responseData.data.market_cap_rank,
            platforms: responseData.data.platforms || {},
            detail_platforms: responseData.data.detail_platforms || {},
            links: {
              homepage: responseData.data.links?.homepage || [],
              blockchain_site: responseData.data.links?.blockchain_site || [],
              official_forum_url: responseData.data.links?.official_forum_url || [],
              chat_url: responseData.data.links?.chat_url || [],
              announcement_url: responseData.data.links?.announcement_url || [],
              twitter_screen_name: responseData.data.links?.twitter_screen_name || '',
              facebook_username: responseData.data.links?.facebook_username || '',
              telegram_channel_identifier: responseData.data.links?.telegram_channel_identifier || '',
              repos_url: responseData.data.links?.repos_url?.github || [],
            },
          };
        };

        const fullToken = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.METADATA, 0, false, session, status);
        setSelectedToken(fullToken);
        setSelectedPair(`${fullToken.symbol?.toUpperCase()}/${currency.toUpperCase()}`);
        const { chain } = getDefaultChainAndAddress(fullToken, selectedChain);
        setSelectedChain(chain || 'ethereum');
        setAnalysis(null);
        setPrediction(null);
        setAnalysisLinks([]);
        setIsDropdownOpen(false);
        setOnChainData({ topHolders: [], whaleActivity: [] });
        setOnChainError(null);
        lastFetchedTokenRef.current = token.id;

        const days = timeRange || '1';
        fetchPriceHistory(token.id, days, (err, data) => {
          if (err) {
            setError(
              err.response?.status === 429
                ? 'Too many requests from your IP or API limit exceeded. Please try again later.'
                : err.response?.data?.detail || 'Failed to load price history.'
            );
          }
        });
        if (onTokenSelect) {
          onTokenSelect(token.id);
        }
      } catch (error) {
        setError(
          error.response?.status === 429
            ? 'CoinGecko rate limit reached. Please wait a minute and try again.'
            : error.response?.data?.detail || 'Failed to load token details.'
        );
        if (!localCache.current[cacheKey]?.data) {
          setSelectedToken(null);
        }
      } finally {
        setIsLoadingSelectedToken(false);
      }
    }, 500),
    [currency, availableCurrencies, timeRange, fetchPriceHistory, selectedChain, session, status, executeRecaptcha, getDefaultChainAndAddress]
  );

  const debouncedHandleAnalysis = useCallback(
    debounce(async () => {
      if (!selectedToken) {
        toast.error('Please select a token.', { position: 'top-center', autoClose: 3000 });
        return;
      }
      if (status !== 'authenticated') {
        toast.info('Please log in to perform the analysis.', { position: 'top-center', autoClose: 5000 });
        return;
      }

      const cacheKey = `analysis-${selectedToken.symbol.toUpperCase()}-session_required`;
      setIsAnalyzing(true);
      setAnalysisLogs([]);

      try {
        const fetchFn = async () => {
          const recaptchaToken = await executeRecaptcha('analyze');
          const prompt = `
Analyze **${selectedToken.symbol}** in Markdown format (500-800 words). Use **bold**, *italics*, tables, and concise yet detailed language. Ensure *not investment advice*. Format with clear headings, subheadings, line breaks, and professional tone. Base analysis heavily on real-time data from Brave API searches, incorporating specific facts, figures, and quotes from credible sources.

**Data**:
- **Current Price**: $${selectedToken.current_price?.[currency]?.toFixed(2) || 'N/A'}
- **24h Price Change**: ${selectedToken.price_change_percentage_24h?.toFixed(2) || 'N/A'}%
- **Market Cap**: $${selectedToken.market_cap?.[currency]?.toLocaleString() || 'N/A'}
- **24h Volume**: $${selectedToken.total_volume?.[currency]?.toLocaleString() || 'N/A'}
- **Social Media/Web**: Fetch recent sentiment from Twitter/X and web articles via Brave API, prioritizing latest news from the past week.

**Requirements**:
- **Overview**: Provide a detailed summary of market performance, recent trends, volatility, and historical context with specific data points, charts description (e.g., candlestick patterns), and comparisons to similar assets.
- **US Economic Impact**: Analyze effects of the most recent CPI (include latest value and date), Non-Farm Payrolls (latest figures and date), GDP growth (quarterly data), and Federal Reserve interest rate decisions (latest rate and meeting date). Discuss how these macroeconomic factors influence the token, with evidence from sources.
- **Stock Market Correlation**: Discuss detailed correlation with S&P 500 and Nasdaq, referencing their recent performance (e.g., index changes over past 7 days, 30 days), and statistical correlations if available from sources.
- **Political News Impact**: Evaluate influence of the latest political events or policies on the crypto market, citing specific events, dates, and impacts (e.g., regulatory changes, elections).
- **Sentiment Analysis**:
  - *Social Media*: Summarize Twitter/X sentiment with quantitative metrics (e.g., positive/negative ratio), highlighting key influencers, viral tweets, and trends from recent data.
  - *Web*: Extract in-depth insights from recent articles (via Brave API), prioritizing credible sources like Bloomberg, Reuters, CoinDesk. Include quotes and summaries from 3-5 articles.
- **Technical Analysis**:
  - *Price Patterns*: Identify support/resistance levels, moving averages (50-day, 200-day with values), RSI, MACD, and other indicators with specific values.
  - *Volume Trends*: Analyze trading volume changes over 24h, 7d, 30d, and implications for liquidity and momentum.
- **Risk Factors**: Discuss potential risks like market manipulation, regulatory risks, or technological issues, backed by recent news.
- **Conclusion**: Provide balanced, actionable insights with a neutral tone, summarizing key takeaways.
- **References**: Provide a JSON array of links in the format [{ "text": "Article Title", "url": "https://example.com", "description": "Summary", "image": "https://thumbnail.jpg" }, ...] from Brave API results, including at least 5-10 sources.

**Output Format**:
{
  "content": "Markdown text here",
  "links": [{ "text": "Article Title", "url": "https://example.com", "description": "Summary", "image": "https://thumbnail.jpg" }, ...]
}
`;

          const response = await fetch('/api/token-analysis', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.accessToken || ''}`,
            },
            body: JSON.stringify({
              tokenSymbol: selectedToken.symbol?.toUpperCase(),
              recaptchaToken,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const reader = response.body.getReader();
          let result = '';
          let links = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            result += chunk;

            const lines = chunk.split('\n');
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.progress) {
                  setAnalysisLogs((prev) => [...prev, parsed.progress]);
                } else if (parsed.success) {
                  result = parsed.aiAnalysis || 'No analysis data received.';
                  links = parsed.links || [];
                }
              } catch (e) {
                console.warn('Partial chunk, skipping parse:', e.message);
              }
            }
          }

          return { content: result, links };
        };

        const { content, links } = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.DEFAULT, 0, true, session, status);
        setAnalysis(content);
        setAnalysisLinks(links);
      } catch (error) {
        let errorMessage = 'Error analyzing token. Please try again.';
        if (error.code === 'ECONNABORTED') {
          errorMessage = 'Request took too long. Please check your network connection and try again.';
        } else if (error.response?.status === 401) {
          errorMessage = 'Session expired. Please log in again.';
        } else if (error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')) {
          errorMessage = 'reCAPTCHA verification failed. Please try again.';
        } else if (error.response?.status === 429) {
          errorMessage = 'Too many requests. Please try again after a minute.';
        } else if (error.response?.status === 413) {
          errorMessage = 'Request too large. Please try again later.';
        } else if (error.response?.data?.errors) {
          errorMessage = `'Data error: ${error.response.data.errors.map((e) => e.msg).join(', ')}`;
        } else if (error.message.includes('reCAPTCHA')) {
          errorMessage = 'reCAPTCHA verification error. Please try again.';
        }
        console.error(`Analysis error for ${selectedToken?.symbol || 'unknown'}: ${error.message}`, {
          error,
          status: error.response?.status,
          data: error.response?.data,
        });
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        // Preserve existing analysis data
        if (!localCache.current[cacheKey]?.data) {
          setAnalysis(analysis); // Keep previous analysis if available
        }
      } finally {
        setIsAnalyzing(false);
        if (recaptchaRef.current) {
          recaptchaRef.current.reset();
        }
      }
    }, 500),
    [selectedToken, currency, session, status, executeRecaptcha, toast, analysis]
  );

  // Replace the debouncedHandlePrediction function
  const debouncedHandlePrediction = useCallback(
    debounce(async () => {
      if (!selectedToken) {
        toast.error('Please select a token.', { position: 'top-center', autoClose: 3000 });
        return;
      }
      if (status !== 'authenticated') {
        toast.info('Please log in to perform the prediction.', { position: 'top-center', autoClose: 5000 });
        return;
      }

      const cacheKey = `prediction-${selectedToken.symbol.toUpperCase()}-session_required`;
      setIsPredicting(true);
      setAnalysisLogs([]);

      try {
        const fetchFn = async () => {
          const recaptchaToken = await executeRecaptcha('predict');
          const prompt = `
Predict **${selectedToken.symbol}/USD** price movement (1-3 days) in Markdown format (500-800 words). Use **bold**, *italics*, tables, and concise yet detailed language. Ensure *not investment advice*. Format with clear headings, subheadings, line breaks, and professional tone. Base predictions heavily on real-time data from Brave API searches, incorporating specific facts, figures, and quotes from credible sources.

**Data**:
- **Current Price**: $${selectedToken.current_price?.[currency]?.toFixed(2) || 'N/A'}
- **24h Price Change**: ${selectedToken.price_change_percentage_24h?.toFixed(2) || 'N/A'}%
- **Market Cap**: $${selectedToken.market_cap?.[currency]?.toLocaleString() || 'N/A'}
- **24h Volume**: $${selectedToken.total_volume?.[currency]?.toLocaleString() || 'N/A'}
- **Price History**: ${JSON.stringify(priceHistory.slice(-10))}
- **Recent Analysis**: ${analysis || 'No prior analysis available.'}

**Requirements**:
- **Price Trend**: Predict short-term movement (increase, decrease, sideways) using detailed RSI (current value), MACD (signal lines), moving averages (50-day, 200-day with values), sentiment scores, economic indicators, stock market trends, and political news. Include probability estimates and scenarios.
- **Likelihood Table**: Provide probabilities for each trend (total 100%), with explanations.
- **Key Factors**: List 5-7 factors influencing the prediction (e.g., RSI levels, volume spikes, Fed rates with latest data, political events with dates), backed by source data.
- **Scenario Analysis**: Describe bullish, bearish, and neutral scenarios with potential price targets and triggers.
- **Risk Assessment**: Highlight risks and volatility measures (e.g., ATR, beta).
- **Conclusion**: Summarize prediction with balanced, actionable observations.
- **Sources**: Include relevant links in [text](url) format from Brave API results, at least 5-10 sources.
`;

          const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.accessToken || ''}`,
            },
            body: JSON.stringify({
              prompt,
              deepSearch: true,
              tokenSymbol: selectedToken.symbol?.toUpperCase(),
              recaptchaToken,
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`HTTP error! status: ${response.status}, detail: ${errorData.detail || 'Unknown error'}`);
          }

          const reader = response.body.getReader();
          let result = '';
          let links = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            result += chunk;

            const lines = chunk.split('\n');
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.progress) {
                  setAnalysisLogs((prev) => [...prev, parsed.progress]);
                } else if (parsed.answer) {
                  result = parsed.answer || 'No prediction data received.';
                  links = parsed.links || [];
                }
              } catch (e) {
                console.warn('Partial chunk, skipping parse:', e.message);
              }
            }
          }

          return { content: result, links };
        };

        const { content, links } = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.DEFAULT, 0, true, session, status);
        setPrediction(content);
        setAnalysisLinks(links);
      } catch (error) {
        let errorMessage = 'Error predicting price. Please try again.';
        if (error.name === 'AbortError') {
          errorMessage = 'Request took too long. Please check your network connection and try again.';
        } else if (error.message.includes('HTTP error')) {
          errorMessage = error.message;
        } else if (error.message.includes('reCAPTCHA')) {
          errorMessage = 'reCAPTCHA verification error. Please try again.';
        }
        console.error(`Prediction error for ${selectedToken?.symbol || 'unknown'}: ${error.message}`, {
          error,
          status: error.response?.status,
          data: error.response?.data,
        });
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        // Preserve existing prediction data
        if (!localCache.current[cacheKey]?.data) {
          setPrediction(prediction); // Keep previous prediction if available
        }
      } finally {
        setIsPredicting(false);
        if (recaptchaRef.current) {
          recaptchaRef.current.reset();
        }
      }
    }, 500),
    [selectedToken, priceHistory, analysis, currency, session, status, executeRecaptcha, toast, prediction]
  );

  const debouncedSearch = useCallback(
    debounce((query) => {
      if (!query) {
        setSearchResults([]);
      }
    }, 300),
    []
  );

  const { data: trendingData, error: trendingSWRError } = useSWR(
    ['/api/coingecko', { action: 'trending', vs_currency: currency }],
    ([url, params]) => getCachedData(`trending-tokens-${currency}`, () => fetcher(url, params), CACHE_DURATIONS.TRENDING),
    {
      refreshInterval: CACHE_DURATIONS.TRENDING,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: CACHE_DURATIONS.TRENDING,
      onSuccess: (data) => {
        if (!Array.isArray(data)) {
          console.error('Trending data is not an array:', data);
          setTrendingError('Invalid trending data format');
          setTrendingTokens([]);
          toast.error('Invalid trending data format', { position: 'top-center', autoClose: 3000 });
          return;
        }
        setTrendingTokens(data);
        setTrendingError(null);
        setIsLoadingTrending(false);
      },
      onError: (err) => {
        const errorMessage =
          err.response?.status === 429
            ? 'CoinGecko API rate limit exceeded. Please try again in a few minutes.'
            : err.response?.status === 404
              ? 'No trending token data found.'
              : err.response?.data?.detail || `Failed to load trending tokens: ${err.message}`;
        setTrendingError(errorMessage);
        setTrendingTokens([]);
        setIsLoadingTrending(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 3000 });
      },
    }
  );

  const { data: searchData, error: searchError } = useSWR(
    searchQuery ? ['/api/coingecko', { action: 'search', query: searchQuery }] : null,
    ([url, params]) => fetcher(url, params),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onSuccess: (data) => {
        const results = data.map((coin) => ({
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          image: coin.image || '/fallback-image.webp',
          market_cap_rank: coin.market_cap_rank,
        }));
        setSearchResults(results.slice(0, 10));
      },
      onError: (err) => {
        setError(
          err.response?.status === 429
            ? 'API rate limit reached. Please wait a minute and try again.'
            : err.response?.data?.detail || 'Failed to search coins.'
        );
        setSearchResults([]);
      },
    }
  );

  useEffect(() => {
    warmUpCache();
  }, [warmUpCache]);

  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  const { data: marketData, error: marketError } = useSWR(
    ['/api/coingecko', { start: 1, limit: tokensPerPage, vs_currencies: availableCurrencies.join(',') }],
    ([url, params]) => fetcher(url, params),
    {
      refreshInterval: typeof document !== 'undefined' && document.visibilityState === 'visible' ? 30 * 1000 : 0,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      onError: (err) => {
        console.error('Market data fetch failed:', err);
        setError(err.message || 'Failed to load market data');
        setLoading(false);
      },
    }
  );

  useEffect(() => {
    if (marketError) {
      const errorMessage =
        marketError.response?.status === 429
          ? 'API rate limit reached. Please wait a minute and try again.'
          : marketError.response?.data?.detail || 'Failed to load market data.';
      console.error('Market data error:', marketError);
      setError(errorMessage);
      setLoading(false);
      toast.error(errorMessage, { position: 'top-center', autoClose: 3000 });
    } else if (marketData) {
      if (!Array.isArray(marketData)) {
        console.error('Market data is not an array:', marketData);
        setError('Invalid market data format');
        setLoading(false);
        toast.error('Invalid market data format', { position: 'top-center', autoClose: 3000 });
        return;
      }

      const tokensWithRoi = marketData.map((token) => ({
        id: token.id,
        symbol: token.symbol,
        name: token.name,
        image: token.image || '/fallback-image.webp',
        roi: token.roi || null,
        current_price: token.current_price || {},
        market_cap: token.market_cap || {},
        total_volume: token.total_volume || {},
        high_24h: token.high_24h || {},
        low_24h: token.low_24h || {},
        price_change_percentage_24h: token.price_change_percentage_24h || 0,
        market_cap_rank: token.market_cap_rank || null,
      }));
      setTokens(tokensWithRoi);

      if (
        !initialTokenSlug &&
        !initialTokenData &&
        !selectedToken &&
        !lastFetchedTokenRef.current &&
        !isTokenPage
      ) {
        const btc = tokensWithRoi.find((token) => token.id === 'bitcoin');
        if (btc) {
          debouncedHandleTokenSelect(btc, null);
        } else {
          console.warn('Bitcoin not found in market data');
          setError('Default token (Bitcoin) not found in market data');
          toast.error('Failed to select default token', { position: 'top-center', autoClose: 3000 });
        }
      }
      setLoading(false);
    } else {
      setLoading(true);
    }
  }, [marketData, marketError, initialTokenSlug, initialTokenData, selectedToken, debouncedHandleTokenSelect, toast]);

  useEffect(() => {
    fetchSupportedChains();
  }, [fetchSupportedChains]);

  useEffect(() => {
    if (selectedToken && timeRange && document.visibilityState === 'visible') {
      const tokenId = selectedToken.id;
      fetchPriceHistory(tokenId, timeRange, (err, data) => {
        if (err) {
          setError(
            err.response?.status === 429
              ? 'API rate limit reached. Please wait a minute and try again.'
              : err.response?.data?.detail || 'Failed to load price history.'
          );
        }
      });
      const interval = setInterval(() => {
        if (selectedToken && timeRange && document.visibilityState === 'visible') {
          const tokenId = selectedToken.id;
          fetchPriceHistory(tokenId, timeRange, (err, data) => {
            if (err) {
              // Handle error silently
            }
          });
        }
      }, CACHE_DURATIONS.PRICE);
      return () => {
        clearInterval(interval);
        fetchPriceHistory.cancel && fetchPriceHistory.cancel();
      };
    }
  }, [selectedToken, timeRange, currency, fetchPriceHistory, setError]);

  useEffect(() => {
    debouncedSearch(searchQuery);
    return () => debouncedSearch.cancel();
  }, [searchQuery, debouncedSearch]);

  useEffect(() => {
    if (!selectedToken?.id || document.visibilityState !== 'visible') return;

    const tokenSymbol = selectedToken.id.toLowerCase();
    const isNonEvmChain = NON_EVM_CHAINS.includes(tokenSymbol);

    if (isNonEvmChain) {
      const tokenKey = `${selectedToken.id}-top-holders`;
      if (lastFetchedTokenRef.current === tokenKey && onChainData.topHolders.length > 0) {
        return;
      }
      setIsLoadingOnChain(true);
      setOnChainData((prev) => ({ ...prev, topHolders: [] }));
      setOnChainError(null);
      lastFetchedTokenRef.current = tokenKey;
      fetchPublicTreasuryData(tokenSymbol);
      return;
    }

    // Special case for BNB
    if (tokenSymbol === 'binancecoin') {
      setIsLoadingOnChain(true);
      setOnChainData((prev) => ({ ...prev, topHolders: [] }));
      setOnChainError(null);

      const fetchBnbHolders = async () => {
        const chainsToFetch = [];
        const bnbChain = {
          chain: 'bnb',
          tokenAddress: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
          decimalPlace: 18,
        };
        chainsToFetch.push(bnbChain);

        const ethPlatform = selectedToken.detail_platforms?.ethereum;
        if (ethPlatform?.contract_address?.match(/^0x[a-fA-F0-9]{40}$/)) {
          chainsToFetch.push({
            chain: 'ethereum',
            tokenAddress: ethPlatform.contract_address.toLowerCase(),
            decimalPlace: Number(ethPlatform.decimal_place) || 18,
          });
        }

        const topHoldersPromises = chainsToFetch.map(async ({ chain, tokenAddress, decimalPlace }) => {
          try {
            const cacheKey = `onchain-${chain}-${tokenAddress}-top-holders`;
            const fetchFn = async () => {
              const recaptchaToken = await executeRecaptcha('top-holders');
              const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://xynapse-ai.vercel.app'}/api/sim`, {
                method: 'POST',
                headers: {
                  Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
                  'Content-Type': 'application/json',
                  'x-recaptcha-token': recaptchaToken,
                },
                body: JSON.stringify({
                  action: 'top-holders',
                  chain,
                  tokenAddress,
                  decimalPlace,
                }),
                signal: AbortSignal.timeout(30000),
              });

              if (!response.ok) {
                const text = await response.text();
                let errorMessage = `Failed to fetch top-holders data: ${response.status} ${response.statusText}`;
                try {
                  const result = JSON.parse(text);
                  errorMessage = result.detail || errorMessage;
                } catch {
                  errorMessage = `Failed to fetch top-holders data: Invalid JSON response`;
                }
                throw new Error(errorMessage);
              }

              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let data = [];
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
                        data.push({ ...parsedObj, chain }); // Add chain info
                      } catch (parseError) {
                        console.warn(`Failed to parse object: ${parseError.message}`, { objStr });
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
                      data.push({ ...parsed, chain });
                    } else {
                      throw new Error(parsed.detail);
                    }
                  } catch (e) {
                    console.error(`Error parsing final buffer: ${e.message}`, { buffer });
                  }
                }
              }

              return data;
            };

            let holders = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TOP_HOLDERS);

            // If chain is 'bnb', merge with bnb-top-holders.json
            if (chain === 'bnb') {
              const jsonHolders = Object.values(bnbNameTags).map((holder) => ({
                address: holder.Address.toLowerCase(),
                balance: parseFloat(holder.Balance) || 0,
                nameTag: holder.Labels['binance-smart-chain']?.['Name Tag'] || null,
                image: holder.Labels['binance-smart-chain']?.image || null,
                source: 'JSON',
                chain: 'bnb',
              }));

              // Merge holders from API and JSON, remove duplicates by address
              const uniqueAddresses = new Set();
              const mergedHolders = [
                ...holders.filter((holder) => {
                  const addr = holder.address.toLowerCase();
                  if (!uniqueAddresses.has(addr)) {
                    uniqueAddresses.add(addr);
                    return true;
                  }
                  return false;
                }),
                ...jsonHolders.filter((holder) => {
                  const addr = holder.address.toLowerCase();
                  if (!uniqueAddresses.has(addr)) {
                    uniqueAddresses.add(addr);
                    return true;
                  }
                  return false;
                }),
              ];

              // Sort by balance and take top 100
              holders = mergedHolders.sort((a, b) => b.balance - a.balance).slice(0, 100);
            }

            return holders;
          } catch (error) {
            console.error(`Error fetching top holders for ${chain}: ${error.message}`);
            return [];
          }
        });

        try {
          const results = await Promise.all(topHoldersPromises);
          const mergedHolders = results.flat().sort((a, b) => b.balance - a.balance).slice(0, 100); // Limit to top 100 holders
          setOnChainData((prev) => ({
            ...prev,
            topHolders: mergedHolders,
          }));
          if (mergedHolders.length === 0) {
            setOnChainError('No top holders data available for BNB on supported chains.');
          }
        } catch (error) {
          setOnChainError(`Failed to fetch top holders for BNB: ${error.message}`);
          toast.error(`Failed to fetch top holders for BNB: ${error.message}`, { position: 'top-center', autoClose: 5000 });
        } finally {
          setIsLoadingOnChain(false);
          if (recaptchaRef.current) {
            recaptchaRef.current.reset();
          }
        }
      };

      const tokenKey = `binancecoin-multichain`;
      if (lastFetchedTokenRef.current !== tokenKey) {
        lastFetchedTokenRef.current = tokenKey;
        fetchBnbHolders();
      }
      return;
    }

    // Existing logic for other tokens
    const { chain, tokenAddress, decimalPlace } = getDefaultChainAndAddress(selectedToken, selectedChain);
    const tokenKey = `${selectedToken.id}-${chain}-${tokenAddress}-${decimalPlace}`;

    if (lastFetchedTokenRef.current === tokenKey && onChainData.topHolders.length > 0) {
      return;
    }

    setIsLoadingOnChain(true);
    setOnChainData((prev) => ({ ...prev, topHolders: [] }));
    setOnChainError(null);

    if (!chain || !tokenAddress) {
      setIsLoadingOnChain(false);
      setOnChainError('This token does not have on-chain data available on supported chains.');
      return;
    }

    lastFetchedTokenRef.current = tokenKey;
    fetchOnChainData(chain, tokenAddress, 'top-holders', decimalPlace);
  }, [selectedToken?.id, selectedChain, fetchPublicTreasuryData, getDefaultChainAndAddress, fetchOnChainData, executeRecaptcha, session, toast]);

  useEffect(() => {
    prevTopHoldersRef.current = onChainData.topHolders;
  }, [onChainData.topHolders]);

  useEffect(() => {
    if (walletBalances.length > 0 || walletBalancesError) {
      setIsLoadingWalletBalances(false);
    }
  }, [walletBalances, walletBalancesError]);

  useEffect(() => {
    if (!selectedToken?.id) {
      setTickerData([]);
      return;
    }
    fetchTickerData(selectedToken.id);
  }, [selectedToken?.id, fetchTickerData]);

  useEffect(() => {
    async function fetchDailyMarketInteractions() {
      if (session?.user?.id) {
        try {
          const response = await axios.get(`/api/daily-ai-interactions?uid=${session.user.id}&interactionType=market`);
          if (response.data.success) {
            setDailyMarketInteractions(response.data.pointsCount);
          }
        } catch (err) {
          // Handle error silently
        }
      }
    }
    fetchDailyMarketInteractions();
  }, [session]);

  useEffect(() => {
    if (onChainData.topHolders.length > 0) {
      const addresses = onChainData.topHolders
        .map((holder) => holder.address)
        .filter((addr) => addr && !nameTags[addr.toLowerCase()]);
      if (addresses.length > 0) {
        fetchNameTagsForAddresses(addresses);
      } else {
        setIsLoadingNameTags(false);
      }
    } else {
      setIsLoadingNameTags(false);
    }
  }, [onChainData.topHolders, fetchNameTagsForAddresses, nameTags]);

  useEffect(() => {
    if (!selectedToken?.id || ['bitcoin', 'ethereum'].includes(selectedToken.id.toLowerCase()) || document.visibilityState !== 'visible') {
      return;
    }

    const { chain, tokenAddress } = getDefaultChainAndAddress(selectedToken, selectedChain);
    if (!chain || !tokenAddress) {
      return;
    }

    // Initial fetch
    fetchDexData(chain, tokenAddress);

    // Set up interval for background refresh
    const interval = setInterval(() => {
      const cacheKey = `${GECKOTERMINAL_CHAIN_MAPPING[chain]}-${tokenAddress}`;
      const cached = tickerCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_DURATIONS.DEFI_POOL) {
        return;
      }
      if (document.visibilityState === 'visible') {
        fetchDexData(chain, tokenAddress);
      }
    }, CACHE_DURATIONS.DEFI_POOL);

    return () => {
      clearInterval(interval);
      fetchDexData.cancel && fetchDexData.cancel();
    };
  }, [selectedToken?.id, selectedChain, getDefaultChainAndAddress, fetchDexData, tickerCache]);

  useEffect(() => {
    if (selectedWallet && selectedWallet.match(/^0x[a-fA-F0-9]{40}$/)) {
      fetchNameTag(selectedWallet);
    }
  }, [selectedWallet, fetchNameTag]);

  return {
    dailyMarketInteractions,
    setDailyMarketInteractions,
    analysis,
    setAnalysis,
    analysisLinks,
    setAnalysisLinks,
    setPrediction,
    tokens,
    loading,
    error,
    selectedToken,
    setSelectedToken,
    selectedPair,
    selectedChain,
    analysis,
    prediction,
    priceHistory,
    timeRange,
    searchQuery,
    searchResults,
    isDropdownOpen,
    analysisLinks,
    isAnalyzing,
    isPredicting,
    onChainData,
    activeTab,
    walletAddress,
    selectedNetwork,
    isLoadingOnChain,
    onChainError,
    selectedWallet,
    setSelectedWallet,
    walletBalances,
    setWalletBalances,
    isLoadingWalletBalances,
    setIsLoadingWalletBalances,
    walletBalancesError,
    setWalletBalancesError,
    transactions,
    setTransactions,
    isLoadingTransactions,
    setTransactionsError,
    walletSearchCount,
    setWalletSearchCount,
    lastWalletSearchTime,
    setLastWalletSearchTime,
    fetchPriceHistory,
    setPriceHistory,
    debouncedHandleTokenSelect,
    tickerData,
    isLoadingTickers,
    tickerError,
    tickerCache,
    nameTags,
    isLoadingNameTags,
    fetchNameTag,
    fetchNameTagsForAddresses,
    setSearchQuery,
    setIsDropdownOpen,
    setSelectedChain,
    setTimeRange,
    setWalletAddress,
    setError,
    debouncedHandleAnalysis,
    debouncedHandlePrediction,
    handleWalletSearch,
    fetchTransactions,
    fetchOnChainData,
    handleAddressClick,
    getAvailableChains,
    getDefaultChainAndAddress,
    fetchPublicTreasuryData,
    fetchTickerData,
    chains,
    fetchSupportedChains,
    dexData,
    dexError,
    fetchDexData,
    dexRequestCount,
    lastDexRequestTime,
    isLoadingDex,
    lastDexFetchTime,
    setLastDexFetchTime,
    blockchairRequestCount,
    setBlockchairRequestCount,
    lastBlockchairRequestTime,
    setLastBlockchairRequestTime,
    currency, // Add currency
    setCurrency, // Add setCurrency
    availableCurrencies,
    trendingTokens,
    isLoadingTrending,
    trendingError,
    fetchTrendingTokens,
    isLoadingSelectedToken, // Add new state
    localCache,
    // Constants
    SUPPORTED_CHAINS,
    WALLET_SEARCH_LIMIT,
    WALLET_SEARCH_WINDOW,
    BLOCKCHAIR_REQUEST_LIMIT,
    BLOCKCHAIR_REQUEST_WINDOW,
    NON_EVM_CHAINS,
    lastFetchedTokenRef,
    // Refs
    lastFetchedTokenRef,
    prevTopHoldersRef,
    prevAvailableChainsRef,
    blockchairCache,
    analysisLogs,
    setIsAnalyzing,
    setIsPredicting,
    mempoolTransactions,
    isLoadingMempool,
    mempoolError,
    fetchMempoolTransactions,
  };
};