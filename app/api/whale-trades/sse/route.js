// app/api/whale-trades/sse/route.js
import { NextResponse } from 'next/server'
import { createClient } from 'redis'
import Bottleneck from 'bottleneck'

// Redis client
let redisClient
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL_2 || 'redis://localhost:6379',
    })
    redisClient.on('error', (err) => console.error('Redis Client Error (SSE):', err))
    await redisClient.connect()
    console.info('Redis connected for whale-trades SSE')
  } else if (!redisClient.isOpen) {
    await redisClient.connect()
  }
  return redisClient
}

const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 1000,
})

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://base.xynapseai.net',
].filter(Boolean)

// In-memory active clients (per controller)
const clients = new Set()

// Security check
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
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }
  if (origin && origin !== 'null') {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

// IP abuse tracking
async function checkAndTrackIP(ip) {
  const redis = await getRedisClient()
  const banKey = `banned_ip_sse:${ip}`
  const banned = await redis.get(banKey)
  if (banned) {
    console.warn(`SSE IP blocked: ${ip}`)
    throw new Error('Too many connections')
  }

  const connKey = `sse_connections:${ip}`
  const currentConns = Number(await redis.get(connKey)) || 0
  if (currentConns >= 3) {
    await redis.setEx(banKey, 1800, 'banned')
    console.error(`SSE IP banned for excessive connections: ${ip}`)
    throw new Error('Too many connections')
  }

  await redis.multi().incr(connKey).expire(connKey, 3600).exec()
}

async function decrementIPConnection(ip) {
  try {
    const redis = await getRedisClient()
    const connKey = `sse_connections:${ip}`
    const current = await redis.get(connKey)
    if (current && parseInt(current) > 0) {
      await redis.decr(connKey)
    }
  } catch (err) {
    console.error('Error decrementing SSE connection count:', err)
  }
}

// Main SSE handler
async function handler(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  // CORS check
  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
  }

  // Rate limit + connection limit check
  try {
    await checkAndTrackIP(ip)
  } catch (err) {
    return NextResponse.json({ detail: err.message }, { status: 429 })
  }

  const redis = await getRedisClient()

  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }

  const stream = new ReadableStream({
    async start(controller) {
      clients.add(controller)

      try {
        let trades = await redis.lRange('all:whale_trades', 0, 499)
        const allTrades = trades
          .map((t) => {
            try {
              return JSON.parse(t)
            } catch {
              return null
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.time - a.time)

        controller.enqueue(`data: ${JSON.stringify(allTrades)}\n\n`)
      } catch (err) {
        console.error('Error sending initial SSE data:', err)
      }

      // Subscribe to updates
      const pubsub = redis.duplicate()
      await pubsub.connect()

      const channelHandler = async () => {
        try {
          let latestTrades = await redis.lRange('all:whale_trades', 0, 499)
          const parsedTrades = latestTrades
            .map((t) => {
              try {
                return JSON.parse(t)
              } catch {
                return null
              }
            })
            .filter(Boolean)
            .sort((a, b) => b.time - a.time)
            .slice(0, 500)

          const fullMessage = JSON.stringify(parsedTrades)

          // Broadcast to all active clients
          for (const client of clients) {
            try {
              client.enqueue(`data: ${fullMessage}\n\n`)
            } catch (err) {
              clients.delete(client)
              await decrementIPConnection(ip)
            }
          }
        } catch (err) {
          console.error('Error broadcasting SSE update:', err)
        }
      }

      await pubsub.subscribe('whale_trades_update', channelHandler)

      request.signal.addEventListener('abort', async () => {
        clients.delete(controller)
        await decrementIPConnection(ip)
        await pubsub.unsubscribe('whale_trades_update', channelHandler)
        await pubsub.quit()
      })
    },

    async cancel() {
      // Client closed connection
      await decrementIPConnection(ip)
    },
  })

  return new NextResponse(stream, { headers })
}

const secureHandler = limiter.wrap(handler)

// Export
export async function GET(request) {
  const response = await secureHandler(request)
  const origin =
    request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  Object.entries(securityHeaders(origin)).forEach(([key, value]) => {
    response.headers.set(key, value)
  })

  return response
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
  }

  return new NextResponse(null, {
    status: 204,
    headers: securityHeaders(origin),
  })
}
