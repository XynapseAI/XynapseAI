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
        monad: 'https://assets.coingecko.com/coins/images/38927/standard/monad.jpg?1719547722',
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
            tx.tokenTransfers?.forEach(t => { addAddress(t.from); addAddress(t.to); });
            tx.internalTxs?.forEach(itx => { addAddress(itx.from); addAddress(itx.to); });
        } else if (chain === 'bitcoin') {
            tx.vin?.forEach(vin => addAddress(vin.prevout?.scriptpubkey_address));
            tx.vout?.forEach(vout => addAddress(vout.scriptpubkey_address));
        } else if (chain === 'solana') {
            addAddress(tx.feePayer);
            tx.nativeTransfers?.forEach(t => { addAddress(t.fromUserAccount); addAddress(t.toUserAccount); });
            tx.tokenTransfers?.forEach(t => { addAddress(t.fromUserAccount); addAddress(t.toUserAccount); });
            tx.accountData?.forEach(acc => addAddress(acc.account));
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
            setError(err.message.includes('timeout') ? 'Bitcoin query timeout, retrying...' : err.message);
            if (err.message.includes('timeout')) setTimeout(() => fetchData(q, ch), 2000);
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

        const isConfirmed = isEVM ? (tx.receipt?.blockNumber || tx.transaction?.blockNumber) :
                            isBTC ? (tx.status?.confirmed || tx.status?.block_height > 0) :
                            (tx.isSuccess !== false);

        const status = isConfirmed ? 'Success' : 'Pending';
        const isSuccess = status === 'Success';

        const timestamp = isEVM ? (tx.block?.timestamp ? parseInt(tx.block.timestamp, 16) * 1000 : Date.now()) :
                          isBTC ? (tx.status?.block_time ? tx.status.block_time * 1000 : Date.now()) :
                          (tx.timestamp || Date.now());

        const nativeValue = isEVM ? Number(parseInt(tx.transaction?.value || '0x0', 16)) / 1e18 :
                            isBTC ? (tx.vout?.reduce((s, o) => s + (o.value || 0), 0) || 0) / 1e8 :
                            (tx.nativeValue || 0);

        const fee = isEVM ? ((parseInt(tx.receipt?.gasUsed || '0x0', 16) || 0) * (parseInt(tx.receipt?.effectiveGasPrice || tx.transaction?.gasPrice || '0x0', 16) || 0)) / 1e18 :
                    isBTC ? (tx.fee || 0) / 1e8 :
                    (tx.fee || 0);

        const symbol = chainSymbols[detectedChain] || 'ETH';

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
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${isSuccess ? 'bg-emerald-400/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-500'}`}>
                            <div className={`w-3 h-3 rounded-full ${isSuccess ? 'bg-emerald-400' : 'bg-yellow-500'} animate-pulse`} />
                            <span className="font-semibold">{status}</span>
                        </div>
                    </div>
                </div>

                {/* Main Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                        {renderAddress(tx.from || (isBTC ? tx.vin?.[0]?.prevout?.scriptpubkey_address : 'Unknown'), detectedChain)}
                    </div>

                    {/* To */}
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                        <div className="flex items-center gap-3 mb-2">
                            <Wallet className="w-5 h-5 text-emerald-400" />
                            <span className="text-[#D4D4D4] text-xs uppercase tracking-wider">To</span>
                        </div>
                        {renderAddress(tx.to || (isBTC ? tx.vout?.[0]?.scriptpubkey_address : 'Unknown'), detectedChain)}
                    </div>
                </div>

                {/* Token Transfers */}
                {(tx.tokenTransfers?.length > 0 || tx.nativeTransfers?.length > 0) && (
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
                                    </tr>
                                </thead>
                                <tbody>
                                    {(tx.tokenTransfers || tx.nativeTransfers || []).map((t, i) => {
                                        const amount = Number(t.amount || (BigInt(t.value || 0) / BigInt(10 ** (t.decimals || 18))));
                                        const logo = t.logo || nativeTokenLogos[t.symbol] || '/fallback-image.webp';
                                        return (
                                            <tr key={i} className="border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/5 transition-colors">
                                                <td className="py-3 flex items-center gap-2">
                                                    <img src={logo} alt={t.symbol} className="w-5 h-5 rounded-full" />
                                                    <span>{t.symbol || 'Unknown'}</span>
                                                </td>
                                                <td className="py-3">{renderAddress(t.from || t.fromUserAccount, detectedChain)}</td>
                                                <td className="py-3">{renderAddress(t.to || t.toUserAccount, detectedChain)}</td>
                                                <td className="py-3">
                                                    {amount.toFixed(6)} {t.symbol}
                                                    {t.valueUSD > 0 && <span className="ml-2 text-emerald-400 text-xs">({formatUSD(t.valueUSD)})</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
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
                <h1 className="text-2xl sm:text-3xl font-bold text-[#FFF] uppercase tracking-wider mb-2 flex items-center justify-center gap-3">
                    <img src="/logos/logo.webp" alt="Logo" className="w-10 h-10" />
                    Xynapse Explorer
                </h1>
                <p className="text-[#D4D4D4] text-sm">Search any transaction across major chains</p>
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
                            className="w-full pl-12 pr-4 py-4 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl text-[#FFF] placeholder-[#D4D4D4]/60 focus:outline-none focus:border-[#FFFFFF40] focus:shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all text-base"
                        />
                    </div>
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleSearch}
                        className="px-8 py-4 bg-gradient-to-r from-[#00FFFF20]/20 to-emerald-400/20 border border-[#FFFFFF20] rounded-2xl text-[#FFF] font-medium hover:shadow-[0_0_20px_rgba(0,255,255,0.2)] transition-all flex items-center gap-2"
                    >
                        <Search className="w-5 h-5" />
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