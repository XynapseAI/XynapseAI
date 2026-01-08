// app/api/hyperliquid/route.js
import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createClient } from 'redis'
import Bottleneck from 'bottleneck'
const prisma = globalThis.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
const limiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 200,
})
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://base.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean)
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
function isAllowedOrigin(origin, referer) {
  const check = (url) => {
    if (!url) return false
    try {
      const parsed = new URL(url)
      const originUrl = parsed.origin
      if (allowedOrigins.includes(originUrl)) return true
      const hostname = parsed.hostname
      return hostname === 'xynapseai.net' || hostname.endsWith('.xynapseai.net')
    } catch {
      return false
    }
  }
  if (!origin && !referer) return true // Internal/SSR
  if (!origin && process.env.NODE_ENV === 'development') return true
  return check(origin) || check(referer)
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
async function banIP(ip, durationSeconds = 1800) {
  if (ip === 'unknown') return
  const redis = await getRedisClient()
  await redis.setEx(`banned_ip:${ip}`, durationSeconds, 'banned')
  console.info(`IP banned: ${ip} for ${durationSeconds} seconds`)
}
async function checkIPBan(ip) {
  if (ip === 'unknown') return
  const redis = await getRedisClient()
  const isBanned = await redis.get(`banned_ip:${ip}`)
  if (isBanned) {
    console.warn(`IP ban detected: ${ip}`)
    throw new Error('Too many requests')
  }
}
async function trackViolation(ip, reason = 'Unknown', severity = 'severe') {
  if (ip === 'unknown') return
  const nonCriticalReasons = ['Not allowed by CORS']
  if (nonCriticalReasons.includes(reason) || severity === 'warn') {
    console.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}`)
    return
  }
  const redis = await getRedisClient()
  const key = `violations:${ip}`
  const maxViolations = 30
  const windowSeconds = 900 // 30 minutes
  const violations = Number(await redis.get(key)) || 0
  if (violations >= maxViolations) {
    await banIP(ip)
    console.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`)
    throw new Error('Too many requests')
  }
  await redis.multi().incr(key).expire(key, windowSeconds).exec()
  console.warn(
    `Violation recorded: ${ip}, reason: ${reason}, count: ${violations + 1}/${maxViolations}`,
  )
}
const secureHandler = limiter.wrap(async (request) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  console.info(
    `Request to /api/hyperliquid from IP ${ip}, Origin: ${origin || 'null'}, Referer: ${referer || 'null'}`,
  )
  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'Not allowed by CORS', 'warn')
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
  }
  try {
    await checkIPBan(ip)
  } catch (e) {
    await trackViolation(ip, 'Attempted access while banned', 'severe')
    return NextResponse.json({ detail: 'Too many requests' }, { status: 429 })
  }
  // Per-IP rate limit: 30 requests per minute
  if (ip !== 'unknown') {
    const redis = await getRedisClient()
    const rateKey = `hyperliquid_rate:${ip}`
    let count = await redis.incr(rateKey)
    if (count === 1) await redis.expire(rateKey, 60)
    if (count > 50) {
      try {
        await trackViolation(ip, 'Rate limit exceeded', 'severe')
      } catch {
        // Already banned, still return 429
      }
      return NextResponse.json({ detail: 'Too many requests' }, { status: 429 })
    }
  }
  const res = await handler(request)
  let safeAllowOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net'
  if (origin && isAllowedOrigin(origin, null)) {
    safeAllowOrigin = origin
  } else if (referer) {
    try {
      const refOrigin = new URL(referer).origin
      if (isAllowedOrigin(refOrigin, null)) {
        safeAllowOrigin = refOrigin
      }
    } catch {}
  }
  const headers = securityHeaders(safeAllowOrigin)
  Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v))
  return res
})
const CACHE_TTL = 1800
async function handler(request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const address = searchParams.get('address')
  const coin = searchParams.get('coin')
  const startTime = searchParams.get('startTime')
  const endTime = searchParams.get('endTime')
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
      const cacheKey = `hyperliquid:userState:${address}`
      const cached = await redis.get(cacheKey)
      if (cached) return NextResponse.json(JSON.parse(cached))
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: address }),
      })
      if (!res.ok) throw new Error('Failed to fetch user state')
      const state = await res.json()
      await redis.setEx(cacheKey, 60, JSON.stringify(state))
      return NextResponse.json(state)
    }
    if (type === 'userFills' && address) {
      const cacheKey = `hyperliquid:userFills:${address}`
      const cached = await redis.get(cacheKey)
      if (cached) return NextResponse.json(JSON.parse(cached))
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userFills', user: address }),
      })
      if (!res.ok) throw new Error('Failed to fetch user fills')
      const fills = await res.json()
      await redis.setEx(cacheKey, 60, JSON.stringify(fills))
      return NextResponse.json(fills)
    }
    if (type === 'userOpenOrders' && address) {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userOpenOrders', user: address }),
      })
      if (!res.ok) throw new Error('Failed to fetch open orders')
      const openOrders = await res.json()
      return NextResponse.json(openOrders)
    }
    if (type === 'fundingHistory' && coin && startTime) {
      const body = {
        type: 'fundingHistory',
        coin,
        startTime: parseInt(startTime),
        endTime: endTime ? parseInt(endTime) : Date.now(),
      }
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Funding history failed')
      const data = await res.json()
      return NextResponse.json(data)
    }
    if (type === 'recentTrades' && coin) {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'recentTrades', coin }),
      })
      if (!res.ok) throw new Error('Recent trades failed')
      const trades = await res.json()
      return NextResponse.json(trades)
    }
    if (type === 'allMids') {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      })
      if (!res.ok) throw new Error('All mids failed')
      const mids = await res.json()
      return NextResponse.json(mids) // Return {coins: []}
    }
    if (type === 'userLedger' && address) {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userLedger', user: address }),
      })
      if (!res.ok) throw new Error('User ledger failed')
      const ledger = await res.json()
      return NextResponse.json(ledger)
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
export async function GET(request) {
  return await secureHandler(request)
}
export async function OPTIONS(request) {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json(
      { detail: 'Not allowed by CORS' },
      { status: 403, headers: securityHeaders(origin) },
    )
  }
  return new NextResponse(null, { status: 204, headers: securityHeaders(origin) })
}
