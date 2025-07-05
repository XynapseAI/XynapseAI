import jwt from 'jsonwebtoken';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './[...nextauth].js';
import { logger } from '../../../utils/logger.cjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session || !session.user?.id) {
      logger.warn('Session not authenticated or missing user ID');
      return res.status(401).json({ detail: 'Not signed in' });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET not configured');
      throw new Error('Server configuration incomplete');
    }

    const token = jwt.sign(
      {
        userId: session.user.id,
        twitterHandle: session.user.twitterHandle,
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      jwtSecret
    );

    return res.status(200).json({ token });
  } catch (error) {
    logger.error(`Error processing /api/auth/jwt: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}