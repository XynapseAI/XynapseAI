// app/api/lighter/whale-trades/route.js
import { NextResponse } from 'next/server'
import { createClient } from 'redis'

let redisClientLighter
async function getRedisClientLighter() {
    if (!redisClientLighter) {
        redisClientLighter = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
        })
        redisClientLighter.on('error', (err) => console.error('Redis Client Error:', err))
        await redisClientLighter.connect()
        console.log('Redis connected for lighter whale-trades')
    } else if (!redisClientLighter.isOpen) {
        await redisClientLighter.connect()
    }
    return redisClientLighter
}

const REDIS_KEY_LIGHTER = 'lighter:whale_trades'
const MAX_TRADES_LIGHTER = 100

export async function GET() {
    try {
        const redis = await getRedisClientLighter()
        const trades = await redis.lRange(REDIS_KEY_LIGHTER, 0, -1)

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

        const redis = await getRedisClientLighter()

        if (body.length > 0) {
            const stringified = body.map((t) => JSON.stringify(t))
            await redis.lPush(REDIS_KEY_LIGHTER, ...stringified)
            await redis.lTrim(REDIS_KEY_LIGHTER, 0, MAX_TRADES_LIGHTER - 1)
        }

        return NextResponse.json({ success: true })
    } catch (err) {
        console.error('Redis POST error:', err)
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }
}
