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
    const ttl = 1800 // 30

    const cached = await redis.get(cacheKey)
    if (cached) {
      console.log('Cache hit for lighter meta')
      return NextResponse.json(JSON.parse(cached))
    }

    // Fetch từ Lighter API
    const baseUrl = 'https://mainnet.zklighter.elliot.ai/api/v1'
    const orderBooksRes = await fetch(`${baseUrl}/orderBooks`)
    if (!orderBooksRes.ok) {
      throw new Error(`Lighter API error: ${orderBooksRes.status}`)
    }
    const orderBooksData = await orderBooksRes.json()
    const orderBooks = orderBooksData.order_books

    const universe = orderBooks
      .filter((o) => o.market_type === 'perp' && o.status === 'active')
      .map((o) => ({ name: o.symbol, image: null }))

    const exchangeStatsRes = await fetch(`${baseUrl}/exchangeStats`)
    if (!exchangeStatsRes.ok) {
      throw new Error(`Lighter API error: ${exchangeStatsRes.status}`)
    }
    const stats = await exchangeStatsRes.json()

    const assetCtxs = universe.map((u) => {
      const s = stats.order_book_stats.find((st) => st.symbol === u.name) || {
        daily_quote_token_volume: 0,
        open_interest: 0,
      }
      return {
        dayNtlVlm: s.daily_quote_token_volume,
        openInterest: s.open_interest || 0,
      }
    })

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

    const result = { universe: augmentedUniverse, assetCtxs, orderBooks }

    await redis.setEx(cacheKey, ttl, JSON.stringify(result))
    console.log('Cached lighter meta for 30 minutes')

    return NextResponse.json(result)
  } catch (err) {
    console.error('Lighter API error:', err)
    return NextResponse.json({ error: 'Failed to fetch meta data' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
