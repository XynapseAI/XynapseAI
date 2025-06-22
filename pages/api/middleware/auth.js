// pages/api/middleware/auth.js
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { logger } from '../../../utils/logger';

const requireAuth = async (req, res, next) => {
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID');
    return res.status(401).json({ detail: 'Not signed in' });
  }
  req.session = session; // Attach session to req for consistency
  next();
};

module.exports = { requireAuth };