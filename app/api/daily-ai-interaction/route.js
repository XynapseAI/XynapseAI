import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { auth } from '../auth/[...nextauth]/route';
import { query } from '../../../utils/postgres';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:daily_ai_interaction:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 10) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const querySchema = z.object({
  uid: z.string().max(100).nonempty('Invalid UID'),
  interactionType: z.enum(['chat', 'market']).optional().default('chat'),
});

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/daily-ai-interaction from IP ${ip}, query: ${JSON.stringify(Object.fromEntries(request.nextUrl.searchParams))}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.error(`Authentication error: No session or UID`, { ip });
    return NextResponse.json({ detail: 'Not authenticated.' }, { status: 401 });
  }

  let parsedParams;
  try {
    parsedParams = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { uid, interactionType } = parsedParams;

  if (uid !== session.user.id) {
    logger.error(`Invalid parameters: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Missing or invalid user ID' }, { status: 400 });
  }

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateString = today.toISOString().split('T')[0];
    const docId = `${uid}_${dateString}_${interactionType}`;

    let dailyInteraction;
    try {
      const result = await query(`SELECT count FROM daily_ai_interactions WHERE id = $1`, [docId]);
      dailyInteraction = result.rows.length > 0 ? result.rows[0] : { count: 0 };
    } catch (error) {
      if (error.message.includes('relation "daily_ai_interactions" does not exist')) {
        logger.error(`Table daily_ai_interactions does not exist`, { ip });
        return NextResponse.json({ detail: 'Server error: Table daily_ai_interactions does not exist' }, { status: 500 });
      }
      throw error;
    }

    const pointsCount = Math.min(dailyInteraction.count || 0, 5);
    const totalCount = dailyInteraction.count || 0;

    logger.info(`Retrieved daily AI interaction count for user: ${uid}, type: ${interactionType}, pointsCount: ${pointsCount}, totalCount: ${totalCount}`, { ip });
    return NextResponse.json({ success: true, pointsCount, totalCount }, {
      headers: { 'Content-Security-Policy': "default-src 'self'" },
    });
  } catch (error) {
    logger.error(`Request processing error: ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ detail: `Server error: ${error.message}` }, { status: 500 });
  }
}