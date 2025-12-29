// app/api/hyperliquid/route.js
import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createClient } from 'redis'
import Bottleneck from 'bottleneck'

const prisma = globalThis.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma

// Rate limiter
const limiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 200,
})

// Allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://base.xynapseai.net',
].filter(Boolean)

// Redis client
let redisClient
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL_2 || 'redis://localhost:6379',
    })
    redisClient.on('error', (err) => console.error('Redis Client Error (hyperliquid):', err))
    await redisClient.connect()
    console.info('Redis connected for hyperliquid')
  } else if (!redisClient.isOpen) {
    await redisClient.connect()
  }
  return redisClient
}

// Security functions
function isAllowedOrigin(origin, referer) {
  const currentOrigin = origin || (referer ? new URL(referer).origin : null)
  if (!currentOrigin) return process.env.NODE_ENV === 'development'

  return allowedOrigins.includes(currentOrigin)
}

function securityHeaders(origin) {
  const headers = {
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  }
  if (origin && origin !== 'null') {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
  }
  return headers
}

async function checkAndTrackIP(ip) {
  const redis = await getRedisClient()
  const banKey = `banned_ip:${ip}`
  const banned = await redis.get(banKey)
  if (banned) {
    console.warn(`IP blocked: ${ip}`)
    throw new Error('Too many requests')
  }

  const violationKey = `violations:${ip}`
  const violations = Number(await redis.get(violationKey)) || 0
  if (violations > 15) {
    await redis.setEx(banKey, 1800, 'banned')
    console.error(`IP banned: ${ip}`)
    throw new Error('Too many requests')
  }
}

// Handler wrapper
const secureHandler = limiter.wrap(async (request) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  if (!isAllowedOrigin(origin, referer)) {
    await checkAndTrackIP(ip)
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
  }

  try {
    await checkAndTrackIP(ip)
  } catch (err) {
    return NextResponse.json({ detail: err.message }, { status: 429 })
  }

  return await handler(request, origin)
})

// Main handler
async function handler(request, origin) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const address = searchParams.get('address')
  const coin = searchParams.get('coin')

  const CACHE_TTL = 1800

  try {
    const redis = await getRedisClient()

    if (!type) {
      // Global meta
      const cacheKey = 'hyperliquid:metaAndAssetCtxs'
      const cached = await redis.get(cacheKey)
      if (cached) return NextResponse.json(JSON.parse(cached))

      const metaRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      })
      if (!metaRes.ok) throw new Error('Hyperliquid meta failed')
      const [meta, assetCtxsRaw] = await metaRes.json()

      const universe = meta.universe
      const assetCtxs = assetCtxsRaw.map((ctx) => ({ ...ctx, dayNtlVlm: ctx.dayNtlVlm || 0 }))

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

      const result = { universe: augmentedUniverse, assetCtxs }
      await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(result))
      return NextResponse.json(result)
    }

    if (type === 'user' && address) {
      const cacheKey = `hyperliquid:user:${address}`
      const cached = await redis.get(cacheKey)
      if (cached) return NextResponse.json(JSON.parse(cached))

      const [stateRes, fillsRes] = await Promise.all([
        fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'clearinghouseState', user: address }),
        }),
        fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'userFills', user: address }),
        }),
      ])

      if (!stateRes.ok || !fillsRes.ok) throw new Error('Failed to fetch user data')
      const state = await stateRes.json()
      const fills = await fillsRes.json()
      const result = { state, fills }
      await redis.setEx(cacheKey, 60, JSON.stringify(result))
      return NextResponse.json(result)
    }

    if (type === 'candles' && coin) {
      const now = Date.now()
      const start = now - 30 * 24 * 60 * 60 * 1000
      const body = {
        type: 'candleSnapshot',
        req: { coin, interval: '1d', startTime: start, endTime: now },
      }
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Candles fetch failed')
      const data = await res.json()
      return NextResponse.json(data)
    }

    if (type === 'l2book' && coin) {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'l2Book', coin }),
      })
      if (!res.ok) throw new Error('L2 book fetch failed')
      const book = await res.json()
      return NextResponse.json(book)
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (err) {
    console.error('Hyperliquid API error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// Export handlers
export async function GET(request) {
  const response = await secureHandler(request)
  const origin =
    request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  Object.entries(securityHeaders(origin)).forEach(([k, v]) => response.headers.set(k, v))
  return response
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin, request.headers.get('referer'))) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
  }
  return new NextResponse(null, { status: 204, headers: securityHeaders(origin) })
}
