// components/ExplorerTab.jsx
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Clock, Hash as HashIcon, AlertCircle, Wallet, Coins, Activity, Check, Copy, X, DollarSign } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { LoadingOverlay } from '../utils/helpers';

export default function ExplorerTab({ initialQuery, initialChain }) {
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

    const chainConfig = {
        bitcoin: { id: null, apiBase: '/api/mempool' },
        ethereum: { id: 1, apiBase: '/api/etherscan' },
        bsc: { id: 56, apiBase: '/api/etherscan' },
        solana: { id: null, apiBase: '/api/solana' }, // UPDATED for Solana: Proxy endpoint
    };

    const chainLogos = {
        bitcoin: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
        ethereum: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
        bsc: 'https://assets.coingecko.com/coins/images/825/small/bnb.png',
        solana: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
    };

    const chainSymbols = {
        bitcoin: 'BTC',
        ethereum: 'ETH',
        bsc: 'BNB',
        solana: 'SOL',
    };

    // SEO useEffect (unchanged)
    useEffect(() => {
        if (results && results.data) {
            const txHash = results.data.hash || results.data.txid || results.data.signature || 'Unknown';
            const chainName = selectedChain.toUpperCase();
            const status = results.data.status || 'Pending';
            document.title = `Transaction ${truncateText(txHash, 8, 8)} on ${chainName} - ${status} | Xynapse Explorer`;

            let metaDesc = `Explore transaction ${truncateText(txHash, 8, 8)} on ${chainName} blockchain. Status: ${status}. View details, token transfers, and more on Xynapse Explorer.`;
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

            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage) ogImage.setAttribute('content', chainLogos[selectedChain] || 'https://xynapseai.net/og.png');

            const ogUrl = document.querySelector('meta[property="og:url"]');
            if (ogUrl) ogUrl.setAttribute('content', `${window.location.origin}/dashboard?tab=explorer&query=${encodeURIComponent(query)}&chain=${selectedChain}`);

            const canonical = document.querySelector('link[rel="canonical"]');
            if (canonical) {
                canonical.setAttribute('href', `${window.location.origin}/dashboard?tab=explorer&query=${encodeURIComponent(query)}&chain=${selectedChain}`);
            } else {
                const newCanonical = document.createElement('link');
                newCanonical.rel = 'canonical';
                newCanonical.href = `${window.location.origin}/dashboard?tab=explorer&query=${encodeURIComponent(query)}&chain=${selectedChain}`;
                document.head.appendChild(newCanonical);
            }
        } else {
            document.title = 'Blockchain Explorer - Search Transactions | Xynapse';
            const metaTag = document.querySelector('meta[name="description"]');
            if (metaTag) {
                metaTag.setAttribute('content', 'Xynapse Explorer: Search and analyze transactions on Bitcoin, Ethereum, BSC, and Solana blockchains. Real-time data, nametags, and insights.');
            }
        }
    }, [results, selectedChain, query]);

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

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => toast.success('Copied!'));
    };

    // UPDATED for Solana: Extract addresses from enhanced tx
    const extractAddresses = (txData, chain) => {
        const addresses = new Set();
        let tx = txData;
        if (Array.isArray(txData)) tx = txData[0];

        if (tx.from) addresses.add(tx.from.toLowerCase());
        if (tx.to) addresses.add(tx.to.toLowerCase());

        if (chain === 'ethereum' || chain === 'bsc') {
            if (tx.tokenTransfers) {
                tx.tokenTransfers.forEach(t => {
                    if (t.from) addresses.add(t.from.toLowerCase());
                    if (t.to) addresses.add(t.to.toLowerCase());
                });
            }
            if (tx.internalTxs && Array.isArray(tx.internalTxs)) {
                tx.internalTxs.forEach(itx => {
                    if (itx.from) addresses.add(itx.from.toLowerCase());
                    if (itx.to) addresses.add(itx.to.toLowerCase());
                });
            }
        } else if (chain === 'bitcoin') {
            if (tx.vin && Array.isArray(tx.vin)) {
                tx.vin.forEach(vin => {
                    if (vin.prevout?.scriptpubkey_address) {
                        addresses.add(vin.prevout.scriptpubkey_address.toLowerCase());
                    }
                });
            }
            if (tx.vout && Array.isArray(tx.vout)) {
                tx.vout.forEach(vout => {
                    if (vout.scriptpubkey_address) {
                        addresses.add(vout.scriptpubkey_address.toLowerCase());
                    }
                });
            }
        } else if (chain === 'solana') { // UPDATED: Solana addresses
            if (tx.feePayer) addresses.add(tx.feePayer.toLowerCase());
            if (tx.nativeTransfers) {
                tx.nativeTransfers.forEach(t => {
                    if (t.fromUserAccount) addresses.add(t.fromUserAccount.toLowerCase());
                    if (t.toUserAccount) addresses.add(t.toUserAccount.toLowerCase());
                });
            }
            if (tx.tokenTransfers) {
                tx.tokenTransfers.forEach(t => {
                    if (t.fromUserAccount) addresses.add(t.fromUserAccount.toLowerCase());
                    if (t.toUserAccount) addresses.add(t.toUserAccount.toLowerCase());
                });
            }
            if (tx.accountData) { // Optional: accounts
                tx.accountData.forEach(acc => {
                    if (acc.account) addresses.add(acc.account.toLowerCase());
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
            console.log('Nametags loaded:', newNametags);
            if (Object.keys(newNametags).length > 0) {
                toast.success(`Found nametags for ${Object.keys(newNametags).length} addresses`);
            }
        } catch (err) {
            console.error('Nametags fetch error:', err);
        } finally {
            setNametagsLoading(false);
        }
    };

    const fetchData = async (q, ch) => {
        setLoading(true);
        setError(null);
        try {
            let data = {};
            const fetchOptions = {
                method: 'POST', // UPDATED: All POST now, including Solana
                headers: { 'Content-Type': 'application/json' },
                // REMOVED: credentials: 'include' - No session required for public feature
            };

            let endpoint;
            let body;
            switch (ch) {
                case 'bitcoin':
                    endpoint = chainConfig[ch].apiBase;
                    body = { action: 'tx-details', txHash: q };
                    break;
                case 'ethereum':
                case 'bsc':
                    endpoint = chainConfig[ch].apiBase;
                    body = { action: 'tx-details', chain: ch, txHash: q };
                    break;
                case 'solana': // UPDATED: POST to proxy
                    endpoint = chainConfig[ch].apiBase;
                    body = { action: 'tx-details', txHash: q };
                    break;
                default:
                    throw new Error('Unsupported chain for tx');
            }
            fetchOptions.body = JSON.stringify(body);
            const res = await fetch(endpoint, fetchOptions);
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const resJson = await res.json();
            if (ch === 'bitcoin' || ch === 'ethereum' || ch === 'bsc' || ch === 'solana') { // UPDATED: Include solana
                if (!resJson.success) throw new Error(resJson.detail || 'Transaction not found');
                data = resJson.data;
            } else {
                data = resJson;
            }

            setResults({ data, chain: ch });

            const addresses = extractAddresses(data, ch);
            if (addresses.length > 0) {
                await fetchNametags(addresses, ch);
            }
        } catch (err) {
            if (ch === 'ethereum' && err.message.includes('not found')) {
                try {
                    const bscData = await fetchData(q, 'bsc');
                    setResults({ ...bscData, chain: 'bsc' });
                    setSelectedChain('bsc');
                    return;
                } catch (bscErr) {
                    throw new Error('Transaction not found on supported chains');
                }
            }
            let userMsg = err.message;
            if (ch === 'bitcoin' && (err.message.includes('timeout') || err.message.includes('AbortError'))) {
                userMsg = 'Bitcoin query timeout (network lag), retrying in 2s...';
                toast.warning(userMsg);
                setTimeout(() => fetchData(q, ch), 2000);
                return;
            }
            setError(err.message);
            toast.error(`Search failed: ${err.message}`);
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

            fetchData(query, ch);
        } catch (err) {
            setError(err.message);
            toast.error(err.message);
        }
    };

    useEffect(() => {
        const q = initialQuery || searchParams.get('query');
        const ch = initialChain || searchParams.get('chain');
        if (q) {
            setQuery(q);
            if (ch) {
                setSelectedChain(ch);
                fetchData(q, ch);
            } else {
                handleSearch();
            }
        }
    }, [initialQuery, initialChain]);

    const renderAddress = (addr, chain) => {
        if (!addr || addr === 'Coinbase' || addr === 'Multiple Inputs' || addr === 'Multiple Outputs') {
            return <span className="font-mono break-all">{addr}</span>;
        }
        const normalized = addr.toLowerCase();
        const tag = nametags[normalized];
        const displayAddr = isMobile && addr.length > 10 ? truncateText(addr) : addr;
        return (
            <>
                <span className="font-mono break-all mr-1">{displayAddr}</span>
                {tag && tag['Name Tag'] && (
                    <span className="flex items-center text-xs text-neon-blue">
                        {tag.image && <img src={tag.image} alt={tag['Name Tag']} className="w-3 h-3 mr-1 rounded" />}
                        ({tag['Name Tag']})
                    </span>
                )}
            </>
        );
    };

    const formatUSD = (value) => {
        if (value == null || isNaN(value)) return '$0.00';
        return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const renderValueWithUSD = (tokenValue, usdValue, symbol, logoUrl = null, isToken = false) => {
        const formattedUSD = formatUSD(usdValue);
        const logoElement = logoUrl ? (
            <img
                src={logoUrl}
                alt={symbol}
                className="w-3 h-3 mr-1 rounded"
                onError={(e) => { e.target.src = `https://via.placeholder.com/16?text=${symbol}`; }}
            />
        ) : null;
        if (!usdValue || usdValue === 0) return (
            <span className="flex items-center">
                {logoElement}
                {tokenValue.toFixed(6)} {symbol}
            </span>
        );
        return (
            <span className="flex items-center">
                {logoElement}
                {tokenValue.toFixed(6)} {symbol}
                <span className="ml-1 text-xs text-green-400">({formattedUSD})</span>
                {isToken && <span className="ml-1 text-xs text-gray-400">(Tokens)</span>}
            </span>
        );
    };

    const renderTokenAmount = (amount, symbol, logo) => (
        <span className="flex items-center">
            <img
                src={logo || `https://via.placeholder.com/16?text=${symbol || 'T'}`}
                alt={symbol || 'Token'}
                className="w-3 h-3 mr-1 rounded"
                onError={(e) => { e.target.src = `https://via.placeholder.com/16?text=${symbol || 'T'}`; }}
            />
            {amount} {symbol || ''}
        </span>
    );

    const renderTxDetails = (txData, chain) => {
        let tx = txData;
        if (Array.isArray(txData)) tx = txData[0];
        if (chain === 'ethereum' || chain === 'bsc') {
            // Unchanged EVM render
            const transaction = txData.transaction;
            const receipt = txData.receipt;
            const block = txData.block || null;
            const internalTxs = txData.internalTxs || [];
            const tokenTransfers = txData.tokenTransfers || [];

            const isConfirmed = receipt && receipt.blockNumber;
            let status = 'Pending';
            let isSuccess = false;
            if (isConfirmed) {
                status = receipt.status === '0x1' ? 'Success' : 'Failed';
                isSuccess = status === 'Success';
            }

            const blockNumber = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;
            const timestamp = block ? parseInt(block.timestamp, 16) * 1000 : Date.now();
            const gasUsed = receipt ? parseInt(receipt.gasUsed, 16) : 0;
            const effectiveGasPrice = receipt ? parseInt(receipt.effectiveGasPrice || transaction.gasPrice, 16) : parseInt(transaction.gasPrice || '0', 16);
            const fee = (gasUsed * effectiveGasPrice) / 1e18;
            const nativeValue = Number(parseInt(transaction.value || '0', 16)) / 1e18;
            const symbol = chain === 'ethereum' ? 'ETH' : 'BNB';

            tx.nativeValueUSD = txData.nativeValueUSD || 0;
            tx.feeUSD = txData.feeUSD || 0;
            tx = { ...transaction, receipt, internalTxs, tokenTransfers };

            const totalTokenUSD = tokenTransfers.reduce((sum, t) => sum + (t.valueUSD || 0), 0);

            return (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 text-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center justify-between backdrop-blur-sm">
                            <div className="flex items-center">
                                <HashIcon className="w-4 h-4 text-neon-blue mr-2" />
                                <span className="text-white/70 mr-2">Hash:</span>
                                <span className="font-mono break-all mr-2">{isMobile && tx.hash.length > 10 ? truncateText(tx.hash) : tx.hash}</span>
                                <Copy onClick={() => copyToClipboard(tx.hash)} className="w-4 h-4 cursor-pointer hover:text-neon-blue" />
                            </div>
                            <h2 className="text-base font-semibold flex items-center gap-2">
                                <img src={chainLogos[selectedChain]} alt={selectedChain} className="w-6 h-6 inline mx-1" />
                                <span className="text-neon-blue">{selectedChain}</span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Activity className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">Status:</span>
                            <div className="flex items-center">
                                <span className={isSuccess ? 'text-green-500' : status === 'Pending' ? 'text-yellow-500' : 'text-red-400'}>{status}</span>
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                                    {isSuccess ? <Check className="w-3 h-3 text-black" /> : status === 'Pending' ? <Clock className="w-3 h-3 text-black" /> : <X className="w-3 h-3 text-black" />}
                                </div>
                            </div>
                        </div>
                        {tokenTransfers.length === 0 && (
                            <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                                <Coins className="w-4 h-4 text-neon-blue mr-2" />
                                <span className="text-white/70 mr-2">Value:</span>
                                <div className="flex flex-col">
                                    <div className="flex items-center flex-wrap gap-1">
                                        {renderValueWithUSD(nativeValue, tx.nativeValueUSD, symbol, chainLogos[chain])}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className={`bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center ${blockNumber ? 'justify-between' : ''} backdrop-blur-sm`}>
                            {blockNumber && (
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-neon-blue mr-1" />
                                    <span>Block: {blockNumber}</span>
                                </div>
                            )}
                            <span className="flex items-center"><Clock className="w-4 h-4 text-neon-blue mr-1" />{status === 'Pending' ? 'Submitted: ' : 'Time: '} {new Date(timestamp).toLocaleString()}</span>
                        </div>
                        <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Wallet className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">From:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(tx.from, chain)}
                                <Copy onClick={() => copyToClipboard(tx.from)} className="ml-2 w-4 h-4 cursor-pointer hover:text-neon-blue" />
                            </div>
                        </div>
                        <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Wallet className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">To:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(tx.to, chain)}
                                <Copy onClick={() => copyToClipboard(tx.to)} className="ml-2 w-4 h-4 cursor-pointer hover:text-neon-blue" />
                            </div>
                        </div>
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Activity className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">Fee:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(fee, tx.feeUSD, symbol, chainLogos[chain])}
                            </div>
                        </div>
                    </div>

                    {tokenTransfers.length > 0 && (
                        <div className="mt-4">
                            <h3 className="text-md font-semibold flex items-center uppercase"><Coins className="w-4 h-4 mr-2 text-neon-blue" />Token Transfers</h3>
                            <table className="w-full border-collapse border border-white/10 mt-2">
                                <thead>
                                    <tr className="bg-black/70">
                                        <th className="p-2 text-left">Token</th>
                                        <th className="p-2 text-left">From</th>
                                        <th className="p-2 text-left">To</th>
                                        <th className="p-2 text-left">Amount</th>
                                        <th className="p-2 text-left">USD Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tokenTransfers.map((t, i) => {
                                        const amount = Number(t.value) / 10 ** (t.decimals || 18);
                                        return (
                                            <tr key={i} className="hover:bg-white/5">
                                                <td className="p-2 border border-white/10 text-left flex items-center">
                                                    <img
                                                        src={t.logo || `https://via.placeholder.com/16?text=${t.symbol || 'T'}`}
                                                        alt={t.symbol || 'Token'}
                                                        className="w-4 h-4 mr-1 rounded"
                                                        onError={(e) => { e.target.src = `https://via.placeholder.com/16?text=${t.symbol || 'T'}`; }}
                                                    />
                                                    {t.symbol || t.name || t.tokenAddress?.slice(0, 2) + '...'}
                                                </td>
                                                <td className="p-2 border border-white/10 text-left">{renderAddress(t.from, chain)}</td>
                                                <td className="p-2 border border-white/10 text-left">{renderAddress(t.to, chain)}</td>
                                                <td className="p-2 border border-white/10 text-left">
                                                    {renderTokenAmount(amount.toFixed(6), t.symbol || '', t.logo)}
                                                </td>
                                                <td className="p-2 border border-white/10 text-left">
                                                    {t.valueUSD !== null && t.valueUSD !== undefined ? (
                                                        <span className="flex items-center text-xs text-green-400">
                                                            <DollarSign className="w-3 h-3 mr-1" />
                                                            {formatUSD(t.valueUSD)}
                                                        </span>
                                                    ) : 'N/A'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <h3 className="text-md font-semibold flex items-center mt-4 uppercase"><Activity className="w-4 h-4 mr-2 text-neon-blue" />Inputs/Outputs</h3>
                    {tx.input && (
                        <div>
                            <h4 className="flex items-center"><Activity className="w-4 h-4 mr-1" />Input Data</h4>
                            <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{tx.input}</pre>
                        </div>
                    )}
                    {receipt?.logs && (
                        <div>
                            <h4 className="flex items-center"><Activity className="w-4 h-4 mr-1" />Logs</h4>
                            <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{JSON.stringify(receipt.logs, null, 2)}</pre>
                        </div>
                    )}
                    {internalTxs.length > 0 && (
                        <div>
                            <h4 className="flex items-center"><Activity className="w-4 h-4 mr-1" />Internal Transactions</h4>
                            <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">
                                {internalTxs.map((itx, idx) => (
                                    <div key={idx}>
                                        From: {renderAddress(itx.from, chain)} | To: {renderAddress(itx.to, chain)} | Value: {renderValueWithUSD(Number(itx.value || 0) / 1e18, itx.valueUSD || 0, symbol, chainLogos[chain])}
                                    </div>
                                ))}
                            </pre>
                        </div>
                    )}
                </motion.div>
            );
        } else if (chain === 'bitcoin') {
            // Unchanged Bitcoin render (FIXED: onCopy -> onClick for Copy icon)
            const isConfirmed = tx.status?.confirmed || tx.status?.block_height > 0;
            const status = isConfirmed ? 'Success' : 'Pending';
            const timestamp = tx.status?.block_time ? tx.status.block_time * 1000 : Date.now();
            const totalValue = tx.vout ? tx.vout.reduce((sum, out) => sum + (out.value || 0), 0) / 1e8 : 0;
            const fee = (tx.fee || 0) / 1e8;
            const fromAddress = tx.vin?.[0]?.prevout?.scriptpubkey_address || 'Multiple Inputs';
            const toAddress = tx.vout?.[0]?.scriptpubkey_address || 'Multiple Outputs';
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
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 text-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center justify-between backdrop-blur-sm">
                            <div className="flex items-center">
                                <HashIcon className="w-4 h-4 text-neon-blue mr-2" />
                                <span className="text-white/70 mr-2">Hash:</span>
                                <span className="font-mono break-all mr-2">{isMobile && tx.hash.length > 10 ? truncateText(tx.hash) : tx.hash}</span>
                                <Copy onClick={() => copyToClipboard(tx.hash)} className="w-4 h-4 cursor-pointer hover:text-neon-blue" />
                            </div>
                            <h2 className="text-base font-semibold flex items-center gap-2">
                                <img src={chainLogos[selectedChain]} alt={selectedChain} className="w-6 h-6 inline mx-1" />
                                <span className="text-neon-blue">{selectedChain}</span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Activity className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">Status:</span>
                            <div className="flex items-center">
                                <span className={isSuccess ? 'text-green-500' : 'text-red-400'}>{status}</span>
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : 'bg-red-500'}`}>
                                    {isSuccess ? <Check className="w-3 h-3 text-black" /> : <X className="w-3 h-3 text-black" />}
                                </div>
                            </div>
                        </div>
                        <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Coins className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">Value:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(totalValue, totalValueUSD, 'BTC', chainLogos[chain])}
                            </div>
                        </div>
                        {blockNumber && (
                            <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center justify-between backdrop-blur-sm">
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-neon-blue mr-1" />
                                    <span>Block: {blockNumber}</span>
                                </div>
                                <span className="flex items-center"><Clock className="w-4 h-4 mr-1" /> {new Date(timestamp).toLocaleString()}</span>
                            </div>
                        )}
                        <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Wallet className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">From:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(fromAddress, chain)}
                                {fromAddress !== 'Multiple Inputs' && <Copy onClick={() => copyToClipboard(fromAddress)} className="ml-2 w-4 h-4 cursor-pointer hover:text-neon-blue" />}
                            </div>
                        </div>
                        <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Wallet className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">To:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(toAddress, chain)}
                                {toAddress !== 'Multiple Outputs' && <Copy onClick={() => copyToClipboard(toAddress)} className="ml-2 w-4 h-4 cursor-pointer hover:text-neon-blue" />}
                            </div>
                        </div>
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Activity className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">Fee:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(fee, feeUSD, 'BTC', chainLogos[chain])}
                            </div>
                        </div>
                    </div>

                    {/* Inputs/Outputs */}
                    <h3 className="text-md font-semibold flex items-center mt-4"><Activity className="w-4 h-4 mr-2 text-neon-blue" />Inputs/Outputs</h3>
                    {tx.vin && tx.vin.length > 0 && (
                        <div>
                            <h4 className="flex items-center"><Wallet className="w-4 h-4 mr-1" />Inputs</h4>
                            <table className="w-full border-collapse border border-white/10">
                                <thead><tr><th className="text-left">From</th><th className="text-left">Value</th></tr></thead>
                                <tbody>
                                    {tx.vin.map((input, i) => (
                                        <tr key={i}>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(input.prevout?.scriptpubkey_address || 'Coinbase', chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">
                                                <div className="flex flex-col">
                                                    {renderValueWithUSD((input.prevout?.value || 0) / 1e8, input.prevout?.valueUSD || 0, 'BTC', chainLogos[chain])}
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
                            <table className="w-full border-collapse border border-white/10">
                                <thead><tr><th className="text-left">To</th><th className="text-left">Value</th></tr></thead>
                                <tbody>
                                    {tx.vout.map((output, i) => (
                                        <tr key={i}>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(output.scriptpubkey_address || 'Unknown', chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">
                                                <div className="flex flex-col">
                                                    {renderValueWithUSD((output.value || 0) / 1e8, output.valueUSD || 0, 'BTC', chainLogos[chain])}
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
        } else if (chain === 'solana') { // UPDATED: Full Solana render, matching EVM/Bitcoin layout
            const status = tx.status || 'Success';
            const isSuccess = tx.isSuccess || status === 'Success';
            const timestamp = tx.timestamp || Date.now();
            const symbol = 'SOL';
            const nativeValue = tx.nativeValue || 0;
            const nativeValueUSD = tx.nativeValueUSD || 0;
            const fee = tx.fee || 0;
            const feeUSD = tx.feeUSD || 0;
            const tokenTransfers = tx.tokenTransfers || [];
            const nativeTransfers = tx.nativeTransfers || [];
            const solPrice = tx.solPrice || 0; // FIXED: Use tx.solPrice from API data

            return (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 text-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center justify-between backdrop-blur-sm">
                            <div className="flex items-center">
                                <HashIcon className="w-4 h-4 text-neon-blue mr-2" />
                                <span className="text-white/70 mr-2">Hash:</span>
                                <span className="font-mono break-all mr-2">{isMobile && tx.hash?.length > 10 ? truncateText(tx.hash) : tx.hash}</span>
                                <Copy onClick={() => copyToClipboard(tx.hash)} className="w-4 h-4 cursor-pointer hover:text-neon-blue" />
                            </div>
                            <h2 className="text-base font-semibold flex items-center gap-2">
                                <img src={chainLogos[selectedChain]} alt={selectedChain} className="w-6 h-6 inline mx-1" />
                                <span className="text-neon-blue">{selectedChain}</span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Activity className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">Status:</span>
                            <div className="flex items-center">
                                <span className={isSuccess ? 'text-green-500' : 'text-red-400'}>{status}</span>
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : 'bg-red-500'}`}>
                                    {isSuccess ? <Check className="w-3 h-3 text-black" /> : <X className="w-3 h-3 text-black" />}
                                </div>
                            </div>
                        </div>
                        {nativeValue > 0 && (
                            <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                                <Coins className="w-4 h-4 text-neon-blue mr-2" />
                                <span className="text-white/70 mr-2">Value:</span>
                                <div className="flex flex-col">
                                    {renderValueWithUSD(nativeValue, nativeValueUSD, symbol, chainLogos[chain])}
                                </div>
                            </div>
                        )}
                        <div className={`bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center ${tx.blockNumber ? 'justify-between' : ''} backdrop-blur-sm`}>
                            {tx.blockNumber && (
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-neon-blue mr-1" />
                                    <span>Slot: {tx.blockNumber}</span>
                                </div>
                            )}
                            <span className="flex items-center"><Clock className="w-4 h-4 text-neon-blue mr-1" />Time: {new Date(timestamp).toLocaleString()}</span>
                        </div>
                        <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Wallet className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">From:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(tx.from, chain)}
                                <Copy onClick={() => copyToClipboard(tx.from)} className="ml-2 w-4 h-4 cursor-pointer hover:text-neon-blue" />
                            </div>
                        </div>
                        <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Wallet className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">To:</span>
                            <div className="flex items-center ml-2">
                                {renderAddress(tx.to, chain)}
                                <Copy onClick={() => copyToClipboard(tx.to)} className="ml-2 w-4 h-4 cursor-pointer hover:text-neon-blue" />
                            </div>
                        </div>
                        <div className="md:col-span-2 bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center backdrop-blur-sm">
                            <Activity className="w-4 h-4 text-neon-blue mr-2" />
                            <span className="text-white/70 mr-2">Fee:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(fee, feeUSD, symbol, chainLogos[chain])}
                            </div>
                        </div>
                    </div>

                    {/* UPDATED: Token Transfers table for Solana */}
                    {tokenTransfers.length > 0 && (
                        <div className="mt-4">
                            <h3 className="text-md font-semibold flex items-center uppercase"><Coins className="w-4 h-4 mr-2 text-neon-blue" />Token Transfers</h3>
                            <table className="w-full border-collapse border border-white/10 mt-2">
                                <thead>
                                    <tr className="bg-black/70">
                                        <th className="p-2 text-left">Token</th>
                                        <th className="p-2 text-left">From</th>
                                        <th className="p-2 text-left">To</th>
                                        <th className="p-2 text-left">Amount</th>
                                        <th className="p-2 text-left">USD Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tokenTransfers.map((t, i) => (
                                        <tr key={i} className="hover:bg-white/5">
                                            <td className="p-2 border border-white/10 text-left flex items-center">
                                                <img
                                                    src={t.logo || `https://via.placeholder.com/16?text=${t.symbol || 'T'}`}
                                                    alt={t.symbol || 'Token'}
                                                    className="w-4 h-4 mr-1 rounded"
                                                    onError={(e) => { e.target.src = `https://via.placeholder.com/16?text=${t.symbol || 'T'}`; }}
                                                />
                                                {t.symbol || t.name || t.mint?.slice(0, 4) + '...'}
                                            </td>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(t.fromUserAccount || t.from, chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(t.toUserAccount || t.to, chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">
                                                {renderTokenAmount((t.amount || 0).toFixed(6), t.symbol || '', t.logo)}
                                            </td>
                                            <td className="p-2 border border-white/10 text-left">
                                                {t.valueUSD !== null && t.valueUSD !== undefined ? (
                                                    <span className="flex items-center text-xs text-green-400">
                                                        <DollarSign className="w-3 h-3 mr-1" />
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

                    {/* UPDATED: Native Transfers as Inputs/Outputs for Solana (FIXED: Use tx.solPrice) */}
                    <h3 className="text-md font-semibold flex items-center mt-4 uppercase"><Activity className="w-4 h-4 mr-2 text-neon-blue" />Native Transfers</h3>
                    {nativeTransfers.length > 0 && (
                        <div>
                            <table className="w-full border-collapse border border-white/10">
                                <thead><tr><th className="p-2 text-left">From</th><th className="p-2 text-left">To</th><th className="p-2 text-left">Amount</th></tr></thead>
                                <tbody>
                                    {nativeTransfers.map((transfer, i) => (
                                        <tr key={i} className="hover:bg-white/5">
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(transfer.fromUserAccount, chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(transfer.toUserAccount, chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">
                                                {renderValueWithUSD((transfer.amount || 0) / 1e9, ((transfer.amount || 0) / 1e9) * solPrice, symbol, chainLogos[chain])}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Instructions */}
                    {tx.instructions && (
                        <div>
                            <h4 className="flex items-center"><Activity className="w-4 h-4 mr-1" />Instructions</h4>
                            <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{JSON.stringify(tx.instructions, null, 2)}</pre>
                        </div>
                    )}
                </motion.div>
            );
        }

        return <div>Unsupported chain</div>;
    };

    const isOverallLoading = loading || nametagsLoading;

    return (
        <div className="font-saira w-full max-w-9xl mx-auto p-2 sm:p-3 bg-gradient-to-br from-black/80 to-gray-900/80 backdrop-blur-xs flex flex-col h-full overflow-y-auto hide-scrollbar relative">
            <div className="border-b border-white/10 mb-4 relative z-10 bg-inherit">
                <h1 className="text-xl font-bold flex items-center gap-2 m-4">
                    <img src="/logos/logo.webp" alt="Project Logo" className="w-8 h-8" />
                    Xynapse Explorer
                </h1>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                        <input
                            type="text"
                            placeholder="Enter transaction hash..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full h-[5vh] pl-10 pr-4 py-2 text-gray-500 border border-white/20 bg-black/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-neon-blue/50 shadow-sm text-sm"
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                    </div>
                    <button
                        onClick={handleSearch}
                        className="h-[5vh] px-4 py-1 bg-transparent border border-white/70 text-white rounded-lg hover:bg-white/10 transition-colors font-medium shadow-sm flex items-center justify-center"
                    >
                        <Search className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <LoadingOverlay
                isLoading={isOverallLoading}
                message={nametagsLoading ? "Loading nametags..." : "Fetching transaction data..."}
                className="absolute inset-0 z-5 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            />

            {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 flex items-center gap-2 p-4 bg-red-500/10 rounded border border-red-500/20 relative z-10">
                    <AlertCircle className="w-4 h-4" /> {error}
                </motion.div>
            )}

            <AnimatePresence>
                {results && !error && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 relative z-10 p-4">
                        {renderTxDetails(results.data, selectedChain)}
                    </motion.div>
                )}
            </AnimatePresence>

            <style jsx>{`
        table th, table td { border: 1px solid rgba(255,255,255,0.1); padding: 8px; }
        table tr:hover { background: rgba(255,255,255,0.05); }
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
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
        </div>
    );
}