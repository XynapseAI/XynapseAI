// utils/cors.js
import { logger } from './serverLogger';

export function isAllowedOrigin(origin, referer) {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
    ...(process.env.NODE_ENV === 'production' ? ['https://*.vercel.app'] : []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  try {
    if (origin && allowedOrigins.some(o => o.includes('*') ? new RegExp(o.replace('*', '.*')).test(origin) : o === origin)) {
      logger.info('Origin allowed', { origin, referer });
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.some(o => o.includes('*') ? new RegExp(o.replace('*', '.*')).test(refOrigin) : o === refOrigin)) {
        logger.info('Referer origin allowed', { origin, referer, refOrigin });
        return true;
      }
    }
    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }
    logger.error('Blocked by CORS', { origin, referer });
    return false;
  } catch (error) {
    logger.error('Error in isAllowedOrigin', { error: error.message, origin, referer });
    return false;
  }
}