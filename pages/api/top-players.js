import { query } from '../../utils/postgres.js';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const usersResult = await query(
      `SELECT id, wallet_address, points, tier
       FROM users
       ORDER BY points DESC
       LIMIT 10`
    );
    const topPlayers = usersResult.rows.map(row => ({
      walletAddress: row.wallet_address || row.id,
      points: row.points,
      tier: row.tier,
    }));

    logger.info(`Fetched ${topPlayers.length} top players`);
    return res.status(200).json({ success: true, players: topPlayers });
  } catch (error) {
    logger.error(`Error fetching top players: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Failed to fetch top players: ${error.message}` });
  }
}