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

const SkeletonLoader = ({ isMobile }) => {
  const skeletonRows = Array(5).fill(null);
  return (
    <div className="w-full p-2 sm:p-4">
      <table className="w-full text-[10px] sm:text-xs">
        <tbody>
          {skeletonRows.map((_, index) => (
            <tr key={index} className="border-t border-white/10">
              <td className="px-2 sm:px-4 py-2 text-center">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-5 sm:w-6 h-5 sm:h-6 bg-gray-700/50 rounded-full animate-pulse"></div>
                  <div className="w-10 sm:w-12 h-2 bg-gray-700/50 rounded animate-pulse"></div>
                </div>
              </td>
              <td className="px-2 sm:px-4 py-2 text-center">
                <div className="w-16 sm:w-20 h-3 bg-gray-700/50 rounded animate-pulse mx-auto"></div>
              </td>
              <td className="px-2 sm:px-4 py-2 text-center">
                <div className="w-20 sm:w-24 h-3 bg-gray-700/50 rounded animate-pulse mx-auto"></div>
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
        className={`absolute ${isVisible ? 'block' : 'hidden'} bg-black/80 backdrop-blur-lg border border-white/10 text-gray-200 text-[10px] sm:text-[12px] py-1 sm:py-2 px-2 sm:px-3 rounded-lg shadow-neon z-20 -top-8 sm:-top-10 left-1/2 -translate-x-1/2 whitespace-nowrap font-saira transition-all duration-300`}
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
        console.log('Updating URL:', url);
        router.replace(url, { scroll: false });
      }
    }, 300),
    [router, searchParams]
  );

  const handleTabClick = useCallback((tab) => {
    console.log('Tab clicked:', tab);
    setActiveTab(tab);
    setCurrentPage((prev) => ({ ...prev, [tab]: 1 }));
  }, []);

  useEffect(() => {
    const addressFromUrl = searchParams.get('address');
    console.log('useEffect triggered - searchParams:', {
      addressFromUrl,
      activeTab,
      selectedWallet: selectedWallet?.address,
    });

    // Skip if user-initiated change
    if (isUserInitiatedChange) {
      console.log('Skipping selectedWallet update due to user-initiated change');
      setIsUserInitiatedChange(false);
      return;
    }

    // Skip if URL matches last selected wallet
    if (addressFromUrl && addressFromUrl === lastSelectedWalletRef.current) {
      console.log('Skipping selectedWallet update: URL matches last selected wallet');
      return;
    }

    // Handle initial load or URL-driven changes
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
        console.log('Setting selectedWallet from URL or initialAddress:', wallet.address);
        setSelectedWallet(wallet);
        setActiveChainType(wallet.chainType || 'EVM');
        setBalances([]);
        setTransactions([]);
        setTokenInfo({});
        setActiveChain(null);
        setCurrentPage({ PORTFOLIO: 1, ACTIVITY: 1 });
        lastSelectedWalletRef.current = wallet.address;
        setIsInitialLoad(false); // Mark initial load as complete
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

  const fetchDataQuery = async (action, address, chainType) => {
    const isValidEVM = isAddress(address);
    const cacheKey = `${action}-${address}-${chainType}`;
    let cachedData = null;

    try {
      cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }
    } catch (error) {
      console.warn(`IndexedDB not available, skipping cache for ${cacheKey}`, error);
    }

    const payload = {
      action,
      address,
      ...(isValidEVM ? { chain_ids: '1,137,10,42161,8453' } : { chains: SUPPORTED_SVM_CHAINS.join(',') }),
      limit: 500,
    };

    try {
      const response = await axios.post(`${API_BASE_URL}/api/sim`, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
        },
        withCredentials: true,
        timeout: 30000,
      });

      if (!response.data.success) throw new Error(response.data.detail || `Failed to load ${action} data`);

      try {
        await cacheData(cacheKey, response.data.data);
      } catch (cacheError) {
        console.warn(`Failed to cache data for ${cacheKey}`, cacheError);
      }
      return response.data.data;
    } catch (error) {
      throw new Error(error.response?.data?.detail || `Failed to load ${action} data: ${error.message}`);
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
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
      if (balancesError) setBalances([]);
      if (transactionsError) setTransactions([]);
    }
  }, [balancesError, transactionsError, toast]);

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
          console.warn(`IndexedDB not available, skipping cache for ${cacheKey}`, error);
        }
        try {
          const payload = {
            action: 'wallet-balances',
            address,
            ...(isValidEVM ? { chain_ids: CHAIN_MAPPING[chain]?.chainId || '' } : { chains: SUPPORTED_SVM_CHAINS.join(',') }),
            limit: 1,
            metadata: 'logo',
          };
          const response = await axios.post(`${API_BASE_URL}/api/sim`, payload, {
            headers: {
              'Content-Type': 'application/json',
              ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
            },
            timeout: 30000,
          });
          if (response.data.success && response.data.data.length > 0) {
            const tokenData = response.data.data[0];
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
            } catch (cacheError) {
              console.warn(`Failed to cache data for ${cacheKey}`, cacheError);
            }
          }
        } catch (err) {
          console.error(`Error fetching token info for ${address} on ${chain}:`, err);
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
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    }
    if (tokenInfoData) setTokenInfo(tokenInfoData);
    setLoadingStates((prev) => ({ ...prev, tokenInfo: tokenInfoValidating }));
  }, [tokenInfoData, tokenInfoError, tokenInfoValidating, toast]);

  const fetchNameTagsForAddresses = useCallback(
    async (addresses) => {
      if (!addresses || addresses.length === 0) {
        console.log('No addresses provided for fetchNameTagsForAddresses');
        return;
      }

      const newNameTags = {};

      // Handle EVM addresses with batching
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

      // Handle SVM addresses
      const svmAddresses = addresses.filter((addr) => !isAddress(addr));
      svmAddresses.forEach((addr) => {
        newNameTags[addr] = { nameTag: null, image: null, timestamp: Date.now() };
      });

      setNameTags((prev) => ({
        ...prev,
        ...newNameTags,
      }));
      console.log(`Updated nameTags for ${Object.keys(newNameTags).length} addresses`);
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
    if (!session?.user?.id) {
      setWatchlists([]);
      setSelectedWallet(null);
      setIsInitialLoad(true); // Reset on session change
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
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
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
          wallet_address: newAddress, // Keep address as-is, no normalization
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
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    } finally {
      setLoadingStates((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleRemoveWallet = async (walletAddress) => {
    setLoadingStates((prev) => ({ ...prev, loading: true }));
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/watchlists`,
        { action: 'remove', wallet_address: walletAddress }, // Keep address as-is
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

  const renderTokenRow = (token) => {
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

    // Format balance to handle large/small numbers
    const formatBalance = (amount) => {
      if (amount == null || isNaN(amount)) return 'N/A';
      const num = Number(amount);
      if (num < 0.0001) return num.toFixed(6); // Show up to 6 decimals for small numbers
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
        <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
          <div className="flex items-center justify-center gap-2 relative">
            <div className="relative flex-shrink-0">
              <Image
                src={logoUrl}
                alt={`${tokenSymbol} logo`}
                width={isMobile ? 20 : 24}
                height={isMobile ? 20 : 24}
                className="rounded-full"
                style={{ width: 'auto', height: 'auto' }}
                onError={(e) => (e.target.src = '/icons/default.png')}
              />
              <Image
                src={getPlatformImage(token.chain)}
                alt={`${token.chain} logo`}
                width={isMobile ? 8 : 10}
                height={isMobile ? 8 : 10}
                className="rounded-full absolute top-0 right-0"
                style={{ transform: 'translate(25%, -25%)', width: 'auto', height: 'auto' }}
                onError={(e) => (e.target.src = token.chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
              />
            </div>
            <div className="flex flex-col items-center">
              <span>{tokenSymbol}</span>
              {token.price_usd != null && (
                <span className="text-[7px] sm:text-[10px] text-gray-400">{formatPrice(token.price_usd)}</span>
              )}
            </div>
          </div>
        </td>
        <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
          {formatBalance(token.amount)}
        </td>
        <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
          {token.value_usd != null
            ? `$${token.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
            : 'N/A'}
        </td>
      </motion.tr>
    );
  };

  const renderTransactionRow = (tx, index) => {
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

  // Handle swap và other transactions
  let displayValue = tx.value;
  let typeDisplay = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);
  if (tx.type === 'swap' && tx.swap_details) {
    const sent = tx.swap_details.sent[0];
    const received = tx.swap_details.received[0];
    if (sent && received) {
      displayValue = `${sent.amount.toFixed(4)} ${sent.symbol} → ${received.amount.toFixed(4)} ${received.symbol}`;
      tokenSymbol = `${sent.symbol}/${received.symbol}`;
      tokenLogo = sent.logo || received.logo || '/icons/default.png';
    } else if (sent) {
      displayValue = `${sent.amount.toFixed(4)} ${sent.symbol}`;
      tokenSymbol = sent.symbol;
      tokenLogo = sent.logo || '/icons/default.png';
    } else if (received) {
      displayValue = `${received.amount.toFixed(4)} ${received.symbol}`;
      tokenSymbol = received.symbol;
      tokenLogo = received.logo || '/icons/default.png';
    }
    typeDisplay = 'Swap';
  } else if (tx.type === 'other') {
    typeDisplay = 'Other';
    displayValue = tx.value || 'N/A';
  } else if (tx.type === 'send' || tx.type === 'receive') {
    displayValue = Number(tx.value).toFixed(4);
  }

  return (
    <motion.tr
      key={`${tx.chain}-${transactionKey}-${index}`}
      className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
        <div className="flex items-center justify-center gap-2 relative">
          <div className="relative flex-shrink-0">
            <Image
              src={tokenLogo}
              alt={`${tokenSymbol} logo`}
              width={isMobile ? 20 : 24}
              height={isMobile ? 20 : 24}
              className="rounded-full"
              style={{ width: 'auto', height: 'auto' }}
              onError={(e) => (e.target.src = '/icons/default.png')}
            />
            <Image
              src={getPlatformImage(tx.chain)}
              alt={`${tx.chain} logo`}
              width={isMobile ? 8 : 10}
              height={isMobile ? 8 : 10}
              className="rounded-full absolute top-0 right-0"
              style={{ transform: 'translate(25%, -25%)', width: 'auto', height: 'auto' }}
              onError={(e) => (e.target.src = tx.chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
            />
          </div>
          <span>{tokenSymbol}</span>
        </div>
      </td>
      <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
        <div className="flex flex-col items-center gap-1">
          <span
            className={`inline-flex px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] sm:text-[10px] font-medium ${
              tx.type === 'receive'
                ? 'bg-green-500/20 text-green-500'
                : tx.type === 'send'
                ? 'bg-blue-500/20 text-blue-500'
                : tx.type === 'swap'
                ? 'bg-purple-500/20 text-purple-500'
                : 'bg-gray-500/20 text-gray-500' // cho other/unknown
            }`}
          >
            {typeDisplay}
          </span>
          <div className="flex items-center justify-center gap-2">
            {addressImage && (
              <Image
                src={addressImage}
                alt={`${displayAddress} logo`}
                width={isMobile ? 12 : 16}
                height={isMobile ? 12 : 16}
                className="rounded-full"
                style={{ width: 'auto', height: 'auto' }}
                onError={(e) => (e.target.src = '/icons/default.png')}
              />
            )}
            <a
              href={addressUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neon-blue hover:underline truncate"
              title={addressToShow}
            >
              {displayAddress}
            </a>
          </div>
        </div>
      </td>
      <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
        {displayValue}
      </td>
      <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
        <div className="flex flex-col items-center gap-0.5">
          <a href={txUrl} target="_blank" rel="noopener noreferrer">
            <Image
              src="/logos/etherscan-logo.png" // Thay bằng Solscan hoặc tương tự nếu cần cho SVM
              alt="Explorer"
              width={isMobile ? 12 : 16}
              height={isMobile ? 12 : 16}
              className="rounded-full"
              style={{ width: 'auto', height: 'auto' }}
              onError={(e) => (e.target.src = '/fallback-image.png')}
            />
          </a>
          <span className="text-[8px] sm:text-[10px] text-gray-400">
            {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
          </span>
        </div>
      </td>
    </motion.tr>
  );
};

  const filteredBalances = useMemo(() => {
    return balances
      .filter((b) => {
        if (activeChain === null) return true;
        return b.chain === activeChain;
      })
      .filter((b) => {
        const tokenInfoData = tokenInfo[b.address] || [];
        const tokenDetails = tokenInfoData.find((t) => t.chain === b.chain) || {};
        const isNative = b.address === 'native' && NATIVE_TOKEN_INFO[b.chain];
        const hasValidLogo =
          isNative ||
          (b.logo && !b.logo.includes('scontent.xx.fbcdn.net') && b.logo !== '/fallback-image.png') ||
          (tokenDetails.logo &&
            !tokenDetails.logo.includes('scontent.xx.fbcdn.net') &&
            tokenDetails.logo !== '/fallback-image.png');
        return hasValidLogo;
      });
  }, [balances, activeChain, tokenInfo]);

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
        className="font-saira w-full max-w-9xl mx-auto mt-2 p-4 bg-black/60 backdrop-blur-2xl shadow-neon-lg rounded-lg flex items-center justify-center min-h-[calc(100vh-6rem)]"
      >
        <div className="text-center">
          <h3 className="text-lg sm:text-xl font-bold text-white mb-4">Please Log In</h3>
          <p className="text-sm sm:text-base text-gray-400 mb-6">You need to be logged in to access your watchlist.</p>
          <motion.button
            onClick={() => router.push('/auth/signin')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-4 sm:px-6 py-2 sm:py-3 text-sm sm:text-base font-medium text-black bg-white border border-white/10 rounded-xl hover:bg-neon-blue/30 transition-all duration-300"
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
      className="font-saira w-full max-w-9xl mx-auto p-2 bg-black/60 backdrop-blur-2xl shadow-neon-lg flex flex-row h-full overflow-hidden"
    >
      <ToastContainer position="top-center" autoClose={5000} theme="dark" />

      {/* Toggle Button for Mobile */}
      {!showWatchlistSidebar && (
        <motion.button
          className="sm:hidden fixed top-1 left-1 z-50 p-1 bg-black/60 border border-white/10 rounded-lg text-white hover:bg-neon-blue/30 transition-all duration-300"
          onClick={() => setShowWatchlistSidebar(true)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
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
            className="fixed inset-0 sm:hidden bg-black/50 backdrop-blur-sm z-40"
            onClick={() => setShowWatchlistSidebar(false)}
          >
            <motion.div
              className="w-1/2 h-full bg-black/80 backdrop-blur-2xl border-r border-white/10 overflow-y-auto custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-2">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-2">
                    Watchlist
                  </h3>
                  <motion.button
                    onClick={() => setShowAddModal(true)}
                    whileHover={{ scale: 1 }}
                    whileTap={{ scale: 0.95 }}
                    className="px-2 py-1.5 text-[10px] font-medium text-black border border-white/10 rounded-xl bg-white backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
                  >
                    Add +
                  </motion.button>
                </div>
                {watchlists.length === 0 ? (
                  <p className="text-[10px] text-gray-400 text-center">No wallets added</p>
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
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`flex items-center justify-between p-2 mb-2 rounded-lg cursor-pointer transition-all duration-300 border-l-4 ${selectedWallet?.address === wallet.address
                          ? 'border-white bg-black/60'
                          : 'border-transparent bg-black/60 hover:bg-neon-blue/10'
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.image && (
                          <Image
                            src={nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address].image}
                            alt={`${nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'} logo`}
                            width={20}
                            height={20}
                            className="rounded-full"
                            style={{ width: 'auto', height: 'auto' }}
                            onError={(e) => (e.target.src = '/icons/default.png')}
                          />
                        )}
                        <div className="flex flex-col">
                          <span className="text-[10px] text-white font-bold">
                            {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'}
                          </span>
                          <span className="text-[8px] text-gray-400 truncate max-w-[120px]">
                            {wallet.address}
                          </span>
                        </div>
                      </div>
                      <motion.button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveWallet(wallet.address);
                        }}
                        whileHover={{ scale: 1 }}
                        whileTap={{ scale: 0.95 }}
                        className="text-[8px] text-red-500/80 hover:text-red-500"
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
      <div className="hidden sm:block w-[20%] border-r border-white/10 p-2 sm:p-4 overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] sm:text-[12px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-2">
            Watchlist
          </h3>
          <motion.button
            onClick={() => setShowAddModal(true)}
            whileHover={{ scale: 1 }}
            whileTap={{ scale: 0.95 }}
            className="px-2 sm:px-3 py-1.5 sm:py-1.5 text-[10px] sm:text-xs font-medium text-black border border-white/10 rounded-xl bg-white backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
          >
            Add +
          </motion.button>
        </div>
        {watchlists.length === 0 ? (
          <p className="text-[10px] sm:text-xs text-gray-400 text-center">No wallets added</p>
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
              className={`flex items-center justify-between p-2 sm:p-3 mb-2 rounded-lg cursor-pointer transition-all duration-300 border-l-4 ${selectedWallet?.address === wallet.address
                  ? 'border-white bg-black/60'
                  : 'border-transparent bg-black/60 hover:bg-neon-blue/10'
                }`}
            >
              <div className="flex items-center gap-2">
                {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.image && (
                  <Image
                    src={nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address].image}
                    alt={`${nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'} logo`}
                    width={isMobile ? 20 : 24}
                    height={isMobile ? 20 : 24}
                    className="rounded-full"
                    style={{ width: 'auto', height: 'auto' }}
                    onError={(e) => (e.target.src = '/icons/default.png')}
                  />
                )}
                <div className="flex flex-col">
                  <span className="text-[10px] sm:text-xs text-white font-bold">
                    {nameTags[wallet.chainType === 'EVM' ? wallet.address.toLowerCase() : wallet.address]?.nameTag || wallet.name || 'Unnamed Wallet'}
                  </span>
                  <span className="text-[8px] sm:text-[10px] text-gray-400 truncate max-w-[120px] sm:max-w-[150px]">
                    {wallet.address}
                  </span>
                </div>
              </div>
              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveWallet(wallet.address);
                }}
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className="text-[8px] sm:text-[10px] text-red-500/80 hover:text-red-500"
              >
                ✕
              </motion.button>
            </motion.div>
          ))
        )}
      </div>

      {/* Right Section: Wallet Info (20%) + Tabs (80%) */}
      <div className="w-full sm:w-[80%] p-2 sm:p-4 flex flex-col">
        {selectedWallet ? (
          <>
            {/* Wallet Info (20% height) */}
            <div className="h-[20%] border-b border-white/10 bg-black/60 backdrop-blur-md p-2 sm:p-3 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2">
                {nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.image && (
                  <Image
                    src={nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address].image}
                    alt={`${nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.nameTag || selectedWallet.name || 'Unnamed Wallet'} logo`}
                    width={isMobile ? 24 : 28}
                    height={isMobile ? 24 : 28}
                    className="rounded-xl"
                    style={{ width: 'auto', height: 'auto' }}
                    onError={(e) => (e.target.src = '/icons/default.png')}
                  />
                )}
                <div className="relative group">
                  <div className="flex flex-col">
                    <span className="text-[12px] sm:text-sm font-bold text-white">
                      {nameTags[selectedWallet.chainType === 'EVM' ? selectedWallet.address.toLowerCase() : selectedWallet.address]?.nameTag || selectedWallet.name || 'Unnamed Wallet'}
                    </span>
                    <span className="text-[10px] sm:text-xs text-gray-400">
                      {selectedWallet.address}
                    </span>
                  </div>
                  <motion.button
                    className="absolute top-1/2 right-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-neon-blue hover:text-neon-blue/80 transition-opacity duration-200"
                    onClick={() => copyAddress(selectedWallet.address, toast)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    title="Copy Address"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 sm:h-4 w-3.5 sm:w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </motion.button>
                </div>
              </div>
              <div className="flex overflow-x-auto gap-2 sm:gap-3 mb-4 no-scrollbar pb-2">
                <div className="flex items-center space-x-2 sm:space-x-3">
                  <Tooltip text="All Chains">
                    <motion.button
                      onClick={() => setActiveChain(null)}
                      className={`px-2 sm:px-2 py-1 sm:py-1 border rounded-xl transition-all duration-300 text-[9px] sm:text-[10px] font-medium text-white flex-shrink-0 z-10 ${activeChain === null
                          ? 'border-white bg-neon-blue/20 shadow-neon'
                          : 'border-white/10 bg-black/60 backdrop-blur-md hover:bg-neon-blue/30'
                        }`}
                    >
                      ALL
                    </motion.button>
                  </Tooltip>
                  {chainsWithAssets.map((chain) => (
                    <Tooltip key={chain} text={chain.charAt(0).toUpperCase() + chain.slice(1)}>
                      <motion.button
                        onClick={() => setActiveChain(chain)}
                        className={`p-1 border rounded-xl transition-all duration-300 flex-shrink-0 z-10 ${activeChain === chain
                            ? 'border-neon-blue bg-neon-blue/20 shadow-neon'
                            : 'border-white/10 bg-black/60 backdrop-blur-md hover:bg-neon-blue/30'
                          }`}
                      >
                        <Image
                          src={getPlatformImage(chain)}
                          alt={chain}
                          width={isMobile ? 16 : 32}
                          height={isMobile ? 16 : 32}
                          className="rounded-xl object-contain block"
                          style={{ width: 'auto', height: 'auto', minWidth: '16px', minHeight: '16px' }}
                          onError={(e) => (e.target.src = chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
                        />
                      </motion.button>
                    </Tooltip>
                  ))}
                </div>
              </div>
            </div>

            {/* Tabs: Portfolio & Activity (80% height) */}
            <div className="h-[90%] flex flex-col">
              <div className="flex w-full border-b border-white/10 mb-2 sm:mb-4 bg-black/60 backdrop-blur-md rounded-xl">
                {['PORTFOLIO', 'ACTIVITY'].map((tab) => (
                  <motion.button
                    key={tab}
                    onClick={() => handleTabClick(tab)}
                    whileHover={{ scale: 1 }}
                    whileTap={{ scale: 0.95 }}
                    className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition-all duration-300 ${activeTab === tab ? 'border-b-2 border-white text-white bg-neon-blue/20' : 'text-white'
                      } last:border-r-0`}
                  >
                    {tab}
                  </motion.button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar border border-white/10 rounded-lg bg-black/60 backdrop-blur-2xl shadow-neon-sm">
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
                        {filteredBalances.length > 0 ? (
                          <table className="w-full text-[10px] sm:text-xs">
                            <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur-md">
                              <tr>
                                <th className="px-2 sm:px-4 py-1 sm:py-1.5 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                                <th className="px-2 sm:px-4 py-1 sm:py-1.5 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                                <th className="px-2 sm:px-4 py-1 sm:py-1.5 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                          <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4 h-full flex items-center justify-center">
                            No balances found for this wallet.
                          </p>
                        )}
                      </>
                    )}
                    {activeTab === 'ACTIVITY' && (
                      <>
                        {filteredTransactions.length > 0 ? (
                          <table className="w-full text-[10px] sm:text-xs">
                            <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur-md">
                              <tr>
                                <th className="px-2 sm:px-4 py-1 sm:py-1.5 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                                <th className="px-2 sm:px-4 py-1 sm:py-1.5 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                                <th className="px-2 sm:px-4 py-1 sm:py-1.5 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                                <th className="px-2 sm:px-4 py-1 sm:py-1.5 text-white font-medium text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
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
                          <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4 h-full flex items-center justify-center">
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
                <div className="flex justify-end mt-2 px-2 sm:px-4">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <motion.button
                      onClick={() => handlePageChange(activeTab, currentPage[activeTab] - 1)}
                      disabled={currentPage[activeTab] === 1}
                      whileHover={{ scale: 1 }}
                      whileTap={{ scale: 0.95 }}
                      className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-black/60 backdrop-blur-md ${currentPage[activeTab] === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/30'
                        } transition-all duration-300 rounded`}
                    >
                      &lt;
                    </motion.button>
                    <span className="text-[10px] sm:text-xs text-gray-200 self-center">
                      {currentPage[activeTab]} / {getTotalPages(activeTab === 'PORTFOLIO' ? filteredBalances : filteredTransactions)}
                    </span>
                    <motion.button
                      onClick={() => handlePageChange(activeTab, currentPage[activeTab] + 1)}
                      disabled={currentPage[activeTab] === getTotalPages(activeTab === 'PORTFOLIO' ? filteredBalances : filteredTransactions)}
                      whileHover={{ scale: 1 }}
                      whileTap={{ scale: 0.95 }}
                      className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-black/60 backdrop-blur-md ${currentPage[activeTab] === getTotalPages(activeTab === 'PORTFOLIO' ? filteredBalances : filteredTransactions)
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-neon-blue/30'
                        } transition-all duration-300 rounded`}
                    >
                      &gt;
                    </motion.button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[10px] sm:text-xs text-gray-400">
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
            className="fixed inset-0 flex items-center justify-center z-50 bg-black/80 backdrop-blur-2xl font-saira"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              className="p-4 sm:p-6 max-w-[90%] sm:max-w-md w-full border-2 border-white/10 rounded-xl bg-black/60 backdrop-blur-2xl shadow-neon-lg"
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
                className="absolute top-4 right-4 text-white text-lg font-bold rounded-full w-10 h-10 flex items-center justify-center bg-black/60 border border-white/10 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
                aria-label="Close modal"
                whileHover={{ scale: 1, rotate: 90 }}
                whileTap={{ scale: 0.95 }}
              >
                ✕
              </motion.button>
              <h4 className="text-[10px] sm:text-sm font-bold text-white mb-4 uppercase tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-2 rounded flex items-center gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add Wallet to Watchlist
              </h4>
              <div className="mb-4">
                <label className="text-[10px] sm:text-xs text-gray-200 uppercase tracking-wider mb-1 block">NAME</label>
                <input
                  type="text"
                  value={newWalletName}
                  onChange={(e) => setNewWalletName(e.target.value)}
                  placeholder="Enter wallet name (optional)"
                  className="w-full text-[9px] sm:text-[10px] px-3 sm:px-4 py-1 sm:py-1.5 mb-3 border border-white/10 bg-black/60 backdrop-blur-md text-white focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/30 transition-all duration-300"
                />
                <label className="text-[10px] sm:text-xs text-gray-200 uppercase tracking-wider mb-1 block">WALLET</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder={`Enter wallet address (${newChainType === 'EVM' ? 'EVM' : 'Solana/Eclipse'})`}
                  className="w-full text-[9px] sm:text-[10px] px-3 sm:px-4 py-1 sm:py-1.5 border border-white/10 bg-black/60 backdrop-blur-md text-white focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/30 transition-all duration-300"
                />
              </div>
              <div className="flex w-full mb-4 bg-black/60 backdrop-blur-md">
                {['EVM', 'SVM'].map((type) => (
                  <motion.button
                    key={type}
                    onClick={() => setNewChainType(type)}
                    whileHover={{ scale: 1 }}
                    whileTap={{ scale: 1 }}
                    className={`flex-1 flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 text-[10px] sm:text-xs font-medium transition-all duration-300 border border-white rounded-xl m-2 ${newChainType === type ? 'text-white bg-gray-300 shadow-neon' : 'text-white'
                      }`}
                  >
                    <span>{type}</span>
                    <div className="flex items-center">
                      {getChainLogos(type).map((chain, index) => (
                        <Image
                          key={chain}
                          src={NATIVE_TOKEN_INFO[chain]?.logo || '/icons/default.png'}
                          alt={`${chain} logo`}
                          width={isMobile ? 20 : 24}
                          height={isMobile ? 20 : 24}
                          className="rounded-full"
                          style={{ marginLeft: index > 0 ? '-9px' : '0', zIndex: 10 - index, width: 'auto', height: 'auto' }}
                          onError={(e) => (e.target.src = '/icons/default.png')}
                        />
                      ))}
                      <div className="flex items-center justify-center w-4 sm:w-5 h-4 sm:h-5 bg-neon-blue/50 rounded-full text-white text-[8px] sm:text-[10px] mr-6">+</div>
                    </div>
                  </motion.button>
                ))}
              </div>
              <div className="flex justify-end gap-2 sm:gap-3 mt-4">
                <motion.button
                  onClick={handleAddWallet}
                  whileHover={{ scale: 1 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-black border border-white/10 bg-white rounded-xl backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
                >
                  ADD +
                </motion.button>
              </div>
              {error && (
                <p className="text-[10px] sm:text-xs text-red-400 mt-3 bg-red-500/10 p-2 rounded">Error: {error}</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
  .shadow-neon {
    box-shadow: 0 0 10px rgba(0, 191, 255, 0.4), 0 0 20px rgba(0, 191, 255, 0.2);
  }
  .shadow-neon-lg {
    box-shadow: 0 0 15px rgba(0, 191, 255, 0.5), 0 0 30px rgba(0, 191, 255, 0.3);
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
    border-radius: 3px;
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
      font-size: 9px;
    }
    th,
    td {
      padding: 0.5rem;
    }
  }
`}</style>
    </motion.div>
  );
}