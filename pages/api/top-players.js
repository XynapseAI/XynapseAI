import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import helmet from 'helmet';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { stack: err.stack, ip });
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const recaptchaToken = req.headers['x-recaptcha-token'];
    if (!recaptchaToken) {
      logger.error('Missing X-Recaptcha-Token header', { ip });
      return res.status(400).json({ detail: 'Missing reCAPTCHA token in header' });
    }

    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'get_top_players', ip);
      logger.info('reCAPTCHA verification successful for get_top_players', {
        token: recaptchaToken.substring(0, 8) + '...',
        score,
        ip,
      });
    } catch (error) {
      logger.error(`reCAPTCHA verification failed: ${error.message}`, {
        stack: error.stack,
        token: recaptchaToken.substring(0, 8) + '...',
        ip,
      });
      return res.status(403).json({
        detail: `reCAPTCHA verification failed: ${error.message}`,
        errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
      });
    }

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
    return res.status(200).json({ success: true, players: topPlayers });
  } catch (error) {
    logger.error(`Error fetching top players: ${error.message}`, { stack: error.stack, ip });
    if (error.message.includes('relation "users" does not exist')) {
      return res.status(500).json({ detail: 'Server error: Table users does not exist' });
    }
    return res.status(500).json({ detail: `Error fetching top players: ${error.message}` });
  }
}