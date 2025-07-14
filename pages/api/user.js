// pages/api/user.js
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha';
import { query } from '../../utils/postgres';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5kb',
    },
  },
};

export default async function handler(req, res) {
  // Thêm header CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://app.xynapseai.net');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Recaptcha-Token, Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true'); // Thêm để hỗ trợ credentials

  // Xử lý preflight request (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}, query: ${JSON.stringify(req.query)}`);

  const session = await getServerSession(req, res, authOptions);
  logger.debug(`Session: ${JSON.stringify(session)}`);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  if (req.method === 'GET') {
    const { uid } = req.query;
    if (!uid || typeof uid !== 'string' || uid.length > 100) {
      logger.warn(`Invalid UID: ${uid}`, { ip });
      return res.status(400).json({ detail: 'Invalid UID' });
    }
    if (uid !== session.user.id) {
      logger.warn(`Access denied: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
      return res.status(403).json({ detail: 'Access denied: Invalid UID' });
    }

    const recaptchaToken = req.headers['x-recaptcha-token'];
    if (!recaptchaToken) {
      logger.error('Missing X-Recaptcha-Token header', { ip });
      return res.status(400).json({ detail: 'Missing reCAPTCHA token in header' });
    }

    try {
      const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
      logger.info('reCAPTCHA verification successful for get_user', {
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

    try {
      const result = await query(`SELECT * FROM users WHERE id = $1`, [uid]);
      if (result.rows.length === 0) {
        logger.error(`User not found: ${uid}`, { ip });
        return res.status(404).json({ detail: 'User not found' });
      }

      const user = result.rows[0];
      logger.info(`Fetched user data for UID: ${uid}`, { ip });
      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          twitterHandle: user.twitter_handle || '',
          twitterPFP: user.twitter_pfp || '',
          points: user.points || 0,
          tweetPoints: user.tweet_points || 0,
          aiPoints: user.ai_points || 0,
          taskPoints: user.task_points || 0,
          isCreator: user.is_creator || false,
          isAiRank: user.is_ai_rank || false,
          tier: user.tier || 'Basic',
          is_premium: user.is_premium || false,
          walletAddress: user.wallet_address || null,
          lastConnected: user.last_connected ? new Date(user.last_connected) : null,
        },
      });
    } catch (dbError) {
      logger.error(`Database query error: ${dbError.message}`, { stack: dbError.stack, ip });
      if (dbError.message.includes('relation "users" does not exist')) {
        return res.status(500).json({ detail: 'Server error: Table users does not exist' });
      }
      return res.status(500).json({ detail: `Server error: ${dbError.message}` });
    }
  } else if (req.method === 'POST') {
    const { id, twitterHandle, twitterPFP } = req.body;
    if (!id || typeof id !== 'string' || id.length > 100) {
      logger.warn(`Invalid ID: ${id}`, { ip });
      return res.status(400).json({ detail: 'Invalid ID' });
    }
    if (!twitterHandle || typeof twitterHandle !== 'string' || twitterHandle.length > 15) {
      logger.warn(`Invalid Twitter handle: ${twitterHandle}`, { ip });
      return res.status(400).json({ detail: 'Invalid Twitter handle' });
    }
    if (twitterPFP && (typeof twitterPFP !== 'string' || !twitterPFP.match(/^https?:\/\/.+/))) {
      logger.warn(`Invalid Twitter PFP: ${twitterPFP}`, { ip });
      return res.status(400).json({ detail: 'Invalid profile picture URL' });
    }
    if (session.user.id !== id) {
      logger.warn(`Unauthorized: uid=${id}, sessionUserId=${session.user.id}`, { ip });
      return res.status(401).json({ detail: 'Unauthorized' });
    }

    const userData = {
      twitter_handle: twitterHandle,
      twitter_pfp: twitterPFP || null,
      twitter_connected: true,
      last_connected: new Date(),
      points: 0,
      tweet_points: 0,
      ai_points: 0,
      task_points: 0,
      is_creator: false,
      is_ai_rank: false,
      tier: 'Basic',
      is_plus: false,
    };

    try {
      await query(
        `INSERT INTO users (
          id, twitter_handle, twitter_pfp, twitter_connected, 
          points, tweet_points, ai_points, task_points, 
          is_creator, is_ai_rank, tier, is_plus, created_at, last_connected
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          twitter_handle = EXCLUDED.twitter_handle,
          twitter_pfp = EXCLUDED.twitter_pfp,
          twitter_connected = EXCLUDED.twitter_connected,
          last_connected = EXCLUDED.last_connected,
          points = EXCLUDED.points,
          tweet_points = EXCLUDED.tweet_points,
          ai_points = EXCLUDED.ai_points,
          task_points = EXCLUDED.task_points,
          is_creator = EXCLUDED.is_creator,
          is_ai_rank = EXCLUDED.is_ai_rank,
          tier = EXCLUDED.tier,
          is_plus = EXCLUDED.is_plus,
          updated_at = CURRENT_TIMESTAMP`,
        [
          id,
          userData.twitter_handle,
          userData.twitter_pfp,
          userData.twitter_connected,
          userData.points,
          userData.tweet_points,
          userData.ai_points,
          userData.task_points,
          userData.is_creator,
          userData.is_ai_rank,
          userData.tier,
          userData.is_plus,
          new Date(),
          userData.last_connected,
        ]
      );

      const result = await query(`SELECT * FROM users WHERE id = $1`, [id]);
      const updatedUser = result.rows[0];
      logger.info(`User created/updated: ${id}`, { ip });
      return res.status(200).json({ success: true, user: { id, ...updatedUser } });
    } catch (dbError) {
      logger.error(`Database query error: ${dbError.message}`, { stack: dbError.stack, ip });
      if (dbError.message.includes('relation "users" does not exist')) {
        return res.status(500).json({ detail: 'Server error: Table users does not exist' });
      }
      return res.status(500).json({ detail: `Server error: ${dbError.message}` });
    }
  } else {
    logger.warn(`Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Method not allowed' });
  }
}