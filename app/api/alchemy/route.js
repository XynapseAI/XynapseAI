import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function POST(request) {
  const { action, chain } = await request.json();

  if (!chain) {
    return NextResponse.json({ error: 'Chain required' }, { status: 400 });
  }

  // Helper để lấy và parse JSON an toàn
  const getCachedData = async (key, defaultVal = []) => {
    const cached = await redis.get(key);
    if (!cached) return defaultVal;
    return typeof cached === 'string' ? JSON.parse(cached) : cached;
  };

  try {
    if (action === 'native-price') {
      const price = await redis.get(`price:${chain}`);
      return NextResponse.json({ price: Number(price) || 0 });
    }

    if (action === 'latest-blocks') {
      const blocks = await getCachedData(`blocks:${chain}`);
      return NextResponse.json(blocks);
    }

    if (action === 'latest-txs') {
      const txs = await getCachedData(`txs:${chain}`);
      return NextResponse.json(txs);
    }
    
    // Thêm action mới để lấy Stats (BlockNumber, Gas) từ Redis luôn
    if (action === 'chain-stats') {
       const stats = await getCachedData(`stats:${chain}`, { blockNumber: 0, gasPrice: '0' });
       return NextResponse.json(stats);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json([]);
  }
}