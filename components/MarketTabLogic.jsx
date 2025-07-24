'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import debounce from 'lodash.debounce';
import rateLimit from 'axios-rate-limit';
import pLimit from 'p-limit';
import { GECKOTERMINAL_CHAIN_MAPPING, SUPPORTED_CHAINS, CHAIN_MAPPING } from '../utils/constants';
import btcNameTags from '../public/nametags/btc-top-holders.json'; ``

if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === 'production') {
  console.warn('NEXT_PUBLIC_APP_URL is not set, defaulting to https://xynapse-ai.vercel.app');
}

const NON_EVM_CHAINS = ['bitcoin', 'ethereum', 'dogecoin'];
const BLOCKCHAIR_REQUEST_LIMIT = 30; // Limit of 30 requests per minute
const BLOCKCHAIR_REQUEST_WINDOW = 60 * 1000; // 1 minute
const blockchairRequestTracker = new Map();
const DEX_REQUEST_LIMIT = 30; // Max 5 requests per minute
const DEX_REQUEST_WINDOW = 5 * 60 * 1000; // 1 minute
const dexRequestTracker = new Map();
const limit = pLimit(20);

const coingeckoAxios = rateLimit(axios.create(), {
  maxRequests: 15,
  perMilliseconds: 60000,
});

const COINGECKO_API_KEY = process.env.NEXT_PUBLIC_COINGECKO_API_KEY || '';
const CACHE_DURATION = 5 * 60 * 1000;
const NAME_TAG_CACHE_DURATION = 24 * 60 * 60 * 1000;
const WALLET_SEARCH_LIMIT = 5;
const WALLET_SEARCH_WINDOW = 60 * 1000;
const tokensPerPage = 20;

export const useMarketTabLogic = ({ recaptchaRef, toast }) => {
  const { data: session, status } = useSession();
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedToken, setSelectedToken] = useState(null);
  const [selectedPair, setSelectedPair] = useState('BTC/USD');
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
  const [isLoadingNameTags, setIsLoadingNameTags] = useState(false);
  const nameTagsRef = useRef({});
  const lastFetchedTokenRef = useRef(null);
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
  const [currency, setCurrency] = useState('usd'); // Add currency state
  const [availableCurrencies] = useState(['usd', 'vnd', 'eth', 'btc', 'eur']); // Supported currencies

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

  const fetchSupportedChains = useCallback(async () => {
    try {
      const response = await axios.get('/api/coingecko/chains', {
        timeout: 15000,
      });

      if (!response.data.success) {
        setChains(
          SUPPORTED_CHAINS.map((chain) => ({
            coingeckoId: Object.keys(CHAIN_MAPPING).find(
              (key) => CHAIN_MAPPING[key].simChain === chain.value
            ) || null,
            value: chain.value,
            label: chain.label,
            shortName: chain.label.split(' ')[0],
            chainId: chain.chainId,
            testnet: chain.testnet || false,
            image: '/fallback-image.png',
          }))
        );
        return;
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

      setChains(mappedChains);
    } catch (error) {
      setChains(
        SUPPORTED_CHAINS.map((chain) => ({
          coingeckoId: Object.keys(CHAIN_MAPPING).find(
            (key) => CHAIN_MAPPING[key].simChain === chain.value
          ) || null,
          value: chain.value,
          label: chain.label,
          shortName: chain.label.split(' ')[0],
          chainId: chain.chainId,
          testnet: chain.testnet || false,
          image: '/fallback-image.png',
        }))
      );
      toast.error('Failed to load supported chains', { position: 'top-center', autoClose: 5000 });
    }
  }, [toast]);

  const fetchPoolTokenMetadata = useCallback(async (chain, poolAddress, retryCount = 0) => {
    const cacheKey = `pool-${GECKOTERMINAL_CHAIN_MAPPING[chain]}-${poolAddress}`;
    if (tickerCache[cacheKey] && Date.now() - tickerCache[cacheKey].timestamp < CACHE_DURATION) {
      return tickerCache[cacheKey].data;
    }

    try {
      const response = await coingeckoAxios.get(
        `https://api.geckoterminal.com/api/v2/networks/${GECKOTERMINAL_CHAIN_MAPPING[chain]}/pools/${poolAddress}/info`,
        {
          headers: { accept: 'application/json' },
          timeout: 10000,
        }
      );

      const tokenData = response.data.data || [];
      const poolTokens = tokenData.reduce((acc, token) => {
        acc[token.attributes.address] = {
          symbol: token.attributes.symbol,
          image_url: token.attributes.image_url,
          transaction_score: token.attributes.gt_score_details?.transaction || 0,
          holders: token.attributes.holders || {},
        };
        return acc;
      }, {});

      setTickerCache((prev) => ({
        ...prev,
        [cacheKey]: { data: poolTokens, timestamp: Date.now() },
      }));
      return poolTokens;
    } catch (error) {
      if (retryCount < 3 && error.response?.status === 429) {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return fetchPoolTokenMetadata(chain, poolAddress, retryCount + 1);
      }
      return {};
    }
  }, [tickerCache, setTickerCache]);

  const fetchNameTag = useCallback(
    async (address) => {
      if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
        return { nameTag: null, image: null };
      }

      const normalizedAddress = address.toLowerCase();
      const cached = nameTagsRef.current[normalizedAddress];
      if (cached && Date.now() - cached.timestamp < NAME_TAG_CACHE_DURATION) {
        return { nameTag: cached.nameTag, image: cached.image };
      }

      try {
        if (status !== 'authenticated') {
          throw new Error('Unauthorized: Please log in to fetch Name Tag.');
        }

        const response = await axios.get('/api/nametags', {
          params: { address: normalizedAddress },
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
          timeout: 5000,
        });

        if (!response.data.success || !response.data.data[normalizedAddress]) {
          const cacheEntry = { nameTag: null, image: null, timestamp: Date.now() };
          nameTagsRef.current[normalizedAddress] = cacheEntry;
          setNameTags((prev) => ({
            ...prev,
            [normalizedAddress]: cacheEntry,
          }));
          return { nameTag: null, image: null };
        }

        const data = response.data.data[normalizedAddress];
        const firstLabelKey = Object.keys(data.Labels)[0];
        const nameTag = data.Labels[firstLabelKey]['Name Tag'] || null;
        const image = data.Labels[firstLabelKey].image || '/icons/default.png';
        const cacheEntry = { nameTag, image, timestamp: Date.now() };
        nameTagsRef.current[normalizedAddress] = cacheEntry;
        setNameTags((prev) => ({
          ...prev,
          [normalizedAddress]: cacheEntry,
        }));
        return { nameTag, image };
      } catch (error) {
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

      // Handle BTC addresses
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

      // Handle EVM addresses
      const evmAddresses = addresses.filter((addr) => addr.match(/^0x[a-fA-F0-9]{40}$/));
      if (evmAddresses.length > 0 && status === 'authenticated') {
        try {
          const response = await axios.post(
            '/api/nametags',
            { addresses: evmAddresses },
            {
              headers: {
                Authorization: `Bearer ${session?.accessToken}`,
              },
              timeout: 40000,
            }
          );

          evmAddresses.forEach((address) => {
            const normalizedAddress = address.toLowerCase();
            const data = response.data.data[normalizedAddress];
            const nameTag = data?.Labels ? Object.values(data.Labels)[0]?.['Name Tag'] || null : null;
            const image = data?.Labels ? Object.values(data.Labels)[0]?.image || '/icons/default.png' : '/icons/default.png';
            newNameTags[normalizedAddress] = { nameTag, image, timestamp: Date.now() };
          });
        } catch (error) {
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
      (tokenId, days, callback, retryCount = 0) => {
        if (document.visibilityState !== 'visible') {
          callback(null);
          return;
        }
        const cacheKey = `${tokenId}-${days}-${currency}`;
        const cached = priceHistoryCache[cacheKey];
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          setPriceHistory(cached.data);
          callback(null, cached.data);
          return;
        }
        return new Promise(async (resolve, reject) => {
          try {
            const response = await axios.get('/api/coingecko/market_chart', {
              params: { id: tokenId, days, currency },
              timeout: 30000,
            }).catch(async (error) => {
              if (retryCount < 3 && (error.response?.status === 429 || error.response?.status === 503 || error.code === 'ECONNABORTED')) {
                const delay = Math.pow(2, retryCount) * 1000;
                await new Promise((resolve) => setTimeout(resolve, delay));
                return fetchPriceHistory(tokenId, days, callback, retryCount + 1);
              }
              throw error;
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

            const priceData = response.data.prices.map(([timestamp, price]) => ({
              title: new Date(timestamp).toLocaleString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
                hour: days === '0.5' || days === '1' ? '2-digit' : undefined,
                minute: days === '0.5' ? '2-digit' : undefined,
                hour12: false,
              }),
              price: parseFloat(
                price.toLocaleString('en-US', {
                  minimumFractionDigits: fractionDigits,
                  maximumFractionDigits: fractionDigits,
                }).replace(/,/g, '')
              ),
            }));

            setPriceHistoryCache((prev) => ({
              ...prev,
              [cacheKey]: { data: priceData, timestamp: Date.now() },
            }));
            setPriceHistory(priceData);
            resolve(priceData);
            callback(null, priceData);
          } catch (err) {
            const errorMessage =
              err.response?.status === 429
                ? 'API rate limit reached. Please wait a minute and try again.'
                : err.response?.status === 401
                  ? 'Unable to fetch market data due to authentication issues. Please try again later.'
                  : err.response?.data?.detail || `Failed to load price history: ${err.message}`;
            setError(errorMessage);
            toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
            reject(err);
            callback(err);
          }
        });
      },
      500,
      { leading: false, trailing: true }
    ),
    [currency, chains, priceHistoryCache, setPriceHistory, setPriceHistoryCache, setError, toast]
  );

  const fetchPublicTreasuryData = useCallback(
    debounce(
      async (tokenSymbol, retryCount = 0) => {
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

        // Check cache
        if (
          blockchairCache.current[cacheKey] &&
          Date.now() - blockchairCache.current[cacheKey].timestamp < CACHE_DURATION
        ) {
          setOnChainData((prev) => ({
            ...prev,
            topHolders: blockchairCache.current[cacheKey].data,
          }));
          setIsLoadingOnChain(false);
          return;
        }

        const userId = session?.user?.id || 'anonymous';
        const now = Date.now();
        let userRequests = blockchairRequestTracker.get(userId) || { count: 0, lastReset: now };

        if (now - userRequests.lastReset >= BLOCKCHAIR_REQUEST_WINDOW) {
          userRequests = { count: 0, lastReset: now };
          blockchairRequestTracker.set(userId, userRequests);
          setBlockchairRequestCount(0);
          setLastBlockchairRequestTime(now);
        }

        if (userRequests.count >= BLOCKCHAIR_REQUEST_LIMIT) {
          const errorMessage = 'Too many Blockchair requests. Please wait a minute and try again.';
          setOnChainError(errorMessage);
          setIsLoadingOnChain(false);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          return;
        }

        try {
          const recaptchaToken = await executeRecaptcha('blockchair_top_holders');
          blockchairRequestTracker.set(userId, {
            count: userRequests.count + 1,
            lastReset: userRequests.lastReset,
          });
          setBlockchairRequestCount((prev) => prev + 1);

          // Fetch Blockchair data
          let topHolders = [];
          try {
            const blockchairResponse = await axios.post(
              '/api/blockchair',
              { chain, limit: 100 },
              {
                headers: {
                  'Content-Type': 'application/json',
                  ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
                  'x-recaptcha-token': recaptchaToken,
                },
                timeout: 15000,
              }
            );

            if (!blockchairResponse.data.success || !Array.isArray(blockchairResponse.data.data)) {
              throw new Error(blockchairResponse.data.detail || `No top holders data for ${chain} from Blockchair`);
            }

            topHolders = blockchairResponse.data.data.map((holder) => ({
              address: holder.address,
              balance: parseFloat(holder.balance) || 0,
              share: parseFloat(holder.share) || 0,
              nameTag: btcNameTags[holder.address.toLowerCase()]?.Labels?.bitcoin?.['Name Tag'] || null,
              image: btcNameTags[holder.address.toLowerCase()]?.Labels?.bitcoin?.image || null,
              source: 'Blockchair',
            }));
          } catch (blockchairError) {
            console.warn(`Blockchair fetch failed for ${chain}:`, blockchairError);
            // Continue to try CoinGecko if Blockchair fails
          }

          // Fetch CoinGecko public treasury data for Bitcoin and Ethereum
          if (['bitcoin', 'ethereum'].includes(chain)) {
            try {
              const coingeckoResponse = await coingeckoAxios.get('/api/coingecko', {
                params: { action: 'public-treasury', tokenType: chain },
                headers: {
                  ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
                },
                timeout: 10000,
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
                const mergedHolders = [
                  ...topHolders,
                  ...treasuryData.filter((company) => !uniqueAddresses.has(company.address.toLowerCase())),
                ];

                topHolders = mergedHolders.sort((a, b) => b.balance - a.balance).slice(0, 100);
              } else {
                console.warn(`No valid CoinGecko treasury data for ${chain}:`, coingeckoResponse.data);
              }
            } catch (coingeckoError) {
              console.warn(`Failed to fetch CoinGecko treasury data for ${chain}:`, coingeckoError);
              // Continue with Blockchair data if CoinGecko fails
            }
          }

          if (topHolders.length === 0) {
            throw new Error(`No top holders data available for ${chain}`);
          }

          blockchairCache.current[cacheKey] = { data: topHolders, timestamp: Date.now() };
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
          if (retryCount < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
            fetchPublicTreasuryData(tokenSymbol, retryCount + 1);
          } else {
            toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
          }
        } finally {
          setIsLoadingOnChain(false);
          if (recaptchaRef.current) {
            recaptchaRef.current.reset();
          }
        }
      },
      500,
      { leading: false, trailing: true }
    ),
    [toast, executeRecaptcha, session]
  );

  const fetchTickerData = useCallback(
    debounce(async (tokenId, retryCount = 0) => {
      if (!tokenId || document.visibilityState !== 'visible') return;
      const cacheKey = tokenId;
      if (tickerCache[cacheKey] && Date.now() - tickerCache[cacheKey].timestamp < CACHE_DURATION) {
        setTickerData(tickerCache[cacheKey].data);
        return;
      }

      setIsLoadingTickers(true);
      setTickerError(null);
      try {
        let response;
        const params = { include_exchange_logo: true };
        if (process.env.NODE_ENV === 'development') {
          response = await coingeckoAxios.get(`https://api.coingecko.com/api/v3/coins/${tokenId}/tickers`, {
            params,
            headers: {
              accept: 'application/json',
              ...(COINGECKO_API_KEY && { 'x-cg-demo-api-key': COINGECKO_API_KEY }),
            },
            timeout: 15000,
          });
        } else {
          response = await axios.get('/api/coingecko', {
            params: {
              action: 'tickers',
              id: tokenId,
              include_exchange_logo: true,
            },
            timeout: 15000,
          });
        }

        const tickers = response.data.tickers || [];
        setTickerCache((prev) => ({
          ...prev,
          [cacheKey]: { data: tickers, timestamp: Date.now() },
        }));
        setTickerData(tickers);
      } catch (error) {
        const errorMessage =
          error.response?.status === 429
            ? 'CoinGecko API rate limit exceeded. Please try again later.'
            : error.response?.status === 404
              ? `Ticker data not found for ${tokenId}.`
              : error.response?.data?.detail || `Failed to load ticker data for ${tokenId}.`;
        setTickerError(errorMessage);
      } finally {
        setIsLoadingTickers(false);
      }
    }, 500),
    [COINGECKO_API_KEY]
  );

  const fetchOnChainData = useCallback(
    debounce(async (chain, tokenAddress, action, decimalPlace, address, recaptchaToken, retryCount = 0) => {
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
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      const simChain = chains.find((c) => c.value === chain)?.value;
      if (!simChain && action === 'top-holders') {
        const errorMessage = `Invalid chain: ${chain}`;
        setOnChainError(errorMessage);
        setIsLoadingOnChain(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      const cacheKey = `onchain-${simChain}-${tokenAddress}-${action}`;
      if (
        blockchairCache.current[cacheKey] &&
        Date.now() - blockchairCache.current[cacheKey].timestamp < CACHE_DURATION
      ) {
        setOnChainData((prev) => ({
          ...prev,
          topHolders: blockchairCache.current[cacheKey].data,
        }));
        setIsLoadingOnChain(false);
        return;
      }

      setIsLoadingOnChain(true);
      if (action === 'wallet-balances') setIsLoadingWalletBalances(true);
      else if (action === 'transactions') setIsLoadingTransactions(true);

      try {
        const apiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://xynapse-ai.vercel.app'}/api/sim`;
        const payload = {
          action,
          recaptchaToken,
          chain: simChain,
          tokenAddress,
          ...(decimalPlace != null && { decimalPlace: Number(decimalPlace) }),
          ...(address && { address }),
        };

        const response = await axios.post(apiUrl, payload, {
          headers: {
            Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        });

        if (!response.data.success) {
          throw new Error(response.data.detail || `Failed to fetch ${action} data`);
        }

        if (action === 'top-holders') {
          const topHolders = response.data.data || [];
          blockchairCache.current[cacheKey] = { data: topHolders, timestamp: Date.now() };
          setOnChainData((prev) => ({
            ...prev,
            topHolders,
          }));
        } else if (action === 'wallet-balances') {
          setWalletBalances(response.data.data || []);
        } else if (action === 'transactions') {
          setTransactions(response.data.data || []);
        }
      } catch (error) {
        const errorMessage =
          error.response?.status === 429
            ? 'Too many requests. Please try again later.'
            : error.response?.data?.detail || `Failed to load ${action} data: ${error.message}`;
        setOnChainError(errorMessage);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        if (retryCount < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
          fetchOnChainData(chain, tokenAddress, action, decimalPlace, address, recaptchaToken, retryCount + 1);
        }
      } finally {
        setIsLoadingOnChain(false);
        if (action === 'wallet-balances') setIsLoadingWalletBalances(false);
        else if (action === 'transactions') setIsLoadingTransactions(false);
      }
    }, 500),
    [chains, status, session?.accessToken, toast]
  );

  const fetchDexData = useCallback(
    debounce(async (chain, tokenAddress, retryCount = 0) => {
      if (status !== 'authenticated') {
        const errorMessage = 'Please log in to access DEX data.';
        setDexError(errorMessage);
        setIsLoadingDex(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
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

      const cacheKey = `${geckoChain}-${tokenAddress}`;
      const cached = tickerCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        setDexData(cached.data);
        setLastDexFetchTime(cached.timestamp);
        setIsLoadingDex(false);
        return;
      }

      setIsLoadingDex(true);
      setDexError(null);

      try {
        const poolResponse = await coingeckoAxios.get(
          `https://api.geckoterminal.com/api/v2/networks/${geckoChain}/tokens/${tokenAddress}/pools?page=1&bypassCache=true`,
          {
            headers: { accept: 'application/json' },
            timeout: 10000,
          }
        ).catch(async (error) => {
          if (retryCount < 3 && error.response?.status === 429) {
            const delay = Math.pow(2, retryCount) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            return fetchDexData(chain, tokenAddress, retryCount + 1);
          }
          throw error;
        });

        let pools = poolResponse.data?.data || [];
        pools.sort((a, b) => parseFloat(b.attributes.volume_usd.h24) - parseFloat(a.attributes.volume_usd.h24));
        const topPools = pools.slice(0, 5);

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

        const dexData = { pools: topPools, trades: validTrades, poolTokens };
        setTickerCache((prev) => ({
          ...prev,
          [cacheKey]: { data: dexData, timestamp: Date.now() },
        }));
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
      } finally {
        setIsLoadingDex(false);
      }
    }, 500),
    [toast, tickerCache, setTickerCache, status, session]
  );

  const handleAddressClick = useCallback(
    (address) => {
      if (address === 'Unknown') {
        setWalletBalancesError('Cannot fetch balances for unknown address.');
        return;
      }

      if (selectedToken?.id.toLowerCase() === 'bitcoin') {
        const blockchairUrl = `https://blockchair.com/bitcoin/address/${address}`;
        window.open(blockchairUrl, '_blank', 'noreferrer');
        return;
      }

      setSelectedWallet(address);
      setWalletBalances([]);
      setTransactions(null);
      setWalletBalancesError(null);
      setTransactionsError(null);
      setIsLoadingWalletBalances(true);
      fetchOnChainData(null, null, 'wallet-balances', null, address);
    },
    [fetchOnChainData, selectedToken, onChainData]
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
    async (address) => {
      const recaptchaToken = await executeRecaptcha('transactions');
      fetchOnChainData(null, null, 'transactions', null, address, recaptchaToken);
    },
    [fetchOnChainData, executeRecaptcha]
  );

  const getDefaultChainAndAddress = useCallback(
    (token, selectedChain = 'ethereum') => {
      if (!token) {
        return { chain: null, tokenAddress: null, decimalPlace: null };
      }

      const tokenSymbol = token.symbol?.toLowerCase();
      if (NON_EVM_CHAINS.includes(tokenSymbol)) {
        return { chain: tokenSymbol, tokenAddress: null, decimalPlace: null };
      }

      const normalizedPlatforms = Object.keys(token.detail_platforms || {}).reduce((acc, cgId) => {
        const chain = chains.find((c) => c.coingeckoId === cgId);
        if (chain && token.detail_platforms[cgId].contract_address?.match(/^0x[a-fA-F0-9]{40}$/)) {
          const decimalPlace = Number(token.detail_platforms[cgId].decimal_place) || 18;
          acc[chain.value] = {
            address: token.detail_platforms[cgId].contract_address,
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
        normalizedPlatforms[selectedChain] &&
        chains.some((net) => net.value === selectedChain) &&
        normalizedPlatforms[selectedChain].address.match(/^0x[a-fA-F0-9]{40}$/)
      ) {
        return {
          chain: selectedChain,
          tokenAddress: normalizedPlatforms[selectedChain].address,
          decimalPlace: normalizedPlatforms[selectedChain].decimal_place,
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
      };

      if (fallbackTokens[tokenSymbol]) {
        return fallbackTokens[tokenSymbol];
      }

      setOnChainError('This token does not have on-chain data available on supported chains. Try selecting a different token.');
      return { chain: null, tokenAddress: null, decimalPlace: null };
    },
    [chains, setOnChainError]
  );

  const getAvailableChains = useCallback(() => {
    if (!selectedToken?.detail_platforms) return [];

    const normalizedPlatforms = Object.keys(selectedToken.detail_platforms).reduce((acc, cgId) => {
      const chain = chains.find((c) => c.coingeckoId === cgId);
      if (chain && selectedToken.detail_platforms[cgId].contract_address?.match(/^0x[a-fA-F0-9]{40}$/)) {
        const decimalPlace = Number(selectedToken.detail_platforms[cgId].decimal_place) || 18;
        acc[chain.value] = {
          address: selectedToken.detail_platforms[cgId].contract_address,
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
    debounce(async (token, initialTokenData = null) => {
      if (initialTokenData && initialTokenData.id === token.id) {
        // Use server-side data if available
        setSelectedToken(initialTokenData);
        setSelectedPair(`${initialTokenData.symbol?.toUpperCase()}/${currency.toUpperCase()}`);
        const { chain } = getDefaultChainAndAddress(initialTokenData, 'ethereum');
        setSelectedChain(chain || 'ethereum');
        setAnalysis(null);
        setPrediction(null);
        setAnalysisLinks([]);
        setIsDropdownOpen(false);
        setOnChainData({ topHolders: [], whaleActivity: [] });
        setOnChainError(null);

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
        return;
      }

      // Existing API call logic for when initial data is not available
      try {
        const recaptchaToken = await executeRecaptcha('coin_details');
        const response = await axios.get('/api/coingecko', {
          params: {
            action: 'coin-details',
            id: token.id,
            recaptchaToken,
            vs_currencies: availableCurrencies.join(','),
          },
        });
        const marketData = response.data.market_data || {};
        const fullToken = {
          id: response.data.id,
          symbol: response.data.symbol,
          name: response.data.name,
          image: response.data.image?.large,
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
          price_change_percentage_90d_in_currency: marketData.price_change_percentage_90d_in_currency || {}, // Add 90d
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
          roi: marketData.roi || response.data.roi,
          last_updated: response.data.last_updated,
          market_cap_rank: response.data.market_cap_rank,
          platforms: response.data.platforms || {},
          detail_platforms: response.data.detail_platforms || {},
          links: {
            homepage: response.data.links?.homepage || [],
            blockchain_site: response.data.links?.blockchain_site || [],
            official_forum_url: response.data.links?.official_forum_url || [],
            chat_url: response.data.links?.chat_url || [],
            announcement_url: response.data.links?.announcement_url || [],
            twitter_screen_name: response.data.links?.twitter_screen_name || '',
            facebook_username: response.data.links?.facebook_username || '',
            telegram_channel_identifier: response.data.links?.telegram_channel_identifier || '',
            repos_url: response.data.links?.repos_url?.github || [],
          },
        };
        setSelectedToken(fullToken);
        setSelectedPair(`${fullToken.symbol?.toUpperCase()}/${currency.toUpperCase()}`);
        const { chain } = getDefaultChainAndAddress(fullToken, 'ethereum');
        setSelectedChain(chain || 'ethereum');
        setAnalysis(null);
        setPrediction(null);
        setAnalysisLinks([]);
        setIsDropdownOpen(false);
        setOnChainData({ topHolders: [], whaleActivity: [] });
        setOnChainError(null);

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
      } catch (error) {
        setError(
          error.response?.status === 429
            ? 'CoinGecko rate limit reached. Please wait a minute and try again.'
            : error.response?.data?.detail || 'Failed to load token details.'
        );
      }
    }, 300), // Reduced debounce delay
    [currency, availableCurrencies, timeRange, fetchPriceHistory, setSelectedToken, setSelectedPair, setSelectedChain, setAnalysis, setPrediction, setAnalysisLinks, setIsDropdownOpen, setOnChainData, setOnChainError, setError, executeRecaptcha, getDefaultChainAndAddress, chains]
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
    debounce(async (query) => {
      if (!query) {
        setSearchResults([]);
        return;
      }
      try {
        const response = await axios.get('/api/coingecko', {
          params: { action: 'search', query },
        });
        const results = response.data.map((coin) => ({
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          image: coin.large,
          market_cap_rank: coin.market_cap_rank,
        }));
        setSearchResults(results.slice(0, 10));
      } catch (error) {
        setError(
          error.response?.status === 429
            ? 'API rate limit reached. Please wait a minute and try again.'
            : error.response?.data?.detail || 'Failed to search coins.'
        );
        setSearchResults([]);
      }
    }, 500),
    []
  );

  const fetchMarketData = useCallback(
    debounce(async (retryCount = 0) => {
      if (document.visibilityState !== 'visible') return;
      try {
        const marketResponse = await coingeckoAxios.get('/api/coingecko', {
          params: { start: 1, limit: tokensPerPage, vs_currencies: availableCurrencies.join(',') }, // Fetch for all currencies
        });
        const tokensWithRoi = marketResponse.data.map((token) => ({
          ...token,
          roi: token.roi || null,
          current_price: token.market_data?.current_price || {},
          market_cap: token.market_data?.market_cap || {},
          total_volume: token.market_data?.total_volume || {},
          high_24h: token.market_data?.high_24h || {},
          low_24h: token.market_data?.low_24h || {},
        }));
        setTokens(tokensWithRoi);
        if (!selectedToken && !lastFetchedTokenRef.current) {
          const btc = tokensWithRoi.find((token) => token.id === 'bitcoin');
          if (btc) {
            debouncedHandleTokenSelect(btc);
          }
        }
        setLoading(false);
      } catch (error) {
        if (error.response?.status === 429 && retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000;
          setTimeout(() => fetchMarketData(retryCount + 1), delay);
          return;
        }
        setError(
          error.response?.status === 429
            ? 'API rate limit reached. Please wait a minute and try again.'
            : error.response?.data?.error || 'Failed to load market data.'
        );
        setLoading(false);
      }
    }, 3000),
    [selectedToken, debouncedHandleTokenSelect, availableCurrencies]
  );

  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 10 * 60 * 1000);
    return () => {
      clearInterval(interval);
      fetchMarketData.cancel();
    };
  }, [fetchMarketData]);

  useEffect(() => {
    fetchSupportedChains();
  }, [fetchSupportedChains]);

  useEffect(() => {
    if (selectedToken && timeRange) {
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
    }
    const interval = setInterval(() => {
      if (selectedToken && timeRange) {
        const tokenId = selectedToken.id;
        fetchPriceHistory(tokenId, timeRange, (err, data) => {
          if (err) {
            // Handle error silently
          }
        });
      }
    }, 60000);
    return () => {
      clearInterval(interval);
      fetchPriceHistory.cancel && fetchPriceHistory.cancel();
    };
  }, [selectedToken, timeRange, currency, fetchPriceHistory, setError]); // Removed session

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
    setOnChainData((prevAscent) => ({ ...prevAscent, topHolders: [] }));

    if (isNonEvmChain) {
      lastFetchedTokenRef.current = tokenKey;
      fetchPublicTreasuryData(tokenSymbol);
    } else {
      if (!chain || !tokenAddress) {
        setIsLoadingOnChain(false);
        setOnChainError('No valid chain or token address available for this token.');
        return;
      }

      lastFetchedTokenRef.current = tokenKey;
      fetchOnChainData(chain, tokenAddress, 'top-holders', decimalPlace);
    }

    return () => {
      fetchPublicTreasuryData.cancel();
      fetchOnChainData.cancel();
    };
  }, [selectedToken?.id, selectedChain, fetchPublicTreasuryData, getDefaultChainAndAddress, fetchOnChainData, onChainData.topHolders.length]);

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
    if (!selectedToken?.id || ['bitcoin', 'ethereum'].includes(selectedToken.id.toLowerCase())) {
      return;
    }

    const { chain, tokenAddress } = getDefaultChainAndAddress(selectedToken, selectedChain);
    if (!chain || !tokenAddress) {
      return;
    }

    // Initial fetch
    fetchDexData(chain, tokenAddress);

    // Set up interval for background refresh every 30 seconds
    const interval = setInterval(() => {
      const cacheKey = `${GECKOTERMINAL_CHAIN_MAPPING[chain]}-${tokenAddress}`;
      const cached = tickerCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return;
      }
      if (document.visibilityState === 'visible') {
        fetchDexData(chain, tokenAddress);
      }
    }, 30000); // 30 seconds

    return () => {
      clearInterval(interval);
      fetchDexData.cancel();
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
    // Constants
    SUPPORTED_CHAINS,
    WALLET_SEARCH_LIMIT,
    WALLET_SEARCH_WINDOW,
    BLOCKCHAIR_REQUEST_LIMIT,
    BLOCKCHAIR_REQUEST_WINDOW,
    NON_EVM_CHAINS,
    // Refs
    lastFetchedTokenRef,
    prevTopHoldersRef,
    prevAvailableChainsRef,
    blockchairCache,
  };
};