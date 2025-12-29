// app/api/etf-data/route.js
import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import Bottleneck from 'bottleneck'
import { logger } from '../../../utils/serverLogger'
import { createClient } from 'redis'
import { PrismaClient } from '@prisma/client'

const prisma = globalThis.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 2,
  minTime: 250,
})

// Allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://base.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean)

// ================= Redis Client =================
let redisClient
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    })
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }))
    await redisClient.connect()
    logger.info('Redis connected for etf-data')
  } else if (!redisClient.isOpen) {
    await redisClient.connect()
    logger.info('Redis reconnected for etf-data')
  }
  return redisClient
}

// ================= Security =================
function isAllowedOrigin(origin, referer) {
  const check = (url) => {
    if (!url) return false
    try {
      const parsed = new URL(url)
      const hostname = parsed.hostname
      const originUrl = parsed.origin

      if (allowedOrigins.includes(originUrl)) return true
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
  const baseHeaders = {
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  }
  if (origin && origin !== 'null') {
    baseHeaders['Access-Control-Allow-Origin'] = origin
    baseHeaders['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    baseHeaders['Access-Control-Allow-Headers'] = 'Content-Type'
  }
  return baseHeaders
}

async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient()
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned')
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`)
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient()
  const isBanned = await redisClient.get(`banned_ip:${ip}`)
  if (isBanned) {
    logger.error(`IP ban detected: ${ip}`)
    throw new Error('IP temporarily banned due to excessive violations.')
  }
}

async function trackViolation(ip, reason = 'Unknown', severity = 'severe') {
  const nonCriticalReasons = ['Not allowed by CORS']
  if (nonCriticalReasons.includes(reason) || severity === 'warn') {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}`)
    return
  }
  const redisClient = await getRedisClient()
  const key = `violations:${ip}`
  const maxViolations = 10
  const windowMs = 30 * 60 * 1000
  const violations = parseInt(await redisClient.get(key)) || 0
  if (violations >= maxViolations) {
    await banIP(ip)
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`)
    throw new Error('IP temporarily banned due to excessive violations.')
  }
  await redisClient
    .multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec()
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`)
}

// CORS wrapper
const handlerWrapper = (handler) =>
  limiterBottleneck.wrap(async (req) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const origin = req.headers.get('origin')
    const referer = req.headers.get('referer')
    const startTime = Date.now()

    if (logger) {
      logger.info(
        `Request to /api/etf-data from IP ${ip}, Origin: ${origin || 'null'}, Referer: ${referer || 'null'}`,
      )
    }

    if (!isAllowedOrigin(origin, referer)) {
      await trackViolation(ip, 'Not allowed by CORS', 'warn')
      return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
    }

    try {
      await checkIPBan(ip)
    } catch (err) {
      await trackViolation(ip, err.message, 'severe')
      return NextResponse.json({ detail: err.message }, { status: 429 })
    }
    const res = await handler(req)

    let safeAllowOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net'

    if (origin && isAllowedOrigin(origin, null)) {
      safeAllowOrigin = origin
    } else if (referer) {
      try {
        const refOrigin = new URL(referer).origin
        if (isAllowedOrigin(null, referer)) {
          safeAllowOrigin = refOrigin
        }
      } catch (e) {}
    }

    const headers = securityHeaders(safeAllowOrigin)
    Object.entries(headers).forEach(([key, value]) => {
      res.headers.set(key, value)
    })

    res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type')

    if (logger) {
      logger.info(`Response for /api/etf-data, time: ${Date.now() - startTime}ms`, { ip })
    }

    return res
  })

const getSymbolFromName = (nameTag) => {
  const lower = nameTag.toLowerCase()
  if (lower.includes('ishares')) return 'IBIT'
  if (lower.includes('fidelity')) return 'FBTC'
  if (lower.includes('grayscale') && lower.includes('mini')) return 'BTC'
  if (lower.includes('grayscale')) return 'GBTC'
  if (lower.includes('bitwise')) return 'BITB'
  if (lower.includes('ark 21shares') || lower.includes('21shares')) return 'ARKB'
  if (lower.includes('vaneck')) return 'HODL'
  if (lower.includes('invesco galaxy')) return 'BTCO'
  if (lower.includes('valkyrie')) return 'BRRR'
  if (lower.includes('franklin')) return 'EZBC'
  if (lower.includes('wisdomtree')) return 'BTCW'
  if (lower.includes('hashdex')) return 'DEFI'
  return nameTag.split(' ')[0].toUpperCase()
}

const keywordToImage = {
  ishares: '/icons/blackrock.webp',
  fidelity: '/icons/fidelity.webp',
  grayscale: '/icons/grayscale.webp',
  bitwise: '/icons/bitwise.webp',
  ark: '/icons/21shares.webp',
  vaneck: '/icons/vaneck.webp',
  invesco: '/icons/invesco.webp',
  valkyrie: '/icons/valkyrie.webp',
  franklin: '/icons/franklin.webp',
  wisdomtree: '/icons/wisdom.webp',
  hashdex: '/icons/hashdex.webp',
  default: '/icons/bitcoin.webp',
}

const getImageForEtf = (name) => {
  const lowerName = name.toLowerCase()
  for (const [key, img] of Object.entries(keywordToImage)) {
    if (lowerName.includes(key)) return img
  }
  return keywordToImage.default
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

export const GET = handlerWrapper(async () => {
  const startOverall = Date.now()
  try {
    const redis = await getRedisClient()
    const cacheKey = 'etf-data:all'
    const cached = await redis.get(cacheKey)
    if (cached) {
      if (logger) logger.info(`Cache hit for etf-data: ${cacheKey}`)
      const result = JSON.parse(cached)
      const overallDuration = Date.now() - startOverall
      if (logger) logger.info(`Full API handler completed in ${overallDuration}ms (cache hit)`)
      return NextResponse.json(result)
    }

    const btcResponse = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      {
        headers: {
          Accept: 'application/json',
        },
      },
    )
    if (!btcResponse.ok) {
      throw new Error(`Coingecko API error: ${btcResponse.status}`)
    }
    const btcData = await btcResponse.json()
    const btcPrice = btcData.bitcoin?.usd || 100000

    const holdersPath = path.join(process.cwd(), 'public/nametags/bitcoin-top-holders.json')

    const holdersData = JSON.parse(await fs.readFile(holdersPath, 'utf8'))

    // Fetch flows from database (EtfFlows table)
    const flows = await prisma.etfFlows.findMany({
      where: {
        chain: 'bitcoin',
        is_summary: false,
      },
      orderBy: {
        created_at: 'desc',
      },
    })

    const etfs = Object.values(holdersData).filter((item) => {
      const nameTag = item.Labels?.bitcoin?.['Name Tag'] || ''
      const lower = nameTag.toLowerCase()
      return (
        lower.includes('bitcoin') &&
        (lower.includes('etf') || lower.includes('fund') || lower.includes('trust'))
      )
    })

    const validFlows = flows
      .filter(
        (f) =>
          f.date && typeof f.date === 'string' && f.date.match(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/),
      )
      .sort(
        (a, b) =>
          new Date(b.date.replace(/(\w+) (\d+), (\d+)/, '$1 $2 $3')) -
          new Date(a.date.replace(/(\w+) (\d+), (\d+)/, '$1 $2 $3')),
      )

    // Top 6 ETFs chart
    const topSymbols = ['IBIT', 'FBTC', 'ARKB', 'BTC', 'GBTC', 'HODL']

    const chartData = validFlows
      .filter((f) => topSymbols.includes(f.symbol))
      .reduce((acc, f) => {
        if (!acc[f.date]) acc[f.date] = { date: f.date }
        acc[f.date][f.symbol] = f.flow
        return acc
      }, {})
    let chartArray = Object.values(chartData)
    chartArray.sort(
      (a, b) =>
        new Date(a.date.replace(/(\w+) (\d+), (\d+)/, '$1 $2 $3')) -
        new Date(b.date.replace(/(\w+) (\d+), (\d+)/, '$1 $2 $3')),
    )

    const flowChartData = chartArray.map((d) => {
      const values = Object.values(d).filter((v) => typeof v === 'number')
      const inflow = values.filter((v) => v > 0).reduce((a, b) => a + b, 0) || 0
      const outflow = Math.abs(values.filter((v) => v < 0).reduce((a, b) => a + b, 0)) || 0
      return { date: d.date, inflow, outflow }
    })

    const tableData = etfs
      .map((holder) => {
        const nameTag = holder.Labels?.bitcoin?.['Name Tag'] || ''
        const symbol = getSymbolFromName(nameTag)
        const latestFlow = validFlows.find((f) => f.symbol === symbol)
        const flowValue = Number(latestFlow?.flow || 0)
        return {
          name: nameTag,
          symbol,
          image: holder.Labels?.bitcoin?.image || getImageForEtf(nameTag),
          totalHolding: Number(holder.Balance || 0),
          valueUSD: Number(holder.Balance || 0) * btcPrice,
          inflow: flowValue > 0 ? flowValue : 0,
          outflow: flowValue < 0 ? Math.abs(flowValue) : 0,
        }
      })
      .sort((a, b) => b.totalHolding - a.totalHolding)

    const result = { chartArray, flowChartData, tableData }

    await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400)
    if (logger) logger.info(`Cached etf-data: ${cacheKey}`)

    const overallDuration = Date.now() - startOverall
    if (logger) logger.info(`Full API handler completed in ${overallDuration}ms`)

    return NextResponse.json(result)
  } catch (err) {
    const overallDuration = Date.now() - startOverall
    if (logger)
      logger.error(`Error in /api/etf-data after ${overallDuration}ms: ${err.message}`, {
        stack: err.stack,
      })
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
})
