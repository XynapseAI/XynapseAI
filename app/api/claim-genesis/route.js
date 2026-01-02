import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { logger } from '@/utils/serverLogger'
import { PrismaClient } from '@prisma/client'
import { verifyRecaptcha } from '@/utils/verifyRecaptcha'
import { createClient } from 'redis'
import { ethers } from 'ethers'
import cookie from 'cookie'
import crypto from 'crypto'

const prisma = new PrismaClient()

// Contract details
const CONTRACT_ADDRESS = '0x22EE9eE1a5986ff354d34ed19Eb28E65091C7648'
const BASE_RPC = 'https://mainnet.base.org' // Public Base Mainnet RPC (recommend Alchemy for production)
const provider = new ethers.JsonRpcProvider(BASE_RPC)

const NFT_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

let redisClient
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' })
    redisClient.on('error', (err) => logger.error('Redis Client Error:', err))
    await redisClient.connect()
  }
  return redisClient
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://base.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  'https://xynapse-ai.vercel.app',
].filter(Boolean)

async function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) return true
  if (origin && allowedOrigins.includes(origin)) return true
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin
      if (allowedOrigins.includes(refOrigin)) return true
    } catch {}
  }
  return process.env.NODE_ENV === 'development'
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || ''
  try {
    return cookie.parse(raw)
  } catch {
    return {}
  }
}

async function checkDoubleSubmitCSRF(request, userId) {
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
  if (!headerToken || !cookieToken) return false
  const client = await getRedisClient()
  const storedToken = await client.get(`csrf:${userId}`)
  if (!storedToken) return false
  return (
    crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken)) &&
    crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(storedToken))
  )
}

async function checkRateLimit(ip) {
  const client = await getRedisClient()
  const key = `rate_limit:claim_genesis:${ip}`
  const count = Number(await client.get(key)) || 0
  const windowSec = 300 // 5 minutes
  const max = process.env.NODE_ENV === 'development' ? 50 : 10
  if (count >= max) {
    throw new Error('Too many requests')
  }
  await client.multi().incr(key).expire(key, windowSec).exec()
}

// Retry function for balanceOf to handle temporary RPC issues
async function getNFTBalance(contract, address, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      const balance = await contract.balanceOf(address)
      return balance
    } catch (err) {
      logger.warn(`balanceOf attempt ${i + 1}/${retries} failed`, {
        address,
        error: err.message,
        code: err.code,
        reason: err.reason,
      })
      if (i === retries - 1) throw err
      // Exponential backoff delay
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)))
    }
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  if (!(await isAllowedOrigin(origin, referer))) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 })
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin || (referer ? new URL(referer).origin : '*'),
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type, X-Recaptcha-Token, X-CSRF-Token',
    'Access-Control-Allow-Credentials': 'true',
  }

  try {
    await checkRateLimit(ip)

    const session = await auth()
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { detail: 'Not authenticated' },
        { status: 401, headers: corsHeaders },
      )
    }

    const userId = session.user.id

    if (!(await checkDoubleSubmitCSRF(request, userId))) {
      return NextResponse.json(
        { detail: 'Invalid CSRF token' },
        { status: 403, headers: corsHeaders },
      )
    }

    const recaptchaToken = request.headers.get('x-recaptcha-token')
    if (process.env.NODE_ENV !== 'development' && !recaptchaToken) {
      return NextResponse.json(
        { detail: 'Missing reCAPTCHA token' },
        { status: 400, headers: corsHeaders },
      )
    }

    if (process.env.NODE_ENV !== 'development') {
      const recaptchaResponse = await verifyRecaptcha(recaptchaToken, 'claim_genesis', ip)
      if (!recaptchaResponse.success) {
        return NextResponse.json(
          { detail: 'reCAPTCHA verification failed' },
          { status: 403, headers: corsHeaders },
        )
      }
    }

    // Get user + wallet
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { wallet_address: true },
    })

    if (!user?.wallet_address) {
      return NextResponse.json(
        { detail: 'No wallet connected' },
        { status: 400, headers: corsHeaders },
      )
    }

    // Validate and normalize address (force lowercase to prevent ENS resolver)
    const walletAddress = user.wallet_address.trim()
    if (!ethers.isAddress(walletAddress)) {
      logger.warn('Invalid wallet address format in DB', { userId, walletAddress })
      return NextResponse.json(
        { detail: 'Invalid wallet address format' },
        { status: 400, headers: corsHeaders },
      )
    }
    const addressToCheck = walletAddress.toLowerCase()

    // On-chain check with retry
    const contract = new ethers.Contract(CONTRACT_ADDRESS, NFT_ABI, provider)
    let balance
    try {
      balance = await getNFTBalance(contract, addressToCheck, 4)
      logger.info('balanceOf success', {
        userId,
        address: addressToCheck,
        balance: balance.toString(),
      })
    } catch (err) {
      logger.error('Failed to check NFT balance after retries', {
        userId,
        address: addressToCheck,
        error: err.message,
        code: err.code,
      })
      return NextResponse.json(
        {
          detail:
            'On-chain verification temporarily unavailable. Please try again in a few minutes.',
        },
        { status: 503, headers: corsHeaders },
      )
    }

    if (balance === 0n || balance === 0) {
      return NextResponse.json(
        { detail: 'No Genesis NFT found in your wallet' },
        { status: 400, headers: corsHeaders },
      )
    }

    // Check already claimed
    const existing = await prisma.task_completions.findFirst({
      where: {
        user_id: userId,
        task_id: 'genesis',
      },
    })

    if (existing) {
      return NextResponse.json(
        { detail: 'You have already claimed the Genesis reward' },
        { status: 400, headers: corsHeaders },
      )
    }

    // NEW FIX: Upsert the genesis task to ensure it exists (prevents foreign key violation)
    await prisma.tasks.upsert({
      where: { id: 'genesis' },
      update: {},
      create: {
        id: 'genesis',
        description: 'Mint Genesis NFT',
        points: 500,
        is_daily: false,
        max_completions: 1,
        task_type: 'genesis_mint',
        target_id: null,
        created_at: new Date(),
      },
    })

    // Claim reward
    await prisma.$transaction(async (tx) => {
      await tx.task_completions.create({
        data: {
          user_id: userId,
          task_id: 'genesis',
          completion_count: 1,
          points_earned: 500,
          completed_at: new Date(),
        },
      })

      await tx.users.update({
        where: { id: userId },
        data: {
          points: { increment: 500n },
          task_points: { increment: 500n },
        },
      })
    })

    // Clear caches
    const client = await getRedisClient()
    await Promise.all([client.del(`user:${userId}`), client.del(`taskProgress:${userId}`)])

    logger.info('Genesis reward claimed successfully', { userId, wallet: addressToCheck })

    return NextResponse.json({ success: true, pointsEarned: 500 }, { headers: corsHeaders })
  } catch (error) {
    logger.error('Error in claim-genesis', { error: error.message, stack: error.stack, ip })
    return NextResponse.json({ detail: 'Server error' }, { status: 500, headers: corsHeaders })
  } finally {
    await prisma.$disconnect()
  }
}
