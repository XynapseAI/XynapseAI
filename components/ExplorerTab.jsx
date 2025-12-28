// components/ExplorerTab.jsx
'use client'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Search,
    Clock,
    Hash as HashIcon,
    AlertCircle,
    Wallet,
    Coins,
    Activity,
    Check,
    Copy,
    X,
    DollarSign,
    ChevronDown,
    Globe,
    Fuel,
} from 'lucide-react'
import { toast, ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { useSearchParams } from 'next/navigation'
import { ethers } from 'ethers'
import { LoadingOverlay } from '@/utils/helpers'
export default function ExplorerTab({ initialQuery, initialChain, isStandalone = false }) {
    const searchParams = useSearchParams()
    const router = useRouter()
    const [query, setQuery] = useState(initialQuery || '')
    const [selectedChain, setSelectedChain] = useState(initialChain || 'ethereum')
    const [results, setResults] = useState(null)
    const [walletData, setWalletData] = useState(null)
    const [nametags, setNametags] = useState({})
    const [nametagsLoading, setNametagsLoading] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [isMobile, setIsMobile] = useState(false)
    const [logMessages, setLogMessages] = useState([])
    const [isChainMenuOpen, setIsChainMenuOpen] = useState(false)
    const buttonRef = useRef(null)
    const menuRef = useRef(null)
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 })
    const basePath = isStandalone ? '/explorer' : '/dashboard?tab=explorer'
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://xynapseai.net'
    const [chainStats, setChainStats] = useState({ blockNumber: 0, gasPrice: '0', nativePrice: 0 })
    const [latestBlocks, setLatestBlocks] = useState([]) // newest first
    const [latestTxs, setLatestTxs] = useState([]) // newest first
    const [blocksPage, setBlocksPage] = useState(1)
    const [txsPage, setTxsPage] = useState(1)
    const [walletTxsPage, setWalletTxsPage] = useState(1)
    const [dashboardLoading, setDashboardLoading] = useState(false)
    const itemsPerPage = 20
    const apiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'demo'
    const isDemoKey = !apiKey || apiKey === 'demo'
    const [chainNametags, setChainNametags] = useState({})
    const [txCache, setTxCache] = useState({})
    const [walletCache, setWalletCache] = useState({})
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
    }
    const chainLogos = {
        bitcoin: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
        ethereum: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
        bsc: 'https://assets.coingecko.com/asset_platforms/images/1/large/bnb_smart_chain.png?1706606721',
        arbitrum: 'https://assets.coingecko.com/coins/images/16547/large/arb.jpg?1721358242',
        optimism:
            'https://assets.coingecko.com/asset_platforms/images/41/large/optimism.png?1706606778',
        polygon:
            'https://assets.coingecko.com/asset_platforms/images/15/large/polygon_pos.png?1706606645',
        base: 'https://assets.coingecko.com/asset_platforms/images/131/large/base.png?1759905869',
        solana: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
        zksync: 'https://assets.coingecko.com/asset_platforms/images/121/large/zksync.jpeg?1706606814',
        linea: 'https://assets.coingecko.com/asset_platforms/images/135/large/linea.jpeg?1706606705',
        abstract:
            'https://assets.coingecko.com/asset_platforms/images/22196/large/abstract.jpg?1735611808',
        apechain: 'https://assets.coingecko.com/coins/images/24383/large/APECOIN.png?1756551529',
        hyperevm:
            'https://assets.coingecko.com/coins/images/50882/large/hyperliquid.jpg?1729431300',
        monad: 'https://assets.coingecko.com/coins/images/38927/large/monad.jpg?1719547722',
        unichain:
            'https://assets.coingecko.com/asset_platforms/images/22206/large/unichain.png?1739323630',
        world: 'https://assets.coingecko.com/asset_platforms/images/22180/large/Worldcoin-logomark-light.png?1728377966',
        // avalanche: 'https://assets.coingecko.com/asset_platforms/images/12/large/avalanche.png?1706606775',
        // celo: 'https://assets.coingecko.com/asset_platforms/images/21/large/celo.jpeg?1711358666',
        // gnosis: 'https://assets.coingecko.com/coins/images/662/large/logo_square_simple_300px.png?1696501854',
    }
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
    }
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
    }
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
    }
    const evmChainsOrder = [
        'ethereum',
        'arbitrum',
        'bsc',
        'optimism',
        'polygon',
        'base',
        'monad',
        'hyperevm',
    ]
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
    }
    const fetchNativePrice = async () => {
        try {
            const priceRes = await fetch('/api/alchemy', {
                method: 'POST',
                body: JSON.stringify({ action: 'native-price', chain: selectedChain }),
            })
            const priceData = priceRes.ok ? await priceRes.json() : { price: 0 }
            setChainStats((prevStats) => ({
                ...prevStats,
                nativePrice: priceData.price,
            }))
        } catch (error) {
            console.error('Price polling error:', error)
        }
    }
    const collectDashboardAddresses = () => {
        const froms = latestTxs.map((tx) => tx.from?.toLowerCase()).filter(Boolean)
        const tos = latestTxs.map((tx) => tx.to?.toLowerCase()).filter(Boolean)
        const miners = latestBlocks
            .map((b) => b.miner?.toLowerCase())
            .filter(Boolean)
            .slice(0, 20)
        const all = [...froms, ...tos, ...miners].filter((a) => a)
        return [...new Set(all)].slice(0, 100)
    }
    const fetchDashboardData = async () => {
        try {
            const [blocksRes, txsRes, statsRes] = await Promise.all([
                fetch('/api/alchemy', {
                    method: 'POST',
                    body: JSON.stringify({ action: 'latest-blocks', chain: selectedChain }),
                }),
                fetch('/api/alchemy', {
                    method: 'POST',
                    body: JSON.stringify({ action: 'latest-txs', chain: selectedChain }),
                }),
                fetch('/api/alchemy', {
                    method: 'POST',
                    body: JSON.stringify({ action: 'chain-stats', chain: selectedChain }),
                }),
            ])
            const blocks = blocksRes.ok ? await blocksRes.json() : []
            const txsRaw = txsRes.ok ? await txsRes.json() : []
            const statsData = statsRes.ok
                ? await statsRes.json()
                : { blockNumber: 0, gasPrice: '0' }
            let txs = txsRaw
            if (isEVMChain(selectedChain)) {
                txs = txsRaw.map((tx) => ({
                    ...tx,
                    value: tx.value ? Number(ethers.formatEther(tx.value)) : 0,
                }))
            } else {
                txs = txsRaw.map((tx) => ({
                    ...tx,
                    value: tx.value ? parseFloat(tx.value) : 0,
                }))
            }
            if (blocks.length > 0) setLatestBlocks(blocks)
            if (txs.length > 0) setLatestTxs(txs)
            setChainStats((prevStats) => ({
                ...prevStats,
                blockNumber: statsData.blockNumber,
                gasPrice: statsData.gasPrice,
            }))
            setDashboardLoading(false)
            const addresses = collectDashboardAddresses()
            if (addresses.length > 0) {
                setTimeout(() => fetchNametags(addresses, selectedChain), 500) // Delay để UI render trước
            }
        } catch (error) {
            console.error('Polling error:', error)
            setDashboardLoading(false)
        }
    }
    useEffect(() => {
        fetchNativePrice()
        const ONE_HOUR_MS = 3600000
        const priceIntervalId = setInterval(() => {
            fetchNativePrice()
        }, ONE_HOUR_MS)
        // 3. Cleanup
        return () => clearInterval(priceIntervalId)
    }, [selectedChain])
    useEffect(() => {
        // Clear tx data to force dashboard on chain switch
        setResults(null)
        setWalletData(null)
        setQuery('') // Optional: clear input if no query in URL
        setError(null)
        setDashboardLoading(true)
        setLatestBlocks([])
        setLatestTxs([])
        setNametags({})
        setChainStats((prev) => ({
            blockNumber: 0,
            gasPrice: '0',
            nativePrice: prev.nativePrice || 0,
        }))
        fetchDashboardData()
        const dataIntervalId = setInterval(() => {
            fetchDashboardData()
        }, 300000)
        return () => clearInterval(dataIntervalId)
    }, [selectedChain])
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (
                isChainMenuOpen &&
                menuRef.current &&
                !menuRef.current.contains(event.target) &&
                !buttonRef.current.contains(event.target)
            ) {
                setIsChainMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isChainMenuOpen])
    useEffect(() => {
        if (isChainMenuOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect()
            setMenuPosition({
                top: rect.bottom + 8 + window.scrollY,
                left: rect.left + window.scrollX,
                width: rect.width,
            })
        }
    }, [isChainMenuOpen])
    useEffect(() => {
        if (results && results.data) {
            const txHash =
                results.data.hash || results.data.txid || results.data.signature || 'Unknown'
            const chainName = selectedChain.toUpperCase()
            const status = results.data.status || 'Pending'
            const truncatedQuery =
                query.length > 10 ? `${query.slice(0, 8)}...${query.slice(-6)}` : query
            document.title = `Transaction ${truncatedQuery} on ${chainName} | Xynapse Explorer`
            let metaDesc = `Explore transaction ${truncatedQuery} on ${chainName} blockchain. Status: ${status}. View details, token transfers, and more on Xynapse Explorer.`
            if (results.data.value || results.data.nativeValue) {
                const value = results.data.value || results.data.nativeValue || 0
                metaDesc += ` Value: ${value.toFixed(6)} ${chainSymbols[selectedChain] || 'Native'}.`
            }
            const metaTag = document.querySelector('meta[name="description"]')
            if (metaTag) {
                metaTag.setAttribute('content', metaDesc)
            }
            const ogTitle = document.querySelector('meta[property="og:title"]')
            if (ogTitle) ogTitle.setAttribute('content', document.title)
            const ogDesc = document.querySelector('meta[property="og:description"]')
            if (ogDesc) ogDesc.setAttribute('content', metaDesc)
            const ogImagePrimary =
                document.querySelector('meta[property="og:image"]') ||
                createMetaTag('property', 'og:image', 'https://xynapseai.net/explorer.png')
            ogImagePrimary.setAttribute('content', 'https://xynapseai.net/explorer.png')
            let ogImageSecondary = document.querySelector(
                'meta[property="og:image"][content*="coingecko"]',
            )
            if (!ogImageSecondary) {
                ogImageSecondary = createMetaTag(
                    'property',
                    'og:image',
                    chainLogos[selectedChain] || 'https://xynapseai.net/explorer.png',
                )
            }
            ogImageSecondary.setAttribute(
                'content',
                chainLogos[selectedChain] || 'https://xynapseai.net/explorer.png',
            )
            const currentUrl = `${origin}${basePath}?query=${encodeURIComponent(query)}&chain=${selectedChain}`
            const ogUrl = document.querySelector('meta[property="og:url"]')
            if (ogUrl) ogUrl.setAttribute('content', currentUrl)
            let canonical = document.querySelector('link[rel="canonical"]')
            if (canonical) {
                canonical.setAttribute('href', currentUrl)
            } else {
                canonical = document.createElement('link')
                canonical.rel = 'canonical'
                canonical.href = currentUrl
                document.head.appendChild(canonical)
            }
        } else if (walletData) {
            const truncatedAddr = truncateText(query, 6, 6)
            const chainName = selectedChain.toUpperCase()
            document.title = `Address ${truncatedAddr} on ${chainName} | Xynapse Explorer`
            const metaDesc = `Explore wallet ${truncatedAddr} on ${chainName}. View transactions, balances, and nametags on Xynapse Explorer.`
            const metaTag = document.querySelector('meta[name="description"]')
            if (metaTag) {
                metaTag.setAttribute('content', metaDesc)
            }
            const ogTitle = document.querySelector('meta[property="og:title"]')
            if (ogTitle) ogTitle.setAttribute('content', document.title)
            const ogDesc = document.querySelector('meta[property="og:description"]')
            if (ogDesc) ogDesc.setAttribute('content', metaDesc)
            const ogImage =
                document.querySelector('meta[property="og:image"]') ||
                createMetaTag('property', 'og:image', 'https://xynapseai.net/explorer.png')
            ogImage.setAttribute('content', 'https://xynapseai.net/explorer.png')
            const currentUrl = `${origin}${basePath}?query=${encodeURIComponent(query)}&chain=${selectedChain}&type=wallet`
            const ogUrl = document.querySelector('meta[property="og:url"]')
            if (ogUrl) ogUrl.setAttribute('content', currentUrl)
            let canonical = document.querySelector('link[rel="canonical"]')
            if (canonical) {
                canonical.setAttribute('href', currentUrl)
            } else {
                canonical = document.createElement('link')
                canonical.rel = 'canonical'
                canonical.href = currentUrl
                document.head.appendChild(canonical)
            }
        } else {
            document.title = 'Blockchain Explorer - Search Transactions | Xynapse'
            const metaTag = document.querySelector('meta[name="description"]')
            if (metaTag) {
                metaTag.setAttribute(
                    'content',
                    'Xynapse Explorer: Search and analyze transactions on Bitcoin, Ethereum, BSC, and Solana blockchains. Real-time data, nametags, and insights.',
                )
            }
            const ogImage =
                document.querySelector('meta[property="og:image"]') ||
                createMetaTag('property', 'og:image', 'https://xynapseai.net/explorer.png')
            ogImage.setAttribute('content', 'https://xynapseai.net/explorer.png')
            const defaultUrl = `${origin}${basePath}`
            const ogUrl = document.querySelector('meta[property="og:url"]')
            if (ogUrl) ogUrl.setAttribute('content', defaultUrl)
            let canonical = document.querySelector('link[rel="canonical"]')
            if (canonical) {
                canonical.setAttribute('href', defaultUrl)
            } else {
                canonical = document.createElement('link')
                canonical.rel = 'canonical'
                canonical.href = defaultUrl
                document.head.appendChild(canonical)
            }
        }
    }, [results, walletData, selectedChain, query, basePath])
    const createMetaTag = (attr, value, content) => {
        let tag = document.querySelector(`meta[${attr}="${value}"]`)
        if (!tag) {
            tag = document.createElement('meta')
            tag.setAttribute(attr, value)
            document.head.appendChild(tag)
        }
        tag.setAttribute('content', content)
        return tag
    }
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])
    useEffect(() => {
        if (initialQuery) {
            setQuery(initialQuery)
        }
        if (initialChain) {
            setSelectedChain(initialChain)
        }
    }, [initialQuery, initialChain])
    useEffect(() => {
        let interval
        if (loading || nametagsLoading || dashboardLoading) {
            const messages = nametagsLoading
                ? ['Loading nametags...', 'Resolving addresses...', 'Fetching labels...']
                : dashboardLoading
                  ? ['Loading dashboard...', 'Fetching chain stats...', 'Connecting to node...']
                  : [
                        'Searching transaction...',
                        'Fetching from chain...',
                        'Verifying across chains...',
                        'Loading details...',
                    ]
            interval = setInterval(() => {
                setLogMessages((prev) => {
                    const nextIndex = prev.length % messages.length
                    return [
                        ...prev,
                        { text: messages[nextIndex], id: Date.now() + Math.random() },
                    ].slice(-5)
                })
            }, 1500)
        } else if (logMessages.length > 0) {
            setLogMessages([])
        }
        return () => {
            if (interval) clearInterval(interval)
        }
    }, [loading, nametagsLoading, dashboardLoading])
    const truncateText = (text, start = 5, end = 5) => {
        if (!text || text.length <= start + end) return text
        return `${text.slice(0, start)}...${text.slice(-end)}`
    }
    const isEVMAddress = (q) => /^0x[a-fA-F0-9]{40}$/.test(q.trim())
    const isEVMTxHash = (q) => /^0x[a-fA-F0-9]{64}$/.test(q.trim())
    const detectInputType = (q) => {
        const trimmed = q.trim()
        if (isEVMTxHash(trimmed)) return 'tx'
        if (isEVMAddress(trimmed)) return 'wallet'
        if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return 'bitcoin_tx'
        if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(trimmed)) return 'solana_tx'
        throw new Error('Invalid input format')
    }
    const copyToClipboard = (text, type = 'Item') => {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                toast.success(`${type} copied to clipboard!`, {
                    autoClose: 1500,
                    position: 'top-right',
                })
            })
            .catch((err) => {
                toast.error('Failed to copy', { autoClose: 1500, position: 'top-right' })
                console.error('Copy error:', err)
            })
    }
    const isEVMChain = (chain) => !!nativeSymbols[chain]
    const extractAddresses = (txData, chain) => {
        const addresses = new Set()
        let tx = txData
        if (Array.isArray(txData)) tx = txData[0]
        const addAddress = (addr) => {
            if (addr) {
                addresses.add(isEVMChain(chain) ? addr.toLowerCase() : addr)
            }
        }
        if (tx.from) addAddress(tx.from)
        if (tx.to) addAddress(tx.to)
        if (isEVMChain(chain)) {
            if (tx.tokenTransfers) {
                tx.tokenTransfers.forEach((t) => {
                    addAddress(t.from)
                    addAddress(t.to)
                })
            }
            if (tx.internalTxs && Array.isArray(tx.internalTxs)) {
                tx.internalTxs.forEach((itx) => {
                    addAddress(itx.from)
                    addAddress(itx.to)
                })
            }
        } else if (chain === 'bitcoin') {
            if (tx.vin && Array.isArray(tx.vin)) {
                tx.vin.forEach((vin) => {
                    addAddress(vin.prevout?.scriptpubkey_address)
                })
            }
            if (tx.vout && Array.isArray(tx.vout)) {
                tx.vout.forEach((vout) => {
                    addAddress(vout.scriptpubkey_address)
                })
            }
        } else if (chain === 'solana') {
            if (tx.feePayer) addAddress(tx.feePayer)
            if (tx.nativeTransfers) {
                tx.nativeTransfers.forEach((t) => {
                    addAddress(t.fromUserAccount)
                    addAddress(t.toUserAccount)
                })
            }
            if (tx.tokenTransfers) {
                tx.tokenTransfers.forEach((t) => {
                    addAddress(t.fromUserAccount)
                    addAddress(t.toUserAccount)
                })
            }
            if (tx.accountData) {
                tx.accountData.forEach((acc) => {
                    addAddress(acc.account)
                })
            }
        }
        return Array.from(addresses).slice(0, 200)
    }
    const fetchNametags = async (addresses, chain) => {
        if (addresses.length === 0) return
        const cachedTags = chainNametags[chain] || {}
        const newAddresses = addresses.filter((addr) => !cachedTags[addr]) // Chỉ fetch mới
        if (newAddresses.length === 0) return // Skip nếu full cache
        setNametagsLoading(true)
        try {
            const res = await fetch('/api/nametags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chain, addresses: newAddresses }), // Chỉ send mới
            })
            if (!res.ok) throw new Error(`Nametags API error: ${res.status}`)
            const { data } = await res.json()
            const newTags = {}
            Object.entries(data).forEach(([addr, info]) => {
                if (info.Labels.deposit['Name Tag'] !== 'Unknown') {
                    newTags[addr] = info.Labels.deposit
                }
            })
            // Merge vào cache per chain
            setChainNametags((prev) => ({
                ...prev,
                [chain]: { ...cachedTags, ...newTags },
            }))
            setNametags((prev) => ({ ...prev, ...newTags }))
        } catch (err) {
            console.error('Nametags fetch error:', err)
        } finally {
            setNametagsLoading(false)
        }
    }
    const fetchTxData = async (q, ch, fallbackIndex = 0) => {
        const cacheKey = `${ch}:${q}`
        if (txCache[cacheKey]) {
            setResults(txCache[cacheKey])
            setLoading(false)
            return
        }
        setLoading(true)
        setError(null)
        try {
            let data = {}
            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }
            const config = chainConfig[ch]
            if (!config) throw new Error(`Unsupported chain: ${ch}`)
            let endpoint = config.apiBase
            let body
            if (config.apiBase === '/api/etherscan-explorer') {
                body = { action: 'tx-details', txHash: q }
                if (selectedChain) body.chain = selectedChain
            } else if (ch === 'bitcoin') {
                body = { action: 'tx-details', txHash: q }
            } else if (ch === 'solana') {
                body = { action: 'tx-details', txHash: q }
            } else {
                throw new Error('Unsupported chain for tx')
            }
            fetchOptions.body = JSON.stringify(body)
            const res = await fetch(endpoint, fetchOptions)
            if (!res.ok) throw new Error(`API error: ${res.status}`)
            const resJson = await res.json()
            if (ch === 'bitcoin' || isEVMChain(ch) || ch === 'solana') {
                if (!resJson.success) throw new Error(resJson.detail || 'Transaction not found')
                data = resJson.data
            } else {
                data = resJson
            }
            const detectedChain = data.detectedChain || ch
            setResults({ data, chain: detectedChain })
            setTxCache((prev) => ({ ...prev, [cacheKey]: { data, chain: detectedChain } }))
            setSelectedChain(detectedChain)
            const addresses = extractAddresses(data, detectedChain)
            if (addresses.length > 0) {
                await fetchNametags(addresses, detectedChain)
            }
        } catch (err) {
            if (
                isEVMChain(ch) &&
                err.message.includes('not found') &&
                fallbackIndex < evmChainsOrder.length - 1 &&
                !selectedChain
            ) {
                const nextChain = evmChainsOrder[fallbackIndex + 1]
                await fetchTxData(q, nextChain, fallbackIndex + 1)
                return
            }
            let userMsg = err.message
            if (
                ch === 'bitcoin' &&
                (err.message.includes('timeout') || err.message.includes('AbortError'))
            ) {
                userMsg = 'Bitcoin query timeout (network lag), retrying in 2s...'
                setTimeout(() => fetchTxData(q, ch), 2000)
                return
            }
            if (isEVMChain(ch) && fallbackIndex === evmChainsOrder.length - 1) {
                userMsg = 'Transaction not found on supported EVM chains'
            }
            setError(userMsg)
        } finally {
            setLoading(false)
        }
    }
    const fetchWalletData = async (addr, ch) => {
        const cacheKey = `${ch}:${addr}`
        if (walletCache[cacheKey]) {
            setWalletData(walletCache[cacheKey])
            setLoading(false)
            return
        }
        setLoading(true)
        setError(null)
        try {
            // Fetch overview
            const overviewRes = await fetch('/api/etherscan-explorer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'address-overview', chain: ch, address: addr }),
            })
            if (!overviewRes.ok) throw new Error('Overview fetch failed')
            const overviewJson = await overviewRes.json()
            if (!overviewJson.success) throw new Error(overviewJson.detail || 'Overview not found')

            // Fetch transactions (recent 20)
            const txsRes = await fetch('/api/etherscan-explorer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'transactions',
                    chain: ch,
                    address: addr,
                    page: walletTxsPage,
                    offset: itemsPerPage,
                }),
            })
            if (!txsRes.ok) throw new Error('Transactions fetch failed')
            const txsJson = await txsRes.json()
            if (!txsJson.success) throw new Error(txsJson.detail || 'Transactions not found')

            const data = {
                overview: overviewJson.data,
                transactions: txsJson.data,
                chain: ch,
            }
            setWalletData(data)
            setWalletCache((prev) => ({ ...prev, [cacheKey]: data }))
            await fetchNametags([addr.toLowerCase()], ch)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }
    const handleSearch = (searchQuery = query) => {
        const q = searchQuery.trim()
        if (!q) return
        setError(null) // Clear old error
        try {
            const inputType = detectInputType(q)
            let ch = selectedChain
            if (!ch) {
                if (inputType === 'wallet') ch = 'ethereum'
                else if (inputType === 'tx') ch = 'ethereum'
                else if (inputType === 'bitcoin_tx') ch = 'bitcoin'
                else if (inputType === 'solana_tx') ch = 'solana'
            }
            setSelectedChain(ch)
            setNametags({})
            const urlType = inputType === 'wallet' ? '&type=wallet' : ''
            router.push(`${basePath}?query=${encodeURIComponent(q)}&chain=${ch}${urlType}`, {
                scroll: false,
            })
            if (inputType === 'tx' || inputType === 'bitcoin_tx' || inputType === 'solana_tx') {
                fetchTxData(q, ch, 0)
            } else if (inputType === 'wallet') {
                fetchWalletData(q, ch)
            }
        } catch (err) {
            setError(err.message)
        }
    }
    useEffect(() => {
        const q = initialQuery || searchParams.get('query')
        const ch = initialChain || searchParams.get('chain')
        const type = searchParams.get('type')
        if (q) {
            setQuery(q)
            if (type === 'wallet') {
                const cacheKey = `${ch || 'ethereum'}:${q}`
                if (walletCache[cacheKey]) {
                    setWalletData(walletCache[cacheKey])
                    setSelectedChain(walletCache[cacheKey].chain)
                } else if (ch) {
                    setSelectedChain(ch)
                    fetchWalletData(q, ch)
                } else {
                    handleSearch(q)
                }
            } else {
                const cacheKey = `${ch || 'auto'}:${q}`
                if (txCache[cacheKey]) {
                    setResults(txCache[cacheKey]) // Restore from cache
                    setSelectedChain(txCache[cacheKey].chain)
                } else if (ch) {
                    setSelectedChain(ch)
                    fetchTxData(q, ch, 0)
                } else {
                    handleSearch(q)
                }
            }
        } else if (ch) {
            setSelectedChain(ch)
        }
    }, [initialQuery, initialChain, searchParams, txCache, walletCache])
    const renderAddress = (addr, chain) => {
        if (
            !addr ||
            addr === 'Coinbase' ||
            addr === 'Multiple Inputs' ||
            addr === 'Multiple Outputs'
        ) {
            return <span className="font-mono text-[10px] sm:text-[12px]">{addr}</span>
        }
        if (!addr) {
            return <span className="font-mono text-gray-500 text-[10px] sm:text-[12px]">N/A</span>
        }
        const normalized = addr.toLowerCase()
        const tag = nametags[normalized]
        const displayAddr = truncateText(addr, 5, 5)
        const copyContent = addr

        if (addr.includes(', ')) {
            return (
                <span className="font-mono text-[10px] sm:text-[12px]">
                    Multiple ({addr.split(', ').length})
                </span>
            )
        }

        return (
            <div className="flex items-center gap-1 group">
                {tag && tag['Name Tag'] ? (
                    <>
                        {tag.image && (
                            <img
                                src={tag.image}
                                alt={tag['Name Tag']}
                                className="w-3 h-3 rounded-full flex-shrink-0"
                            />
                        )}
                        <span className="font-mono text-[10px] sm:text-[12px] truncate">
                            {tag['Name Tag']}
                        </span>
                    </>
                ) : (
                    <span className="font-mono text-[10px] sm:text-[12px] truncate">
                        {displayAddr}
                    </span>
                )}
                <Copy
                    className="w-3 h-3 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation()
                        copyToClipboard(copyContent, 'Address')
                    }}
                />
            </div>
        )
    }

    const renderDashboardAddress = (addr, chain) => {
        if (
            !addr ||
            addr === 'Coinbase' ||
            addr === 'Multiple Inputs' ||
            addr === 'Multiple Outputs'
        ) {
            return <span className="font-mono text-[10px] sm:text-[12px]">{addr}</span>
        }
        if (!addr) {
            return <span className="font-mono text-gray-500 text-[10px] sm:text-[12px]">N/A</span>
        }

        const normalized = addr.toLowerCase()
        const tag = nametags[normalized]
        const displayAddr = truncateText(addr, 5, 5)

        if (addr.includes(', ')) {
            return (
                <span className="font-mono text-[10px] sm:text-[12px]">
                    Multiple ({addr.split(', ').length})
                </span>
            )
        }

        return (
            <div className="flex items-center gap-1">
                {tag && tag['Name Tag'] ? (
                    <>
                        {tag.image && (
                            <img
                                src={tag.image}
                                alt={tag['Name Tag']}
                                className="w-3 h-3 rounded-full flex-shrink-0"
                            />
                        )}
                        <span className="font-mono text-[10px] sm:text-[12px] truncate">
                            {tag['Name Tag']}
                        </span>
                    </>
                ) : (
                    <span className="font-mono text-[10px] sm:text-[12px] truncate">
                        {displayAddr}
                    </span>
                )}
            </div>
        )
    }

    const formatUSD = (value) => {
        if (value == null || isNaN(value)) return '$0.00'
        if (value === 0) return '$0.00'
        if (value < 0.01) {
            const fixed = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
            return `$${fixed}`
        } else {
            return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        }
    }
    const formatToken = (value, symbol) => {
        if (value == null || isNaN(value)) return `0 ${symbol}`
        if (value === 0) return `0 ${symbol}`
        let precision = 2
        if (value < 0.0001) precision = 8
        else if (value < 0.01) precision = 6
        else if (value < 1) precision = 4
        const fixed = value.toFixed(precision).replace(/0+$/, '').replace(/\.$/, '')
        return `${fixed} ${symbol}`
    }
    const renderValueWithUSD = (tokenValue, usdValue, symbol, logoUrl = null, isToken = false) => {
        tokenValue = Number(tokenValue)
        const nativeLogo = nativeTokenLogos[symbol] || logoUrl || chainLogos['ethereum']
        const formattedUSD = formatUSD(usdValue)
        const logoElement = nativeLogo ? (
            <img
                src={nativeLogo}
                alt={symbol}
                className="w-4 h-4 mr-1 rounded-full"
                onError={(e) => {
                    e.target.src = `https://via.placeholder.com/16?text=${symbol}`
                    e.target.alt = `${symbol} Logo`
                }}
            />
        ) : null
        if (!usdValue || usdValue === 0)
            return (
                <span className="flex items-center text-[10px] sm:text-[12px]">
                    {logoElement}
                    {formatToken(tokenValue, symbol)}
                </span>
            )
        return (
            <span className="flex items-center text-[10px] sm:text-[12px]">
                {logoElement}
                {formatToken(tokenValue, symbol)}
                <span className="ml-1 text-[10px] text-green-400">({formattedUSD})</span>
                {isToken && <span className="ml-1 text-[10px] text-gray-400">(Tokens)</span>}
            </span>
        )
    }
    const renderTokenAmount = (amount, symbol, logo) => (
        <span className="flex items-center text-[10px] sm:text-[12px]">
            <img
                src={logo || `https://via.placeholder.com/16?text=${symbol || 'T'}`}
                alt={`${symbol || 'Token'} Logo`}
                className="w-4 h-4 mr-1 rounded-full"
                onError={(e) => {
                    e.target.src = `https://via.placeholder.com/16?text=${symbol || 'T'}`
                }}
            />
            {formatToken(Number(amount), symbol || '')}
        </span>
    )
    const renderTxDetails = (txData, chain) => {
        let tx = txData
        if (Array.isArray(txData)) tx = txData[0]
        const detectedChain = txData.detectedChain || chain
        if (isEVMChain(detectedChain)) {
            const transaction = txData.transaction
            const receipt = txData.receipt
            const block = txData.block || null
            const internalTxs = Array.isArray(txData.internalTxs) ? txData.internalTxs : []
            const tokenTransfers = Array.isArray(txData.tokenTransfers) ? txData.tokenTransfers : []
            const isConfirmed =
                (receipt && receipt.blockNumber) || (transaction && transaction.blockNumber)
            let status = 'Pending'
            let isSuccess = false
            if (isConfirmed) {
                const receiptStatus = receipt ? parseInt(receipt.status || '0x0', 16) : 0
                status = receiptStatus === 1 ? 'Success' : 'Failed'
                isSuccess = status === 'Success'
            }
            const blockNumber = transaction.blockNumber
                ? parseInt(transaction.blockNumber, 16)
                : null
            const timestamp = block ? parseInt(block.timestamp || '0x0', 16) * 1000 : Date.now()
            const gasUsed = receipt ? parseInt(receipt.gasUsed || '0x0', 16) || 0 : 0
            const effectiveGasPrice = receipt
                ? parseInt(receipt.effectiveGasPrice || transaction.gasPrice || '0x0', 16) || 0
                : parseInt(transaction.gasPrice || '0x0', 16) || 0
            const fee = (gasUsed * effectiveGasPrice) / 1e18
            const nativeValue = Number(parseInt(transaction.value || '0x0', 16)) / 1e18
            const symbol = nativeSymbols[detectedChain] || 'ETH'
            const nativePrice = chainStats.nativePrice || 0
            const nativeValueUSD = nativeValue * nativePrice
            const feeUSD = fee * nativePrice
            txData.nativeValueUSD = nativeValueUSD
            txData.feeUSD = feeUSD
            tx = { ...transaction, receipt, internalTxs, tokenTransfers }
            return (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4 text-[10px] sm:text-[12px]"
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <HashIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                <span className="text-[#D4D4D4] whitespace-nowrap">Hash:</span>
                                <div className="flex items-center gap-1 group flex-1 min-w-0">
                                    <span className="font-mono truncate text-[10px] sm:text-[10px]">
                                        {isMobile && tx.hash.length > 10
                                            ? truncateText(tx.hash)
                                            : tx.hash}
                                    </span>
                                    <Copy
                                        className="w-4 h-4 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            copyToClipboard(tx.hash, 'Transaction Hash')
                                        }}
                                    />
                                </div>
                            </div>
                            <h2 className="text-[10px] font-semibold flex items-center gap-2 ml-4 shrink-0">
                                <img
                                    src={chainLogos[detectedChain]}
                                    alt={detectedChain}
                                    className="w-5 h-5 rounded-full"
                                />
                                <span className="text-[#D4D4D4]">
                                    {detectedChain.toUpperCase()}
                                </span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                            <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Status:</span>
                            <div className="flex items-center">
                                <span
                                    className={
                                        isSuccess
                                            ? 'text-green-500'
                                            : status === 'Pending'
                                              ? 'text-yellow-500'
                                              : 'text-red-400'
                                    }
                                >
                                    {status}
                                </span>
                                <div
                                    className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'}`}
                                >
                                    {isSuccess ? (
                                        <Check className="w-3 h-3 text-black" />
                                    ) : status === 'Pending' ? (
                                        <Clock className="w-3 h-3 text-black" />
                                    ) : (
                                        <X className="w-3 h-3 text-black" />
                                    )}
                                </div>
                            </div>
                        </div>
                        {tokenTransfers.length === 0 && (
                            <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                                <Coins className="w-4 h-4 text-emerald-400 mr-2" />
                                <span className="text-[#D4D4D4] mr-2">Value:</span>
                                <div className="flex flex-col">
                                    <div className="flex items-center flex-wrap gap-1">
                                        {renderValueWithUSD(
                                            nativeValue,
                                            txData.nativeValueUSD,
                                            symbol,
                                            null,
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div
                            className={`bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center ${blockNumber ? 'justify-between' : ''}`}
                        >
                            {blockNumber && (
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-emerald-400 mr-1" />
                                    <span>Block: {blockNumber}</span>
                                </div>
                            )}
                            <span className="flex items-center">
                                <Clock className="w-4 h-4 text-emerald-400 mr-1" />
                                {status === 'Pending' ? 'Submitted: ' : 'Time: '}{' '}
                                {new Date(timestamp).toLocaleString()}
                            </span>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">From:</span>
                            <div className="ml-2 flex-1 min-w-0 relative group">
                                {renderAddress(tx.from, detectedChain)}
                            </div>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">To:</span>
                            <div className="ml-2 flex-1 min-w-0 relative group">
                                {renderAddress(tx.to, detectedChain)}
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
                            <h3 className="text-[12px] font-semibold flex items-center uppercase">
                                <Coins className="w-4 h-4 mr-2 text-emerald-400" />
                                Token Transfers
                            </h3>
                            <div className="w-full border border-[#FFFFFF20] mt-2 rounded-xl overflow-hidden">
                                <div className="bg-[#0A0A0A]/80 grid grid-cols-5 px-3 py-2 text-[10px] font-semibold text-[#FFF]">
                                    <span className="text-left">Token</span>
                                    <span className="text-left">From</span>
                                    <span className="text-left">To</span>
                                    <span className="text-left">Amount</span>
                                    <span className="text-left">USD Value</span>
                                </div>
                                {tokenTransfers.map((t, i) => {
                                    const amount = Number(
                                        t.amount ||
                                            BigInt(t.value || 0) / 10n ** BigInt(t.decimals || 18),
                                    )
                                    return (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="hover:bg-[#FFFFFF]/10 grid grid-cols-5 px-3 py-2 border-t border-[#FFFFFF20] text-[10px]"
                                        >
                                            <div className="flex items-center">
                                                <img
                                                    src={
                                                        t.logo ||
                                                        `https://via.placeholder.com/16?text=${t.symbol || 'T'}`
                                                    }
                                                    alt={`${t.symbol || t.name || 'Token'} Logo`}
                                                    className="w-4 h-4 mr-1 rounded-full"
                                                    onError={(e) => {
                                                        e.target.src = `https://via.placeholder.com/16?text=${t.symbol || 'T'}`
                                                    }}
                                                />
                                                <span>
                                                    {t.symbol ||
                                                        t.name ||
                                                        (t.type === 'ERC721'
                                                            ? `${t.name} (ID: ${t.tokenId})`
                                                            : t.tokenAddress?.slice(0, 2) + '...')}
                                                </span>
                                            </div>
                                            <div>{renderAddress(t.from, detectedChain)}</div>
                                            <div>{renderAddress(t.to, detectedChain)}</div>
                                            <div>
                                                {renderTokenAmount(amount, t.symbol || '', t.logo)}
                                            </div>
                                            <div>
                                                {t.valueUSD !== null && t.valueUSD !== undefined ? (
                                                    <span className="text-[10px] text-green-400">
                                                        {formatUSD(t.valueUSD)}
                                                    </span>
                                                ) : (
                                                    'N/A'
                                                )}
                                            </div>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                    {tx.input && (
                        <div>
                            <h4 className="flex items-center text-[12px] font-semibold">
                                <Activity className="w-4 h-4 mr-1" />
                                Input Data
                            </h4>
                            <pre className="text-[10px] bg-[#0A0A0A]/80 p-2 rounded-xl overflow-auto max-h-40 custom-scrollbar">
                                {tx.input}
                            </pre>
                        </div>
                    )}
                    {receipt?.logs && (
                        <div>
                            <h4 className="flex items-center text-[12px] font-semibold">
                                <Activity className="w-4 h-4 mr-1" />
                                Logs
                            </h4>
                            <pre className="text-[10px] bg-[#0A0A0A]/80 p-2 rounded-xl overflow-auto max-h-40 custom-scrollbar">
                                {JSON.stringify(receipt.logs, null, 2)}
                            </pre>
                        </div>
                    )}
                    {internalTxs.length > 0 && (
                        <div>
                            <h4 className="flex items-center text-[12px] font-semibold">
                                <Activity className="w-4 h-4 mr-1" />
                                Internal Transactions
                            </h4>
                            <pre className="text-[10px] bg-[#0A0A0A]/80 p-2 rounded-xl overflow-auto max-h-40 custom-scrollbar">
                                {internalTxs.map((itx, idx) => (
                                    <div key={idx}>
                                        From: {renderAddress(itx.from, detectedChain)} | To:{' '}
                                        {renderAddress(itx.to, detectedChain)} | Value:{' '}
                                        {renderValueWithUSD(
                                            Number(itx.value || 0) / 1e18,
                                            itx.valueUSD || 0,
                                            symbol,
                                            null,
                                        )}
                                    </div>
                                ))}
                            </pre>
                        </div>
                    )}
                </motion.div>
            )
        } else if (chain === 'bitcoin') {
            const isConfirmed = tx.status?.confirmed || tx.status?.block_height > 0
            const status = isConfirmed ? 'Success' : 'Pending'
            const timestamp = tx.status?.block_time ? tx.status.block_time * 1000 : Date.now()
            const totalValue = tx.vout
                ? tx.vout.reduce((sum, out) => sum + (out.value || 0), 0) / 1e8
                : 0
            const fee = (tx.fee || 0) / 1e8
            const fromAddress =
                tx.vin?.length > 1
                    ? 'Multiple Inputs'
                    : tx.vin?.[0]?.prevout?.scriptpubkey_address || null
            const toAddress =
                tx.vout?.length > 1
                    ? 'Multiple Outputs'
                    : tx.vout?.[0]?.scriptpubkey_address || null
            const blockNumber = tx.status?.block_height || null
            const totalValueUSD = tx.valueUSD || 0
            const feeUSD = tx.feeUSD || 0
            tx.hash = tx.txid
            tx.status = status
            tx.timestamp = timestamp
            tx.value = totalValue
            tx.fee = fee
            tx.from = fromAddress
            tx.to = toAddress
            tx.blockNumber = blockNumber
            const isSuccess = isConfirmed
            return (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4 text-[10px] sm:text-[12px]"
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <HashIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                <span className="text-[#D4D4D4] whitespace-nowrap">Hash:</span>
                                <div className="flex items-center gap-1 group flex-1 min-w-0">
                                    <span className="font-mono truncate text-[10px] sm:text-[10px]">
                                        {isMobile && tx.hash.length > 10
                                            ? truncateText(tx.hash)
                                            : tx.hash}
                                    </span>
                                    <Copy
                                        className="w-4 h-4 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            copyToClipboard(tx.hash, 'Transaction Hash')
                                        }}
                                    />
                                </div>
                            </div>
                            <h2 className="text-[10px] font-semibold flex items-center gap-2 ml-4 shrink-0">
                                <img
                                    src={chainLogos[chain]}
                                    alt={chain}
                                    className="w-5 h-5 rounded-full"
                                />
                                <span className="text-[#D4D4D4]">{chain.toUpperCase()}</span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Status:</span>
                            <div className="flex items-center">
                                <span
                                    className={
                                        isSuccess
                                            ? 'text-green-500'
                                            : status === 'Pending'
                                              ? 'text-yellow-500'
                                              : 'text-red-400'
                                    }
                                >
                                    {status}
                                </span>
                                <div
                                    className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'}`}
                                >
                                    {isSuccess ? (
                                        <Check className="w-3 h-3 text-black" />
                                    ) : status === 'Pending' ? (
                                        <Clock className="w-3 h-3 text-black" />
                                    ) : (
                                        <X className="w-3 h-3 text-black" />
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Coins className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Value:</span>
                            <div className="flex flex-col">
                                {renderValueWithUSD(
                                    totalValue,
                                    totalValueUSD,
                                    'BTC',
                                    nativeTokenLogos['BTC'],
                                )}
                            </div>
                        </div>
                        {blockNumber && (
                            <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center justify-between">
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-emerald-400 mr-1" />
                                    <span>Block: {blockNumber}</span>
                                </div>
                                <span className="flex items-center">
                                    <Clock className="w-4 h-4 mr-1" />{' '}
                                    {new Date(timestamp).toLocaleString()}
                                </span>
                            </div>
                        )}
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">From:</span>
                            <div className="flex items-center ml-2 flex-1 min-w-0 relative group">
                                {renderAddress(fromAddress, chain)}
                            </div>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">To:</span>
                            <div className="flex items-center ml-2 flex-1 min-w-0 relative group">
                                {renderAddress(toAddress, chain)}
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
                            <h4 className="flex items-center">
                                <Wallet className="w-4 h-4 mr-1" />
                                Inputs
                            </h4>
                            <table className="w-full border-collapse border border-[#FFFFFF20]">
                                <thead>
                                    <tr>
                                        <th className="text-left">From</th>
                                        <th className="text-left">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tx.vin.map((input, i) => (
                                        <tr key={i}>
                                            <td className="p-2 border border-[#FFFFFF20] text-left relative group">
                                                <div className="flex-1 min-w-0">
                                                    {renderAddress(
                                                        input.prevout?.scriptpubkey_address ||
                                                            'Coinbase',
                                                        chain,
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                <div className="flex flex-col">
                                                    {renderValueWithUSD(
                                                        (input.prevout?.value || 0) / 1e8,
                                                        input.prevout?.valueUSD || 0,
                                                        'BTC',
                                                        nativeTokenLogos['BTC'],
                                                    )}
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
                            <h4 className="flex items-center">
                                <Wallet className="w-4 h-4 mr-1" />
                                Outputs
                            </h4>
                            <table className="w-full border-collapse border border-[#FFFFFF20]">
                                <thead>
                                    <tr>
                                        <th className="text-left">To</th>
                                        <th className="text-left">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tx.vout.map((output, i) => (
                                        <tr key={i}>
                                            <td className="p-2 border border-[#FFFFFF20] text-left relative group">
                                                <div className="flex-1 min-w-0">
                                                    {renderAddress(
                                                        output.scriptpubkey_address || 'OP_RETURN',
                                                        chain,
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                <div className="flex flex-col">
                                                    {renderValueWithUSD(
                                                        (output.value || 0) / 1e8,
                                                        output.valueUSD || 0,
                                                        'BTC',
                                                        nativeTokenLogos['BTC'],
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </motion.div>
            )
        } else if (chain === 'solana') {
            const status = tx.status || 'Success'
            const isSuccess = tx.isSuccess || status === 'Success'
            const timestamp = tx.timestamp || Date.now()
            const symbol = 'SOL'
            const nativeValue = tx.nativeValue || 0
            const nativeValueUSD = tx.nativeValueUSD || 0
            const fee = tx.fee || 0
            const feeUSD = tx.feeUSD || 0
            const tokenTransfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [] // FIXED: Ensure array
            const nativeTransfers = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [] // FIXED: Ensure array
            const solPrice = tx.solPrice || 0
            return (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4 text-sm"
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <HashIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                <span className="text-[#D4D4D4] whitespace-nowrap">Hash:</span>
                                <div className="flex items-center gap-1 group flex-1 min-w-0">
                                    <span className="font-mono truncate text-[10px] sm:text-[10px]">
                                        {isMobile && tx.hash.length > 10
                                            ? truncateText(tx.hash)
                                            : tx.hash}
                                    </span>
                                    <Copy
                                        className="w-4 h-4 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            copyToClipboard(tx.hash, 'Transaction Hash')
                                        }}
                                    />
                                </div>
                            </div>
                            <h2 className="text-xs font-semibold flex items-center gap-2 ml-4 shrink-0">
                                <img
                                    src={chainLogos[chain]}
                                    alt={chain}
                                    className="w-6 h-6 inline mx-1"
                                />
                                <span className="text-[#D4D4D4]">{chain.toUpperCase()}</span>
                            </h2>
                        </div>
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Status:</span>
                            <div className="flex items-center">
                                <span
                                    className={
                                        isSuccess
                                            ? 'text-green-500'
                                            : status === 'Pending'
                                              ? 'text-yellow-500'
                                              : 'text-red-400'
                                    }
                                >
                                    {status}
                                </span>
                                <div
                                    className={`w-4 h-4 rounded-full flex items-center justify-center ml-1 ${isSuccess ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'}`}
                                >
                                    {isSuccess ? (
                                        <Check className="w-3 h-3 text-black" />
                                    ) : status === 'Pending' ? (
                                        <Clock className="w-3 h-3 text-black" />
                                    ) : (
                                        <X className="w-3 h-3 text-black" />
                                    )}
                                </div>
                            </div>
                        </div>
                        {nativeValue > 0 && (
                            <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                                <Coins className="w-4 h-4 text-emerald-400 mr-2" />
                                <span className="text-[#D4D4D4] mr-2">Value:</span>
                                <div className="flex flex-col">
                                    {renderValueWithUSD(
                                        nativeValue,
                                        nativeValueUSD,
                                        symbol,
                                        nativeTokenLogos['SOL'],
                                    )}
                                </div>
                            </div>
                        )}
                        <div
                            className={`bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center ${tx.blockNumber ? 'justify-between' : ''}`}
                        >
                            {tx.blockNumber && (
                                <div className="flex items-center">
                                    <HashIcon className="w-4 h-4 text-emerald-400 mr-1" />
                                    <span>Slot: {tx.blockNumber}</span>
                                </div>
                            )}
                            <span className="flex items-center">
                                <Clock className="w-4 h-4 text-emerald-400 mr-1" />
                                Time: {new Date(timestamp).toLocaleString()}
                            </span>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">From:</span>
                            <div className="flex items-center ml-2 flex-1 min-w-0 relative group">
                                {renderAddress(tx.from, chain)}
                            </div>
                        </div>
                        <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-lg border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-shadow flex items-center">
                            <Wallet className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">To:</span>
                            <div className="flex items-center ml-2 flex-1 min-w-0 relative group">
                                {renderAddress(tx.to, chain)}
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
                            <h3 className="text-md font-semibold flex items-center uppercase">
                                <Coins className="w-4 h-4 mr-2 text-emerald-400" />
                                Token Transfers
                            </h3>
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
                                                    src={
                                                        t.logo ||
                                                        `https://via.placeholder.com/16?text=${t.symbol || 'T'}`
                                                    }
                                                    alt={`${t.symbol || t.name || 'Token'} Logo`} // FIXED: Better alt
                                                    className="w-6 h-6 mr-1 rounded"
                                                    onError={(e) => {
                                                        e.target.src = `https://via.placeholder.com/16?text=${t.symbol || 'T'}`
                                                    }}
                                                />
                                                {t.symbol || t.name || t.mint?.slice(0, 4) + '...'}
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left relative group">
                                                <div className="flex-1 min-w-0">
                                                    {renderAddress(
                                                        t.fromUserAccount || t.from,
                                                        chain,
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left relative group">
                                                <div className="flex-1 min-w-0">
                                                    {renderAddress(t.toUserAccount || t.to, chain)}
                                                </div>
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                {renderTokenAmount(
                                                    t.amount || 0,
                                                    t.symbol || '',
                                                    t.logo,
                                                )}
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                {t.valueUSD !== null && t.valueUSD !== undefined ? (
                                                    <span className="flex items-center text-xs text-green-400">
                                                        {formatUSD(t.valueUSD)}
                                                    </span>
                                                ) : (
                                                    'N/A'
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <h3 className="text-md font-semibold flex items-center mt-4 uppercase">
                        <Activity className="w-4 h-4 mr-2 text-emerald-400" />
                        Native Transfers
                    </h3>
                    {nativeTransfers.length > 0 && (
                        <div>
                            <table className="w-full border-collapse border border-[#FFFFFF20]">
                                <thead>
                                    <tr>
                                        <th className="p-2 text-left">From</th>
                                        <th className="p-2 text-left">To</th>
                                        <th className="p-2 text-left">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {nativeTransfers.map((transfer, i) => (
                                        <tr key={i} className="hover:bg-[#FFFFFF]/10">
                                            <td className="p-2 border border-[#FFFFFF20] text-left relative group">
                                                <div className="flex-1 min-w-0">
                                                    {renderAddress(transfer.fromUserAccount, chain)}
                                                </div>
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left relative group">
                                                <div className="flex-1 min-w-0">
                                                    {renderAddress(transfer.toUserAccount, chain)}
                                                </div>
                                            </td>
                                            <td className="p-2 border border-[#FFFFFF20] text-left">
                                                {renderValueWithUSD(
                                                    (transfer.amount || 0) / 1e9,
                                                    ((transfer.amount || 0) / 1e9) * solPrice,
                                                    symbol,
                                                    nativeTokenLogos['SOL'],
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {tx.instructions && (
                        <div>
                            <h4 className="flex items-center">
                                <Activity className="w-4 h-4 mr-1" />
                                Instructions
                            </h4>
                            <pre className="text-xs bg-[#0A0A0A]/80 p-2 rounded overflow-auto max-h-40 custom-scrollbar">
                                {JSON.stringify(tx.instructions, null, 2)}
                            </pre>
                        </div>
                    )}
                </motion.div>
            )
        }
        return <div>Unsupported chain</div>
    }
    const renderWalletDetails = (data, chain) => {
        const overview = data.overview
        const transactions = data.transactions || []
        const symbol = nativeSymbols[chain] || 'ETH'
        const nativePrice = chainStats.nativePrice || 0
        const nativeBalance = Number(overview.nativeBalance || '0') / 1e18
        const nativeValueUSD = nativeBalance * nativePrice
        const addrLower = query.toLowerCase()
        const tag = nametags[addrLower]
        const totalWalletTxsPages = Math.ceil(overview.txCount / itemsPerPage)
        const currentWalletTxs = transactions.slice(
            (walletTxsPage - 1) * itemsPerPage,
            walletTxsPage * itemsPerPage,
        )
        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 text-[10px] sm:text-[12px]"
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Wallet className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                            <span className="text-[#D4D4D4] whitespace-nowrap">Address:</span>
                            <div className="flex items-center gap-1 group flex-1 min-w-0">
                                <span className="font-mono truncate">{truncateText(query)}</span>
                                <Copy
                                    className="w-4 h-4 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        copyToClipboard(query, 'Wallet Address')
                                    }}
                                />
                            </div>
                        </div>
                        <h2 className="text-[10px] font-semibold flex items-center gap-2 ml-4 shrink-0">
                            <img
                                src={chainLogos[chain]}
                                alt={chain}
                                className="w-5 h-5 rounded-full"
                            />
                            <span className="text-[#D4D4D4]">{chain.toUpperCase()}</span>
                        </h2>
                    </div>
                    {tag && tag['Name Tag'] && (
                        <div className="md:col-span-2 bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                            <Globe className="w-4 h-4 text-emerald-400 mr-2" />
                            <span className="text-[#D4D4D4] mr-2">Nametag:</span>
                            {tag.image && (
                                <img
                                    src={tag.image}
                                    alt={tag['Name Tag']}
                                    className="w-4 h-4 rounded-full mr-1"
                                />
                            )}
                            <span className="truncate">{tag['Name Tag']}</span>
                        </div>
                    )}
                    <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                        <Coins className="w-4 h-4 text-emerald-400 mr-2" />
                        <span className="text-[#D4D4D4] mr-2">Balance:</span>
                        {renderValueWithUSD(nativeBalance, nativeValueUSD, symbol)}
                    </div>
                    <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-3 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200 flex items-center">
                        <Activity className="w-4 h-4 text-emerald-400 mr-2" />
                        <span className="text-[#D4D4D4] mr-2">Tx Count:</span>
                        <span>{overview.txCount || 0}</span>
                    </div>
                </div>
                <div className="mt-4">
                    <h3 className="text-[12px] font-semibold flex items-center uppercase">
                        <Activity className="w-4 h-4 mr-2 text-emerald-400" />
                        Transactions
                    </h3>
                    <div className="border border-[#FFFFFF20] rounded-xl overflow-hidden max-h-[24rem] overflow-y-auto custom-scrollbar mt-2">
                        <div className="bg-[#0A0A0A]/80 flex px-3 py-2 text-[10px] font-semibold text-[#FFF] sticky top-0">
                            <span className="w-1/4 text-left">Hash</span>
                            <span className="w-1/4 text-left">From</span>
                            <span className="w-1/4 text-left">To</span>
                            <span className="w-1/4 text-left">Value</span>
                        </div>
                        <AnimatePresence>
                            {transactions.length === 0 ? (
                                <div className="p-4 text-center text-gray-400">
                                    No transactions found
                                </div>
                            ) : (
                                currentWalletTxs.map((tx, i) => (
                                    <motion.div
                                        key={tx.hash}
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        onClick={() => {
                                            setQuery(tx.hash)
                                            handleSearch(tx.hash)
                                        }}
                                        className="flex hover:bg-[#FFFFFF]/10 transition-all duration-200 py-2 px-3 border-t border-[#FFFFFF20] text-[10px] relative group cursor-pointer"
                                    >
                                        <div className="w-1/4 flex items-center relative group">
                                            <span className="font-mono truncate flex-1 min-w-0 pr-1">
                                                {truncateText(tx.hash)}
                                            </span>
                                            <Copy
                                                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    copyToClipboard(tx.hash, 'Transaction Hash')
                                                }}
                                            />
                                        </div>
                                        <div className="w-1/4 flex items-center relative group">
                                            <span className="font-mono truncate flex-1 min-w-0 pr-1">
                                                {renderAddress(tx.from, chain)}
                                            </span>
                                            <Copy
                                                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    copyToClipboard(tx.from, 'From Address')
                                                }}
                                            />
                                        </div>
                                        <div className="w-1/4 flex items-center relative group">
                                            <span className="font-mono truncate flex-1 min-w-0 pr-1">
                                                {renderAddress(tx.to, chain)}
                                            </span>
                                            <Copy
                                                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer text-gray-400 hover:text-emerald-400"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    copyToClipboard(tx.to, 'To Address')
                                                }}
                                            />
                                        </div>
                                        <span className="w-1/4">
                                            {formatToken(
                                                Number(tx.value) / 1e18,
                                                chainSymbols[chain] || 'Native',
                                            )}
                                        </span>
                                    </motion.div>
                                ))
                            )}
                        </AnimatePresence>
                    </div>
                    {totalWalletTxsPages > 1 &&
                        renderPagination(walletTxsPage, setWalletTxsPage, totalWalletTxsPages)}
                </div>
            </motion.div>
        )
    }
    const isOverallLoading = loading || nametagsLoading || dashboardLoading
    const currentBlocks = latestBlocks.slice(
        (blocksPage - 1) * itemsPerPage,
        blocksPage * itemsPerPage,
    )
    const totalBlocksPages = Math.ceil(latestBlocks.length / itemsPerPage)
    const currentTxs = latestTxs.slice((txsPage - 1) * itemsPerPage, txsPage * itemsPerPage)
    const totalTxsPages = Math.ceil(latestTxs.length / itemsPerPage)
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
    )
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
    )
    const renderBlockRow = (block, index) => (
        <motion.div
            key={block.number}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex hover:bg-[#FFFFFF]/10 transition-all duration-200 py-2 px-3 border-t border-[#FFFFFF20] text-[10px]"
        >
            <span className="w-1/4 flex items-center gap-2">
                <HashIcon className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                {block.number}
            </span>
            <span className="w-1/4">{new Date(block.timestamp * 1000).toLocaleTimeString()}</span>
            <span className="w-1/4">{block.transactions.length}</span>
            <div className="w-1/4 flex items-center gap-1 group">
                {renderDashboardAddress(block.miner, selectedChain)}
                <Copy
                    className="w-3 h-3 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation()
                        copyToClipboard(block.miner, 'Miner Address')
                    }}
                />
            </div>
        </motion.div>
    )
    const renderTxRow = (tx, index) => (
        <motion.div
            key={tx.hash}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => {
                setQuery(tx.hash)
                handleSearch(tx.hash)
            }}
            className="flex hover:bg-[#FFFFFF]/10 transition-all duration-200 py-2 px-3 border-t border-[#FFFFFF20] text-[10px] cursor-pointer"
        >
            <div className="w-1/4 flex items-center gap-1 group">
                <span className="font-mono truncate">{truncateText(tx.hash)}</span>
                <Copy
                    className="w-3 h-3 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation()
                        copyToClipboard(tx.hash, 'Transaction Hash')
                    }}
                />
            </div>
            <div className="w-1/4 flex items-center gap-1 group">
                {renderDashboardAddress(tx.from, selectedChain)}
                <Copy
                    className="w-3 h-3 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation()
                        copyToClipboard(tx.from, 'From Address')
                    }}
                />
            </div>
            <div className="w-1/4 flex items-center gap-1 group">
                {renderDashboardAddress(tx.to, selectedChain)}
                <Copy
                    className="w-3 h-3 flex-shrink-0 text-gray-400 hover:text-emerald-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation()
                        copyToClipboard(tx.to, 'To Address')
                    }}
                />
            </div>
            <span className="w-1/4">
                {formatToken(tx.value || 0, chainSymbols[selectedChain] || 'Native')}
            </span>
        </motion.div>
    )
    const renderPagination = (page, setPage, totalPages) => (
        <div className="flex justify-center gap-2 mt-2">
            <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-2 py-1 text-[10px] bg-[#FFFFFF]/10 rounded disabled:opacity-50"
            >
                Prev
            </button>
            <span className="px-2 py-1 text-[10px]">
                {page} / {totalPages}
            </span>
            <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-2 py-1 text-[10px] bg-[#FFFFFF]/10 rounded disabled:opacity-50"
            >
                Next
            </button>
        </div>
    )
    const renderDashboard = () => (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
        >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3 bg-[#FFFFFF]/5 backdrop-blur-md p-4 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] hover:shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-all duration-200">
                    <h3 className="flex items-center text-[12px] font-semibold text-[#FFF] mb-3">
                        <img
                            src={chainLogos[selectedChain]}
                            alt={selectedChain}
                            className="w-5 h-5 mr-2 rounded-full"
                        />
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
                            <span className="ml-1 text-[#FFF]">
                                {Number(chainStats.gasPrice) / 1e9} Gwei
                            </span>
                        </div>
                        <div className="flex items-center">
                            <img
                                src={
                                    nativeTokenLogos[nativeSymbols[selectedChain]] ||
                                    chainLogos[selectedChain]
                                }
                                alt={nativeSymbols[selectedChain]}
                                className="w-3 h-3 mr-1 rounded-full"
                            />
                            <span className="text-[#D4D4D4]">
                                {nativeSymbols[selectedChain]} Price:
                            </span>
                            <span className="ml-1 text-[#FFF]">
                                ${chainStats.nativePrice.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-4 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                    <h2 className="text-[12px] font-bold mb-3 flex items-center uppercase">
                        <HashIcon className="w-4 h-4 mr-2 text-emerald-400" />
                        Latest Blocks
                    </h2>
                    <div className="border border-[#FFFFFF20] rounded-xl overflow-hidden max-h-[24rem] overflow-y-auto custom-scrollbar">
                        <div className="bg-[#0A0A0A]/80 flex px-3 py-2 text-[10px] font-semibold text-[#FFF] sticky top-0">
                            <span className="w-1/4 text-left">Block</span>
                            <span className="w-1/4 text-left">Age</span>
                            <span className="w-1/4 text-left">Tx Count</span>
                            <span className="w-1/4 text-left">Miner</span>
                        </div>
                        <AnimatePresence>
                            {dashboardLoading
                                ? Array.from({ length: itemsPerPage }).map((_, i) => (
                                      <SkeletonBlockRow key={`load-${i}`} index={i} />
                                  ))
                                : currentBlocks.map((block, i) => renderBlockRow(block, i))}
                        </AnimatePresence>
                    </div>
                    {totalBlocksPages > 1 &&
                        renderPagination(blocksPage, setBlocksPage, totalBlocksPages)}
                </div>
                <div className="bg-[#FFFFFF]/5 backdrop-blur-md p-4 rounded-xl border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
                    <h2 className="text-[12px] font-bold mb-3 flex items-center uppercase">
                        <Activity className="w-4 h-4 mr-2 text-emerald-400" />
                        Latest Transactions
                    </h2>
                    <div className="border border-[#FFFFFF20] rounded-xl overflow-hidden max-h-[24rem] overflow-y-auto custom-scrollbar">
                        <div className="bg-[#0A0A0A]/80 flex px-3 py-2 text-10px] font-semibold text-[#FFF] sticky top-0">
                            <span className="w-1/4 text-left">Hash</span>
                            <span className="w-1/4 text-left">From</span>
                            <span className="w-1/4 text-left">To</span>
                            <span className="w-1/4 text-left">Value</span>
                        </div>
                        <AnimatePresence>
                            {dashboardLoading
                                ? Array.from({ length: itemsPerPage }).map((_, i) => (
                                      <SkeletonTxRow key={`load-tx-${i}`} index={i} />
                                  ))
                                : currentTxs.map((tx, i) => renderTxRow(tx, i))}
                        </AnimatePresence>
                    </div>
                    {totalTxsPages > 1 && renderPagination(txsPage, setTxsPage, totalTxsPages)}
                </div>
            </div>
        </motion.div>
    )
    return (
        <div className="font-inter w-full max-w-9xl mx-auto p-2 sm:p-3 bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col h-full overflow-y-auto custom-scrollbar relative">
            <ToastContainer position="top-right" autoClose={1500} theme="dark" />
            <LoadingOverlay
                isLoading={isOverallLoading}
                isMobile={isMobile}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] rounded-none"
            />
            <div className="mb-4 relative z-10">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#D4D4D4]" />
                        <input
                            type="text"
                            placeholder="Enter transaction hash or wallet address..."
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
                                    <img
                                        src={chainLogos[selectedChain]}
                                        alt={selectedChain}
                                        className="w-4 h-4 mr-2 rounded-full"
                                    />
                                    {selectedChain.toUpperCase()}
                                </>
                            ) : (
                                'Auto Detect'
                            )}
                        </span>
                        <ChevronDown className="w-4 h-4 ml-2" />
                    </button>
                    {isChainMenuOpen &&
                        createPortal(
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
                                            onClick={() => {
                                                setSelectedChain('')
                                                setResults(null)
                                                setQuery('')
                                                setError(null)
                                                router.push(basePath, { scroll: false })
                                            }}
                                        >
                                            Auto Detect
                                        </li>
                                        {Object.keys(chainConfig).map((ch) => (
                                            <li
                                                key={ch}
                                                className="px-3 py-2 hover:bg-[#FFFFFF]/10 cursor-pointer flex items-center text-[#D4D4D4]"
                                                onClick={() => {
                                                    setSelectedChain(ch)
                                                    setResults(null) // Clear tx details
                                                    setWalletData(null) // Clear wallet
                                                    setQuery('') // Clear input query
                                                    setError(null) // Clear any old error
                                                    setIsChainMenuOpen(false)
                                                    // Update URL to new chain without query (force dashboard)
                                                    router.push(`${basePath}?chain=${ch}`, {
                                                        scroll: false,
                                                    })
                                                }}
                                            >
                                                <img
                                                    src={chainLogos[ch]}
                                                    alt={ch}
                                                    className="w-5 h-5 mr-2 rounded-full"
                                                />
                                                {ch.toUpperCase()}
                                            </li>
                                        ))}
                                    </ul>
                                </motion.div>
                            </AnimatePresence>,
                            document.body,
                        )}
                    <motion.button
                        onClick={() => handleSearch()}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="h-[4.5vh] px-4 py-1 bg-[#FFFFFF]/5 backdrop-blur-md border border-[#FFFFFF20] text-[#FFF] rounded-xl hover:bg-[#FFFFFF]/10 transition-all duration-200 font-medium shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] flex items-center justify-center"
                    >
                        <Search className="w-4 h-4" />
                    </motion.button>
                </div>
            </div>
            {error && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-red-400 flex items-center gap-2 p-4 bg-red-500/10 rounded-xl border border-red-500/20 relative z-10 shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]"
                >
                    <AlertCircle className="w-4 h-4" /> {error}
                </motion.div>
            )}
            <AnimatePresence>
                {results && !error ? (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6 relative z-10 p-4"
                    >
                        {renderTxDetails(results.data, results.chain)}
                    </motion.div>
                ) : walletData && !error ? (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6 relative z-10 p-4"
                    >
                        {renderWalletDetails(walletData, walletData.chain)}
                    </motion.div>
                ) : (
                    renderDashboard()
                )}
            </AnimatePresence>
            <style jsx>{`
                .break-all {
                    word-break: break-all;
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
                    border-radius: 2px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.4);
                }
                .custom-scrollbar {
                    -ms-overflow-style: auto;
                    scrollbar-width: thin;
                    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
                }
                .hide-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .hide-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
                .log-container {
                    -webkit-mask-image: linear-gradient(
                        to bottom,
                        transparent 0%,
                        white 20%,
                        white 80%,
                        transparent 100%
                    );
                    mask-image: linear-gradient(
                        to bottom,
                        transparent 0%,
                        white 20%,
                        white 80%,
                        transparent 100%
                    );
                }
                @keyframes scan {
                    0% {
                        transform: translateX(-100%);
                    }
                    100% {
                        transform: translateX(100%);
                    }
                }
                .animate-scan {
                    animation: scan 2s linear infinite;
                }
                @media (max-width: 640px) {
                    .custom-scrollbar {
                        font-size: 8px;
                    }
                }
            `}</style>
        </div>
    )
}
