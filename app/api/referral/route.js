// app/api/referral/route.js

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createClient } from 'redis'
import Bottleneck from 'bottleneck'
import { logger } from '../../../utils/serverLogger'
import crypto from 'crypto'
import util from 'util'
import cookie from 'cookie'

const prisma = globalThis.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma

const scrypt = util.promisify(crypto.scrypt)

const limiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 500,
})

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://base.xynapseai.net',
].filter(Boolean)

let redisClient
async function getRedisClient() {
  if (redisClient?.isOpen) return redisClient
  redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  })
  redisClient.on('error', (err) => logger.error('Redis Client Error (referral):', err))
  await redisClient.connect()
  return redisClient
}

function getClientIp(request) {
  const xForwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const xRealIp = request.headers.get('x-real-ip')?.trim()
  const vercelIp = request.headers.get('x-vercel-forwarded-for')?.trim()
  return xRealIp || vercelIp || xForwardedFor || 'unknown'
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || ''
  try {
    return cookie.parse(raw)
  } catch {
    return {}
  }
}

async function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex')
}

async function setCSRFToken(ip, userId) {
  const client = await getRedisClient()
  const token = await generateCSRFToken()
  const key = `csrf:${userId || ip}`
  await client.setEx(key, 15 * 60, token)
  return token
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
  const storedToken = await client.get(`csrf:${userId || ip}`)
  if (!storedToken) {
    return false
  }

  const valid =
    crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
    crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken))

  return valid
}

function isAllowedOrigin(origin, referer) {
  const currentOrigin = origin || (referer ? new URL(referer).origin : null)
  if (!currentOrigin) return process.env.NODE_ENV === 'development'
  return allowedOrigins.includes(currentOrigin)
}

function securityHeaders(origin, csrfToken = null) {
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
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type, x-csrf-token'
    headers['Access-Control-Allow-Credentials'] = 'true'
  }

  if (csrfToken) {
    const sameSite = process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    headers['Set-Cookie'] = cookie.serialize('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: sameSite,
      maxAge: 15 * 60,
      path: '/',
    })
  }

  return headers
}

async function checkAndTrackIP(ip) {
  const redis = await getRedisClient()
  const banKey = `banned_ip:${ip}`
  const banned = await redis.get(banKey)
  if (banned) throw new Error('Too many requests - IP temporarily banned')

  const violationKey = `violations:${ip}`
  const violations = Number(await redis.get(violationKey)) || 0
  if (violations > 15) {
    await redis.setEx(banKey, 1800, 'banned')
    logger.warn('IP banned due to excessive violations', { ip })
    throw new Error('Too many requests - IP temporarily banned')
  }
}

async function handler(request, origin, ip) {
  let newCsrfToken = null
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    // CSRF check
    const csrfOk = await checkDoubleSubmitCSRF(request, ip, userId)
    if (!csrfOk) {
      newCsrfToken = await setCSRFToken(ip, userId)
      return NextResponse.json(
        { detail: 'Invalid CSRF token. Please refresh and try again.' },
        { status: 403, headers: securityHeaders(origin, newCsrfToken) },
      )
    }

    const { inviteCode } = await request.json()
    if (!inviteCode || typeof inviteCode !== 'string' || inviteCode.trim().length < 6) {
      return NextResponse.json({ detail: 'Invalid invite code' }, { status: 400 })
    }

    const code = inviteCode.trim().toUpperCase()
    const currentUser = await prisma.users.findUnique({
      where: { id: userId },
      select: { invited_by: true },
    })

    if (currentUser?.invited_by !== null) {
      return NextResponse.json({ detail: 'You have already used an invite code' }, { status: 400 })
    }

    const inviter = await prisma.users.findUnique({
      where: { invite_code: code },
      select: { id: true, invited_count: true },
    })

    if (!inviter) {
      return NextResponse.json({ detail: 'Invalid invite code' }, { status: 404 })
    }

    if (inviter.id === userId) {
      return NextResponse.json({ detail: 'Cannot use your own invite code' }, { status: 400 })
    }

    if (inviter.invited_count >= 50) {
      return NextResponse.json(
        { detail: 'This user has reached the maximum referral limit (50)' },
        { status: 400 },
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: userId },
        data: {
          invited_by: inviter.id,
          points: { increment: 50n },
        },
      })

      await tx.users.update({
        where: { id: inviter.id },
        data: {
          points: { increment: 20n },
          invited_count: { increment: 1 },
        },
      })
    })

    const client = await getRedisClient()
    await Promise.all([
      client.del(`user:${userId}`),
      client.del(`user:${inviter.id}`),
      client.del('leaderboard'),
    ])

    logger.info('Referral success', { invitee: userId, inviter: inviter.id })

    newCsrfToken = await setCSRFToken(ip, userId) // refresh token

    return NextResponse.json(
      {
        success: true,
        message:
          'Referral applied successfully! You received 50 points. Inviter received 20 points.',
      },
      { headers: securityHeaders(origin, newCsrfToken) },
    )
  } catch (error) {
    logger.error('Referral error:', error)
    newCsrfToken = newCsrfToken || (await setCSRFToken(ip, null))
    return NextResponse.json(
      { detail: 'Server error' },
      { status: 500, headers: securityHeaders(origin, newCsrfToken) },
    )
  }
}

const secureHandler = limiter.wrap(async (request) => {
  const ip = getClientIp(request)
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

  return await handler(request, origin, ip)
})

export async function POST(request) {
  const response = await secureHandler(request)
  const origin =
    request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  Object.entries(securityHeaders(origin)).forEach(([k, v]) => response.headers.set(k, v))
  return response
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const ip = getClientIp(request)

  if (!isAllowedOrigin(origin, referer)) {
    await checkAndTrackIP(ip)
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
  }

  return new NextResponse(null, {
    status: 204,
    headers: securityHeaders(origin),
  })
}
