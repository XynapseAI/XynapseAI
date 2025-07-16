// components/WatchlistsTab.jsx
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback ,useMemo } from 'react';
import axios from 'axios';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { isAddress } from 'ethers';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { SUPPORTED_CHAINS, CHAIN_MAPPING } from '../utils/constants';



// Chain explorer mapping
const CHAIN_EXPLORER_MAP = {
    abstract: { baseUrl: 'https://explorer.abstractscan.io', supportsTx: true, supportsAddress: true },
    ancient8: { baseUrl: 'https://scan.ancient8.gg', supportsTx: true, supportsAddress: true },
    ape_chain: { baseUrl: 'https://explorer.apescan.io', supportsTx: true, supportsAddress: true },
    arbitrum: { baseUrl: 'https://arbiscan.io', supportsTx: true, supportsAddress: true },
    arbitrum_nova: { baseUrl: 'https://nova.arbiscan.io', supportsTx: true, supportsAddress: true },
    avalanche_c: { baseUrl: 'https://snowtrace.io', supportsTx: true, supportsAddress: true },
    avalanche_fuji: { baseUrl: 'https://testnet.snowtrace.io', supportsTx: true, supportsAddress: true },
    base: { baseUrl: 'https://basescan.org', supportsTx: true, supportsAddress: true },
    base_sepolia: { baseUrl: 'https://sepolia.basescan.org', supportsTx: true, supportsAddress: true },
    berachain: { baseUrl: 'https://berascan.io', supportsTx: true, supportsAddress: true },
    blast: { baseUrl: 'https://blastscan.io', supportsTx: true, supportsAddress: true },
    bnb: { baseUrl: 'https://bscscan.com', supportsTx: true, supportsAddress: true },
    bob: { baseUrl: 'https://explorer.gobob.xyz', supportsTx: true, supportsAddress: true },
    boba: { baseUrl: 'https://bobascan.com', supportsTx: true, supportsAddress: true },
    celo: { baseUrl: 'https://celoscan.io', supportsTx: true, supportsAddress: true },
    corn: { baseUrl: 'https://explorer.cornscan.io', supportsTx: true, supportsAddress: true },
    cyber: { baseUrl: 'https://cyberscan.co', supportsTx: true, supportsAddress: true },
    degen: { baseUrl: 'https://explorer.degen.tips', supportsTx: true, supportsAddress: true },
    ethereum: { baseUrl: 'https://etherscan.io', supportsTx: true, supportsAddress: true },
    fantom: { baseUrl: 'https://ftmscan.com', supportsTx: true, supportsAddress: true },
    flare: { baseUrl: 'https://flarescan.com', supportsTx: true, supportsAddress: true },
    gnosis: { baseUrl: 'https://gnosisscan.io', supportsTx: true, supportsAddress: true },
    ham: { baseUrl: 'https://explorer.hamchain.io', supportsTx: true, supportsAddress: true },
    hychain: { baseUrl: 'https://explorer.hychain.com', supportsTx: true, supportsAddress: true },
    ink: { baseUrl: 'https://explorer.inkchain.io', supportsTx: true, supportsAddress: true },
    kaia: { baseUrl: 'https://kaiascan.io', supportsTx: true, supportsAddress: true },
    linea: { baseUrl: 'https://lineascan.build', supportsTx: true, supportsAddress: true },
    lisk: { baseUrl: 'https://liskscan.com', supportsTx: true, supportsAddress: true },
    mantle: { baseUrl: 'https://mantlescan.xyz', supportsTx: true, supportsAddress: true },
    metis: { baseUrl: 'https://andromeda-explorer.metis.io', supportsTx: true, supportsAddress: true },
    mint: { baseUrl: 'https://explorer.mintchain.io', supportsTx: true, supportsAddress: true },
    mode: { baseUrl: 'https://modescan.io', supportsTx: true, supportsAddress: true },
    monad_testnet: { baseUrl: 'https://explorer.monad.xyz', supportsTx: true, supportsAddress: true },
    omni: { baseUrl: 'https://explorer.omni.network', supportsTx: true, supportsAddress: true },
    opbnb: { baseUrl: 'https://opbnbscan.com', supportsTx: true, supportsAddress: true },
    optimism: { baseUrl: 'https://optimistic.etherscan.io', supportsTx: true, supportsAddress: true },
    polygon: { baseUrl: 'https://polygonscan.com', supportsTx: true, supportsAddress: true },
    proof_of_play: { baseUrl: 'https://explorer.proofofplay.io', supportsTx: true, supportsAddress: true },
    rari: { baseUrl: 'https://rarichain.org', supportsTx: true, supportsAddress: true },
    redstone: { baseUrl: 'https://redstonescan.com', supportsTx: true, supportsAddress: true },
    scroll: { baseUrl: 'https://scrollscan.com', supportsTx: true, supportsAddress: true },
    sei: { baseUrl: 'https://seiscan.app', supportsTx: true, supportsAddress: true },
    sepolia: { baseUrl: 'https://sepolia.etherscan.io', supportsTx: true, supportsAddress: true },
    shape: { baseUrl: 'https://shapescan.xyz', supportsTx: true, supportsAddress: true },
    soneium: { baseUrl: 'https://explorer.soneium.org', supportsTx: true, supportsAddress: true },
    sonic: { baseUrl: 'https://sonicscan.io', supportsTx: true, supportsAddress: true },
    superseed: { baseUrl: 'https://superseedscan.io', supportsTx: true, supportsAddress: true },
    swellchain: { baseUrl: 'https://swellscan.io', supportsTx: true, supportsAddress: true },
    unichain: { baseUrl: 'https://unichain-sepolia.explorer.caldera.xyz', supportsTx: true, supportsAddress: true },
    wemix: { baseUrl: 'https://wemixscan.com', supportsTx: true, supportsAddress: true },
    world: { baseUrl: 'https://worldscan.io', supportsTx: true, supportsAddress: true },
    xai: { baseUrl: 'https://xaiscan.io', supportsTx: true, supportsAddress: true },
    zero_network: { baseUrl: 'https://zeroscan.io', supportsTx: true, supportsAddress: true },
    zkevm: { baseUrl: 'https://zkevm.polygonscan.com', supportsTx: true, supportsAddress: true },
    zksync: { baseUrl: 'https://explorer.zksync.io', supportsTx: true, supportsAddress: true },
    zora: { baseUrl: 'https://zora.superscan.network', supportsTx: true, supportsAddress: true },
    solana: { baseUrl: 'https://solscan.io', supportsTx: true, supportsAddress: true },
};

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

const truncateAddress = (address, nameTags = {}) => {
    if (!address || address === 'None' || typeof address !== 'string') return { text: 'N/A', image: null };
    const normalizedAddress = address.toLowerCase();
    const nameTag = nameTags[normalizedAddress]?.nameTag;
    const image = nameTags[normalizedAddress]?.image || null;
    const isEvmAddress = address.match(/^0x[a-fA-F0-9]{40}$/);
    const isSolanaAddress = address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
    const shortAddress = isEvmAddress
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : isSolanaAddress
            ? `${address.slice(0, 6)}...${address.slice(-6)}`
            : address;
    return { text: nameTag ? `${nameTag} (${shortAddress})` : shortAddress, image };
};

const weiToEth = (wei) => {
    if (!wei) return '0.000000';
    const value = parseInt(wei, 16) || 0;
    return (value / 1e18).toFixed(6);
};

const getExplorerUrls = (chain, hash, address) => {
    const explorer = CHAIN_EXPLORER_MAP[chain] || CHAIN_EXPLORER_MAP.ethereum;
    const txUrl = explorer.supportsTx ? `${explorer.baseUrl}/tx/${hash}` : '#';
    const addressUrl = explorer.supportsAddress ? `${explorer.baseUrl}/address/${address}` : '#';
    return { txUrl, addressUrl };
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
            className={`fixed inset-0 flex items-center justify-center z-50 ${isMobile ? 'bg-gray-900/70' : 'bg-gray-900/30 backdrop-blur-sm'
                }`}
        >
            <div className="flex flex-col items-center gap-3">
                <div className="relative w-10 h-10">
                    <div
                        className={`absolute inset-0 border-2 rounded-full animate-spin ${isMobile ? 'border-gray-400 border-t-white' : 'border-neon-blue/50 border-t-white'
                            }`}
                    ></div>
                    <Image
                        src="/logos/logo-scan.png"
                        alt="Loading Logo"
                        width={28}
                        height={28}
                        className={`absolute inset-0 w-7 h-7 m-1.5 object-contain ${isMobile ? '' : 'animate-pulse'}`}
                    />
                </div>
                <p className="text-[9px] md:text-[10px] text-gray-400 font-medium">
                    {messages[currentMessageIndex] || 'Processing...'}
                </p>
            </div>
        </div>
    );
};

export default function WatchlistsTab({ toast }) {
    const { data: session } = useSession();
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 640);
    const [watchlists, setWatchlists] = useState([]);
    const [selectedWallet, setSelectedWallet] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newAddress, setNewAddress] = useState('');
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

    // Fetch supported chains from CoinGecko
    const fetchSupportedChains = useCallback(async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/coingecko/chains`, {
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
                toast.error('Failed to load supported chains', { position: 'top-center', autoClose: 5000 });
                return;
            }

            const coingeckoChains = response.data.data;
            const mappedChains = SUPPORTED_CHAINS.map((simChain) => {
                const coingeckoChain = coingeckoChains.find(
                    (cg) => CHAIN_MAPPING[cg.id]?.simChain === simChain.value
                );
                const imageUrl = coingeckoChain?.image?.thumb || '/fallback-image.png';
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
                const errorMsg = 'Không có ví được chọn.';
                setError(errorMsg);
                if (toast) {
                    toast.error(errorMsg, { position: 'top-center', autoClose: 5000 });
                } else {
                }
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
                    ...(isValidEVM ? { chain_ids: '1,137,10,42161,8453' } : { chains: 'solana' }),
                    limit: 500, // Match Sim API max limit
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
                    throw new Error(response.data.detail || `Không thể tải dữ liệu ${action}.`);
                }

                if (action === 'wallet-balances') {
                    const balancesData = response.data.data || [];
                    setBalances(balancesData);
                    const chainsWithData = [...new Set(balancesData.map((b) => b.chain))];
                    setChainsWithAssets(chainsWithData);
                    if (!activeChain && chainsWithData.length > 0) setActiveChain(chainsWithData[0]);
                } else if (action === 'collectibles') {
                    const collectiblesData = response.data.data || [];
                    setCollectibles(collectiblesData);
                    console.log('Collectibles state:', collectiblesData); // Debug
                } else if (action === 'transactions') {
                    const transactionsData = response.data.data || [];
                    setTransactions(transactionsData);
                    console.log('Transactions state:', transactionsData); // Debug
                }
            } catch (err) {
                const errorMessage =
                    err.response?.status === 401
                        ? 'Không được phép: Vui lòng đăng nhập lại.'
                        : err.response?.status === 429
                            ? 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'
                            : err.response?.data?.detail || `Không thể tải dữ liệu ${action}: ${err.message}`;
                setError(errorMessage);
                if (toast) {
                    toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
                } else {
                }
                if (action === 'wallet-balances') setBalances([]);
                else if (action === 'collectibles') setCollectibles([]);
                else if (action === 'transactions') setTransactions([]);
            } finally {
                setLoadingStates((prev) => ({ ...prev, [action]: false }));
            }
        },
        [selectedWallet, session, isValidSolanaAddress, activeChain, toast]
    );

    // Fetch token info for balances
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
                            ...(isValidEVM ? { chain_ids: CHAIN_ID_MAP[chain] || '' } : { chains: 'solana' }),
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
                        } else {
                        }
                    } catch (err) {
                    }
                }
                setTokenInfo(tokenInfoData);
            } catch (err) {
                const errorMessage = err.response?.data?.detail || `Không thể tải thông tin token: ${err.message}`;
                setError(errorMessage);
                if (toast) {
                    toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
                } else {
                }
            } finally {
                setLoadingStates((prev) => ({ ...prev, loading: false }));
            }
        }
        fetchTokenInfo();
    }, [balances, session, toast, isValidSolanaAddress]);

    // Load watchlists from API
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
                    }));
                    setWatchlists(watchlistsData);
                    if (watchlistsData.length > 0) setSelectedWallet(watchlistsData[0]);
                } else {
                    setError('Không thể tải danh sách ví.');
                    toast.error('Không thể tải danh sách ví.', { position: 'top-center', autoClose: 5000 });
                }
            } catch (err) {
                const errorMessage = err.response?.data?.detail || `Không thể tải danh sách ví: ${err.message}`;
                setError(errorMessage);
                toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
                setWatchlists([]);
            } finally {
                setLoadingStates((prev) => ({ ...prev, loading: false }));
            }
        }
        fetchWatchlists();
    }, [session, toast]);

    // Fetch balances, collectibles, and transactions
    useEffect(() => {
        if (!selectedWallet) return;
        fetchData('wallet-balances');
        fetchData('collectibles');
        fetchData('transactions');
    }, [selectedWallet, activeChainType, fetchData]);

    // Add new wallet to watchlists
    const handleAddWallet = async () => {
        if (!newAddress) {
            setError('Vui lòng nhập địa chỉ ví.');
            toast.error('Vui lòng nhập địa chỉ ví.', { position: 'top-center', autoClose: 5000 });
            return;
        }
        const isValidEVM = isAddress(newAddress);
        const isValidSVM = isValidSolanaAddress(newAddress);
        if (!isValidEVM && !isValidSVM) {
            setError('Địa chỉ ví không hợp lệ.');
            toast.error('Địa chỉ ví không hợp lệ.', { position: 'top-center', autoClose: 5000 });
            return;
        }
        try {
            const response = await axios.post(
                `${API_BASE_URL}/watchlists`,
                { action: 'add', wallet_address: newAddress.toLowerCase() },
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
                }));
                setWatchlists(updatedWatchlists);
                setSelectedWallet({ address: newAddress.toLowerCase(), name: 'Unnamed Wallet' });
                setShowAddModal(false);
                setNewAddress('');
                setError(null);
                toast.success('Ví đã được thêm thành công.', { position: 'top-center', autoClose: 5000 });
            } else {
                setError(response.data.detail || 'Không thể thêm ví.');
                toast.error(response.data.detail || 'Không thể thêm ví.', { position: 'top-center', autoClose: 5000 });
            }
        } catch (err) {
            const errorMessage = err.response?.data?.detail || `Không thể thêm ví: ${err.message}`;
            setError(errorMessage);
            toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        }
    };

    // Remove wallet from watchlists
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
                }));
                setWatchlists(updatedWatchlists);
                if (selectedWallet?.address === walletAddress) {
                    setSelectedWallet(updatedWatchlists[0] || null);
                    setBalances([]);
                    setCollectibles([]);
                    setTransactions([]);
                    setTokenInfo({});
                    setActiveChain(null);
                }
                setError(null);
                toast.success('Ví đã được xóa thành công.', { position: 'top-center', autoClose: 5000 });
            } else {
                setError(response.data.detail || 'Không thể xóa ví.');
                toast.error(response.data.detail || 'Không thể xóa ví.', { position: 'top-center', autoClose: 5000 });
            }
        } catch (err) {
            const errorMessage = err.response?.data?.detail || `Không thể xóa ví: ${err.message}`;
            setError(errorMessage);
            toast.error(errorMessage, { position: 'top-center', autoClose: 5000 });
        }
    };

    const getPlatformImage = (chainValue) => {
        const chain = chains.find((c) => c.value === chainValue);
        const imageUrl = chain?.image || '/fallback-image.png';
        return imageUrl;
    };

    const renderTokenRow = (token) => {
        const tokenInfoData = tokenInfo[token.address] || [];
        const tokenDetails = tokenInfoData.find((t) => t.chain === token.chain) || {};
        return (
            <tr
                key={`${token.chain}-${token.address}`}
                className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
            >
                <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                    <div className="flex flex-col items-center">
                        <Image
                            src={getPlatformImage(token.chain)}
                            alt={`${token.chain} logo`}
                            width={isMobile ? 12 : 20}
                            height={isMobile ? 12 : 20}
                            style={{ width: 'auto', height: 'auto' }}
                            className="rounded-full flex-shrink-0"
                            onError={(e) => {
                                e.target.src = '/fallback-image.png';
                            }}
                        />
                        <span className="text-[7px] md:text-[10px] text-gray-400 flex-shrink-0">
                            {chains.find((c) => c.value === token.chain)?.label || token.chain}
                        </span>
                    </div>
                </td>
                <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                    <div className="flex items-center space-x-2">
                        {token.logo && (
                            <Image
                                src={token.logo}
                                alt={`${token.symbol} logo`}
                                width={isMobile ? 12 : 16}
                                height={isMobile ? 12 : 16}
                                style={{ width: 'auto', height: 'auto' }}
                                className="rounded-full flex-shrink-0"
                                onError={(e) => {
                                    e.target.src = '/fallback-image.png';
                                }}
                            />
                        )}
                        <div className="flex flex-col items-start">
                            <span>
                                {token.symbol || tokenDetails.symbol || 'Unknown'} {token.address === 'native' ? '(Native)' : ''}
                            </span>
                            {token.price_usd != null && (
                                <span className="text-[6px] text-gray-400">({formatPrice(token.price_usd)})</span>
                            )}
                        </div>
                    </div>
                </td>
                <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                    {token.amount != null ? token.amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'N/A'}
                </td>
                <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-sm">
                    {token.value_usd != null
                        ? `$${token.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                        : 'N/A'}
                </td>
            </tr>
        );
    };

    const renderNFTRow = useMemo(
        () => (nft) => (
            <tr
                key={`${nft.chain}-${nft.contract_address}-${nft.token_id}`}
                className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
            >
                <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                    <div className="flex flex-col items-center">
                        <Image
                            src={getPlatformImage(nft.chain)}
                            alt={`${nft.chain} logo`}
                            width={isMobile ? 12 : 20}
                            height={isMobile ? 12 : 20}
                            style={{ width: 'auto', height: 'auto' }}
                            className="rounded-full flex-shrink-0"
                            onError={(e) => {
                                e.target.src = '/fallback-image.png';
                            }}
                        />
                        <span className="text-[7px] md:text-[10px] text-gray-400 flex-shrink-0">
                            {chains.find((c) => c.value === nft.chain)?.label || nft.chain}
                        </span>
                    </div>
                </td>
                <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                    <div className="flex items-center space-x-2">
                        {nft.token_metadata?.logo && (
                            <Image
                                src={nft.token_metadata.logo}
                                alt={`${nft.name || 'Unknown'} logo`}
                                width={isMobile ? 12 : 16}
                                height={isMobile ? 12 : 16}
                                style={{ width: 'auto', height: 'auto' }}
                                className="rounded-full flex-shrink-0"
                                onError={(e) => {
                                    e.target.src = '/fallback-image.png';
                                }}
                            />
                        )}
                        <div className="flex flex-col items-start">
                            <span>{nft.name || 'Unknown'}</span>
                            <span className="text-[6px] text-gray-400">ID: {nft.token_id}</span>
                        </div>
                    </div>
                </td>
                <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                    {nft.balance || 1}
                </td>
                <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-sm">
                    {nft.value_usd != null
                        ? `$${nft.value_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                        : 'N/A'}
                </td>
            </tr>
        ),
        [chains, isMobile]
    );

    const renderTransactionRow = (tx) => (
        <tr
            key={`${tx.chain}-${tx.hash}`}
            className="border-t border-white/10 hover:bg-white/5 transition-all duration-200"
        >
            <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                <div className="flex items-center space-x-2">
                    <Image
                        src={getPlatformImage(tx.chain)}
                        alt={`${tx.chain} logo`}
                        width={isMobile ? 12 : 20}
                        height={isMobile ? 12 : 20}
                        style={{ width: 'auto', height: 'auto' }}
                        className="rounded-full flex-shrink-0"
                        onError={(e) => {
                            e.target.src = '/fallback-image.png';
                        }}
                    />
                    <div className="flex flex-col">
                        <span>
                            {tx.from.slice(0, 6)}...{tx.from.slice(-4)} → {tx.to ? `${tx.to.slice(0, 6)}...${tx.to.slice(-4)}` : 'None'}
                        </span>
                        <span className="text-[6px] text-gray-400">Hash: {tx.hash.slice(0, 6)}...</span>
                    </div>
                </div>
            </td>
            <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs">
                {tx.value
                    ? `${(Number(tx.value) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 6 })}`
                    : 'N/A'}
            </td>
            <td className="px-2 py-1.5 text-gray-200 text-[8px] md:text-xs text-center">
                {tx.block_time ? new Date(tx.block_time).toLocaleString() : 'N/A'}
            </td>
        </tr>
    );

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className={`font-jetbrains w-full max-w-10xl mx-auto h-[calc(100vh)] overflow-y-auto mt-6 p-4 md:p-6 rounded-2xl border border-white/10 ${isMobile ? 'bg-galaxy' : 'bg-galaxy backdrop-blur-xl shadow-2xl'
                } custom-scrollbar`}
        >
            <LoadingOverlay loadingStates={loadingStates} isMobile={isMobile} />
            <ToastContainer position="top-center" autoClose={5000} />
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-[12px] md:text-sm font-bold text-white uppercase tracking-wider">Danh sách ví</h3>
                <div className="flex items-center gap-2">
                    <select
                        value={selectedWallet?.address || ''}
                        onChange={(e) => {
                            const wallet = watchlists.find((w) => w.address === e.target.value);
                            setSelectedWallet(wallet || null);
                            setBalances([]);
                            setCollectibles([]);
                            setTransactions([]);
                            setTokenInfo({});
                            setActiveChain(null);
                            setActiveChainType(isValidSolanaAddress(e.target.value) ? 'SVM' : 'EVM');
                        }}
                        className={`text-[9px] md:text-[10px] bg-gray-900/50 border border-white/20 rounded-lg p-1 text-white ${isMobile ? '' : 'backdrop-blur-md'
                            }`}
                    >
                        {watchlists.length === 0 ? (
                            <option value="">Chưa có ví nào</option>
                        ) : (
                            watchlists.map((wallet) => (
                                <option key={wallet.address} value={wallet.address}>
                                    {wallet.name} ({`${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`})
                                </option>
                            ))
                        )}
                    </select>
                    <motion.button
                        onClick={() => setShowAddModal(true)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className="text-neon-blue text-[12px] font-bold"
                    >
                        +
                    </motion.button>
                    {selectedWallet && (
                        <motion.button
                            onClick={() => handleRemoveWallet(selectedWallet.address)}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            className="text-red-400 text-[12px] font-bold"
                        >
                            -
                        </motion.button>
                    )}
                </div>
            </div>

            {/* Add Wallet Modal */}
            <AnimatePresence>
                {showAddModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 flex items-center justify-center z-50 bg-gray-900/70"
                    >
                        <motion.div
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0.8 }}
                            className="bg-gray-900/80 backdrop-blur-lg p-4 rounded-xl border border-white/20 max-w-sm w-full"
                        >
                            <h4 className="text-[10px] md:text-sm text-white mb-2">Thêm ví vào danh sách theo dõi</h4>
                            <input
                                type="text"
                                value={newAddress}
                                onChange={(e) => setNewAddress(e.target.value)}
                                placeholder="Nhập địa chỉ ví (EVM hoặc Solana)"
                                className="w-full bg-gray-800 text-white text-[9px] md:text-[10px] p-2 rounded-lg border border-white/20 mb-2"
                            />
                            <div className="flex justify-end gap-2">
                                <motion.button
                                    onClick={() => setShowAddModal(false)}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    className="text-gray-400 text-[9px] md:text-[10px]"
                                >
                                    Hủy
                                </motion.button>
                                <motion.button
                                    onClick={handleAddWallet}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    className="bg-neon-blue/20 text-neon-blue text-[9px] md:text-[10px] px-3 py-1 rounded-lg"
                                >
                                    Thêm
                                </motion.button>
                            </div>
                            {error && <p className="text-red-400 text-[9px] md:text-[10px] mt-2">{error}</p>}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Chain Type Buttons */}
            <div className="flex gap-2 mb-4">
                {['EVM', 'SVM'].map((type) => (
                    <motion.button
                        key={type}
                        onClick={() => {
                            setActiveChainType(type);
                            setActiveChain(null);
                            setBalances([]);
                            setCollectibles([]);
                            setTransactions([]);
                            setTokenInfo({});
                        }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className={`px-4 py-1 rounded-lg text-[9px] md:text-[10px] font-medium ${activeChainType === type
                            ? 'bg-neon-blue/20 border-neon-blue text-neon-blue'
                            : 'bg-gray-900/50 border-white/20 text-white'
                            } border`}
                    >
                        {type}
                    </motion.button>
                ))}
            </div>

            {/* Chain Logos */}
            {chainsWithAssets.length > 0 && (
                <div className="flex gap-2 mb-4 overflow-x-auto custom-scrollbar">
                    {chainsWithAssets.map((chain) => (
                        <motion.button
                            key={chain}
                            onClick={() => setActiveChain(chain)}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            className={`p-1 rounded-lg border ${activeChain === chain ? 'border-neon-blue' : 'border-white/20'}`}
                        >
                            <Image
                                src={chains.find((c) => c.value === chain)?.image || '/default-chain.png'}
                                alt={chain}
                                width={24}
                                height={24}
                                style={{ width: 'auto', height: 'auto' }}
                                className="object-contain"
                                onError={(e) => (e.target.src = '/default-chain.png')}
                            />
                        </motion.button>
                    ))}
                </div>
            )}

            {/* Tab */}
            <div className="flex gap-2 mb-4">
                {['Tokens', 'NFTs', 'Activity'].map((tab) => (
                    <motion.button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className={`px-4 py-1 rounded-lg text-[9px] md:text-[10px] font-medium ${activeTab === tab
                            ? 'bg-neon-blue/20 border-neon-blue text-neon-blue'
                            : 'bg-gray-900/50 border-white/20 text-white'
                            } border`}
                    >
                        {tab === 'Tokens' ? 'Tokens (Balances)' : tab === 'NFTs' ? 'NFTs (Collectibles)' : 'Activity'}
                    </motion.button>
                ))}
            </div>

            {/* Error Display */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-500 text-[10px] md:text-sm mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center"
                >
                    Error: {error}
                </motion.div>
            )}

            {/* Data Table */}
            {!loadingStates.loading && !loadingStates.balances && !loadingStates.collectibles && !loadingStates.transactions && selectedWallet && (
                <div className="space-y-2 overflow-x-auto">
                    {activeTab === 'Tokens' && (
                        <>
                            {balances.length > 0 ? (
                                <table className="w-full table-fixed">
                                    <thead
                                        className={`sticky top-0 z-10 border-b border-white/10 uppercase ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-lg'
                                            }`}
                                    >
                                        <tr>
                                            <th
                                                className={`px-2 py-1.5 text-white text-center text-[8px] md:text-xs ${isMobile ? 'w-[7%]' : 'w-[7%]'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="w-3 h-3 md:w-4 md:h-4 fill-white flex-shrink-0"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                                    </svg>
                                                    Chain
                                                </div>
                                            </th>
                                            <th
                                                className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[16%]' : 'w-[16%]'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-1">
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="w-3 h-3 md:w-4 md:h-4 fill-white"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
                                                    </svg>
                                                    Token
                                                </div>
                                            </th>
                                            <th
                                                className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[16%]' : 'w-[16%]'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-1">
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="w-3 h-3 md:w-4 md:h-4 fill-white"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z" />
                                                    </svg>
                                                    Balance
                                                </div>
                                            </th>
                                            <th
                                                className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-1">
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="w-3 h-3 md:w-4 md:h-4 stroke-white fill-none"
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
                                        {balances
                                            .filter((b) => !activeChain || b.chain === activeChain)
                                            .map(renderTokenRow)}
                                    </tbody>
                                </table>
                            ) : (
                                <p className="text-[9px] md:text-xs text-gray-400 text-center">
                                    No balances found for this wallet.
                                </p>
                            )}
                        </>
                    )}
                    {activeTab === 'NFTs' && (
                        <>
                            {collectibles.length > 0 && collectibles.some((nft) => !activeChain || nft.chain === activeChain) ? (
                                <table className="w-full table-fixed">
                                    <thead
                                        className={`sticky top-0 z-10 border-b border-white/10 uppercase ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-lg'
                                            }`}
                                    >
                                        <tr>
                                            <th className={`px-2 py-1.5 text-white text-center text-[8px] md:text-xs ${isMobile ? 'w-[7%]' : 'w-[7%]'}`}>
                                                <div className="flex items-center justify-center gap-1">Chain</div>
                                            </th>
                                            <th className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[16%]' : 'w-[16%]'}`}>
                                                <div className="flex items-center gap-1">Name</div>
                                            </th>
                                            <th className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[16%]' : 'w-[16%]'}`}>
                                                <div className="flex items-center gap-1">Balance</div>
                                            </th>
                                            <th className={`px-2 py-1.5 text-white text-left text-[8px] md:text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'}`}>
                                                <div className="flex items-center gap-1">Value</div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {collectibles
                                            .filter((nft) => !activeChain || nft.chain === activeChain)
                                            .map(renderNFTRow)}
                                    </tbody>
                                </table>
                            ) : (
                                <p className="text-[9px] md:text-xs text-gray-400 text-center">
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
                                        className={`sticky top-0 z-10 border-b border-white/10 ${isMobile ? 'bg-gray-900' : 'bg-gray-900/50 backdrop-blur-lg'}`}
                                    >
                                        <tr>
                                            <th className={`px-2 py-1.5 text-white text-left text-[10px] md:text-xs ${isMobile ? 'w-[60%]' : 'w-[60%]'} uppercase`}>
                                                <div className="flex items-center gap-2">Transfer</div>
                                            </th>
                                            <th className={`px-2 py-1.5 text-white text-left text-[10px] md:text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'} uppercase`}>
                                                <div className="flex items-center gap-2">Value</div>
                                            </th>
                                            <th className={`px-2 py-1.5 text-white text-center text-[10px] md:text-xs ${isMobile ? 'w-[20%]' : 'w-[20%]'} uppercase`}>
                                                <div className="flex items-center justify-center gap-2">Time</div>
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
                                <p className="text-[9px] md:text-xs text-gray-400 text-center">
                                    No transactions found for this wallet.
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}

            <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .shadow-glow-neon {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.1);
        }
        .bg-galaxy {
          background: linear-gradient(145deg, #1a1a1a, #2a2a2a);
        }
        .animate-pulse {
          animation: ${isMobile ? 'none' : 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
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
        @media (max-width: 640px) {
          .text-[10px] {
            font-size: 8px;
          }
          .text-[9px] {
            font-size: 7px;
          }
          .text-[12px] {
            font-size: 10px;
          }
          .text-sm {
            font-size: 12px;
          }
        }
      `}</style>
        </motion.div>
    );
}