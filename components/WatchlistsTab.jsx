// components/WatchlistsTab.jsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAddress } from 'ethers';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { SUPPORTED_CHAINS, CHAIN_MAPPING, CHAIN_ID_TO_NAME, CHAIN_EXPLORER_MAP } from '../utils/constants';
import { formatDistanceToNow } from 'date-fns';
import useSWR from 'swr';
import { cacheData, getCachedData, clearCache } from '../utils/indexedDB';
import { LoadingOverlay } from '@/utils/helpers';

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.code === 'ECONNABORTED' || error.response?.status >= 500,
});

// Utility functions (unchanged)
const formatPrice = (price) => {
  if (price == null || isNaN(price)) return 'N/A';
  let fractionDigits = 2;
  if (price < 0.0001) {
    fractionDigits = 6;
  } else if (price < 0.01) {
    fractionDigits = 4;
  }
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
};

const formatBalance = (amount) => {
  if (amount == null || isNaN(amount)) return 'N/A';
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};

const truncateAddress = (address, nameTags = {}) => {
  if (!address || address === 'None' || typeof address !== 'string') return { text: 'N/A', image: null };
  const normalizedAddress = address.toLowerCase();
  const nameTag = nameTags[normalizedAddress]?.Labels?.deposit?.['Name Tag'] || nameTags[normalizedAddress]?.name || null;
  const image = nameTags[normalizedAddress]?.Labels?.deposit?.image || nameTags[normalizedAddress]?.image || null;
  const isEvmAddress = address.match(/^0x[a-fA-F0-9]{40}$/);
  const isSvmAddress = address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
  const shortAddress = isEvmAddress
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : isSvmAddress
      ? `${address.slice(0, 6)}...${address.slice(-6)}`
      : address;
  return { text: nameTag ? `${nameTag} (${shortAddress})` : shortAddress, image };
};

const getExplorerUrls = (chain, hash, address) => {
  const chainName = CHAIN_ID_TO_NAME[chain] || chain || 'ethereum';
  const explorer = CHAIN_EXPLORER_MAP[chainName] || CHAIN_EXPLORER_MAP.ethereum;
  const txUrl = explorer.supportsTx ? `${explorer.baseUrl}/tx/${hash}` : '#';
  const addressUrl = explorer.supportsAddress ? `${explorer.baseUrl}/address/${address}` : '#';
  return { txUrl, addressUrl };
};

const NATIVE_TOKEN_INFO = {
  ethereum: { name: 'Ethereum', symbol: 'ETH', logo: '/ethereum-logo.png' },
  base: { name: 'Base', symbol: 'ETH', logo: '/base-logo.png' },
  bnb: { name: 'BNB', symbol: 'BNB', logo: '/bnb-logo.png' },
  solana: { name: 'Solana', symbol: 'SOL', logo: '/solana-logo.png' },
  eclipse: { name: 'Eclipse', symbol: 'ECL', logo: '/eclipse-logo.png' },
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

export default function WatchlistsTab({ initialTab = 'token', initialAddress = null, toast }) {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
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
    collectibles: false,
    transactions: false,
  });
  const [activeChainType, setActiveChainType] = useState('EVM');
  const [activeChain, setActiveChain] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab.toUpperCase());
  const [balances, setBalances] = useState([]);
  const [collectibles, setCollectibles] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [tokenInfo, setTokenInfo] = useState({});
  const [chainsWithAssets, setChainsWithAssets] = useState([]);
  const [nameTags, setNameTags] = useState({});
  const [chains, setChains] = useState([]);
  const [newWalletName, setNewWalletName] = useState('');
  const [forceFetch, setForceFetch] = useState(false); // New state to force re-fetch
  const itemsPerPage = 50;
  const [currentPage, setCurrentPage] = useState({
    TOKEN: 1,
    NFT: 1,
    ACTIVITY: 1,
  });

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
  const SUPPORTED_SVM_CHAINS = ['solana', 'eclipse'];
  const EVM_LOGOS = ['ethereum', 'base', 'bnb'];
  const SVM_LOGOS = ['solana', 'eclipse'];

  const stableWatchlists = useMemo(() => watchlists, [watchlists]);

  const updateUrl = useCallback((tab, address) => {
    const newParams = new URLSearchParams();
    newParams.set('tab', tab.toLowerCase());
    if (address) {
      newParams.set('address', address);
    }
    router.push(`/watchlist?${newParams.toString()}`, { shallow: true });
  }, [router]);

  const handleTabClick = (tab) => {
    setActiveTab(tab);
    setCurrentPage((prev) => ({ ...prev, [tab]: 1 }));
    updateUrl(tab.toLowerCase(), selectedWallet?.address || null);
  };

  useEffect(() => {
    console.log('Sync useEffect triggered', { watchlists: watchlists.length, selectedWallet: selectedWallet?.address });
    const tabFromUrl = searchParams.get('tab')?.toUpperCase() || initialTab.toUpperCase();
    const addressFromUrl = searchParams.get('address') || initialAddress;

    if (['TOKEN', 'NFT', 'ACTIVITY'].includes(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
      setCurrentPage((prev) => ({ ...prev, [tabFromUrl]: 1 }));
    }

    if (addressFromUrl && stableWatchlists.some((w) => w.address === addressFromUrl)) {
      const wallet = stableWatchlists.find((w) => w.address === addressFromUrl);
      if (wallet && wallet.address !== selectedWallet?.address) {
        console.log('Setting selected wallet from URL', { wallet });
        setSelectedWallet(wallet);
        setActiveChainType(wallet?.chainType || 'EVM');
      }
    } else if (stableWatchlists.length > 0 && !selectedWallet) {
      const wallet = stableWatchlists[0];
      console.log('Setting default selected wallet', { wallet });
      setSelectedWallet(wallet);
      setActiveChainType(wallet?.chainType || 'EVM');
      updateUrl(activeTab.toLowerCase(), wallet.address);
    }
  }, [searchParams, initialTab, initialAddress, stableWatchlists, selectedWallet, updateUrl, activeTab]);

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

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isValidSolanaAddress = useCallback((address) => {
    return address && address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
  }, []);

  const fetchDataQuery = async (action, address, chainType) => {
    const isValidEVM = isAddress(address);
    const cacheKey = `${action}-${address}-${chainType}`;
    let cachedData = null;

    try {
      cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        console.log(`Using cached data for ${cacheKey}`);
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

  const { data: collectiblesData, error: collectiblesError, isValidating: collectiblesValidating } = useSWR(
    selectedWallet ? ['collectibles', selectedWallet.address, activeChainType] : null,
    () => fetchDataQuery('collectibles', selectedWallet.address, activeChainType),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  const { data: transactionsData, error: transactionsError, isValidating: transactionsValidating } = useSWR(
    selectedWallet ? ['transactions', selectedWallet.address, activeChainType] : null,
    () => fetchDataQuery('transactions', selectedWallet.address, activeChainType),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 15 * 60 * 1000,
      dedupingInterval: 30 * 1000,
    }
  );

  useEffect(() => {
    if (balancesError || collectiblesError || transactionsError) {
      const errorMessage =
        balancesError?.message || collectiblesError?.message || transactionsError?.message || 'Failed to load data';
      setError(errorMessage);
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
      if (balancesError) setBalances([]);
      if (collectiblesError) setCollectibles([]);
      if (transactionsError) setTransactions([]);
    }
  }, [balancesError, collectiblesError, transactionsError, toast]);

  useEffect(() => {
    if (balancesData) {
      setBalances(balancesData);
      const chainsWithData = [...new Set(balancesData.map((b) => CHAIN_ID_TO_NAME[b.chain] || b.chain))];
      setChainsWithAssets(chainsWithData);
      if (activeChain === undefined && chainsWithData.length > 0) {
        setActiveChain(chainsWithData[0]);
      }
    }
    if (collectiblesData) setCollectibles(collectiblesData);
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
      collectibles: collectiblesValidating,
      transactions: transactionsValidating,
      tokenInfo: tokenInfoValidating,
    });
  }, [balancesData, collectiblesData, transactionsData, chainsLoading, balancesValidating, collectiblesValidating, transactionsValidating]);

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
    setLoadingStates((prev) => ({ ...prev, loading: tokenInfoValidating }));
  }, [tokenInfoData, tokenInfoError, tokenInfoValidating, toast]);

  useEffect(() => {
    if (!session?.user?.id || !watchlists.length) return;

    async function fetchNametags() {
      try {
        const addresses = watchlists.map((w) => w.address);
        console.log('Fetching nametags for addresses:', addresses);
        const response = await axios.post(
          `${API_BASE_URL}/api/nametags`,
          { addresses },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
            },
            withCredentials: true,
          }
        );
        if (response.data.success) {
          setNameTags(response.data.data);
          console.log('Fetched nametags:', response.data.data);
        } else {
          console.warn('Failed to fetch nametags:', response.data.detail);
        }
      } catch (err) {
        console.error('Error fetching nametags:', err);
      }
    }

    fetchNametags();
  }, [watchlists, session]);

  // Load watchlists
  useEffect(() => {
    if (!session?.user?.id) {
      console.log('No session or user ID, skipping watchlist fetch');
      return;
    }

    async function fetchWatchlists() {
      const cacheKey = `watchlists-${session.user.id}`;
      console.log('Fetching watchlists for user:', session.user.id, 'Cache key:', cacheKey);

      // Check cache only if forceFetch is false
      if (!forceFetch) {
        const cachedData = await getCachedData(cacheKey);
        if (cachedData && cachedData.length > 0) {
          console.log('Using cached watchlists:', cachedData);
          setWatchlists(cachedData);
          if (cachedData.length > 0) {
            const walletToSelect = cachedData.find((w) => w.address === initialAddress) || cachedData[0];
            console.log('Setting selected wallet from cache:', walletToSelect);
            setSelectedWallet(walletToSelect);
            setActiveChainType(walletToSelect?.chainType || 'EVM');
            const currentTab = searchParams.get('tab')?.toLowerCase() || initialTab.toLowerCase();
            if (currentTab !== activeTab.toLowerCase()) {
              updateUrl(activeTab.toLowerCase(), walletToSelect.address);
            }
          }
          return;
        }
      }

      setLoadingStates((prev) => ({ ...prev, loading: true }));
      try {
        console.log('Sending GET request to /api/watchlists', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : 'none',
          },
        });
        const response = await axios.get(`${API_BASE_URL}/api/watchlists`, {
          headers: {
            'Content-Type': 'application/json',
            ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
          },
          withCredentials: true,
        });
        console.log('Watchlists API Response:', response.data);
        if (response.data.success) {
          const watchlistsData = response.data.data.map((item) => ({
            address: item.wallet_address,
            name: item.name,
            chainType: isAddress(item.wallet_address) ? 'EVM' : isValidSolanaAddress(item.wallet_address) ? 'SVM' : 'EVM',
          }));
          await cacheData(cacheKey, watchlistsData);
          console.log('Watchlists cached:', watchlistsData);
          setWatchlists(watchlistsData);
          if (watchlistsData.length > 0) {
            const walletToSelect = watchlistsData.find((w) => w.address === initialAddress) || watchlistsData[0];
            console.log('Setting selected wallet from API:', walletToSelect);
            setSelectedWallet(walletToSelect);
            setActiveChainType(walletToSelect?.chainType || 'EVM');
            const currentTab = searchParams.get('tab')?.toLowerCase() || initialTab.toLowerCase();
            if (currentTab !== activeTab.toLowerCase()) {
              updateUrl(activeTab.toLowerCase(), walletToSelect.address);
            }
          }
        } else {
          setError('Failed to load watchlists.');
          toast.error('Failed to load watchlists.', { position: 'top-center', autoClose: 5000 });
        }
      } catch (err) {
        const errorMessage = err.response?.data?.detail || `Failed to load watchlists: ${err.message}`;
        console.error('Error fetching watchlists:', err, {
          status: err.response?.status,
          data: err.response?.data,
        });
        setError(errorMessage);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        setWatchlists([]);
      } finally {
        setLoadingStates((prev) => ({ ...prev, loading: false }));
        setForceFetch(false); // Reset forceFetch after fetching
      }
    }

    fetchWatchlists();
  }, [session, isValidSolanaAddress, initialAddress, activeTab, updateUrl, forceFetch]);

  // Add new wallet
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
      console.log('Adding wallet:', { address: newAddress, name: newWalletName, chainType: newChainType });
      const response = await axios.post(
        `${API_BASE_URL}/api/watchlists`,
        {
          action: 'add',
          wallet_address: isValidEVM ? newAddress.toLowerCase() : newAddress,
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
      console.log('Add wallet response:', response.data);
      if (response.data.success) {
        const updatedWatchlists = response.data.data.map((item) => ({
          address: item.wallet_address,
          name: item.name,
          chainType: isAddress(item.wallet_address) ? 'EVM' : isValidSolanaAddress(item.wallet_address) ? 'SVM' : 'EVM',
        }));
        console.log('Updating watchlists state:', updatedWatchlists);
        setWatchlists(updatedWatchlists);
        const cacheKey = `watchlists-${session.user.id}`;
        await cacheData(cacheKey, updatedWatchlists);
        console.log('Cache updated with new watchlists:', updatedWatchlists);
        const newWallet = updatedWatchlists.find((w) => w.address === (isValidEVM ? newAddress.toLowerCase() : newAddress)) || updatedWatchlists[0];
        console.log('Setting selected wallet after add:', newWallet);
        setSelectedWallet(newWallet);
        setActiveChainType(newWallet?.chainType || 'EVM');
        setShowAddModal(false);
        setNewAddress('');
        setNewWalletName('');
        setError(null);
        setForceFetch(true); // Trigger re-fetch to ensure cache consistency
        updateUrl(activeTab.toLowerCase(), newWallet?.address);
        toast.success('Wallet added successfully.', { position: 'top-center', autoClose: 5000 });
      } else {
        setError(response.data.detail || 'Failed to add wallet.');
        toast.error(response.data.detail || 'Failed to add wallet.', { position: 'top-center', autoClose: 5000 });
      }
    } catch (err) {
      const errorMessage = err.response?.data?.detail || `Failed to add wallet: ${err.message}`;
      console.error('Error adding wallet:', err, {
        status: err.response?.status,
        data: err.response?.data,
      });
      setError(errorMessage);
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    } finally {
      setLoadingStates((prev) => ({ ...prev, loading: false }));
    }
  };

  // Remove wallet
  const handleRemoveWallet = async (walletAddress) => {
    setLoadingStates((prev) => ({ ...prev, loading: true }));
    try {
      console.log('Removing wallet:', walletAddress);
      const response = await axios.post(
        `${API_BASE_URL}/api/watchlists`,
        { action: 'remove', wallet_address: walletAddress.toLowerCase() },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
          },
          withCredentials: true,
        }
      );
      console.log('Remove wallet response:', response.data);
      if (response.data.success) {
        const updatedWatchlists = response.data.data.map((item) => ({
          address: item.wallet_address,
          name: item.name,
          chainType: isAddress(item.wallet_address) ? 'EVM' : isValidSolanaAddress(item.wallet_address) ? 'SVM' : 'EVM',
        }));
        console.log('Updating watchlists state after remove:', updatedWatchlists);
        setWatchlists(updatedWatchlists);
        const cacheKey = `watchlists-${session.user.id}`;
        await cacheData(cacheKey, updatedWatchlists);
        console.log('Cache updated after remove:', updatedWatchlists);
        if (selectedWallet?.address === walletAddress) {
          const newWallet = updatedWatchlists[0] || null;
          console.log('Setting selected wallet after remove:', newWallet);
          setSelectedWallet(newWallet);
          setActiveChainType(newWallet?.chainType || 'EVM');
          setBalances([]);
          setCollectibles([]);
          setTransactions([]);
          setTokenInfo({});
          setActiveChain(null);
          setForceFetch(true); // Trigger re-fetch to ensure cache consistency
          updateUrl(activeTab.toLowerCase(), newWallet?.address || null);
        }
        setError(null);
        toast.success('Wallet removed successfully.', { position: 'top-center', autoClose: 5000 });
      } else {
        setError(response.data.detail || 'Failed to remove wallet.');
        toast.error(response.data.detail || 'Failed to remove wallet.', { position: 'top-center', autoClose: 5000 });
      }
    } catch (err) {
      const errorMessage = err.response?.data?.detail || `Failed to remove wallet: ${err.message}`;
      console.error('Error removing wallet:', err, {
        status: err.response?.status,
        data: err.response?.data,
      });
      setError(errorMessage);
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    } finally {
      setLoadingStates((prev) => ({ ...prev, loading: false }));
    }
  };

  const getPlatformImage = (chainValue) => {
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    const chain = chains.find((c) => c.value === chainName);
    const imageUrl = chain?.image || (chainName === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png');
    return imageUrl;
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
                width={isMobile ? 24 : 28}
                height={isMobile ? 24 : 28}
                className="rounded-full"
                style={{ width: 'auto', height: 'auto' }}
                onError={(e) => (e.target.src = '/icons/default.png')}
              />
              <Image
                src={getPlatformImage(token.chain)}
                alt={`${token.chain} logo`}
                width={isMobile ? 12 : 14}
                height={isMobile ? 12 : 14}
                className="rounded-full absolute top-0 right-0"
                style={{ transform: 'translate(25%, -25%)', width: 'auto', height: 'auto' }}
                onError={(e) => (e.target.src = '/icons/default.png')}
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

  const renderNFTRow = useMemo(() => (nft) => {
    const logoUrl =
      nft.token_metadata?.logo &&
        !nft.token_metadata.logo.includes('scontent.xx.fbcdn.net') &&
        nft.token_metadata.logo !== '/fallback-image.png'
        ? nft.token_metadata.logo
        : null;
    if (!logoUrl) {
      return null;
    }
    return (
      <motion.div
        key={`${nft.chain}-${nft.contract_address}-${nft.token_id}`}
        className="flex flex-col items-center p-2 sm:p-3 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 hover:bg-neon-blue/20 transition-all duration-300"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="relative w-full aspect-square">
          <Image
            src={logoUrl}
            alt={`${nft.name || 'Unknown'} logo`}
            objectFit="cover"
            width={isMobile ? 120 : 200}
            height={isMobile ? 120 : 200}
            className="rounded-lg"
            style={{ width: '100%', height: 'auto' }}
            onError={(e) => (e.target.src = '/icons/default.png')}
          />
          <Image
            src={getPlatformImage(nft.chain)}
            alt={`${nft.chain} logo`}
            width={isMobile ? 12 : 14}
            height={isMobile ? 12 : 14}
            className="rounded-full absolute top-1 right-1"
            style={{ width: 'auto', height: 'auto' }}
            onError={(e) => (e.target.src = '/icons/default.png')}
          />
        </div>
        <div className="mt-1 w-full text-center">
          <span className="text-[8px] sm:text-[10px] text-gray-200 font-medium">{nft.name || 'Unknown'}</span>
          <div className="text-[7px] sm:text-[9px] text-gray-400">ID: {nft.token_id}</div>
          <div className="text-[7px] sm:text-[9px] text-gray-400">Balance: {nft.balance || 1}</div>
        </div>
      </motion.div>
    );
  }, [isMobile]);

  const renderTransactionRow = (tx, index) => {
    const transactionKey = tx.hash || `tx-${index}`;
    const { txUrl, addressUrl } = getExplorerUrls(tx.chain, transactionKey, tx.from || tx.address);
    const isSVM = SUPPORTED_SVM_CHAINS.includes(tx.chain);
    const tokenLogo = isSVM
      ? NATIVE_TOKEN_INFO[tx.chain]?.logo || '/icons/default.png'
      : tx.token_metadata?.logo && !tx.token_metadata.logo.includes('scontent.xx.fbcdn.net')
        ? tx.token_metadata.logo
        : NATIVE_TOKEN_INFO[tx.chain]?.logo || '/icons/default.png';
    const tokenSymbol = tx.token || 'Unknown';
    const addressToShow = tx.type === 'receive' ? tx.from : tx.to;
    const { text: displayAddress, image: addressImage } = truncateAddress(addressToShow, nameTags);

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
                width={isMobile ? 24 : 28}
                height={isMobile ? 24 : 28}
                className="rounded-full"
                style={{ width: 'auto', height: 'auto' }}
                onError={(e) => (e.target.src = '/icons/default.png')}
              />
              <Image
                src={getPlatformImage(tx.chain)}
                alt={`${tx.chain} logo`}
                width={isMobile ? 12 : 14}
                height={isMobile ? 12 : 14}
                className="rounded-full absolute top-0 right-0"
                style={{ transform: 'translate(25%, -25%)', width: 'auto', height: 'auto' }}
                onError={(e) => (e.target.src = '/icons/default.png')}
              />
            </div>
            <span>{tokenSymbol}</span>
          </div>
        </td>
        <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
          <div className="flex flex-col items-center gap-1">
            <span
              className={`inline-flex px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] sm:text-[10px] font-medium ${tx.type === 'receive' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'
                }`}
            >
              {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
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
          {tx.value ? `${Number(tx.value).toLocaleString('en-US', { maximumFractionDigits: 6 })}` : 'N/A'}
        </td>
        <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-200 text-[10px] sm:text-xs text-center">
          <div className="flex flex-col items-center gap-0.5">
            <a href={txUrl} target="_blank" rel="noopener noreferrer">
              <Image
                src="/logos/etherscan-logo.png"
                alt="Etherscan"
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

  const filteredCollectibles = useMemo(() => {
    return collectibles
      .filter((nft) => {
        if (activeChain === null) return true;
        return nft.chain === activeChain;
      })
      .filter((nft) => {
        return (
          nft.token_metadata?.logo &&
          !nft.token_metadata.logo.includes('scontent.xx.fbcdn.net') &&
          nft.token_metadata.logo !== '/fallback-image.png'
        );
      });
  }, [collectibles, activeChain]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (activeChain === null) return true;
      return tx.chain === activeChain;
    });
  }, [transactions, activeChain]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className={`font-saira w-full max-w-9xl mx-auto mt-2 p-2 -max-h-[calc(100vh-6rem)] bg-black/60 backdrop-blur-2xl shadow-neon-lg ${isMobile ? '' : ''}`}
    >
      <ToastContainer position="top-center" autoClose={5000} theme="dark" />

      <div className="mb-2 sm:mb-3 border-b border-white/10 pb-2">
        <div className="flex items-center justify-between mb-2 sm:mb-3">
          <h3 className="text-[10px] sm:text-[12px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-2">
            Watchlist
          </h3>
          <div className="flex items-center justify-end gap-2 sm:gap-3 mt-8 sm:mt-2">
            <motion.select
              value={selectedWallet?.address || ''}
              onChange={(e) => {
                const wallet = watchlists.find((w) => w.address === e.target.value);
                console.log('Dropdown changed, selected wallet:', wallet);
                setSelectedWallet(wallet || null);
                setBalances([]);
                setCollectibles([]);
                setTransactions([]);
                setTokenInfo({});
                setActiveChain(null);
                setActiveChainType(wallet?.chainType || 'EVM');
                setCurrentPage({ TOKEN: 1, NFT: 1, ACTIVITY: 1 });
                updateUrl(activeTab.toLowerCase(), wallet?.address || null);
              }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 sm:py-1.5 border-2 border-white/10 rounded-xl bg-black/60 backdrop-blur-md text-white focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/30 transition-all duration-300 w-1/2 sm:w-auto"
            >
              {watchlists.length === 0 ? (
                <option value="">No wallets added</option>
              ) : (
                watchlists.map((wallet) => (
                  <option key={wallet.address} value={wallet.address}>
                    {wallet.name} ({truncateAddress(wallet.address, nameTags).text})
                  </option>
                ))
              )}
            </motion.select>
            <motion.button
              onClick={() => setShowAddModal(true)}
              whileHover={{ scale: 1 }}
              whileTap={{ scale: 0.95 }}
              className="px-2 sm:px-3 py-1.5 sm:py-1.5 text-[10px] sm:text-xs font-medium text-black border border-white/10 rounded-xl bg-white backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
            >
              Add +
            </motion.button>
            {selectedWallet && (
              <motion.button
                onClick={() => handleRemoveWallet(selectedWallet.address)}
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className="px-2 sm:px-3 py-1.5 sm:py-1.5 text-[10px] sm:text-xs font-medium text-red-500/80 border border-red-500/80 rounded-xl backdrop-blur-md hover:bg-red-500/30 transition-all duration-300"
              >
                Remove
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {chainsWithAssets.length > 0 && (
        <div className="flex flex-wrap gap-1 sm:gap-2 mb-2 sm:mb-4">
          <Tooltip text="All Chains">
            <motion.button
              onClick={() => setActiveChain(null)}
              whileHover={{ scale: 1 }}
              whileTap={{ scale: 0.95 }}
              className={`px-2 sm:px-3 py-1.5 sm:py-1.5 border rounded-sm transition-all duration-300 text-[10px] sm:text-xs font-medium text-white ${activeChain === null
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
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className={`p-1 sm:p-1.5 border rounded-sm transition-all duration-300 ${activeChain === chain
                  ? 'border-neon-blue bg-neon-blue/20 shadow-neon'
                  : 'border-white/10 bg-black/60 backdrop-blur-md hover:bg-neon-blue/30'
                  }`}
              >
                <Image
                  src={getPlatformImage(chain)}
                  alt={chain}
                  width={isMobile ? 20 : 24}
                  height={isMobile ? 20 : 24}
                  className="rounded-sm object-contain"
                  style={{ width: 'auto', height: 'auto' }}
                  onError={(e) => (e.target.src = chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
                />
              </motion.button>
            </Tooltip>
          ))}
        </div>
      )}

      <div className="flex w-full border-b border-white/10 mb-2 sm:mb-4 bg-black/60 backdrop-blur-md rounded-xl">
        {['TOKEN', 'NFT', 'ACTIVITY'].map((tab) => (
          <motion.button
            key={tab}
            onClick={() => handleTabClick(tab)}
            whileHover={{ scale: 1 }}
            whileTap={{ scale: 0.95 }}
            className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition-all duration-300 ${activeTab === tab ? 'border-b-2 border-white text-white' : 'text-white'
              } last:border-r-0`}
          >
            {tab}
          </motion.button>
        ))}
      </div>

      {selectedWallet && (
        <div className="flex justify-end bg-black/60 backdrop-blur-md mb-2">
          {activeTab === 'TOKEN' && filteredBalances.length > itemsPerPage && (
            <div className="flex items-center gap-2 sm:gap-4">
              <motion.button
                onClick={() => handlePageChange('TOKEN', currentPage.TOKEN - 1)}
                disabled={currentPage.TOKEN === 1}
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-black/60 backdrop-blur-md ${currentPage.TOKEN === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/30'
                  } transition-all duration-300 rounded`}
              >
                &lt;
              </motion.button>
              <span className="text-[10px] sm:text-xs text-gray-200 self-center">
                {currentPage.TOKEN} / {getTotalPages(filteredBalances)}
              </span>
              <motion.button
                onClick={() => handlePageChange('TOKEN', currentPage.TOKEN + 1)}
                disabled={currentPage.TOKEN === getTotalPages(filteredBalances)}
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-black/60 backdrop-blur-md ${currentPage.TOKEN === getTotalPages(filteredBalances) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/30'
                  } transition-all duration-300 rounded`}
              >
                &gt;
              </motion.button>
            </div>
          )}
          {activeTab === 'NFT' && filteredCollectibles.length > itemsPerPage && (
            <div className="flex items-center gap-2 sm:gap-4">
              <motion.button
                onClick={() => handlePageChange('NFT', currentPage.NFT - 1)}
                disabled={currentPage.NFT === 1}
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-black/60 backdrop-blur-md ${currentPage.NFT === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/30'
                  } transition-all duration-300 rounded`}
              >
                &lt;
              </motion.button>
              <span className="text-[10px] sm:text-xs text-gray-200 self-center">
                Page {currentPage.NFT} of {getTotalPages(filteredCollectibles)}
              </span>
              <motion.button
                onClick={() => handlePageChange('NFT', currentPage.NFT + 1)}
                disabled={currentPage.NFT === getTotalPages(filteredCollectibles)}
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-black/60 backdrop-blur-md ${currentPage.NFT === getTotalPages(filteredCollectibles) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/30'
                  } transition-all duration-300 rounded`}
              >
                &gt;
              </motion.button>
            </div>
          )}
          {activeTab === 'ACTIVITY' && filteredTransactions.length > itemsPerPage && (
            <div className="flex items-center gap-2 sm:gap-4">
              <motion.button
                onClick={() => handlePageChange('ACTIVITY', currentPage.ACTIVITY - 1)}
                disabled={currentPage.ACTIVITY === 1}
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-black/60 backdrop-blur-md ${currentPage.ACTIVITY === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/30'
                  } transition-all duration-300 rounded`}
              >
                &lt;
              </motion.button>
              <span className="text-[10px] sm:text-xs text-gray-200 self-center">
                Page {currentPage.ACTIVITY} of {getTotalPages(filteredTransactions)}
              </span>
              <motion.button
                onClick={() => handlePageChange('ACTIVITY', currentPage.ACTIVITY + 1)}
                disabled={currentPage.ACTIVITY === getTotalPages(filteredTransactions)}
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.95 }}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-black/60 backdrop-blur-md ${currentPage.ACTIVITY === getTotalPages(filteredTransactions) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-blue/30'
                  } transition-all duration-300 rounded`}
              >
                &gt;
              </motion.button>
            </div>
          )}
        </div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-[10px] sm:text-xs text-red-500 text-center p-2 sm:p-4 bg-red-500/10 border border-red-500/20 rounded-lg"
        >
          Error: {error}
        </motion.div>
      )}

      <div className="flex flex-col h-full">
        <div
          className="relative flex-1 overflow-y-auto custom-scrollbar border border-white/10 rounded-lg bg-black/60 backdrop-blur-2xl shadow-neon-sm"
          style={{ maxHeight: isMobile ? 'calc(100vh - 18rem)' : 'calc(100vh - 18rem)', minHeight: isMobile ? 'calc(100vh - 18rem)' : 'calc(100vh - 18rem)' }}
        >
          <LoadingOverlay isLoading={loadingStates.loading || (activeTab === 'TOKEN' && (loadingStates.balances || loadingStates.tokenInfo))} isMobile={isMobile} />
          <LoadingOverlay isLoading={loadingStates.collectibles && activeTab === 'NFT'} isMobile={isMobile} />
          <LoadingOverlay isLoading={loadingStates.transactions && activeTab === 'ACTIVITY'} isMobile={isMobile} />
          <div className="min-h-[calc(100vh-18rem)]">
            {loadingStates.loading || loadingStates.balances || loadingStates.collectibles || loadingStates.transactions || loadingStates.tokenInfo ? (
              <SkeletonLoader isMobile={isMobile} />
            ) : selectedWallet ? (
              <div className="relative overflow-x-auto">
                {activeTab === 'TOKEN' && (
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
                        <tbody>{getPaginatedData(filteredBalances, 'TOKEN').map(renderTokenRow)}</tbody>
                      </table>
                    ) : (
                      <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4 min-h-[calc(100vh-18rem)] flex items-center justify-center">
                        No balances found for this wallet.
                      </p>
                    )}
                  </>
                )}
                {activeTab === 'NFT' && (
                  <>
                    {filteredCollectibles.length > 0 ? (
                      <div
                        className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3'} p-2 sm:p-3`}
                      >
                        {getPaginatedData(filteredCollectibles, 'NFT').map(renderNFTRow)}
                      </div>
                    ) : (
                      <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4 min-h-[calc(100vh-18rem)] flex items-center justify-center">
                        No NFTs found for this wallet.
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
                      <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4 min-h-[calc(100vh-18rem)] flex items-center justify-center">
                        No transactions found for this wallet.
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4 min-h-[calc(100vh-18rem)] flex items-center justify-center">
                Please select a wallet to view data.
              </div>
            )}
          </div>
        </div>
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
                          width={isMobile ? 18 : 22}
                          height={isMobile ? 18 : 22}
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
    /* Ensure tables are responsive */
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
      .grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.5rem;
      }
    }
    @media (min-width: 641px) and (max-width: 1024px) {
      .grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.75rem;
      }
    }
  `}</style>
    </motion.div>
  );
}