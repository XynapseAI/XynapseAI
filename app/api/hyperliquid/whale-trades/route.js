// app/api/hyperliquid/whale-trades/route.js
import { NextResponse } from 'next/server'
import { createClient } from 'redis'

let redisClient
async function getRedisClient() {
    if (!redisClient) {
        redisClient = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
        })
        redisClient.on('error', (err) => console.error('Redis Client Error:', err))
        await redisClient.connect()
        console.log('Redis connected for whale-trades')
    } else if (!redisClient.isOpen) {
        await redisClient.connect()
    }
    return redisClient
}

const REDIS_KEY = 'hyperliquid:whale_trades'
const MAX_TRADES = 100

export async function GET() {
    try {
        const redis = await getRedisClient()
        const trades = await redis.lRange(REDIS_KEY, 0, -1)

        let parsed = trades.length > 0 ? trades.map((t) => JSON.parse(t)) : []

        return NextResponse.json(parsed)
    } catch (err) {
        console.error('Redis GET error:', err)
        return NextResponse.json([], { status: 500 })
    }
}

export async function POST(request) {
    try {
        const body = await request.json()
        if (!Array.isArray(body)) {
            return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
        }

        const redis = await getRedisClient()

        if (body.length > 0) {
            const stringified = body.map((t) => JSON.stringify(t))
            await redis.lPush(REDIS_KEY, ...stringified)
            await redis.lTrim(REDIS_KEY, 0, MAX_TRADES - 1)
        }

        return NextResponse.json({ success: true })
    } catch (err) {
        console.error('Redis POST error:', err)
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }
}
