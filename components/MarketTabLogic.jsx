'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import debounce from 'lodash.debounce';
import rateLimit from 'axios-rate-limit';
import pLimit from 'p-limit';
import { GECKOTERMINAL_CHAIN_MAPPING, SUPPORTED_CHAINS, CHAIN_MAPPING } from '../utils/constants';
import btcNameTags from '../public/nametags/btc-top-holders.json';
import useSWR from 'swr';
import Bottleneck from 'bottleneck';
import axiosRetry from 'axios-retry';

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
  PRICE: 5 * 60 * 1000, // 2 phút
  METADATA: 4 * 60 * 60 * 1000, // 4 giờ
  TRANSACTIONS: 2 * 60 * 1000, // 2m
  DEFI_POOL: 4 * 60 * 60 * 1000, // 30 giây
  DEFAULT: 4 * 60 * 60 * 1000, // 5 phút
  TICKERS: 60 * 60 * 1000, // 1 giờ (tăng từ 30 phút)
  TRENDING: 5 * 60 * 60 * 1000, // 1 giờ (tăng từ 30 phút)
  NAMETAGS: 48 * 60 * 60 * 1000, // 24 giờ
  TOP_HOLDERS: 12 * 60 * 60 * 1000, // 12 giờ
};

if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === 'production') {
  console.warn('NEXT_PUBLIC_APP_URL is not set, defaulting to https://xynapse-ai.vercel.app');
}

const NON_EVM_CHAINS = ['bitcoin', 'ethereum', 'dogecoin'];
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

  const isTokenPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/token/');

  const getCachedData = async (key, fetchFn, ttl = CACHE_DURATIONS.DEFAULT, retryCount = 0) => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://xynapse-ai.vercel.app';
    try {
      // Check local cache first
      const localCached = localCache.current[key];
      if (localCached && Date.now() - localCached.timestamp < ttl) {
        console.log(`Local cache hit for ${key}`);
        // Schedule background refresh only if cache is fully expired
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
                console.log(`Background cache updated for ${key}`);
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
          console.log(`Redis cache hit for ${key}`);
          localCache.current[key] = { data: cacheResponse.data.data, timestamp: Date.now() };
          localCache.current[`${key}_last_update`] = Date.now();
          // Schedule background refresh if cache is older than 75% of TTL
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
                  console.log(`Background cache updated for ${key}`);
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
          return getCachedData(key, fetchFn, ttl, retryCount + 1);
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
        console.log(`Cached data for ${key}`);
        return data || [];
      }
      return [];
    } catch (error) {
      if (retryCount < 3 && (error.response?.status === 429 || error.code === 'ECONNABORTED')) {
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return getCachedData(key, fetchFn, ttl, retryCount + 1);
      }
      console.error(`Cache or fetch error for ${key}:`, error.message);
      return [];
    }
  };

  // Cache warmup cho trending tokens và top tokens
  const warmUpCache = useCallback(async () => {
    const cacheTrending = async () => {
      const cacheKey = `trending-tokens-${currency}`;
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
      await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TRENDING);
    };

    const cacheTopTokens = async () => {
      const cacheKey = `market-info-default-${currency}`;
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
      await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.DEFAULT);
    };
    await Promise.all([cacheTrending(), cacheTopTokens()]);
  }, [currency]);

  const executeRecaptcha = useCallback(
    async (action, retryCount = 0) => {
      if (!recaptchaRef.current) {
        throw new Error('reCAPTCHA is not initialized.');
      }
      try {
        const token = await Promise.race([
          recaptchaRef.current.executeAsync({ action }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 10000)),
        ]);
        if (!token) {
          throw new Error('Empty reCAPTCHA token.');
        }
        return token;
      } catch (error) {
        if (retryCount < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
          return executeRecaptcha(action, retryCount + 1);
        }
        throw new Error('Unable to execute reCAPTCHA: ' + error.message);
      }
    },
    [recaptchaRef]
  );

  const fetchSupportedChains = useCallback(async (retryCount = 0) => {
    const cacheKey = 'supported-chains';
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://xynapse-ai.vercel.app';

    // Kiểm tra cache cục bộ và thời gian cache (48 giờ)
    const cachedChains = localCache.current[cacheKey]?.data;
    if (cachedChains && Date.now() - localCache.current[cacheKey]?.timestamp < 48 * 60 * 60 * 1000) {
      setChains(cachedChains);
      console.log(`Using local cache for supported chains: ${cachedChains.length} chains`);
      return;
    }

    // Ngăn gọi lại nếu đang tải hoặc đã tải gần đây
    if (isFetchingChainsRef.current || (Date.now() - lastFetchedChainsRef.current < 48 * 60 * 60 * 1000 && chains.length > 0)) {
      console.log(`Skipping fetchSupportedChains: ${isFetchingChainsRef.current ? 'Already fetching' : 'Recently fetched'}`);
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
        console.log(`Redis cache hit for supported chains: ${cacheResponse.data.data.length} chains`);
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
        const imageUrl = coingeckoChain?.image?.large || '/fallback-image.png';
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

      // Lưu vào cache cục bộ và Redis
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
      console.log(`Successfully fetched ${mappedChains.length} chains`);
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
        image: '/fallback-image.png',
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
  }, [toast]);

  useEffect(() => {
    if (chains.length === 0 && !isFetchingChainsRef.current && Date.now() - lastFetchedChainsRef.current > 48 * 60 * 60 * 1000) {
      fetchSupportedChains();
    }
  }, [fetchSupportedChains, chains.length]);

  const fetchPoolTokenMetadata = useCallback(
    async (chain, poolAddress, retryCount = 0) => {
      const cacheKey = `pool-${GECKOTERMINAL_CHAIN_MAPPING[chain]}-${poolAddress}`;
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

        return await getCachedData(cacheKey, fetchFn);
      } catch (error) {
        if (retryCount < 3 && error.response?.status === 429) {
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100; // Exponential backoff với jitter
          await new Promise((resolve) => setTimeout(resolve, delay));
          return fetchPoolTokenMetadata(chain, poolAddress, retryCount + 1);
        }
        return {};
      }
    },
    []
  );

  const fetchNameTag = useCallback(
    async (address) => {
      if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
        console.log(`Invalid address for fetchNameTag: ${address}`);
        return { nameTag: null, image: null };
      }

      const normalizedAddress = address.toLowerCase();
      const cached = nameTagsRef.current[normalizedAddress];
      if (cached && Date.now() - cached.timestamp < NAME_TAG_CACHE_DURATION) {
        console.log(`Cache hit for nametag: ${normalizedAddress}`);
        return { nameTag: cached.nameTag, image: cached.image };
      }

      try {
        if (status !== 'authenticated') {
          console.log('Unauthenticated fetchNameTag attempt');
          throw new Error('Unauthorized: Please log in to fetch Name Tag.');
        }

        const response = await axios.get(`/api/nametags`, {
          params: { address: normalizedAddress },
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
          timeout: 5000,
        });

        console.log(`fetchNameTag response for ${normalizedAddress}:`, JSON.stringify(response.data, null, 2));

        if (!response.data.success || !response.data.data?.[normalizedAddress]) {
          const cacheEntry = { nameTag: null, image: null, timestamp: Date.now() };
          nameTagsRef.current[normalizedAddress] = cacheEntry;
          setNameTags((prev) => ({
            ...prev,
            [normalizedAddress]: cacheEntry,
          }));
          console.log(`No nametag found for ${normalizedAddress}`);
          return { nameTag: null, image: null };
        }

        const data = response.data.data[normalizedAddress];
        const nameTag = data.Labels?.deposit?.['Name Tag'] || null;
        const image = data.Labels?.deposit?.image || '/icons/default.png';
        const cacheEntry = { nameTag, image, timestamp: Date.now() };
        nameTagsRef.current[normalizedAddress] = cacheEntry;
        setNameTags((prev) => ({
          ...prev,
          [normalizedAddress]: cacheEntry,
        }));
        console.log(`Nametag fetched for ${normalizedAddress}: ${nameTag}, image: ${image}`);
        return { nameTag, image };
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
        console.log('No addresses provided for fetchNameTagsForAddresses');
        setIsLoadingNameTags(false);
        return;
      }

      setIsLoadingNameTags(true);
      const newNameTags = {};

      // Xử lý BTC addresses
      const btcAddresses = addresses.filter((addr) => !addr.match(/^0x[a-fA-F0-9]{40}$/));
      btcAddresses.forEach((addr) => {
        const normalizedAddress = addr.toLowerCase();
        const nameTagData = btcNameTags[normalizedAddress]?.Labels?.bitcoin || {};
        newNameTags[normalizedAddress] = {
          nameTag: nameTagData['Name Tag'] || null,
          image: nameTagData.image || null,
          timestamp: Date.now(),
        };
      });

      // Xử lý EVM addresses với batching
      const evmAddresses = addresses.filter((addr) => addr.match(/^0x[a-fA-F0-9]{40}$/));
      if (evmAddresses.length > 0 && status === 'authenticated') {
        try {
          const batchSize = 50; // Giới hạn batch size để tránh timeout
          const batches = [];
          for (let i = 0; i < evmAddresses.length; i += batchSize) {
            batches.push(evmAddresses.slice(i, i + batchSize));
          }

          const batchPromises = batches.map((batch) =>
            cacheLimiter.schedule(() =>
              axios.post(
                `/api/nametags`,
                { addresses: batch },
                {
                  headers: {
                    Authorization: `Bearer ${session?.accessToken}`,
                  },
                  timeout: 40000,
                }
              )
            )
          );

          const responses = await Promise.allSettled(batchPromises);
          responses.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.data.success) {
              const batchAddresses = batches[index];
              batchAddresses.forEach((address) => {
                const normalizedAddress = address.toLowerCase();
                const data = result.value.data.data?.[normalizedAddress];
                const nameTag = data?.Labels?.deposit?.['Name Tag'] || null;
                const image = data?.Labels?.deposit?.image || '/icons/default.png';
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
        console.log('Unauthenticated fetchNameTagsForAddresses attempt');
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
      console.log(`Updated nameTags for ${Object.keys(newNameTags).length} addresses`);
    },
    [session, status, toast]
  );

  const fetchPriceHistory = useCallback(
    debounce(
      async (tokenId, days, callback = () => { }, retryCount = 0) => { // Add default empty callback
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

        const cacheKey = `price-history-${tokenId}-${days}-${currency}`;
        setIsLoadingSelectedToken(true);

        // Check local cache first
        const cachedData = localCache.current[cacheKey]?.data;
        if (cachedData) {
          setPriceHistory(cachedData);
          console.log(`Using cached price history for ${tokenId}`);
          callback(null, cachedData); // Call callback with cached data
        }

        try {
          const fetchFn = async () => {
            const response = await axios.get('/api/coingecko/market_chart', {
              params: { id: tokenId, days, currency },
              timeout: 30000,
            });

            if (!response.data?.prices || !Array.isArray(response.data.prices) || response.data.prices.length === 0) {
              throw new Error('Invalid or empty price history data');
            }

            console.log('Raw API prices:', response.data.prices);

            const invalidTimestamps = response.data.prices.filter(([timestamp, price]) =>
              typeof timestamp !== 'number' || isNaN(timestamp) || typeof price !== 'number' || isNaN(price)
            );
            if (invalidTimestamps.length > 0) {
              console.warn('Invalid timestamps in API response:', invalidTimestamps);
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

          const priceData = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.PRICE);
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
          if (!cachedData) {
            setPriceHistory([]);
          }
        } finally {
          setIsLoadingSelectedToken(false);
        }
      },
      300,
      { leading: false, trailing: true }
    ),
    [currency, chains, setPriceHistory, setError, toast]
  );

  const fetchPublicTreasuryData = useCallback(
    debounce(
      async (tokenSymbol, retryCount = 0) => {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://xynapse-ai.vercel.app';
        const normalizedTokenSymbol = tokenSymbol?.toLowerCase();
        if (!NON_EVM_CHAINS.includes(normalizedTokenSymbol)) {
          setOnChainError(`Unsupported chain: ${normalizedTokenSymbol}`);
          setIsLoadingOnChain(false);
          return;
        }

        const chain = normalizedTokenSymbol;
        const cacheKey = `blockchair-${chain}-top-holders`;
        setIsLoadingOnChain(true);
        setOnChainError(null);

        // Check local cache first
        const cachedData = localCache.current[cacheKey]?.data;
        if (cachedData) {
          setOnChainData((prev) => ({
            ...prev,
            topHolders: cachedData,
          }));
          console.log(`Using cached top holders for ${chain}`);
        }

        try {
          const fetchFn = async () => {
            const recaptchaToken = await executeRecaptcha('blockchair_top_holders');
            const blockchairResponse = await axios.post(
              `${API_BASE_URL}/api/blockchair`,
              { chain, limit: 100 },
              {
                headers: {
                  'Content-Type': 'application/json',
                  ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
                  'x-recaptcha-token': recaptchaToken,
                },
                timeout: 20000,
              }
            );

            if (!blockchairResponse.data.success || !Array.isArray(blockchairResponse.data.data)) {
              throw new Error(blockchairResponse.data.detail || `No top holders data for ${chain}`);
            }

            let topHolders = blockchairResponse.data.data.map((holder) => ({
              address: holder.address,
              balance: parseFloat(holder.balance) || 0,
              share: parseFloat(holder.share) || 0,
              nameTag: btcNameTags[holder.address.toLowerCase()]?.Labels?.bitcoin?.['Name Tag'] || null,
              image: btcNameTags[holder.address.toLowerCase()]?.Labels?.bitcoin?.image || null,
              source: 'Blockchair',
            }));

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
                  const treasuryData = coingeckoResponse.data.data.companies.map((company) => ({
                    address: company.address || company.name || 'Unknown',
                    balance: parseFloat(company.total_holdings) || 0,
                    share: parseFloat(company.total_value_usd) / (company.total_holdings || 1) || 0,
                    nameTag: company.name || null,
                    image: null,
                    source: 'CoinGecko',
                  }));

                  const uniqueAddresses = new Set(topHolders.map((holder) => holder.address.toLowerCase()));
                  topHolders = [
                    ...topHolders,
                    ...treasuryData.filter((company) => !uniqueAddresses.has(company.address.toLowerCase())),
                  ].sort((a, b) => b.balance - a.balance).slice(0, 100);
                }
              } catch (coingeckoError) {
                console.warn(`CoinGecko treasury fetch failed for ${chain}:`, coingeckoError.message);
              }
            }

            if (topHolders.length === 0) {
              throw new Error(`No top holders data available for ${chain}`);
            }

            return topHolders;
          };

          const topHolders = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TOP_HOLDERS);
          setOnChainData((prev) => ({
            ...prev,
            topHolders,
          }));
        } catch (error) {
          const errorMessage =
            error.response?.status === 429
              ? 'API rate limit exceeded. Please try again later.'
              : error.response?.data?.detail || `Failed to fetch top holders for ${chain}`;
          setOnChainError(errorMessage);
          if (retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 100;
            await new Promise((resolve) => setTimeout(resolve, delay));
            fetchPublicTreasuryData(tokenSymbol, retryCount + 1);
          } else {
            toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
            // Keep cached data if available
            if (!cachedData) {
              setOnChainData((prev) => ({
                ...prev,
                topHolders: [],
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
    [toast, executeRecaptcha, session]
  );

  const fetchTickerData = useCallback(
    debounce(
      async (tokenId, retryCount = 0) => {
        if (!tokenId || document.visibilityState !== 'visible') return;
        const cacheKey = `ticker-${tokenId}`;
        setIsLoadingTickers(true);
        setTickerError(null);

        // Check local cache first
        const cachedData = localCache.current[cacheKey]?.data;
        if (cachedData) {
          setTickerData(cachedData);
          console.log(`Using cached ticker data for ${tokenId}`);
        } else {
          setTickerData([]);
        }

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

          const tickers = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TICKERS);
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
          // Keep cached data if available
          if (!cachedData) {
            setTickerData([]);
          }
        } finally {
          setIsLoadingTickers(false);
        }
      },
      300
    ),
    []
  );

  const fetchOnChainData = useCallback(
    debounce(
      async (chain, tokenAddress, action, decimalPlace, address, recaptchaToken, retryCount = 0) => {
        // Validate parameters
        if (
          (action === 'top-holders' && (!chain || !tokenAddress || !tokenAddress.match(/^0x[a-fA-F0-9]{40}$/))) ||
          ((action === 'wallet-balances' || action === 'transactions') && !address?.match(/^0x[a-fA-F0-9]{40}$/)) ||
          (typeof document !== 'undefined' && document.visibilityState !== 'visible')
        ) {
          const errorMessage = `Invalid parameters: action=${action}, chain=${chain}, address=${address || tokenAddress}`;
          console.error(errorMessage);
          setOnChainError(errorMessage);
          setIsLoadingOnChain(false);
          setIsLoadingWalletBalances(false);
          setIsLoadingTransactions(false);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          return;
        }

        if (status !== 'authenticated') {
          const errorMessage = 'Please log in to access on-chain data.';
          console.error(errorMessage);
          setOnChainError(errorMessage);
          setIsLoadingOnChain(false);
          setIsLoadingWalletBalances(false);
          setIsLoadingTransactions(false);
          // Xóa toast.error để tránh hiển thị thông báo
          // toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          return;
        }

        // Ensure chains are loaded, fallback to 'ethereum' if chain is invalid
        let simChain = chains.find((c) => c.value === chain)?.value;
        if (!simChain && action === 'top-holders') {
          simChain = 'ethereum'; // Fallback to 'ethereum'
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

        const cacheKey = `onchain-${simChain || 'wallet'}-${tokenAddress || address}-${action}`;
        setIsLoadingOnChain(action === 'top-holders');
        if (action === 'wallet-balances') setIsLoadingWalletBalances(true);
        else if (action === 'transactions') setIsLoadingTransactions(true);

        try {
          const fetchFn = async () => {
            const apiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://xynapse-ai.vercel.app'}/api/sim`;
            const payload = {
              action,
              recaptchaToken,
              chain: simChain,
              tokenAddress,
              ...(decimalPlace != null && { decimalPlace: Number(decimalPlace) }),
              ...(address && { address }),
            };

            console.log(`Starting fetchOnChainData for action: ${action}, address: ${address}, chain: ${simChain}, tokenAddress: ${tokenAddress}`);

            const response = await axios.post(apiUrl, payload, {
              headers: {
                Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
                'Content-Type': 'application/json',
                'x-recaptcha-token': recaptchaToken,
              },
              timeout: 30000,
            });

            const result = response.data;

            console.log(`Raw ${action} response:`, { address, response: result, status: response.status });

            if (!response.data.success) {
              throw new Error(result.detail || `Failed to fetch ${action} data: ${response.statusText}`);
            }

            if (!result.data) {
              throw new Error(result.detail || `No ${action} data returned`);
            }

            console.log(`Parsed ${action} data:`, { address, data: result.data });
            return result.data || [];
          };

          const ttl = action === 'transactions' ? CACHE_DURATIONS.TRANSACTIONS : CACHE_DURATIONS.DEFAULT;
          const data = await getCachedData(cacheKey, fetchFn, ttl);
          console.log(`Setting ${action} data:`, data);

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
                  : error.response?.data?.detail || `Failed to load ${action} data: ${error.message}`;
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
    [chains, status, session?.accessToken, toast, executeRecaptcha]
  );

  const fetchDexData = useCallback(
    debounce(
      async (chain, tokenAddress, retryCount = 0) => {
        if (status !== 'authenticated') {
          const errorMessage = 'Please log in to access DEX data.';
          setDexError(errorMessage);
          setIsLoadingDex(false);
          // Xóa toast.error để tránh hiển thị thông báo
          // toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
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

        const cacheKey = `dex-${geckoChain}-${tokenAddress}`;
        setIsLoadingDex(true);
        setDexError(null);

        const cachedData = localCache.current[cacheKey]?.data;
        if (cachedData && Date.now - localCache.current[cacheKey].timestamp < CACHE_DURATIONS.DEFI_POOL) {
          setDexData(cachedData);
          console.log(`Using cached DEX data for ${geckoChain}-${tokenAddress}`);
          setIsLoadingDex(false);
          return;
        }

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

          const dexData = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.DEFI_POOL);
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
          if (cachedData) {
            setDexData(cachedData);
          } else {
            setDexData({ pools: [], trades: [], poolTokens: {} });
          }
        } finally {
          setIsLoadingDex(false);
        }
      },
      300
    ),
    [toast, status, session, fetchPoolTokenMetadata]
  );

  const fetchTrendingTokens = useCallback(
    debounce(
      async (retryCount = 0) => {
        if (document.visibilityState !== 'visible') return;
        const cacheKey = `trending-tokens-${currency}`;
        setIsLoadingTrending(true);
        setTrendingError(null);

        // Check local cache first
        const cachedData = localCache.current[cacheKey]?.data;
        if (cachedData) {
          setTrendingTokens(cachedData);
          console.log(`Using cached trending tokens for ${currency}`);
        } else {
          setTrendingTokens([]);
        }

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

          const tokens = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.TRENDING);
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
          if (toast?.error) {
            toast.error(errorMessage, { position: 'top-center', autoClose: 3000 });
          } else {
            console.error('Toast error:', errorMessage);
          }
          // Keep cached data if available
          if (!cachedData) {
            setTrendingTokens([]);
          }
        } finally {
          setIsLoadingTrending(false);
        }
      },
      1000
    ),
    [currency, toast, getCachedData]
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
        console.log(`Opening Blockchair URL for BTC address: ${address}`);
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

      console.log(`Handling address click: ${address}`);
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
        console.log(`Executing reCAPTCHA for transactions, address: ${address}`);
        const recaptchaToken = await executeRecaptcha('transactions');
        console.log(`Fetching transactions for address: ${address}`);
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

      // Ensure chains array is not empty
      if (!chains || chains.length === 0) {
        console.warn('Chains array is empty, falling back to default chain: ethereum');
        return { chain: 'ethereum', tokenAddress: null, decimalPlace: null };
      }

      // Normalize platforms from token.detail_platforms
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

      // Filter available chains, excluding testnets in production
      const availableChains = chains.filter(
        (chain) =>
          normalizedPlatforms[chain.value] &&
          (process.env.NODE_ENV === 'development' || !chain.testnet)
      );

      // Prefer the provided chain if valid, otherwise fallback to available chains
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

      // Fallback to the first available chain
      if (availableChains.length > 0) {
        const defaultChain = availableChains[0].value;
        const tokenAddress = normalizedPlatforms[defaultChain].address;
        const decimalPlace = normalizedPlatforms[defaultChain].decimal_place;
        return { chain: defaultChain, tokenAddress, decimalPlace };
      }

      // Fallback tokens for specific cases
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

      // Set error if no valid chain or address is found
      setOnChainError('This token does not have on-chain data available on supported chains.');
      return { chain: 'ethereum', tokenAddress: null, decimalPlace: null };
    },
    [chains, setOnChainError]
  );

  const getAvailableChains = useCallback(() => {
    if (!selectedToken?.detail_platforms) return [];

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
        console.log(`Skipping debouncedHandleTokenSelect: Token ${token?.id} already selected or invalid`);
        return;
      }

      console.log('Selecting token:', token.id, 'Initial token data:', initialTokenData?.id);
      if (initialTokenData && initialTokenData.id === token.id) {
        setSelectedToken(initialTokenData);
        setSelectedPair(`${initialTokenData.symbol?.toUpperCase()}/${currency.toUpperCase()}`);
        const { chain } = getDefaultChainAndAddress(initialTokenData, selectedChain);
        setSelectedChain(chain || 'ethereum');
        setAnalysis(null);
        setPrediction(null);
        setAnalysisLinks([]);
        setIsDropdownOpen(false);
        setOnChainData({ topHolders: [], whaleActivity: [] });
        setOnChainError(null);
        lastFetchedTokenRef.current = token.id;
        console.log('lastFetchedTokenRef set to:', lastFetchedTokenRef.current);

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
        return;
      }

      const cacheKey = `token-metadata-${token.id}`;
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

          const marketData = responseData.data.market_data || {};
          return {
            id: responseData.data.id,
            symbol: responseData.data.symbol,
            name: responseData.data.name,
            image: responseData.data.image?.large,
            current_price: marketData.current_price || {},
            market_cap: marketData.market_cap || {},
            total_volume: marketData.total_volume || {},
            high_24h: marketData.high_24h || {},
            low_24h: marketData.low_24h || {},
            price_change_percentage_1h_in_currency: marketData.price_change_percentage_1h_in_currency || {},
            price_change_percentage_24h_in_currency: marketData.price_change_percentage_24h_in_currency || {},
            price_change_percentage_7d_in_currency: marketData.price_change_percentage_7d_in_currency || {},
            price_change_percentage_14d_in_currency: marketData.price_change_percentage_14d_in_currency || {},
            price_change_percentage_30d_in_currency: marketData.price_change_percentage_30d_in_currency || {},
            price_change_percentage_60d_in_currency: marketData.price_change_percentage_60d_in_currency || {},
            price_change_percentage_90d_in_currency: marketData.price_change_percentage_90d_in_currency || {},
            price_change_percentage_1y_in_currency: marketData.price_change_percentage_1y_in_currency || {},
            price_change_percentage_24h: marketData.price_change_percentage_24h,
            price_change_24h: marketData.price_change_24h || {},
            market_cap_change_24h: marketData.market_cap_change_24h || {},
            market_cap_change_percentage_24h: marketData.market_cap_change_percentage_24h,
            circulating_supply: marketData.circulating_supply,
            total_supply: marketData.total_supply,
            max_supply: marketData.max_supply,
            fully_diluted_valuation: marketData.fully_diluted_valuation || {},
            ath: marketData.ath || {},
            ath_change_percentage: marketData.ath_change_percentage || {},
            ath_date: marketData.ath_date || {},
            atl: marketData.atl || {},
            atl_change_percentage: marketData.atl_change_percentage || {},
            atl_date: marketData.atl_date || {},
            roi: marketData.roi || responseData.data.roi,
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

        const fullToken = await getCachedData(cacheKey, fetchFn, CACHE_DURATIONS.METADATA);
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
    [currency, availableCurrencies, timeRange, fetchPriceHistory, selectedChain, setError, executeRecaptcha, getDefaultChainAndAddress]
  );

  const debouncedHandleAnalysis = useCallback(
    debounce(async () => {
      if (!selectedToken) {
        setError('No token selected.');
        return;
      }
      if (status !== 'authenticated') {
        setError('Please log in to analyze token.');
        return;
      }
      setIsAnalyzing(true);
      try {
        const tokenAnalysisRecaptchaToken = await executeRecaptcha('analyze');
        const analysisResponse = await axios.post(
          '/api/token-analysis',
          {
            tokenSymbol: selectedToken.symbol,
            recaptchaToken: tokenAnalysisRecaptchaToken,
          },
          {
            headers: {
              Authorization: `Bearer ${session?.accessToken}`,
            },
          }
        );
        const { aiAnalysis, links } = analysisResponse.data;

        const prompt = `
Analyze **${selectedToken.symbol}** in Markdown format (250-300 words). Use **bold**, *italics*, tables, and concise language. Include *not investment advice*.

**Data**:
- **Current Price**: $${selectedToken.current_price?.toFixed(2) || 'N/A'}
- **24h Price Change**: ${selectedToken.price_change_percentage_24h?.toFixed(2) || 'N/A'}%
- **Market Cap**: $${selectedToken.market_cap?.toLocaleString() || 'N/A'}
- **Social Media/Web**: ${aiAnalysis || 'No analysis available.'}
- **Links**: ${JSON.stringify(links.map((link) => ({ link })))}

**Requirements**:
- **Overview**: Market performance, recent trends, and volatility.
- **US Economic Impact**: Effects of CPI, Non-Farm Payrolls, GDP, Fed rates with specific data points.
- **Stock Market Correlation**: Relation with S&P 500, Nasdaq, including recent index movements.
- **Political News Impact**: Influence of recent political events or policies on crypto market.
- **Sentiment**:
  - *Social Media*: Sentiment from Twitter/X posts, including key influencers.
  - *Web*: Insights from articles, focusing on credible sources.
- **Technical Analysis**:
  - *Price Patterns*: Support/resistance, moving averages (50-day, 200-day).
  - *Volume Trends*: Trading volume changes and implications.
- **Conclusion**: Summarize insights with actionable observations.

**Example Table**:
| Indicator       | Value       | Impact on ${selectedToken.symbol} |
|-----------------|-------------|-----------------------------------|
| CPI             | Latest      | Effect on token price             |
| Fed Rates       | Current     | Effect on market sentiment        |

Use natural, professional tone with recent data.
      `.slice(0, 1000);

        const geminiRecaptchaToken = await executeRecaptcha('analyze');
        const geminiResponse = await axios.post(
          '/api/gemini',
          {
            prompt,
            deepSearch: true,
            tokenSymbol: selectedToken.symbol?.toUpperCase(),
            recaptchaToken: geminiRecaptchaToken,
          },
          {
            headers: {
              Authorization: `Bearer ${session?.accessToken}`,
            },
          }
        );
        const analysisResult = geminiResponse.data?.answer || 'No analysis data received';
        setAnalysis(analysisResult);
        setAnalysisLinks(links);

        if (session?.user?.id) {
          try {
            const interactionRecaptchaToken = await executeRecaptcha('ai_interaction');
            const interactionRes = await axios.post(
              '/api/ai-interaction',
              {
                uid: session.user.id,
                query: `Analysis of token ${selectedToken.symbol}`,
                response: analysisResult,
                interactionType: 'market',
              },
              {
                headers: {
                  Authorization: `Bearer ${session?.accessToken}`,
                  'x-recaptcha-token': interactionRecaptchaToken,
                },
              }
            );
            if (interactionRes.data.pointsAwarded > 0 || dailyMarketInteractions < 5) {
              setDailyMarketInteractions((prev) => Math.min(prev + 1, 5));
            }
          } catch (interactionError) {
            if (interactionError.response?.data?.detail?.includes('maximum of 5 daily market interactions')) {
              setDailyMarketInteractions(5);
              toast.error('You have reached the maximum of 5 daily market interactions. Try again tomorrow.', {
                position: 'top-center',
                autoClose: 5000,
              });
            } else {
              setError(`Failed to save analysis: ${interactionError.response?.data?.detail || interactionError.message}`);
            }
          }
        }
      } catch (error) {
        let errorMessage;
        if (error.response?.status === 401) {
          errorMessage = 'Unauthorized: Please log in again.';
        } else if (error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')) {
          errorMessage = 'reCAPTCHA verification failed. Please try again.';
        } else if (error.response?.status === 413) {
          errorMessage = 'Request too large. Please try again later.';
        } else if (error.response?.data?.detail?.includes('FAILED_PRECONDITION')) {
          errorMessage = 'Server indexing issue. Please try again in a few minutes or contact support.';
          toast.error(errorMessage, {
            position: 'top-center',
            autoClose: 5000,
          });
        } else if (error.response?.data?.errors) {
          errorMessage = `Validation error: ${error.response.data.errors.map((e) => e.msg).join(', ')}`;
        } else {
          errorMessage = error.response?.data?.detail || 'Failed to analyze token.';
        }
        setError(errorMessage);
      } finally {
        setIsAnalyzing(false);
        if (recaptchaRef.current) {
          recaptchaRef.current.reset();
        }
      }
    }, 500),
    [selectedToken, status, session, executeRecaptcha, toast]
  );

  const debouncedHandlePrediction = useCallback(
    debounce(async () => {
      if (!selectedToken) {
        setError('No token selected.');
        return;
      }
      if (status !== 'authenticated') {
        setError('Please log in to predict price.');
        return;
      }
      setIsPredicting(true);
      try {
        const recaptchaToken = await executeRecaptcha('predict');
        const prompt = `
Predict **${selectedToken.symbol}/USD** price movement (1-3 days) in Markdown format (250-300 words). Use **bold**, *italics*, tables, and *not investment advice*.

**Data**:
- **Current Price**: $${selectedToken.current_price?.toFixed(2) || 'N/A'}
- **24h Price Change**: ${selectedToken.price_change_percentage_24h?.toFixed(2) || 'N/A'}%
- **Market Cap**: $${selectedToken.market_cap?.toLocaleString() || 'N/A'}
- **24h Volume**: $${selectedToken.total_volume?.toLocaleString() || 'N/A'}
- **Price History**: ${JSON.stringify(priceHistory.slice(-10))}
- **Recent Analysis**: ${analysis || 'No prior analysis available.'}

**Requirements**:
- **Price Trend**: Predict movement using RSI, MACD, moving averages, sentiment, economic indicators, stock market trends, and political news.
- **Likelihood**:
  - *Increase*: % likelihood of price increase.
  - *Decrease*: % likelihood of price decrease (total 100%).
- **Key Factors**: 3-4 factors (e.g., RSI, volume, economic data, political events).
- **Conclusion**: Summarize prediction with actionable observations.

**Example Table**:
| Trend     | Likelihood | Key Factors                     |
|-----------|------------|---------------------------------|
| Increase  | 65%        | RSI, volume, positive sentiment |
| Decrease  | 35%        | Fed rates, political uncertainty |

Use natural, professional tone with recent data.
      `.slice(0, 1000);

        const response = await axios.post(
          '/api/gemini',
          {
            prompt,
            deepSearch: true,
            tokenSymbol: selectedToken.symbol?.toUpperCase(),
            recaptchaToken,
          },
          {
            headers: {
              Authorization: `Bearer ${session?.accessToken}`,
            },
          }
        );
        const predictionResult = response.data.answer;
        setPrediction(predictionResult);

        if (session?.user?.id) {
          try {
            const interactionRecaptchaToken = await executeRecaptcha('ai_interaction');
            const interactionRes = await axios.post(
              '/api/ai-interaction',
              {
                uid: session.user.id,
                query: `Prediction for token ${selectedToken.symbol}`,
                response: predictionResult,
                interactionType: 'market',
              },
              {
                headers: {
                  Authorization: `Bearer ${session?.accessToken}`,
                  'x-recaptcha-token': interactionRecaptchaToken,
                },
              }
            );
            if (interactionRes.data.pointsAwarded > 0 || dailyMarketInteractions < 5) {
              setDailyMarketInteractions((prev) => Math.min(prev + 1, 5));
            }
          } catch (interactionError) {
            if (interactionError.response?.data?.detail?.includes('maximum of 5 daily market interactions')) {
              setDailyMarketInteractions(5);
              toast.error('You have reached the maximum of 5 daily market interactions. Try again tomorrow.', {
                position: 'top-center',
                autoClose: 5000,
              });
            } else {
              setError(`Failed to save prediction: ${interactionError.response?.data?.detail || interactionError.message}`);
            }
          }
        }
      } catch (error) {
        setError(
          error.response?.status === 401
            ? 'Unauthorized: Please log in again.'
            : error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')
              ? 'reCAPTCHA verification failed. Please try again.'
              : error.response?.status === 413
                ? 'Request too large. Please try again later.'
                : error.response?.data?.errors
                  ? `Validation error: ${error.response.data.errors.map((e) => e.msg).join(', ')}`
                  : error.response?.data?.detail || 'Failed to predict trend.'
        );
      } finally {
        setIsPredicting(false);
        if (recaptchaRef.current) {
          recaptchaRef.current.reset();
        }
      }
    }, 500),
    [selectedToken, priceHistory, analysis, executeRecaptcha, status, session, toast]
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
      refreshInterval: CACHE_DURATIONS.TRENDING, // 10 phút
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: CACHE_DURATIONS.TRENDING, // Ngăn gọi lại API trong vòng 10 phút
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
          image: coin.image || '/fallback-image.png',
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

  // Thay thế hàm fetchMarketData và phần useEffect liên quan
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

  // components/MarketTabLogic.jsx (around line 1540)
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
        image: token.image || '/fallback-image.png', // Đảm bảo trường image được gán đúng
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

      // Select Bitcoin by default if no token is selected
      if (
        !initialTokenSlug &&
        !initialTokenData &&
        !selectedToken &&
        !lastFetchedTokenRef.current &&
        !isTokenPage
      ) {
        const btc = tokensWithRoi.find((token) => token.id === 'bitcoin');
        if (btc) {
          console.log('Selecting default token: Bitcoin');
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
    if (!selectedToken?.id) return;

    const tokenSymbol = selectedToken.id.toLowerCase();
    const isNonEvmChain = NON_EVM_CHAINS.includes(tokenSymbol);
    const { chain, tokenAddress, decimalPlace } = getDefaultChainAndAddress(selectedToken, selectedChain);
    const tokenKey = isNonEvmChain
      ? `${selectedToken.id}-blockchair`
      : `${selectedToken.id}-${chain}-${tokenAddress}-${decimalPlace}`;

    if (lastFetchedTokenRef.current === tokenKey && onChainData.topHolders.length > 0) {
      return;
    }

    setIsLoadingOnChain(true);
    setOnChainData((prev) => ({ ...prev, topHolders: [] }));
    setOnChainError(null);

    if (isNonEvmChain) {
      lastFetchedTokenRef.current = tokenKey;
      fetchPublicTreasuryData(tokenSymbol);
    } else {
      if (!chain || !tokenAddress) {
        setIsLoadingOnChain(false);
        setOnChainError('This token does not have on-chain data available on supported chains.');
        return;
      }

      lastFetchedTokenRef.current = tokenKey;
      fetchOnChainData(chain, tokenAddress, 'top-holders', decimalPlace);
    }
  }, [selectedToken?.id, selectedChain, fetchPublicTreasuryData, getDefaultChainAndAddress, fetchOnChainData]);

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
  };
};