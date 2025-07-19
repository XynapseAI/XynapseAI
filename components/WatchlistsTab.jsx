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

// Utility functions
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

// Native token mappings
const NATIVE_TOKEN_INFO = {
  ethereum: { name: 'Ethereum', symbol: 'ETH', logo: '/ethereum-logo.png' },
  base: { name: 'Base', symbol: 'ETH', logo: '/base-logo.png' },
  bnb: { name: 'BNB', symbol: 'BNB', logo: '/bnb-logo.png' },
  solana: { name: 'Solana', symbol: 'SOL', logo: '/solana-logo.png' },
  eclipse: { name: 'Eclipse', symbol: 'ECL', logo: '/eclipse-logo.png' },
};

// LoadingOverlay component
const LoadingOverlay = ({ loadingStates = {}, isMobile }) => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const messages = [
    ...(loadingStates.loading ? ['Loading watchlist data...'] : []),
    ...(loadingStates.balances ? ['Fetching wallet balances...'] : []),
    ...(loadingStates.collectibles ? ['Fetching collectibles...'] : []),
    ...(loadingStates.transactions ? ['Fetching transactions...'] : []),
  ].filter(Boolean);

  useEffect(() => {
    if (messages.length === 0) return;
    const interval = setInterval(() => {
      setCurrentMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [messages.length]);

  if (messages.length === 0) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 ${isMobile ? 'bg-gray-900/70' : 'bg-gray-900/30 backdrop-blur-sm'}`}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-10 h-10">
          <div
            className={`absolute inset-0 border-2 rounded-full animate-spin ${isMobile ? 'border-gray-400 border-t-white' : 'border-neon-blue/50 border-t-white'}`}
          ></div>
          <Image
            src="/logos/logo-scan.png"
            alt="Loading Logo"
            width={28}
            height={28}
            className={`absolute inset-0 w-7 h-7 m-1.5 object-contain ${isMobile ? '' : 'animate-pulse'}`}
          />
        </div>
        <p className="text-[9px] md:text-[10px] text-gray-400 font-medium font-jetbrains">
          {messages[currentMessageIndex] || 'Processing...'}
        </p>
      </div>
    </div>
  );
};

// Tooltip component
const Tooltip = ({ children, text }) => (
  <div className="relative group">
    {children}
    <div className="absolute hidden group-hover:block bg-gray-900/90 text-white text-[8px] md:text-[9px] py-1 px-2 rounded-lg shadow-glow-neon z-20 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap font-jetbrains">
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

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
  const SUPPORTED_SVM_CHAINS = ['solana', 'eclipse'];
  const EVM_LOGOS = ['ethereum', 'base', 'bnb'];
  const SVM_LOGOS = ['solana', 'eclipse'];

  // Fetch supported chains
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
          image: coingeckoChain?.image?.thumb || simChain.image || '/icons/default.png',
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

  // Handle window resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch chains on mount
  useEffect(() => {
    fetchSupportedChains();
  }, [fetchSupportedChains]);

  const isValidSolanaAddress = useCallback((address) => {
    return address && address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
  }, []);

  // Fetch data (balances, collectibles, transactions)
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

  // Fetch token info
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

  // Load watchlists
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

  // Fetch balances, collectibles, and transactions
  useEffect(() => {
    if (!selectedWallet) return;
    fetchData('wallet-balances');
    fetchData('collectibles');
    fetchData('transactions');
  }, [selectedWallet, fetchData]);

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
    try {
      const response = await axios.post(
        `${API_BASE_URL}/watchlists`,
        { action: 'add', wallet_address: isValidEVM ? newAddress.toLowerCase() : newAddress },
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
        setSelectedWallet({ address: isValidEVM ? newAddress.toLowerCase() : newAddress, name: 'Unnamed Wallet', chainType: newChainType });
        setActiveChainType(newChainType);
        setShowAddModal(false);
        setNewAddress('');
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

  // Remove wallet
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
      <tr
        key={`${token.chain}-${token.address}`}
        className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
      >
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[7%]' : 'w-[7%]'}`}>
          <div className="flex flex-col items-center">
            <Image
              src={getPlatformImage(token.chain)}
              alt={`${token.chain} logo`}
              width={isMobile ? 12 : 20}
              height={isMobile ? 12 : 20}
              style={{ width: 'auto', height: 'auto' }}
              className="rounded-full flex-shrink-0"
              onError={(e) => {
                e.target.src = '/icons/default.png';
              }}
            />
            <span className="text-[7px] md:text-[10px] text-gray-400 flex-shrink-0">
              {chains.find((c) => c.value === (CHAIN_ID_TO_NAME[token.chain] || token.chain))?.label || token.chain}
            </span>
          </div>
        </td>
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[16%]' : 'w-[16%]'}`}>
          <div className="flex items-center space-x-2">
            <Image
              src={logoUrl}
              alt={`${tokenSymbol} logo`}
              width={isMobile ? 12 : 16}
              height={isMobile ? 12 : 16}
              style={{ width: 'auto', height: 'auto' }}
              className="rounded-full flex-shrink-0"
              onError={(e) => {
                e.target.src = '/icons/default.png';
              }}
            />
            <div className="flex flex-col items-start">
              <span>
                {tokenSymbol} {token.address === 'native' ? '' : ''}
              </span>
              {token.price_usd != null && (
                <span className="text-[6px] text-gray-400">({formatPrice(token.price_usd)})</span>
              )}
            </div>
          </div>
        </td>
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[16%]' : 'w-[16%]'}`}>
          {formatBalance(token.amount)}
        </td>
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-sm ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
          {token.value_usd != null
            ? `$${token.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
            : 'N/A'}
        </td>
      </tr>
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
        <tr
          key={`${nft.chain}-${nft.contract_address}-${nft.token_id}`}
          className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
        >
          <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[7%]' : 'w-[7%]'}`}>
            <div className="flex flex-col items-center">
              <Image
                src={getPlatformImage(nft.chain)}
                alt={`${nft.chain} logo`}
                width={isMobile ? 12 : 20}
                height={isMobile ? 12 : 20}
                style={{ width: 'auto', height: 'auto' }}
                className="rounded-full flex-shrink-0"
                onError={(e) => {
                  e.target.src = '/icons/default.png';
                }}
              />
              <span className="text-[7px] md:text-[10px] text-gray-400 flex-shrink-0">
                {chains.find((c) => c.value === (CHAIN_ID_TO_NAME[nft.chain] || nft.chain))?.label || nft.chain}
              </span>
            </div>
          </td>
          <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[16%]' : 'w-[16%]'}`}>
            <div className="flex items-center space-x-2">
              <Image
                src={logoUrl}
                alt={`${nft.name || 'Unknown'} logo`}
                width={isMobile ? 12 : 16}
                height={isMobile ? 12 : 16}
                style={{ width: 'auto', height: 'auto' }}
                className="rounded-full flex-shrink-0"
                onError={(e) => {
                  e.target.src = '/icons/default.png';
                }}
              />
              <div className="flex flex-col items-start">
                <span>{nft.name || 'Unknown'}</span>
                <span className="text-[6px] text-gray-400">ID: {nft.token_id}</span>
              </div>
            </div>
          </td>
          <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[16%]' : 'w-[16%]'}`}>
            {nft.balance || 1}
          </td>
          <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-sm ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
            {nft.value_usd != null
              ? `$${nft.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
              : 'N/A'}
          </td>
        </tr>
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
      <tr
        key={`${tx.chain}-${transactionKey}-${index}`}
        className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
      >
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
          <div className="flex flex-col items-center">
            <Image
              src={getPlatformImage(tx.chain)}
              alt={`${tx.chain} logo`}
              width={isMobile ? 12 : 20}
              height={isMobile ? 12 : 20}
              style={{ width: 'auto', height: 'auto' }}
              className="rounded-full flex-shrink-0"
              onError={(e) => {
                e.target.src = '/icons/default.png';
              }}
            />
            <span className="text-[7px] md:text-[10px] text-gray-400 flex-shrink-0">
              {chains.find((c) => c.value === (CHAIN_ID_TO_NAME[tx.chain] || tx.chain))?.label || tx.chain}
            </span>
          </div>
        </td>
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[15%]' : 'w-[15%]'}`}>
          <div className="flex items-center space-x-2">
            <Image
              src={tokenLogo}
              alt={`${tokenSymbol} logo`}
              width={isMobile ? 12 : 16}
              height={isMobile ? 12 : 16}
              style={{ width: 'auto', height: 'auto' }}
              className="rounded-full flex-shrink-0"
              onError={(e) => {
                e.target.src = '/icons/default.png';
              }}
            />
            <span>{tokenSymbol}</span>
          </div>
        </td>
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
          <div className="flex flex-col items-center space-y-1">
            <span
              className={`inline-flex px-1 py-0.5 md:px-1.5 md:py-0.5 rounded-full text-[6px] md:text-[7px] font-medium flex-shrink-0 ${tx.type === 'receive' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'
                }`}
            >
              {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
            </span>
            <div className="flex items-center justify-center space-x-2">
              {addressImage && (
                <Image
                  src={addressImage}
                  alt={`${displayAddress} logo`}
                  width={isMobile ? 12 : 16}
                  height={isMobile ? 12 : 16}
                  style={{ width: 'auto', height: 'auto' }}
                  className="rounded-full flex-shrink-0"
                  onError={(e) => {
                    e.target.src = '/icons/default.png';
                  }}
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
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs ${isMobile ? 'w-[15%]' : 'w-[15%]'}`}>
          {tx.value
            ? `${Number(tx.value).toLocaleString('en-US', { maximumFractionDigits: 6 })}`
            : 'N/A'}
        </td>
        <td className={`px-2 py-1.5 text-gray-200 text-[8px] md:text-xs text-center ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
          <div className="flex flex-col items-center gap-0.5">
            <a href={txUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
              <Image
                src="/logos/etherscan-logo.png"
                alt="Etherscan"
                width={isMobile ? 12 : 16}
                height={isMobile ? 12 : 16}
                style={{ width: 'auto', height: 'auto' }}
                className="flex-shrink-0"
                onError={(e) => (e.target.src = '/fallback-image.png')}
              />
            </a>
            <span className="text-[7px] md:text-[9px] text-gray-400">
              {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
            </span>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`font-jetbrains w-full max-w-9xl mx-auto mt-4 p-3 md:p-4 h-[calc(100vh-3rem)] overflow-hidden ${isMobile ? 'bg-gray-900' : 'bg-gray-900/20 backdrop-blur-xl border border-white/10 shadow-neon'
        }`}
    >
      <LoadingOverlay loadingStates={loadingStates} isMobile={isMobile} />
      <ToastContainer position="top-center" autoClose={5000} />

      {/* Header Section */}
      <div className="flex items-center justify-between mb-3 md:mb-4 border-b border-white/10 pb-1">
        <h3 className="text-xs font-bold text-white uppercase tracking-wide bg-gradient-to-r from-neon-blue/20 to-transparent">
          Wallet Selection
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative">
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
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`text-xs px-3 py-2 border border-white/10 focus:ring-2 focus:ring-neon-blue focus:outline-none transition-all duration-300 rounded-none ${isMobile ? 'bg-gray-900 w-36' : 'bg-gray-900/50 backdrop-blur-md w-48 hover:bg-white/10'
                }`}
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
          </div>
          <motion.button
            onClick={() => setShowAddModal(true)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`px-3 py-2 text-xs font-medium transition-all duration-300 border border-white/10 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${isMobile ? 'bg-gray-900' : 'backdrop-blur-md bg-gray-900/50 hover:bg-white/10'
              }`}
          >
            Add Wallet
          </motion.button>
          {selectedWallet && (
            <motion.button
              onClick={() => handleRemoveWallet(selectedWallet.address)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 transition-all duration-300 border border-white/10 bg-gradient-to-r from-red-500/20 to-transparent rounded-none ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                }`}
            >
              Remove Wallet
            </motion.button>
          )}
        </div>
      </div>

      {/* Chain Selection */}
      {chainsWithAssets.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {chainsWithAssets.map((chain) => (
            <Tooltip key={chain} text={chain.charAt(0).toUpperCase() + chain.slice(1)}>
              <motion.button
                onClick={() => setActiveChain(chain)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`p-1 border transition-all duration-300 rounded-none ${activeChain === chain
                    ? 'border-neon-blue bg-neon-blue/10 shadow-neon'
                    : 'border-white/10 hover:bg-white/10 hover:shadow-neon'
                  } ${isMobile ? 'bg-gray-900' : 'backdrop-blur-md bg-gray-900/50'}`}
              >
                <Image
                  src={getPlatformImage(chain)}
                  alt={chain}
                  width={isMobile ? 20 : 24}
                  height={isMobile ? 20 : 24}
                  style={{ width: 'auto', height: 'auto' }}
                  className="object-contain rounded-none"
                  onError={(e) => (e.target.src = chain === 'eclipse' ? '/eclipse-logo.png' : '/fallback-image.png')}
                />
              </motion.button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div
        className={`flex w-full border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
          }`}
      >
        {['Tokens', 'NFTs', 'Activity'].map((tab) => (
          <motion.button
            key={tab}
            onClick={() => setActiveTab(tab)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 border-r border-white/10 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${activeTab === tab
              ? 'bg-white text-black shadow-neon'
              : 'text-white hover:bg-white/10 hover:shadow-neon'
              }`}
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
          className="text-red-500 text-xs mb-3 bg-red-500/10 border border-red-500/30 p-3 text-center shadow-neon-red rounded-none"
        >
          Error: {error}
        </motion.div>
      )}

      {/* Data Table */}
      <div
        className={`flex-1 overflow-y-auto custom-scrollbar border border-white/10 rounded-none ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md shadow-neon'
          }`}
        style={{ maxHeight: isMobile ? 'calc(100vh - 16rem)' : 'calc(100vh - 20rem)' }}
      >
        {!loadingStates.loading && !loadingStates.balances && !loadingStates.collectibles && !loadingStates.transactions && selectedWallet ? (
          <div className="relative overflow-x-auto">
            {activeTab === 'Tokens' && (
              <>
                {balances.length > 0 ? (
                  <table className="w-full table-fixed">
                    <thead
                      className={`sticky top-0 z-10 border-b border-white/10 uppercase ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                        }`}
                    >
                      <tr>
                        <th className={`px-2 py-2 text-white text-center text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                              />
                            </svg>
                            Chain
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4-4z"
                              />
                            </svg>
                            Token
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z"
                              />
                            </svg>
                            Balance
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-7-7h14V7H5v4z"
                              />
                            </svg>
                            Value</div>
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
                  <p className="text-xs text-gray-400 text-center p-4">
                    No balances found for this wallet.
                  </p>
                )}
              </>
            )}
            {activeTab === 'NFTs' && (
              <>
                {collectibles.length > 0 && collectibles.some((nft) => (!activeChain || nft.chain === activeChain) && nft.token_metadata?.logo && !nft.token_metadata.logo.includes('scontent.xx.fbcdn.net') && nft.token_metadata.logo !== '/fallback-image.png') ? (
                  <table className="w-full table-fixed">
                    <thead
                      className={`sticky top-0 z-10 border-b border-white/10 uppercase ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                        }`}
                    >
                      <tr>
                        <th className={`px-2 py-2 text-white text-center text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                              />
                            </svg>
                            Chain
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4-4z"
                              />
                            </svg>
                            Name
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z"
                              />
                            </svg>
                            Balance
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-7-7h14V7H5v4z"
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
                  <p className="text-xs text-gray-400 text-center p-4">
                    No NFTs found for this wallet.
                  </p>
                )}
              </>
            )}
            {activeTab === 'Activity' && (
              <>
                {transactions.length > 0 && transactions.some((tx) => !activeChain || tx.chain === activeChain) ? (
                  <table className="w-full table-fixed">
                    <thead
                      className={`sticky top-0 z-10 border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                        }`}
                    >
                      <tr>
                        <th className={`px-2 py-2 text-white text-center text-xs ${isMobile ? 'w-[10%]' : 'w-[10%]'}`}>
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                              />
                            </svg>
                            Chain
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4-4z"
                              />
                            </svg>
                            Token
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[30%]' : 'w-[30%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
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
                        <th className={`px-2 py-2 text-white text-left text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-7-7h14V7H5v4z"
                              />
                            </svg>
                            Value
                          </div>
                        </th>
                        <th className={`px-2 py-2 text-white text-center text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 stroke-white fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
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
                  <p className="text-xs text-gray-400 text-center p-4">
                    No transactions found for this wallet.
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-400 text-center p-4">
            {selectedWallet ? 'Loading data...' : 'Please select a wallet to view data.'}
          </div>
        )}
      </div>

      {/* Add Wallet Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed inset-0 flex items-center justify-center z-50 font-jetbrains"
            onClick={() => setShowAddModal(false)}
          >
            <div
              className={`p-4 sm:p-6 max-w-[90%] sm:max-w-md w-full relative border border-white/10 rounded-none ${isMobile ? 'bg-gray-900' : 'backdrop-blur-md bg-gray-900/50 shadow-neon'
                }`}
              onClick={(e) => e.stopPropagation()}
            >
              <motion.button
                onClick={() => setShowAddModal(false)}
                className={`absolute top-3 right-3 text-white text-lg font-bold rounded-none w-8 h-8 flex items-center justify-center hover:bg-white/10 transition-all duration-300 border border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                  }`}
                aria-label="Close modal"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                ✕
              </motion.button>
              <h4 className="text-xs font-bold text-white mb-3 uppercase tracking-wide bg-gradient-to-r from-neon-blue/20 to-transparent">
                Add Wallet to Watchlist
              </h4>
              <div className="flex w-full border-b border-white/10 mb-3">
                {['EVM', 'SVM'].map((type) => (
                  <motion.button
                    key={type}
                    onClick={() => setNewChainType(type)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 border-r border-white/10 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${newChainType === type
                      ? 'bg-white text-black shadow-neon'
                      : 'text-white hover:bg-white/10 hover:shadow-neon'
                      }`}
                  >
                    {type}
                  </motion.button>
                ))}
              </div>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder={`Enter wallet address (${newChainType === 'EVM' ? 'EVM' : 'Solana/Eclipse'})`}
                className={`w-full text-xs px-3 py-2 border border-white/10 focus:ring-2 focus:ring-neon-blue focus:outline-none transition-all duration-300 rounded-none ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-md'
                  }`}
              />
              <div className="flex justify-end gap-3 mt-3">
                <motion.button
                  onClick={() => setShowAddModal(false)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="text-gray-300 text-xs font-medium hover:text-white transition-all duration-300"
                >
                  Cancel
                </motion.button>
                <motion.button
                  onClick={handleAddWallet}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`px-3 py-2 text-xs font-medium transition-all duration-300 border border-white/10 bg-gradient-to-r from-neon-blue/20 to-transparent rounded-none ${isMobile ? 'bg-gray-900' : 'backdrop-blur-md bg-gray-900/50 hover:bg-white/10'
                    } text-white`}
                >
                  Add Wallet
                </motion.button>
              </div>
              {error && <p className="text-red-500 text-xs mt-3">Error: {error}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
      .shadow-neon {
        box-shadow: 0 0 8px rgba(0, 191, 255, 0.3);
      }
      .shadow-neon-red {
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
      }
      .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
      }
      .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 0;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.4);
      }
      .animate-pulse {
        animation: ${isMobile ? 'none' : 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
      }
      @keyframes pulse {
        0%, 100% {
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