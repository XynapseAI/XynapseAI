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
import { SUPPORTED_CHAINS, CHAIN_MAPPING, CHAIN_ID_TO_NAME } from '../utils/constants';
import { formatDistanceToNow } from 'date-fns';
import useSWR from 'swr';
import { cacheData, getCachedData } from '../utils/indexedDB';
import { LoadingOverlay, truncateAddress, formatPrice, isValidToken, getExplorerUrls } from '../utils/helpers';
import { debounce } from 'lodash';

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.code === 'ECONNABORTED' || error.response?.status >= 500,
});

// Utility constants
const NATIVE_TOKEN_INFO = {
  ethereum: { name: 'Ethereum', symbol: 'ETH', logo: '/ethereum-logo.png' },
  base: { name: 'Base', symbol: 'ETH', logo: '/base-logo.png' },
  bnb: { name: 'BNB', symbol: 'BNB', logo: '/bnb-logo.png' },
  solana: { name: 'Solana', symbol: 'SOL', logo: '/solana-logo.png' },
  eclipse: { name: 'Eclipse', symbol: 'ETH', logo: '/eclipse-logo.png' },
};

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

const SkeletonLoader = ({ isMobile }) => {
  const skeletonRows = Array(5).fill(null);
  return (
    <div className="w-full p-2 sm:p-3">
      <table className="w-full text-[9px] sm:text-[9px]">
        <tbody>
          {skeletonRows.map((_, index) => (
            <tr key={index} className="border-t border-white/10">
              <td className="px-2 sm:px-3 py-2 text-center">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-5 sm:w-6 h-5 sm:h-6 bg-white/10 rounded-full animate-pulse"></div>
                  <div className="w-10 sm:w-12 h-2 bg-white/10 rounded animate-pulse"></div>
                </div>
              </td>
              <td className="px-2 sm:px-3 py-2 text-center">
                <div className="w-16 sm:w-20 h-3 bg-white/10 rounded animate-pulse mx-auto"></div>
              </td>
              <td className="px-2 sm:px-3 py-2 text-center">
                <div className="w-20 sm:w-24 h-3 bg-white/10 rounded animate-pulse mx-auto"></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
        className={`absolute ${isVisible ? 'block' : 'hidden'} bg-white/5 backdrop-blur-md border border-white/10 text-white/80 text-[9px] sm:text-[10px] py-1 sm:py-1.5 px-2 sm:px-3 rounded-lg shadow-neon-sm z-20 -top-8 sm:-top-10 left-1/2 -translate-x-1/2 whitespace-nowrap font-saira transition-all duration-300`}
      >
        {text}
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
  const [streamProgress, setStreamProgress] = useState({ action: null, received: 0, total: null });
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
  const itemsPerPage = 50;
  const [currentPage, setCurrentPage] = useState({
    PORTFOLIO: 1,
    ACTIVITY: 1,
  });

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
  const SUPPORTED_SVM_CHAINS = ['solana', 'eclipse'];
  const EVM_LOGOS = ['ethereum', 'base', 'bnb'];
  const SVM_LOGOS = ['solana', 'eclipse'];

  const stableWatchlists = useMemo(() => watchlists, [watchlists]);

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
    setCurrentPage((prev) => ({ ...prev, [tab]: 1 }));
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
        setCurrentPage({ PORTFOLIO: 1, ACTIVITY: 1 });
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
          image: chain.image || '/icons/default.png',
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
          image: coingeckoChain?.image?.large || simChain.image || '/icons/default.png',
        };
      });
      setChains(mappedChains);
    }
  }, [supportedChains]);

  const fetchDataQuery = async (action, address, chainType, onPartialData) => {
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
        logger.log(`Cache hit for ${cacheKey}`, { dataLength: cachedData.length });
        return cachedData;
      }
    } catch (error) {
      logger.warn(`IndexedDB not available, skipping cache for ${cacheKey}`, { error });
    }

    const payload = {
      action,
      address,
      ...(isValidEVM ? { chain_ids: '1,137,10,42161,8453' } : { chains: SUPPORTED_SVM_CHAINS.join(',') }),
      limit: 500,
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
        logger.error(`API error response for ${action}:`, { status: response.status, text });
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
      let openBrackets = 0;
      let receivedItems = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        logger.log(`Received chunk for ${action}:`, { chunk }); // Thêm log để debug

        for (const char of chunk) {
          if (char === '[') openBrackets++;
          if (char === ']') openBrackets--;
        }

        let lastValidIndex = 0;
        try {
          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === ']' && openBrackets === 0) {
              const potentialJson = buffer.slice(0, i + 1);
              try {
                const parsed = JSON.parse(potentialJson);
                if (Array.isArray(parsed)) {
                  if (parsed.some((item) => item.detail)) {
                    logger.warn(`API returned error in chunk for ${action}:`, { error: parsed });
                    throw new Error(parsed[0].detail || 'API returned error response');
                  }
                  data = parsed;
                  lastValidIndex = i + 1;
                  receivedItems += parsed.length;
                  onPartialData(parsed, { action, received: receivedItems });
                  logger.log(`Parsed partial ${action} data: ${parsed.length} items`, { address, receivedItems });
                }
              } catch (e) {
                logger.log(`Failed to parse chunk for ${action}:`, { error: e.message, chunk: potentialJson });
                continue;
              }
            }
          }
          buffer = buffer.slice(lastValidIndex);
        } catch (e) {
          logger.log(`Incomplete JSON chunk for ${action}, continuing to read: ${e.message}`, { bufferLength: buffer.length });
          continue;
        }
      }

      if (buffer && openBrackets === 0) {
        try {
          const trimmedBuffer = buffer.trim();
          if (trimmedBuffer.startsWith('[') && trimmedBuffer.endsWith(']')) {
            const parsed = JSON.parse(trimmedBuffer);
            if (Array.isArray(parsed)) {
              if (parsed.some((item) => item.detail)) {
                logger.warn(`API returned error in final buffer for ${action}:`, { error: parsed });
                throw new Error(parsed[0].detail || 'API returned error response');
              }
              data = parsed;
              receivedItems += parsed.length;
              onPartialData(parsed, { action, received: receivedItems });
              logger.log(`Parsed final ${action} data: ${parsed.length} items`, { address, receivedItems });
            }
          } else {
            throw new Error(`Invalid JSON response for ${action}`);
          }
        } catch (e) {
          logger.error(`Error parsing final JSON buffer for ${action}:`, { error: e.message, buffer });
          throw new Error(`Invalid JSON response from ${action} API`);
        }
      }

      if (data.length > 0) {
        try {
          await cacheData(cacheKey, data);
          logger.log(`Cached data for ${cacheKey}`);
        } catch (cacheError) {
          logger.warn(`Failed to cache data for ${cacheKey}`, { cacheError });
        }
      }

      setStreamProgress({ action: null, received: 0, total: null });
      return data;
    } catch (error) {
      if (data.length > 0) {
        try {
          await cacheData(cacheKey, data);
          logger.log(`Cached partial data for ${cacheKey} due to interruption`, { dataLength: data.length });
        } catch (cacheError) {
          logger.warn(`Failed to cache partial data for ${cacheKey}`, { cacheError });
        }
      }
      setStreamProgress({ action: null, received: 0, total: null });
      const errorMessage =
        error.response?.status === 429
          ? 'Too many requests. Please try again later.'
          : error.response?.status === 401
            ? 'Unauthorized: Please log in again.'
            : error.response?.status === 403 && error.response?.data?.detail?.includes('reCAPTCHA')
              ? 'reCAPTCHA verification failed. Please try again.'
              : error.response?.data?.detail || `Dune Sim API error for ${action}: ${error.message}`;
      logger.error(`Error fetching ${action}:`, { errorMessage, stack: error.stack });
      throw new Error(errorMessage);
    }
  };

  const { data: balancesData, error: balancesError, isValidating: balancesValidating } = useSWR(
    selectedWallet ? ['wallet-balances', selectedWallet.address, activeChainType] : null,
    () =>
      fetchDataQuery('wallet-balances', selectedWallet.address, activeChainType, (partialData, progress) => {
        setBalances(partialData);
        setStreamProgress(progress);
        const chainsWithData = [...new Set(partialData.map((b) => CHAIN_ID_TO_NAME[b.chain] || b.chain))];
        setChainsWithAssets(chainsWithData);
        if (activeChain === undefined && chainsWithData.length > 0) {
          setActiveChain(chainsWithData[0]);
        }
      }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const { data: transactionsData, error: transactionsError, isValidating: transactionsValidating } = useSWR(
    selectedWallet && activeTab === 'ACTIVITY' ? ['transactions', selectedWallet.address, activeChainType] : null,
    () =>
      fetchDataQuery('transactions', selectedWallet.address, activeChainType, (partialData, progress) => {
        setTransactions(
          partialData.map((tx) => ({
            ...tx,
            chain: CHAIN_ID_TO_NAME[tx.chain] || tx.chain,
          }))
        );
        setStreamProgress(progress);
      }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const ProgressIndicator = ({ progress, isMobile }) => {
    if (!progress.action) return null;
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="text-[9px] sm:text-[10px] text-white/80 p-2 sm:p-3 bg-white/5 border-b border-white/10"
      >
        Đang tải {progress.action === 'wallet-balances' ? 'số dư' : 'giao dịch'}: {progress.received} mục đã nhận
      </motion.div>
    );
  };

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
      setTransactions(
        transactionsData.map((tx) => ({
          ...tx,
          chain: CHAIN_ID_TO_NAME[tx.chain] || tx.chain,
        }))
      );
    }
    setLoadingStates({
      loading: chainsLoading,
      balances: balancesValidating,
      transactions: transactionsValidating,
      tokenInfo: false,
    });
  }, [balancesData, transactionsData, chainsLoading, balancesValidating, transactionsValidating]);

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
        if (!isValidEVM && !isValidSVM) {
          tokenInfoData[address] = [
            {
              chain,
              symbol: 'Unknown',
              logo: '/fallback-image.png',
              name: 'Unknown Token',
            },
          ];
          continue;
        }

        const cacheKey = `tokenInfo-${address}-${chain}`;
        let cachedData = null;
        try {
          cachedData = await getCachedData(cacheKey);
          if (cachedData) {
            tokenInfoData[address] = cachedData;
            logger.log(`Cache hit for tokenInfo: ${cacheKey}`);
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
              const trimmedBuffer = buffer.trim();
              if (trimmedBuffer.startsWith('[') && trimmedBuffer.endsWith(']')) {
                const parsed = JSON.parse(trimmedBuffer);
                if (Array.isArray(parsed)) {
                  // Kiểm tra xem parsed có chứa lỗi không
                  if (parsed.some((item) => item.detail)) {
                    logger.warn(`API returned error for token info ${address} on ${chain}`, { error: parsed });
                    throw new Error(parsed[0].detail || 'API returned error response');
                  }
                  data = parsed;
                  buffer = '';
                }
              }
            } catch (e) {
              logger.log(`Incomplete JSON chunk for token info ${address} on ${chain}, continuing to read: ${e.message}`);
              continue;
            }
          }

          // Xử lý buffer cuối
          if (buffer) {
            try {
              const trimmedBuffer = buffer.trim();
              if (trimmedBuffer.startsWith('[') && trimmedBuffer.endsWith(']')) {
                const parsed = JSON.parse(trimmedBuffer);
                if (Array.isArray(parsed)) {
                  if (parsed.some((item) => item.detail)) {
                    logger.warn(`API returned error in final buffer for token info ${address} on ${chain}`, { error: parsed });
                    throw new Error(parsed[0].detail || 'API returned error response');
                  }
                  data = parsed;
                }
              } else {
                throw new Error(`Invalid JSON response for token info ${address} on ${chain}`);
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
                logo: tokenData.logo || '/fallback-image.png',
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
                logo: '/fallback-image.png',
                name: 'Unknown Token',
              },
            ];
          }
        } catch (err) {
          logger.error(`Error fetching token info for ${address} on ${chain}:`, { error: err.message });
          tokenInfoData[address] = [
            {
              chain,
              symbol: 'Unknown',
              logo: '/fallback-image.png',
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
    return chain?.image || (chainName === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png');
  };

  const getChainLogos = (chainType) => {
    return chainType === 'EVM' ? EVM_LOGOS : SVM_LOGOS;
  };

  const getPaginatedData = (data, tab) => {
    const startIndex = (currentPage[tab] - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return data.slice(startIndex, endIndex);
  };

  const getTotalPages = (data) => {
    return Math.ceil(data.length / itemsPerPage);
  };

  const handlePageChange = (tab, page) => {
    setCurrentPage((prev) => ({ ...prev, [tab]: page }));
  };

  const renderTokenRow = useMemo(() => (token) => {
    const tokenInfoData = tokenInfo[token.address] || [];
    const tokenDetails = tokenInfoData.find((t) => t.chain === token.chain) || {};
    let logoUrl = '/icons/default.png';
    let tokenName = token.name || token.symbol || tokenDetails.name || tokenDetails.symbol || 'Unknown';
    let tokenSymbol = token.symbol || tokenDetails.symbol || 'Unknown';

    if (token.address === 'native' && NATIVE_TOKEN_INFO[token.chain]) {
      logoUrl = NATIVE_TOKEN_INFO[token.chain].logo;
      tokenName = NATIVE_TOKEN_INFO[token.chain].name;
      tokenSymbol = NATIVE_TOKEN_INFO[token.chain].symbol;
    } else if (token.logo && !token.logo.includes('scontent.xx.fbcdn.net') && token.logo !== '/fallback-image.png') {
      logoUrl = token.logo;
    } else if (tokenDetails.logo && !tokenDetails.logo.includes('scontent.xx.fbcdn.net') && tokenDetails.logo !== '/fallback-image.png') {
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

    return (
      <motion.tr
        key={`${token.chain}-${token.address}`}
        className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center">
          <div className="flex items-center justify-center gap-2 relative">
            <div className="relative flex-shrink-0">
              <img
                src={logoUrl}
                alt={`${tokenSymbol} logo`}
                width={isMobile ? 14 : 16}
                height={isMobile ? 14 : 16}
                className="rounded-full"
                onError={(e) => (e.target.src = '/icons/default.png')}
                loading="lazy"
              />
              <img
                src={getPlatformImage(token.chain)}
                alt={`${token.chain} logo`}
                width={isMobile ? 8 : 10}
                height={isMobile ? 8 : 10}
                className="rounded-full absolute top-0 right-0"
                style={{ transform: 'translate(25%, -25%)' }}
                onError={(e) => (e.target.src = token.chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
                loading="lazy"
              />
            </div>
            <div className="flex flex-col items-center">
              <span>{tokenSymbol}</span>
              {token.price_usd != null && (
                <span className="text-[7px] sm:text-[9px] text-white/60">{formatPrice(token.price_usd)}</span>
              )}
            </div>
          </div>
        </td>
        <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center">
          {formatBalance(token.amount)}
        </td>
        <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center">
          {token.value_usd != null
            ? `$${token.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
            : 'N/A'}
        </td>
      </motion.tr>
    );
  }, [isMobile, tokenInfo, getPlatformImage, formatPrice]);

  const renderTransactionRow = useMemo(() => (tx, index) => {
    const transactionKey = tx.hash || `tx-${index}`;
    const { txUrl, addressUrl } = getExplorerUrls(tx.chain, transactionKey, tx.from || tx.address);
    const isSVM = SUPPORTED_SVM_CHAINS.includes(tx.chain);
    let tokenLogo = isSVM
      ? tx.token_metadata?.logo || NATIVE_TOKEN_INFO[tx.chain]?.logo || '/icons/default.png'
      : tx.token_metadata?.logo && !tx.token_metadata.logo.includes('scontent.xx.fbcdn.net')
        ? tx.token_metadata.logo
        : NATIVE_TOKEN_INFO[tx.chain]?.logo || '/icons/default.png';
    let tokenSymbol = tx.token || 'Unknown';
    const addressToShow = tx.type === 'receive' ? tx.from : tx.to;
    const { text: displayAddress, image: addressImage } = truncateAddress(addressToShow, nameTags);

    let displayValue = Number(tx.value).toLocaleString("en-US", { maximumFractionDigits: 1 });
    let typeDisplay = tx.type ? tx.type.charAt(0).toUpperCase() + tx.type.slice(1) : "Other";

    if (tx.type === 'swap' && tx.swap_details) {
      const sent = tx.swap_details.sent[0];
      const received = tx.swap_details.received[0];
      if (sent && received) {
        displayValue = `${Number(sent.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${sent.symbol} → ${Number(received.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${received.symbol}`;
        tokenSymbol = `${sent.symbol}/${received.symbol}`;
        tokenLogo = sent.logo || received.logo || '/icons/default.png';
      } else if (sent) {
        displayValue = `${Number(sent.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${sent.symbol}`;
        tokenSymbol = sent.symbol;
        tokenLogo = sent.logo || '/icons/default.png';
      } else if (received) {
        displayValue = `${Number(received.amount).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${received.symbol}`;
        tokenSymbol = received.symbol;
        tokenLogo = received.logo || '/icons/default.png';
      }
      typeDisplay = 'Swap';
    } else if (tx.type === 'other') {
      typeDisplay = 'Other';
      displayValue = tx.value || 'N/A';
    }

    return (
      <motion.tr
        key={`${tx.chain}-${transactionKey}-${index}`}
        className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center">
          <div className="flex items-center justify-center gap-2 relative">
            <div className="relative flex-shrink-0">
              <img
                src={tokenLogo}
                alt={`${tokenSymbol} logo`}
                width={isMobile ? 14 : 16}
                height={isMobile ? 14 : 16}
                className="rounded-full"
                onError={(e) => (e.target.src = '/icons/default.png')}
                loading="lazy"
              />
              <img
                src={getPlatformImage(tx.chain)}
                alt={`${tx.chain} logo`}
                width={isMobile ? 8 : 10}
                height={isMobile ? 8 : 10}
                className="rounded-full absolute top-0 right-0"
                style={{ transform: 'translate(25%, -25%)' }}
                onError={(e) => (e.target.src = tx.chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
                loading="lazy"
              />
            </div>
            <span>{tokenSymbol}</span>
          </div>
        </td>
        <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center">
          <div className="flex flex-col items-center gap-1">
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
                  onError={(e) => (e.target.src = '/icons/default.png')}
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
        </td>
        <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center">
          {displayValue}
        </td>
        <td className="px-2 sm:px-3 py-2 text-white/80 text-[9px] sm:text-[10px] text-center">
          <div className="flex flex-col items-center gap-0.5">
            <a href={txUrl} target="_blank" rel="noopener noreferrer">
              <img
                src="/logos/etherscan-logo.png"
                alt="Explorer"
                width={isMobile ? 12 : 14}
                height={isMobile ? 12 : 14}
                className="rounded-full"
                onError={(e) => (e.target.src = '/fallback-image.png')}
                loading="lazy"
              />
            </a>
            <span className="text-[8px] sm:text-[9px] text-white/60">
              {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
            </span>
          </div>
        </td>
      </motion.tr>
    );
  }, [isMobile, nameTags, getPlatformImage, getExplorerUrls]);

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
          className="sm:hidden fixed top-8 left-1 z-50 p-1 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-neon-blue/20 transition-all duration-300"
          onClick={() => setShowWatchlistSidebar(true)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" />
          </svg>
        </motion.button>
      )}

      {/* Left Sidebar: Watchlist (Mobile - 50% width with slide-in) */}
      <AnimatePresence>
        {showWatchlistSidebar && isMobile && (
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="fixed inset-0 sm:hidden bg-black/10 backdrop-blur-xs z-40"
            onClick={() => setShowWatchlistSidebar(false)}
          >
            <motion.div
              className="w-2/3 h-full bg-black/70 backdrop-blur-xl border-r border-white/10 overflow-y-auto custom-scrollbar shadow-neon-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-2">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] sm:text-[12px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-1 rounded">
                    Watchlist
                  </h3>
                  <motion.button
                    onClick={() => setShowAddModal(true)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="p-1 bg-white/5 border border-white/10 rounded-xl hover:bg-neon-blue/20 transition-all duration-300"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-3 h-3 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </motion.button>
                </div>
                {watchlists.length === 0 ? (
                  <p className="text-[9px] sm:text-[10px] text-white/60 text-center">No wallets added</p>
                ) : (
                  watchlists.map((wallet) => (
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
                        setCurrentPage({ PORTFOLIO: 1, ACTIVITY: 1 });
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
                            onError={(e) => (e.target.src = '/icons/default.png')}
                            loading="lazy"
                          />
                        )}
                        <div className="flex flex-col">
                          <span className="text-[9px] sm:text-[10px] text-white font-bold">
                            {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'}
                          </span>
                          <span className="text-[8px] sm:text-[9px] text-white/60 truncate max-w-[120px] sm:max-w-[150px]">
                            {wallet.address}
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
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left Sidebar: Watchlist (Desktop) */}
      <div className="hidden sm:block w-[20%] h-[95%] border border-white/10 rounded-xl p-3 sm:p-4 mt-3 overflow-y-auto custom-scrollbar bg-white/5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] sm:text-[12px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-1 rounded">
            Watchlist
          </h3>
          <motion.button
            onClick={() => setShowAddModal(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="p-1 bg-white/5 border border-white/10 rounded-xl hover:bg-neon-blue/20 transition-all duration-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-3 h-3 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </motion.button>
        </div>
        {watchlists.length === 0 ? (
          <p className="text-[9px] sm:text-[10px] text-white/60 text-center">No wallets added</p>
        ) : (
          watchlists.map((wallet) => (
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
                setCurrentPage({ PORTFOLIO: 1, ACTIVITY: 1 });
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
                    onError={(e) => (e.target.src = '/icons/default.png')}
                    loading="lazy"
                  />
                )}
                <div className="flex flex-col">
                  <span className="text-[9px] sm:text-[10px] text-white font-bold">
                    {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'}
                  </span>
                  <span className="text-[8px] sm:text-[9px] text-white/60 truncate max-w-[120px] sm:max-w-[150px]">
                    {wallet.address}
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
          ))
        )}
      </div>

      {/* Right Section: Wallet Info (20%) + Tabs (80%) */}
      <div className="w-full sm:w-[80%] p-2 sm:p-3 flex flex-col">
        {selectedWallet ? (
          <>
            <div className="h-[20%] border border-white/10 bg-white/5 backdrop-blur-md p-3 sm:p-4 flex flex-col justify-between rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                {nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.image && (
                  <img
                    src={nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address].image}
                    alt={`${nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.nameTag || selectedWallet.name || 'Unnamed Wallet'} logo`}
                    width={isMobile ? 20 : 24}
                    height={isMobile ? 20 : 24}
                    className="rounded-xl"
                    onError={(e) => (e.target.src = '/icons/default.png')}
                    loading="lazy"
                  />
                )}
                <div className="flex flex-col">
                  <span className="text-[10px] sm:text-[12px] font-bold text-white">
                    {nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.nameTag || selectedWallet.name || 'Unnamed Wallet'}
                  </span>
                  <div className="relative flex items-center group">
                    <span className="text-[9px] sm:text-[10px] text-white/60 break-all">
                      {selectedWallet.address}
                    </span>
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
                  </div>
                </div>
              </div>
              <div className="flex overflow-x-auto gap-2 sm:gap-3 mb-3 no-scrollbar">
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
                      className={`flex items-center justify-center rounded-full flex-shrink-0 z-10 min-w-[22px] sm:min-w-[22px] m-1 ${activeChain === chain ? 'border-neon-blue bg-neon-blue/20' : 'border-white/10 bg-white/5'}`}
                    >
                      <img
                        src={getPlatformImage(chain)}
                        alt={chain}
                        width={isMobile ? 18 : 20}
                        height={isMobile ? 18 : 20}
                        className="rounded-full object-contain block flex-shrink-0"
                        onError={(e) => (e.target.src = chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
                        loading="lazy"
                      />
                    </motion.button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Tabs: Portfolio & Activity (80% height) */}
            <div className="h-[85%] flex flex-col">
              <div className="flex w-full border border-white/10 mt-3 bg-white/5 rounded-t-xl">
                {['PORTFOLIO', 'ACTIVITY'].map((tab) => (
                  <motion.button
                    key={tab}
                    onClick={() => handleTabClick(tab)}
                    className={`flex-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-[10px] font-medium ${activeTab === tab ? 'border-b-2 border-white text-white' : 'text-white/80'
                      } last:border-r-0`}
                  >
                    {tab}
                  </motion.button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar border border-white/10 bg-white/5 rounded-b-xl">
                <LoadingOverlay
                  isLoading={loadingStates.loading || (activeTab === 'PORTFOLIO' && (loadingStates.balances || loadingStates.tokenInfo))}
                  isMobile={isMobile}
                />
                <LoadingOverlay isLoading={loadingStates.transactions && activeTab === 'ACTIVITY'} isMobile={isMobile} />
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: activeTab === 'PORTFOLIO' ? -20 : 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: activeTab === 'PORTFOLIO' ? 20 : -20 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="h-full"
                  >
                    {activeTab === 'PORTFOLIO' && (
                      <>
                        <ProgressIndicator progress={streamProgress} isMobile={isMobile} />
                        {filteredBalances.length > 0 ? (
                          <table className="w-full text-[9px] sm:text-[10px]">
                            <thead className="sticky top-0 z-10 border-b border-white/10 bg-white/5">
                              <tr>
                                <th className="px-2 sm:px-3 py-1 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-2.21 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"
                                      />
                                    </svg>
                                    Token
                                  </div>
                                </th>
                                <th className="px-2 sm:px-3 py-1 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M5 8h4v10H5V8zm6 4h4v6h-4v-6zm6-2h4v8h-4v-8z"
                                      />
                                    </svg>
                                    Balance
                                  </div>
                                </th>
                                <th className="px-2 sm:px-3 py-1 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 5-5m0 0h-5m5 0v5" />
                                    </svg>
                                    Value
                                  </div>
                                </th>
                              </tr>
                            </thead>
                            <tbody>{getPaginatedData(filteredBalances, 'PORTFOLIO').map(renderTokenRow)}</tbody>
                          </table>
                        ) : (
                          <p className="text-[9px] sm:text-[10px] text-white/60 text-center p-2 sm:p-3 h-full flex items-center justify-center">
                            No balances found for this wallet.
                          </p>
                        )}
                      </>
                    )}
                    {activeTab === 'ACTIVITY' && (
                      <>
                        <ProgressIndicator progress={streamProgress} isMobile={isMobile} />
                        {filteredTransactions.length > 0 ? (
                          <table className="w-full text-[9px] sm:text-[10px]">
                            <thead className="sticky top-0 z-10 border-b border-white/10 bg-white/5">
                              <tr>
                                <th className="px-2 sm:px-3 py-1 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-2.21 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"
                                      />
                                    </svg>
                                    Token
                                  </div>
                                </th>
                                <th className="px-2 sm:px-3 py-1 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                                      />
                                    </svg>
                                    Address
                                  </div>
                                </th>
                                <th className="px-2 sm:px-3 py-1 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M5 8h4v10H5V8zm6 4h4v6h-4v-6zm6-2h4v8h-4v-8z"
                                      />
                                    </svg>
                                    Value
                                  </div>
                                </th>
                                <th className="px-2 sm:px-3 py-1 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                      />
                                    </svg>
                                    Time
                                  </div>
                                </th>
                              </tr>
                            </thead>
                            <tbody>{getPaginatedData(filteredTransactions, 'ACTIVITY').map(renderTransactionRow)}</tbody>
                          </table>
                        ) : (
                          <p className="text-[9px] sm:text-[10px] text-white/60 text-center p-2 sm:p-3 h-full flex items-center justify-center">
                            No transactions found for this wallet.
                          </p>
                        )}
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {(activeTab === 'PORTFOLIO' && filteredBalances.length > itemsPerPage) ||
                (activeTab === 'ACTIVITY' && filteredTransactions.length > itemsPerPage) ? (
                <div className="flex justify-end mt-2 px-2 sm:px-3">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <motion.button
                      onClick={() => handlePageChange(activeTab, currentPage[activeTab] - 1)}
                      disabled={currentPage[activeTab] === 1}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md ${currentPage[activeTab] === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/20'
                        } transition-all duration-300 rounded-lg`}
                    >
                      &lt;
                    </motion.button>
                    <span className="text-[9px] sm:text-[10px] text-white/80 self-center">
                      {currentPage[activeTab]} / {getTotalPages(activeTab === 'PORTFOLIO' ? filteredBalances : filteredTransactions)}
                    </span>
                    <motion.button
                      onClick={() => handlePageChange(activeTab, currentPage[activeTab] + 1)}
                      disabled={currentPage[activeTab] === getTotalPages(activeTab === 'PORTFOLIO' ? filteredBalances : filteredTransactions)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md ${currentPage[activeTab] === getTotalPages(activeTab === 'PORTFOLIO' ? filteredBalances : filteredTransactions)
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-neon-blue/20'
                        } transition-all duration-300 rounded-lg`}
                    >
                      &gt;
                    </motion.button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[9px] sm:text-[10px] text-white/60">
            Please select a wallet to view data.
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            className="fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-sm font-saira"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              className="p-3 sm:p-4 max-w-[90%] sm:max-w-md w-full border border-white/10 rounded-xl bg-white/5 backdrop-blur-md shadow-neon-sm"
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <motion.button
                onClick={() => {
                  setShowAddModal(false);
                  setNewWalletName('');
                  setNewAddress('');
                  setError(null);
                }}
                className="absolute top-3 right-3 text-white text-[12px] sm:text-[14px] font-bold rounded-full w-8 h-8 flex items-center justify-center bg-white/5 border border-white/10 backdrop-blur-md hover:bg-neon-blue/20 transition-all duration-300"
                aria-label="Close modal"
                whileHover={{ scale: 1.05, rotate: 90 }}
                whileTap={{ scale: 0.95 }}
              >
                ✕
              </motion.button>
              <h4 className="text-[10px] sm:text-[12px] font-bold text-white mb-3 uppercase tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-1 rounded flex items-center gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add Wallet to Watchlist
              </h4>
              <div className="mb-3">
                <label className="text-[9px] sm:text-[10px] text-white/80 uppercase tracking-wider mb-1 block">NAME</label>
                <input
                  type="text"
                  value={newWalletName}
                  onChange={(e) => setNewWalletName(e.target.value)}
                  placeholder="Enter wallet name (optional)"
                  className="w-full text-[9px] sm:text-[10px] px-2 sm:px-3 py-1 border border-white/10 bg-white/5 backdrop-blur-md text-white focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/20 transition-all duration-300 rounded-xl"
                />
                <label className="text-[9px] sm:text-[10px] text-white/80 uppercase tracking-wider mb-1 mt-2 block">WALLET</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder={`Enter wallet address (${newChainType === 'EVM' ? 'EVM' : 'Solana/Eclipse'})`}
                  className="w-full text-[9px] sm:text-[10px] px-2 sm:px-3 py-1 border border-white/10 bg-white/5 backdrop-blur-md text-white focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/20 transition-all duration-300 rounded-xl"
                />
              </div>
              <div className="flex w-full mb-3 bg-white/5 backdrop-blur-md rounded-xl">
                {['EVM', 'SVM'].map((type) => (
                  <motion.button
                    key={type}
                    onClick={() => setNewChainType(type)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`flex-1 flex items-center justify-between px-2 sm:px-3 py-1 sm:py-2 text-[9px] sm:text-[10px] font-medium transition-all duration-300 border border-white/10 rounded-xl m-1 ${newChainType === type ? 'text-white bg-neon-blue/20 shadow-neon-sm' : 'text-white/80 hover:bg-neon-blue/20'
                      }`}
                  >
                    <span>{type}</span>
                    <div className="flex items-center">
                      {getChainLogos(type).map((chain, index) => (
                        <img
                          key={chain}
                          src={NATIVE_TOKEN_INFO[chain]?.logo || '/icons/default.png'}
                          alt={`${chain} logo`}
                          width={isMobile ? 14 : 16}
                          height={isMobile ? 14 : 16}
                          className="rounded-full"
                          style={{ marginLeft: index > 0 ? '-8px' : '0', zIndex: 10 - index }}
                          onError={(e) => (e.target.src = '/icons/default.png')}
                          loading="lazy"
                        />
                      ))}
                      <div className="flex items-center justify-center w-3 sm:w-4 h-3 sm:h-4 bg-neon-blue/50 rounded-full text-white text-[7px] sm:text-[8px] mr-4">+</div>
                    </div>
                  </motion.button>
                ))}
              </div>
              <div className="flex justify-end gap-2 sm:gap-3 mt-3">
                <motion.button
                  onClick={handleAddWallet}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl hover:bg-neon-blue/20 transition-all duration-300"
                >
                  ADD +
                </motion.button>
              </div>
              {error && (
                <p className="text-[9px] sm:text-[10px] text-red-400 mt-2 bg-red-400/10 p-2 rounded-xl">Error: {error}</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
        .shadow-neon-sm {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.15);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .custom-scrollbar {
          -ms-overflow-style: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .animate-pulse {
          animation: ${isMobile ? 'none' : 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        table {
          table-layout: auto;
          width: 100%;
        }
        th,
        td {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @media (max-width: 640px) {
          table {
            font-size: 8px;
          }
          th,
          td {
            padding: 0.4rem;
          }
        }
      `}</style>
    </motion.div>
  );
}