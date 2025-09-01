// utils/clientLogger.js
const isProduction = process.env.NODE_ENV === 'production';

const logger = {
  info: (...args) => {
    if (!isProduction) {
      console.log('[INFO]', ...args);
    }
  },
  warn: (...args) => {
    if (!isProduction) {
      console.warn('[WARN]', ...args);
    }
  },
  error: (...args) => {
    if (!isProduction) {
      console.error('[ERROR]', ...args);
    }
  },
  log: (...args) => {
    if (!isProduction) {
      console.log('[LOG]', ...args);
    }
  },
};

export { logger };