// app/api/lighter/route.js
import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createClient } from 'redis'
import Bottleneck from 'bottleneck'
const prisma = globalThis.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
const limiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 300,
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
    redisClient.on('error', (err) => console.error('Redis Client Error (lighter):', err))
    await redisClient.connect()
    console.info('Redis connected for lighter')
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
  const maxViolations = 15
  const windowSeconds = 1800 // 30 minutes
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
    `Request to /api/lighter from IP ${ip}, Origin: ${origin || 'null'}, Referer: ${referer || 'null'}`,
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
    const rateKey = `lighter_rate:${ip}`
    let count = await redis.incr(rateKey)
    if (count === 1) await redis.expire(rateKey, 60)
    if (count > 30) {
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
const BASE_URL = 'https://mainnet.zklighter.elliot.ai/api/v1'
const CACHE_TTL = 1800
async function handler(request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const address = searchParams.get('address')
  const by = searchParams.get('by')
  const coin = searchParams.get('coin')
  const marketId = searchParams.get('marketId')
  const accountIndex = searchParams.get('accountIndex')
  try {
    const redis = await getRedisClient()
    if (!type) {
      const cacheKey = 'lighter:metaAndAssetCtxs'
      const cached = await redis.get(cacheKey)
      if (cached) return NextResponse.json(JSON.parse(cached))
      const [orderBooksRes, statsRes, detailsRes, fundingRes] = await Promise.all([
        fetch(`${BASE_URL}/orderBooks`),
        fetch(`${BASE_URL}/exchangeStats`),
        fetch(`${BASE_URL}/orderBookDetails`),
        fetch(`${BASE_URL}/funding-rates`),
      ])
      if (![orderBooksRes, statsRes, detailsRes, fundingRes].every((r) => r.ok)) {
        throw new Error('Lighter API error')
      }
      const orderBooksData = await orderBooksRes.json()
      const statsData = await statsRes.json()
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
        const symbol = marketIdToSymbol[f.market_id]
        if (symbol) fundingMap[symbol] = f.rate
      })
      const augmentedAssetCtxs = universe.map((u) => {
        const s = statsData.order_book_stats.find((st) => st.symbol === u.name) || {}
        const d = detailsData.order_book_details.find((dt) => dt.symbol === u.name) || {}
        const ob = orderBooks.find((o) => o.symbol === u.name) || { bids: [], asks: [] }
        const bestBid = ob.bids?.[0] ? parseFloat(ob.bids[0][0]) : 0
        const bestAsk = ob.asks?.[0] ? parseFloat(ob.asks[0][0]) : 0
        const midPx = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : d.last_trade_price || 0
        return {
          dayNtlVlm: d.daily_quote_token_volume || 0,
          openInterest: d.open_interest || 0,
          funding: fundingMap[u.name] || 0,
          midPx,
          dayPxChg: d.daily_price_change || 0,
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
      await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(result))
      return NextResponse.json(result)
    }
    // Fetch global data when needed (fixes bug + uses cache)
    let marketIdToSymbol = {}
    let orderBooks = []
    if (type === 'user' || type === 'l2book' || type === 'recentTrades' || type === 'allMids') {
      const baseUrl = new URL(request.url)
      baseUrl.search = ''
      const globalRes = await fetch(baseUrl.toString())
      if (!globalRes.ok) throw new Error('Failed to fetch global lighter data')
      const globalData = await globalRes.json()
      marketIdToSymbol = globalData.marketIdToSymbol || {}
      orderBooks = globalData.orderBooks || []
      if (type === 'l2book' && coin) {
        const book = orderBooks.find((o) => o.symbol === coin) || { bids: [], asks: [] }
        return NextResponse.json(book)
      }
      if (type === 'allMids') {
        const mids = {}
        orderBooks.forEach((ob) => {
          const bestBid = ob.bids?.[0] ? parseFloat(ob.bids[0][0]) : 0
          const bestAsk = ob.asks?.[0] ? parseFloat(ob.asks[0][0]) : 0
          mids[ob.symbol] = (bestBid + bestAsk) / 2 || 0
        })
        return NextResponse.json(mids)
      }
    }
    if (type === 'user' && address && by) {
      const query =
        by === 'index' ? `by=index&value=${address}` : `by=l1_address&l1_address=${address}`
      const accountRes = await fetch(`${BASE_URL}/account?${query}`)
      if (!accountRes.ok) throw new Error('Account not found')
      const accountData = await accountRes.json()
      const account = accountData.accounts[0]
      if (!account) throw new Error('No account found')
      const accountIndex = account.account_index
      const [tradesRes, pnlRes] = await Promise.all([
        fetch(
          `${BASE_URL}/trades?account_index=${accountIndex}&limit=500&sort_by=timestamp&sort_dir=desc`,
        ),
        fetch(`${BASE_URL}/pnl?by=index&value=${accountIndex}&resolution=1d&count_back=30`),
      ])
      const tradesData = tradesRes.ok ? await tradesRes.json() : { trades: [] }
      const pnlData = pnlRes.ok ? await pnlRes.json() : { pnl: [] }
      const fills = tradesData.trades.map((t) => ({
        time: t.timestamp,
        coin: marketIdToSymbol[t.market_id] || 'UNKNOWN',
        closedPnl: t.pnl || 0,
        sz: t.usd_amount / parseFloat(t.price) || t.amount || 0,
        px: t.price,
        dir: t.is_maker_ask ? 'Sell' : 'Buy',
        hash: t.trade_id,
      }))
      return NextResponse.json({
        account,
        fills,
        pnlHistory: pnlData.pnl || [],
      })
    }
    if (type === 'openOrders' && accountIndex) {
      const res = await fetch(`${BASE_URL}/open-orders?account_index=${accountIndex}`)
      if (!res.ok) {
        console.warn('Lighter open orders failed:', res.status)
        return NextResponse.json({ orders: [] })
      }
      const data = await res.json()
      return NextResponse.json(data)
    }
    if (type === 'recentTrades' && marketId) {
      const res = await fetch(
        `${BASE_URL}/trades?market_id=${marketId}&limit=50&sort_by=timestamp&sort_dir=desc`,
      )
      if (!res.ok) {
        console.warn('Lighter recent trades failed:', res.status)
        return NextResponse.json({ trades: [] })
      }
      const data = await res.json()
      return NextResponse.json(data)
    }
    if (type === 'candles' && coin) {
      return NextResponse.redirect(
        new URL(`/api/hyperliquid?type=candles&coin=${coin}`, request.url),
      )
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (err) {
    console.error('Lighter API error:', err)
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
