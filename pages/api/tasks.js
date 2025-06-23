// pages/api/tasks.js
import { db } from '../../utils/firebaseAdmin';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
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
    const tasksSnapshot = await db.collection('tasks').orderBy('points', 'asc').get();
    if (tasksSnapshot.empty) {
      logger.info('No tasks found in Firestore');
      return res.status(200).json({ success: true, tasks: [] });
    }
    const tasks = tasksSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      description: doc.data().description || 'No description available',
      points: doc.data().points || 0,
      isDaily: doc.data().isDaily || false,
      maxCompletions: doc.data().maxCompletions || 1,
    }));
    logger.info(`Fetched ${tasks.length} tasks`);
    return res.status(200).json({ success: true, tasks });
  } catch (error) {
    logger.error(`Error fetching tasks: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Failed to fetch tasks: ${error.message}` });
  }
}