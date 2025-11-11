'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Clock, Hash as HashIcon, AlertCircle, Wallet, Coins, Activity, Check, Copy, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { LoadingOverlay } from '../utils/helpers';

export default function ExplorerTab({ initialQuery }) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [query, setQuery] = useState(initialQuery || '');
    const [selectedChain, setSelectedChain] = useState('');
    const [results, setResults] = useState(null);
    const [nametags, setNametags] = useState({});  // New: {address: {name, description, ...}}
    const [nametagsLoading, setNametagsLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isMobile, setIsMobile] = useState(false);

    const chainConfig = {
        bitcoin: { id: null, apiBase: '/api/mempool' }, // Proxy to avoid CORS
        ethereum: { id: 1, apiBase: '/api/etherscan' },
        bsc: { id: 56, apiBase: '/api/etherscan' },
        solana: { id: null, apiBase: 'https://api.helius.xyz/v0' },
    };

    const chainLogos = {
        bitcoin: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
        ethereum: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
        bsc: 'https://assets.coingecko.com/coins/images/825/small/bnb.png',
        solana: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
    };

    // SEO: Dynamic title and meta updates
    useEffect(() => {
        if (results && results.data) {
            const txHash = results.data.hash || results.data.txid || results.data.signature || 'Unknown';
            const chainName = selectedChain.toUpperCase();
            const status = results.data.status || 'Pending';
            document.title = `Transaction ${truncateText(txHash, 8, 8)} on ${chainName} - ${status} | Xynapse Explorer`;

            // Update meta description for SEO
            let metaDesc = `Explore transaction ${truncateText(txHash, 8, 8)} on ${chainName} blockchain. Status: ${status}. View details, token transfers, and more on Xynapse Explorer.`;
            if (results.data.value) {
                const value = results.data.value || 0;
                metaDesc += ` Value: ${value.toFixed(6)} ${chainName === 'BITCOIN' ? 'BTC' : chainName === 'ETHEREUM' ? 'ETH' : chainName === 'BSC' ? 'BNB' : 'SOL'}.`;
            }
            const metaTag = document.querySelector('meta[name="description"]');
            if (metaTag) {
                metaTag.setAttribute('content', metaDesc);
            }

            // Update Open Graph meta for social sharing
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle) ogTitle.setAttribute('content', document.title);

            const ogDesc = document.querySelector('meta[property="og:description"]');
            if (ogDesc) ogDesc.setAttribute('content', metaDesc);

            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage) ogImage.setAttribute('content', chainLogos[selectedChain] || 'https://xynapseai.net/og.png');

            const ogUrl = document.querySelector('meta[property="og:url"]');
            if (ogUrl) ogUrl.setAttribute('content', `${window.location.origin}/dashboard?tab=explorer&query=${encodeURIComponent(query)}&chain=${selectedChain}`);

            // Canonical URL for SEO
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
        const checkMobile = () => setIsMobile(window.innerWidth < 768); // md breakpoint for mobile
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const truncateText = (text, start = 5, end = 5) => {
        if (!text || text.length <= start + end) return text;
        return `${text.slice(0, start)}...${text.slice(-end)}`;
    };

    const detectChainForTx = (txHash) => {
        const trimmed = txHash.trim();
        if (trimmed.startsWith('0x') && /^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
            return 'ethereum'; // Default to Ethereum for EVM tx hashes
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

    // New: Extract unique addresses from tx data
    const extractAddresses = (txData, chain) => {
        const addresses = new Set();
        let tx = txData;
        if (Array.isArray(txData)) tx = txData[0];

        // Common: from/to
        if (tx.from) addresses.add(tx.from.toLowerCase());
        if (tx.to) addresses.add(tx.to.toLowerCase());

        if (chain === 'ethereum' || chain === 'bsc') {
            // Token transfers
            if (tx.tokenTransfers) {
                tx.tokenTransfers.forEach(t => {
                    if (t.from) addresses.add(t.from.toLowerCase());
                    if (t.to) addresses.add(t.to.toLowerCase());
                });
            }
            // Internal txs
            if (tx.internalTxs && Array.isArray(tx.internalTxs)) {
                tx.internalTxs.forEach(itx => {
                    if (itx.from) addresses.add(itx.from.toLowerCase());
                    if (itx.to) addresses.add(itx.to.toLowerCase());
                });
            }
        } else if (chain === 'bitcoin') {
            // Inputs (vin prevouts)
            if (tx.vin && Array.isArray(tx.vin)) {
                tx.vin.forEach(vin => {
                    if (vin.prevout?.scriptpubkey_address) {
                        addresses.add(vin.prevout.scriptpubkey_address.toLowerCase());
                    }
                });
            }
            // Outputs (vout scriptpubs)
            if (tx.vout && Array.isArray(tx.vout)) {
                tx.vout.forEach(vout => {
                    if (vout.scriptpubkey_address) {
                        addresses.add(vout.scriptpubkey_address.toLowerCase());
                    }
                });
            }
        } else if (chain === 'solana') {
            // Solana accounts (simplified, add if needed)
            if (tx.accounts && Array.isArray(tx.accounts)) {
                tx.accounts.forEach(acc => {
                    if (acc) addresses.add(acc.toLowerCase());
                });
            }
        }

        return Array.from(addresses).slice(0, 50);  // Limit to 50 to avoid overload
    };

    // New: Fetch nametags for addresses
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
            console.log('Nametags loaded:', newNametags);  // Debug: Kiểm tra data có load không
            if (Object.keys(newNametags).length > 0) {
                toast.success(`Found nametags for ${Object.keys(newNametags).length} addresses`);
            }
        } catch (err) {
            console.error('Nametags fetch error:', err);  // Debug: Log error nếu có
            toast.error('Failed to load nametags');
        } finally {
            setNametagsLoading(false);
        }
    };

    const fetchData = async (q, ch) => {
        setLoading(true);
        setError(null);
        try {
            let data = {};
            const headers = {
                'Content-Type': 'application/json',
            };

            if (ch === 'solana') {
                headers['Authorization'] = `Bearer ${process.env.NEXT_PUBLIC_HELIUS_KEY}`;
            }

            const fetchOptions = {
                method: 'GET',
                headers,
                credentials: 'include'
            };

            let endpoint;
            let method = 'GET';
            let body;
            switch (ch) {
                case 'bitcoin':
                    endpoint = chainConfig[ch].apiBase;
                    method = 'POST';
                    body = { action: 'tx-details', txHash: q };
                    break;
                case 'ethereum':
                case 'bsc':
                    endpoint = chainConfig[ch].apiBase;
                    method = 'POST';
                    body = { action: 'tx-details', chain: ch, txHash: q };
                    break;
                case 'solana':
                    endpoint = `${chainConfig[ch].apiBase}/transactions/${q}`;
                    break;
                default:
                    throw new Error('Unsupported chain for tx');
            }
            fetchOptions.method = method;
            if (body) {
                fetchOptions.body = JSON.stringify(body);
            }
            const res = await fetch(endpoint, fetchOptions);
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const resJson = await res.json();
            if (ch === 'bitcoin' || ch === 'ethereum' || ch === 'bsc') {
                if (!resJson.success) throw new Error(resJson.detail || 'Transaction not found');
                data = resJson.data;
            } else {
                data = resJson;
            }

            setResults({ data, chain: ch });

            // New: Extract and fetch nametags after tx data
            const addresses = extractAddresses(data, ch);
            if (addresses.length > 0) {
                await fetchNametags(addresses, ch);
            }
        } catch (err) {
            // For EVM, if not found on ethereum, try bsc
            if (ch === 'ethereum' && err.message.includes('not found')) {
                try {
                    const bscData = await fetchData(q, 'bsc'); // Recursive try bsc
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
                // Optional: Auto-retry once
                setTimeout(() => fetchData(q, ch), 2000);
                return; // Don't set error immediately
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
            const ch = detectChainForTx(query);
            setSelectedChain(ch);
            setNametags({});  // Reset nametags on new search

            // SEO: Update URL with query params for shareable links (đổi sang /explorer)
            router.push(`/explorer?query=${encodeURIComponent(query)}&chain=${ch}`, { scroll: false });

            fetchData(query, ch);
        } catch (err) {
            setError(err.message);
            toast.error(err.message);
        }
    };

    useEffect(() => {
        if (initialQuery) handleSearch();
    }, [initialQuery]);

    // Updated: Render address with nametag (tách font, thêm image cho visible hơn, truncate on mobile)
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

    const renderTxDetails = (txData, chain) => {
        let tx = txData;
        if (Array.isArray(txData)) tx = txData[0];
        if (chain === 'ethereum' || chain === 'bsc') {
            tx = { ...txData.transaction, receipt: txData.receipt, internalTxs: txData.internalTxs, tokenTransfers: txData.tokenTransfers };
            const blockNumber = parseInt(tx.blockNumber, 16);
            const timestamp = parseInt(txData.block.timestamp, 16) * 1000;
            const gasUsed = parseInt(tx.receipt.gasUsed, 16);
            const effectiveGasPrice = parseInt(tx.receipt.effectiveGasPrice || tx.gasPrice, 16);
            const fee = (gasUsed * effectiveGasPrice) / 1e18;
            const nativeValue = Number(parseInt(tx.value, 16)) / 1e18;
            const status = tx.receipt.status === '0x1' ? 'Success' : 'Failed';
            const isSuccess = status === 'Success';

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
                            {nativeValue.toFixed(6)} {chain === 'ethereum' ? 'ETH' : 'BNB'} {tx.tokenTransfers.length > 0 && '(Token Transfer)'}
                        </div>
                        <div className="bg-black/50 p-3 rounded-lg border border-white/10 shadow-md hover:shadow-lg transition-shadow flex items-center justify-between backdrop-blur-sm">
                            <div className="flex items-center">
                                <HashIcon className="w-4 h-4 text-neon-blue mr-1" />
                                <span>Block: {blockNumber}</span>
                            </div>
                            <span className="flex items-center"><Clock className="w-4 h-4 mr-1" />Time: {new Date(timestamp).toLocaleString()}</span>
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
                            {fee.toFixed(6)} {chain === 'ethereum' ? 'ETH' : 'BNB'}
                        </div>
                    </div>

                    {tx.tokenTransfers && tx.tokenTransfers.length > 0 && (
                        <div className="mt-4">
                            <h3 className="text-md font-semibold flex items-center uppercase"><Coins className="w-4 h-4 mr-2 text-neon-blue" />Token Transfers</h3>
                            <table className="w-full border-collapse border border-white/10 mt-2">
                                <thead>
                                    <tr className="bg-black/70">
                                        <th className="p-2 text-left">Token</th>
                                        <th className="p-2 text-left">From</th>
                                        <th className="p-2 text-left">To</th>
                                        <th className="p-2 text-left">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tx.tokenTransfers.map((t, i) => (
                                        <tr key={i} className="hover:bg-white/5">
                                            <td className="p-2 border border-white/10 text-left">{t.symbol || t.tokenAddress}</td>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(t.from, chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(t.to, chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">{(Number(t.value) / 10 ** (t.decimals || 18)).toFixed(6)} {t.symbol || ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Inputs/Outputs */}
                    <h3 className="text-md font-semibold flex items-center mt-4 uppercase"><Activity className="w-4 h-4 mr-2 text-neon-blue" />Inputs/Outputs</h3>
                    {chain === 'bitcoin' && (tx.vin || tx.inputs) && (
                        <div>
                            <h4 className="flex items-center"><Wallet className="w-4 h-4 mr-1" />Inputs</h4>
                            <table className="w-full border-collapse border border-white/10">
                                <thead><tr><th className="text-left">From</th><th className="text-left">Value</th></tr></thead>
                                <tbody>
                                    {(tx.vin || tx.inputs || []).map((input, i) => (
                                        <tr key={i}>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(input.prevout?.scriptpubkey_address || input.address || 'Coinbase', chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">{(input.value || 0) / 1e8} BTC</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {chain === 'bitcoin' && (tx.vout || tx.outputs) && (
                        <div>
                            <h4 className="flex items-center"><Wallet className="w-4 h-4 mr-1" />Outputs</h4>
                            <table className="w-full border-collapse border border-white/10">
                                <thead><tr><th className="text-left">To</th><th className="text-left">Value</th></tr></thead>
                                <tbody>
                                    {(tx.vout || tx.outputs || []).map((output, i) => (
                                        <tr key={i}>
                                            <td className="p-2 border border-white/10 text-left">{renderAddress(output.scriptpubkey_address || output.address, chain)}</td>
                                            <td className="p-2 border border-white/10 text-left">{(output.value || 0) / 1e8} BTC</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {(chain === 'solana' || chain === 'ethereum' || chain === 'bsc') && (tx.instructions || tx.input) && (
                        <div>
                            <h4 className="flex items-center"><Activity className="w-4 h-4 mr-1" />Input Data</h4>
                            <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{tx.input || JSON.stringify(tx.instructions, null, 2)}</pre>
                        </div>
                    )}
                    {tx.receipt?.logs && (
                        <div>
                            <h4 className="flex items-center"><Activity className="w-4 h-4 mr-1" />Logs</h4>
                            <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{JSON.stringify(tx.receipt.logs, null, 2)}</pre>
                        </div>
                    )}
                    {tx.internalTxs && tx.internalTxs.length > 0 && (
                        <div>
                            <h4 className="flex items-center"><Activity className="w-4 h-4 mr-1" />Internal Transactions</h4>
                            <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">
                                {tx.internalTxs.map((itx, idx) => (
                                    <div key={idx}>
                                        From: {renderAddress(itx.from, chain)} | To: {renderAddress(itx.to, chain)} | Value: {itx.value / 1e18}
                                    </div>
                                ))}
                            </pre>
                        </div>
                    )}
                </motion.div>
            );
        } else if (chain === 'bitcoin') {
            // Enhance tx data for Bitcoin from mempool.space
            const isConfirmed = tx.status?.confirmed || tx.status?.block_height > 0;
            const status = isConfirmed ? 'Success' : 'Pending';
            const timestamp = tx.status?.block_time ? tx.status.block_time * 1000 : Date.now();
            const totalValue = tx.vout ? tx.vout.reduce((sum, out) => sum + (out.value || 0), 0) / 1e8 : 0;
            const fee = (tx.fee || 0) / 1e8;
            const fromAddress = tx.vin?.[0]?.prevout?.scriptpubkey_address || 'Multiple Inputs';
            const toAddress = tx.vout?.[0]?.scriptpubkey_address || 'Multiple Outputs';
            const blockNumber = tx.status?.block_height || null;

            // Map to common fields for consistent rendering
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
                            {totalValue.toFixed(8)} BTC
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
                            {fee.toFixed(8)} BTC
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
                                            <td className="p-2 border border-white/10 text-left">{(input.prevout?.value || 0) / 1e8} BTC</td>
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
                                            <td className="p-2 border border-white/10 text-left">{(output.value || 0) / 1e8} BTC</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </motion.div>
            );
        } else if (chain === 'solana') {
            tx.status = tx.result ? 'Success' : 'Failed';
            tx.timestamp = tx.blockTime * 1000;
        }

        const isSuccess = tx.status === 'Success' || tx.status?.confirmed;

        return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 text-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-black/50 p-3 rounded border border-white/10 flex items-center justify-between">
                        <div className="flex items-center">
                            <span className="text-white/70">Hash:</span> <HashIcon className="inline ml-1 w-3" />
                            <span className="font-mono break-all mr-2">{isMobile && (tx.hash || tx.txid || tx.signature)?.length > 10 ? truncateText(tx.hash || tx.txid || tx.signature) : (tx.hash || tx.txid || tx.signature)}</span>
                        </div>
                        <Copy
                            onClick={() => copyToClipboard(tx.hash || tx.txid || tx.signature)}
                            className="w-4 h-4 cursor-pointer hover:text-neon-blue"
                        />
                    </div>
                    <h2 className="text-base font-semibold flex items-center gap-2 md:col-span-2">
                        <img src={chainLogos[selectedChain]} alt={selectedChain} className="w-6 h-6 inline mx-1" />
                        <span className="text-neon-blue">{selectedChain}</span>
                    </h2>
                    <div className="bg-black/50 p-3 rounded border border-white/10">
                        <span className="text-white/70">Status:</span>
                        <span className={isSuccess ? 'text-green-500' : 'text-red-400'}>
                            {tx.status || (tx.status?.confirmed ? 'Confirmed' : 'Pending/Failed')}
                            {isSuccess && <Check className="w-3 h-3 inline ml-1" />}
                        </span>
                    </div>
                    {tx.blockNumber && (
                        <div className="bg-black/50 p-3 rounded border border-white/10">
                            Block: {typeof tx.blockNumber === 'string' ? parseInt(tx.blockNumber, 16) : tx.blockNumber}
                        </div>
                    )}
                    {tx.timestamp && (
                        <div className="bg-black/50 p-3 rounded border border-white/10">
                            Time: {new Date(tx.timestamp).toLocaleString()}
                        </div>
                    )}
                    {tx.fee && (
                        <div className="bg-black/50 p-3 rounded border border-white/10">
                            Fee: {(tx.fee / (chain === 'solana' ? 1e9 : chain === 'bitcoin' ? 1e8 : 1e18)).toFixed(6)} {chain === 'bitcoin' ? 'BTC' : chain === 'solana' ? 'SOL' : 'ETH'}
                        </div>
                    )}
                    {tx.value && (
                        <div className="bg-black/50 p-3 rounded border border-white/10">
                            Value: {Number(tx.value) / 1e18} {chain === 'bitcoin' ? 'BTC' : 'ETH'}
                        </div>
                    )}
                    <div className="bg-black/50 p-3 rounded border border-white/10 flex items-center justify-between">
                        From:
                        <div className="flex items-center">
                            {renderAddress(tx.from || tx.signer || '', chain)}
                            <Copy
                                onClick={() => copyToClipboard(tx.from || tx.signer || '')}
                                className="ml-2 w-4 h-4 cursor-pointer hover:text-neon-blue"
                            />
                        </div>
                    </div>
                    <div className="bg-black/50 p-3 rounded border border-white/10 flex items-center justify-between">
                        To:
                        <div className="flex items-center">
                            {renderAddress(tx.to || tx.accounts?.[0] || '', chain)}
                            <Copy
                                onClick={() => copyToClipboard(tx.to || tx.accounts?.[0] || '')}
                                className="ml-2 w-4 h-4 cursor-pointer hover:text-neon-blue"
                            />
                        </div>
                    </div>
                </div>
                {/* Inputs/Outputs */}
                <h3 className="text-md font-semibold">Inputs/Outputs</h3>
                {chain === 'bitcoin' && (tx.vin || tx.inputs) && (
                    <div>
                        <h4>Inputs</h4>
                        <table className="w-full border-collapse border border-white/10">
                            <thead><tr><th className="text-left">From</th><th className="text-left">Value</th></tr></thead>
                            <tbody>
                                {(tx.vin || tx.inputs || []).map((input, i) => (
                                    <tr key={i}>
                                        <td className="font-mono break-all text-left">{renderAddress(input.prevout?.scriptpubkey_address || input.address || 'Coinbase', chain)}</td>
                                        <td className="text-left">{(input.value || 0) / 1e8} BTC</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {chain === 'bitcoin' && (tx.vout || tx.outputs) && (
                    <div>
                        <h4>Outputs</h4>
                        <table className="w-full border-collapse border border-white/10">
                            <thead><tr><th className="text-left">To</th><th className="text-left">Value</th></tr></thead>
                            <tbody>
                                {(tx.vout || tx.outputs || []).map((output, i) => (
                                    <tr key={i}>
                                        <td className="font-mono break-all text-left">{renderAddress(output.scriptpubkey_address || output.address, chain)}</td>
                                        <td className="text-left">{(output.value || 0) / 1e8} BTC</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {(chain === 'solana' || chain === 'ethereum' || chain === 'bsc') && (tx.instructions || tx.input) && (
                    <div>
                        <h4>Input Data</h4>
                        <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{tx.input || JSON.stringify(tx.instructions, null, 2)}</pre>
                    </div>
                )}
                {tx.receipt?.logs && (
                    <div>
                        <h4>Logs</h4>
                        <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{JSON.stringify(tx.receipt.logs, null, 2)}</pre>
                    </div>
                )}
                {tx.internalTxs && tx.internalTxs.length > 0 && (
                    <div>
                        <h4>Internal Transactions</h4>
                        <pre className="text-xs bg-black/70 p-2 rounded overflow-auto max-h-40 custom-scrollbar">{JSON.stringify(tx.internalTxs, null, 2)}</pre>
                    </div>
                )}
            </motion.div>
        );
    };

    return (
        <div className="h-full w-full flex flex-col p-4 bg-gradient-to-br from-black/80 to-gray-900/80 backdrop-blur-sm rounded-xl m-1 overflow-y-auto">
            <div className="sticky top-0 z-10 border-b border-white/10 mb-4">
                <h1 className="text-xl font-bold flex items-center gap-2 m-4">
                    {/* Placeholder cho logo dự án webp - thay src bằng path thực tế khi thêm */}
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

            <LoadingOverlay isLoading={loading || nametagsLoading} message={nametagsLoading ? "Loading nametags..." : "Fetching transaction data..."} />

            {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 flex items-center gap-2 p-4 bg-red-500/10 rounded border border-red-500/20">
                    <AlertCircle className="w-4 h-4" /> {error}
                </motion.div>
            )}

            <AnimatePresence>
                {results && !error && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

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
      `}</style>
        </div>
    );
}