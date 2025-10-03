// components/WatchlistsTab.jsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAddress } from 'ethers';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { SUPPORTED_CHAINS, CHAIN_MAPPING, CHAIN_ID_TO_NAME, SUPPORTED_SVM_CHAINS } from '../utils/constants';
import { formatDistanceToNow } from 'date-fns';
import useSWR from 'swr';
import { cacheData, getCachedData } from '../utils/indexedDB';
import { LoadingOverlay, truncateAddress, formatPrice, isValidToken, getExplorerUrls } from '../utils/helpers';
import { logger } from '../utils/clientLogger';
import { debounce } from 'lodash';
import { Virtuoso } from 'react-virtuoso';

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.code === 'ECONNABORTED' || error.response?.status >= 500,
});

// Utility constants
const NATIVE_TOKEN_INFO = {
  ethereum: { name: 'Ethereum', symbol: 'ETH', logo: '/ethereum-logo.webp' },
  base: { name: 'Base', symbol: 'ETH', logo: '/base-logo.webp' },
  bnb: { name: 'BNB', symbol: 'BNB', logo: '/bnb-logo.webp' },
  solana: { name: 'Solana', symbol: 'SOL', logo: '/solana-logo.webp' },
  eclipse: { name: 'Eclipse', symbol: 'ETH', logo: '/eclipse-logo.webp' },
};

const Tooltip = ({ children, text }) => {
  const [isVisible, setIsVisible] = useState(false);
  return (
    <div
      className="relative group"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onTouchStart={() => setIsVisible(true)}
      onTouchEnd={() => setTimeout(() => setIsVisible(false), 2000)}
    >
      {children}
      <div
        className={`absolute ${isVisible ? 'block' : 'hidden'} bg-white/5 backdrop-blur-md border border-white/10 text-white/80 text-[9px] sm:text-[10px] py-1 sm:py-1.5 px-2 sm:px-3 rounded-lg shadow-neon-sm z-20 top-8 sm:top-10 left-1/2 -translate-x-1/2 max-w-[200px] text-center leading-relaxed`}
      >
        {text.split(' - ').map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
};

const copyAddress = (address, toast) => {
  navigator.clipboard.writeText(address).then(() => {
    toast.success('Address copied to clipboard!', { position: 'top-center', autoClose: 3000 });
  }).catch(() => {
    toast.error('Failed to copy address.', { position: 'top-center', autoClose: 3000 });
  });
};

export default function WatchlistsTab({ initialTab = 'PORTFOLIO', initialAddress = null, toast }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showWatchlistSidebar, setShowWatchlistSidebar] = useState(false);
  const [isUserInitiatedChange, setIsUserInitiatedChange] = useState(false);
  const lastSelectedWalletRef = useRef(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 640);
  const [watchlists, setWatchlists] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newChainType, setNewChainType] = useState('EVM');
  const [error, setError] = useState(null);
  const [loadingStates, setLoadingStates] = useState({
    loading: false,
    balances: false,
    transactions: false,
    tokenInfo: false,
  });
  const [activeChainType, setActiveChainType] = useState('EVM');
  const [activeChain, setActiveChain] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab.toUpperCase());
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [tokenInfo, setTokenInfo] = useState({});
  const [chainsWithAssets, setChainsWithAssets] = useState([]);
  const [nameTags, setNameTags] = useState({});
  const [chains, setChains] = useState([]);
  const [newWalletName, setNewWalletName] = useState('');
  const [forceFetch, setForceFetch] = useState(false);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
  const EVM_LOGOS = ['ethereum', 'base', 'bnb'];
  const SVM_LOGOS = ['solana', 'eclipse'];

  const stableWatchlists = useMemo(() => watchlists, [watchlists]);

  const filteredBalances = useMemo(() => {
    const validBalances = balances
      .filter((b) => {
        if (activeChain === null) return true;
        return b.chain === activeChain;
      })
      .filter((b) => isValidToken({ image: b.logo, symbol: b.symbol }));
    return validBalances.sort((a, b) => {
      const valueA = Number(a.value_usd) || 0;
      const valueB = Number(b.value_usd) || 0;
      return valueB - valueA; // Descending order
    });
  }, [balances, activeChain]);

  // Calculate total value USD
  const totalValue = useMemo(() => {
    return filteredBalances.reduce((sum, balance) => sum + (Number(balance.value_usd) || 0), 0);
  }, [filteredBalances]);

  const totalValueUSD = useMemo(() => {
    return totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }, [totalValue]);

  // Debounced state update for transactions
  const debouncedSetTransactions = useCallback(
    debounce((newTransactions) => {
      setTransactions((prev) => {
        const uniqueTxs = [...new Map([...prev, ...newTransactions].map((tx) => [`${tx.chain}-${tx.hash}`, tx])).values()];
        return uniqueTxs.sort((a, b) => new Date(b.block_time || 0) - new Date(a.block_time || 0));
      });
    }, 500),
    []
  );

  // Log sorted balances to verify USDT position
  useEffect(() => {
    if (!selectedWallet || !balances) return;
    const validBalances = balances.filter((balance) =>
      isValidToken({ image: balance.logo, symbol: balance.symbol })
    );
    const filteredAndSortedBalances = validBalances
      .filter((b) => (activeChain === null ? true : b.chain === activeChain))
      .sort((a, b) => {
        const valueA = Number(a.value_usd) || 0;
        const valueB = Number(b.value_usd) || 0;
        return valueB - valueA; // Descending order
      });
    logger.log('Sorted wallet balances in WatchlistsTab:', {
      walletAddress: selectedWallet.address,
      activeChain,
      topBalances: filteredAndSortedBalances.slice(0, 5).map((b) => ({
        symbol: b.symbol,
        value_usd: b.value_usd,
        chain: b.chain,
        address: b.address,
      })),
      usdtIncluded: filteredAndSortedBalances.some(
        (b) =>
          b.symbol === 'USDT' &&
          b.address.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7' &&
          b.chain === 'ethereum'
      ),
    });
  }, [selectedWallet, balances, activeChain]);

  const updateUrl = useCallback(
    debounce((address) => {
      if (!address) {
        router.replace('/dashboard?tab=watchlists', { scroll: false });
        return;
      }
      const currentAddress = searchParams.get('address');
      if (address.toLowerCase() !== currentAddress?.toLowerCase()) {
        const newParams = new URLSearchParams();
        newParams.set('tab', 'watchlists');
        newParams.set('address', address);
        const url = `/dashboard?${newParams.toString()}`;
        logger.log('Updating URL:', { url });
        router.replace(url, { scroll: false });
      }
    }, 300),
    [router, searchParams]
  );

  const handleTabClick = useCallback((tab) => {
    logger.log('Tab clicked:', { tab });
    setActiveTab(tab);
  }, []);

  useEffect(() => {
    const addressFromUrl = searchParams.get('address');
    logger.log('useEffect triggered - searchParams:', {
      addressFromUrl,
      activeTab,
      selectedWallet,
    });

    if (isUserInitiatedChange) {
      logger.log('Skipping selectedWallet update due to user-initiated change');
      setIsUserInitiatedChange(false);
      return;
    }

    if (addressFromUrl && addressFromUrl === lastSelectedWalletRef.current) {
      logger.log('Skipping selectedWallet update: URL matches last selected wallet');
      return;
    }

    if (watchlists.length > 0 && isInitialLoad) {
      let wallet = null;
      if (addressFromUrl) {
        wallet = watchlists.find((w) => w.address === addressFromUrl);
      }
      if (!wallet && initialAddress) {
        wallet = watchlists.find((w) => w.address === initialAddress);
      }
      if (!wallet) {
        wallet = watchlists[0];
      }
      if (wallet && wallet.address !== selectedWallet?.address) {
        logger.log('Setting selectedWallet from URL or initialAddress:', { address: wallet.address });
        setSelectedWallet(wallet);
        setActiveChainType(wallet.chainType || 'EVM');
        setBalances([]);
        setTransactions([]);
        setTokenInfo({});
        setActiveChain(null);
        lastSelectedWalletRef.current = wallet.address;
        setIsInitialLoad(false);
      }
    }
  }, [searchParams, watchlists, selectedWallet, isUserInitiatedChange, isInitialLoad, initialAddress]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showAddModal) {
        setShowAddModal(false);
        setNewWalletName('');
        setNewAddress('');
        setError(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAddModal]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isValidSolanaAddress = useCallback(
    (address) => {
      return address && address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
    },
    []
  );

  const { data: supportedChains, isLoading: chainsLoading } = useQuery({
    queryKey: ['supportedChains'],
    queryFn: async () => {
      const response = await axios.get(`${API_BASE_URL}/api/coingecko/chains`, { timeout: 15000 });
      if (!response.data.success) throw new Error('Failed to load supported chains');
      return response.data.data;
    },
    onError: (error) => {
      toast.error('Failed to load supported chains', { position: 'top-center', autoClose: 5000 });
      setChains(
        SUPPORTED_CHAINS.map((chain) => ({
          coingeckoId: Object.keys(CHAIN_MAPPING).find((key) => CHAIN_MAPPING[key].simChain === chain.value) || null,
          value: chain.value,
          label: chain.label,
          shortName: chain.label.split(' ')[0],
          chainId: chain.chainId,
          testnet: chain.testnet || false,
          image: chain.image || '/icons/default.webp',
        }))
      );
    },
  });

  useEffect(() => {
    if (supportedChains) {
      const mappedChains = SUPPORTED_CHAINS.map((simChain) => {
        const coingeckoChain = supportedChains.find((cg) => CHAIN_MAPPING[cg.id]?.simChain === simChain.value);
        return {
          coingeckoId: coingeckoChain?.id || null,
          value: simChain.value,
          label: simChain.label,
          shortName: coingeckoChain?.shortname || simChain.label.split(' ')[0],
          chainId: simChain.chainId,
          testnet: simChain.testnet || false,
          image: coingeckoChain?.image?.large || simChain.image || '/icons/default.webp',
        };
      });
      setChains(mappedChains);
    }
  }, [supportedChains]);

  const fetchDataQuery = async (action, address, chainType) => {
    const isValidEVM = isAddress(address);
    const isValidSVM = isValidSolanaAddress(address);
    if (!isValidEVM && !isValidSVM) {
      throw new Error(`Invalid address format for ${address}`);
    }

    const cacheKey = `${action}-${address}-${chainType}`;
    let cachedData = null;

    try {
      cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        logger.log(`Cache hit for ${cacheKey}`, { data: cachedData });
        return cachedData;
      }
    } catch (error) {
      logger.warn(`IndexedDB not available, skipping cache for ${cacheKey}`, { error });
    }

    const payload = {
      action,
      address,
      ...(isValidEVM ? { chain_ids: '1,137,10,42161,8453' } : { chains: SUPPORTED_SVM_CHAINS.join(',') }),
      limit: 1000,
    };

    try {
      const apiUrl = `${API_BASE_URL}/api/sim`;
      logger.log(`Fetching ${action} for address: ${address}, chainType: ${chainType}`, { payload });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
          'x-recaptcha-token': 'no-recaptcha',
        },
        body: JSON.stringify(payload),
        credentials: 'include',
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

      // Update state incrementally
      const updateState = debounce((newData) => {
        if (action === 'transactions') {
          debouncedSetTransactions(newData);
        } else if (action === 'wallet-balances') {
          setBalances((prev) => {
            const uniqueBalances = [...new Map([...prev, ...newData].map((b) => [`${b.chain}-${b.address}`, b])).values()];
            return uniqueBalances;
          });
        }
      }, 500);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        try {
          const trimmedBuffer = buffer.trim();
          if (trimmedBuffer.startsWith('[') && trimmedBuffer.endsWith(']')) {
            const parsed = JSON.parse(trimmedBuffer);
            data = [...data, ...parsed];
            updateState(parsed);
            buffer = '';
          } else {
            const lines = buffer.split('\n').filter((line) => line.trim());
            for (const line of lines) {
              if (line.startsWith('[') || line.endsWith(']')) continue;
              const cleanLine = line.startsWith(',') ? line.slice(1) : line;
              if (cleanLine) {
                try {
                  const parsedChunk = JSON.parse(`[${cleanLine}]`);
                  data = [...data, ...parsedChunk];
                  updateState(parsedChunk);
                } catch (e) {
                  logger.log(`Incomplete JSON chunk, continuing to read: ${e.message}`);
                  continue;
                }
              }
            }
            buffer = lines.length > 0 ? lines[lines.length - 1] : '';
          }
        } catch (e) {
          logger.log(`Incomplete JSON chunk, continuing to read: ${e.message}`);
          continue;
        }
      }

      // Handle any remaining buffer
      if (buffer) {
        try {
          const trimmedBuffer = buffer.trim();
          if (trimmedBuffer.startsWith('[') && trimmedBuffer.endsWith(']')) {
            const parsed = JSON.parse(trimmedBuffer);
            data = [...data, ...parsed];
            updateState(parsed);
          } else {
            logger.error(`Final buffer is not valid JSON:`, { buffer });
            throw new Error(`Invalid JSON response from ${action} API`);
          }
        } catch (e) {
          logger.error(`Error parsing final JSON buffer for ${action}:`, { error: e.message, buffer });
          throw new Error(`Invalid JSON response from ${action} API`);
        }
      }

      logger.log(`Parsed ${action} data:`, { address, dataLength: data.length });

      if (data.length > 0) {
        try {
          await cacheData(cacheKey, data);
          logger.log(`Cached data for ${cacheKey}`);
        } catch (cacheError) {
          logger.warn(`Failed to cache data for ${cacheKey}`, { cacheError });
        }
      }

      return data;
    } catch (error) {
      const errorMessage =
        error.response?.status === 429
          ? 'Too many requests. Please try again later.'
          : error.response?.status === 401
            ? 'Unauthorized: Please log in again.'
            : error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')
              ? 'reCAPTCHA verification failed. Please try again.'
              : error.response?.data?.detail || `Dune Sim API error for action ${action}: ${error.message}`;
      logger.error(`Error fetching ${action}:`, { errorMessage, stack: error.stack });
      throw new Error(errorMessage);
    }
  };

  const { data: balancesData, error: balancesError, isValidating: balancesValidating } = useSWR(
    selectedWallet ? ['wallet-balances', selectedWallet.address, activeChainType] : null,
    () => fetchDataQuery('wallet-balances', selectedWallet.address, activeChainType),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const { data: transactionsData, error: transactionsError, isValidating: transactionsValidating } = useSWR(
    selectedWallet && activeTab === 'ACTIVITY' ? ['transactions', selectedWallet.address, activeChainType] : null,
    () => fetchDataQuery('transactions', selectedWallet.address, activeChainType),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  useEffect(() => {
    if (balancesError || transactionsError) {
      const errorMessage = balancesError?.message || transactionsError?.message || 'Failed to load data';
      setError(errorMessage);
      if (balancesError) setBalances([]);
      if (transactionsError) setTransactions([]);
    }
  }, [balancesError, transactionsError]);

  useEffect(() => {
    if (balancesData) {
      setBalances(balancesData);
      const chainsWithData = [...new Set(balancesData.map((b) => CHAIN_ID_TO_NAME[b.chain] || b.chain))];
      setChainsWithAssets(chainsWithData);
      if (activeChain === undefined && chainsWithData.length > 0) {
        setActiveChain(chainsWithData[0]);
      }
    }
    if (transactionsData) {
      debouncedSetTransactions(transactionsData.map((tx) => ({
        ...tx,
        chain: CHAIN_ID_TO_NAME[tx.chain] || tx.chain,
      })));
    }
    setLoadingStates({
      loading: chainsLoading,
      balances: balancesValidating,
      transactions: transactionsValidating,
      tokenInfo: false,
    });
  }, [balancesData, transactionsData, chainsLoading, balancesValidating, transactionsValidating, debouncedSetTransactions]);

  const { data: tokenInfoData, error: tokenInfoError, isValidating: tokenInfoValidating } = useSWR(
    selectedWallet && balances.length > 0 ? ['tokenInfo', balances.map((b) => b.address)] : null,
    async () => {
      const tokenAddresses = balances
        .filter((b) => b.address !== 'native')
        .map((b) => ({ address: b.address, chain: b.chain }))
        .slice(0, 5);
      const tokenInfoData = {};

      for (const { address, chain } of tokenAddresses) {
        const isValidEVM = isAddress(address);
        const isValidSVM = isValidSolanaAddress(address);
        if (!isValidEVM && !isValidSVM) continue;

        const cacheKey = `tokenInfo-${address}-${chain}`;
        let cachedData = null;
        try {
          cachedData = await getCachedData(cacheKey);
          if (cachedData) {
            tokenInfoData[address] = cachedData;
            continue;
          }
        } catch (error) {
          logger.warn(`IndexedDB not available, skipping cache for ${cacheKey}`, { error });
        }

        try {
          const payload = {
            action: 'wallet-balances',
            address,
            ...(isValidEVM ? { chain_ids: CHAIN_MAPPING[chain]?.chainId || '' } : { chains: SUPPORTED_SVM_CHAINS.join(',') }),
            limit: 1,
            metadata: 'logo',
          };

          logger.log(`Fetching token info for address: ${address}, chain: ${chain}`, { payload });

          const response = await fetch(`${API_BASE_URL}/api/sim`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
              'x-recaptcha-token': 'no-recaptcha',
            },
            body: JSON.stringify(payload),
            credentials: 'include',
          });

          if (!response.ok) {
            const text = await response.text();
            let errorMessage = `Failed to fetch token info for ${address} on ${chain}: ${response.status} ${response.statusText}`;
            try {
              const result = JSON.parse(text);
              errorMessage = result.detail || errorMessage;
            } catch {
              errorMessage = `Failed to fetch token info for ${address} on ${chain}: Invalid JSON response`;
            }
            throw new Error(errorMessage);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let data = [];
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            try {
              const parsed = JSON.parse(buffer);
              if (Array.isArray(parsed)) {
                parsed.forEach((chunk) => {
                  if (chunk.success && Array.isArray(chunk.data)) {
                    data = [...data, ...chunk.data];
                  }
                });
                buffer = ''; // Clear buffer after successful parse
              }
            } catch (e) {
              // If JSON is incomplete, continue reading next chunk
              continue;
            }
          }

          // Handle any remaining buffer
          if (buffer) {
            try {
              const parsed = JSON.parse(buffer);
              if (Array.isArray(parsed)) {
                parsed.forEach((chunk) => {
                  if (chunk.success && Array.isArray(chunk.data)) {
                    data = [...data, ...chunk.data];
                  }
                });
              }
            } catch (e) {
              logger.error(`Error parsing final JSON buffer for token info ${address} on ${chain}:`, { error: e.message, buffer });
              throw new Error(`Invalid JSON response from token info API`);
            }
          }

          logger.log(`Parsed token info for ${address} on ${chain}:`, { data });

          if (data.length > 0) {
            const tokenData = data[0];
            const tokenInfo = [
              {
                chain,
                symbol: tokenData.symbol || 'Unknown',
                logo: tokenData.logo || '/fallback-image.webp',
                name: tokenData.name || 'Unknown Token',
              },
            ];
            tokenInfoData[address] = tokenInfo;
            try {
              await cacheData(cacheKey, tokenInfo);
              logger.log(`Cached token info for ${cacheKey}`);
            } catch (cacheError) {
              logger.warn(`Failed to cache token info for ${cacheKey}`, { cacheError });
            }
          } else {
            tokenInfoData[address] = [
              {
                chain,
                symbol: 'Unknown',
                logo: '/fallback-image.webp',
                name: 'Unknown Token',
              },
            ];
          }
        } catch (err) {
          logger.error(`Error fetching token info for ${address} on ${chain}:`, { error: err });
          tokenInfoData[address] = [
            {
              chain,
              symbol: 'Unknown',
              logo: '/fallback-image.webp',
              name: 'Unknown Token',
            },
          ];
        }
      }
      return tokenInfoData;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  useEffect(() => {
    if (tokenInfoError) {
      const errorMessage = tokenInfoError.message || 'Failed to load token info';
      setError(errorMessage);
    }
    if (tokenInfoData) setTokenInfo(tokenInfoData);
    setLoadingStates((prev) => ({ ...prev, tokenInfo: tokenInfoValidating }));
  }, [tokenInfoData, tokenInfoError, tokenInfoValidating]);

  const { data: userTier, isLoading: userTierLoading } = useQuery({
    queryKey: ['userTier', session?.user?.id],
    queryFn: async () => {
      const response = await axios.get(`/api/user?uid=${encodeURIComponent(session.user.id)}`, {
        withCredentials: true,
      });
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to fetch user tier');
      return {
        isPremium: response.data.user.isPremium || false,
        tier: response.data.user.isPremium ? 'Premium' : response.data.user.tier || 'Basic',
      };
    },
    enabled: status === 'authenticated' && !!session?.user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const maxWalletsLimit = useMemo(() => {
    return userTier?.isPremium ? 20 : 5;
  }, [userTier]);

  const isAtLimit = useMemo(() => {
    return watchlists.length >= maxWalletsLimit;
  }, [watchlists.length, maxWalletsLimit]);

  const fetchNameTagsForAddresses = useCallback(
    async (addresses) => {
      if (!addresses || addresses.length === 0) {
        logger.log('No addresses provided for fetchNameTagsForAddresses');
        return;
      }

      const newNameTags = {};

      const evmAddresses = addresses.filter((addr) => isAddress(addr));
      if (evmAddresses.length > 0 && status === 'authenticated') {
        try {
          const batchSize = 50;
          const batches = [];
          for (let i = 0; i < evmAddresses.length; i += batchSize) {
            batches.push(evmAddresses.slice(i, i + batchSize));
          }

          const batchPromises = batches.map((batch) =>
            axios.post(
              `${API_BASE_URL}/api/nametags`,
              { addresses: batch },
              {
                headers: {
                  'Content-Type': 'application/json',
                  ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
                },
                timeout: 40000,
              }
            )
          );

          const responses = await Promise.allSettled(batchPromises);
          responses.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.data.success) {
              const batchAddresses = batches[index];
              batchAddresses.forEach((address) => {
                const normalizedAddress = address.toLowerCase();
                const data = result.value.data.data[normalizedAddress];
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
          logger.error(`fetchNameTagsForAddresses error:`, {
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
        }
      } else if (evmAddresses.length > 0) {
        logger.log('Unauthenticated fetchNameTagsForAddresses attempt');
        evmAddresses.forEach((address) => {
          const normalizedAddress = address.toLowerCase();
          newNameTags[normalizedAddress] = { nameTag: null, image: null, timestamp: Date.now() };
        });
      }

      const svmAddresses = addresses.filter((addr) => !isAddress(addr));
      svmAddresses.forEach((addr) => {
        newNameTags[addr] = { nameTag: null, image: null, timestamp: Date.now() };
      });

      setNameTags((prev) => ({
        ...prev,
        ...newNameTags,
      }));
      logger.log(`Updated nameTags for ${Object.keys(newNameTags).length} addresses`);
    },
    [session, status, toast]
  );

  useEffect(() => {
    if (!session?.user?.id || !watchlists.length) return;

    async function fetchNametags() {
      const addresses = watchlists.map((w) => w.address);
      await fetchNameTagsForAddresses(addresses);
    }

    fetchNametags();
  }, [watchlists, session, fetchNameTagsForAddresses]);

  useEffect(() => {
    if (activeTab === 'ACTIVITY' && transactions.length > 0) {
      const uniqueAddresses = [...new Set(transactions.flatMap((tx) => [tx.from, tx.to]))].filter(Boolean);
      fetchNameTagsForAddresses(uniqueAddresses);
    }
  }, [transactions, activeTab, fetchNameTagsForAddresses]);

  useEffect(() => {
    if (!session?.user?.id) {
      setWatchlists([]);
      setSelectedWallet(null);
      setIsInitialLoad(true);
      return;
    }

    async function fetchWatchlists() {
      const cacheKey = `watchlists-${session.user.id}`;
      if (!forceFetch) {
        const cachedData = await getCachedData(cacheKey);
        if (cachedData && cachedData.length > 0) {
          setWatchlists(cachedData);
          if (cachedData.length > 0 && isInitialLoad) {
            const walletToSelect = cachedData.find((w) => w.address === (initialAddress || searchParams.get('address'))) || cachedData[0];
            setSelectedWallet(walletToSelect);
            setActiveChainType(walletToSelect?.chainType || 'EVM');
            lastSelectedWalletRef.current = walletToSelect?.address;
            updateUrl(walletToSelect?.address);
            setIsInitialLoad(false);
          }
          return;
        }
      }

      setLoadingStates((prev) => ({ ...prev, loading: true }));
      try {
        const response = await axios.get(`${API_BASE_URL}/api/watchlists`, {
          headers: {
            'Content-Type': 'application/json',
            ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
          },
          withCredentials: true,
        });
        if (response.data.success) {
          const watchlistsData = response.data.data.map((item) => ({
            address: item.wallet_address,
            name: item.name,
            chainType: isAddress(item.wallet_address) ? 'EVM' : isValidSolanaAddress(item.wallet_address) ? 'SVM' : 'EVM',
          }));
          await cacheData(cacheKey, watchlistsData);
          setWatchlists(watchlistsData);
          if (watchlistsData.length > 0 && isInitialLoad) {
            const walletToSelect = watchlistsData.find((w) => w.address === (initialAddress || searchParams.get('address'))) || watchlistsData[0];
            setSelectedWallet(walletToSelect);
            setActiveChainType(walletToSelect?.chainType || 'EVM');
            lastSelectedWalletRef.current = walletToSelect?.address;
            updateUrl(walletToSelect?.address);
            setIsInitialLoad(false);
          }
        } else {
          setError('Failed to load watchlists.');
          toast.error('Failed to load watchlists.', { position: 'top-center', autoClose: 5000 });
        }
      } catch (err) {
        const errorMessage = err.response?.data?.detail || `Failed to load watchlists: ${err.message}`;
        setError(errorMessage);
        setWatchlists([]);
      } finally {
        setLoadingStates((prev) => ({ ...prev, loading: false }));
        setForceFetch(false);
      }
    }

    fetchWatchlists();
  }, [session, isValidSolanaAddress, initialAddress, updateUrl, forceFetch, isInitialLoad, searchParams]);

  const handleAddWallet = async () => {
    if (isAtLimit) {
      toast.error(
        userTier?.isPremium
          ? 'You have reached the maximum of 20 wallets in your watchlist.'
          : 'Basic users are limited to 5 wallets. Upgrade to Premium for up to 20 wallets!',
        { position: 'top-center', autoClose: 5000 }
      );
      return;
    }

    if (!newAddress) {
      setError('Please enter a wallet address.');
      toast.error('Please enter a wallet address.', { position: 'top-center', autoClose: 5000 });
      return;
    }
    const isValidEVM = isAddress(newAddress);
    const isValidSVM = isValidSolanaAddress(newAddress);
    if (!isValidEVM && !isValidSVM) {
      setError('Invalid wallet address format.');
      toast.error('Invalid wallet address format.', { position: 'top-center', autoClose: 5000 });
      return;
    }
    if ((isValidEVM && newChainType !== 'EVM') || (isValidSVM && newChainType !== 'SVM')) {
      setError('Chain type does not match address format.');
      toast.error('Chain type does not match address format.', { position: 'top-center', autoClose: 5000 });
      return;
    }
    setLoadingStates((prev) => ({ ...prev, loading: true }));
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/watchlists`,
        {
          action: 'add',
          wallet_address: newAddress,
          name: newWalletName || 'Unnamed Wallet',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
          },
          withCredentials: true,
        }
      );
      if (response.data.success) {
        const updatedWatchlists = response.data.data.map((item) => ({
          address: item.wallet_address,
          name: item.name,
          chainType: isAddress(item.wallet_address) ? 'EVM' : isValidSolanaAddress(item.wallet_address) ? 'SVM' : 'EVM',
        }));
        setWatchlists(updatedWatchlists);
        const cacheKey = `watchlists-${session.user.id}`;
        await cacheData(cacheKey, updatedWatchlists);
        const newWallet = updatedWatchlists.find((w) => w.address === newAddress) || updatedWatchlists[0];
        setSelectedWallet(newWallet);
        setActiveChainType(newWallet?.chainType || 'EVM');
        setShowAddModal(false);
        setNewAddress('');
        setNewWalletName('');
        setError(null);
        setForceFetch(true);
        updateUrl(newWallet?.address);
        toast.success('Wallet added successfully.', { position: 'top-center', autoClose: 5000 });
      } else {
        setError(response.data.detail || 'Failed to add wallet.');
        toast.error(response.data.detail || 'Failed to add wallet.', { position: 'top-center', autoClose: 5000 });
      }
    } catch (err) {
      const errorMessage = err.response?.data?.detail || `Failed to add wallet: ${err.message}`;
      setError(errorMessage);
      if (errorMessage.includes('watchlist limit')) {
        toast.error(
          userTier?.isPremium
            ? 'You have reached the maximum of 20 wallets in your watchlist.'
            : 'Basic users are limited to 5 wallets. Upgrade to Premium for up to 20 wallets!',
          { position: 'top-center', autoClose: 5000 }
        );
      } else {
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
      }
    } finally {
      setLoadingStates((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleRemoveWallet = async (walletAddress) => {
    setLoadingStates((prev) => ({ ...prev, loading: true }));
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/watchlists`,
        { action: 'remove', wallet_address: walletAddress },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
          },
          withCredentials: true,
        }
      );
      if (response.data.success) {
        const updatedWatchlists = response.data.data.map((item) => ({
          address: item.wallet_address,
          name: item.name,
          chainType: isAddress(item.wallet_address) ? 'EVM' : isValidSolanaAddress(item.wallet_address) ? 'SVM' : 'EVM',
        }));
        setWatchlists(updatedWatchlists);
        const cacheKey = `watchlists-${session.user.id}`;
        await cacheData(cacheKey, updatedWatchlists);
        if (selectedWallet?.address === walletAddress) {
          const newWallet = updatedWatchlists[0] || null;
          setSelectedWallet(newWallet);
          setActiveChainType(newWallet?.chainType || 'EVM');
          setBalances([]);
          setTransactions([]);
          setTokenInfo({});
          setActiveChain(null);
          setForceFetch(true);
          updateUrl(newWallet?.address || null);
        }
        setError(null);
        toast.success('Wallet removed successfully.', { position: 'top-center', autoClose: 5000 });
      } else {
        setError(response.data.detail || 'Failed to remove wallet.');
        toast.error(response.data.detail || 'Failed to remove wallet.', { position: 'top-center', autoClose: 5000 });
      }
    } catch (err) {
      const errorMessage = err.response?.data?.detail || `Failed to remove wallet: ${err.message}`;
      setError(errorMessage);
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    } finally {
      setLoadingStates((prev) => ({ ...prev, loading: false }));
    }
  };

  const getPlatformImage = (chainValue) => {
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    const chain = chains.find((c) => c.value === chainName);
    return chain?.image || (chainName === 'eclipse' ? '/eclipse-logo.webp' : '/fallback-image.webp');
  };

  const getChainLogos = (chainType) => {
    return chainType === 'EVM' ? EVM_LOGOS : SVM_LOGOS;
  };

  const renderTokenRow = (index, token) => {
    const tokenInfoData = tokenInfo[token.address] || [];
    const tokenDetails = tokenInfoData.find((t) => t.chain === token.chain) || {};
    let logoUrl = '/icons/default.webp';
    let tokenName = token.name || token.symbol || tokenDetails.name || tokenDetails.symbol || 'Unknown';
    let tokenSymbol = token.symbol || tokenDetails.symbol || 'Unknown';

    if (token.address === 'native' && NATIVE_TOKEN_INFO[token.chain]) {
      logoUrl = NATIVE_TOKEN_INFO[token.chain].logo;
      tokenName = NATIVE_TOKEN_INFO[token.chain].name;
      tokenSymbol = NATIVE_TOKEN_INFO[token.chain].symbol;
    } else if (token.logo && !token.logo.includes('scontent.xx.fbcdn.net') && token.logo !== '/fallback-image.webp') {
      logoUrl = token.logo;
    } else if (tokenDetails.logo && !tokenDetails.logo.includes('scontent.xx.fbcdn.net') && tokenDetails.logo !== '/fallback-image.webp') {
      logoUrl = tokenDetails.logo;
    } else {
      return null;
    }

    const formatBalance = (amount) => {
      if (amount == null || isNaN(amount)) return 'N/A';
      const num = Number(amount);
      if (num < 0.0001) return num.toFixed(6);
      return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
    };

    const value = Number(token.value_usd) || 0;
    const percentage = totalValue > 0 ? (value / totalValue) * 100 : 0;

    return (
      <motion.div
        key={`${token.chain}-${token.address}-${index}`}
        className="flex hover:bg-neon-blue/10 transition-all duration-300 py-2 border-t border-white/10"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="w-[25%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex items-center gap-2">
          <div className="relative flex-shrink-0">
            <img
              src={logoUrl}
              alt={`${tokenSymbol} logo`}
              width={isMobile ? 14 : 16}
              height={isMobile ? 14 : 16}
              className="rounded-full"
              onError={(e) => (e.target.src = '/icons/default.webp')}
              loading="lazy"
            />
            <img
              src={getPlatformImage(token.chain)}
              alt={`${token.chain} logo`}
              width={isMobile ? 8 : 10}
              height={isMobile ? 8 : 10}
              className="rounded-full absolute top-0 right-0"
              style={{ transform: 'translate(25%, -25%)' }}
              onError={(e) => (e.target.src = token.chain === 'eclipse' ? '/eclipse-logo.webp' : '/fallback-image.webp')}
              loading="lazy"
            />
          </div>
          <div className="flex flex-col items-center">
            <span>{tokenSymbol}</span>
            {token.price_usd != null && (
              <span className="text-[7px] sm:text-[9px] text-gray-500">{formatPrice(token.price_usd)}</span>
            )}
          </div>
        </div>
        <div className="w-[45%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex items-center justify-center">
          <div className="flex flex-col items-center">
            <span className="font-semibold">{formatBalance(token.amount)}</span>
            <span className="text-[7px] sm:text-[9px] text-gray-500">
              ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        <div className="w-[30%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex flex-col items-center justify-center gap-1">
          <span className="font-semibold">{percentage.toFixed(2)}%</span>
          <div className="w-full bg-white/10 rounded-full h-1.5">
            <motion.div
              className="bg-gradient-to-r from-neon-blue to-emerald-400 h-1.5 rounded-full"
              style={{ width: `${Math.min(percentage, 100)}%` }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(percentage, 100)}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      </motion.div>
    );
  };

  const renderTransactionRow = (index, tx) => {
    const transactionKey = tx.hash || `tx-${index}`;
    const { txUrl, addressUrl } = getExplorerUrls(tx.chain, transactionKey, tx.from || tx.address);
    const isSVM = SUPPORTED_SVM_CHAINS.includes(tx.chain);
    let tokenLogo = isSVM
      ? tx.token_metadata?.logo || NATIVE_TOKEN_INFO[tx.chain]?.logo || '/icons/default.webp'
      : tx.token_metadata?.logo && !tx.token_metadata.logo.includes('scontent.xx.fbcdn.net')
        ? tx.token_metadata.logo
        : NATIVE_TOKEN_INFO[tx.chain]?.logo || '/icons/default.webp';
    let tokenSymbol = tx.token || 'Unknown';
    const addressToShow = tx.type === 'receive' ? tx.from : tx.to;
    const { text: displayAddress, image: addressImage } = truncateAddress(addressToShow, nameTags);

    let displayValue = Number(tx.value).toLocaleString("en-US", { maximumFractionDigits: 1 });
    let typeDisplay = tx.type ? tx.type.charAt(0).toUpperCase() + tx.type.slice(1) : "Other";

    if (tx.type === 'swap' && tx.swap_details && !isSVM) {
      const sent = tx.swap_details.sent[0];
      const received = tx.swap_details.received[0];
      if (sent && received) {
        displayValue = `${Number(sent.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${sent.symbol} → ${Number(received.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${received.symbol}`;
        tokenSymbol = `${sent.symbol}/${received.symbol}`;
        tokenLogo = sent.logo || received.logo || '/icons/default.webp';
      } else if (sent) {
        displayValue = `${Number(sent.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${sent.symbol}`;
        tokenSymbol = sent.symbol;
        tokenLogo = sent.logo || '/icons/default.webp';
      } else if (received) {
        displayValue = `${Number(received.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${received.symbol}`;
        tokenSymbol = received.symbol;
        tokenLogo = received.logo || '/icons/default.webp';
      }
      typeDisplay = 'Swap';
    } else if (tx.type === 'other' && !isSVM) {
      typeDisplay = 'Other';
      displayValue = tx.value || 'N/A';
    } else if (isSVM) {
      displayValue = tx.value ? `${Number(tx.value).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${tokenSymbol}` : 'N/A';
    }

    // Truncate hash for SVM
    const truncatedHash = isSVM
      ? `${tx.hash.slice(0, 6)}...${tx.hash.slice(-4)}`
      : tx.hash;

    return (
      <motion.div
        key={`${tx.chain}-${transactionKey}-${index}`}
        className="flex hover:bg-neon-blue/10 transition-all duration-300 py-2 border-t border-white/10"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="w-[25%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex flex-col items-center gap-1 relative overflow-hidden text-ellipsis">
          <div className="relative flex-shrink-0">
            <img
              src={tokenLogo}
              alt={`${tokenSymbol} logo`}
              width={isMobile ? 14 : 16}
              height={isMobile ? 14 : 16}
              className="rounded-full mx-auto"
              onError={(e) => (e.target.src = '/icons/default.webp')}
              loading="lazy"
            />
            <img
              src={getPlatformImage(tx.chain)}
              alt={`${tx.chain} logo`}
              width={isMobile ? 8 : 10}
              height={isMobile ? 8 : 10}
              className="rounded-full absolute top-0 right-0"
              style={{ transform: 'translate(25%, -25%)' }}
              onError={(e) => (e.target.src = tx.chain === 'eclipse' ? '/eclipse-logo.webp' : '/fallback-image.webp')}
              loading="lazy"
            />
          </div>
          <span className="text-[8px] sm:text-[9px] truncate max-w-[60px] sm:max-w-[80px]">{tokenSymbol}</span>
        </div>
        {!isSVM ? (
          <>
            <div className="w-[25%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex flex-col items-center gap-1 overflow-hidden text-ellipsis">
              <span
                className={`inline-flex px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] sm:text-[9px] font-medium ${tx.type === 'receive'
                  ? 'bg-neon-green/20 text-neon-green'
                  : tx.type === 'send'
                    ? 'bg-neon-blue/20 text-neon-blue'
                    : tx.type === 'swap'
                      ? 'bg-purple-400/20 text-purple-400'
                      : 'bg-white/20 text-white/60'
                  }`}
              >
                {typeDisplay}
              </span>
              <div className="flex items-center justify-center gap-2">
                {addressImage && (
                  <img
                    src={addressImage}
                    alt={`${displayAddress} logo`}
                    width={isMobile ? 12 : 14}
                    height={isMobile ? 12 : 14}
                    className="rounded-full"
                    onError={(e) => (e.target.src = '/icons/default.webp')}
                    loading="lazy"
                  />
                )}
                <a
                  href={addressUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neon-blue hover:text-neon-blue/80 truncate"
                  title={addressToShow}
                >
                  {displayAddress}
                </a>
              </div>
            </div>
            <div className="w-[25%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex items-center justify-center overflow-hidden text-ellipsis">
              <div className="flex flex-col items-center">
                <span className="font-semibold">{displayValue}</span>
                {tx.value_usd != null && (
                  <span className="text-[7px] sm:text-[9px] text-white/60">
                    ${Number(tx.value_usd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            </div>
            <div className="w-[25%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex flex-col items-center gap-0.5 overflow-hidden text-ellipsis">
              <a href={txUrl} target="_blank" rel="noopener noreferrer">
                <img
                  src="/logos/etherscan-logo.webp"
                  alt="Explorer"
                  width={isMobile ? 12 : 14}
                  height={isMobile ? 12 : 14}
                  className="rounded-full"
                  onError={(e) => (e.target.src = '/fallback-image.webp')}
                  loading="lazy"
                />
              </a>
              <span className="text-[6px] sm:text-[7px] text-white/60">
                {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="w-[25%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex items-center justify-center overflow-hidden text-ellipsis">
              <div className="flex flex-col items-center">
                <span className="font-semibold">{displayValue}</span>
                {tx.value_usd != null && (
                  <span className="text-[7px] sm:text-[9px] text-gray-500">
                    ${Number(tx.value_usd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            </div>
            <div className="w-[25%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex items-center justify-center gap-2 overflow-hidden text-ellipsis">
              <img
                src="/logos/solscan.webp"
                alt="Solscan Explorer"
                width={isMobile ? 12 : 14}
                height={isMobile ? 12 : 14}
                className="rounded-full"
                onError={(e) => (e.target.src = '/fallback-image.webp')}
                loading="lazy"
              />
              <a
                href={txUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neon-blue hover:text-neon-blue/80 truncate"
                title={tx.hash}
              >
                {truncatedHash}
              </a>
            </div>
            <div className="w-[25%] px-2 sm:px-3 text-white/80 text-[9px] sm:text-[10px] flex items-center justify-center overflow-hidden text-ellipsis">
              <span className="text-[8px] sm:text-[9px] text-white/60">
                {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
              </span>
            </div>
          </>
        )}
      </motion.div>
    );
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (activeChain === null) return true;
      return tx.chain === activeChain;
    });
  }, [transactions, activeChain]);

  if (status !== 'authenticated') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        className="font-saira w-full max-w-7xl mx-auto mt-2 p-2 sm:p-3 bg-white/5 backdrop-blur-md border border-white/10 shadow-neon-sm rounded-xl flex items-center justify-center min-h-[calc(100vh-6rem)]"
      >
        <div className="text-center">
          <h3 className="text-[12px] sm:text-[14px] font-bold text-white mb-3 uppercase tracking-wider">Please Log In</h3>
          <p className="text-[9px] sm:text-[10px] text-white/60 mb-4">You need to be logged in to access your watchlist.</p>
          <motion.button
            onClick={() => router.push('/auth/signin')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-3 sm:px-4 py-1 sm:py-1.5 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl hover:bg-neon-blue/20 transition-all duration-300"
          >
            Log In
          </motion.button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className="font-saira w-full max-w-9xl mx-auto mt-2 p-2 sm:p-3 flex flex-row h-[calc(100vh-3rem)] rounded-xl overflow-hidden"
    >
      <ToastContainer position="top-center" autoClose={5000} theme="dark" />

      {/* Toggle Button for Mobile */}
      {!showWatchlistSidebar && (
        <motion.button
          className="sm:hidden fixed top-10 left-0 p-2 bg-white/5 border border-white/20 rounded-r-lg text-white hover:bg-neon-blue/20 transition-all duration-300 overflow-hidden"
          style={{ width: '25px', height: '40px', marginLeft: '-7px' }}
          onClick={() => setShowWatchlistSidebar(true)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ transform: 'translateX(-2px)' }}
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </motion.button>
      )}

      {/* Left Sidebar: Watchlist (Mobile) */}
      <AnimatePresence>
        {showWatchlistSidebar && isMobile && (
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="fixed inset-0 sm:hidden bg-black/10 backdrop-blur-sm z-30"
            onClick={() => setShowWatchlistSidebar(false)}
          >
            <motion.div
              className="w-2/3 h-full bg-black/70 backdrop-blur-sm border-r border-white/10 overflow-y-auto custom-scrollbar shadow-neon-sm relative pt-12"
              onClick={(e) => e.stopPropagation()}
            >
              <LoadingOverlay className="absolute inset-0 z-50" isLoading={loadingStates.loading} isMobile={isMobile} />
              <div className="p-2 ">
                <div className="flex items-center justify-between mb-3 bg-gradient-to-r from-white/20 to-transparent p-1 rounded">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <div className="flex items-center gap-1">
                      <h3 className="text-[10px] sm:text-[12px] font-bold uppercase tracking-wider">
                        Watchlist ({watchlists.length}/{maxWalletsLimit})
                      </h3>
                      <Tooltip text="Upgrade to Premium to add up to 20 wallets (currently limited to 5).">
                        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 ${userTier?.isPremium ? 'text-yellow-400' : 'text-white/80'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </Tooltip>
                    </div>
                  </div>
                  <Tooltip text={isAtLimit ? (userTier?.isPremium ? 'Max 20 wallets reached' : 'Basic: Max 5 wallets. Upgrade for 20!') : 'Add Wallet'}>
                    <motion.button
                      onClick={() => !isAtLimit && setShowAddModal(true)}
                      disabled={isAtLimit || userTierLoading}
                      whileHover={!isAtLimit ? { scale: 1.05 } : {}}
                      whileTap={!isAtLimit ? { scale: 0.95 } : {}}
                      className={`p-1 rounded-xl transition-all duration-300 ${isAtLimit ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-5 h-5 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </motion.button>
                  </Tooltip>
                </div>
                {watchlists.length === 0 ? (
                  <p className="text-[9px] sm:text-[10px] text-white/60 text-center">
                    {isAtLimit ? 'Watchlist full. Upgrade to add more!' : 'No wallets added'}
                  </p>
                ) : (
                  watchlists.map((wallet) => {
                    const { text: truncatedWalletAddress } = truncateAddress(wallet.address, nameTags);
                    return (
                      <motion.div
                        key={wallet.address}
                        onClick={() => {
                          setIsUserInitiatedChange(true);
                          setSelectedWallet(wallet);
                          setActiveChainType(wallet?.chainType || 'EVM');
                          setBalances([]);
                          setTransactions([]);
                          setTokenInfo({});
                          setActiveChain(null);
                          lastSelectedWalletRef.current = wallet.address;
                          updateUrl(wallet.address);
                          setShowWatchlistSidebar(false);
                        }}
                        className={`flex items-center justify-between p-2 mb-2 cursor-pointer transition-all duration-300 border-l-4 ${selectedWallet?.address === wallet.address
                          ? 'border-white/80 bg-white/10'
                          : 'border-transparent bg-white/5 hover:bg-neon-blue/10'
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.image && (
                            <img
                              src={nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address].image}
                              alt={`${nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'} logo`}
                              width={isMobile ? 14 : 16}
                              height={isMobile ? 14 : 16}
                              className="rounded-full"
                              onError={(e) => (e.target.src = '/icons/default.webp')}
                              loading="lazy"
                            />
                          )}
                          <div className="flex flex-col">
                            <span className="text-[9px] sm:text-[10px] text-white font-bold">
                              {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'}
                            </span>
                            <span className="text-[8px] sm:text-[9px] text-white/60 truncate max-w-[120px] sm:max-w-[150px]">
                              {truncatedWalletAddress}
                            </span>
                          </div>
                        </div>
                        <motion.button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveWallet(wallet.address);
                          }}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="text-[8px] sm:text-[9px] text-red-400/80 hover:text-red-400"
                        >
                          ✕
                        </motion.button>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left Sidebar: Watchlist (Desktop) */}
      <div className="hidden sm:block w-[20%] h-[96%] border border-white/10 rounded-xl p-3 sm:p-4 mt-3 overflow-y-auto custom-scrollbar bg-white/5 relative">
        <LoadingOverlay className="absolute inset-0 z-50" isLoading={loadingStates.loading} isMobile={isMobile} />
        <div className="flex items-center justify-between mb-3 bg-gradient-to-r from-white/20 to-transparent p-1 rounded">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <div className="flex items-center gap-2 mt-2">
              <h3 className={`text-[10px] sm:text-[12px] font-bold uppercase tracking-wider ${userTier?.isPremium ? 'text-yellow-400' : 'text-white'}`}>
                Watchlist ({watchlists.length}/{maxWalletsLimit})
              </h3>
              <Tooltip text="Upgrade to Premium to add up to 20 wallets (currently limited to 5).">
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 ${userTier?.isPremium ? 'text-yellow-400' : 'text-white/80'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </Tooltip>
            </div>
          </div>
          <Tooltip text={isAtLimit ? (userTier?.isPremium ? 'Max 20 wallets reached' : 'Basic: Max 5 wallets. Upgrade for 20!') : 'Add Wallet'}>
            <motion.button
              onClick={() => !isAtLimit && setShowAddModal(true)}
              disabled={isAtLimit || userTierLoading}
              whileHover={!isAtLimit ? { scale: 1.05 } : {}}
              whileTap={!isAtLimit ? { scale: 0.95 } : {}}
              className={`p-1 rounded-xl transition-all duration-300 ${isAtLimit ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </motion.button>
          </Tooltip>
        </div>
        {watchlists.length === 0 ? (
          <p className="text-[9px] sm:text-[10px] text-white/60 text-center">
            {isAtLimit ? 'Watchlist full. Upgrade to add more!' : 'No wallets added'}
          </p>
        ) : (
          watchlists.map((wallet) => {
            const { text: truncatedWalletAddress } = truncateAddress(wallet.address, nameTags);
            return (
              <motion.div
                key={wallet.address}
                onClick={() => {
                  setIsUserInitiatedChange(true);
                  setSelectedWallet(wallet);
                  setActiveChainType(wallet?.chainType || 'EVM');
                  setBalances([]);
                  setTransactions([]);
                  setTokenInfo({});
                  setActiveChain(null);
                  lastSelectedWalletRef.current = wallet.address;
                  updateUrl(wallet.address);
                }}
                className={`flex items-center justify-between p-2 mb-2 rounded-lg cursor-pointer transition-all duration-300 border-l-4 ${selectedWallet?.address === wallet.address
                  ? 'border-neon-blue bg-white/10'
                  : 'border-transparent bg-white/5 hover:bg-neon-blue/10'
                  }`}
              >
                <div className="flex items-center gap-2">
                  {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.image && (
                    <img
                      src={nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address].image}
                      alt={`${nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'} logo`}
                      width={isMobile ? 14 : 16}
                      height={isMobile ? 14 : 16}
                      className="rounded-full"
                      onError={(e) => (e.target.src = '/icons/default.webp')}
                      loading="lazy"
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="text-[9px] sm:text-[10px] text-white font-bold">
                      {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'}
                    </span>
                    <span className="text-[8px] sm:text-[9px] text-white/60 truncate max-w-[120px] sm:max-w-[150px]">
                      {truncatedWalletAddress}
                    </span>
                  </div>
                </div>
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveWallet(wallet.address);
                  }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="text-[8px] sm:text-[9px] text-red-400/80 hover:text-red-400"
                >
                  ✕
                </motion.button>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Right Section: Wallet Info (20%) + Tabs (80%) */}
      <div className="w-full sm:w-[80%] p-2 sm:p-3 flex flex-col">
        {selectedWallet ? (
          <>
            <div className="h-[20%] border border-white/10 bg-white/5 backdrop-blur-md p-3 sm:p-4 flex flex-col justify-between rounded-xl relative">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.image && (
                    <img
                      src={nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address].image}
                      alt={`${nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.nameTag || selectedWallet.name || 'Unnamed Wallet'} logo`}
                      width={isMobile ? 20 : 24}
                      height={isMobile ? 20 : 24}
                      className="rounded-xl"
                      onError={(e) => (e.target.src = '/icons/default.webp')}
                      loading="lazy"
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="text-[10px] sm:text-[12px] font-bold text-white">
                      {nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.nameTag || selectedWallet.name || 'Unnamed Wallet'}
                    </span>
                    <div className="relative flex items-center group">
                      {(() => {
                        const { text: displayAddress } = truncateAddress(selectedWallet.address, nameTags);
                        return (
                          <>
                            <span className="text-[9px] sm:text-[10px] text-white/60">{displayAddress}</span>
                            <motion.button
                              onClick={() => copyAddress(selectedWallet.address, toast)}
                              className="ml-2 p-1 bg-white/10 rounded-xl hover:bg-red-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                              whileHover={{ scale: 1.1, y: -2 }}
                              whileTap={{ scale: 0.9 }}
                              title="Copy Address"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="w-3 sm:w-3 h-3 sm:h-3"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#f6ededff"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </motion.button>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 p-1 sm:p-3 bg-gradient-to-r from-black/70 to-black/50 rounded-xl border border-white/10 shadow-md shadow-neon-blue/10">
                  <div className="flex items-center gap-1 flex-wrap min-w-0">
                    <span className="flex items-center font-bold text-white text-[11px] sm:text-xs whitespace-nowrap">
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
                    <span className="font-bold ml-1 bg-gradient-to-r from-neon-blue to-emerald-400 bg-clip-text text-transparent text-xs sm:text-sm truncate">
                      ${totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex overflow-x-auto gap-2 sm:gap-3 mb-1 no-scrollbar virtuoso-container">
                <Tooltip text="All Chains">
                  <motion.button
                    onClick={() => setActiveChain(null)}
                    className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 rounded-xl flex-shrink-0 min-w-[48px] z-10 ${activeChain === null ? 'border-neon-blue bg-neon-blue/20 shadow-neon-sm' : 'hover:bg-neon-blue/20'}`}
                  >
                    ALL
                  </motion.button>
                </Tooltip>
                {chainsWithAssets.map((chain) => (
                  <Tooltip key={chain} text={chain.charAt(0).toUpperCase() + chain.slice(1)}>
                    <motion.button
                      onClick={() => setActiveChain(chain)}
                      className={`flex items-center justify-center rounded-lg flex-shrink-0 z-10 min-w-[22px] sm:min-w-[22px] m-1 ${activeChain === chain ? 'border-neon-blue bg-neon-blue/20' : 'border-white/10 bg-white/5'}`}
                    >
                      <img
                        src={getPlatformImage(chain)}
                        alt={chain}
                        width={isMobile ? 18 : 20}
                        height={isMobile ? 18 : 20}
                        className="rounded-lg object-contain block flex-shrink-0"
                        onError={(e) => (e.target.src = chain === 'eclipse' ? '/eclipse-logo.webp' : '/fallback-image.webp')}
                        loading="lazy"
                      />
                    </motion.button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Tabs: Portfolio & Activity (80% height) */}
            <div className="h-[84%] flex flex-col">
              <div className="flex w-full border border-white/10 mt-3 bg-white/5 rounded-t-xl">
                {['PORTFOLIO', 'ACTIVITY'].map((tab) => (
                  <motion.button
                    key={tab}
                    onClick={() => handleTabClick(tab)}
                    className={`flex items-center justify-center gap-1 flex-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-[10px] font-medium ${activeTab === tab ? 'border-b-2 border-white text-white' : 'text-white/80'
                      } last:border-r-0 relative after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-gradient-to-r after:from-neon-blue after:to-emerald-400 after:opacity-0 after:group-hover:opacity-100`}
                  >
                    {tab === 'PORTFOLIO' && (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    )}
                    {tab === 'ACTIVITY' && (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <span>{tab}</span>
                  </motion.button>
                ))}
              </div>

              <div className="flex-1 border border-white/10 bg-white/5 rounded-b-xl relative">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: activeTab === 'PORTFOLIO' ? -20 : 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: activeTab === 'PORTFOLIO' ? 20 : -20 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="h-full relative"
                  >
                    {activeTab === 'PORTFOLIO' && (
                      <div className="h-full flex flex-col relative">
                        <LoadingOverlay className="absolute inset-0 z-20" isLoading={loadingStates.balances || loadingStates.tokenInfo} isMobile={isMobile} />
                        {error ? (
                          <div className="flex-1 flex items-center justify-center">
                            <p className="text-[9px] sm:text-[10px] text-red-400 text-center bg-red-400/10 p-2 sm:p-3 rounded-lg">
                              Error: {error}
                            </p>
                          </div>
                        ) : filteredBalances.length > 0 ? (
                          <div className="space-y-2 flex-1 flex flex-col">
                            <div className="flex-1 bg-gradient-to-b from-black/80 to-black/90 rounded-b-xl border border-white/10 overflow-hidden shadow-inner">
                              <div className="flex bg-gradient-to-r from-black/20 to-black/30 border-b border-white/10 px-2 py-2 text-[9px] sm:text-[10px] font-semibold text-white sticky top-0 z-10">
                                <div className="w-[25%] px-2 flex items-center gap-1 text-left">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Token
                                </div>
                                <div className="w-[45%] px-2 flex items-center justify-center gap-1 text-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Balance
                                </div>
                                <div className="w-[30%] px-2 flex items-center justify-center gap-1 text-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                  </svg>
                                  Percentage
                                </div>
                              </div>
                              <div className="overflow-y-auto custom-scrollbar" style={{ height: 'calc(100% - 2.5rem)' }}>
                                <Virtuoso
                                  className="custom-scrollbar"
                                  style={{ height: '100%' }}
                                  data={filteredBalances}
                                  itemContent={renderTokenRow}
                                  overscan={400}
                                  components={{
                                    EmptyPlaceholder: () => null,
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex items-center justify-center">
                            <p className="text-[9px] sm:text-[10px] text-white/60 text-center p-2 sm:p-3">
                              {loadingStates.balances || loadingStates.tokenInfo
                                ? 'Loading balances...'
                                : 'No balances found for this wallet.'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {activeTab === 'ACTIVITY' && (
                      <div className="h-full flex flex-col relative">
                        <LoadingOverlay className="absolute inset-0 z-20" isLoading={loadingStates.transactions} isMobile={isMobile} />
                        {transactionsError ? (
                          <div className="flex-1 flex items-center justify-center">
                            <p className="text-[9px] sm:text-[10px] text-red-400 text-center bg-red-400/10 p-2 sm:p-3 rounded-lg">
                              Error: {transactionsError.message || 'Failed to load transactions'}
                            </p>
                          </div>
                        ) : filteredTransactions.length > 0 ? (
                          (() => {
                            const sampleTx = filteredTransactions[0];
                            const isSVM = SUPPORTED_SVM_CHAINS.includes(sampleTx.chain);
                            return (
                              <div className="flex-1 bg-gradient-to-b from-black/80 to-black/90 rounded-b-xl border border-white/10 overflow-hidden shadow-inner">
                                <div className="flex bg-gradient-to-r from-black/20 to-black/30 border-b border-white/10 px-2 py-2 text-[9px] sm:text-[10px] font-semibold text-white sticky top-0 z-10">
                                  {!isSVM ? (
                                    <>
                                      <div className="w-[25%] px-2 flex items-center gap-1 text-left">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Token
                                      </div>
                                      <div className="w-[25%] px-2 flex items-center gap-1 text-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                        Address
                                      </div>
                                      <div className="w-[25%] px-2 flex items-center gap-1 text-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Balance
                                      </div>
                                      <div className="w-[25%] px-2 flex items-center gap-1 text-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Tx / Time
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div className="w-[25%] px-2 flex items-center gap-1 text-left">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Token
                                      </div>
                                      <div className="w-[25%] px-2 flex items-center gap-1 text-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Balance
                                      </div>
                                      <div className="w-[25%] px-2 flex items-center gap-1 text-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Tx
                                      </div>
                                      <div className="w-[25%] px-2 flex items-center gap-1 text-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Time
                                      </div>
                                    </>
                                  )}
                                </div>
                                <div className="overflow-y-auto custom-scrollbar" style={{ height: 'calc(100% - 2.5rem)' }}>
                                  <Virtuoso
                                    className="custom-scrollbar"
                                    style={{ height: '100%' }}
                                    data={filteredTransactions}
                                    itemContent={renderTransactionRow}
                                    overscan={400}
                                    components={{
                                      EmptyPlaceholder: () => null,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="flex-1 flex items-center justify-center">
                            <p className="text-[9px] sm:text-[10px] text-white/60 text-center p-2 sm:p-3">
                              {loadingStates.transactions ? 'Loading transactions...' : 'No transactions found for this wallet.'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center border border-white/10 bg-white/5 rounded-xl shadow-lg shadow-neon-blue/20">
            <p className="text-[9px] sm:text-[10px] text-white/60 text-center">
              {watchlists.length === 0 ? (isAtLimit ? 'Watchlist full. Upgrade to add more!' : 'Add a wallet to your watchlist to get started.') : 'Select a wallet from the watchlist.'}
            </p>
          </div>
        )}
      </div>

      {/* Add Wallet Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="w-[90%] sm:w-[400px] bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-3 sm:p-4 shadow-2xl shadow-neon-blue/30"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[10px] sm:text-[12px] font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add Wallet to Watchlist
              </h3>
              <div className="mb-3">
                <label className="text-[9px] sm:text-[10px] text-white/80">Wallet Name (Optional)</label>
                <input
                  type="text"
                  value={newWalletName}
                  onChange={(e) => setNewWalletName(e.target.value)}
                  className="w-full mt-1 p-2 text-[9px] sm:text-[10px] text-white bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-neon-blue shadow-md"
                  placeholder="Enter wallet name"
                />
              </div>
              <div className="mb-3">
                <label className="text-[9px] sm:text-[10px] text-white/80">Wallet Address</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value.trim())}
                  className="w-full mt-1 p-2 text-[9px] sm:text-[10px] text-white bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-neon-blue shadow-md"
                  placeholder="Enter wallet address"
                />
              </div>
              <div className="mb-3">
                <label className="text-[9px] sm:text-[10px] text-white/80">Chain Type</label>
                <select
                  value={newChainType}
                  onChange={(e) => setNewChainType(e.target.value)}
                  className="w-full mt-1 p-2 text-[9px] sm:text-[10px] text-white bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-neon-blue shadow-md"
                >
                  <option value="EVM">EVM</option>
                  <option value="SVM">SVM</option>
                </select>
              </div>
              {error && (
                <p className="text-[9px] sm:text-[10px] text-red-400 bg-red-400/10 p-2 rounded-lg mb-3">{error}</p>
              )}
              <div className="flex justify-end gap-2">
                <motion.button
                  onClick={() => {
                    setShowAddModal(false);
                    setNewAddress('');
                    setNewWalletName('');
                    setError(null);
                  }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-3 sm:px-4 py-1 sm:py-1.5 text-[9px] sm:text-[10px] text-white/80 border border-white/10 rounded-lg hover:bg-white/10 shadow-md"
                >
                  Cancel
                </motion.button>
                <Tooltip text={isAtLimit ? (userTier?.isPremium ? 'Max 20 wallets reached' : 'Basic: Max 5 wallets. Upgrade for 20!') : 'Add Wallet'}>
                  <motion.button
                    onClick={handleAddWallet}
                    disabled={isAtLimit || userTierLoading}
                    whileHover={!isAtLimit ? { scale: 1 } : {}}
                    whileTap={!isAtLimit ? { scale: 1 } : {}}
                    className={`px-3 sm:px-4 py-1 sm:py-1.5 text-[9px] sm:text-[10px] text-white border rounded-lg shadow-md ${isAtLimit ? 'opacity-50 cursor-not-allowed border-gray-500 bg-gray-500/20' : 'bg-gradient-to-r from-neon-blue/20 to-emerald-400/20 border-neon-blue hover:from-neon-blue/30 hover:to-emerald-400/30 shadow-neon-blue/20'}`}
                  >
                    Add
                  </motion.button>
                </Tooltip>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Custom CSS to hide scrollbar
<style jsx global>{`
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .virtuoso-container {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.virtuoso-container::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Edge */
}
  .custom-scrollbar::-webkit-scrollbar {
    width: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
`}</style>