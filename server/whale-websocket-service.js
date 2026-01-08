import 'dotenv/config'
import WebSocket from 'ws'
import { createClient } from 'redis'

const redis = createClient({
    url: process.env.REDIS_URL_2 || 'redis://localhost:6379',
})

redis.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
        console.log('Redis connection refused – waiting for Redis to start...')
    } else {
        console.error('Redis Error:', err)
    }
})

async function connectRedis() {
    let connected = false
    for (let i = 0; i < 20; i++) {
        try {
            await redis.connect()
            console.log('Redis connected successfully!')
            connected = true
            break
        } catch (err) {
            console.log(`Redis connection attempt ${i + 1}/20 failed. Retrying in 3s...`)
            await new Promise((res) => setTimeout(res, 3000))
        }
    }
    if (!connected) {
        console.error('Cannot connect to Redis after 20 attempts. Exiting.')
        process.exit(1)
    }
}

await connectRedis()

const REDIS_KEY_ALL = 'all:whale_trades'
const MAX_TRADES = 1000
const WHALE_THRESHOLD = 500000

const TOP_ASSETS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'SUI', 'TIA', 'ARB']

// Map symbol -> market_id Lighter
const marketIdMap = {}

async function fetchLighterMarkets() {
    try {
        const res = await fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBooks')
        const data = await res.json()
        data.order_books.forEach((o) => {
            if (o.market_type === 'perp' && o.status === 'active') {
                marketIdMap[o.symbol] = o.market_id
            }
        })
        console.log('Lighter markets loaded')
    } catch (err) {
        console.error('Failed to fetch Lighter markets:', err)
    }
}

await fetchLighterMarkets()

async function saveAndPublish(trades) {
    if (trades.length === 0) return

    const stringified = trades.map((t) => JSON.stringify(t))
    await redis.lPush(REDIS_KEY_ALL, ...stringified)
    await redis.lTrim(REDIS_KEY_ALL, 0, MAX_TRADES - 1)
    await redis.publish('whale_trades_update', JSON.stringify(trades))
}

// ==================== Hyperliquid WS ====================
function connectHyperliquidWS() {
    const ws = new WebSocket('wss://api.hyperliquid.xyz/ws')

    ws.on('open', () => {
        console.log('Hyperliquid WS connected')
        TOP_ASSETS.forEach((coin) => {
            ws.send(
                JSON.stringify({
                    method: 'subscribe',
                    subscription: { type: 'trades', coin },
                }),
            )
        })
    })

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString())
            if (msg.channel !== 'trades') return

            const newTrades = []
            for (const trade of msg.data) {
                const value = parseFloat(trade.px) * parseFloat(trade.sz)
                if (value <= WHALE_THRESHOLD) continue

                const uniqueId = `hyper-${trade.time}-${trade.coin}-${trade.px}-${trade.sz}-${Math.random().toString(36)}`
                newTrades.push({
                    id: uniqueId,
                    time: trade.time,
                    symbol: trade.coin,
                    side: trade.side === 'B' ? 'Buy' : 'Sell',
                    price: trade.px,
                    sizeUsd: value,
                    buyer: trade.users?.[0] || 'unknown',
                    seller: trade.users?.[1] || 'unknown',
                    status: 'Filled',
                    dex: 'hyperliquid',
                })
            }

            if (newTrades.length > 0) {
                await saveAndPublish(newTrades)
            }
        } catch (err) {
            console.error('Hyperliquid message error:', err)
        }
    })

    ws.on('close', (code, reason) => {
        console.log(
            `Hyperliquid WS closed (code: ${code}, reason: ${reason.toString()}), reconnecting in 5s...`,
        )
        setTimeout(connectHyperliquidWS, 5000)
    })

    ws.on('error', (err) => {
        console.error('Hyperliquid WS error:', err)
    })

    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping()
        }
    }, 30000)

    ws.on('close', () => clearInterval(pingInterval))
}

connectHyperliquidWS()

// ==================== Lighter WS ====================
function connectLighterWS() {
    const ws = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream')

    ws.on('open', () => {
        console.log('Lighter WS connected')
        Object.entries(marketIdMap).forEach(([symbol, marketId]) => {
            ws.send(
                JSON.stringify({
                    type: 'subscribe',
                    channel: `trade/${marketId}`,
                }),
            )
        })
    })

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString())
            if (msg.type !== 'update/trade') return

            const newTrades = []
            for (const trade of msg.trades) {
                const value = parseFloat(trade.usd_amount)
                if (value <= WHALE_THRESHOLD) continue

                const symbol =
                    Object.entries(marketIdMap).find(([s, id]) => id === trade.market_id)?.[0] ||
                    'UNKNOWN'
                const side = trade.is_maker_ask ? 'Buy' : 'Sell'

                newTrades.push({
                    id: trade.trade_id,
                    time: trade.timestamp,
                    symbol,
                    side,
                    price: trade.price,
                    sizeUsd: value,
                    buyer: trade.bid_account_id?.toString() || 'unknown',
                    seller: trade.ask_account_id?.toString() || 'unknown',
                    status: 'Filled',
                    dex: 'lighter',
                })
            }

            if (newTrades.length > 0) {
                await saveAndPublish(newTrades)
            }
        } catch (err) {
            console.error('Lighter message error:', err)
        }
    })

    ws.on('ping', (data) => {
        console.log('Received ping from Lighter WS')
        ws.pong()
    })

    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping()
        }
    }, 60000)

    ws.on('close', (code, reason) => {
        console.log(
            `Lighter WS closed (code: ${code}, reason: ${reason.toString()}), reconnecting in 5s...`,
        )
        clearInterval(pingInterval)
        setTimeout(connectLighterWS, 5000)
    })

    ws.on('error', (err) => {
        console.error('Lighter WS error:', err)
    })

    ws.on('close', () => clearInterval(pingInterval))
}

connectLighterWS()

console.log('Whale WebSocket Service running...')
