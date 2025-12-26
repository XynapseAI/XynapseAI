// components\DexTab.jsx
'use client'
import { useState, useEffect, useRef } from 'react'
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
import { ChevronDown, Copy, ChevronLeft, ChevronRight } from 'lucide-react'
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
    const [metaDataHyper, setMetaDataHyper] = useState({ universe: [], assetCtxs: [] })
    const [metaDataLighter, setMetaDataLighter] = useState({ universe: [], assetCtxs: [] })
    const [orderBooksLighter, setOrderBooksLighter] = useState([])
    const [candleData, setCandleData] = useState([])
    const [l2Book, setL2Book] = useState({ bids: [], asks: [] })
    const [pnlChartData, setPnlChartData] = useState([])
    const [portfolioData, setPortfolioData] = useState([])
    const [fills, setFills] = useState([])
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
    const [isAssetMenuOpen, setIsAssetMenuOpen] = useState(false)
    const [recentWhaleTrades, setRecentWhaleTrades] = useState([])
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
    const tradesPerPage = 10
    const largeTotalPages = Math.ceil(largeTrades.length / tradesPerPage)
    const displayedLargeTrades = largeTrades.slice(
        (largePage - 1) * tradesPerPage,
        largePage * tradesPerPage,
    )
    const [randomWhaleWallet, setRandomWhaleWallet] = useState(null)
    const wsHyperRef = useRef(null)
    const wsLighterRef = useRef(null)
    const reconnectTimeoutHyperRef = useRef(null)
    const reconnectTimeoutLighterRef = useRef(null)
    const reconnectAttemptsHyper = useRef(0)
    const reconnectAttemptsLighter = useRef(0)
    const MAX_RECONNECT_ATTEMPTS = 5
    const RECONNECT_DELAY = 1000 // ms, increase with backoff
    const assetToMarketIdLighter = useRef({})
    const marketIdToSymbolLighter = useRef({})
    const inputRef = useRef(null)
    const metaData = selectedDEX === 'hyperliquid' ? metaDataHyper : metaDataLighter
    const activeAssets = selectedDEX === 'hyperliquid' ? activeAssetsHyper : activeAssetsLighter
    const assetToImage = metaData.universe.reduce((acc, u) => {
        acc[u.name] = u.image || null
        return acc
    }, {})
    const assetToColor = activeAssets.reduce((acc, asset, i) => {
        acc[asset] = hlColors[i % hlColors.length]
        return acc
    }, {})
    const oiData = metaData.universe
        .map((u, i) => ({
            name: u.name,
            value: parseFloat(metaData.assetCtxs[i]?.openInterest || 0),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text)
        setToastMessage('Copied to clipboard!')
    }
    const fetchInitialWhaleTrades = async () => {
        try {
            const resHyper = await fetch('/api/hyperliquid/whale-trades')
            if (resHyper.ok) {
                const data = await resHyper.json()
                setRecentWhaleTrades(data.map((t) => ({ ...t, dex: 'hyperliquid' })).slice(0, 100))
                if (data.length > 0) {
                    const randomTrade = data[Math.floor(Math.random() * data.length)]
                    const randomAddr = Math.random() > 0.5 ? randomTrade.buyer : randomTrade.seller
                    setRandomWhaleWallet(randomAddr)
                }
            }
            const resLighter = await fetch('/api/lighter/whale-trades')
            if (resLighter.ok) {
                const data = await resLighter.json()
                setRecentWhaleTrades((prev) =>
                    [...prev, ...data.map((t) => ({ ...t, dex: 'lighter' }))].slice(0, 100),
                )
            }
        } catch (err) {
            console.error('Failed to fetch initial whale trades', err)
        }
    }
    useEffect(() => {
        if (randomWhaleWallet && portfolioData.length === 0 && currentWallet === '') {
            fetchUserData(randomWhaleWallet)
        }
    }, [randomWhaleWallet, portfolioData.length, currentWallet])
    useEffect(() => {
        fetchGlobalDataHyper()
        fetchGlobalDataLighter()
        fetchInitialWhaleTrades()
    }, [])
    useEffect(() => {
        connectWebSocketHyper()
        connectWebSocketLighter()
        return () => {
            if (wsHyperRef.current) {
                wsHyperRef.current.close()
            }
            if (wsLighterRef.current) {
                wsLighterRef.current.close()
            }
            if (reconnectTimeoutHyperRef.current) {
                clearTimeout(reconnectTimeoutHyperRef.current)
            }
            if (reconnectTimeoutLighterRef.current) {
                clearTimeout(reconnectTimeoutLighterRef.current)
            }
        }
    }, [activeAssetsHyper, activeAssetsLighter])
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
            fetchUserData(currentWallet)
        }
    }, [selectedDEX])
    const connectWebSocketHyper = () => {
        if (wsHyperRef.current && wsHyperRef.current.readyState === WebSocket.OPEN) {
            return
        }
        wsHyperRef.current = new WebSocket('wss://api.hyperliquid.xyz/ws')
        wsHyperRef.current.onopen = () => {
            console.log('Hyperliquid WebSocket connected')
            reconnectAttemptsHyper.current = 0
            activeAssetsHyper.forEach((asset) => {
                const subMsg = {
                    method: 'subscribe',
                    subscription: { type: 'trades', coin: asset },
                }
                wsHyperRef.current.send(JSON.stringify(subMsg))
            })
        }
        wsHyperRef.current.onmessage = (event) => {
            const msg = JSON.parse(event.data)
            if (msg.channel === 'trades') {
                const newTrades = []
                msg.data.forEach((trade, index) => {
                    const value = parseFloat(trade.px) * parseFloat(trade.sz)
                    const WHALE_THRESHOLD = 100000
                    if (value > WHALE_THRESHOLD) {
                        const uniqueId = `hyper-${trade.time}-${trade.coin}-${trade.px}-${trade.sz}-${trade.users[0]}-${trade.users[1]}-${index}`
                        const newTrade = {
                            id: uniqueId,
                            time: trade.time,
                            symbol: trade.coin,
                            side: trade.side === 'buy' ? 'Buy' : 'Sell',
                            price: trade.px,
                            sizeUsd: value,
                            buyer: trade.users[0],
                            seller: trade.users[1],
                            status: 'Filled',
                            dex: 'hyperliquid',
                        }
                        newTrades.push(newTrade)
                    }
                })
                if (newTrades.length > 0) {
                    setRecentWhaleTrades((prev) => {
                        const existingIds = new Set(prev.map((t) => t.id))
                        const uniqueNewTrades = newTrades.filter((t) => !existingIds.has(t.id))
                        const updated = [...uniqueNewTrades, ...prev].sort(
                            (a, b) => b.time - a.time,
                        )
                        const limited = updated.slice(0, 100)
                        fetch('/api/hyperliquid/whale-trades', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(limited.filter((t) => t.dex === 'hyperliquid')),
                        }).catch((err) =>
                            console.error('Failed to save hyperliquid whale trades', err),
                        )
                        return limited
                    })
                }
            }
        }
        wsHyperRef.current.onerror = (error) => {
            console.error('Hyperliquid WebSocket error:', error)
            handleReconnectHyper()
        }
        wsHyperRef.current.onclose = () => {
            console.log('Hyperliquid WebSocket closed')
            handleReconnectHyper()
        }
    }
    const handleReconnectHyper = () => {
        if (reconnectAttemptsHyper.current < MAX_RECONNECT_ATTEMPTS) {
            const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttemptsHyper.current)
            console.log(
                `Hyperliquid reconnecting in ${delay}ms... Attempt ${reconnectAttemptsHyper.current + 1}`,
            )
            reconnectTimeoutHyperRef.current = setTimeout(() => {
                reconnectAttemptsHyper.current++
                connectWebSocketHyper()
            }, delay)
        } else {
            console.error('Max reconnect attempts reached for Hyperliquid.')
        }
    }
    const connectWebSocketLighter = () => {
        if (wsLighterRef.current && wsLighterRef.current.readyState === WebSocket.OPEN) {
            return
        }
        wsLighterRef.current = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream')
        wsLighterRef.current.onopen = () => {
            console.log('Lighter WebSocket connected')
            reconnectAttemptsLighter.current = 0
            activeAssetsLighter.forEach((asset) => {
                const marketId = assetToMarketIdLighter.current[asset]
                if (marketId !== undefined) {
                    const subMsg = {
                        type: 'subscribe',
                        channel: `trade/${marketId}`,
                    }
                    wsLighterRef.current.send(JSON.stringify(subMsg))
                }
            })
        }
        wsLighterRef.current.onmessage = (event) => {
            const msg = JSON.parse(event.data)
            if (msg.type === 'update/trade') {
                const newTrades = []
                msg.trades.forEach((trade, index) => {
                    const value = parseFloat(trade.usd_amount)
                    const WHALE_THRESHOLD = 100000
                    if (value > WHALE_THRESHOLD) {
                        const side = trade.is_maker_ask ? 'Buy' : 'Sell'
                        const uniqueId = trade.trade_id
                        const newTrade = {
                            id: uniqueId,
                            time: trade.timestamp,
                            symbol: marketIdToSymbolLighter.current[trade.market_id],
                            side,
                            price: trade.price,
                            sizeUsd: value,
                            buyer: trade.bid_account_id.toString(),
                            seller: trade.ask_account_id.toString(),
                            status: 'Filled',
                            dex: 'lighter',
                        }
                        newTrades.push(newTrade)
                    }
                })
                if (newTrades.length > 0) {
                    setRecentWhaleTrades((prev) => {
                        const existingIds = new Set(prev.map((t) => t.id))
                        const uniqueNewTrades = newTrades.filter((t) => !existingIds.has(t.id))
                        const updated = [...uniqueNewTrades, ...prev].sort(
                            (a, b) => b.time - a.time,
                        )
                        const limited = updated.slice(0, 100)
                        fetch('/api/lighter/whale-trades', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(limited.filter((t) => t.dex === 'lighter')),
                        }).catch((err) => console.error('Failed to save lighter whale trades', err))
                        return limited
                    })
                }
            }
        }
        wsLighterRef.current.onerror = (error) => {
            console.error('Lighter WebSocket error:', error)
            handleReconnectLighter()
        }
        wsLighterRef.current.onclose = () => {
            console.log('Lighter WebSocket closed')
            handleReconnectLighter()
        }
    }
    const handleReconnectLighter = () => {
        if (reconnectAttemptsLighter.current < MAX_RECONNECT_ATTEMPTS) {
            const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttemptsLighter.current)
            console.log(
                `Lighter reconnecting in ${delay}ms... Attempt ${reconnectAttemptsLighter.current + 1}`,
            )
            reconnectTimeoutLighterRef.current = setTimeout(() => {
                reconnectAttemptsLighter.current++
                connectWebSocketLighter()
            }, delay)
        } else {
            console.error('Max reconnect attempts reached for Lighter.')
        }
    }
    const fetchGlobalDataHyper = async () => {
        setLoading(true)
        try {
            const metaRes = await fetch('/api/hyperliquid')
            const meta = await metaRes.json()
            setMetaDataHyper({ universe: meta.universe, assetCtxs: meta.assetCtxs })
            const sortedAssets = meta.universe
                .map((u, i) => ({
                    name: u.name,
                    volume: parseFloat(meta.assetCtxs[i]?.dayNtlVlm || 0),
                }))
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 10)
                .map((a) => a.name)
            setActiveAssetsHyper(sortedAssets)
        } catch (err) {
            setError('Failed to fetch Hyperliquid global data.')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }
    const fetchGlobalDataLighter = async () => {
        setLoading(true)
        try {
            const baseUrl = 'https://mainnet.zklighter.elliot.ai/api/v1'
            const orderBooksRes = await fetch(`${baseUrl}/orderBooks`)
            const orderBooksData = await orderBooksRes.json()
            setOrderBooksLighter(orderBooksData.order_books)
            const universe = orderBooksData.order_books
                .filter((o) => o.market_type === 'perp' && o.status === 'active')
                .map((o) => ({
                    name: o.symbol,
                    image:
                        o.symbol === 'ETH'
                            ? 'https://cryptologos.cc/logos/ethereum-eth-logo.png?v=032'
                            : o.symbol === 'BTC'
                              ? 'https://cryptologos.cc/logos/bitcoin-btc-logo.png?v=032'
                              : null,
                }))
            const exchangeStatsRes = await fetch(`${baseUrl}/exchangeStats`)
            const stats = await exchangeStatsRes.json()
            const assetCtxs = universe.map((u) => {
                const s = stats.order_book_stats.find((st) => st.symbol === u.name) || {
                    daily_quote_token_volume: 0,
                    open_interest: 0,
                }
                return { dayNtlVlm: s.daily_quote_token_volume, openInterest: s.open_interest || 0 }
            })
            setMetaDataLighter({ universe, assetCtxs })
            assetToMarketIdLighter.current = orderBooksData.order_books.reduce((acc, o) => {
                if (o.market_type === 'perp' && o.status === 'active') {
                    acc[o.symbol] = o.market_id
                }
                return acc
            }, {})
            marketIdToSymbolLighter.current = orderBooksData.order_books.reduce((acc, o) => {
                if (o.market_type === 'perp' && o.status === 'active') {
                    acc[o.market_id] = o.symbol
                }
                return acc
            }, {})
            const sortedAssets = universe
                .map((u, i) => ({
                    name: u.name,
                    volume: parseFloat(assetCtxs[i]?.dayNtlVlm || 0),
                }))
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 10)
                .map((a) => a.name)
            setActiveAssetsLighter(sortedAssets)
        } catch (err) {
            setError('Failed to fetch Lighter global data.')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }
    const fetchCandles = async (asset) => {
        let assetToUse = asset
        if (selectedDEX === 'hyperliquid') {
            if (!metaDataHyper.universe.some((u) => u.name === assetToUse)) {
                assetToUse = 'BTC'
            }
            const now = Date.now()
            const start = now - 30 * 24 * 60 * 60 * 1000
            const res = await fetch('https://api.hyperliquid.xyz/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'candleSnapshot',
                    req: { coin: assetToUse, interval: '1d', startTime: start, endTime: now },
                }),
            })
            setCandleData(await res.json())
        } else {
            const baseUrl = 'https://mainnet.zklighter.elliot.ai/api/v1'
            const marketId = assetToMarketIdLighter.current[assetToUse]
            if (marketId === undefined) {
                assetToUse = activeAssetsLighter[0] || 'BTC'
            }
            const now = Date.now()
            const start = now - 30 * 24 * 60 * 60 * 1000
            const res = await fetch(
                `${baseUrl}/candlesticks?market_id=${marketId}&resolution=1d&start_timestamp=${start}&end_timestamp=${now}`,
            )
            const data = await res.json()
            setCandleData(data.candlesticks || data || [])
        }
    }
    const fetchL2Book = async (asset) => {
        let assetToUse = asset
        if (selectedDEX === 'hyperliquid') {
            if (!metaDataHyper.universe.some((u) => u.name === assetToUse)) {
                assetToUse = 'BTC'
            }
            const res = await fetch('https://api.hyperliquid.xyz/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'l2Book', coin: assetToUse }),
            })
            const book = await res.json()
            setL2Book({ bids: book.levels[0], asks: book.levels[1] })
        } else {
            const marketId = assetToMarketIdLighter.current[assetToUse]
            if (marketId === undefined) {
                assetToUse = activeAssetsLighter[0] || 'BTC'
            }
            const book = orderBooksLighter.find((o) => o.market_id === marketId)
            setL2Book({ bids: book?.bids || [], asks: book?.asks || [] })
        }
    }

    const fetchUserData = async (address) => {
        if (!address || !address.trim()) return
        const trimmedAddress = address.trim()
        setLoading(true)
        setError(null)
        let dex = ''
        let accountL1Address = ''
        try {
            if (/^\d+$/.test(trimmedAddress)) {
                // Numeric ID - Lighter index
                dex = 'lighter'
                setSelectedDEX('lighter')
                const baseUrl = 'https://mainnet.zklighter.elliot.ai/api/v1'
                const queryParam = `by=index&value=${trimmedAddress}`
                const res = await fetch(`${baseUrl}/account?${queryParam}`)
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}))
                    throw new Error(errData.message || 'Account not found or invalid ID/address')
                }
                const state = await res.json()
                accountL1Address = state.accounts[0]?.l1_address || ''
                setPortfolioData(
                    (state.accounts[0]?.positions || []).filter(
                        (p) => parseFloat(p.position) !== 0,
                    ),
                )
                let totalPnl = (state.accounts[0]?.positions || []).reduce(
                    (sum, p) =>
                        sum +
                        (parseFloat(p.unrealized_pnl) || 0) +
                        (parseFloat(p.realized_pnl) || 0),
                    0,
                )
                let totalBalance = parseFloat(state.accounts[0]?.available_balance || 0)
                // Fetch trades for fills
                const baseId = state.accounts[0]?.account_index || trimmedAddress
                const tradesRes = await fetch(
                    `${baseUrl}/trades?account_index=${baseId}&limit=500&sort_by=timestamp&sort_dir=desc`,
                )
                let fillsData = []
                if (tradesRes.ok) {
                    const tradesData = await tradesRes.json()
                    fillsData = tradesData.trades.map((t) => ({
                        time: t.timestamp,
                        coin: marketIdToSymbolLighter.current[t.market_id] || 'UNKNOWN',
                        closedPnl: t.pnl || 0,
                        sz: t.usd_amount / parseFloat(t.price) || t.amount || 0,
                        px: t.price,
                        dir: t.is_maker_ask ? 'Sell' : 'Buy',
                        hash: t.trade_id,
                    }))
                    setFills(fillsData)
                } else {
                    setFills([])
                }
                let wins = 0
                fillsData.forEach((fill) => {
                    const pnl = parseFloat(fill.closedPnl) || 0
                    if (pnl > 0) wins++
                })
                const numTrades = fillsData.length
                const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0
                setAnalytics({ totalPnl, winRate, numTrades, totalBalance })
                // Fetch PnL chart
                const pnlRes = await fetch(
                    `${baseUrl}/pnl?by=index&value=${baseId}&resolution=1d&count_back=30`,
                )
                let pnlData = []
                if (pnlRes.ok) {
                    const pnlDataApi = await pnlRes.json()
                    let cumulativePnl = 0
                    if (pnlDataApi.pnl && Array.isArray(pnlDataApi.pnl)) {
                        pnlDataApi.pnl.sort((a, b) => a.timestamp - b.timestamp)
                        pnlData = pnlDataApi.pnl.map((entry) => {
                            cumulativePnl += parseFloat(entry.pnl || entry.value || 0)
                            return {
                                date: new Date(entry.timestamp).toLocaleDateString(),
                                pnl: cumulativePnl,
                                asset: entry.symbol || 'All',
                            }
                        })
                    }
                }
                setPnlChartData(pnlData)
            } else if (trimmedAddress.startsWith('0x') && trimmedAddress.length === 42) {
                // Try Hyperliquid first
                try {
                    dex = 'hyperliquid'
                    setSelectedDEX('hyperliquid')
                    const stateRes = await fetch('https://api.hyperliquid.xyz/info', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'clearinghouseState', user: trimmedAddress }),
                    })
                    if (!stateRes.ok) {
                        const errData = await stateRes.json().catch(() => ({}))
                        throw new Error(errData.msg || 'Invalid wallet address')
                    }
                    const state = await stateRes.json()
                    setPortfolioData(
                        state.assetPositions
                            .map((pos) => pos.position)
                            .filter((p) => parseFloat(p.szi) !== 0),
                    )
                    const fillsRes = await fetch('https://api.hyperliquid.xyz/info', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'userFills', user: trimmedAddress }),
                    })
                    const fillsData = await fillsRes.json()
                    setFills(fillsData)
                    let totalPnl = 0
                    let wins = 0
                    fillsData.forEach((fill) => {
                        const pnl = parseFloat(fill.closedPnl) || 0
                        totalPnl += pnl
                        if (pnl > 0) wins++
                    })
                    const numTrades = fillsData.length
                    const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0
                    let totalBalance = parseFloat(state.marginSummary.accountValue || 0)
                    setAnalytics({ totalPnl, winRate, numTrades, totalBalance })
                    const pnlData = []
                    let cumulativePnl = 0
                    fillsData.sort((a, b) => a.time - b.time)
                    fillsData.forEach((fill) => {
                        cumulativePnl += parseFloat(fill.closedPnl) || 0
                        pnlData.push({
                            date: new Date(fill.time).toLocaleDateString(),
                            pnl: cumulativePnl,
                            asset: fill.coin,
                        })
                    })
                    setPnlChartData(pnlData)
                } catch (hyperErr) {
                    // Fall back to Lighter l1_address
                    dex = 'lighter'
                    setSelectedDEX('lighter')
                    const baseUrl = 'https://mainnet.zklighter.elliot.ai/api/v1'
                    const queryParam = `by=l1_address&l1_address=${trimmedAddress}`
                    const res = await fetch(`${baseUrl}/account?${queryParam}`)
                    if (!res.ok) {
                        const errData = await res.json().catch(() => ({}))
                        throw new Error(
                            errData.message || 'Account not found or invalid ID/address',
                        )
                    }
                    const state = await res.json()
                    accountL1Address = trimmedAddress
                    setPortfolioData(
                        (state.accounts[0]?.positions || []).filter(
                            (p) => parseFloat(p.position) !== 0,
                        ),
                    )
                    let totalPnl = (state.accounts[0]?.positions || []).reduce(
                        (sum, p) =>
                            sum +
                            (parseFloat(p.unrealized_pnl) || 0) +
                            (parseFloat(p.realized_pnl) || 0),
                        0,
                    )
                    let totalBalance = parseFloat(state.accounts[0]?.available_balance || 0)
                    // Fetch trades for fills
                    const baseId = state.accounts[0]?.account_index
                    const tradesRes = await fetch(
                        `${baseUrl}/trades?account_index=${baseId}&limit=500&sort_by=timestamp&sort_dir=desc`,
                    )
                    let fillsData = []
                    if (tradesRes.ok) {
                        const tradesData = await tradesRes.json()
                        fillsData = tradesData.trades.map((t) => ({
                            time: t.timestamp,
                            coin: marketIdToSymbolLighter.current[t.market_id] || 'UNKNOWN',
                            closedPnl: t.pnl || 0,
                            sz: t.usd_amount / parseFloat(t.price) || t.amount || 0,
                            px: t.price,
                            dir: t.is_maker_ask ? 'Sell' : 'Buy',
                            hash: t.trade_id,
                        }))
                        setFills(fillsData)
                    } else {
                        setFills([])
                    }
                    let wins = 0
                    fillsData.forEach((fill) => {
                        const pnl = parseFloat(fill.closedPnl) || 0
                        if (pnl > 0) wins++
                    })
                    const numTrades = fillsData.length
                    const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0
                    setAnalytics({ totalPnl, winRate, numTrades, totalBalance })
                    // Fetch PnL chart
                    const pnlRes = await fetch(
                        `${baseUrl}/pnl?by=index&value=${baseId}&resolution=1d&count_back=30`,
                    )
                    let pnlData = []
                    if (pnlRes.ok) {
                        const pnlDataApi = await pnlRes.json()
                        let cumulativePnl = 0
                        if (pnlDataApi.pnl && Array.isArray(pnlDataApi.pnl)) {
                            pnlDataApi.pnl.sort((a, b) => a.timestamp - b.timestamp)
                            pnlData = pnlDataApi.pnl.map((entry) => {
                                cumulativePnl += parseFloat(entry.pnl || entry.value || 0)
                                return {
                                    date: new Date(entry.timestamp).toLocaleDateString(),
                                    pnl: cumulativePnl,
                                    asset: entry.symbol || 'All',
                                }
                            })
                        }
                    }
                    setPnlChartData(pnlData)
                }
            } else {
                throw new Error(
                    'Invalid format. Use Ethereum address (0x...) or numeric Account ID.',
                )
            }
            setCurrentWallet(accountL1Address || trimmedAddress)
        } catch (err) {
            setError(err.message || 'Failed to fetch user data. Check the address/ID again.')
            console.error(err)
            setPortfolioData([])
            setFills([])
            setAnalytics({ totalPnl: 0, winRate: 0, numTrades: 0, totalBalance: 0 })
            setPnlChartData([])
            setCurrentWallet('')
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
                                className="absolute z-10 mt-2 w-48 bg-black/90 border border-white/15 rounded-lg shadow-2xl"
                            >
                                <li
                                    onClick={() => handleDEXChange('hyperliquid')}
                                    className="flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-white/10 transition"
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
                                    className="flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-white/10 transition"
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
                    {oiData.length > 0 && (
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
                    )}
                    {/* Top Assets by Volume */}
                    <div>
                        <h3 className="text-xs sm:text-sm font-bold text-[#FFF] mb-2">
                            Top Assets by 24h Volume
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
                                        <span className="text-emerald-400 font-mono">
                                            {formatCompactNumber(asset.volume)}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    </div>
                    {/* Price Chart + Selector */}
                    <div className="col-span-2">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-bold text-[#FFF]">
                                {selectedAsset} Price Action (30D)
                            </h3>
                            <div className="relative">
                                <button
                                    onClick={() => setIsAssetMenuOpen(!isAssetMenuOpen)}
                                    className="flex items-center gap-2 px-4 py-2 bg-black/60 border border-white/15 rounded-lg text-white hover:border-white/30 transition"
                                >
                                    {assetToImage[selectedAsset] && (
                                        <img
                                            src={assetToImage[selectedAsset]}
                                            alt={selectedAsset}
                                            className="w-5 h-5 rounded-full"
                                        />
                                    )}
                                    <span className="font-medium">{selectedAsset}</span>
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                                <AnimatePresence>
                                    {isAssetMenuOpen && (
                                        <motion.ul
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            className="absolute z-10 mt-2 w-48 bg-black/90 border border-white/15 rounded-lg shadow-2xl max-h-60 overflow-y-auto custom-scrollbar"
                                        >
                                            {metaData.universe.map((u) => (
                                                <li
                                                    key={u.name}
                                                    onClick={() => handleAssetChange(u.name)}
                                                    className="flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-white/10 transition"
                                                >
                                                    {u.image && (
                                                        <img
                                                            src={u.image}
                                                            alt={u.name}
                                                            className="w-5 h-5 rounded-full"
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
                                <AreaChart data={candleData}>
                                    <defs>
                                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
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
                                        tickFormatter={(v) => `$${v}`}
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
                            <span className="text-[10px] text-gray-400">
                                {recentWhaleTrades.length > 0
                                    ? `${recentWhaleTrades.length} trade${recentWhaleTrades.length > 1 ? 's' : ''}`
                                    : 'Waiting for data...'}
                            </span>
                        </div>
                        <div className="overflow-auto max-h-[450px] custom-scrollbar">
                            <table className="w-full text-xs min-w-[1000px]">
                                <thead className="text-gray-400 border-b border-white/10 sticky top-0 bg-[#0A0A0A]/90 z-10">
                                    <tr>
                                        <th className="text-left py-3 px-4">DEX</th>
                                        <th className="text-left py-3 px-4">Time</th>
                                        <th className="text-left py-3 px-4">Symbol</th>
                                        <th className="text-left py-3 px-4">Side</th>
                                        <th className="text-right py-3 px-6">Price</th>
                                        <th className="text-right py-3 px-6">Size (USD)</th>
                                        <th className="text-left py-3 px-6">Buyer Address</th>
                                        <th className="text-left py-3 px-6">Seller Address</th>
                                        <th className="text-left py-3 px-4">Status</th>
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
                                            {recentWhaleTrades.map((trade) => (
                                                <motion.tr
                                                    key={trade.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    transition={{ duration: 0.3 }}
                                                    className="hover:bg-white/5 transition-colors"
                                                >
                                                    <td className="py-3 px-4">
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
                                                    <td className="py-3 px-4 text-gray-300">
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
                                                    <td className="py-3 px-4 font-medium text-white">
                                                        {trade.symbol}-PERP
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span
                                                            className={`font-bold text-xs px-3 py-1 rounded-md border inline-block min-w-[40px] text-center ${
                                                                trade.side &&
                                                                (trade.side.toLowerCase() ===
                                                                    'buy' ||
                                                                    trade.side === 'Buy')
                                                                    ? 'border-emerald-400 bg-emerald-400/20 text-emerald-400'
                                                                    : 'border-red-400 bg-red-400/20 text-red-400'
                                                            }`}
                                                        >
                                                            {trade.side &&
                                                            (trade.side.toLowerCase() === 'buy' ||
                                                                trade.side === 'Buy')
                                                                ? 'Buy'
                                                                : 'Sell'}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-6 text-right font-mono text-gray-200">
                                                        $
                                                        {parseFloat(trade.price).toLocaleString(
                                                            'en-US',
                                                            {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 4,
                                                            },
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-6 text-right font-mono text-emerald-400">
                                                        {formatCompactNumber(trade.sizeUsd)}
                                                    </td>
                                                    <td className="py-3 px-6 font-mono text-[10px] text-white">
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
                                                    <td className="py-3 px-6 font-mono text-[10px] text-white">
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
                                                    <td className="py-3 px-4 text-gray-400">
                                                        {trade.status}
                                                    </td>
                                                </motion.tr>
                                            ))}
                                        </AnimatePresence>
                                    )}
                                </tbody>
                            </table>
                        </div>
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
                            Scan
                        </button>
                    </div>
                </form>
                {currentWallet && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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
                                <div className="grid grid-cols-4 gap-4">
                                    <div className="bg-[#FFFFFF]/5 p-4 rounded-lg text-center">
                                        <p className="text-xs text-gray-400 mb-1">Total PnL</p>
                                        <p
                                            className={`text-xl font-bold ${analytics.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-500'}`}
                                        >
                                            {analytics.totalPnl >= 0 ? '+' : ''}
                                            {formatCompactNumber(analytics.totalPnl)}
                                        </p>
                                    </div>
                                    <div className="bg-[#FFFFFF]/5 p-4 rounded-lg text-center">
                                        <p className="text-xs text-gray-400 mb-1">Win Rate</p>
                                        <p className="text-xl font-bold text-blue-400">
                                            {safeFixed(analytics.winRate)}%
                                        </p>
                                    </div>
                                    <div className="bg-[#FFFFFF]/5 p-4 rounded-lg text-center">
                                        <p className="text-xs text-gray-400 mb-1">Total Trades</p>
                                        <p className="text-xl font-bold text-white">
                                            {analytics.numTrades}
                                        </p>
                                    </div>
                                    <div className="bg-[#FFFFFF]/5 p-4 rounded-lg text-center">
                                        <p className="text-xs text-gray-400 mb-1">Total Balance</p>
                                        <p className="text-xl font-bold text-white">
                                            {formatCompactNumber(analytics.totalBalance)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-[#FFF] mb-3">
                                    Cumulative PnL
                                </h3>
                                <div className="h-[300px]">
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
                                            />
                                            <Tooltip content={<CustomTooltip isPnl={true} />} />
                                            <Line
                                                type="monotone"
                                                dataKey="pnl"
                                                stroke="#00E7FF"
                                                strokeWidth={3}
                                                dot={false}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-bold text-[#FFF] mb-3">
                                    Current Positions
                                </h3>
                                {portfolioData.length === 0 ? (
                                    <p className="text-xs text-gray-500">No positions found.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead className="text-gray-400 border-b border-white/10">
                                                <tr>
                                                    <th className="text-left py-2 px-4">Asset</th>
                                                    <th className="text-right py-2 px-4">
                                                        Position
                                                    </th>
                                                    <th className="text-right py-2 px-4">
                                                        Entry Price
                                                    </th>
                                                    <th className="text-right py-2 px-4">
                                                        Unrealized PnL
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {portfolioData.map((pos, i) => (
                                                    <tr key={i} className="hover:bg-white/5">
                                                        <td className="py-2 px-4 font-medium">
                                                            {pos.symbol || pos.coin}
                                                        </td>
                                                        <td className="py-2 px-4 text-right font-mono">
                                                            {parseFloat(pos.position || pos.szi) *
                                                                (pos.sign || 1)}
                                                        </td>
                                                        <td className="py-2 px-4 text-right font-mono">
                                                            $
                                                            {pos.avg_entry_price ||
                                                                pos.entryPx ||
                                                                0}
                                                        </td>
                                                        <td className="py-2 px-4 text-right">
                                                            <span
                                                                className={
                                                                    parseFloat(
                                                                        pos.unrealized_pnl ||
                                                                            pos.unrealizedPnl ||
                                                                            0,
                                                                    ) >= 0
                                                                        ? 'text-emerald-400'
                                                                        : 'text-red-400'
                                                                }
                                                            >
                                                                {formatCompactNumber(
                                                                    pos.unrealized_pnl ||
                                                                        pos.unrealizedPnl ||
                                                                        0,
                                                                )}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-[#FFF] mb-3">
                                    Major Losses / Liquidations
                                </h3>
                                <div className="space-y-2 max-h-[200px] overflow-y-auto text-xs custom-scrollbar">
                                    {fills.filter(
                                        (f) =>
                                            Math.abs(parseFloat(f.closedPnl || 0)) > 500 &&
                                            parseFloat(f.closedPnl) < 0,
                                    ).length === 0 ? (
                                        <p className="text-gray-500">No major losses detected.</p>
                                    ) : (
                                        fills
                                            .filter(
                                                (f) =>
                                                    Math.abs(parseFloat(f.closedPnl || 0)) > 500 &&
                                                    parseFloat(f.closedPnl) < 0,
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
                                                                        parseFloat(liq.closedPnl),
                                                                    ),
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="text-gray-500 text-xs">
                                                        {new Date(liq.time).toLocaleDateString()}
                                                    </span>
                                                </div>
                                            ))
                                    )}
                                </div>
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-[#FFF] mb-3">
                                    Large Trades (This Wallet)
                                </h3>
                                {displayedLargeTrades.length === 0 ? (
                                    <p className="text-xs text-gray-500">No large trades found.</p>
                                ) : (
                                    <>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead className="text-gray-400 border-b border-white/10">
                                                    <tr>
                                                        <th className="text-left py-2 px-4">DEX</th>
                                                        <th className="text-left py-2 px-4">
                                                            Asset
                                                        </th>
                                                        <th className="text-left py-2 px-4">
                                                            Side
                                                        </th>
                                                        <th className="text-right py-2 px-6">
                                                            Size
                                                        </th>
                                                        <th className="text-right py-2 px-6">
                                                            Price
                                                        </th>
                                                        <th className="text-right py-2 px-6">
                                                            PnL
                                                        </th>
                                                        <th className="text-left py-2 px-4">
                                                            Time
                                                        </th>
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
                                                                        src={
                                                                            assetToImage[trade.coin]
                                                                        }
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
                                                                    className={`font-bold ${
                                                                        trade.closedPnl != null &&
                                                                        parseFloat(
                                                                            trade.closedPnl,
                                                                        ) !== 0
                                                                            ? 'text-red-500'
                                                                            : 'text-emerald-400'
                                                                    }`}
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
                                        </div>
                                        {largeTotalPages > 1 && (
                                            <div className="flex items-center justify-center gap-6 mt-4 text-sm">
                                                <button
                                                    onClick={() =>
                                                        setLargePage((p) => Math.max(1, p - 1))
                                                    }
                                                    disabled={largePage === 1}
                                                    className="p-1 disabled:opacity-50 hover:text-emerald-400 transition"
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
                                                    className="p-1 disabled:opacity-50 hover:text-emerald-400 transition"
                                                >
                                                    <ChevronRight size={20} />
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    )
}
