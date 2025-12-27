import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createClient } from 'redis'

const prisma = new PrismaClient()
let redisClient

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' })
    await redisClient.connect()
  }
  return redisClient
}

export async function POST(request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ detail: 'Unauthenticated' }, { status: 401 })

    const { taskId } = await request.json()
    if (taskId !== 'daily_checkin') return NextResponse.json({ success: true })

    const user = await prisma.users.findUnique({
      where: { id: session.user.id },
      select: { invited_by: true, points: true },
    })

    if (!user?.invited_by) return NextResponse.json({ success: true })

    const client = await getRedisClient()
    const rewardKey = `referral_reward:${session.user.id}`
    const alreadyRewarded = await client.get(rewardKey)
    if (alreadyRewarded) return NextResponse.json({ success: true })

    const referralCount = await prisma.users.count({
      where: { invited_by: user.invited_by },
    })
    if (referralCount >= 50) return NextResponse.json({ success: true })

    await prisma.users.update({
      where: { id: user.invited_by },
      data: { points: { increment: 20 } },
    })

    await client.setEx(rewardKey, 30 * 24 * 60 * 60, '1')

    // Clear cache inviter
    await client.del(`user:${user.invited_by}`)

    return NextResponse.json({ success: true, rewarded: true })
  } catch (error) {
    console.error('Referral reward error:', error)
    return NextResponse.json({ success: true })
  }
}
