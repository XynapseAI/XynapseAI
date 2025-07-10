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
    const tasksResult = await query(
      `SELECT id, description, points, is_daily, max_completions
       FROM tasks
       ORDER BY points ASC`
    );
    const tasks = tasksResult.rows.map(row => ({
      id: row.id,
      description: row.description || 'No description available',
      points: row.points || 0,
      isDaily: row.is_daily || false,
      maxCompletions: row.max_completions || 1,
    }));

    logger.info(`Fetched ${tasks.length} tasks`);
    return res.status(200).json({ success: true, tasks });
  } catch (error) {
    logger.error(`Error fetching tasks: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Failed to fetch tasks: ${error.message}` });
  }
}