// components/ExplorerTab.jsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Clock, Hash as HashIcon, AlertCircle, Wallet, Coins, Activity, Check, Copy, X, DollarSign, ChevronDown, Globe, Fuel } from 'lucide-react';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useSearchParams } from 'next/navigation';
import { ethers } from 'ethers';
import { LoadingOverlay } from '@/utils/helpers';

export default function ExplorerTab({ initialQuery, initialChain, isStandalone = false }) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [query, setQuery] = useState(initialQuery || '');
    const [selectedChain, setSelectedChain] = useState(initialChain || 'ethereum');
    const [results, setResults] = useState(null);
    const [nametags, setNametags] = useState({});
    const [nametagsLoading, setNametagsLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isMobile, setIsMobile] = useState(false);
    const [logMessages, setLogMessages] = useState([]);
    const [isChainMenuOpen, setIsChainMenuOpen] = useState(false);
    const buttonRef = useRef(null);
    const menuRef = useRef(null);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });
    const basePath = isStandalone ? '/explorer' : '/dashboard?tab=explorer';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://xynapseai.net';
    const [chainStats, setChainStats] = useState({ blockNumber: 0, gasPrice: '0', nativePrice: 0 });
    const [latestBlocks, setLatestBlocks] = useState([]); // newest first
    const [latestTxs, setLatestTxs] = useState([]); // newest first
    const [blocksPage, setBlocksPage] = useState(1);
    const [txsPage, setTxsPage] = useState(1);
    const [dashboardLoading, setDashboardLoading] = useState(false);
    const itemsPerPage = 20;
    const apiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'demo';
    const isDemoKey = !apiKey || apiKey === 'demo';

    const chainConfig = {
        bitcoin: { id: null, apiBase: '/api/mempool' },
        ethereum: { id: 1, apiBase: '/api/etherscan-explorer' },
        bsc: { id: 56, apiBase: '/api/etherscan-explorer' },
        arbitrum: { id: 42161, apiBase: '/api/etherscan-explorer' },
        optimism: { id: 10, apiBase: '/api/etherscan-explorer' },
        polygon: { id: 137, apiBase: '/api/etherscan-explorer' },
        base: { id: 8453, apiBase: '/api/etherscan-explorer' },
        solana: { id: null, apiBase: '/api/solana' },
        linea: { id: 59144, apiBase: '/api/etherscan-explorer' },
        unichain: { id: 130, apiBase: '/api/etherscan-explorer' },
        monad: { id: 143, apiBase: '/api/etherscan-explorer' },
        hyperevm: { id: 999, apiBase: '/api/etherscan-explorer' },
        // avalanche: { id: 43114, apiBase: '/api/etherscan-explorer' },
        // celo: { id: 42220, apiBase: '/api/etherscan-explorer' },
        // gnosis: { id: 100, apiBase: '/api/etherscan-explorer' },
    };

    const chainLogos = {
        bitcoin: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
        ethereum: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
        bsc: 'https://assets.coingecko.com/asset_platforms/images/1/large/bnb_smart_chain.png?1706606721',
        arbitrum: 'https://assets.coingecko.com/coins/images/16547/large/arb.jpg?1721358242',
        optimism: 'https://assets.coingecko.com/asset_platforms/images/41/large/optimism.png?1706606778',
        polygon: 'https://assets.coingecko.com/asset_platforms/images/15/large/polygon_pos.png?1706606645',
        base: 'https://assets.coingecko.com/asset_platforms/images/131/large/base.png?1759905869',
        solana: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
        zksync: 'https://assets.coingecko.com/asset_platforms/images/121/large/zksync.jpeg?1706606814',
        linea: 'https://assets.coingecko.com/asset_platforms/images/135/large/linea.jpeg?1706606705',
        abstract: 'https://assets.coingecko.com/asset_platforms/images/22196/large/abstract.jpg?1735611808',
        apechain: 'https://assets.coingecko.com/coins/images/24383/large/APECOIN.png?1756551529',
        hyperevm: 'https://assets.coingecko.com/coins/images/50882/large/hyperliquid.jpg?1729431300',
        monad: 'https://assets.coingecko.com/coins/images/38927/large/monad.jpg?1719547722',
        unichain: 'https://assets.coingecko.com/asset_platforms/images/22206/large/unichain.png?1739323630',
        world: 'https://assets.coingecko.com/asset_platforms/images/22180/large/Worldcoin-logomark-light.png?1728377966',
        // avalanche: 'https://assets.coingecko.com/asset_platforms/images/12/large/avalanche.png?1706606775',
        // celo: 'https://assets.coingecko.com/asset_platforms/images/21/large/celo.jpeg?1711358666',
        // gnosis: 'https://assets.coingecko.com/coins/images/662/large/logo_square_simple_300px.png?1696501854',
    };
    const nativeTokenLogos = {
        ETH: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
        BNB: 'https://assets.coingecko.com/coins/images/825/large/bnb.png',
        MATIC: 'https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png',
        BTC: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
        SOL: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
        MON: 'https://assets.coingecko.com/coins/images/38927/large/monad.jpg?1719547722',
        AVAX: 'https://assets.coingecko.com/coins/images/12559/large/AVAXLOGO.png',
        CELO: 'https://assets.coingecko.com/coins/images/11090/large/icon-celo-CELO-color-500.png',
        xDAI: 'https://assets.coingecko.com/coins/images/11062/large/StableGDAI_icon.png',
        APE: 'https://assets.coingecko.com/coins/images/24383/large/APECOIN.png',
        HYPER: 'https://assets.coingecko.com/coins/images/50882/large/hyperliquid.jpg',
        WORLD: 'https://assets.coingecko.com/coins/images/37060/large/WORLD_Token_Icon.png',
    };
    const nativeSymbols = {
        ethereum: 'ETH',
        bsc: 'BNB',
        arbitrum: 'ETH',
        optimism: 'ETH',
        polygon: 'MATIC',
        base: 'ETH',
        monad: 'MON',
        zksync: 'ETH',
        linea: 'ETH',
        abstract: 'ETH',
        apechain: 'APE',
        hyperevm: 'HYPE',
        unichain: 'ETH',
        world: 'ETH',
        // avalanche: 'AVAX',
        // celo: 'CELO',
        // gnosis: 'xDAI',
    };
    const chainSymbols = {
        bitcoin: 'BTC',
        ethereum: 'ETH',
        bsc: 'BNB',
        arbitrum: 'ETH',
        optimism: 'ETH',
        polygon: 'MATIC',
        base: 'ETH',
        solana: 'SOL',
        monad: 'MON',
        // avalanche: 'AVAX',
        // celo: 'CELO',
        // gnosis: 'xDAI',
        zksync: 'ETH',
        linea: 'ETH',
        abstract: 'ETH',
        apechain: 'APE',
        hyperevm: 'HYPEREVM',
        unichain: 'ETH',
        world: 'ETH',
    };
    const evmChainsOrder = ['ethereum', 'arbitrum', 'bsc', 'optimism', 'polygon', 'base', 'monad', 'hyperevm'];
    const rpcMap = {
        ethereum: `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
        polygon: `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`,
        arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`,
        optimism: `https://opt-mainnet.g.alchemy.com/v2/${apiKey}`,
        base: `https://base-mainnet.g.alchemy.com/v2/${apiKey}`,
        // avalanche: `https://avax-mainnet.g.alchemy.com/v2/${apiKey}`,
        // celo: `https://celo-mainnet.g.alchemy.com/v2/${apiKey}`,
        // gnosis: `https://gnosis-mainnet.g.alchemy.com/v2/${apiKey}`,
        zksync: `https://zksync-mainnet.g.alchemy.com/v2/${apiKey}`,
        linea: `https://linea-mainnet.g.alchemy.com/v2/${apiKey}`,
        bsc: `https://bnb-mainnet.g.alchemy.com/v2/${apiKey}`,
        abstract: `https://abstract-mainnet.g.alchemy.com/v2/${apiKey}`,
        apechain: `https://apechain-mainnet.g.alchemy.com/v2/${apiKey}`,
        hyperevm: `https://hyperliquid-mainnet.g.alchemy.com/v2/${apiKey}`,
        monad: `https://monad-mainnet.g.alchemy.com/v2/${apiKey}`,
        unichain: `https://linea-mainnet.g.alchemy.com/v2/${apiKey}`,
        world: `https://worldchain-mainnet.g.alchemy.com/v2/${apiKey}`,
    };
    const fetchNativePrice = async () => {
        try {
            const priceRes = await fetch('/api/alchemy', {
                method: 'POST',
                body: JSON.stringify({ action: 'native-price', chain: selectedChain })
            });
            const priceData = priceRes.ok ? await priceRes.json() : { price: 0 };
            // Cập nhật giá vào chainStats (giữ nguyên các giá trị khác)
            setChainStats(prevStats => ({
                ...prevStats,
                nativePrice: priceData.price
            }));
        } catch (error) {
            console.error("Price polling error:", error);
        }
    };
    const collectDashboardAddresses = () => {
        const miners = latestBlocks.map(b => b.miner?.toLowerCase() ?? '');
        const froms = latestTxs.map(tx => tx.from?.toLowerCase() ?? '');
        const tos = latestTxs.map(tx => tx.to?.toLowerCase() ?? '');
        const all = [...miners, ...froms, ...tos].filter(a => a);
        return [...new Set(all)].slice(0, 200);
    };
    const fetchDashboardData = async () => {
        try {
            const [blocksRes, txsRes, statsRes] = await Promise.all([
                fetch('/api/alchemy', {
                    method: 'POST', body: JSON.stringify({ action: 'latest-blocks', chain: selectedChain })
                }),
                fetch('/api/alchemy', {
                    method: 'POST', body: JSON.stringify({ action: 'latest-txs', chain: selectedChain })
                }),
                fetch('/api/alchemy', {
                    method: 'POST', body: JSON.stringify({ action: 'chain-stats', chain: selectedChain })
                }),
            ]);
            const blocks = blocksRes.ok ? await blocksRes.json() : [];
            const txsRaw = txsRes.ok ? await txsRes.json() : [];
            const statsData = statsRes.ok ? await statsRes.json() : { blockNumber: 0, gasPrice: '0' };
            let txs = txsRaw;
            if (isEVMChain(selectedChain)) {
                txs = txsRaw.map(tx => ({
                    ...tx,
                    value: tx.value ? Number(ethers.formatEther(tx.value)) : 0
                }));
            } else {
                txs = txsRaw.map(tx => ({
                    ...tx,
                    value: tx.value ? parseFloat(tx.value) : 0
                }));
            }
            if (blocks.length > 0) setLatestBlocks(blocks);
            if (txs.length > 0) setLatestTxs(txs);
            setChainStats(prevStats => ({
                ...prevStats,
                blockNumber: statsData.blockNumber,
                gasPrice: statsData.gasPrice,
            }));
            setDashboardLoading(false);
            const addresses = collectDashboardAddresses();
            if (addresses.length > 0) {
                await fetchNametags(addresses, selectedChain);
            }
        } catch (error) {
            console.error("Polling error:", error);
            setDashboardLoading(false);
        }
    };
    useEffect(() => {
        // 1. Fetch giá lần đầu ngay lập tức
        fetchNativePrice();
        // 2. Thiết lập Polling Giá (Mỗi 1 giờ)
        const ONE_HOUR_MS = 3600000;
        const priceIntervalId = setInterval(() => {
            fetchNativePrice();
        }, ONE_HOUR_MS);
        // 3. Cleanup
        return () => clearInterval(priceIntervalId);
    }, [selectedChain]);
    useEffect(() => {
        // 1. Reset loading khi đổi chain
        setDashboardLoading(true);
        setLatestBlocks([]);
        setLatestTxs([]);
        setNametags({});
        // Không reset nativePrice ở đây để tránh bị 0 trong lúc chờ fetch price mới (vì giá chỉ fetch 1h/lần)
        setChainStats(prev => ({ blockNumber: 0, gasPrice: '0', nativePrice: prev.nativePrice || 0 }));
        // 2. Fetch Dashboard Data (không bao gồm price) lần đầu ngay lập tức
        fetchDashboardData();
        // 3. Thiết lập Polling cho Blocks/Txs/Stats (Mỗi 5 giây)
        const dataIntervalId = setInterval(() => {
            fetchDashboardData();
        }, 300000);
        // 4. Cleanup
        return () => clearInterval(dataIntervalId);
    }, [selectedChain]);
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (isChainMenuOpen && menuRef.current && !menuRef.current.contains(event.target) && !buttonRef.current.contains(event.target)) {
                setIsChainMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isChainMenuOpen]);
    useEffect(() => {
        if (isChainMenuOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setMenuPosition({
                top: rect.bottom + 8 + window.scrollY,
                left: rect.left + window.scrollX,
                width: rect.width
            });
        }
    }, [isChainMenuOpen]);
    useEffect(() => {
        if (results && results.data) {
            const txHash = results.data.hash || results.data.txid || results.data.signature || 'Unknown';
            const chainName = selectedChain.toUpperCase();
            const status = results.data.status || 'Pending';
            const truncatedQuery = query.length > 10 ? `${query.slice(0, 8)}...${query.slice(-6)}` : query;
            document.title = `Transaction ${truncatedQuery} on ${chainName} | Xynapse Explorer`;
            let metaDesc = `Explore transaction ${truncatedQuery} on ${chainName} blockchain. Status: ${status}. View details, token transfers, and more on Xynapse Explorer.`;
            if (results.data.value || results.data.nativeValue) {
                const value = results.data.value || results.data.nativeValue || 0;
                metaDesc += ` Value: ${value.toFixed(6)} ${chainSymbols[selectedChain] || 'Native'}.`;
            }
            const metaTag = document.querySelector('meta[name="description"]');
            if (metaTag) {
                metaTag.setAttribute('content', metaDesc);
            }
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle) ogTitle.setAttribute('content', document.title);
            const ogDesc = document.querySelector('meta[property="og:description"]');
            if (ogDesc) ogDesc.setAttribute('content', metaDesc);
            const ogImagePrimary = document.querySelector('meta[property="og:image"]') || createMetaTag('property', 'og:image', 'https://xynapseai.net/explorer.png');
            ogImagePrimary.setAttribute('content', 'https://xynapseai.net/explorer.png');
            let ogImageSecondary = document.querySelector('meta[property="og:image"][content*="coingecko"]');
            if (!ogImageSecondary) {
                ogImageSecondary = createMetaTag('property', 'og:image', chainLogos[selectedChain] || 'https://xynapseai.net/explorer.png');
            }
            ogImageSecondary.setAttribute('content', chainLogos[selectedChain] || 'https://xynapseai.net/explorer.png');
            const currentUrl = `${origin}${basePath}?query=${encodeURIComponent(query)}&chain=${selectedChain}`;
            const ogUrl = document.querySelector('meta[property="og:url"]');
            if (ogUrl) ogUrl.setAttribute('content', currentUrl);
            let canonical = document.querySelector('link[rel="canonical"]');
            if (canonical) {
                canonical.setAttribute('href', currentUrl);
            } else {
                canonical = document.createElement('link');
                canonical.rel = 'canonical';
                canonical.href = currentUrl;
                document.head.appendChild(canonical);
            }
        } else {
            document.title = 'Blockchain Explorer - Search Transactions | Xynapse';
            const metaTag = document.querySelector('meta[name="description"]');
            if (metaTag) {
                metaTag.setAttribute('content', 'Xynapse Explorer: Search and analyze transactions on Bitcoin, Ethereum, BSC, and Solana blockchains. Real-time data, nametags, and insights.');
            }
            const ogImage = document.querySelector('meta[property="og:image"]') || createMetaTag('property', 'og:image', 'https://xynapseai.net/explorer.png');
            ogImage.setAttribute('content', 'https://xynapseai.net/explorer.png');
            const defaultUrl = `${origin}${basePath}`;
            const ogUrl = document.querySelector('meta[property="og:url"]');
            if (ogUrl) ogUrl.setAttribute('content', defaultUrl);
            let canonical = document.querySelector('link[rel="canonical"]');
            if (canonical) {
                canonical.setAttribute('href', defaultUrl);
            } else {
                canonical = document.createElement('link');
                canonical.rel = 'canonical';
                canonical.href = defaultUrl;
                document.head.appendChild(canonical);
            }
        }
    }, [results, selectedChain, query, basePath]);
    const createMetaTag = (attr, value, content) => {
        let tag = document.querySelector(`meta[${attr}="${value}"]`);
        if (!tag) {
            tag = document.createElement('meta');
            tag.setAttribute(attr, value);
            document.head.appendChild(tag);
        }
        tag.setAttribute('content', content);
        return tag;
    };
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);
    useEffect(() => {
        if (initialQuery) {
            setQuery(initialQuery);
        }
        if (initialChain) {
            setSelectedChain(initialChain);
        }
    }, [initialQuery, initialChain]);
    useEffect(() => {
        let interval;
        if (loading || nametagsLoading || dashboardLoading) {
            const messages = nametagsLoading ? [
                'Loading nametags...',
                'Resolving addresses...',
                'Fetching labels...',
            ] : dashboardLoading ? [
                'Loading dashboard...',
                'Fetching chain stats...',
                'Connecting to node...',
            ] : [
                'Searching transaction...',
                'Fetching from chain...',
                'Verifying across chains...',
                'Loading details...',
            ];
            interval = setInterval(() => {
                setLogMessages((prev) => {
                    const nextIndex = prev.length % messages.length;
                    return [...prev, { text: messages[nextIndex], id: Date.now() + Math.random() }].slice(-5);
                });
            }, 1500);
        } else if (logMessages.length > 0) {
            setLogMessages([]);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [loading, nametagsLoading, dashboardLoading]);
    const truncateText = (text, start = 5, end = 5) => {
        if (!text || text.length <= start + end) return text;
        return `${text.slice(0, start)}...${text.slice(-end)}`;
    };
    const detectChainForTx = (txHash) => {
        const trimmed = txHash.trim();
        if (trimmed.startsWith('0x') && /^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
            return 'ethereum';
        } else if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
            return 'bitcoin';
        } else if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(trimmed)) {
            return 'solana';
        } else {
            throw new Error('Invalid transaction hash format');
        }
    };
    const copyToClipboard = (text, type = 'Item') => {
        navigator.clipboard.writeText(text).then(() => {
            toast.success(`${type} copied to clipboard!`, { autoClose: 1500, position: 'top-right' });
        }).catch(err => {
            toast.error('Failed to copy', { autoClose: 1500, position: 'top-right' });
            console.error('Copy error:', err);
        });
    };
    const isEVMChain = (chain) => !!nativeSymbols[chain];
    const extractAddresses = (txData, chain) => {
        const addresses = new Set();
        let tx = txData;
        if (Array.isArray(txData)) tx = txData[0];
        const addAddress = (addr) => {
            if (addr) {
                addresses.add(isEVMChain(chain) ? addr.toLowerCase() : addr);
            }
        };
        if (tx.from) addAddress(tx.from);
        if (tx.to) addAddress(tx.to);
        if (isEVMChain(chain)) {
            if (tx.tokenTransfers) {
                tx.tokenTransfers.forEach(t => {
                    addAddress(t.from);
                    addAddress(t.to);
                });
            }
            if (tx.internalTxs && Array.isArray(tx.internalTxs)) {
                tx.internalTxs.forEach(itx => {
                    addAddress(itx.from);
                    addAddress(itx.to);
                });
            }
        } else if (chain === 'bitcoin') {
            if (tx.vin && Array.isArray(tx.vin)) {
                tx.vin.forEach(vin => {
                    addAddress(vin.prevout?.scriptpubkey_address);
                });
            }
            if (tx.vout && Array.isArray(tx.vout)) {
                tx.vout.forEach(vout => {
                    addAddress(vout.scriptpubkey_address);
                });
            }
        } else if (chain === 'solana') {
            if (tx.feePayer) addAddress(tx.feePayer);
            if (tx.nativeTransfers) {
                tx.nativeTransfers.forEach(t => {
                    addAddress(t.fromUserAccount);
                    addAddress(t.toUserAccount);
                });
            }
            if (tx.tokenTransfers) {
                tx.tokenTransfers.forEach(t => {
                    addAddress(t.fromUserAccount);
                    addAddress(t.toUserAccount);
                });
            }
            if (tx.accountData) {
                tx.accountData.forEach(acc => {
                    addAddress(acc.account);
                });
            }
        }
        return Array.from(addresses).slice(0, 200);
    };
    const fetchNametags = async (addresses, chain) => {
        if (addresses.length === 0) return;
        setNametagsLoading(true);
        try {
            const res = await fetch('/api/nametags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chain, addresses }),
            });
            if (!res.ok) throw new Error(`Nametags API error: ${res.status}`);
            const { data } = await res.json();
            const newNametags = {};
            Object.entries(data).forEach(([addr, info]) => {
                if (info.Labels.deposit['Name Tag'] !== 'Unknown') {
                    newNametags[addr] = info.Labels.deposit;
                }
            });
            setNametags(prev => ({ ...prev, ...newNametags }));
        } catch (err) {
            console.error('Nametags fetch error:', err);
        } finally {
            setNametagsLoading(false);
        }
    };
    const fetchData = async (q, ch, fallbackIndex = 0) => {
        setLoading(true);
        setError(null);
        try {
            let data = {};
            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            };
            const config = chainConfig[ch];
            if (!config) throw new Error(`Unsupported chain: ${ch}`);
            let endpoint = config.apiBase;
            let body;
            if (config.apiBase === '/api/etherscan-explorer') {
                body = { action: 'tx-details', txHash: q };
                if (selectedChain) body.chain = selectedChain;
            } else if (ch === 'bitcoin') {
                body = { action: 'tx-details', txHash: q };
            } else if (ch === 'solana') {
                body = { action: 'tx-details', txHash: q };
            } else {
                throw new Error('Unsupported chain for tx');
            }
            fetchOptions.body = JSON.stringify(body);
            const res = await fetch(endpoint, fetchOptions);
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const resJson = await res.json();
            if (ch === 'bitcoin' || isEVMChain(ch) || ch === 'solana') {
                if (!resJson.success) throw new Error(resJson.detail || 'Transaction not found');
                data = resJson.data;
            } else {
                data = resJson;
            }
            const detectedChain = data.detectedChain || ch;
            setResults({ data, chain: detectedChain });
            setSelectedChain(detectedChain);
            const addresses = extractAddresses(data, detectedChain);
            if (addresses.length > 0) {
                await fetchNametags(addresses, detectedChain);
            }
        } catch (err) {
            if (isEVMChain(ch) && err.message.includes('not found') && fallbackIndex < evmChainsOrder.length - 1 && !selectedChain) {
                const nextChain = evmChainsOrder[fallbackIndex + 1];
                await fetchData(q, nextChain, fallbackIndex + 1);
                return;
            }
            let userMsg = err.message;
            if (ch === 'bitcoin' && (err.message.includes('timeout') || err.message.includes('AbortError'))) {
                userMsg = 'Bitcoin query timeout (network lag), retrying in 2s...';
                setTimeout(() => fetchData(q, ch), 2000);
                return;
            }
            if (isEVMChain(ch) && fallbackIndex === evmChainsOrder.length - 1) {
                userMsg = 'Transaction not found on supported EVM chains';
            }
            setError(userMsg);
        } finally {
            setLoading(false);
        }
    };
    const handleSearch = () => {
        if (!query.trim()) return;
        try {
            const ch = selectedChain || detectChainForTx(query);
            setSelectedChain(ch);
            setNametags({});
            router.push(`/dashboard?tab=explorer&query=${encodeURIComponent(query)}&chain=${ch}`, { scroll: false });
            fetchData(query, ch, 0);
        } catch (err) {
            setError(err.message);
        }
    };
    useEffect(() => {
        const q = initialQuery || searchParams.get('query');
        const ch = initialChain || searchParams.get('chain');
        if (q) {
            setQuery(q);
            if (ch) {
                setSelectedChain(ch);
                fetchData(q, ch, 0);
            } else {
                handleSearch();
            }
        }
    }, [initialQuery, initialChain]);
    const renderAddress = (addr, chain) => {
        if (!addr || addr === 'Coinbase' || addr === 'Multiple Inputs' || addr === 'Multiple Outputs') {
            return <span className="font-mono break-all text-[10px] sm:text-[12px]">{addr}</span>;
        }
        if (!addr) {
            return <span className="font-mono text-gray-500 text-[10px] sm:text-[12px]">N/A</span>; // Sửa: Không hiển thị "Unknown", thay bằng "N/A"
        }
        const normalized = addr.toLowerCase();
        const tag = nametags[normalized];
        const displayAddr = truncateText(addr, 5, 5);
        const copyContent = addr; // Always copy the full address
        if (addr.includes(', ')) {
            return <span className="font-mono break-all text-[10px] sm:text-[12px]">Multiple ({addr.split(', ').length})</span>;
        }
        if (tag && tag['Name Tag']) {
            return (
                <div className="flex items-center gap-1 relative group">
                    {tag.image && <img src={tag.image} alt={tag['Name Tag']} className="w-3 h-3 mr-1 rounded-full" />}
                    <span className="font-mono break-all text-[10px] sm:text-[12px]">{tag['Name Tag']}</span>
                    <Copy
                        className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(copyContent, 'Address'); }}
                    />
                </div>
            );
        } else {
            return (
                <div className="flex items-center gap-1 relative group">
                    <span className="font-mono break-all text-[10px] sm:text-[12px]">{displayAddr}</span>
                    <Copy
                        className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(copyContent, 'Address'); }}
                    />
                </div>
            );
        }
    };
    const formatUSD = (value) => {
        if (value == null || isNaN(value)) return '$0.00';
        if (value === 0) return '$0.00';
        if (value < 0.01) {
            const fixed = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
            return `$${fixed}`;
        } else {
            return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
    };
    const formatToken = (value, symbol) => {
        if (value == null || isNaN(value)) return `0 ${symbol}`;
        if (value === 0) return `0 ${symbol}`;
        let precision = 2;
        if (value < 0.0001) precision = 8;
        else if (value < 0.01) precision = 6;
        else if (value < 1) precision = 4;
        const fixed = value.toFixed(precision).replace(/0+$/, '').replace(/\.$/, '');
        return `${fixed} ${symbol}`;
    };
    const renderValueWithUSD = (tokenValue, usdValue, symbol, logoUrl = null, isToken = false) => {
        tokenValue = Number(tokenValue);
        const nativeLogo = nativeTokenLogos[symbol] || logoUrl || chainLogos['ethereum'];
        const formattedUSD = formatUSD(usdValue);
        const logoElement = nativeLogo ? (
            <img
                src={nativeLogo}
                alt={symbol}
                className="w-4 h-4 mr-1 rounded-full"
                onError={(e) => {
                    e.target.src = `https://via.placeholder.com/16?text=${symbol}`;
                    e.target.alt = `${symbol} Logo`;
                }}
            />
        ) : null;
        if (!usdValue || usdValue === 0) return (
            <span className="flex items-center text-[10px] sm:text-[12px]">
                {logoElement}
                {formatToken(tokenValue, symbol)}
            </span>
        );
        return (
            <span className="flex items-center text-[10px] sm:text-[12px]">
                {logoElement}
                {formatToken(tokenValue, symbol)}
                <span className="ml-1 text-[9px] text-green-400">({formattedUSD})</span>
                {isToken && <span className="ml-1 text-[9px] text-gray-400">(Tokens)</span>}
            </span>
        );
    };
    const renderTokenAmount = (amount, symbol, logo) => (
        <span className="flex items-center text-[10px] sm:text-[12px]">
            <img
                src={logo || `https://via.placeholder.com/16?text=${symbol || 'T'}`}
                alt={`${symbol || 'Token'} Logo`}
                className="w-4 h-4 mr-1 rounded-full"
                onError={(e) => {
                    e.target.src = `https://via.placeholder.com/16?text=${symbol || 'T'}`;
                }}
            />
            {formatToken(Number(amount), symbol || '')}
        </span>
    );
    const renderTxDetails = (txData, chain) => {
        let tx = txData;
        if (Array.isArray(txData)) tx = txData[0];
        const detectedChain = txData.detectedChain || chain;
        if (isEVMChain(detectedChain)) {
            const transaction = txData.transaction;
            const receipt = txData.receipt;
            const block = txData.block || null;
            const internalTxs = Array.isArray(txData.internalTxs) ? txData.internalTxs : [];
            const tokenTransfers = Array.isArray(txData.tokenTransfers) ? txData.tokenTransfers : [];
            const isConfirmed = (receipt && receipt.blockNumber) || (transaction && transaction.blockNumber);
            let status = 'Pending';
            let isSuccess = false;
            if (isConfirmed) {
                const receiptStatus = receipt ? parseInt(receipt.status || '0x0', 16) : 0;
                status = receiptStatus === 1 ? 'Success' : 'Failed';
                isSuccess = status === 'Success';
            }
            const blockNumber = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;
            const timestamp = block ? parseInt(block.timestamp || '0x0', 16) * 1000 : Date.now();
            const gasUsed = receipt ? (parseInt(receipt.gasUsed || '0x0', 16) || 0) : 0;
            const effectiveGasPrice = receipt
                ? (parseInt(receipt.effectiveGasPrice || transaction.gasPrice || '0x0', 16) || 0)
                : (parseInt(transaction.gasPrice || '0x0', 16) || 0);
            const fee = (gasUsed * effectiveGasPrice) / 1e18;
            const nativeValue = Number(parseInt(transaction.value || '0x0', 16)) / 1e18;
            const symbol = nativeSymbols[detectedChain] || 'ETH';
            // Bổ sung: Lấy giá từ chainStats
            const nativePrice = chainStats.nativePrice || 0; // <--- Truy cập chainStats
            // Bổ sung: Tính toán USD
            const nativeValueUSD = nativeValue * nativePrice;
            const feeUSD = fee * nativePrice;
            txData.nativeValueUSD = nativeValueUSD; // <-- Cập nhật lại
            txData.feeUSD = feeUSD;
            tx = { ...transaction, receipt, internalTxs, tokenTransfers };
            return (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4 text-[10px] sm:text-[12px]"
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center justify-between relative group">
                            <div className="flex items-center">
                                <HashIcon className="w-4 h-4 text-emerald-400 mr-2" />
                                <span className="text-[#D4D4D4] mr-2">Hash:</span>
                                <span className="font-mono break-all mr-2 text-[9px] sm:text-[10px]">{isMobile && tx.hash.length > 10 ? truncateText(tx.hash) : tx.hash}</span>
                            </div>
                            <Copy
                                className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 cursor-pointer text-gray-400 hover:text-emerald-400 absolute right-2 top-1/2 -translate-y-1/2"
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(tx.hash, 'Transaction Hash'); }}
                            />
                            <h2 className="text-[9px] font-semibold flex items-center gap-2">
                                <img src={chainLogos[detectedChain]} alt={detectedChain} className="w-5 h-5 rounded-full" />
                                <span className="text-[#D4D4D4]">{detectedChain.toUpperCase()}</span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                            <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Status:</span>
                            <div className="flex items-center">
                                <span className={isSuccess ? 'text-green-500' : status === 'Pending' ? 'text-yellow-500' : 'text-red-400'}>{status}</span>
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                                    {isSuccess ? <Check className="w-3 h-3 text-black" /> : status === 'Pending' ? <Clock className="w-3 h-3 text-black" /> : <X className="w-3 h-3 text-black" />}
                                </div>
                            </div>
                        </div>
                        {tokenTransfers.length === 0 && (
                            <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                                <Coins className="w-4 h-4 text-emerald-400 mr-2" />
                                <span className="text-[#D4D4D4] mr-2">Value:</span>
                                <div className="flex flex-col">
                                    <div className="flex items-center flex-wrap gap-1">
                                        {renderValueWithUSD(nativeValue, txData.nativeValueUSD, symbol, null)}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className={`bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center ${blockNumber ? 'justify-between' : ''}`}>
                            {blockNumber && (
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-emerald-400 mr-1" />
                                    <span>Block: {blockNumber}</span>
                                </div>
                            )}
                            <span className="flex items-center"><Clock className="w-4 h-4 text-emerald-400 mr-1" />{status === 'Pending' ? 'Submitted: ' : 'Time: '} {new Date(timestamp).toLocaleString()}</span>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">From:</span>
                            <div className="flex items-center ml-2 relative group">
                                {renderAddress(tx.from, detectedChain)}
                                <Copy
                                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 w-4 h-4 cursor-pointer text-gray-400 hover:text-emerald-400 absolute right-0 top-1/2 -translate-y-1/2"
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(tx.from, 'From Address'); }}
                                />
                            </div>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">To:</span>
                            <div className="flex items-center ml-2 relative group">
                                {renderAddress(tx.to, detectedChain)}
                                <Copy
                                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 w-4 h-4 cursor-pointer text-gray-400 hover:text-emerald-400 absolute right-0 top-1/2 -translate-y-1/2"
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(tx.to, 'To Address'); }}
                                />
                            </div>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                            <Fuel className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Fee:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(fee, txData.feeUSD, symbol, null)}
                            </div>
                        </div>
                    </div>
                    {tokenTransfers.length > 0 && (
                        <div className="mt-4">
                            <h3 className="text-[12px] font-semibold flex items-center uppercase"><Coins className="w-4 h-4 mr-2 text-emerald-400" />Token Transfers</h3>
                            <div className="w-full border border-[#FFFFFF20] mt-2 rounded-xl overflow-hidden">
                                <div className="bg-[#0A0A0A]/80 grid grid-cols-5 px-3 py-2 text-[9px] font-semibold text-[#FFF]">
                                    <span className="text-left">Token</span>
                                    <span className="text-left">From</span>
                                    <span className="text-left">To</span>
                                    <span className="text-left">Amount</span>
                                    <span className="text-left">USD Value</span>
                                </div>
                                {tokenTransfers.map((t, i) => {
                                    const amount = Number(t.amount || (BigInt(t.value || 0) / 10n ** BigInt(t.decimals || 18)));
                                    return (
                                        <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="hover:bg-[#FFFFFF]/10 grid grid-cols-5 px-3 py-2 border-t border-[#FFFFFF20] text-[10px]">
                                            <div className="flex items-center">
                                                <img
                                                    src={t.logo || `https://via.placeholder.com/16?text=${t.symbol || 'T'}`}
                                                    alt={`${t.symbol || t.name || 'Token'} Logo`}
                                                    className="w-4 h-4 mr-1 rounded-full"
                                                    onError={(e) => { e.target.src = `https://via.placeholder.com/16?text=${t.symbol || 'T'}`; }}
                                                />
                                                <span>{t.symbol || t.name || (t.type === 'ERC721' ? `${t.name} (ID: ${t.tokenId})` : t.tokenAddress?.slice(0, 2) + '...')}</span>
                                            </div>
                                            <div>{renderAddress(t.from, detectedChain)}</div>
                                            <div>{renderAddress(t.to, detectedChain)}</div>
                                            <div>
                                                {renderTokenAmount(amount, t.symbol || '', t.logo)}
                                            </div>
                                            <div>
                                                {t.valueUSD !== null && t.valueUSD !== undefined ? (
                                                    <span className="text-[9px] text-green-400">
                                                        {formatUSD(t.valueUSD)}
                                                    </span>
                                                ) : 'N/A'}
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {tx.input && (
                        <div>
                            <h4 className="flex items-center text-[12px] font-semibold"><Activity className="w-4 h-4 mr-1" />Input Data</h4>
                            <pre className="text-[9px] bg-[#0A0A0A]/80 p-2 rounded-xl overflow-auto max-h-40 custom-scrollbar">{tx.input}</pre>
                        </div>
                    )}
                    {receipt?.logs && (
                        <div>
                            <h4 className="flex items-center text-[12px] font-semibold"><Activity className="w-4 h-4 mr-1" />Logs</h4>
                            <pre className="text-[9px] bg-[#0A0A0A]/80 p-2 rounded-xl overflow-auto max-h-40 custom-scrollbar">{JSON.stringify(receipt.logs, null, 2)}</pre>
                        </div>
                    )}
                    {internalTxs.length > 0 && (
                        <div>
                            <h4 className="flex items-center text-[12px] font-semibold"><Activity className="w-4 h-4 mr-1" />Internal Transactions</h4>
                            <pre className="text-[9px] bg-[#0A0A0A]/80 p-2 rounded-xl overflow-auto max-h-40 custom-scrollbar">
                                {internalTxs.map((itx, idx) => (
                                    <div key={idx}>
                                        From: {renderAddress(itx.from, detectedChain)} | To: {renderAddress(itx.to, detectedChain)} | Value: {renderValueWithUSD(Number(itx.value || 0) / 1e18, itx.valueUSD || 0, symbol, null)}
                                    </div>
                                ))}
                            </pre>
                        </div>
                    )}
                </motion.div>
            );
        } else if (chain === 'bitcoin') {
            const isConfirmed = tx.status?.confirmed || tx.status?.block_height > 0;
            const status = isConfirmed ? 'Success' : 'Pending';
            const timestamp = tx.status?.block_time ? tx.status.block_time * 1000 : Date.now();
            const totalValue = tx.vout ? tx.vout.reduce((sum, out) => sum + (out.value || 0), 0) / 1e8 : 0;
            const fee = (tx.fee || 0) / 1e8;
            const fromAddress = tx.vin?.length > 1 ? 'Multiple Inputs' : (tx.vin?.[0]?.prevout?.scriptpubkey_address || null);
            const toAddress = tx.vout?.length > 1 ? 'Multiple Outputs' : (tx.vout?.[0]?.scriptpubkey_address || null);
            const blockNumber = tx.status?.block_height || null;
            const totalValueUSD = tx.valueUSD || 0;
            const feeUSD = tx.feeUSD || 0;
            tx.hash = tx.txid;
            tx.status = status;
            tx.timestamp = timestamp;
            tx.value = totalValue;
            tx.fee = fee;
            tx.from = fromAddress;
            tx.to = toAddress;
            tx.blockNumber = blockNumber;
            const isSuccess = isConfirmed;
            return (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 text-[10px] sm:text-[12px]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center justify-between relative group">
                            <div className="flex items-center">
                                <HashIcon className="w-4 h-4 text-emerald-400 mr-2" />
                                <span className="text-[#D4D4D4] mr-2">Hash:</span>
                                <span className="font-mono break-all mr-2 text-[9px] sm:text-[10px]">{isMobile && tx.hash.length > 10 ? truncateText(tx.hash) : tx.hash}</span>
                            </div>
                            <Copy
                                className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 cursor-pointer text-gray-400 hover:text-emerald-400 absolute right-2 top-1/2 -translate-y-1/2"
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(tx.hash, 'Transaction Hash'); }}
                            />
                            <h2 className="text-[9px] font-semibold flex items-center gap-2">
                                <img src={chainLogos[chain]} alt={chain} className="w-5 h-5 rounded-full" />
                                <span className="text-[#D4D4D4]">{chain.toUpperCase()}</span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Status:</span>
                            <div className="flex items-center">
                                <span className={isSuccess ? 'text-green-500' : status === 'Pending' ? 'text-yellow-500' : 'text-red-400'}>{status}</span>
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                                    {isSuccess ? <Check className="w-3 h-3 text-black" /> : status === 'Pending' ? <Clock className="w-3 h-3 text-black" /> : <X className="w-3 h-3 text-black" />}
                                </div>
                            </div>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Coins className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Value:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(totalValue, totalValueUSD, 'BTC', nativeTokenLogos['BTC'])}
                            </div>
                        </div>
                        {blockNumber && (
                            <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center justify-between">
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-emerald-400 mr-1" />
                                    <span>Block: {blockNumber}</span>
                                </div>
                                <span className="flex items-center"><Clock className="w-4 h-4 mr-1" /> {new Date(timestamp).toLocaleString()}</span>
                            </div>
                        )}
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">From:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(fromAddress, chain)}
                                {fromAddress && fromAddress !== 'Multiple Inputs' && <Copy onClick={() => copyToClipboard(fromAddress)} className="ml-2 w-4 h-4 cursor-pointer hover:text-emerald-400" />}
                            </div>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">To:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(toAddress, chain)}
                                {toAddress && toAddress !== 'Multiple Outputs' && <Copy onClick={() => copyToClipboard(toAddress)} className="ml-2 w-4 h-4 cursor-pointer hover:text-emerald-400" />}
                            </div>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Fee:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(fee, feeUSD, 'BTC', nativeTokenLogos['BTC'])}
                            </div>
                        </div>
                    </div>
                    {tx.vin && tx.vin.length > 0 && (
                        <div>
                            <h4 className="flex items-center"><Wallet className="w-4 h-4 mr-1" />Inputs</h4>
                            <table className="w-full border-collapse border border-[#FFFFFF20]">
                                <thead><tr><th className="text-left">From</th><th className="text-left">Value</th></tr></thead>
                                <tbody>
                                    {tx.vin.map((input, i) => (
                                        <tr key={i}>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">{renderAddress(input.prevout?.scriptpubkey_address || 'Coinbase', chain)}</td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                <div className="flex flex-col">
                                                    {renderValueWithUSD((input.prevout?.value || 0) / 1e8, input.prevout?.valueUSD || 0, 'BTC', nativeTokenLogos['BTC'])}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {tx.vout && tx.vout.length > 0 && (
                        <div>
                            <h4 className="flex items-center"><Wallet className="w-4 h-4 mr-1" />Outputs</h4>
                            <table className="w-full border-collapse border border-[#FFFFFF20]">
                                <thead><tr><th className="text-left">To</th><th className="text-left">Value</th></tr></thead>
                                <tbody>
                                    {tx.vout.map((output, i) => (
                                        <tr key={i}>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">{renderAddress(output.scriptpubkey_address || 'OP_RETURN', chain)}</td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                <div className="flex flex-col">
                                                    {renderValueWithUSD((output.value || 0) / 1e8, output.valueUSD || 0, 'BTC', nativeTokenLogos['BTC'])}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </motion.div>
            );
        } else if (chain === 'solana') { // Fix: Xóa duplicate else if rỗng ở trên
            const status = tx.status || 'Success';
            const isSuccess = tx.isSuccess || status === 'Success';
            const timestamp = tx.timestamp || Date.now();
            const symbol = 'SOL';
            const nativeValue = tx.nativeValue || 0;
            const nativeValueUSD = tx.nativeValueUSD || 0;
            const fee = tx.fee || 0;
            const feeUSD = tx.feeUSD || 0;
            const tokenTransfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : []; // FIXED: Ensure array
            const nativeTransfers = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : []; // FIXED: Ensure array
            const solPrice = tx.solPrice || 0;
            return (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 text-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center justify-between">
                            <div className="flex items-center">
                                <HashIcon className="w-4 h-4 text-emerald-400 mr-2" />
                                <span className="text-[#D4D4D4] mr-2">Hash:</span>
                                <span className="font-mono break-all mr-2">{isMobile && tx.hash?.length > 10 ? truncateText(tx.hash) : tx.hash}</span>
                                <Copy onClick={() => copyToClipboard(tx.hash)} className="w-4 h-4 cursor-pointer hover:text-emerald-400" />
                            </div>
                            <h2 className="text-xs font-semibold flex items-center gap-2">
                                <img src={chainLogos[chain]} alt={chain} className="w-6 h-6 inline mx-1" />
                                <span className="text-[#D4D4D4]">{chain.toUpperCase()}</span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Status:</span>
                            <div className="flex items-center">
                                <span className={isSuccess ? 'text-green-500' : status === 'Pending' ? 'text-yellow-500' : 'text-red-400'}>{status}</span>
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                                    {isSuccess ? <Check className="w-3 h-3 text-black" /> : status === 'Pending' ? <Clock className="w-3 h-3 text-black" /> : <X className="w-3 h-3 text-black" />}
                                </div>
                            </div>
                        </div>
                        {nativeValue > 0 && (
                            <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                                <Coins className="w-4 h-4 text-emerald-400 mr-2" />
                                <span className="text-[#D4D4D4] mr-2">Value:</span>
                                <div className="flex flex-col">
                                    {renderValueWithUSD(nativeValue, nativeValueUSD, symbol, nativeTokenLogos['SOL'])}
                                </div>
                            </div>
                        )}
                        <div className={`bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center ${tx.blockNumber ? 'justify-between' : ''}`}>
                            {tx.blockNumber && (
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-emerald-400 mr-1" />
                                    <span>Slot: {tx.blockNumber}</span>
                                </div>
                            )}
                            <span className="flex items-center"><Clock className="w-4 h-4 text-emerald-400 mr-1" />Time: {new Date(timestamp).toLocaleString()}</span>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">From:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(tx.from, chain)}
                                <Copy onClick={() => copyToClipboard(tx.from)} className="ml-2 w-4 h-4 cursor-pointer hover:text-emerald-400" />
                            </div>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">To:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(tx.to, chain)}
                                <Copy onClick={() => copyToClipboard(tx.to)} className="ml-2 w-4 h-4 cursor-pointer hover:text-emerald-400" />
                            </div>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Fee:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(fee, feeUSD, symbol, nativeTokenLogos['SOL'])}
                            </div>
                        </div>
                    </div>
                    {tokenTransfers.length > 0 && (
                        <div className="mt-4">
                            <h3 className="text-md font-semibold flex items-center uppercase"><Coins className="w-4 h-4 mr-2 text-emerald-400" />Token Transfers</h3>
                            <table className="w-full border-collapse border border-[#FFFFFF20] mt-2">
                                <thead>
                                    <tr className="bg-[#0A0A0A]/80">
                                        <th className="p-2 text-left">Token</th>
                                        <th className="p-2 text-left">From</th>
                                        <th className="p-2 text-left">To</th>
                                        <th className="p-2 text-left">Amount</th>
                                        <th className="p-2 text-left">USD Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tokenTransfers.map((t, i) => (
                                        <tr key={i} className="hover:bg-[#FFFFFF]/10">
                                            <td className="p-2 border border-[#FFFFFF20] text-left flex items-center">
                                                <img
                                                    src={t.logo || `https://via.placeholder.com/16?text=${t.symbol || 'T'}`}
                                                    alt={`${t.symbol || t.name || 'Token'} Logo`} // FIXED: Better alt
                                                    className="w-6 h-6 mr-1 rounded"
                                                    onError={(e) => { e.target.src = `https://via.placeholder.com/16?text=${t.symbol || 'T'}`; }}
                                                />
                                                {t.symbol || t.name || t.mint?.slice(0, 4) + '...'}
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">{renderAddress(t.fromUserAccount || t.from, chain)}</td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">{renderAddress(t.toUserAccount || t.to, chain)}</td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                {renderTokenAmount(t.amount || 0, t.symbol || '', t.logo)}
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                {t.valueUSD !== null && t.valueUSD !== undefined ? (
                                                    <span className="flex items-center text-xs text-green-400">
                                                        {formatUSD(t.valueUSD)}
                                                    </span>
                                                ) : 'N/A'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <h3 className="text-md font-semibold flex items-center mt-4 uppercase"><Activity className="w-4 h-4 mr-2 text-emerald-400" />Native Transfers</h3>
                    {nativeTransfers.length > 0 && (
                        <div>
                            <table className="w-full border-collapse border border-[#FFFFFF20]">
                                <thead><tr><th className="p-2 text-left">From</th><th className="p-2 text-left">To</th><th className="p-2 text-left">Amount</th></tr></thead>
                                <tbody>
                                    {nativeTransfers.map((transfer, i) => (
                                        <tr key={i} className="hover:bg-[#FFFFFF]/10">
                                            <td className="p-2 border border-[#FFFFFF20] text-left">{renderAddress(transfer.fromUserAccount, chain)}</td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">{renderAddress(transfer.toUserAccount, chain)}</td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                {renderValueWithUSD((transfer.amount || 0) / 1e9, ((transfer.amount || 0) / 1e9) * solPrice, symbol, nativeTokenLogos['SOL'])}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {tx.instructions && (
                        <div>
                            <h4 className="flex items-center"><Activity className="w-4 h-4 mr-1" />Instructions</h4>
                            <pre className="text-xs bg-[#0A0A0A]/80 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{JSON.stringify(tx.instructions, null, 2)}</pre>
                        </div>
                    )}
                </motion.div>
            );
        }
        return <div>Unsupported chain</div>;
    };
    const isOverallLoading = loading || nametagsLoading || dashboardLoading;
    const currentBlocks = latestBlocks.slice((blocksPage - 1) * itemsPerPage, blocksPage * itemsPerPage);
    const totalBlocksPages = Math.ceil(latestBlocks.length / itemsPerPage);
    const currentTxs = latestTxs.slice((txsPage - 1) * itemsPerPage, txsPage * itemsPerPage);
    const totalTxsPages = Math.ceil(latestTxs.length / itemsPerPage);
    const SkeletonBlockRow = ({ index }) => (
        <motion.div
            key={`skeleton-block-${index}`}
            className="flex hover:bg-[#FFFFFF]/10 transition-all duration-200 py-2 border-t border-[#FFFFFF20]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className="w-1/4 px-3 flex items-center gap-2">
                <div className="w-4 h-4 bg-[#FFFFFF]/10 rounded animate-pulse" />
                <div className="w-12 h-2 bg-[#FFFFFF]/10 rounded animate-pulse" />
            </div>
            <div className="w-1/4 px-3">
                <div className="w-16 h-2 bg-[#FFFFFF]/10 rounded animate-pulse" />
            </div>
            <div className="w-1/4 px-3">
                <div className="w-12 h-2 bg-[#FFFFFF]/10 rounded animate-pulse" />
            </div>
            <div className="w-1/4 px-3">
                <div className="w-20 h-2 bg-[#FFFFFF]/10 rounded animate-pulse" />
            </div>
        </motion.div>
    );
    const SkeletonTxRow = ({ index }) => (
        <motion.div
            key={`skeleton-tx-${index}`}
            className="flex hover:bg-[#FFFFFF]/10 transition-all duration-200 py-2 border-t border-[#FFFFFF20]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className="w-1/4 px-3 relative group">
                <div className="w-20 h-2 bg-[#FFFFFF]/10 rounded animate-pulse" />
                <Copy className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-3 h-3 cursor-pointer text-gray-400" />
            </div>
            <div className="w-1/4 px-3 relative group">
                <div className="w-16 h-2 bg-[#FFFFFF]/10 rounded animate-pulse" />
                <Copy className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-3 h-3 cursor-pointer text-gray-400" />
            </div>
            <div className="w-1/4 px-3 relative group">
                <div className="w-16 h-2 bg-[#FFFFFF]/10 rounded animate-pulse" />
                <Copy className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-3 h-3 cursor-pointer text-gray-400" />
            </div>
            <div className="w-1/4 px-3">
                <div className="w-12 h-2 bg-[#FFFFFF]/10 rounded animate-pulse" />
            </div>
        </motion.div>
    );
    const renderBlockRow = (block, index) => (
        <motion.div
            key={block.number}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex hover:bg-[#FFFFFF]/10 transition-all duration-200 py-2 px-3 border-t border-[#FFFFFF20] text-[10px] relative group"
        >
            <span className="w-1/4 flex items-center gap-2">
                <HashIcon className="w-3 h-3 text-emerald-400" />
                {block.number}
            </span>
            <span className="w-1/4">{new Date(block.timestamp * 1000).toLocaleTimeString()}</span>
            <span className="w-1/4">{block.transactions.length}</span>
            <span className="w-1/4 font-mono relative group">
                {renderAddress(block.miner, selectedChain)}
                <Copy
                    className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(block.miner, 'Miner Address'); }}
                />
            </span>
        </motion.div>
    );
    const renderTxRow = (tx, index) => (
        <motion.div
            key={tx.hash}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => {
                setQuery(tx.hash);
                handleSearch();
            }}
            className="flex hover:bg-[#FFFFFF]/10 transition-all duration-200 py-2 px-3 border-t border-[#FFFFFF20] text-[10px] relative group cursor-pointer"
        >
            <span className="w-1/4 font-mono relative group">
                {truncateText(tx.hash)}
                <Copy
                    className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(tx.hash, 'Transaction Hash'); }}
                />
            </span>
            <span className="w-1/4 font-mono relative group">
                {renderAddress(tx.from, selectedChain)}
                <Copy
                    className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(tx.from, 'From Address'); }}
                />
            </span>
            <span className="w-1/4 font-mono relative group">
                {renderAddress(tx.to, selectedChain)}
                <Copy
                    className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(tx.to, 'To Address'); }}
                />
            </span>
            <span className="w-1/4">{formatToken((tx.value || 0), chainSymbols[selectedChain] || 'Native')}</span>
        </motion.div>
    );
    const renderPagination = (page, setPage, totalPages) => (
        <div className="flex justify-center gap-2 mt-2">
            <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-2 py-1 text-[10px] bg-[#FFFFFF]/10 rounded disabled:opacity-50"
            >
                Prev
            </button>
            <span className="px-2 py-1 text-[10px]">{page} / {totalPages}</span>
            <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-2 py-1 text-[10px] bg-[#FFFFFF]/10 rounded disabled:opacity-50"
            >
                Next
            </button>
        </div>
    );
    const renderDashboard = () => (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3 bg-[#FFFFFF]/5 backdrop-blur-md p-4 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200">
                    <h3 className="flex items-center text-[12px] font-semibold text-[#FFF] mb-3">
                        <img src={chainLogos[selectedChain]} alt={selectedChain} className="w-5 h-5 mr-2 rounded-full" />
                        {selectedChain.toUpperCase()} Blockchain Stats
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[10px]">
                        <div className="flex items-center">
                            <HashIcon className="w-3 h-3 mr-1 text-emerald-400" />
                            <span className="text-[#D4D4D4]">Block Height:</span>
                            <span className="ml-1 text-[#FFF]">{chainStats.blockNumber}</span>
                        </div>
                        <div className="flex items-center">
                            <Fuel className="w-3 h-3 mr-1 text-emerald-400" />
                            <span className="text-[#D4D4D4]">Gas Price:</span>
                            <span className="ml-1 text-[#FFF]">{Number(chainStats.gasPrice) / 1e9} Gwei</span>
                        </div>
                        <div className="flex items-center">
                            <img src={nativeTokenLogos[nativeSymbols[selectedChain]] || chainLogos[selectedChain]} alt={nativeSymbols[selectedChain]} className="w-3 h-3 mr-1 rounded-full" />
                            <span className="text-[#D4D4D4]">{nativeSymbols[selectedChain]} Price:</span>
                            <span className="ml-1 text-[#FFF]">${chainStats.nativePrice.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-4 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                    <h2 className="text-[12px] font-bold mb-3 flex items-center uppercase"><HashIcon className="w-4 h-4 mr-2 text-emerald-400" />Latest Blocks</h2>
                    <div className="border border-[#FFFFFF20] rounded-xl overflow-hidden max-h-[24rem] overflow-y-auto">
                        <div className="bg-[#0A0A0A]/80 flex px-3 py-2 text-[9px] font-semibold text-[#FFF] sticky top-0">
                            <span className="w-1/4 text-left">Block</span>
                            <span className="w-1/4 text-left">Age</span>
                            <span className="w-1/4 text-left">Tx Count</span>
                            <span className="w-1/4 text-left">Miner</span>
                        </div>
                        <AnimatePresence>
                            {dashboardLoading ? (
                                Array.from({ length: itemsPerPage }).map((_, i) => <SkeletonBlockRow key={`load-${i}`} index={i} />)
                            ) : (
                                currentBlocks.map((block, i) => renderBlockRow(block, i))
                            )}
                        </AnimatePresence>
                    </div>
                    {totalBlocksPages > 1 && renderPagination(blocksPage, setBlocksPage, totalBlocksPages)}
                </div>
                <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-4 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                    <h2 className="text-[12px] font-bold mb-3 flex items-center uppercase"><Activity className="w-4 h-4 mr-2 text-emerald-400" />Latest Transactions</h2>
                    <div className="border border-[#FFFFFF20] rounded-xl overflow-hidden max-h-[24rem] overflow-y-auto">
                        <div className="bg-[#0A0A0A]/80 flex px-3 py-2 text-[9px] font-semibold text-[#FFF] sticky top-0">
                            <span className="w-1/4 text-left">Hash</span>
                            <span className="w-1/4 text-left">From</span>
                            <span className="w-1/4 text-left">To</span>
                            <span className="w-1/4 text-left">Value</span>
                        </div>
                        <AnimatePresence>
                            {dashboardLoading ? (
                                Array.from({ length: itemsPerPage }).map((_, i) => <SkeletonTxRow key={`load-tx-${i}`} index={i} />)
                            ) : (
                                currentTxs.map((tx, i) => renderTxRow(tx, i))
                            )}
                        </AnimatePresence>
                    </div>
                    {totalTxsPages > 1 && renderPagination(txsPage, setTxsPage, totalTxsPages)}
                </div>
            </div>
        </motion.div>
    );
    return (
        <div className="font-inter w-full max-w-9xl mx-auto p-2 sm:p-3 bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col h-full overflow-y-auto custom-scrollbar relative">
            <ToastContainer position="top-right" autoClose={1500} theme="dark" />
            <LoadingOverlay
                isLoading={isOverallLoading}
                isMobile={isMobile}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] rounded-none"
            />
            <div className="mb-4 relative z-10">
                {/* <h1 className="text-[14px] sm:text-[16px] font-bold flex items-center gap-2 mb-2 uppercase tracking-wider">
                    <img src="/logos/logo.webp" alt="Project Logo" className="w-8 h-8 rounded-xl" />
                    Xynapse Explorer
                </h1> */}
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#D4D4D4]" />
                        <input
                            type="text"
                            placeholder="Enter transaction hash..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full h-[4.5vh] pl-10 pr-4 py-2 text-[#D4D4D4] border border-[#FFFFFF20] rounded-xl bg-[#FFFFFF]/5 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-emerald-400/50 shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] text-[10px] sm:text-[12px]"
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                    </div>
                    <button
                        ref={buttonRef}
                        onClick={() => setIsChainMenuOpen(!isChainMenuOpen)}
                        className="relative h-[4.5vh] px-3 py-1 bg-[#FFFFFF]/5 backdrop-blur-md border border-[#FFFFFF20] text-[#FFF] rounded-xl hover:bg-[#FFFFFF]/10 transition-all duration-200 font-medium shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] flex items-center justify-between text-[10px] sm:text-[12px] min-w-[120px]"
                    >
                        <span className="flex items-center">
                            {selectedChain ? (
                                <>
                                    <img src={chainLogos[selectedChain]} alt={selectedChain} className="w-4 h-4 mr-2 rounded-full" />
                                    {selectedChain.toUpperCase()}
                                </>
                            ) : 'Auto Detect'}
                        </span>
                        <ChevronDown className="w-4 h-4 ml-2" />
                    </button>
                    {isChainMenuOpen && createPortal(
                        <AnimatePresence>
                            <motion.div
                                ref={menuRef}
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                style={{
                                    position: 'absolute',
                                    top: menuPosition.top,
                                    left: menuPosition.left,
                                    width: menuPosition.width,
                                }}
                                className="text-[10px] bg-[#0A0A0A]/90 backdrop-blur-md border border-[#FFFFFF20] rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] overflow-y-auto max-h-60 z-[9999] custom-scrollbar"
                            >
                                <ul>
                                    <li
                                        className="px-3 py-2 hover:bg-[#FFFFFF]/10 cursor-pointer flex items-center text-[#D4D4D4]"
                                        onClick={() => { setSelectedChain(''); setIsChainMenuOpen(false); }}
                                    >
                                        Auto Detect
                                    </li>
                                    {Object.keys(chainConfig).map(ch => (
                                        <li
                                            key={ch}
                                            className="px-3 py-2 hover:bg-[#FFFFFF]/10 cursor-pointer flex items-center text-[#D4D4D4]"
                                            onClick={() => { setSelectedChain(ch); setIsChainMenuOpen(false); }}
                                        >
                                            <img src={chainLogos[ch]} alt={ch} className="w-5 h-5 mr-2 rounded-full" />
                                            {ch.toUpperCase()}
                                        </li>
                                    ))}
                                </ul>
                            </motion.div>
                        </AnimatePresence>,
                        document.body
                    )}
                    <motion.button
                        onClick={handleSearch}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="h-[4.5vh] px-4 py-1 bg-[#FFFFFF]/5 backdrop-blur-md border border-[#FFFFFF20] text-[#FFF] rounded-xl hover:bg-[#FFFFFF]/10 transition-all duration-200 font-medium shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] flex items-center justify-center"
                    >
                        <Search className="w-4 h-4" />
                    </motion.button>
                </div>
            </div>
            {/* {isOverallLoading && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-none"
                >
                    <div className="w-[80%] max-w-lg h-64 bg-[#FFFFFF]/5 backdrop-blur-md border border-[#FFFFFF20] rounded-xl p-6 relative overflow-hidden shadow-2xl animate-pulse">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan" />
                        <div className="absolute inset-0 bg-black/10 backdrop-blur-sm animate-pulse opacity-50" />
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                            <h3 className="text-[#FFF] text-[10px] sm:text-[12px] font-semibold">
                                {nametagsLoading ? 'Loading Nametags' : dashboardLoading ? 'Loading Dashboard' : 'Searching Transaction'}
                            </h3>
                        </div>
                        <div className="h-32 overflow-y-hidden custom-scrollbar log-container relative">
                            <AnimatePresence>
                                {logMessages.map((log, index) => (
                                    <motion.p
                                        key={log.id}
                                        className={`text-[#D4D4D4] text-[9px] sm:text-[10px] font-inter mb-2 ${index === logMessages.length - 1
                                            ? 'text-blue-400 font-semibold animate-pulse'
                                            : 'text-[#D4D4D4]'
                                            }`}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{
                                            opacity: 1,
                                            y: 0,
                                            scale: 1,
                                            transition: {
                                                duration: 0.5,
                                                ease: [0.25, 0.46, 0.45, 0.94],
                                                delay: index * 0.05
                                            }
                                        }}
                                        exit={{
                                            opacity: 0,
                                            y: -20,
                                            scale: 0.95,
                                            transition: { duration: 0.3, ease: 'easeInOut' }
                                        }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        <span className="text-blue-500">&gt;</span> {log.text}
                                    </motion.p>
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                </motion.div>
            )} */}
            {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 flex items-center gap-2 p-4 bg-red-500/10 rounded-xl border border-red-500/20 relative z-10 shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                    <AlertCircle className="w-4 h-4" /> {error}
                </motion.div>
            )}
            <AnimatePresence>
                {results && !error ? (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 relative z-10 p-4">
                        {renderTxDetails(results.data, results.chain)}
                    </motion.div>
                ) : (
                    renderDashboard()
                )}
            </AnimatePresence>
            <style jsx>{`
                .break-all { word-break: break-all; }
                .custom-scrollbar::-webkit-scrollbar {
                  width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                  background: rgba(255, 255, 255, 0.2);
                  border-radius: 3px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                  background: rgba(255, 255, 255, 0.3);
                }
                .log-container {
                  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, white 20%, white 80%, transparent 100%);
                  mask-image: linear-gradient(to bottom, transparent 0%, white 20%, white 80%, transparent 100%);
                }
                @keyframes scan {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(100%); }
                }
                .animate-scan {
                  animation: scan 2s linear infinite;
                }
            `}</style>
        </div>
    );
}