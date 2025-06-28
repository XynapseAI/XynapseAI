import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import debounce from 'lodash.debounce';
import rateLimit from 'axios-rate-limit';
import { logger } from '../utils/logger';
import pLimit from 'p-limit';

if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === 'production') {
  console.warn('NEXT_PUBLIC_APP_URL is not set, defaulting to https://xynapse-ai.vercel.app');
}

const limit = pLimit(10);

// Custom logger
const customLogger = {
  log: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${new Date().toISOString()}] ${message}`, data);
    }
  },
};

const coingeckoAxios = rateLimit(axios.create(), {
  maxRequests: 10,
  perMilliseconds: 60000,
});

// Supported chains from Dune
const SUPPORTED_CHAINS = [
  { value: 'abstract', chainId: '2741', label: 'Abstract' },
  { value: 'ancient8', chainId: '888888888', label: 'Ancient8' },
  { value: 'ape_chain', chainId: '33139', label: 'Ape Chain' },
  { value: 'arbitrum', chainId: '42161', label: 'Arbitrum' },
  { value: 'arbitrum_nova', chainId: '42170', label: 'Arbitrum Nova' },
  { value: 'avalanche_c', chainId: '43114', label: 'Avax-C' },
  { value: 'avalanche_fuji', chainId: '43113', label: 'Avalanche Fuji', testnet: true },
  { value: 'base', chainId: '8453', label: 'Base' },
  { value: 'base_sepolia', chainId: '84532', label: 'Base Sepolia', testnet: true },
  { value: 'berachain', chainId: '80094', label: 'Berachain' },
  { value: 'blast', chainId: '81457', label: 'Blast' },
  { value: 'bnb', chainId: '56', label: 'BNB' },
  { value: 'bob', chainId: '60808', label: 'BOB' },
  { value: 'boba', chainId: '288', label: 'Boba' },
  { value: 'celo', chainId: '42220', label: 'Celo' },
  { value: 'corn', chainId: '21000000', label: 'Corn' },
  { value: 'cyber', chainId: '7560', label: 'Cyber' },
  { value: 'degen', chainId: '666666666', label: 'Degen' },
  { value: 'ethereum', chainId: '1', label: 'ETH' },
  { value: 'fantom', chainId: '250', label: 'Fantom' },
  { value: 'flare', chainId: '14', label: 'Flare' },
  { value: 'gnosis', chainId: '100', label: 'Gnosis Chain' },
  { value: 'ham', chainId: '5112', label: 'Ham' },
  { value: 'hychain', chainId: '2911', label: 'Hychain' },
  { value: 'ink', chainId: '57073', label: 'Ink' },
  { value: 'kaia', chainId: '8217', label: 'Kaia' },
  { value: 'linea', chainId: '59144', label: 'Linea' },
  { value: 'lisk', chainId: '1135', label: 'Lisk' },
  { value: 'mantle', chainId: '5000', label: 'Mantle' },
  { value: 'metis', chainId: '1088', label: 'Metis' },
  { value: 'mint', chainId: '185', label: 'Mint' },
  { value: 'mode', chainId: '34443', label: 'Mode' },
  { value: 'omni', chainId: '166', label: 'Omni' },
  { value: 'opbnb', chainId: '204', label: 'opBNB' },
  { value: 'optimism', chainId: '10', label: 'Optimism' },
  { value: 'polygon', chainId: '137', label: 'Polygon' },
  { value: 'proof_of_play', chainId: '70700', label: 'Proof of Play' },
  { value: 'rari', chainId: '1380012617', label: 'Rari' },
  { value: 'redstone', chainId: '690', label: 'Redstone' },
  { value: 'scroll', chainId: '534352', label: 'Scroll' },
  { value: 'sei', chainId: '1329', label: 'Sei' },
  { value: 'sepolia', chainId: '11155111', label: 'Sepolia', testnet: true },
  { value: 'shape', chainId: '360', label: 'Shape' },
  { value: 'soneium', chainId: '1868', label: 'Soneium' },
  { value: 'sonic', chainId: '146', label: 'Sonic' },
  { value: 'superseed', chainId: '5330', label: 'Superseed' },
  { value: 'swellchain', chainId: '1923', label: 'Swell Chain' },
  { value: 'unichain', chainId: '130', label: 'Unichain' },
  { value: 'wemix', chainId: '1111', label: 'Wemix' },
  { value: 'world', chainId: '480', label: 'World' },
  { value: 'xai', chainId: '660279', label: 'Xai' },
  { value: 'zero_network', chainId: '543210', label: 'Zero Network' },
  { value: 'zkevm', chainId: '1101', label: 'Polygon zkEVM' },
  { value: 'zksync', chainId: '324', label: 'zkSync' },
  { value: 'zora', chainId: '7777777', label: 'Zora' },
  { value: 'monad_testnet', chainId: null, label: 'Monad Testnet', testnet: true },
];

// Mapping of CoinGecko chain IDs to Sim by Dune chain values and chain IDs
const CHAIN_MAPPING = {
  'ethereum': { simChain: 'ethereum', chainId: '1' },
  'arbitrum-one': { simChain: 'arbitrum', chainId: '42161' },
  'avalanche': { simChain: 'avalanche_c', chainId: '43114' },
  'binance-smart-chain': { simChain: 'bnb', chainId: '56' },
  'polygon-pos': { simChain: 'polygon', chainId: '137' },
  'optimistic-ethereum': { simChain: 'optimism', chainId: '10' },
  'gnosis': { simChain: 'gnosis', chainId: '100' },
  'base': { simChain: 'base', chainId: '8453' },
  'fantom': { simChain: 'fantom', chainId: '250' },
  'zksync': { simChain: 'zksync', chainId: '324' },
  'zora': { simChain: 'zora', chainId: '7777777' },
  'linea': { simChain: 'linea', chainId: '59144' },
  'mantle': { simChain: 'mantle', chainId: '5000' },
  'scroll': { simChain: 'scroll', chainId: '534352' },
  'celo': { simChain: 'celo', chainId: '42220' },
  'opbnb': { simChain: 'opbnb', chainId: '204' },
  'boba': { simChain: 'boba', chainId: '288' },
  'metis-andromeda': { simChain: 'metis', chainId: '1088' },
  'blast': { simChain: 'blast', chainId: '81457' },
  'sei-network': { simChain: 'sei', chainId: '1329' },
  'kaia': { simChain: 'kaia', chainId: '8217' },
  'world-chain': { simChain: 'world', chainId: '480' },
  'unichain': { simChain: 'unichain', chainId: '130' },
  'sonic': { simChain: 'sonic', chainId: '146' },
  'berachain': { simChain: 'berachain', chainId: '80094' },
  'ink': { simChain: 'ink', chainId: '57073' },
  'mode': { simChain: 'mode', chainId: '34443' },
  'soneium': { simChain: 'soneium', chainId: '1868' },
  'monad': { simChain: 'monad_testnet', chainId: null },
};

const GECKOTERMINAL_CHAIN_MAPPING = {
  'ethereum': 'eth',
  'arbitrum': 'arbitrum',
  'avalanche_c': 'avalanche',
  'bnb': 'bsc',
  'polygon': 'polygon',
  'optimism': 'optimism',
  'base': 'base',
  'zksync': 'zksync',
  'zora': 'zora',
  'linea': 'linea',
  'mantle': 'mantle',
  'scroll': 'scroll',
  'celo': 'celo',
  'opbnb': 'op_bnb',
  'boba': 'boba',
  'metis': 'metis',
  'blast': 'blast',
  'sei': 'sei',
  'kaia': 'kaia',
  'world': 'worldchain',
  'unichain': 'unichain',
  'sonic': 'sonic',
  'berachain': 'berachain',
  'ink': 'ink',
  'mode': 'mode',
  'soneium': 'soneium',
};

const COINGECKO_API_KEY = process.env.NEXT_PUBLIC_COINGECKO_API_KEY || '';
const CACHE_DURATION = 5 * 60 * 1000;
const NAME_TAG_CACHE_DURATION = 24 * 60 * 60 * 1000;
const WALLET_SEARCH_LIMIT = 3;
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
  const [dexData, setDexData] = useState({ pools: [], trades: [] });
  const [isLoadingDex, setIsLoadingDex] = useState(false);
  const [dexError, setDexError] = useState(null);

  const executeRecaptcha = useCallback(
    async (action, retryCount = 0) => {
      if (!recaptchaRef.current) {
        logger.error('reCAPTCHA is not initialized.');
        throw new Error('reCAPTCHA is not initialized.');
      }
      try {
        logger.log(`Executing reCAPTCHA for action: ${action}, attempt ${retryCount + 1}`);
        const token = await Promise.race([
          recaptchaRef.current.executeAsync({ action }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA timeout')), 10000)),
        ]);
        if (!token) {
          throw new Error('Empty reCAPTCHA token.');
        }
        logger.log('reCAPTCHA token generated:', { action, token: token.substring(0, 8) + '...' });
        return token;
      } catch (error) {
        logger.error('Error executing reCAPTCHA:', { action, error: error.message });
        if (retryCount < 2) {
          logger.log(`Retrying reCAPTCHA for action ${action}, attempt ${retryCount + 2}`);
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
        logger.error('Failed to fetch CoinGecko chains:', { detail: response.data.detail });
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
            image: '/fallback-image.png', // Fallback image for unsupported chains
          }))
        );
        logger.info('Using SUPPORTED_CHAINS as fallback', {
          count: SUPPORTED_CHAINS.length,
        });
        return;
      }

      const coingeckoChains = response.data.data;
      const mappedChains = SUPPORTED_CHAINS.map((simChain) => {
        const coingeckoChain = coingeckoChains.find(
          (cg) => CHAIN_MAPPING[cg.id]?.simChain === simChain.value
        );
        const imageUrl = coingeckoChain?.image?.thumb || '/fallback-image.png';
        logger.log('Chain image mapping:', {
          chain: simChain.value,
          coingeckoId: coingeckoChain?.id,
          image: imageUrl,
        });
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
      logger.info(`Merged ${mappedChains.length} chains`, {
        sample: mappedChains.slice(0, 5).map((c) => ({
          value: c.value,
          label: c.label,
          image: c.image,
        })),
      });
    } catch (error) {
      logger.error('Error fetching CoinGecko chains:', {
        message: error.message,
        status: error.response?.status,
      });
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
          image: '/fallback-image.png', // Fallback image for error case
        }))
      );
      logger.info('Using SUPPORTED_CHAINS as fallback due to error', {
        count: SUPPORTED_CHAINS.length,
      });
      toast.error('Failed to load supported chains', { position: 'top-center', autoClose: 5000 });
    }
  }, [toast]);

  const fetchNameTag = useCallback(
    async (address) => {
      if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
        logger.log('Invalid address for Name Tag fetch:', { address });
        return null;
      }

      const normalizedAddress = address.toLowerCase();
      const cached = nameTagsRef.current[normalizedAddress];
      if (cached && Date.now() - cached.timestamp < NAME_TAG_CACHE_DURATION) {
        logger.log('Name Tag loaded from cache:', { address: normalizedAddress, nameTag: cached.nameTag });
        return cached.nameTag;
      }

      try {
        if (status !== 'authenticated') {
          logger.warn('User not authenticated for Name Tag fetch:', { address: normalizedAddress });
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
          logger.log('Name Tag not found for address:', { address: normalizedAddress });
          const cacheEntry = { nameTag: null, timestamp: Date.now() };
          nameTagsRef.current[normalizedAddress] = cacheEntry;
          setNameTags((prev) => ({
            ...prev,
            [normalizedAddress]: cacheEntry,
          }));
          return null;
        }

        const data = response.data.data[normalizedAddress];
        const nameTag = data.Labels ? Object.values(data.Labels)[0]?.['Name Tag'] || null : null;
        const cacheEntry = { nameTag, timestamp: Date.now() };
        nameTagsRef.current[normalizedAddress] = cacheEntry;
        setNameTags((prev) => ({
          ...prev,
          [normalizedAddress]: cacheEntry,
        }));
        logger.log('Name Tag fetched successfully:', { address: normalizedAddress, nameTag });
        return nameTag;
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

        logger.error('Error fetching Name Tag:', {
          address: normalizedAddress,
          message: errorMessage,
          status: error.response?.status,
        });

        const cacheEntry = { nameTag: null, timestamp: Date.now() };
        nameTagsRef.current[normalizedAddress] = cacheEntry;
        setNameTags((prev) => ({
          ...prev,
          [normalizedAddress]: cacheEntry,
        }));

        if (showToast) {
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        }
        return null;
      }
    },
    [session, status, toast]
  );

  const fetchNameTagsForAddresses = useCallback(
    async (addresses) => {
      const uniqueAddresses = [...new Set(addresses.filter((addr) => addr?.match(/^0x[a-fA-F0-9]{40}$/)))];
      if (uniqueAddresses.length === 0) {
        logger.log('No valid addresses to fetch Name Tags');
        setIsLoadingNameTags(false);
        return;
      }

      setIsLoadingNameTags(true);
      logger.log('Fetching Name Tags for addresses:', { count: uniqueAddresses.length });

      try {
        const response = await axios.post(
          '/api/nametags',
          { addresses: uniqueAddresses },
          {
            headers: {
              Authorization: `Bearer ${session?.accessToken}`,
            },
            timeout: 10000,
          }
        );

        const newNameTags = uniqueAddresses.reduce((acc, address) => {
          const normalizedAddress = address.toLowerCase();
          const data = response.data.data[normalizedAddress];
          const nameTag = data?.Labels ? Object.values(data.Labels)[0]?.['Name Tag'] || null : null;
          acc[normalizedAddress] = { nameTag, timestamp: Date.now() };
          if (!nameTag) {
            logger.log('Name Tag not found for address:', { address: normalizedAddress });
          } else {
            logger.log('Name Tag processed:', { address: normalizedAddress, nameTag });
          }
          return acc;
        }, {});

        setNameTags((prev) => {
          const updated = { ...prev, ...newNameTags };
          logger.log('Name Tags updated in state:', {
            count: Object.keys(updated).length,
            sample: Object.entries(updated).slice(0, 5),
          });
          return updated;
        });
        logger.log('Name Tags fetched:', { count: Object.keys(newNameTags).length });
      } catch (error) {
        let errorMessage;
        let showToast = true;
        if (error.response?.status === 401) {
          errorMessage = 'Unauthorized: Please log in again.';
        } else if (error.response?.status === 429) {
          errorMessage = 'Too many requests. Please try again later.';
        } else if (error.response?.status === 400) {
          errorMessage = 'Invalid addresses provided.';
        } else {
          errorMessage = error.response?.data?.detail || `Failed to fetch Name Tags: ${error.message}`;
        }

        logger.error('Error in fetchNameTagsForAddresses:', {
          message: errorMessage,
          status: error.response?.status,
        });

        uniqueAddresses.forEach((address) => {
          const normalizedAddress = address.toLowerCase();
          nameTagsRef.current[normalizedAddress] = { nameTag: null, timestamp: Date.now() };
          setNameTags((prev) => ({
            ...prev,
            [normalizedAddress]: { nameTag: null, timestamp: Date.now() },
          }));
        });

        if (showToast) {
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        }
      } finally {
        setIsLoadingNameTags(false);
      }
    },
    [session, toast]
  );

  const fetchPriceHistory = useCallback(
    debounce(
      (tokenId, days, callback, retryCount = 0) => {
        if (document.visibilityState !== 'visible') {
          callback(null);
          return;
        }
        const [coingeckoChainId, tokenAddress] = tokenId.split('/');
        const chain = chains.find((c) => c.coingeckoId === coingeckoChainId);
        const cacheKey = `${tokenId}-${days}`;
        const cached = priceHistoryCache[cacheKey];
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          setPriceHistory(cached.data);
          callback(null, cached.data);
          return;
        }
        return new Promise(async (resolve, reject) => {
          try {
            logger.log('Fetching price history from API:', { tokenId, days, chain: chain?.value });
            const response = await axios.get('/api/coingecko/history', {
              params: { id: tokenId, vs_currency: 'usd', days },
              timeout: 30000,
            }).catch(async (error) => {
              if (retryCount < 3 && (error.response?.status === 429 || error.response?.status === 503 || error.code === 'ECONNABORTED')) {
                const delay = Math.pow(2, retryCount) * 1000;
                logger.log(`Retrying fetchPriceHistory after ${delay}ms due to error`, { retryCount, status: error.response?.status, code: error.code });
                await new Promise((resolve) => setTimeout(resolve, delay));
                return fetchPriceHistory(tokenId, days, callback, retryCount + 1);
              }
              throw error;
            });

            if (!response.data?.prices) {
              throw new Error('Invalid price history data');
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
              price: parseFloat(price.toFixed(2)),
            }));
            setPriceHistoryCache((prev) => ({
              ...prev,
              [cacheKey]: { data: priceData, timestamp: Date.now() },
            }));
            setPriceHistory(priceData);
            logger.log('Price history fetched successfully:', { tokenId, count: priceData.length });
            resolve(priceData);
            callback(null, priceData);
          } catch (err) {
            logger.error('Error fetching price history:', {
              message: err.message,
              status: err.response?.status,
              data: err.response?.data,
            });
            const errorMessage =
              err.response?.status === 429
                ? 'API rate limit reached. Please wait a minute and try again.'
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
    [chains, priceHistoryCache, setPriceHistory, setPriceHistoryCache, setError, toast]
  );

  const fetchPublicTreasuryData = useCallback(
    debounce(async (tokenSymbol) => {
      if (!['bitcoin', 'ethereum'].includes(tokenSymbol.toLowerCase())) {
        return;
      }
      const treasuryType = tokenSymbol.toLowerCase() === 'bitcoin' ? 'bitcoin' : 'ethereum';
      setIsLoadingOnChain(true);
      try {
        const response = await axios.get(
          `https://api.coingecko.com/api/v3/companies/public_treasury/${treasuryType}`,
          {
            headers: {
              accept: 'application/json',
              ...(COINGECKO_API_KEY && { 'x-cg-demo-api-key': COINGECKO_API_KEY }),
            },
            timeout: 10000,
          }
        );
        const treasuryData = response.data.companies.map((company) => ({
          address: company.name || 'Unknown Company',
          balance: parseFloat(company.total_holdings || 0),
        }));
        logger.log(`Public treasury data fetched for ${treasuryType}`, {
          count: treasuryData.length,
          firstFew: treasuryData.slice(0, 3),
        });
        setOnChainData((prev) => ({
          ...prev,
          topHolders: treasuryData,
        }));
        setOnChainError(null);
      } catch (error) {
        logger.error(`Error fetching public treasury data for ${treasuryType}`, {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        setOnChainError(
          error.response?.status === 429
            ? 'CoinGecko API rate limit exceeded. Please try again later.'
            : error.response?.data?.detail || `Failed to load ${treasuryType} treasury data.`
        );
      } finally {
        setIsLoadingOnChain(false);
      }
    }, 500),
    [COINGECKO_API_KEY]
  );

  const fetchTickerData = useCallback(
    debounce(async (tokenId, retryCount = 0) => {
      if (!tokenId || document.visibilityState !== 'visible') return;
      const cacheKey = tokenId;
      if (tickerCache[cacheKey] && Date.now() - tickerCache[cacheKey].timestamp < CACHE_DURATION) {
        setTickerData(tickerCache[cacheKey].data);
        logger.log('Ticker data loaded from cache:', { tokenId });
        return;
      }

      setIsLoadingTickers(true);
      setTickerError(null);
      try {
        let response;
        const params = { include_exchange_logo: true };
        if (process.env.NODE_ENV === 'development') {
          logger.log(`Fetching tickers for ${tokenId} directly from CoinGecko in development mode`);
          response = await coingeckoAxios.get(`https://api.coingecko.com/api/v3/coins/${tokenId}/tickers`, {
            params,
            headers: {
              accept: 'application/json',
              ...(COINGECKO_API_KEY && { 'x-cg-demo-api-key': COINGECKO_API_KEY }),
            },
            timeout: 15000,
          });
        } else {
          logger.log(`Fetching tickers for ${tokenId} via proxy API`);
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
        logger.log(`Ticker data fetched for ${tokenId}`, {
          count: tickers.length,
          sampleLogos: tickers.slice(0, 3).map((t) => ({
            market: t.market.name,
            logo: t.market.logo,
            identifier: t.market.identifier,
          })),
        });
      } catch (error) {
        logger.error(`Error fetching ticker data for ${tokenId}:`, {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
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
      logger.info('fetchOnChainData called', { action, chain, address, tokenAddress, retryCount });
      console.log('fetchOnChainData called:', { action, chain, address, tokenAddress, decimalPlace, retryCount });

      if (
        (action === 'top-holders' && (!chain || !tokenAddress)) ||
        ((action === 'wallet-balances' || action === 'transactions') && !address) ||
        (typeof document !== 'undefined' && document.visibilityState !== 'visible')
      ) {
        const errorMessage = `Invalid parameters: action=${action}, chain=${chain}, address=${address}`;
        logger.error('Invalid parameters for fetchOnChainData', { action, chain, tokenAddress, address });
        console.error('Invalid parameters:', { action, chain, tokenAddress, address });
        customLogger.log('Error: Invalid parameters', { action, chain, tokenAddress, address });
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
        logger.error('Invalid chain for fetchOnChainData', { chain });
        console.error('Invalid chain:', { chain });
        customLogger.log('Error: Invalid chain', { chain });
        setOnChainError(errorMessage);
        setIsLoadingOnChain(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      if ((action === 'wallet-balances' || action === 'transactions') && status !== 'authenticated') {
        const errorMessage = 'Please log in to access wallet data.';
        logger.warn('User not authenticated for wallet data', { action, status });
        console.warn('User not authenticated:', { action, status });
        customLogger.log('Warning: User not authenticated', { action, status });
        setOnChainError(errorMessage);
        setIsLoadingOnChain(false);
        setIsLoadingWalletBalances(false);
        setIsLoadingTransactions(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      if ((action === 'wallet-balances' || action === 'transactions') && !address?.match(/^0x[a-fA-F0-9]{40}$/)) {
        const errorMessage = 'Wallet address must be a valid EVM address.';
        logger.error(errorMessage, { action, address });
        console.error(errorMessage, { action, address });
        customLogger.log('Error: Invalid EVM address', { action, address });
        if (action === 'wallet-balances') {
          setWalletBalancesError(errorMessage);
        } else {
          setTransactionsError(errorMessage);
        }
        setIsLoadingOnChain(false);
        setIsLoadingWalletBalances(false);
        setIsLoadingTransactions(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
      const apiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://xynapse-ai.vercel.app'}${apiBaseUrl}/sim`;
      logger.info('API URL configuration', { apiUrl, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL });
      console.log('API URL configuration:', { apiUrl, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL });

      setIsLoadingOnChain(true);
      if (action === 'wallet-balances') {
        setIsLoadingWalletBalances(true);
      } else if (action === 'transactions') {
        setIsLoadingTransactions(true);
      }

      try {
        const payload = {
          action,
          recaptchaToken,
        };
        if (action === 'top-holders') {
          payload.chain = simChain;
          payload.tokenAddress = tokenAddress;
          if (decimalPlace != null) payload.decimalPlace = Number(decimalPlace);
        } else if (action === 'wallet-balances' || action === 'transactions') {
          payload.address = address;
        }
        logger.info('Sending on-chain data request', { payload, apiUrl });
        console.log('Sending on-chain data request:', { payload, apiUrl });
        customLogger.log('Sending on-chain data request', { payload, apiUrl });

        const response = await axios.post(apiUrl, payload, {
          headers: {
            Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : undefined,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }).catch(async (error) => {
          if (retryCount < 3 && (error.response?.status === 429 || error.response?.status === 503 || error.code === 'ECONNABORTED')) {
            const delay = Math.pow(2, retryCount) * 1000;
            logger.info(`Retrying fetchOnChainData after ${delay}ms due to error`, { retryCount, status: error.response?.status, code: error.code });
            console.log(`Retrying fetchOnChainData after ${delay}ms due to error`, { retryCount, status: error.response?.status, code: error.code });
            await new Promise((resolve) => setTimeout(resolve, delay));
            return fetchOnChainData(chain, tokenAddress, action, decimalPlace, address, recaptchaToken, retryCount + 1);
          }
          throw error;
        });

        logger.info(`On-chain data response for ${action}`, {
          success: response.data.success,
          count: response.data.data?.length || 0,
          dataSample: response.data.data?.slice(0, 5),
        });
        console.log(`On-chain data response for ${action}:`, {
          status: response.status,
          success: response.data.success,
          count: response.data.data?.length || 0,
        });
        customLogger.log(`On-chain data response for ${action}`, {
          success: response.data.success,
          count: response.data.data?.length || 0,
        });

        if (!response.data.success) {
          throw new Error(response.data.detail || `Failed to fetch ${action} data`);
        }

        if (action === 'top-holders') {
          setOnChainData((prev) => ({
            ...prev,
            topHolders: response.data.data || [],
          }));
        } else if (action === 'wallet-balances') {
          setWalletBalances(response.data.data || []);
        } else if (action === 'transactions') {
          setTransactions(response.data.data || []);
          if (session?.user?.id) {
            try {
              await axios.post(
                '/api/wallet-history',
                {
                  uid: session.user.id,
                  walletAddress: address,
                  action: 'transactions',
                  data: response.data.data || [],
                },
                {
                  headers: {
                    Authorization: `Bearer ${session.accessToken}`,
                  },
                  timeout: 15000,
                }
              );
              logger.info('Transactions history saved', { address });
              console.log('Transactions history saved:', { address });
              customLogger.log('Transactions history saved', { address });
            } catch (historyError) {
              logger.error('Error saving transactions history', {
                message: historyError.message,
                response: historyError.response?.data,
              });
              console.error('Error saving transactions history:', {
                message: historyError.message,
                response: historyError.response?.data,
              });
              customLogger.log('Error saving transactions history', {
                message: historyError.message,
              });
            }
          }
        }
      } catch (error) {
        logger.error(`Error fetching ${action} data`, {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
          stack: error.stack,
          url: apiUrl,
        });
        console.error(`Error fetching ${action} data:`, {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
          stack: error.stack,
        });
        customLogger.log(`Error fetching ${action} data`, {
          status: error.response?.status,
          message: error.message,
        });
        const errorMessage =
          error.response?.status === 401
            ? 'Unauthorized: Please log in again.'
            : error.response?.status === 429
              ? 'Dune Sim API rate limit exceeded. Please try again later.'
              : error.response?.status === 503
                ? 'Service temporarily unavailable. Please try again later.'
                : error.response?.data?.errors
                  ? `Validation errors: ${error.response.data.errors?.map((e) => e.msg).join(', ')}`
                  : error.response?.data?.detail || `Failed to load ${action} data: ${error.message}`;
        if (action === 'wallet-balances') {
          setWalletBalancesError(errorMessage);
        } else if (action === 'transactions') {
          setTransactionsError(errorMessage);
        } else {
          setOnChainError(errorMessage);
          toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        }
      } finally {
        setIsLoadingOnChain(false);
        if (action === 'wallet-balances') {
          setIsLoadingWalletBalances(false);
        } else if (action === 'transactions') {
          setIsLoadingTransactions(false);
        }
      }
    }, 500),
    [chains, status, session?.accessToken, toast]
  );

  const fetchDexData = useCallback(
    debounce(async (chain, tokenAddress, retryCount = 0) => {
      if (!chain || !tokenAddress || document.visibilityState !== 'visible') {
        const errorMessage = 'Invalid chain or token address for DEX data';
        logger.error(errorMessage, { chain, tokenAddress });
        setDexError(errorMessage);
        setIsLoadingDex(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      const geckoChain = GECKOTERMINAL_CHAIN_MAPPING[chain];
      if (!geckoChain) {
        const errorMessage = `Unsupported chain for DEX data: ${chain}`;
        logger.error(errorMessage, { chain });
        setDexError(errorMessage);
        setIsLoadingDex(false);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        return;
      }

      // Check cache first
      const cacheKey = `${geckoChain}-${tokenAddress}`;
      const cached = tickerCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        setDexData(cached.data);
        logger.log('DEX data loaded from cache:', { cacheKey });
        setIsLoadingDex(false);
        return;
      }

      setIsLoadingDex(true);
      setDexError(null);

      try {
        // Fetch only the first page of pools to reduce API calls
        const poolResponse = await coingeckoAxios.get(
          `https://api.geckoterminal.com/api/v2/networks/${geckoChain}/tokens/${tokenAddress}/pools?page=1`,
          {
            headers: { accept: 'application/json' },
            timeout: 10000, // Reduced timeout for faster failure
          }
        );

        let pools = poolResponse.data?.data || [];
        // Sort pools by 24h volume and take top 5
        pools.sort((a, b) => parseFloat(b.attributes.volume_usd.h24) - parseFloat(a.attributes.volume_usd.h24));
        const topPools = pools.slice(0, 5);

        // Fetch trades for top pools using Promise.allSettled for robustness
        const tradePromises = topPools.map((pool) =>
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
            error,
          }))
        );

        const tradeResults = await Promise.allSettled(tradePromises);
        const trades = tradeResults.reduce((acc, result, index) => {
          if (result.status === 'fulfilled') {
            return acc.concat(
              result.value.data.map((trade) => ({
                ...trade.attributes,
                pool_name: result.value.poolName,
                pool_address: result.value.poolAddress,
              }))
            );
          } else {
            logger.warn('Trade fetch failed for pool:', {
              poolAddress: result.value.poolAddress,
              error: result.value.error.message,
            });
            return acc;
          }
        }, []);

        const dexData = { pools: topPools, trades };
        setTickerCache((prev) => ({
          ...prev,
          [cacheKey]: { data: dexData, timestamp: Date.now() },
        }));
        setDexData(dexData);
        logger.info('DEX data fetched successfully', {
          chain: geckoChain,
          tokenAddress,
          poolCount: topPools.length,
          tradeCount: trades.length,
        });
      } catch (error) {
        logger.error('Error fetching DEX data:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
        const errorMessage =
          error.response?.status === 429
            ? 'GeckoTerminal API rate limit exceeded. Please try again later.'
            : error.response?.status === 404
              ? `No DEX data found for token ${tokenAddress} on ${chain}.`
              : error.response?.data?.detail || 'Failed to load DEX data.';
        setDexError(errorMessage);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
      } finally {
        setIsLoadingDex(false);
      }
    }, 500),
    [toast, tickerCache]
  );

  const handleAddressClick = useCallback(
    (address) => {
      if (address === 'Unknown') {
        setWalletBalancesError('Cannot fetch balances for unknown address.');
        return;
      }
      logger.log('Address clicked', {
        address,
        selectedToken: selectedToken ? selectedToken.id : null,
        onChainData: {
          topHoldersCount: onChainData.topHolders.length,
          whaleActivityCount: onChainData.whaleActivity.length,
        },
      });
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
        logger.log('Wallet search initiated', {
          walletAddress,
          selectedToken: selectedToken ? selectedToken.id : null,
          onChainData: {
            topHoldersCount: onChainData.topHolders.length,
            whaleActivityCount: onChainData.whaleActivity.length,
          },
        });
        setSelectedWallet(walletAddress);
        setWalletBalances([]);
        setTransactions(null);
        setWalletBalancesError(null);
        setTransactionsError(null);
        setIsLoadingWalletBalances(true);
        fetchOnChainData(null, null, 'wallet-balances', null, walletAddress, recaptchaToken);
      } catch (error) {
        logger.error('Error in wallet search:', error.response?.data || error.message);
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

      const normalizedPlatforms = Object.keys(token.detail_platforms || {}).reduce((acc, cgId) => {
        const chain = chains.find((c) => c.coingeckoId === cgId);
        if (chain && token.detail_platforms[cgId].contract_address?.match(/^0x[a-fA-F0-9]{40}$/)) {
          const decimalPlace = Number(token.detail_platforms[cgId].decimal_place) || 18;
          if (decimalPlace < 0 || decimalPlace > 36) {
            logger.warn(`Invalid decimalPlace for ${cgId}: ${decimalPlace}, defaulting to 18`);
          }
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
        const result = {
          chain: selectedChain,
          tokenAddress: normalizedPlatforms[selectedChain].address,
          decimalPlace: normalizedPlatforms[selectedChain].decimal_place,
        };
        logger.log('Default chain and address:', result);
        return result;
      }

      if (availableChains.length > 0) {
        const defaultChain = availableChains[0].value;
        const tokenAddress = normalizedPlatforms[defaultChain].address;
        const decimalPlace = normalizedPlatforms[defaultChain].decimal_place;
        const result = { chain: defaultChain, tokenAddress, decimalPlace };
        logger.log('Default chain and address:', result);
        return result;
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

      const tokenSymbol = token.symbol?.toLowerCase();
      if (fallbackTokens[tokenSymbol]) {
        logger.log(`Using fallback for ${tokenSymbol.toUpperCase()}:`, fallbackTokens[tokenSymbol]);
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

    if (JSON.stringify(availableChains) !== JSON.stringify(prevAvailableChainsRef.current)) {
      logger.log(
        'Available chains:',
        availableChains.map((c) => ({
          value: c.value,
          label: c.label,
          decimalPlace: normalizedPlatforms[c.value]?.decimal_place,
        }))
      );
      prevAvailableChainsRef.current = availableChains;
    }

    return availableChains;
  }, [selectedToken, chains]);

  const debouncedHandleTokenSelect = useCallback(
    debounce(async (token) => {
      logger.log('debouncedHandleTokenSelect called for token:', { id: token.id, symbol: token.symbol });
      try {
        const recaptchaToken = await executeRecaptcha('coin_details');
        const response = await axios.get('/api/coingecko', {
          params: {
            action: 'coin-details',
            id: token.id,
            recaptchaToken,
          },
        });
        logger.log('CoinGecko /coins/{id} response:', { id: response.data.id });
        const fullToken = {
          id: response.data.id,
          symbol: response.data.symbol,
          name: response.data.name,
          image: response.data.image?.thumb,
          current_price: response.data.market_data?.current_price?.usd,
          market_cap: response.data.market_data?.market_cap?.usd,
          total_volume: response.data.market_data?.total_volume?.usd,
          high_24h: response.data.market_data?.high_24h?.usd,
          low_24h: response.data.market_data?.low_24h?.usd,
          price_change_percentage_24h: response.data.market_data?.price_change_percentage_24h,
          price_change_24h: response.data.market_data?.price_change_24h?.usd,
          market_cap_change_24h: response.data.market_data?.market_cap_change_24h?.usd,
          market_cap_change_percentage_24h: response.data.market_data?.market_cap_change_percentage_24h,
          circulating_supply: response.data.market_data?.circulating_supply,
          total_supply: response.data.market_data?.total_supply,
          max_supply: response.data.market_data?.max_supply,
          fully_diluted_valuation: response.data.market_data?.fully_diluted_valuation?.usd,
          ath: response.data.market_data?.ath?.usd,
          ath_change_percentage: response.data.market_data?.ath_change_percentage?.usd,
          ath_date: response.data.market_data?.ath_date?.usd,
          atl: response.data.market_data?.atl?.usd,
          atl_change_percentage: response.data.market_data?.atl_change_percentage?.usd,
          atl_date: response.data.market_data?.atl_date?.usd,
          roi: response.data.market_data?.roi || response.data.roi,
          last_updated: response.data.last_updated,
          market_cap_rank: response.data.market_cap_rank,
          platforms: response.data.platforms || {},
          detail_platforms: response.data.detail_platforms || {},
        };
        logger.log('Setting selectedToken:', { id: fullToken.id, symbol: fullToken.symbol, roi: fullToken.roi });
        setSelectedToken(fullToken);
        setSelectedPair(`${fullToken.symbol?.toUpperCase()}/USD`);
        const { chain } = getDefaultChainAndAddress(fullToken, 'ethereum');
        setSelectedChain(chain || 'ethereum');
        setAnalysis(null);
        setPrediction(null);
        setAnalysisLinks([]);
        setIsDropdownOpen(false);
        setOnChainData({ topHolders: [], whaleActivity: [] });
        setOnChainError(null);

        const days = timeRange || '1';
        const tokenId = fullToken.id;
        fetchPriceHistory(tokenId, days, (err, data) => {
          if (err) {
            logger.error('Price history fetch failed on token select:', { error: err.message });
            setError(
              err.response?.status === 429
                ? 'API rate limit reached. Please wait a minute and try again.'
                : err.response?.data?.detail || 'Failed to load price history.'
            );
          } else {
            logger.log('Price history fetched on token select:', { tokenId, count: data?.length || 0 });
          }
        });
      } catch (error) {
        logger.error('Error fetching token details:', error.response?.data || error.message);
        setError(
          error.response?.status === 429
            ? 'CoinGecko rate limit reached. Please wait a minute and try again.'
            : error.response?.data?.detail || 'Failed to load token details.'
        );
      }
    }, 500),
    [timeRange, fetchPriceHistory, setSelectedToken, setSelectedPair, setSelectedChain, setAnalysis, setPrediction, setAnalysisLinks, setIsDropdownOpen, setOnChainData, setOnChainError, setError, executeRecaptcha, getDefaultChainAndAddress, chains]
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
            logger.log('Analysis saved successfully:', { token: selectedToken.symbol });
            if (interactionRes.data.pointsAwarded > 0 || dailyMarketInteractions < 5) {
              setDailyMarketInteractions((prev) => Math.min(prev + 1, 5));
            }
          } catch (interactionError) {
            logger.error('Error saving analysis:', interactionError.response?.data || interactionError.message);
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
        logger.error('Error during analysis:', error.response?.data || error.message);
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
            logger.log('Prediction saved successfully:', { token: selectedToken.symbol });
            if (interactionRes.data.pointsAwarded > 0 || dailyMarketInteractions < 5) {
              setDailyMarketInteractions((prev) => Math.min(prev + 1, 5));
            }
          } catch (interactionError) {
            logger.error('Error saving prediction:', interactionError.response?.data || interactionError.message);
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
        logger.error('Error during prediction:', error.response?.data || error.message);
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
        logger.log('Searching coins with query:', query);
        const response = await axios.get('/api/coingecko', {
          params: { action: 'search', query },
        });
        const results = response.data.map((coin) => ({
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          image: coin.thumb,
          market_cap_rank: coin.market_cap_rank,
        }));
        logger.log('Search results fetched:', { count: results.length });
        setSearchResults(results.slice(0, 10));
      } catch (error) {
        logger.error('Error searching coins:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
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
          params: { start: 1, limit: tokensPerPage, convert: 'usd' },
        });
        const tokensWithRoi = marketResponse.data.map((token) => ({
          ...token,
          roi: token.roi || null,
        }));
        setTokens(tokensWithRoi);
        if (!selectedToken && !lastFetchedTokenRef.current) {
          const btc = tokensWithRoi.find((token) => token.id === 'bitcoin');
          if (btc) {
            logger.log('Selecting default token:', { id: btc.id });
            debouncedHandleTokenSelect(btc);
          }
        }
        setLoading(false);
      } catch (error) {
        logger.error('Error fetching market data:', error.response?.data || error.message);
        if (error.response?.status === 429 && retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000;
          logger.log(`Retrying fetchMarketData after ${delay}ms due to 429 error`);
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
    [selectedToken, debouncedHandleTokenSelect]
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
          logger.error('Price history fetch failed:', { error: err.message });
          setError(
            err.response?.status === 429
              ? 'API rate limit reached. Please wait a minute and try again.'
              : err.response?.data?.detail || 'Failed to load price history.'
          );
        } else {
          logger.log('Price history fetched:', { tokenId, count: data?.length || 0 });
        }
      });
    }
    const interval = setInterval(() => {
      if (selectedToken && timeRange) {
        const tokenId = selectedToken.id;
        fetchPriceHistory(tokenId, timeRange, (err, data) => {
          if (err) {
            logger.error('Price history interval fetch failed:', { error: err.message });
          } else {
            logger.log('Price history interval callback success:', { tokenId: selectedToken.id, count: data?.length || 0 });
          }
        });
      }
    }, 60000);
    return () => {
      clearInterval(interval);
      fetchPriceHistory.cancel && fetchPriceHistory.cancel();
    };
  }, [selectedToken, timeRange, fetchPriceHistory]);

  useEffect(() => {
    debouncedSearch(searchQuery);
    return () => debouncedSearch.cancel();
  }, [searchQuery, debouncedSearch]);

  useEffect(() => {
    if (!selectedToken?.id) return;

    const tokenSymbol = selectedToken.id.toLowerCase();
    const isTreasuryToken = ['bitcoin', 'ethereum'].includes(tokenSymbol);
    const { chain, tokenAddress, decimalPlace } = getDefaultChainAndAddress(selectedToken, selectedChain);
    const tokenKey = isTreasuryToken
      ? `${selectedToken.id}-treasury`
      : `${selectedToken.id}-${chain}-${tokenAddress}-${decimalPlace}`;

    if (lastFetchedTokenRef.current === tokenKey && onChainData.topHolders.length > 0) {
      logger.log('Skipping redundant fetch for:', { tokenKey });
      return;
    }

    setIsLoadingOnChain(true);
    setOnChainData((prev) => ({ ...prev, topHolders: [] }));

    if (isTreasuryToken) {
      logger.log(`Fetching public treasury data for ${tokenSymbol}`);
      lastFetchedTokenRef.current = tokenKey;
      fetchPublicTreasuryData(tokenSymbol);
    } else {
      if (!chain || !tokenAddress) {
        logger.log('Skipping on-chain data fetch: no valid chain or token address');
        setIsLoadingOnChain(false);
        setOnChainError('No valid chain or token address available for this token.');
        return;
      }

      logger.log('Triggering fetchOnChainData for:', { chain, tokenAddress, decimalPlace });
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
          logger.error('Error fetching daily market interactions:', err);
        }
      }
    }
    fetchDailyMarketInteractions();
  }, [session]);

  useEffect(() => {
    if (onChainData.topHolders.length > 0) {
      const addresses = onChainData.topHolders
        .map((holder) => holder.address)
        .filter((addr) => addr && addr.match(/^0x[a-fA-F0-9]{40}$/) && !nameTags[addr.toLowerCase()]);
      if (addresses.length > 0) {
        logger.log('Triggering fetchNameTagsForAddresses:', { count: addresses.length, addresses });
        fetchNameTagsForAddresses(addresses);
      } else {
        setIsLoadingNameTags(false);
        logger.log('No new valid addresses in topHolders for Name Tag fetch');
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
        logger.log('Skipping DEX data refresh: data still fresh', { cacheKey });
        return;
      }
      if (document.visibilityState === 'visible') {
        logger.log('Background DEX data refresh triggered', { chain, tokenAddress });
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
    isLoadingDex,
    dexError,
    fetchDexData,

    // Constants
    SUPPORTED_CHAINS,
    WALLET_SEARCH_LIMIT,
    WALLET_SEARCH_WINDOW,

    // Refs
    lastFetchedTokenRef,
    prevTopHoldersRef,
    prevAvailableChainsRef,
  };
};