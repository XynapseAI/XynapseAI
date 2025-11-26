// components/ExplorerTab.jsx - Fully synced with MarketTab & ClusterTab (Black/White + Glow + Blur 2025 Style)
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Clock, Hash as HashIcon, AlertCircle, Wallet, Coins, Activity, Check, Copy, X, DollarSign } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

export default function ExplorerTab({ initialQuery, initialChain, isStandalone = false }) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [query, setQuery] = useState(initialQuery || '');
    const [selectedChain, setSelectedChain] = useState(initialChain || '');
    const [results, setResults] = useState(null);
    const [nametags, setNametags] = useState({});
    const [nametagsLoading, setNametagsLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isMobile, setIsMobile] = useState(false);
    const [logMessages, setLogMessages] = useState([]);

    const basePath = isStandalone ? '/explorer' : '/dashboard?tab=explorer';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://xynapseai.net';

    const chainConfig = {
        bitcoin: { id: null, apiBase: '/api/mempool' },
        ethereum: { id: 1, apiBase: '/api/etherscan-explorer' },
        bsc: { id: 56, apiBase: '/api/etherscan-explorer' },
        arbitrum: { id: 42161, apiBase: '/api/etherscan-explorer' },
        optimism: { id: 10, apiBase: '/api/etherscan-explorer' },
        polygon: { id: 137, apiBase: '/api/etherscan-explorer' },
        base: { id: 8453, apiBase: '/api/etherscan-explorer' },
        solana: { id: null, apiBase: '/api/solana' },
        monad: { id: 143, apiBase: '/api/etherscan-explorer' },
    };

    const chainLogos = {
        bitcoin: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
        ethereum: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
        bsc: 'https://assets.coingecko.com/asset_platforms/images/1/standard/bnb_smart_chain.png?1706606721',
        arbitrum: 'https://assets.coingecko.com/coins/images/16547/standard/arb.jpg?1721358242',
        optimism: 'https://assets.coingecko.com/asset_platforms/images/41/standard/optimism.png?1706606778',
        polygon: 'https://assets.coingecko.com/asset_platforms/images/15/standard/polygon_pos.png?1706606645',
        base: 'https://assets.coingecko.com/asset_platforms/images/131/standard/base.png?1759905869',
        solana: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
        avalanche: 'https://assets.coingecko.com/asset_platforms/images/12/standard/avalanche.png?1706606775', // AVAX
        celo: 'https://assets.coingecko.com/asset_platforms/images/21/standard/celo.jpeg?1711358666', // CELO
        gnosis: 'https://assets.coingecko.com/coins/images/662/standard/logo_square_simple_300px.png?1696501854', // GNO (xDAI chain)
        zksync: 'https://assets.coingecko.com/asset_platforms/images/121/standard/zksync.jpeg?1706606814', // ZK
        linea: 'https://assets.coingecko.com/asset_platforms/images/135/standard/linea.jpeg?1706606705', // Linea (L2, dùng project logo)
        abstract: 'https://assets.coingecko.com/asset_platforms/images/22196/standard/abstract.jpg?1735611808', // Abstract (L2, project logo)
        apechain: 'https://assets.coingecko.com/coins/images/34445/small/apechain.png', // ApeChain (dùng APE variant)
        hyperevm: 'https://assets.coingecko.com/coins/images/662/standard/logo_square_simple_300px.png?1696501854', // HyperEVM (project logo)
        monad: 'https://assets.coingecko.com/coins/images/38927/standard/monad.jpg?1719547722', // MON (L1)
        unichain: 'https://assets.coingecko.com/asset_platforms/images/22206/standard/unichain.png?1739323630', // Unichain (L2)
        world: 'https://assets.coingecko.com/asset_platforms/images/22180/standard/Worldcoin-logomark-light.png?1728377966',
    };

    const nativeTokenLogos = {
        ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
        BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb.png',
        MATIC: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
        BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
        SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
        MON: 'https://assets.coingecko.com/coins/images/38927/standard/monad.jpg?1719547722',
    };

    const nativeSymbols = {
        ethereum: 'ETH',
        bsc: 'BNB',
        arbitrum: 'ETH',
        optimism: 'ETH',
        polygon: 'MATIC',
        base: 'ETH',
        monad: 'MON',
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
    };

    const evmChainsOrder = ['ethereum', 'arbitrum', 'bsc', 'optimism', 'polygon', 'base', 'monad'];

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
        if (initialQuery) setQuery(initialQuery);
        if (initialChain) setSelectedChain(initialChain);
    }, [initialQuery, initialChain]);

    useEffect(() => {
        let interval;
        if (loading || nametagsLoading) {
            const messages = nametagsLoading
                ? ['Loading nametags...', 'Resolving addresses...', 'Fetching labels...']
                : ['Searching transaction...', 'Fetching from chain...', 'Verifying across chains...', 'Loading details...'];

            interval = setInterval(() => {
                setLogMessages((prev) => {
                    const nextIndex = prev.length % messages.length;
                    return [...prev, { text: messages[nextIndex], id: Date.now() + Math.random() }].slice(-5);
                });
            }, 1500);
        } else if (logMessages.length > 0) {
            setLogMessages([]);
        }
        return () => interval && clearInterval(interval);
    }, [loading, nametagsLoading]);

    const truncateText = (text, start = 6, end = 4) => {
        if (!text || text.length <= start + end + 3) return text;
        return `${text.slice(0, start)}...${text.slice(-end)}`;
    };

    const detectChainForTx = (txHash) => {
        const trimmed = txHash.trim();
        if (trimmed.startsWith('0x') && /^0x[a-fA-F0-9]{64}$/.test(trimmed)) return 'ethereum';
        if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return 'bitcoin';
        if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(trimmed)) return 'solana';
        throw new Error('Invalid transaction hash format');
    };

    const copyToClipboard = (text) => navigator.clipboard.writeText(text);

    const isEVMChain = (chain) => !!nativeSymbols[chain];

    const extractAddresses = (txData, chain) => {
        const addresses = new Set();
        let tx = txData;
        if (Array.isArray(txData)) tx = txData[0];

        const addAddress = (addr) => addr && addresses.add(isEVMChain(chain) ? addr.toLowerCase() : addr);

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

        return Array.from(addresses).slice(0, 50);
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
            // Silent
        } finally {
            setNametagsLoading(false);
        }
    };

    const fetchData = async (q, ch, fallbackIndex = 0) => {
        setLoading(true);
        setError(null);
        try {
            let data = {};
            const config = chainConfig[ch];
            if (!config) throw new Error(`Unsupported chain: ${ch}`);

            const body = ch === 'bitcoin' || ch === 'solana'
                ? { action: 'tx-details', txHash: q }
                : { action: 'tx-details', chain: ch, txHash: q };

            const res = await fetch(config.apiBase, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const resJson = await res.json();

            if (!resJson.success && ch !== 'solana') throw new Error(resJson.detail || 'Transaction not found');
            data = resJson.data || resJson;

            const detectedChain = data.detectedChain || ch;
            setResults({ data, chain: detectedChain });
            setSelectedChain(detectedChain);

            const addresses = extractAddresses(data, detectedChain);
            if (addresses.length > 0) await fetchNametags(addresses, detectedChain);
        } catch (err) {
            if (isEVMChain(ch) && err.message.includes('not found') && fallbackIndex < evmChainsOrder.length - 1) {
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
            } else handleSearch();
        }
    }, [initialQuery, initialChain]);

    const renderAddress = (addr, chain) => {
        if (!addr || addr === 'Coinbase' || addr === 'Multiple Inputs' || addr === 'Multiple Outputs') {
            return <span className="text-[#D4D4D4]">{addr}</span>;
        }
        const normalized = addr.toLowerCase();
        const tag = nametags[normalized];
        const shortAddr = truncateText(addr, 6, 4);

        return (
            <div className="flex items-center gap-2 group">
                {tag?.image && (
                    <img src={tag.image} alt={tag['Name Tag']} className="w-4 h-4 rounded-full" />
                )}
                <span className="font-medium text-[#FFF]">
                    {tag?.['Name Tag'] && tag['Name Tag'] !== 'Unknown' ? tag['Name Tag'] : shortAddr}
                </span>
                <Copy
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(addr); }}
                    className="w-3.5 h-3.5 text-[#D4D4D4] opacity-0 group-hover:opacity-100 cursor-pointer hover:text-[#FFF] transition-all"
                />
            </div>
        );
    };

    const formatUSD = (value) => {
        if (value == null || isNaN(value)) return '$0.00';
        return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const renderValueWithUSD = (tokenValue, usdValue, symbol, logoUrl = null) => {
        const logo = logoUrl || nativeTokenLogos[symbol] || '/fallback-image.webp';
        if (!usdValue || usdValue === 0) {
            return (
                <div className="flex items-center gap-1.5">
                    <img src={logo} alt={symbol} className="w-4 h-4 rounded-full" />
                    <span>{Number(tokenValue).toFixed(6)} {symbol}</span>
                </div>
            );
        }
        return (
            <div className="flex items-center gap-1.5">
                <img src={logo} alt={symbol} className="w-4 h-4 rounded-full" />
                <span>{Number(tokenValue).toFixed(6)} {symbol}</span>
                <span className="text-emerald-400 text-xs">({formatUSD(usdValue)})</span>
            </div>
        );
    };

    const renderTxDetails = (txData, chain) => {
        let tx = Array.isArray(txData) ? txData[0] : txData;
        const detectedChain = txData.detectedChain || chain;
        const isEVM = isEVMChain(detectedChain);
        const isBTC = detectedChain === 'bitcoin';
        const isSOL = detectedChain === 'solana';

        let isConfirmed = false;
        let status = 'Pending';
        let isSuccess = false;
        let timestamp = Date.now();
        let nativeValue = 0;
        let fee = 0;
        let symbol = chainSymbols[detectedChain] || 'ETH';
        let blockNumber = null;
        let fromAddress = 'Unknown';
        let toAddress = 'Unknown';

        if (isEVM) {
            const transaction = txData.transaction || {};
            const receipt = txData.receipt || {};
            const block = txData.block || {};
            isConfirmed = (receipt.blockNumber || transaction.blockNumber);
            if (isConfirmed) {
                const receiptStatus = receipt ? parseInt(receipt.status || '0x0', 16) : 0;
                status = receiptStatus === 1 ? 'Success' : 'Failed';
                isSuccess = status === 'Success';
            }
            blockNumber = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;
            timestamp = block.timestamp ? parseInt(block.timestamp, 16) * 1000 : Date.now();
            const gasUsed = receipt.gasUsed ? parseInt(receipt.gasUsed, 16) : 0;
            const effectiveGasPrice = receipt.effectiveGasPrice 
                ? parseInt(receipt.effectiveGasPrice, 16)
                : parseInt(transaction.gasPrice || '0x0', 16);
            fee = (gasUsed * effectiveGasPrice) / 1e18;
            nativeValue = Number(parseInt(transaction.value || '0x0', 16)) / 1e18;
            fromAddress = transaction.from || 'Unknown';
            toAddress = transaction.to || 'Unknown';
            tx = { ...transaction, receipt, internalTxs: txData.internalTxs || [], tokenTransfers: txData.tokenTransfers || [] };
        } else if (isBTC) {
            isConfirmed = tx.status?.confirmed || tx.status?.block_height > 0;
            status = isConfirmed ? 'Success' : 'Pending';
            isSuccess = isConfirmed;
            timestamp = tx.status?.block_time ? tx.status.block_time * 1000 : Date.now();
            nativeValue = tx.vout?.reduce((s, o) => s + (o.value || 0), 0) / 1e8 || 0;
            fee = (tx.fee || 0) / 1e8;
            fromAddress = tx.vin?.[0]?.prevout?.scriptpubkey_address || 'Multiple Inputs';
            toAddress = tx.vout?.[0]?.scriptpubkey_address || 'Multiple Outputs';
            blockNumber = tx.status?.block_height || null;
        } else if (isSOL) {
            status = tx.isSuccess !== false ? 'Success' : 'Failed';
            isSuccess = status === 'Success';
            isConfirmed = true; // Solana tx are usually confirmed quickly
            timestamp = tx.timestamp || Date.now();
            nativeValue = tx.nativeValue || 0;
            fee = tx.fee || 0;
            fromAddress = tx.from || tx.feePayer || 'Unknown';
            toAddress = tx.to || 'Unknown';
            blockNumber = tx.blockNumber || null;
        }

        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-5 text-sm"
            >
                {/* Header Card */}
                <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.4)] glow-[#FFFFFF15]">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <HashIcon className="w-5 h-5 text-emerald-400" />
                            <span className="text-[#D4D4D4] text-xs">Transaction Hash</span>
                            <code className="font-mono text-[#FFF] text-sm break-all">
                                {isMobile ? truncateText(tx.hash || tx.txid || tx.signature) : (tx.hash || tx.txid || tx.signature)}
                            </code>
                            <Copy className="w-4 h-4 text-[#D4D4D4] hover:text-[#FFF] cursor-pointer" onClick={() => copyToClipboard(tx.hash || tx.txid || tx.signature)} />
                        </div>
                        <div className="flex items-center gap-3">
                            <img src={chainLogos[detectedChain]} alt={detectedChain} className="w-7 h-7 rounded-full" />
                            <span className="text-xl font-bold text-[#FFF] uppercase tracking-wider">{detectedChain}</span>
                        </div>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                        <Activity className="w-5 h-5 text-emerald-400" />
                        <span className="text-[#D4D4D4] text-xs">Status</span>
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${isSuccess ? 'bg-emerald-400/10 text-emerald-400' : status === 'Failed' ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
                            <div className={`w-3 h-3 rounded-full ${isSuccess ? 'bg-emerald-400' : status === 'Failed' ? 'bg-red-500' : 'bg-yellow-500'} animate-pulse`} />
                            <span className="font-semibold">{status}</span>
                        </div>
                    </div>
                </div>

                {/* Main Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Block and Time */}
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <div className="flex items-center gap-3 mb-2">
                            <HashIcon className="w-5 h-5 text-emerald-400" />
                            <span className="text-[#D4D4D4] text-xs uppercase tracking-wider">Block</span>
                        </div>
                        <span>{blockNumber || 'Pending'}</span>
                    </div>
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <div className="flex items-center gap-3 mb-2">
                            <Clock className="w-5 h-5 text-emerald-400" />
                            <span className="text-[#D4D4D4] text-xs uppercase tracking-wider">Time</span>
                        </div>
                        <span>{new Date(timestamp).toLocaleString()}</span>
                    </div>

                    {/* Value */}
                    {(nativeValue > 0 || txData.nativeValueUSD > 0) && (
                        <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                            <div className="flex items-center gap-3 mb-2">
                                <Coins className="w-5 h-5 text-emerald-400" />
                                <span className="text-[#D4D4D4] text-xs uppercase tracking-wider">Value</span>
                            </div>
                            {renderValueWithUSD(nativeValue, txData.nativeValueUSD || 0, symbol, nativeTokenLogos[symbol])}
                        </div>
                    )}

                    {/* Fee */}
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <div className="flex items-center gap-3 mb-2">
                            <Activity className="w-5 h-5 text-emerald-400" />
                            <span className="text-[#D4D4D4] text-xs uppercase tracking-wider">Fee</span>
                        </div>
                        {renderValueWithUSD(fee, txData.feeUSD || 0, symbol, nativeTokenLogos[symbol])}
                    </div>

                    {/* From */}
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <div className="flex items-center gap-3 mb-2">
                            <Wallet className="w-5 h-5 text-emerald-400" />
                            <span className="text-[#D4D4D4] text-xs uppercase tracking-wider">From</span>
                        </div>
                        {renderAddress(fromAddress, detectedChain)}
                    </div>

                    {/* To */}
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <div className="flex items-center gap-3 mb-2">
                            <Wallet className="w-5 h-5 text-emerald-400" />
                            <span className="text-[#D4D4D4] text-xs uppercase tracking-wider">To</span>
                        </div>
                        {renderAddress(toAddress, detectedChain)}
                    </div>
                </div>

                {/* Token Transfers */}
                {(tx.tokenTransfers?.length > 0) && (
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <h3 className="flex items-center gap-3 text-lg font-bold text-[#FFF] mb-4 uppercase tracking-wider">
                            <Coins className="w-5 h-5 text-emerald-400" />
                            Token Transfers
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="border-b border-[#FFFFFF10]">
                                    <tr>
                                        <th className="text-left py-2 text-[#D4D4D4]">Token</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">From</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">To</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">Amount</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">USD Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tx.tokenTransfers.map((t, i) => {
                                        const amount = Number(t.amount || (BigInt(t.value || 0) / BigInt(10 ** (t.decimals || 18))));
                                        const logo = t.logo || nativeTokenLogos[t.symbol] || '/fallback-image.webp';
                                        const tokenDisplay = t.type === 'ERC721' ? `${t.name} (ID: ${t.tokenId})` : t.symbol || t.name || 'Unknown';
                                        return (
                                            <tr key={i} className="border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/5 transition-colors">
                                                <td className="py-3 flex items-center gap-2">
                                                    <img src={logo} alt={tokenDisplay} className="w-5 h-5 rounded-full" />
                                                    <span>{tokenDisplay}</span>
                                                </td>
                                                <td className="py-3">{renderAddress(t.from || t.fromUserAccount, detectedChain)}</td>
                                                <td className="py-3">{renderAddress(t.to || t.toUserAccount, detectedChain)}</td>
                                                <td className="py-3">
                                                    {amount.toFixed(6)} {t.symbol}
                                                </td>
                                                <td className="py-3">
                                                    {t.valueUSD > 0 ? formatUSD(t.valueUSD) : 'N/A'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Native Transfers (for Solana) */}
                {isSOL && (tx.nativeTransfers?.length > 0) && (
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <h3 className="flex items-center gap-3 text-lg font-bold text-[#FFF] mb-4 uppercase tracking-wider">
                            <Coins className="w-5 h-5 text-emerald-400" />
                            Native Transfers
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="border-b border-[#FFFFFF10]">
                                    <tr>
                                        <th className="text-left py-2 text-[#D4D4D4]">From</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">To</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">Amount</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">USD Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tx.nativeTransfers.map((t, i) => {
                                        const amount = Number(t.amount) / 1e9;
                                        const usdValue = amount * (tx.solPrice || 0);
                                        return (
                                            <tr key={i} className="border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/5 transition-colors">
                                                <td className="py-3">{renderAddress(t.fromUserAccount, detectedChain)}</td>
                                                <td className="py-3">{renderAddress(t.toUserAccount, detectedChain)}</td>
                                                <td className="py-3">
                                                    {amount.toFixed(6)} SOL
                                                </td>
                                                <td className="py-3">
                                                    {usdValue > 0 ? formatUSD(usdValue) : 'N/A'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Inputs (for Bitcoin) */}
                {isBTC && (tx.vin?.length > 0) && (
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <h3 className="flex items-center gap-3 text-lg font-bold text-[#FFF] mb-4 uppercase tracking-wider">
                            <Wallet className="w-5 h-5 text-emerald-400" />
                            Inputs
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="border-b border-[#FFFFFF10]">
                                    <tr>
                                        <th className="text-left py-2 text-[#D4D4D4]">From</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">Value</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">USD Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tx.vin.map((vin, i) => {
                                        const value = (vin.prevout?.value || 0) / 1e8;
                                        const usdValue = vin.prevout?.valueUSD || 0;
                                        return (
                                            <tr key={i} className="border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/5 transition-colors">
                                                <td className="py-3">{renderAddress(vin.prevout?.scriptpubkey_address || 'Coinbase', detectedChain)}</td>
                                                <td className="py-3">{value.toFixed(6)} BTC</td>
                                                <td className="py-3">{usdValue > 0 ? formatUSD(usdValue) : 'N/A'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Outputs (for Bitcoin) */}
                {isBTC && (tx.vout?.length > 0) && (
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <h3 className="flex items-center gap-3 text-lg font-bold text-[#FFF] mb-4 uppercase tracking-wider">
                            <Wallet className="w-5 h-5 text-emerald-400" />
                            Outputs
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="border-b border-[#FFFFFF10]">
                                    <tr>
                                        <th className="text-left py-2 text-[#D4D4D4]">To</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">Value</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">USD Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tx.vout.map((vout, i) => {
                                        const value = (vout.value || 0) / 1e8;
                                        const usdValue = vout.valueUSD || 0;
                                        return (
                                            <tr key={i} className="border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/5 transition-colors">
                                                <td className="py-3">{renderAddress(vout.scriptpubkey_address || 'Unknown', detectedChain)}</td>
                                                <td className="py-3">{value.toFixed(6)} BTC</td>
                                                <td className="py-3">{usdValue > 0 ? formatUSD(usdValue) : 'N/A'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Internal Transactions (for EVM) */}
                {isEVM && (tx.internalTxs?.length > 0) && (
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <h3 className="flex items-center gap-3 text-lg font-bold text-[#FFF] mb-4 uppercase tracking-wider">
                            <Activity className="w-5 h-5 text-emerald-400" />
                            Internal Transactions
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="border-b border-[#FFFFFF10]">
                                    <tr>
                                        <th className="text-left py-2 text-[#D4D4D4]">From</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">To</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">Value</th>
                                        <th className="text-left py-2 text-[#D4D4D4]">USD Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tx.internalTxs.map((itx, i) => {
                                        const value = Number(itx.value || 0) / 1e18;
                                        const usdValue = itx.valueUSD || 0;
                                        return (
                                            <tr key={i} className="border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/5 transition-colors">
                                                <td className="py-3">{renderAddress(itx.from, detectedChain)}</td>
                                                <td className="py-3">{renderAddress(itx.to, detectedChain)}</td>
                                                <td className="py-3">{value.toFixed(6)} {symbol}</td>
                                                <td className="py-3">{usdValue > 0 ? formatUSD(usdValue) : 'N/A'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Input Data (for EVM) */}
                {isEVM && tx.input && (
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <h3 className="flex items-center gap-3 text-lg font-bold text-[#FFF] mb-4 uppercase tracking-wider">
                            <Activity className="w-5 h-5 text-emerald-400" />
                            Input Data
                        </h3>
                        <pre className="text-xs bg-[#0A0A0A]/50 p-3 rounded overflow-auto max-h-40">{tx.input}</pre>
                    </div>
                )}

                {/* Logs (for EVM) */}
                {isEVM && tx.receipt?.logs?.length > 0 && (
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <h3 className="flex items-center gap-3 text-lg font-bold text-[#FFF] mb-4 uppercase tracking-wider">
                            <Activity className="w-5 h-5 text-emerald-400" />
                            Logs
                        </h3>
                        <pre className="text-xs bg-[#0A0A0A]/50 p-3 rounded overflow-auto max-h-40">{JSON.stringify(tx.receipt.logs, null, 2)}</pre>
                    </div>
                )}

                {/* Instructions (for Solana) */}
                {isSOL && tx.instructions && (
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <h3 className="flex items-center gap-3 text-lg font-bold text-[#FFF] mb-4 uppercase tracking-wider">
                            <Activity className="w-5 h-5 text-emerald-400" />
                            Instructions
                        </h3>
                        <pre className="text-xs bg-[#0A0A0A]/50 p-3 rounded overflow-auto max-h-40">{JSON.stringify(tx.instructions, null, 2)}</pre>
                    </div>
                )}
            </motion.div>
        );
    };

    const isOverallLoading = loading || nametagsLoading;

    return (
        <div className="font-inter w-full max-w-9xl mx-auto p-4 sm:p-6 bg-[#0A0A0A]/80 backdrop-blur-md h-full overflow-y-auto hide-scrollbar">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 text-center"
            >
                <h1 className="text-xl sm:text-2xl font-bold text-[#FFF] uppercase tracking-wider mb-2 flex items-center justify-center gap-3">
                    <img src="/logos/logo.webp" alt="Logo" className="w-10 h-10" />
                    Xynapse Explorer
                </h1>
                <p className="text-[#D4D4D4] text-xs">Search any transaction across major chains</p>
            </motion.div>

            {/* Search Bar */}
            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-4xl mx-auto mb-8"
            >
                <div className="flex gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#D4D4D4]" />
                        <input
                            type="text"
                            placeholder="Enter transaction hash, address or block..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="w-full pl-8 pr-3 py-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl text-[#FFF] placeholder-[#D4D4D4]/60 focus:outline-none focus:border-[#FFFFFF40] focus:shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all text-sm"
                        />
                    </div>
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleSearch}
                        className="px-4 py-2 bg-gradient-to-r from-[#00FFFF20]/20 to-emerald-400/20 border border-[#FFFFFF20] rounded-2xl text-[#FFF] font-medium hover:shadow-[0_0_20px_rgba(0,255,255,0.2)] transition-all flex items-center gap-2"
                    >
                        <Search className="w-3 h-3" />
                        Search
                    </motion.button>
                </div>
            </motion.div>

            {/* Loading Overlay */}
            <AnimatePresence>
                {isOverallLoading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
                    >
                        <div className="w-96 bg-[#0A0A0A]/90 backdrop-blur-xl border border-[#FFFFFF20] rounded-2xl p-8 shadow-2xl glow-[#FFFFFF15]">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
                                <h3 className="text-xl font-bold text-[#FFF]">{nametagsLoading ? 'Resolving Nametags' : 'Searching Transaction'}</h3>
                            </div>
                            <div className="space-y-3">
                                <AnimatePresence>
                                    {logMessages.map((log, i) => (
                                        <motion.p
                                            key={log.id}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ delay: i * 0.1 }}
                                            className="text-[#D4D4D4] text-sm flex items-center gap-3"
                                        >
                                            <span className="text-emerald-400">&gt;</span>
                                            {log.text}
                                        </motion.p>
                                    ))}
                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Error */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-2xl mx-auto mb-8 p-5 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-center"
                    >
                        <AlertCircle className="w-6 h-6 mx-auto mb-2" />
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Results */}
            <AnimatePresence mode="wait">
                {results && !error && (
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-7xl mx-auto"
                    >
                        {renderTxDetails(results.data, results.chain)}
                    </motion.div>
                )}
            </AnimatePresence>

            <style jsx global>{`
                .hide-scrollbar::-webkit-scrollbar { display: none; }
                .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
                .glow-[#FFFFFF15] { box-shadow: 0 0 20px rgba(255,255,255,0.15); }
            `}</style>
        </div>
    );
}