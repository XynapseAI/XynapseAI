import jwt from 'jsonwebtoken';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './[...nextauth]';
import { logger } from '../../../utils/logger';
import { getSecrets } from '../../../lib/vault';

export default async function handler(req, res) {
  // Apply security headers
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://ipfs.io https://pbs.twimg.com; connect-src 'self' https://api.geckoterminal.com;",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  const secrets = await getSecrets();
  const JWT_SECRET = secrets.JWT_SECRET;

  try {
    const authOptionsInstance = await authOptions();
    const session = await getServerSession(req, res, authOptionsInstance);
    if (!session || !session.user?.id) {
      logger.warn('Session not authenticated or missing user ID');
      return res.status(401).json({ detail: 'Not signed in' });
    }

    if (!JWT_SECRET) {
      logger.error('JWT_SECRET not configured');
      throw new Error('Server configuration incomplete');
    }

    const token = jwt.sign(
      {
        userId: session.user.id,
        twitterHandle: session.user.twitterHandle,
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      JWT_SECRET
    );

    return res.status(200).json({ token });
  } catch (error) {
    logger.error(`Error processing /api/auth/jwt: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}