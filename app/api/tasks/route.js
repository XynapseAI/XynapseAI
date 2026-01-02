import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { logger } from '@/utils/serverLogger'
import { createClient } from 'redis'
import cookie from 'cookie'
import crypto from 'crypto'

let redisClient
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' })
    redisClient.on('error', (err) => logger.error('Redis Client Error:', err))
    await redisClient.connect()
  }
  return redisClient
}

function isAllowedOrigin(origin, referer) {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://farcaster.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
    'https://base.xynapseai.net',
  ]
  try {
    if (
      origin &&
      (allowedOrigins.includes(origin) ||
        new URL(origin).hostname.match(/(\.vercel\.app|xynapseai\.net)$/))
    )
      return true
    if (!origin && referer && allowedOrigins.includes(new URL(referer).origin)) return true
    if (!origin && !referer) return true
    if (!origin && process.env.NODE_ENV === 'development') return true
    return false
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, origin, referer })
    return false
  }
}

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient()
  const key = `rate_limit:tasks:${ip}`
  const requests = parseInt(await redisClient.get(key)) || 0
  const windowMs = 15 * 60 * 1000
  const maxRequests = process.env.NODE_ENV === 'development' ? 100 : 50
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.')
  }
  await redisClient
    .multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec()
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || ''
  try {
    return cookie.parse(raw)
  } catch {
    return {}
  }
}

async function checkDoubleSubmitCSRF(request, ip, userId) {
  const headerToken = request.headers.get('x-csrf-token') || ''
  const cookies = parseCookies(request)
  const cookieToken = cookies['csrf_token'] || ''
  if (
    process.env.NODE_ENV === 'development' &&
    headerToken === 'dev-csrf' &&
    cookieToken === 'dev-csrf'
  ) {
    return true
  }
  if (!headerToken || !cookieToken) {
    return false
  }
  const client = await getRedisClient()
  const storedToken = await client.get(`csrf:${userId}`)
  if (!storedToken) {
    return false
  }
  const valid =
    crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
    crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken))
  return valid
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  logger.info(`Request to /api/tasks from IP ${ip}`, { origin, referer })

  if (!isAllowedOrigin(origin, referer)) {
    logger.error(`CORS error: Origin ${origin || 'null'} not allowed`)
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
  }

  try {
    await checkRateLimit(ip)
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`)
    return NextResponse.json({ detail: err.message }, { status: 429 })
  }

  const session = await auth()
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated', { ip })
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  let newCsrfToken
  if (!(await checkDoubleSubmitCSRF(request, ip, session.user.id))) {
    newCsrfToken = crypto.randomBytes(32).toString('hex')
    const client = await getRedisClient()
    await client.setEx(`csrf:${session.user.id}`, 15 * 60, newCsrfToken)
    const sameSite = process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    return NextResponse.json(
      { detail: 'Invalid CSRF check. Please refresh.' },
      {
        status: 403,
        headers: {
          'Set-Cookie': cookie.serialize('csrf_token', newCsrfToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: sameSite,
            maxAge: 15 * 60,
            path: '/',
          }),
        },
      },
    )
  }

  try {
    const cacheKey = `tasks:${session.user.id}`
    const cached = await redisClient.get(cacheKey)
    if (cached) {
      logger.info(`Cache hit for tasks user ${session.user.id}`, { ip })
      const corsOrigin = origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin':
            origin === 'null' && referer ? new URL(referer).origin : corsOrigin,
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        },
      })
    }

    const tasks = [
      {
        id: 'invite',
        description: 'Invite Friends',
        points: 20,
        is_daily: false,
        max_completions: 50,
        task_type: 'invite',
        target_id: null,
      },
      {
        id: 'genesis',
        description: 'Mint Genesis NFT',
        points: 500,
        is_daily: false,
        max_completions: 1,
        task_type: 'genesis_mint',
        target_id: null,
      },
      {
        id: 'follow',
        description: 'Follow @xynapseai_',
        points: 20,
        is_daily: false,
        max_completions: 1,
        task_type: 'follow',
        target_id: '1927681051373305858',
      },
      {
        id: 'tweet',
        description: 'Tweet about Xynapse',
        points: 20,
        is_daily: false,
        max_completions: 1,
        task_type: 'tweet',
        target_id: null,
      },
      {
        id: 'daily_checkin',
        description: 'Daily Check-in',
        points: 10,
        is_daily: true,
        max_completions: 1,
        task_type: 'daily_checkin',
        target_id: null,
      },
    ]

    const data = { success: true, tasks }
    await redisClient.setEx(cacheKey, 600, JSON.stringify(data))
    logger.info('Fetched and cached tasks successfully', { userId: session.user.id, ip })

    const corsOrigin = origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin':
          origin === 'null' && referer ? new URL(referer).origin : corsOrigin,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    })
  } catch (error) {
    logger.error('Error fetching tasks', { message: error.message, stack: error.stack, ip })
    return NextResponse.json({ detail: `Error fetching tasks: ${error.message}` }, { status: 500 })
  }
}
