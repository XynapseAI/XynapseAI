import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { isAddress } from 'ethers';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { SUPPORTED_CHAINS, CHAIN_MAPPING, CHAIN_ID_TO_NAME, CHAIN_EXPLORER_MAP } from '../utils/constants';
import { formatDistanceToNow } from 'date-fns';

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
  const nameTag = nameTags[normalizedAddress]?.nameTag;
  const image = nameTags[normalizedAddress]?.image || null;
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

// Native token mappings (unchanged)
const NATIVE_TOKEN_INFO = {
  ethereum: { name: 'Ethereum', symbol: 'ETH', logo: '/ethereum-logo.png' },
  base: { name: 'Base', symbol: 'ETH', logo: '/base-logo.png' },
  bnb: { name: 'BNB', symbol: 'BNB', logo: '/bnb-logo.png' },
  solana: { name: 'Solana', symbol: 'SOL', logo: '/solana-logo.png' },
  eclipse: { name: 'Eclipse', symbol: 'ECL', logo: '/eclipse-logo.png' },
};

// Skeleton Loader Component
const SkeletonLoader = ({ isMobile }) => {
  const skeletonRows = Array(5).fill(null);
  return (
    <div className="w-full p-2 sm:p-4">
      <table className="w-full table-fixed text-[10px] sm:text-xs">
        <tbody>
          {skeletonRows.map((_, index) => (
            <tr key={index} className="border-t border-white/10">
              <td className={`px-2 py-2 ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-5 sm:w-6 h-5 sm:h-6 bg-gray-700/50 rounded-full animate-pulse"></div>
                  <div className="w-10 sm:w-12 h-2 bg-gray-700/50 rounded animate-pulse"></div>
                </div>
              </td>
              <td className={`px-2 py-2 ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                <div className="flex items-center gap-2">
                  <div className="w-5 sm:w-6 h-5 sm:h-6 bg-gray-700/50 rounded-full animate-pulse"></div>
                  <div className="w-16 sm:w-20 h-3 bg-gray-700/50 rounded animate-pulse"></div>
                </div>
              </td>
              <td className={`px-2 py-2 ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                <div className="w-12 sm:w-16 h-3 bg-gray-700/50 rounded animate-pulse"></div>
              </td>
              <td className={`px-2 py-2 ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                <div className="w-20 sm:w-24 h-3 bg-gray-700/50 rounded animate-pulse"></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Tooltip Component with Glassmorphism
const Tooltip = ({ children, text }) => (
  <div className="relative group">
    {children}
    <div className="absolute hidden group-hover:block bg-black/80 backdrop-blur-lg border border-white/10 text-gray-200 text-[8px] sm:text-[10px] py-1 sm:py-2 px-2 sm:px-3 rounded-lg shadow-neon z-20 -top-8 sm:-top-10 left-1/2 -translate-x-1/2 whitespace-nowrap font-jetbrains transition-all duration-300">
      {text}
    </div>
  </div>
);

export default function WatchlistsTab({ toast }) {
  const { data: session } = useSession();
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
  const [activeTab, setActiveTab] = useState('Tokens');
  const [balances, setBalances] = useState([]);
  const [collectibles, setCollectibles] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [tokenInfo, setTokenInfo] = useState({});
  const [chainsWithAssets, setChainsWithAssets] = useState([]);
  const [nameTags] = useState({});
  const [chains, setChains] = useState([]);
  const [newWalletName, setNewWalletName] = useState('');

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
  const SUPPORTED_SVM_CHAINS = ['solana', 'eclipse'];
  const EVM_LOGOS = ['ethereum', 'base', 'bnb'];
  const SVM_LOGOS = ['solana', 'eclipse'];

  // Fetch supported chains (unchanged)
  const fetchSupportedChains = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/coingecko/chains`, {
        timeout: 15000,
      });

      const coingeckoChains = response.data.success ? response.data.data : [];
      const mappedChains = SUPPORTED_CHAINS.map((simChain) => {
        const coingeckoChain = coingeckoChains.find(
          (cg) => CHAIN_MAPPING[cg.id]?.simChain === simChain.value
        );
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
    } catch (error) {
      console.error('Failed to fetch supported chains:', error);
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
          image: chain.image || '/icons/default.png',
        }))
      );
      toast.error('Failed to load supported chains', { position: 'top-center', autoClose: 5000 });
    }
  }, [toast]);

  // Handle window resize (unchanged)
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch chains on mount (unchanged)
  useEffect(() => {
    fetchSupportedChains();
  }, [fetchSupportedChains]);

  const isValidSolanaAddress = useCallback((address) => {
    return address && address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
  }, []);

  // Fetch data (unchanged)
  const fetchData = useCallback(
    async (action) => {
      if (!selectedWallet) {
        const errorMsg = 'No wallet selected.';
        setError(errorMsg);
        toast.error(errorMsg, { position: 'top-center', autoClose: 5000 });
        return;
      }
      setLoadingStates((prev) => ({ ...prev, [action]: true }));
      setError(null);
      try {
        const isValidEVM = isAddress(selectedWallet.address);
        const isValidSVM = isValidSolanaAddress(selectedWallet.address);
        if (!isValidEVM && !isValidSVM) {
          throw new Error('Invalid wallet address format.');
        }

        const payload = {
          action,
          address: selectedWallet.address,
          ...(isValidEVM ? { chain_ids: '1,137,10,42161,8453' } : { chains: SUPPORTED_SVM_CHAINS.join(',') }),
          limit: 500,
        };

        const response = await axios.post(`${API_BASE_URL}/sim`, payload, {
          headers: {
            'Content-Type': 'application/json',
            ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
          },
          withCredentials: true,
          timeout: 30000,
        });

        if (!response.data.success) {
          throw new Error(response.data.detail || `Failed to load ${action} data.`);
        }

        if (action === 'wallet-balances') {
          const balancesData = response.data.data || [];
          setBalances(balancesData);
          const chainsWithData = [...new Set(balancesData.map((b) => CHAIN_ID_TO_NAME[b.chain] || b.chain))];
          setChainsWithAssets(chainsWithData);
          if (!activeChain && chainsWithData.length > 0) setActiveChain(chainsWithData[0]);
        } else if (action === 'collectibles') {
          const collectiblesData = response.data.data || [];
          setCollectibles(collectiblesData);
        } else if (action === 'transactions') {
          const transactionsData = response.data.data.map((tx) => ({
            ...tx,
            chain: CHAIN_ID_TO_NAME[tx.chain] || tx.chain,
          })) || [];
          setTransactions(transactionsData);
        }
      } catch (err) {
        const errorMessage =
          err.response?.status === 401
            ? 'Unauthorized: Please log in again.'
            : err.response?.status === 429
              ? 'Too many requests. Please try again later.'
              : err.response?.data?.detail || `Failed to load ${action} data: ${err.message}`;
        setError(errorMessage);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        if (action === 'wallet-balances') setBalances([]);
        else if (action === 'collectibles') setCollectibles([]);
        else if (action === 'transactions') setTransactions([]);
      } finally {
        setLoadingStates((prev) => ({ ...prev, [action]: false }));
      }
    },
    [selectedWallet, session, isValidSolanaAddress, activeChain, toast]
  );

  // Fetch token info (unchanged)
  useEffect(() => {
    if (!selectedWallet || balances.length === 0) return;
    async function fetchTokenInfo() {
      setLoadingStates((prev) => ({ ...prev, loading: true }));
      try {
        const tokenAddresses = balances
          .filter((b) => b.address !== 'native')
          .map((b) => ({ address: b.address, chain: b.chain }))
          .slice(0, 10);
        const tokenInfoData = {};
        for (const { address, chain } of tokenAddresses) {
          const isValidEVM = isAddress(address);
          const isValidSVM = isValidSolanaAddress(address);
          if (!isValidEVM && !isValidSVM) {
            continue;
          }
          try {
            const payload = {
              action: 'wallet-balances',
              address,
              ...(isValidEVM ? { chain_ids: CHAIN_MAPPING[chain]?.chainId || '' } : { chains: SUPPORTED_SVM_CHAINS.join(',') }),
              limit: 1,
              metadata: 'logo',
            };
            const response = await axios.post(`${API_BASE_URL}/sim`, payload, {
              headers: {
                'Content-Type': 'application/json',
                ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
              },
              timeout: 10000,
            });
            if (response.data.success && response.data.data.length > 0) {
              const tokenData = response.data.data[0];
              tokenInfoData[address] = [
                {
                  chain,
                  symbol: tokenData.symbol || 'Unknown',
                  logo: tokenData.logo || '/fallback-image.png',
                  name: tokenData.name || 'Unknown Token',
                },
              ];
            }
          } catch (err) {
            console.error(`Error fetching token info for ${address} on ${chain}:`, err);
          }
        }
        setTokenInfo(tokenInfoData);
      } catch (err) {
        const errorMessage = err.response?.data?.detail || `Failed to load token info: ${err.message}`;
        setError(errorMessage);
        toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
      } finally {
        setLoadingStates((prev) => ({ ...prev, loading: false }));
      }
    }
    fetchTokenInfo();
  }, [balances, session, toast, isValidSolanaAddress]);

  // Load watchlists (unchanged)
  useEffect(() => {
    if (!session?.user?.id) return;
    async function fetchWatchlists() {
      setLoadingStates((prev) => ({ ...prev, loading: true }));
      try {
        const response = await axios.get(`${API_BASE_URL}/watchlists`, {
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
          setWatchlists(watchlistsData);
          if (watchlistsData.length > 0) {
            setSelectedWallet(watchlistsData[0]);
            setActiveChainType(watchlistsData[0].chainType);
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
      }
    }
    fetchWatchlists();
  }, [session, toast, isValidSolanaAddress]);

  // Fetch balances, collectibles, and transactions (unchanged)
  useEffect(() => {
    if (!selectedWallet) return;
    fetchData('wallet-balances');
    fetchData('collectibles');
    fetchData('transactions');
  }, [selectedWallet, fetchData]);

  // Add new wallet (unchanged)
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
    try {
      const response = await axios.post(
        `${API_BASE_URL}/watchlists`,
        {
          action: 'add',
          wallet_address: isValidEVM ? newAddress.toLowerCase() : newAddress,
          name: newWalletName || 'Unnamed Wallet'
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
          chainType: isValidEVM ? 'EVM' : 'SVM',
        }));
        setWatchlists(updatedWatchlists);
        setSelectedWallet({
          address: isValidEVM ? newAddress.toLowerCase() : newAddress,
          name: newWalletName || 'Unnamed Wallet',
          chainType: newChainType
        });
        setActiveChainType(newChainType);
        setShowAddModal(false);
        setNewAddress('');
        setNewWalletName('');
        setError(null);
        toast.success('Wallet added successfully.', { position: 'top-center', autoClose: 5000 });
      } else {
        setError(response.data.detail || 'Failed to add wallet.');
        toast.error(response.data.detail || 'Failed to add wallet.', { position: 'top-center', autoClose: 5000 });
      }
    } catch (err) {
      const errorMessage = err.response?.data?.detail || `Failed to add wallet: ${err.message}`;
      setError(errorMessage);
      toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
    }
  };

  // Remove wallet (unchanged)
  const handleRemoveWallet = async (walletAddress) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/watchlists`,
        { action: 'remove', wallet_address: walletAddress.toLowerCase() },
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
        if (selectedWallet?.address === walletAddress) {
          setSelectedWallet(updatedWatchlists[0] || null);
          setActiveChainType(updatedWatchlists[0]?.chainType || 'EVM');
          setBalances([]);
          setCollectibles([]);
          setTransactions([]);
          setTokenInfo({});
          setActiveChain(null);
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
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
          <div className="flex flex-col items-center gap-1">
            <Image
              src={getPlatformImage(token.chain)}
              alt={`${token.chain} logo`}
              width={isMobile ? 12 : 12}
              height={isMobile ? 12 : 12}
              className="rounded-full"
              onError={(e) => (e.target.src = '/icons/default.png')}
            />
            <span className="text-[8px] sm:text-[10px] text-gray-400">
              {chains.find((c) => c.value === (CHAIN_ID_TO_NAME[token.chain] || token.chain))?.label || token.chain}
            </span>
          </div>
        </td>
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
          <div className="flex items-center gap-2">
            <Image
              src={logoUrl}
              alt={`${tokenSymbol} logo`}
              width={isMobile ? 16 : 20}
              height={isMobile ? 16 : 20}
              className="rounded-full"
              onError={(e) => (e.target.src = '/icons/default.png')}
            />
            <div className="flex flex-col">
              <span>{tokenSymbol}</span>
              {token.price_usd != null && (
                <span className="text-[7px] sm:text-[10px] text-gray-400">{formatPrice(token.price_usd)}</span>
              )}
            </div>
          </div>
        </td>
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
          {formatBalance(token.amount)}
        </td>
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
          {token.value_usd != null
            ? `$${token.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
            : 'N/A'}
        </td>
      </motion.tr>
    );
  };

  const renderNFTRow = useMemo(
    () => (nft) => {
      const logoUrl = nft.token_metadata?.logo && !nft.token_metadata.logo.includes('scontent.xx.fbcdn.net') && nft.token_metadata.logo !== '/fallback-image.png'
        ? nft.token_metadata.logo
        : null;
      if (!logoUrl) {
        return null;
      }
      return (
        <motion.tr
          key={`${nft.chain}-${nft.contract_address}-${nft.token_id}`}
          className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
            <div className="flex flex-col items-center gap-1">
              <Image
                src={getPlatformImage(nft.chain)}
                alt={`${nft.chain} logo`}
                width={isMobile ? 20 : 24}
                height={isMobile ? 20 : 24}
                className="rounded-full"
                onError={(e) => (e.target.src = '/icons/default.png')}
              />
              <span className="text-[8px] sm:text-[10px] text-gray-400">
                {chains.find((c) => c.value === (CHAIN_ID_TO_NAME[nft.chain] || nft.chain))?.label || nft.chain}
              </span>
            </div>
          </td>
          <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
            <div className="flex items-center gap-2">
              <Image
                src={logoUrl}
                alt={`${nft.name || 'Unknown'} logo`}
                width={isMobile ? 16 : 20}
                height={isMobile ? 16 : 20}
                className="rounded-full"
                onError={(e) => (e.target.src = '/icons/default.png')}
              />
              <div className="flex flex-col">
                <span>{nft.name || 'Unknown'}</span>
                <span className="text-[8px] sm:text-[10px] text-gray-400">ID: {nft.token_id}</span>
              </div>
            </div>
          </td>
          <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
            {nft.balance || 1}
          </td>
          <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
            {nft.value_usd != null
              ? `$${nft.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
              : 'N/A'}
          </td>
        </motion.tr>
      );
    },
    [chains, isMobile]
  );

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
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
          <div className="flex flex-col items-center gap-1">
            <Image
              src={getPlatformImage(tx.chain)}
              alt={`${tx.chain} logo`}
              width={isMobile ? 12 : 12}
              height={isMobile ? 12 : 12}
              className="rounded-full"
              onError={(e) => (e.target.src = '/icons/default.png')}
            />
            <span className="text-[8px] sm:text-[10px] text-gray-400">
              {chains.find((c) => c.value === (CHAIN_ID_TO_NAME[tx.chain] || tx.chain))?.label || tx.chain}
            </span>
          </div>
        </td>
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
          <div className="flex items-center gap-2">
            <Image
              src={tokenLogo}
              alt={`${tokenSymbol} logo`}
              width={isMobile ? 16 : 20}
              height={isMobile ? 16 : 20}
              className="rounded-full"
              onError={(e) => (e.target.src = '/icons/default.png')}
            />
            <span>{tokenSymbol}</span>
          </div>
        </td>
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
          <div className="flex flex-col items-center gap-1">
            <span
              className={`inline-flex px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] sm:text-[10px] font-medium ${tx.type === 'receive' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'
                }`}
            >
              {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
            </span>
            <div className="flex items-center gap-2">
              {addressImage && (
                <Image
                  src={addressImage}
                  alt={`${displayAddress} logo`}
                  width={isMobile ? 12 : 16}
                  height={isMobile ? 12 : 16}
                  className="rounded-full"
                  onError={(e) => (e.target.src = '/icons/default.png')}
                />
              )}
              <a
                href={addressUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neon-blue hover:underline"
                title={addressToShow}
              >
                {displayAddress}
              </a>
            </div>
          </div>
        </td>
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
          {tx.value
            ? `${Number(tx.value).toLocaleString('en-US', { maximumFractionDigits: 6 })}`
            : 'N/A'}
        </td>
        <td className={`px-2 py-2 text-gray-200 text-[10px] sm:text-xs text-center ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
          <div className="flex flex-col items-center gap-0.5">
            <a href={txUrl} target="_blank" rel="noopener noreferrer">
              <Image
                src="/logos/etherscan-logo.png"
                alt="Etherscan"
                width={isMobile ? 12 : 16}
                height={isMobile ? 12 : 16}
                className="rounded-full"
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className={`font-jetbrains w-full max-w-9xl mx-auto mt-4 p-2 sm:p-4 h-[calc(100vh)] rounded-xl border border-white/10 bg-black/60 backdrop-blur-2xl shadow-neon-lg ${isMobile ? 'pb-8 overflow-y-auto' : ''}`}
    >
      <ToastContainer position="top-center" autoClose={5000} theme="dark" />

      {/* Header Section */}
      <div className="mb-2 sm:mb-3 border-b border-white/10 pb-2">
        <div className="flex items-center justify-between mb-2 sm:mb-3">
          <h3 className="text-[10px] sm:text-[12px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/30 to-transparent p-2">
            Watchlist
          </h3>
        </div>
        <div className="flex items-center justify-end gap-2 sm:gap-3">
          <motion.select
            value={selectedWallet?.address || ''}
            onChange={(e) => {
              const wallet = watchlists.find((w) => w.address === e.target.value);
              setSelectedWallet(wallet || null);
              setBalances([]);
              setCollectibles([]);
              setTransactions([]);
              setTokenInfo({});
              setActiveChain(null);
              setActiveChainType(wallet?.chainType || 'EVM');
            }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 sm:py-1.5 border border-white/10 bg-black/60 backdrop-blur-md text-white focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/30 transition-all duration-300 w-1/2 sm:w-auto"
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
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-2 sm:px-3 py-1.5 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-gradient-to-r from-neon-blue/30 to-transparent backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
          >
            Add +
          </motion.button>
          {selectedWallet && (
            <motion.button
              onClick={() => handleRemoveWallet(selectedWallet.address)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-2 sm:px-3 py-1.5 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-red-500/50 bg-gradient-to-r from-red-500/20 to-transparent backdrop-blur-md hover:bg-red-500/30 transition-all duration-300"
            >
              Remove
            </motion.button>
          )}
        </div>
      </div>

      {/* Chain Selection */}
      {chainsWithAssets.length > 0 && (
        <div className="flex flex-wrap gap-1 sm:gap-2 mb-2 sm:mb-4">
          {chainsWithAssets.map((chain) => (
            <Tooltip key={chain} text={chain.charAt(0).toUpperCase() + chain.slice(1)}>
              <motion.button
                onClick={() => setActiveChain(chain)}
                whileHover={{ scale: 1.1 }}
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
                  onError={(e) => (e.target.src = chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
                />
              </motion.button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex w-full border-b border-white/10 mb-2 sm:mb-4 bg-black/60 backdrop-blur-md rounded-lg">
        {['Tokens', 'NFTs', 'Activity'].map((tab) => (
          <motion.button
            key={tab}
            onClick={() => setActiveTab(tab)}
            whileHover={{ scale: 1 }}
            whileTap={{ scale: 0.95 }}
            className={`flex-1 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition-all duration-300 border-r border-white/10 bg-gradient-to-r from-neon-blue/30 to-transparent ${activeTab === tab ? 'bg-white text-black shadow-neon' : 'text-white hover:bg-neon-blue/30'
              } last:border-r-0`}
          >
            {tab}
          </motion.button>
        ))}
      </div>

      {/* Error Display */}
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

      {/* Data Table */}
      <div
        className="flex-1 overflow-y-auto custom-scrollbar border border-white/10 rounded-lg bg-black/60 backdrop-blur-2xl shadow-neon-sm"
        style={{ maxHeight: isMobile ? 'calc(100vh - 14rem)' : 'calc(100vh - 10rem)' }}
      >
        {loadingStates.loading || loadingStates.balances || loadingStates.collectibles || loadingStates.transactions ? (
          <SkeletonLoader isMobile={isMobile} />
        ) : selectedWallet ? (
          <div className="relative overflow-x-auto">
            {activeTab === 'Tokens' && (
              <>
                {balances.length > 0 ? (
                  <table className="w-full table-fixed text-[10px] sm:text-xs">
                    <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur-md">
                      <tr>
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-center font-medium ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
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
                            Chain
                          </div>
                        </th>
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center gap-2">
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
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
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
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M7 12l3-3 3 3 5-5m0 0h-5m5 0v5"
                              />
                            </svg>
                            Value
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {balances
                        .filter((b) => {
                          if (!activeChain || b.chain === activeChain) {
                            const tokenInfoData = tokenInfo[b.address] || [];
                            const tokenDetails = tokenInfoData.find((t) => t.chain === b.chain) || {};
                            const isNative = b.address === 'native' && NATIVE_TOKEN_INFO[b.chain];
                            const hasValidLogo =
                              isNative ||
                              (b.logo && !b.logo.includes('scontent.xx.fbcdn.net') && b.logo !== '/fallback-image.png') ||
                              (tokenDetails.logo && !tokenDetails.logo.includes('scontent.xx.fbcdn.net') && tokenDetails.logo !== '/fallback-image.png');
                            return hasValidLogo;
                          }
                          return false;
                        })
                        .map(renderTokenRow)}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
                    No balances found for this wallet.
                  </p>
                )}
              </>
            )}
            {activeTab === 'NFTs' && (
              <>
                {collectibles.length > 0 && collectibles.some((nft) => (!activeChain || nft.chain === activeChain) && nft.token_metadata?.logo && !nft.token_metadata.logo.includes('scontent.xx.fbcdn.net') && nft.token_metadata.logo !== '/fallback-image.png') ? (
                  <table className="w-full table-fixed text-[10px] sm:text-xs">
                    <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur-md">
                      <tr>
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-center font-medium ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
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
                            Chain
                          </div>
                        </th>
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center gap-2">
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
                            Name
                          </div>
                        </th>
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
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
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M7 12l3-3 3 3 5-5m0 0h-5m5 0v5"
                              />
                            </svg>
                            Value
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {collectibles
                        .filter((nft) => {
                          if (!activeChain || nft.chain === activeChain) {
                            return nft.token_metadata?.logo && !nft.token_metadata.logo.includes('scontent.xx.fbcdn.net') && nft.token_metadata.logo !== '/fallback-image.png';
                          }
                          return false;
                        })
                        .map(renderNFTRow)}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
                    No NFTs found for this wallet.
                  </p>
                )}
              </>
            )}
            {activeTab === 'Activity' && (
              <>
                {transactions.length > 0 && transactions.some((tx) => !activeChain || tx.chain === activeChain) ? (
                  <table className="w-full table-fixed text-[10px] sm:text-xs">
                    <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur-md">
                      <tr>
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-center font-medium ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
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
                            Chain
                          </div>
                        </th>
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center gap-2">
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
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
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
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-left font-medium ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center gap-2">
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
                        <th className={`px-2 sm:px-3 py-1 sm:py-2 text-white text-center font-medium ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
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
                    <tbody>
                      {transactions
                        .filter((tx) => !activeChain || tx.chain === activeChain)
                        .map(renderTransactionRow)}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
                    No transactions found for this wallet.
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="text-[10px] sm:text-xs text-gray-400 text-center p-2 sm:p-4">
            Please select a wallet to view data.
          </div>
        )}
      </div>

      {/* Add Wallet Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            className="fixed inset-0 flex items-center justify-center z-50 bg-black/80 backdrop-blur-2xl font-jetbrains"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              className="p-4 sm:p-6 max-w-[90%] sm:max-w-md w-full border border-white/10 rounded-xl bg-black/60 backdrop-blur-2xl shadow-neon-lg"
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <motion.button
                onClick={() => {
                  setShowAddModal(false);
                  setNewWalletName('');
                }}
                className="absolute top-4 right-4 text-white text-lg font-bold rounded-full w-10 h-10 flex items-center justify-center bg-black/60 border border-white/10 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
                aria-label="Close modal"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
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
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                Add Wallet to Watchlist
              </h4>
              <div className="mb-4">
                <label className="text-[10px] sm:text-xs text-gray-200 uppercase tracking-wider mb-1 block">
                  NAME
                </label>
                <input
                  type="text"
                  value={newWalletName}
                  onChange={(e) => setNewWalletName(e.target.value)}
                  placeholder="Enter wallet name (optional)"
                  className="w-full text-[9px] sm:text-[10px] px-3 sm:px-4 py-1 sm:py-1.5 mb-3 border border-white/10 bg-black/60 backdrop-blur-md text-white focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/30 transition-all duration-300"
                />
                <label className="text-[10px] sm:text-xs text-gray-200 uppercase tracking-wider mb-1 block">
                  WALLET
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder={`Enter wallet address (${newChainType === 'EVM' ? 'EVM' : 'Solana/Eclipse'})`}
                  className="w-full text-[9px] sm:text-[10px] px-3 sm:px-4 py-1 sm:py-1.5 border border-white/10 bg-black/60 backdrop-blur-md text-white focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/30 transition-all duration-300"
                />
              </div>
              <div className="flex w-full border-b border-white/10 mb-4 bg-black/60 backdrop-blur-md">
                {['EVM', 'SVM'].map((type) => (
                  <motion.button
                    key={type}
                    onClick={() => setNewChainType(type)}
                    whileHover={{ scale: 1 }}
                    whileTap={{ scale: 1 }}
                    className={`flex-1 flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 text-[10px] sm:text-xs font-medium transition-all duration-300 border-r border-white/10 bg-gradient-to-r from-neon-blue/30 to-transparent ${newChainType === type ? 'bg-gray-400 text-black shadow-neon' : 'text-white hover:bg-neon-blue/30'
                      } last:border-r-0`}
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
                          style={{ marginLeft: index > 0 ? '-9px' : '0', zIndex: 10 - index }}
                          onError={(e) => (e.target.src = '/icons/default.png')}
                        />
                      ))}
                      <div className="flex items-center justify-center w-4 sm:w-5 h-4 sm:h-5 bg-neon-blue/50 rounded-full text-white text-[8px] sm:text-[10px] mr-6">
                        +
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
              <div className="flex justify-end gap-2 sm:gap-3 mt-4">
                <motion.button
                  onClick={handleAddWallet}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white border border-white/10 bg-gradient-to-r from-neon-blue/30 to-transparent rounded-xs backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
                >
                  ADD WALLET
                </motion.button>
              </div>
              {error && <p className="text-[10px] sm:text-xs text-red-400 mt-3 bg-red-500/10 p-2 rounded">Error: {error}</p>}
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
`}</style>
    </motion.div>
  );
}