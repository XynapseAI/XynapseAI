// utils/logger.cjs
const winston = require('winston');
const path = require('path');
const fs = require('fs');

let logger;

if (typeof window === 'undefined') {
  const logsDir = path.join(process.cwd(), 'logs');

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
      }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple() 
        )
      }),
    ],
  });

} else {
  // Giữ nguyên logic cho browser
  logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    log: (...args) => console.log('[LOG]', ...args),
  };
}

module.exports = { logger };