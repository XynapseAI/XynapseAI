// components\DexTab.jsx
'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    LineChart,
    Line,
    PieChart,
    Pie,
    Cell,
} from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'
import { LoadingOverlay } from '@/utils/helpers'
import { ChevronDown, Copy, ChevronLeft, ChevronRight, Search } from 'lucide-react'
const hlColors = [
    '#00FF88',
    '#00E7FF',
    '#FF44AA',
    '#FFD700',
    '#FF6B6B',
    '#9D4EDD',
    '#32CD32',
    '#00D4FF',
    '#FF1493',
    '#FFA500',
    '#1E90FF',
    '#FF69B4',
]
// --- FORMATTERS ---
export const formatCompactNumber = (num) => {
    if (!num) return '$0'
    const value = parseFloat(num)
    if (isNaN(value)) return '$0'
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2,
    }).format(value)
}
export const formatStandardNumber = (num) => {
    if (!num) return '0'
    return new Intl.NumberFormat('de-DE').format(parseFloat(num))
}
const safeFixed = (v, decimals = 1) => {
    const num = Number(v || 0)
    return isNaN(num) ? '0' : num.toFixed(decimals)
}
// Custom Tooltip
const CustomTooltip = ({ active, payload, label, isPnl }) => {
    if (active && payload && payload.length) {
        return (
            <motion.div
                className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] p-4 rounded-2xl text-[#FFF] text-sm font-medium shadow-2xl"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
            >
                <p className="text-[#D4D4D4] text-xs mb-2">{label}</p>
                {payload.map((entry, i) => {
                    const value = entry.value || 0
                    const isNegative = value < 0
                    const absValue = Math.abs(value)
                    return (
                        <div key={i} className="flex items-center gap-3">
                            <div
                                className="w-3 h-3 rounded-sm"
                                style={{ backgroundColor: entry.color }}
                            />
                            <span className="text-[#FFF]">{entry.name}:</span>
                            <span
                                className={`font-bold ${isNegative ? 'text-red-500/80' : 'text-emerald-400'}`}
                            >
                                {isPnl
                                    ? `$${formatStandardNumber(absValue)} ${isNegative ? '(Loss)' : '(Profit)'}`
                                    : formatStandardNumber(absValue)}
                            </span>
                        </div>
                    )
                })}
            </motion.div>
        )
    }
    return null
}
// Custom Pie Label
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
    if (percent < 0.05) return null
    const RADIAN = Math.PI / 180
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)
    return (
        <text
            x={x}
            y={y}
            fill="black"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fontWeight="bold"
        >
            {name}
        </text>
    )
}
// Simple toast component
const Toast = ({ message, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 2000)
        return () => clearTimeout(timer)
    }, [onClose])
    return (
        <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-green-600/90 text-white px-6 py-3 rounded-lg shadow-2xl z-50"
        >
            {message}
        </motion.div>
    )
}
export default function DexTab() {
    const [inputWalletAddress, setInputWalletAddress] = useState('')
    const [currentWallet, setCurrentWallet] = useState('')
    const [selectedAsset, setSelectedAsset] = useState('BTC')
    const [selectedDEX, setSelectedDEX] = useState('hyperliquid')
    const [isDexMenuOpen, setIsDexMenuOpen] = useState(false)
    const [isAssetMenuOpen, setIsAssetMenuOpen] = useState(false)
    const dexMenuRef = useRef(null)
    const assetMenuRef = useRef(null)
    const [metaDataHyper, setMetaDataHyper] = useState({ universe: [], assetCtxs: [] })
    const [metaDataLighter, setMetaDataLighter] = useState({ universe: [], assetCtxs: [] })
    const [orderBooksLighter, setOrderBooksLighter] = useState([])
    const [candleData, setCandleData] = useState([])
    const [l2Book, setL2Book] = useState({ bids: [], asks: [] })
    const [pnlChartData, setPnlChartData] = useState([])
    const [portfolioData, setPortfolioData] = useState([])
    const [fills, setFills] = useState([])
    const [assetSearchTerm, setAssetSearchTerm] = useState('')
    const [analytics, setAnalytics] = useState({
        totalPnl: 0,
        winRate: 0,
        numTrades: 0,
        totalBalance: 0,
    })
    const [activeAssetsHyper, setActiveAssetsHyper] = useState([])
    const [activeAssetsLighter, setActiveAssetsLighter] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [recentWhaleTrades, setRecentWhaleTrades] = useState([])
    const [activityPage, setActivityPage] = useState(1)
    const tradesPerPage = 50
    const totalDisplayTrades = 500
    const totalPages = Math.ceil(totalDisplayTrades / tradesPerPage)
    const [toastMessage, setToastMessage] = useState(null)
    // Pagination for large trades
    const largeTrades = fills
        .filter(
            (f) =>
                Math.abs(parseFloat(f.closedPnl || 0)) > 1000 ||
                parseFloat(f.sz) * parseFloat(f.px) > 100000,
        )
        .sort((a, b) => b.time - a.time)
    const [largePage, setLargePage] = useState(1)
    const largeTotalPages = Math.ceil(largeTrades.length / tradesPerPage)
    const displayedLargeTrades = largeTrades.slice(
        (largePage - 1) * tradesPerPage,
        largePage * tradesPerPage,
    )
    const [randomWhaleWallet, setRandomWhaleWallet] = useState(null)
    const assetToMarketIdLighter = useRef({})
    const marketIdToSymbolLighter = useRef({})
    const inputRef = useRef(null)
    const metaData = selectedDEX === 'hyperliquid' ? metaDataHyper : metaDataLighter
    const activeAssets = selectedDEX === 'hyperliquid' ? activeAssetsHyper : activeAssetsLighter
    const [eventSource, setEventSource] = useState(null)
    const assetToImage = metaData.universe.reduce((acc, u) => {
        acc[u.name] = u.image || null
        return acc
    }, {})
    const assetToColor = activeAssets.reduce((acc, asset, i) => {
        acc[asset] = hlColors[i % hlColors.length]
        return acc
    }, {})
    const oiData = useMemo(() => {
        const currentMeta = selectedDEX === 'hyperliquid' ? metaDataHyper : metaDataLighter
        if (!currentMeta.universe || currentMeta.universe.length === 0) return []
        return currentMeta.universe
            .map((u, i) => ({
                name: u.name,
                value: parseFloat(currentMeta.assetCtxs[i]?.openInterest || 0),
            }))
            .filter((item) => item.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 10)
    }, [selectedDEX, metaDataHyper, metaDataLighter])
    // New state for asset table filter
    const [assetTableFilter, setAssetTableFilter] = useState('')
    // Computed filtered assets for the new table
    const filteredAssets = useMemo(() => {
        return metaData.universe
            .map((u, i) => ({
                name: u.name,
                image: u.image,
                volume: parseFloat(metaData.assetCtxs[i]?.dayNtlVlm || 0),
                oi: parseFloat(metaData.assetCtxs[i]?.openInterest || 0),
                midPx: parseFloat(metaData.assetCtxs[i]?.midPx || 0),
                funding: parseFloat(metaData.assetCtxs[i]?.funding || 0),
                dayPxChg: parseFloat(metaData.assetCtxs[i]?.dayPxChg || 0),
            }))
            .filter((asset) => asset.name.toLowerCase().includes(assetTableFilter.toLowerCase()))
            .sort((a, b) => b.volume - a.volume)
    }, [metaData, assetTableFilter])
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text)
        setToastMessage('Copied to clipboard!')
    }
    useEffect(() => {
        if (randomWhaleWallet && portfolioData.length === 0 && currentWallet === '') {
            fetchUserData(randomWhaleWallet)
        }
    }, [randomWhaleWallet, portfolioData.length, currentWallet])
    useEffect(() => {
        fetchGlobalDataHyper()
        fetchGlobalDataLighter()
        const es = new EventSource('/api/whale-trades/sse')
        setEventSource(es)
        es.onmessage = (event) => {
            try {
                const newData = JSON.parse(event.data)
                if (Array.isArray(newData) && newData.length > 10) {
                    setRecentWhaleTrades(newData)
                    setActivityPage(1)
                } else {
                    setRecentWhaleTrades((prev) => {
                        const existingIds = new Set(prev.map((t) => t.id))
                        const tradesToAdd = Array.isArray(newData) ? newData : [newData]
                        const uniqueNew = tradesToAdd.filter((t) => !existingIds.has(t.id))
                        const updated = [...uniqueNew, ...prev]
                            .sort((a, b) => b.time - a.time)
                            .slice(0, totalDisplayTrades)
                        return updated
                    })
                    setActivityPage(1)
                }
            } catch (err) {
                console.error('SSE parse error:', err)
            }
        }
        es.onerror = () => {
            console.error('SSE connection error, reconnecting in 3s...')
            es.close()
            setTimeout(() => {
                setEventSource(new EventSource('/api/whale-trades/sse'))
            }, 3000)
        }
        return () => {
            es.close()
            setEventSource(null)
        }
    }, [])
    useEffect(() => {
        if (
            recentWhaleTrades.length > 0 &&
            !currentWallet &&
            portfolioData.length === 0 &&
            !randomWhaleWallet
        ) {
            const randomTrade =
                recentWhaleTrades[
                    Math.floor(Math.random() * Math.min(50, recentWhaleTrades.length))
                ]
            let address = ''
            let dex = randomTrade.dex
            if (dex === 'hyperliquid') {
                address = Math.random() > 0.5 ? randomTrade.buyer : randomTrade.seller
            } else if (dex === 'lighter') {
                address = Math.random() > 0.5 ? randomTrade.buyer : randomTrade.seller
            }
            if (address && address !== 'unknown') {
                setRandomWhaleWallet(address)
                console.log('Auto-selected random whale:', { dex, address })
            }
        }
    }, [recentWhaleTrades, currentWallet, portfolioData.length, randomWhaleWallet])
    useEffect(() => {
        fetchCandles(selectedAsset)
        fetchL2Book(selectedAsset)
    }, [selectedAsset])
    useEffect(() => {
        fetchCandles(selectedAsset)
        fetchL2Book(selectedAsset)
    }, [selectedDEX, selectedAsset])
    // Add this new useEffect after the existing useEffects
    useEffect(() => {
        if (currentWallet) {
            fetchUserData(currentWallet, selectedDEX)
        }
    }, [selectedDEX])
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (
                dexMenuRef.current &&
                !dexMenuRef.current.contains(event.target) &&
                assetMenuRef.current &&
                !assetMenuRef.current.contains(event.target)
            ) {
                setIsDexMenuOpen(false)
                setIsAssetMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])
    const fetchGlobalDataHyper = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/hyperliquid')
            const data = await res.json()
            setMetaDataHyper(data)
            const sortedAssets = data.universe
                .map((u, i) => ({
                    name: u.name,
                    volume: parseFloat(data.assetCtxs[i]?.dayNtlVlm || 0),
                }))
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 10)
                .map((a) => a.name)
            setActiveAssetsHyper(sortedAssets)
        } catch (err) {
            setError('Failed to fetch Hyperliquid data')
        } finally {
            setLoading(false)
        }
    }

    const fetchGlobalDataLighter = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/lighter')
            const data = await res.json()
            setMetaDataLighter(data)
            setOrderBooksLighter(data.orderBooks)
            assetToMarketIdLighter.current = data.assetToMarketId
            marketIdToSymbolLighter.current = data.marketIdToSymbol

            const sortedAssets = data.universe
                .map((u, i) => ({
                    name: u.name,
                    volume: parseFloat(data.assetCtxs[i]?.dayNtlVlm || 0),
                }))
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 10)
                .map((a) => a.name)
            setActiveAssetsLighter(sortedAssets)
        } catch (err) {
            setError('Failed to fetch Lighter data')
        } finally {
            setLoading(false)
        }
    }

    const fetchCandles = async (asset) => {
        setCandleData([])
        const dex = selectedDEX === 'lighter' ? 'hyperliquid' : selectedDEX
        const res = await fetch(`/api/${dex}?type=candles&coin=${asset}`)
        if (!res.ok) return
        const rawData = await res.json()
        const formatted = rawData.map((c) => ({
            t: c.t || c.timestamp * 1000,
            c: parseFloat(c.c || c.close),
        }))
        setCandleData(formatted)
    }

    const fetchL2Book = async (asset) => {
        const res = await fetch(`/api/${selectedDEX}?type=l2book&coin=${asset}`)
        if (!res.ok) return
        const data = await res.json()
        if (selectedDEX === 'hyperliquid') {
            setL2Book({ bids: data.levels[0], asks: data.levels[1] })
        } else {
            setL2Book({ bids: data.bids || [], asks: data.asks || [] })
        }
    }
    const fetchUserData = async (inputAddress, forceDEX = null) => {
        if (!inputAddress || !inputAddress.trim()) return

        const address = inputAddress.trim()
        setLoading(true)
        setError(null)
        setPortfolioData([])
        setFills([])
        setPnlChartData([])
        setAnalytics({ totalPnl: 0, winRate: 0, numTrades: 0, totalBalance: 0 })

        let targetDEX = forceDEX || selectedDEX
        let success = false
        let accountL1Address = address

        try {
            if (/^\d+$/.test(address)) {
                if (forceDEX && forceDEX !== 'lighter') {
                    throw new Error('Numeric Account ID is only valid on Lighter.')
                }
                targetDEX = 'lighter'

                const res = await fetch(`/api/lighter?type=user&by=index&address=${address}`)
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}))
                    throw new Error(err.error || 'No Lighter account with this ID was found.')
                }

                const { account, fills, pnlHistory } = await res.json()

                // Positions
                const positions = (account.positions || []).filter(
                    (p) => parseFloat(p.position || 0) !== 0,
                )
                setPortfolioData(positions)

                // Fills / Trades
                setFills(fills)

                // Analytics
                const totalPnl = (account.positions || []).reduce(
                    (sum, p) =>
                        sum +
                        (parseFloat(p.unrealized_pnl || 0) || 0) +
                        (parseFloat(p.realized_pnl || 0) || 0),
                    0,
                )
                const totalBalance = parseFloat(account.available_balance || 0)
                const wins = fills.filter((f) => parseFloat(f.closedPnl || 0) > 0).length
                const numTrades = fills.length
                const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0

                setAnalytics({ totalPnl, winRate, numTrades, totalBalance })

                // Cumulative PnL chart
                let cumulativePnl = 0
                const pnlData = (pnlHistory || [])
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .map((entry) => {
                        cumulativePnl += parseFloat(entry.pnl || entry.value || 0)
                        return {
                            date: new Date(entry.timestamp).toLocaleDateString(),
                            pnl: cumulativePnl,
                            asset: entry.symbol || 'All',
                        }
                    })
                setPnlChartData(pnlData)

                success = true
            }
            // Case 2: Ethereum address (0x...)
            else if (address.startsWith('0x') && address.length === 42) {
                if (targetDEX === 'hyperliquid' || !forceDEX) {
                    try {
                        const res = await fetch(`/api/hyperliquid?type=user&address=${address}`)
                        if (res.ok) {
                            const { state, fills } = await res.json()

                            // Positions
                            const positions = state.assetPositions
                                .map((pos) => pos.position)
                                .filter((p) => parseFloat(p.szi || 0) !== 0)
                            setPortfolioData(positions)

                            // Fills
                            setFills(fills)

                            // Analytics
                            let totalPnl = 0
                            let wins = 0
                            fills.forEach((fill) => {
                                const pnl = parseFloat(fill.closedPnl || 0)
                                totalPnl += pnl
                                if (pnl > 0) wins++
                            })
                            const numTrades = fills.length
                            const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0
                            const totalBalance = parseFloat(state.marginSummary.accountValue || 0)

                            setAnalytics({ totalPnl, winRate, numTrades, totalBalance })

                            // Cumulative PnL chart
                            let cumulativePnl = 0
                            const sortedFills = [...fills].sort((a, b) => a.time - b.time)
                            const pnlData = sortedFills.map((fill) => {
                                cumulativePnl += parseFloat(fill.closedPnl || 0)
                                return {
                                    date: new Date(fill.time).toLocaleDateString(),
                                    pnl: cumulativePnl,
                                    asset: fill.coin,
                                }
                            })
                            setPnlChartData(pnlData)

                            targetDEX = 'hyperliquid'
                            success = true
                        }
                    } catch (hyperErr) {
                        console.warn(
                            'Hyperliquid user fetch failed, trying Lighter fallback',
                            hyperErr,
                        )
                        if (forceDEX) throw hyperErr
                    }
                }

                if (!success && (targetDEX === 'lighter' || !forceDEX)) {
                    targetDEX = 'lighter'
                    const res = await fetch(
                        `/api/lighter?type=user&by=l1_address&address=${address}`,
                    )
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}))
                        throw new Error(err.error || 'No Lighter account found with this address.')
                    }

                    const { account, fills, pnlHistory } = await res.json()

                    // Positions
                    const positions = (account.positions || []).filter(
                        (p) => parseFloat(p.position || 0) !== 0,
                    )
                    setPortfolioData(positions)

                    // Fills
                    setFills(fills)

                    // Analytics
                    const totalPnl = (account.positions || []).reduce(
                        (sum, p) =>
                            sum +
                            (parseFloat(p.unrealized_pnl || 0) || 0) +
                            (parseFloat(p.realized_pnl || 0) || 0),
                        0,
                    )
                    const totalBalance = parseFloat(account.available_balance || 0)
                    const wins = fills.filter((f) => parseFloat(f.closedPnl || 0) > 0).length
                    const numTrades = fills.length
                    const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0

                    setAnalytics({ totalPnl, winRate, numTrades, totalBalance })

                    // Cumulative PnL chart
                    let cumulativePnl = 0
                    const pnlData = (pnlHistory || [])
                        .sort((a, b) => a.timestamp - b.timestamp)
                        .map((entry) => {
                            cumulativePnl += parseFloat(entry.pnl || entry.value || 0)
                            return {
                                date: new Date(entry.timestamp).toLocaleDateString(),
                                pnl: cumulativePnl,
                                asset: entry.symbol || 'All',
                            }
                        })
                    setPnlChartData(pnlData)

                    success = true
                }
            } else {
                throw new Error(
                    'Invalid format. Please enter your Ethereum address (0x...) or Account ID number (Lighter).',
                )
            }

            if (success) {
                setSelectedDEX(targetDEX)
                setCurrentWallet(accountL1Address)
            }
        } catch (err) {
            console.error('fetchUserData error:', err)
            setError(err.message || 'Unable to load user data. Please double check address/ID.')
        } finally {
            setLoading(false)
        }
    }
    const handleAssetChange = (asset) => {
        setSelectedAsset(asset)
        setIsAssetMenuOpen(false)
        fetchCandles(asset)
        fetchL2Book(asset)
    }
    const handleDEXChange = (dex) => {
        setSelectedDEX(dex)
        setIsDexMenuOpen(false)
    }
    const filteredPnlData = pnlChartData.filter((d) => activeAssets.includes(d.asset))
    const shortWallet = currentWallet
        ? `${currentWallet.slice(0, 8)}...${currentWallet.slice(-6)}`
        : ''
    // New computed for position distribution pie
    const positionData = useMemo(() => {
        return portfolioData
            .map((pos) => {
                const midPx =
                    metaData.assetCtxs.find(
                        (ctx, i) => metaData.universe[i].name === (pos.symbol || pos.coin),
                    )?.midPx || 0
                const value = Math.abs(parseFloat(pos.position || pos.szi)) * midPx
                return {
                    name: pos.symbol || pos.coin,
                    value: value > 0 ? value : 0,
                }
            })
            .filter((item) => item.value > 0)
    }, [portfolioData, metaData])
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full h-full p-4 bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col gap-6 overflow-y-auto"
        >
            {loading && <LoadingOverlay isLoading={true} />}
            {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
            {/* Global Dashboard */}
            <div className="p-4">
                {/* DEX Selector */}
                <div className="relative mb-6">
                    <button
                        ref={dexMenuRef}
                        onClick={() => setIsDexMenuOpen(!isDexMenuOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#FFFFFF08] border border-[#FFFFFF15] rounded-lg text-white hover:border-white/30 transition"
                    >
                        <img
                            src={
                                selectedDEX === 'hyperliquid'
                                    ? '/hyperliquid.webp'
                                    : '/lighter.webp'
                            }
                            alt={selectedDEX}
                            className="w-4 h-4 rounded"
                        />
                        <span className="text-xs font-semibold capitalize">{selectedDEX}</span>
                        <ChevronDown size={14} className="text-white/50" />
                    </button>
                    <AnimatePresence>
                        {isDexMenuOpen && (
                            <motion.ul
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="absolute z-10 mt-2 w-38 sm:w-46 bg-black/90 border border-white/15 rounded-lg shadow-2xl"
                            >
                                <li
                                    onClick={() => handleDEXChange('hyperliquid')}
                                    className="flex items-center gap-3 px-4 py-2.5 text-xs cursor-pointer hover:bg-white/10 transition"
                                >
                                    <img
                                        src="/hyperliquid.webp"
                                        alt="Hyperliquid"
                                        className="w-4 h-4 rounded"
                                    />
                                    <span>Hyperliquid</span>
                                </li>
                                <li
                                    onClick={() => handleDEXChange('lighter')}
                                    className="flex items-center gap-3 px-4 py-2.5 text-xs cursor-pointer hover:bg-white/10 transition"
                                >
                                    <img
                                        src="/lighter.webp"
                                        alt="Lighter"
                                        className="w-4 h-4 rounded"
                                    />
                                    <span>Lighter</span>
                                </li>
                            </motion.ul>
                        )}
                    </AnimatePresence>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* OI Distribution */}
                    {oiData.length > 0 ? (
                        <div className="h-[250px] md:h-[320px]">
                            <h3 className="text-xs sm:text-sm font-bold text-[#FFF] mb-2">
                                Open Interest Distribution
                            </h3>
                            <ResponsiveContainer>
                                <PieChart>
                                    <Pie
                                        data={oiData}
                                        dataKey="value"
                                        nameKey="name"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={window.innerWidth < 768 ? 40 : 60}
                                        outerRadius={window.innerWidth < 768 ? 77 : 110}
                                        paddingAngle={2}
                                        labelLine={false}
                                        label={renderCustomizedLabel}
                                    >
                                        {oiData.map((entry, i) => (
                                            <Cell
                                                key={`cell-${i}`}
                                                fill={hlColors[i % hlColors.length]}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<CustomTooltip />} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-[250px] md:h-[320px] flex items-center justify-center">
                            <p className="text-gray-500 text-xs">
                                {selectedDEX === 'lighter'
                                    ? 'Open Interest not available for Lighter'
                                    : 'No Open Interest data available'}
                            </p>
                        </div>
                    )}
                    {/* Top Assets by Volume */}
                    <div>
                        <h3 className="text-xs sm:text-sm font-bold text-[#FFF] mb-2">
                            Top Assets by Volume (24h)
                        </h3>
                        <div className="space-y-2">
                            {metaData.universe
                                .map((u, i) => ({
                                    name: u.name,
                                    volume: parseFloat(metaData.assetCtxs[i]?.dayNtlVlm || 0),
                                    image: u.image,
                                }))
                                .sort((a, b) => b.volume - a.volume)
                                .slice(0, 5)
                                .map((asset, i) => (
                                    <div
                                        key={i}
                                        className="text-xs sm:text-sm flex justify-between items-center p-2 bg-[#FFFFFF]/5 rounded-lg"
                                    >
                                        <div className="flex items-center gap-3">
                                            {asset.image && (
                                                <img
                                                    src={asset.image}
                                                    alt={asset.name}
                                                    className="w-6 h-6 rounded-full"
                                                />
                                            )}
                                            <span className="font-bold text-white">
                                                {asset.name}
                                            </span>
                                        </div>
                                        <span className="text-emerald-400 font-mono font-bold">
                                            {formatCompactNumber(asset.volume)}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    </div>
                    {/* New All Assets Table */}
                    <div className="col-span-2 bg-[#0A0A0A]/90 border border-[#FFFFFF20] rounded-2xl p-6">
                        <h3 className="text-lg font-bold text-[#FFF] mb-4">Assets Metrics</h3>
                        <div className="mb-4">
                            <input
                                type="text"
                                placeholder="Search asset..."
                                value={assetTableFilter}
                                onChange={(e) => setAssetTableFilter(e.target.value)}
                                className="w-full px-4 py-2 bg-[#0A0A0A]/80 border border-white/20 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                            />
                        </div>
                        <div className="overflow-auto max-h-[400px] custom-scrollbar">
                            <table className="w-full text-xs md:text-sm">
                                <thead className="text-gray-400 border-b border-white/10 sticky top-0 bg-[#0A0A0A]/90 z-10">
                                    <tr>
                                        <th className="text-left py-3 px-4">Asset</th>
                                        <th className="text-right py-3 px-4">24h Volume</th>
                                        <th className="text-right py-3 px-4">Open Interest</th>
                                        <th className="text-right py-3 px-4">Mid Price</th>
                                        <th className="text-right py-3 px-4">Funding Rate</th>
                                        <th className="text-right py-3 px-4">24h Change (%)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {filteredAssets.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan="6"
                                                className="py-4 text-center text-gray-500"
                                            >
                                                No assets found
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredAssets.map((asset, i) => (
                                            <tr key={i} className="hover:bg-white/5 transition">
                                                <td className="py-3 px-4 flex items-center gap-2">
                                                    {asset.image && (
                                                        <img
                                                            src={asset.image}
                                                            alt={asset.name}
                                                            className="w-5 h-5 rounded-full"
                                                        />
                                                    )}
                                                    <span className="font-medium text-white">
                                                        {asset.name}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono text-emerald-400">
                                                    {formatCompactNumber(asset.volume)}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono text-white">
                                                    {formatCompactNumber(asset.oi)}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono text-white">
                                                    ${formatStandardNumber(asset.midPx)}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono">
                                                    <span
                                                        className={
                                                            asset.funding >= 0
                                                                ? 'text-emerald-400'
                                                                : 'text-red-400'
                                                        }
                                                    >
                                                        {safeFixed(asset.funding * 100, 4)}%
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono">
                                                    <span
                                                        className={
                                                            asset.dayPxChg >= 0
                                                                ? 'text-emerald-400'
                                                                : 'text-red-400'
                                                        }
                                                    >
                                                        {safeFixed(asset.dayPxChg * 100, 2)}%
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {/* Price Chart + Selector */}
                    <div className="col-span-2">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-bold text-[#FFF]">
                                {selectedAsset} Price Action (30D)
                            </h3>
                            <div className="relative" ref={assetMenuRef}>
                                <button
                                    onClick={() => setIsAssetMenuOpen(!isAssetMenuOpen)}
                                    className="text-xs sm:text-sm flex items-center gap-2 px-4 py-2 bg-[#FFFFFF08] border border-[#FFFFFF15] rounded-lg text-white hover:border-white/30 transition"
                                >
                                    {assetToImage[selectedAsset] && (
                                        <img
                                            src={assetToImage[selectedAsset]}
                                            alt={selectedAsset}
                                            className="w-3 h-3 sm:w-5 sm:h-5 rounded-full"
                                        />
                                    )}
                                    <span className="font-medium">{selectedAsset}</span>
                                    <ChevronDown className="w-4 h-4 text-white/50" />
                                </button>
                                <AnimatePresence>
                                    {isAssetMenuOpen && (
                                        <motion.ul
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            className="absolute z-10 right-0 w-28 sm:w-32 bg-black/90 border border-white/15 rounded-lg shadow-2xl max-h-60 overflow-y-auto custom-scrollbar"
                                        >
                                            <li className="p-2">
                                                <input
                                                    type="text"
                                                    placeholder="Search asset..."
                                                    value={assetSearchTerm}
                                                    onChange={(e) =>
                                                        setAssetSearchTerm(e.target.value)
                                                    }
                                                    className="w-full px-3 py-2 bg-[#0A0A0A]/80 border border-white/20 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                                                />
                                            </li>
                                            {metaData.universe
                                                .filter((u) =>
                                                    u.name
                                                        .toLowerCase()
                                                        .includes(assetSearchTerm.toLowerCase()),
                                                )
                                                .map((u) => (
                                                    <li
                                                        key={u.name}
                                                        onClick={() => handleAssetChange(u.name)}
                                                        className="text-[10px] sm:text-sm flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/10 transition"
                                                    >
                                                        {u.image && (
                                                            <img
                                                                src={u.image}
                                                                alt={u.name}
                                                                className="w-4 h-4 sm:w-5 sm:h-5 rounded-full"
                                                            />
                                                        )}
                                                        <span>{u.name}</span>
                                                    </li>
                                                ))}
                                        </motion.ul>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                        <div className="h-[280px] md:h-[300px]">
                            <ResponsiveContainer>
                                {candleData.length > 0 ? (
                                    <AreaChart data={candleData}>
                                        <defs>
                                            <linearGradient
                                                id="colorPrice"
                                                x1="0"
                                                y1="0"
                                                x2="0"
                                                y2="1"
                                            >
                                                <stop
                                                    offset="5%"
                                                    stopColor="#00E7FF"
                                                    stopOpacity={0.3}
                                                />
                                                <stop
                                                    offset="95%"
                                                    stopColor="#00E7FF"
                                                    stopOpacity={0}
                                                />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid
                                            stroke="#333"
                                            strokeDasharray="4 4"
                                            vertical={false}
                                        />
                                        <XAxis
                                            dataKey="t"
                                            tickFormatter={(t) => new Date(t).toLocaleDateString()}
                                            stroke="#666"
                                            tick={{ fontSize: 10 }}
                                        />
                                        <YAxis
                                            stroke="#666"
                                            tick={{ fontSize: 10 }}
                                            tickFormatter={(v) => `$${formatCompactNumber(v)}`}
                                        />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area
                                            type="monotone"
                                            dataKey="c"
                                            stroke="#00E7FF"
                                            fill="url(#colorPrice)"
                                            strokeWidth={2}
                                        />
                                    </AreaChart>
                                ) : (
                                    <div className="flex items-center justify-center h-full">
                                        <p className="text-gray-500 text-sm">
                                            Loading price data...
                                        </p>
                                    </div>
                                )}
                            </ResponsiveContainer>
                        </div>
                    </div>
                    {/* Recent Whale Trades */}
                    <div className="col-span-2 bg-[#0A0A0A]/90 border border-[#FFFFFF20] rounded-2xl p-6">
                        <div className="flex justify-between items-center mb-4">
                            <div className="relative group">
                                <h3 className="text-lg font-bold text-[#FFF] inline-flex items-center gap-2">
                                    Activity
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-4 w-4 text-gray-500"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                        />
                                    </svg>
                                </h3>
                                <div className="absolute left-0 top-full mt-2 w-72 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                    <div className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] p-3 rounded-lg text-xs text-gray-300 shadow-2xl">
                                        Lighter uses numeric account IDs instead of EVM addresses.
                                    </div>
                                </div>
                            </div>
                            {/* <span className="text-[10px] text-gray-400">
                                {recentWhaleTrades.length > 0
                                    ? `${recentWhaleTrades.length} trade${recentWhaleTrades.length > 1 ? 's' : ''}`
                                    : 'Waiting for data...'}
                            </span> */}
                        </div>
                        <div className="overflow-auto max-h-[450px] custom-scrollbar">
                            <table className="w-full text-xs md:text-sm">
                                <thead className="text-gray-400 border-b border-white/10 sticky top-0 bg-[#0A0A0A]/90 z-10">
                                    <tr>
                                        <th className="text-left py-3 px-2 md:px-4">DEX</th>
                                        <th className="text-left py-3 px-2 md:px-4">Time</th>
                                        <th className="text-left py-3 px-2 md:px-4">Symbol</th>
                                        <th className="text-left py-3 px-2 md:px-4">Side</th>
                                        <th className="hidden md:table-cell text-right py-3 px-3 md:px-6">
                                            Price
                                        </th>
                                        <th className="text-right py-3 px-3 md:px-6">Size (USD)</th>
                                        <th className="text-left py-3 px-3 md:px-6">
                                            Buyer Address
                                        </th>
                                        <th className="text-left py-3 px-3 md:px-6">
                                            Seller Address
                                        </th>
                                        <th className="hidden md:table-cell text-left py-3 px-2 md:px-4">
                                            Status
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {recentWhaleTrades.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan="9"
                                                className="py-12 text-center text-gray-500"
                                            >
                                                No whale trades yet — waiting for real-time data...
                                            </td>
                                        </tr>
                                    ) : (
                                        <AnimatePresence>
                                            {recentWhaleTrades
                                                .slice(
                                                    (activityPage - 1) * tradesPerPage,
                                                    activityPage * tradesPerPage,
                                                )
                                                .map((trade) => (
                                                    <motion.tr
                                                        key={trade.id}
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.3 }}
                                                        className="hover:bg-white/5 transition-colors"
                                                    >
                                                        <td className="py-3 px-2 md:px-4">
                                                            <div className="flex items-center gap-1">
                                                                <img
                                                                    src={
                                                                        trade.dex === 'hyperliquid'
                                                                            ? '/hyperliquid.webp'
                                                                            : '/lighter.webp'
                                                                    }
                                                                    alt={trade.dex}
                                                                    className="w-4 h-4 rounded"
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-2 md:px-4 text-gray-300 text-[10px] md:text-xs">
                                                            {new Date(trade.time).toLocaleString(
                                                                'en-US',
                                                                {
                                                                    hour: '2-digit',
                                                                    minute: '2-digit',
                                                                    second: '2-digit',
                                                                    hour12: false,
                                                                },
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-2 md:px-4 font-medium text-white text-[10px] md:text-xs">
                                                            {trade.symbol}-PERP
                                                        </td>
                                                        <td className="py-3 px-2 md:px-4">
                                                            <span
                                                                className={`font-bold text-[10px] md:text-[11px] px-3 py-1 rounded-md border inline-block min-w-[40px] text-center ${
                                                                    trade.side.toLowerCase() ===
                                                                    'buy'
                                                                        ? 'border-emerald-400 bg-emerald-400/20 text-emerald-400'
                                                                        : 'border-red-400 bg-red-400/20 text-red-400'
                                                                }`}
                                                            >
                                                                {trade.side}
                                                            </span>
                                                        </td>
                                                        <td className="hidden md:table-cell py-3 px-3 md:px-6 text-right font-mono text-gray-200 text-xs md:text-sm">
                                                            $
                                                            {parseFloat(trade.price).toLocaleString(
                                                                'en-US',
                                                                {
                                                                    minimumFractionDigits: 2,
                                                                    maximumFractionDigits: 4,
                                                                },
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-3 md:px-6 text-right font-mono text-emerald-400">
                                                            {formatCompactNumber(trade.sizeUsd)}
                                                        </td>
                                                        <td className="py-3 px-3 md:px-6 font-mono text-[11px] md:text-xs text-white">
                                                            <div className="flex items-center gap-2">
                                                                <span
                                                                    className={
                                                                        trade.dex === 'lighter'
                                                                            ? 'break-all'
                                                                            : ''
                                                                    }
                                                                >
                                                                    {trade.dex === 'lighter'
                                                                        ? String(trade.buyer)
                                                                        : `${String(trade.buyer).slice(0, 8)}...${String(trade.buyer).slice(-6)}`}
                                                                </span>
                                                                <Copy
                                                                    size={12}
                                                                    className="cursor-pointer hover:text-emerald-400 transition flex-shrink-0"
                                                                    onClick={() =>
                                                                        copyToClipboard(
                                                                            String(trade.buyer),
                                                                        )
                                                                    }
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-3 md:px-6 font-mono text-[11px] md:text-xs text-white">
                                                            <div className="flex items-center gap-2">
                                                                <span
                                                                    className={
                                                                        trade.dex === 'lighter'
                                                                            ? 'break-all'
                                                                            : ''
                                                                    }
                                                                >
                                                                    {trade.dex === 'lighter'
                                                                        ? String(trade.seller)
                                                                        : `${String(trade.seller).slice(0, 8)}...${String(trade.seller).slice(-6)}`}
                                                                </span>
                                                                <Copy
                                                                    size={12}
                                                                    className="cursor-pointer hover:text-emerald-400 transition flex-shrink-0"
                                                                    onClick={() =>
                                                                        copyToClipboard(
                                                                            String(trade.seller),
                                                                        )
                                                                    }
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="hidden md:table-cell py-3 px-2 md:px-4 text-gray-400 text-[10px] md:text-xs">
                                                            {trade.status}
                                                        </td>
                                                    </motion.tr>
                                                ))}
                                        </AnimatePresence>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {recentWhaleTrades.length > tradesPerPage && (
                            <div className="flex items-center justify-center gap-4 mt-4">
                                <button
                                    onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                                    disabled={activityPage === 1}
                                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                >
                                    <ChevronLeft size={15} />
                                </button>
                                <span className="text-[10px] sm:text-[11px] text-gray-300">
                                    Page {activityPage} / {totalPages}
                                </span>
                                <button
                                    onClick={() =>
                                        setActivityPage((p) => Math.min(totalPages, p + 1))
                                    }
                                    disabled={activityPage === totalPages}
                                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                >
                                    <ChevronRight size={15} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {/* Personal Dashboard */}
            <div className="border border-[#FFFFFF20] rounded-2xl bg-[#0A0A0A]/90 p-6">
                <h2 className="text-lg font-bold text-[#FFF] mb-4"> Highlight </h2>
                <form
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (inputWalletAddress.trim()) {
                            fetchUserData(inputWalletAddress.trim())
                            setCurrentWallet(inputWalletAddress.trim())
                        }
                    }}
                    className="mb-6"
                >
                    <div className="flex gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputWalletAddress}
                            onChange={(e) => setInputWalletAddress(e.target.value)}
                            placeholder="Enter Wallet Address (0x...) or ID in the case of Lighter"
                            className="flex-1 px-3 py-2 bg-black/60 border border-white/15 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                        />
                        <button
                            type="submit"
                            className="px-6 py-2 bg-white text-black rounded-lg text-sm font-bold hover:bg-gray-200 transition"
                        >
                            <Search className="w-5 h-5 text-black" />
                        </button>
                    </div>
                </form>
                {error && <p className="text-red-500 mb-4">{error}</p>}
                {currentWallet && (
                    <div className="space-y-8">
                        {/* Hàng trên: 3 khối ngang bằng nhau */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Khối 1: Key Analytics + Cumulative PnL - giảm chiều ngang */}
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-bold text-[#FFF] mb-4">
                                        Key Analytics
                                    </h3>
                                    <div className="mb-6 flex items-center gap-4">
                                        <div className="w-16 h-16 bg-gray-700 rounded-lg flex items-center justify-center text-2xl font-bold text-gray-400">
                                            ?
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-400 flex items-center gap-1 pb-1">
                                                Source:
                                                <img
                                                    src={
                                                        selectedDEX === 'hyperliquid'
                                                            ? '/hyperliquid.webp'
                                                            : '/lighter.webp'
                                                    }
                                                    alt={selectedDEX}
                                                    className="w-4 h-4 rounded ml-2"
                                                />
                                                <span className="capitalize">{selectedDEX}</span>
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <p className="font-mono text-sm text-blue-400">
                                                    {shortWallet}
                                                </p>
                                                {currentWallet && (
                                                    <Copy
                                                        size={14}
                                                        className="cursor-pointer text-gray-500 hover:text-emerald-400 transition"
                                                        onClick={() =>
                                                            copyToClipboard(String(currentWallet))
                                                        }
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-[#FFFFFF]/5 p-3 rounded-lg text-center">
                                            <p className="text-xs text-gray-400 mb-1">Total PnL</p>
                                            <p
                                                className={`text-base font-bold ${analytics.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-500'}`}
                                            >
                                                {analytics.totalPnl >= 0 ? '+' : ''}
                                                {formatCompactNumber(analytics.totalPnl)}
                                            </p>
                                        </div>
                                        <div className="bg-[#FFFFFF]/5 p-3 rounded-lg text-center">
                                            <p className="text-xs text-gray-400 mb-1">Win Rate</p>
                                            <p className="text-base font-bold text-blue-400">
                                                {safeFixed(analytics.winRate)}%
                                            </p>
                                        </div>
                                        <div className="bg-[#FFFFFF]/5 p-3 rounded-lg text-center">
                                            <p className="text-xs text-gray-400 mb-1">
                                                Total Trades
                                            </p>
                                            <p className="text-base font-bold text-white">
                                                {formatStandardNumber(analytics.numTrades)}
                                            </p>
                                        </div>
                                        <div className="bg-[#FFFFFF]/5 p-3 rounded-lg text-center">
                                            <p className="text-xs text-gray-400 mb-1">
                                                Total Balance
                                            </p>
                                            <p className="text-base font-bold text-white">
                                                {formatCompactNumber(analytics.totalBalance)}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-bold text-[#FFF] mb-3">
                                        Cumulative PnL
                                    </h3>
                                    <div className="h-[220px]">
                                        <ResponsiveContainer>
                                            <LineChart data={filteredPnlData}>
                                                <CartesianGrid
                                                    stroke="#333"
                                                    strokeDasharray="4 4"
                                                    vertical={false}
                                                />
                                                <XAxis
                                                    dataKey="date"
                                                    stroke="#666"
                                                    tick={{ fontSize: 10 }}
                                                />
                                                <YAxis
                                                    stroke="#666"
                                                    tickFormatter={(v) => formatCompactNumber(v)}
                                                    tick={{ fontSize: 10 }}
                                                />
                                                <Tooltip content={<CustomTooltip isPnl={true} />} />
                                                <Line
                                                    type="monotone"
                                                    dataKey="pnl"
                                                    stroke="#00E7FF"
                                                    strokeWidth={2}
                                                    dot={false}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            {/* Khối 2: Position Distribution by Value */}
                            <div>
                                {positionData.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-bold text-[#FFF] mb-3">
                                            Position Distribution by Value
                                        </h3>
                                        <div className="h-[320px]">
                                            <ResponsiveContainer>
                                                <PieChart>
                                                    <Pie
                                                        data={positionData}
                                                        dataKey="value"
                                                        nameKey="name"
                                                        cx="50%"
                                                        cy="50%"
                                                        innerRadius={60}
                                                        outerRadius={120}
                                                        paddingAngle={2}
                                                        labelLine={false}
                                                        label={renderCustomizedLabel}
                                                    >
                                                        {positionData.map((entry, i) => (
                                                            <Cell
                                                                key={`cell-${i}`}
                                                                fill={hlColors[i % hlColors.length]}
                                                            />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip content={<CustomTooltip />} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className="text-sm font-bold text-[#FFF] mb-3">
                                    Current Positions
                                </h3>
                                {portfolioData.length === 0 ? (
                                    <p className="text-xs text-gray-500 py-8 text-center bg-[#0A0A0A]/50 rounded-lg">
                                        No positions found.
                                    </p>
                                ) : (
                                    <div className="overflow-auto max-h-[320px] custom-scrollbar">
                                        <table className="w-full text-xs">
                                            <thead className="text-gray-400 border-b border-white/10 sticky top-0 bg-[#0A0A0A]/90">
                                                <tr>
                                                    <th className="text-left py-2 px-3">Asset</th>
                                                    <th className="text-right py-2 px-3">
                                                        Position
                                                    </th>
                                                    <th className="text-right py-2 px-3">Entry</th>
                                                    <th className="text-right py-2 px-3">
                                                        Mark Price
                                                    </th>
                                                    <th className="text-right py-2 px-3">
                                                        Value (USD)
                                                    </th>
                                                    <th className="text-right py-2 px-3">
                                                        Unreal. PnL
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {portfolioData.map((pos, i) => {
                                                    const coin = pos.symbol || pos.coin
                                                    const size = parseFloat(
                                                        pos.position || pos.szi || 0,
                                                    )
                                                    const signedSize = size * (pos.sign || 1)
                                                    const isLong = signedSize > 0
                                                    const absSize = Math.abs(signedSize)
                                                    const entryPx = parseFloat(
                                                        pos.avg_entry_price || pos.entryPx || 0,
                                                    )

                                                    const assetCtx = metaData.assetCtxs.find(
                                                        (ctx, idx) =>
                                                            metaData.universe[idx]?.name === coin,
                                                    )
                                                    const currentPx = parseFloat(
                                                        assetCtx?.markPx || assetCtx?.midPx || 0,
                                                    )

                                                    // Position value USD
                                                    const positionValue = absSize * currentPx

                                                    // Unrealized PnL
                                                    const unrealPnl = parseFloat(
                                                        pos.unrealized_pnl ||
                                                            pos.unrealizedPnl ||
                                                            0,
                                                    )

                                                    return (
                                                        <tr
                                                            key={i}
                                                            className="hover:bg-white/5 transition"
                                                        >
                                                            <td className="py-2 px-3">
                                                                <div className="flex items-center gap-2">
                                                                    {assetToImage[coin] && (
                                                                        <img
                                                                            src={assetToImage[coin]}
                                                                            alt={coin}
                                                                            className="w-5 h-5 rounded-full"
                                                                        />
                                                                    )}
                                                                    <span className="font-medium text-white">
                                                                        {coin}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="py-2 px-3 text-right font-mono text-xs">
                                                                <span
                                                                    className={
                                                                        isLong
                                                                            ? 'text-emerald-400'
                                                                            : 'text-red-400'
                                                                    }
                                                                >
                                                                    {formatStandardNumber(absSize)}
                                                                    {isLong
                                                                        ? ' (Long)'
                                                                        : ' (Short)'}
                                                                </span>
                                                            </td>
                                                            <td className="py-2 px-3 text-right font-mono text-xs text-gray-300">
                                                                ${formatStandardNumber(entryPx)}
                                                            </td>
                                                            <td className="py-2 px-3 text-right font-mono text-xs text-gray-300">
                                                                ${formatStandardNumber(currentPx)}
                                                            </td>
                                                            <td className="py-2 px-3 text-right font-mono text-xs text-white">
                                                                {formatCompactNumber(positionValue)}
                                                            </td>
                                                            <td className="py-2 px-3 text-right text-xs">
                                                                <span
                                                                    className={
                                                                        unrealPnl >= 0
                                                                            ? 'text-emerald-400'
                                                                            : 'text-red-400'
                                                                    }
                                                                >
                                                                    {unrealPnl >= 0 ? '+' : ''}
                                                                    {formatCompactNumber(unrealPnl)}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Major Losses / Liquidations */}
                            <div>
                                <h3 className="text-sm font-bold text-[#FFF] mb-3">
                                    Major Losses / Liquidations
                                </h3>
                                <div className="overflow-auto max-h-[450px] custom-scrollbar bg-[#0A0A0A]/50 rounded-lg">
                                    <div className="space-y-2 p-4 text-xs">
                                        {fills.filter(
                                            (f) =>
                                                Math.abs(parseFloat(f.closedPnl || 0)) > 500 &&
                                                parseFloat(f.closedPnl) < 0,
                                        ).length === 0 ? (
                                            <p className="text-gray-500 py-8 text-center">
                                                No major losses detected.
                                            </p>
                                        ) : (
                                            fills
                                                .filter(
                                                    (f) =>
                                                        Math.abs(parseFloat(f.closedPnl || 0)) >
                                                            500 && parseFloat(f.closedPnl) < 0,
                                                )
                                                .sort((a, b) => b.time - a.time)
                                                .map((liq, i) => (
                                                    <div
                                                        key={`liq-${i}`}
                                                        className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <img
                                                                src={
                                                                    selectedDEX === 'hyperliquid'
                                                                        ? '/hyperliquid.webp'
                                                                        : '/lighter.webp'
                                                                }
                                                                alt={selectedDEX}
                                                                className="w-4 h-4 rounded"
                                                            />
                                                            {assetToImage[liq.coin] && (
                                                                <img
                                                                    src={assetToImage[liq.coin]}
                                                                    alt={liq.coin}
                                                                    className="w-5 h-5 rounded-full"
                                                                />
                                                            )}
                                                            <div>
                                                                <span className="font-medium text-white text-sm">
                                                                    {liq.coin}
                                                                </span>
                                                                <span className="text-red-400 ml-2">
                                                                    -
                                                                    {formatCompactNumber(
                                                                        Math.abs(
                                                                            parseFloat(
                                                                                liq.closedPnl,
                                                                            ),
                                                                        ),
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <span className="text-gray-500 text-xs">
                                                            {new Date(
                                                                liq.time,
                                                            ).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                ))
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Large Trades */}
                            <div>
                                <h3 className="text-sm font-bold text-[#FFF] mb-3">Large Trades</h3>
                                {displayedLargeTrades.length === 0 ? (
                                    <p className="text-xs text-gray-500 py-8 text-center bg-[#0A0A0A]/50 rounded-lg">
                                        No large trades found.
                                    </p>
                                ) : (
                                    <div className="overflow-auto max-h-[450px] custom-scrollbar bg-[#0A0A0A]/50 rounded-lg">
                                        <table className="w-full text-xs">
                                            <thead className="text-gray-400 border-b border-white/10 sticky top-0 bg-[#0A0A0A]/90">
                                                <tr>
                                                    <th className="text-left py-2 px-4">DEX</th>
                                                    <th className="text-left py-2 px-4">Asset</th>
                                                    <th className="text-left py-2 px-4">Side</th>
                                                    <th className="text-right py-2 px-6">Size</th>
                                                    <th className="text-right py-2 px-6">Price</th>
                                                    <th className="text-right py-2 px-6">PnL</th>
                                                    <th className="text-left py-2 px-4">Time</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {displayedLargeTrades.map((trade, i) => (
                                                    <tr
                                                        key={`large-trade-${i}`}
                                                        className="hover:bg-white/5"
                                                    >
                                                        <td className="py-2 px-4">
                                                            <div className="flex items-center gap-1">
                                                                <img
                                                                    src={
                                                                        selectedDEX ===
                                                                        'hyperliquid'
                                                                            ? '/hyperliquid.webp'
                                                                            : '/lighter.webp'
                                                                    }
                                                                    alt={selectedDEX}
                                                                    className="w-4 h-4 rounded"
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="py-2 px-4 flex items-center gap-2">
                                                            {assetToImage[trade.coin] && (
                                                                <img
                                                                    src={assetToImage[trade.coin]}
                                                                    alt={trade.coin}
                                                                    className="w-5 h-5 rounded-full"
                                                                />
                                                            )}
                                                            <span className="font-medium">
                                                                {trade.coin}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-4">
                                                            <span
                                                                className={`font-bold ${trade.dir === 'Buy' ? 'text-emerald-400' : 'text-red-500'}`}
                                                            >
                                                                {trade.dir}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-6 text-right font-mono">
                                                            {trade.sz}
                                                        </td>
                                                        <td className="py-2 px-6 text-right font-mono">
                                                            ${trade.px}
                                                        </td>
                                                        <td className="py-2 px-6 text-right">
                                                            <span
                                                                className={
                                                                    parseFloat(
                                                                        trade.closedPnl || 0,
                                                                    ) >= 0
                                                                        ? 'text-emerald-400'
                                                                        : 'text-red-400'
                                                                }
                                                            >
                                                                {trade.closedPnl
                                                                    ? formatCompactNumber(
                                                                          trade.closedPnl,
                                                                      )
                                                                    : '-'}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-4 text-gray-400 text-xs">
                                                            {new Date(
                                                                trade.time,
                                                            ).toLocaleDateString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {largeTotalPages > 1 && (
                                            <div className="flex items-center justify-center gap-6 mt-4 pb-4 text-sm">
                                                <button
                                                    onClick={() =>
                                                        setLargePage((p) => Math.max(1, p - 1))
                                                    }
                                                    disabled={largePage === 1}
                                                    className="p-1 disabled:opacity-50 hover:text-emerald-400"
                                                >
                                                    <ChevronLeft size={20} />
                                                </button>
                                                <span className="text-gray-300">
                                                    {largePage} / {largeTotalPages}
                                                </span>
                                                <button
                                                    onClick={() =>
                                                        setLargePage((p) =>
                                                            Math.min(largeTotalPages, p + 1),
                                                        )
                                                    }
                                                    disabled={largePage === largeTotalPages}
                                                    className="p-1 disabled:opacity-50 hover:text-emerald-400"
                                                >
                                                    <ChevronRight size={20} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    )
}
