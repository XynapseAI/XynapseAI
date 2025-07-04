import { getCsrfToken } from 'next-auth/react';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { logger } from '../../utils/logger';
import helmet from 'helmet';

export default async function handler(req, res) {
  // Apply security headers
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'https://ipfs.io', 'https://pbs.twimg.com'],
        connectSrc: ["'self'", 'https://api.geckoterminal.com'],
      },
    },
  })(req, res, () => {});

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const authOptionsInstance = await authOptions();
    const session = await getServerSession(req, res, authOptionsInstance);
    if (!session) {
      logger.warn('Session not authenticated');
      return res.status(401).json({ detail: 'Not signed in' });
    }

    const csrfToken = await getCsrfToken({ req: { headers: req.headers } });
    if (!csrfToken) {
      logger.error('Failed to generate CSRF token');
      return res.status(500).json({ detail: 'Failed to generate CSRF token' });
    }

    return res.status(200).json({ csrfToken });
  } catch (error) {
    logger.error(`Error processing /api/csrf-token: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}