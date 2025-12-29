// app/api/lighter/route.js
import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createClient } from 'redis'
const prisma = globalThis.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
// Redis client singleton
let redisClient
async function getRedisClient() {
    if (!redisClient) {
        redisClient = createClient({
            url: process.env.REDIS_URL_2 || 'redis://localhost:6379',
        })
        redisClient.on('error', (err) => console.error('Redis Client Error:', err))
        await redisClient.connect()
        console.log('Redis connected for lighter')
    } else if (!redisClient.isOpen) {
        await redisClient.connect()
    }
    return redisClient
}
export async function GET() {
    try {
        const redis = await getRedisClient()
        const cacheKey = 'lighter:metaAndAssetCtxs'
        const ttl = 1800
        const cached = await redis.get(cacheKey)
        if (cached) return NextResponse.json(JSON.parse(cached))
        const baseUrl = 'https://mainnet.zklighter.elliot.ai/api/v1'
        const [orderBooksRes, exchangeStatsRes, detailsRes, fundingRes] = await Promise.all([
            fetch(`${baseUrl}/orderBooks`),
            fetch(`${baseUrl}/exchangeStats`),
            fetch(`${baseUrl}/orderBookDetails`),
            fetch(`${baseUrl}/funding-rates`),
        ])
        if (!orderBooksRes.ok || !exchangeStatsRes.ok || !detailsRes.ok || !fundingRes.ok) {
            throw new Error('Lighter API error')
        }
        const orderBooksData = await orderBooksRes.json()
        const statsData = await exchangeStatsRes.json()
        const detailsData = await detailsRes.json()
        const fundingData = await fundingRes.json()
        const orderBooks = orderBooksData.order_books.filter(
            (o) => o.market_type === 'perp' && o.status === 'active',
        )
        const universe = orderBooks.map((o) => ({ name: o.symbol, image: null }))
        const assetToMarketId = {}
        const marketIdToSymbol = {}
        orderBooks.forEach((o) => {
            assetToMarketId[o.symbol] = o.market_id
            marketIdToSymbol[o.market_id] = o.symbol
        })
        const fundingMap = {}
        fundingData.funding_rates.forEach((f) => {
            const symbol = marketIdToSymbol[f.market_id] || f.symbol
            if (symbol) fundingMap[symbol] = f.rate
        })
        const augmentedAssetCtxs = universe.map((u) => {
            const s = statsData.order_book_stats.find((st) => st.symbol === u.name) || {}
            const d = detailsData.order_book_details.find((dt) => dt.symbol === u.name) || {}
            const ob = orderBooks.find((o) => o.symbol === u.name) || { bids: [], asks: [] }
            // Tính midPx từ best bid/ask nếu có
            const bestBid = ob.bids?.length > 0 ? parseFloat(ob.bids[0][0]) : 0
            const bestAsk = ob.asks?.length > 0 ? parseFloat(ob.asks[0][0]) : 0
            const midPx =
                bestBid > 0 && bestAsk > 0
                    ? (bestBid + bestAsk) / 2
                    : d.last_trade_price || s.last_trade_price || 0
            return {
                dayNtlVlm: d.daily_quote_token_volume || s.daily_quote_token_volume || 0,
                openInterest: d.open_interest || 0,
                funding: fundingMap[u.name] || 0,
                midPx: midPx,
                dayPxChg: d.daily_price_change || s.daily_price_change || 0,
            }
        })
        const symbols = universe.map((u) => u.name.toUpperCase())
        const tokens = await prisma.tokens.findMany({
            where: { symbol: { in: symbols, mode: 'insensitive' } },
            select: { symbol: true, image: true },
        })
        const tokenMap = new Map(tokens.map((t) => [t.symbol.toUpperCase(), t.image]))
        const augmentedUniverse = universe.map((u) => ({
            ...u,
            image: tokenMap.get(u.name.toUpperCase()) || null,
        }))
        const result = {
            universe: augmentedUniverse,
            assetCtxs: augmentedAssetCtxs,
            orderBooks,
            assetToMarketId,
            marketIdToSymbol,
        }
        await redis.setEx(cacheKey, ttl, JSON.stringify(result))
        return NextResponse.json(result)
    } catch (err) {
        console.error('Lighter API error:', err)
        return NextResponse.json({ error: 'Failed to fetch meta data' }, { status: 500 })
    } finally {
        await prisma.$disconnect()
    }
}
