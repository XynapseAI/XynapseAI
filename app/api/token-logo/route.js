// app/api/token-logo/route.js
import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = globalThis.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const coingecko_id = searchParams.get('coingecko_id')

  if (!symbol && !coingecko_id) {
    return NextResponse.json({ error: 'Symbol or CoinGecko ID required' }, { status: 400 })
  }

  try {
    const symbolUpper = symbol?.toUpperCase()
    const where = {}
    if (symbolUpper) where.symbol = { equals: symbolUpper, mode: 'insensitive' }
    if (coingecko_id) where.coingecko_id = coingecko_id

    const token = await prisma.tokens.findFirst({
      where,
      select: { image: true },
    })

    return NextResponse.json({ image: token?.image || null })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch token logo' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
