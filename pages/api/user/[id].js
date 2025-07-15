// pages/api/user/[id].js
import { query } from '../../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth].js';
import { logger } from '../../../utils/logger.cjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ success: false, detail: 'Phương thức không được phép' });
  }

  const session = await getServerSession(req, res, authOptions);
  logger.debug('Session in /api/user/[id]:', session);
  logger.debug('Requested ID:', req.query.id);

  if (!session || session.user.id !== req.query.id) {
    logger.warn(`Access denied: sessionUserId=${session?.user?.id}, requestedId=${req.query.id}`);
    return res.status(401).json({ success: false, detail: 'Chưa đăng nhập hoặc không có quyền' });
  }

  try {
    const result = await query(`SELECT * FROM users WHERE id = $1`, [req.query.id]);
    if (result.rows.length === 0) {
      logger.error(`User not found: ${req.query.id}`);
      return res.status(404).json({ success: false, detail: 'Không tìm thấy người dùng' });
    }
    const user = result.rows[0];
    logger.info(`Fetched user data for ID: ${req.query.id}`);
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
        lastConnected: user.last_connected ? new Date(user.last_connected).toISOString() : null,
      },
    });
  } catch (error) {
    logger.error(`Error fetching user: ${error.message}`, { stack: error.stack });
    if (error.message.includes('relation "users" does not exist')) {
      return res.status(500).json({ success: false, detail: 'Server error: Table users does not exist' });
    }
    return res.status(500).json({ success: false, detail: `Không thể lấy dữ liệu người dùng: ${error.message}` });
  }
}