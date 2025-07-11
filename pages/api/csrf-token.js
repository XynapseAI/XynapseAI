import { getCsrfToken } from 'next-auth/react';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
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
  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`, { ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown' });
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session || !session.user?.id) {
      logger.warn('Session not authenticated', { ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown' });
      return res.status(401).json({ detail: 'Not signed in' });
    }

    const csrfToken = await getCsrfToken({ req });
    if (!csrfToken) {
      logger.error('Failed to generate CSRF token', { ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown' });
      return res.status(500).json({ detail: 'Failed to generate CSRF token' });
    }

    logger.info('CSRF token generated successfully', { ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown' });
    return res.status(200).json({ csrfToken });
  } catch (error) {
    logger.error(`Error processing /api/csrf-token: ${error.message}`, {
      stack: error.stack,
      ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
    });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}