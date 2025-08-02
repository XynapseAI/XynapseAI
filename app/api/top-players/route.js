import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { auth } from '../auth/[...nextauth]/route';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip) {
  const key = `rate_limit:top_players:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = 15 * 60 * 1000;
  if (requests >= 100) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Request to /api/top-players from IP ${ip}`);

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip });
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  const recaptchaToken = request.headers.get('x-recaptcha-token');
  if (!recaptchaToken) {
    logger.error('Missing X-Recaptcha-Token header', { ip });
    return NextResponse.json({ detail: 'Missing reCAPTCHA token in header' }, { status: 400 });
  }

  try {
    const { score } = await verifyRecaptcha(recaptchaToken, 'get_top_players', ip);
    logger.info('reCAPTCHA verification successful for get_top_players', { token: recaptchaToken.substring(0, 8) + '...', score, ip });
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, { ip });
    return NextResponse.json({
      detail: `reCAPTCHA verification failed: ${error.message}`,
      errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
    }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const usersResult = await query(
            `SELECT id, wallet_address, points, tier
             FROM users
             ORDER BY points DESC
             LIMIT 10`
          );
          const topPlayers = usersResult.rows.map((row) => ({
            walletAddress: row.wallet_address || row.id,
            points: row.points,
            tier: row.tier,
          }));

          logger.info(`Fetched ${topPlayers.length} top players`, { ip });
          controller.enqueue(JSON.stringify({ success: true, players: topPlayers }));
          controller.close();
        } catch (error) {
          logger.error(`Error fetching top players: ${error.message}`, { stack: error.stack, ip });
          if (error.message.includes('relation "users" does not exist')) {
            controller.enqueue(JSON.stringify({ detail: 'Server error: Table users does not exist' }));
          } else {
            controller.enqueue(JSON.stringify({ detail: `Error fetching top players: ${error.message}` }));
          }
          controller.close();
        }
      },
    }),
    { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'self'" } }
  );
}