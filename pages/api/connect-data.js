// pages/api/connect-data.js
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
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

export default async function handler(req, res) {
  // Thêm header CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://app.xynapseai.net');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true'); // Thêm để hỗ trợ credentials

  // Xử lý preflight request (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}`);

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
    logger.info(`Fetching connect-data for user: ${session.user.id}`, { ip });
    let creatorsResult, aiRankResult, rankingsResult;
    try {
      [creatorsResult, aiRankResult, rankingsResult] = await Promise.all([
        query(
          `SELECT id, twitter_handle, twitter_pfp, tweet_points, tier 
           FROM users 
           WHERE tweet_points > 0 
           ORDER BY tweet_points DESC 
           LIMIT 10`
        ),
        query(
          `SELECT id, twitter_handle, twitter_pfp, ai_points, tier 
           FROM users 
           WHERE ai_points > 0 
           ORDER BY ai_points DESC 
           LIMIT 10`
        ),
        query(
          `SELECT id, twitter_handle, twitter_pfp, points, tier 
           FROM users 
           WHERE points > 0 
           ORDER BY points DESC 
           LIMIT 100`
        ),
      ]);
    } catch (error) {
      if (error.message.includes('relation "users" does not exist')) {
        logger.error(`Table users does not exist`, { ip });
        return res.status(500).json({ detail: 'Server error: Table users does not exist' });
      }
      throw error;
    }

    const creators = creatorsResult.rows.map((row) => ({
      id: row.id,
      twitterHandle: row.twitter_handle,
      twitterPFP: row.twitter_pfp,
      tweetPoints: row.tweet_points,
      tier: row.tier,
    }));

    const aiRank = aiRankResult.rows.map((row) => ({
      id: row.id,
      twitterHandle: row.twitter_handle,
      twitterPFP: row.twitter_pfp,
      aiPoints: row.ai_points,
      tier: row.tier,
    }));

    const rankings = rankingsResult.rows.map((row) => ({
      id: row.id,
      twitterHandle: row.twitter_handle,
      twitterPFP: row.twitter_pfp,
      points: row.points,
      tier: row.tier,
    }));

    logger.info('Fetched connect-data successfully', {
      creatorsCount: creators.length,
      aiRankCount: aiRank.length,
      rankingsCount: rankings.length,
      userId: session.user.id,
      ip,
    });

    return res.status(200).json({
      success: true,
      creators: creators.map((user) => ({ ...user, isCreator: true, points: user.tweetPoints })),
      aiRank: aiRank.map((user) => ({ ...user, isAiRank: true, points: user.aiPoints })),
      rankings,
    });
  } catch (error) {
    logger.error('Error fetching connect-data', {
      message: error.message,
      stack: error.stack,
      userId: session.user.id,
      ip,
    });
    return res.status(500).json({ detail: `Error fetching leaderboard data: ${error.message}` });
  }
}