// app/api/hyperliquid/route.js
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
            url: process.env.REDIS_URL || 'redis://localhost:6379',
        })
        redisClient.on('error', (err) => console.error('Redis Client Error:', err))
        await redisClient.connect()
        console.log('Redis connected for hyperliquid')
    } else if (!redisClient.isOpen) {
        await redisClient.connect()
    }
    return redisClient
}

export async function GET() {
    try {
        const redis = await getRedisClient()
        const cacheKey = 'hyperliquid:metaAndAssetCtxs'
        const ttl = 300 // 5 phút cache

        // Kiểm tra cache trước
        const cached = await redis.get(cacheKey)
        if (cached) {
            console.log('Cache hit for hyperliquid meta')
            return NextResponse.json(JSON.parse(cached))
        }

        // Fetch từ Hyperliquid API
        const metaRes = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        })

        if (!metaRes.ok) {
            throw new Error(`Hyperliquid API error: ${metaRes.status}`)
        }

        const meta = await metaRes.json()
        const universe = meta[0].universe
        const assetCtxs = meta[1]

        // Lấy logo từ DB
        const symbols = universe.map((u) => u.name.toUpperCase())

        const tokens = await prisma.tokens.findMany({
            where: {
                symbol: {
                    in: symbols,
                    mode: 'insensitive',
                },
            },
            select: { symbol: true, image: true },
        })

        const tokenMap = new Map(tokens.map((t) => [t.symbol.toUpperCase(), t.image]))

        const augmentedUniverse = universe.map((u) => ({
            ...u,
            image: tokenMap.get(u.name) || null,
        }))

        const result = { universe: augmentedUniverse, assetCtxs }

        await redis.setEx(cacheKey, ttl, JSON.stringify(result))
        console.log('Cached hyperliquid meta for 5 minutes')

        return NextResponse.json(result)
    } catch (err) {
        console.error('Hyperliquid API error:', err)
        return NextResponse.json({ error: 'Failed to fetch meta data' }, { status: 500 })
    } finally {
        await prisma.$disconnect()
    }
}
