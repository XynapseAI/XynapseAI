// utils/serverLogger.js

// Prevent execution in browser environment
if (typeof window !== 'undefined') {
  console.warn('serverLogger.js is meant for server-side use only. Falling back to console.');
  module.exports = { logger: console };
  return;
}

// Import Node.js modules
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Determine environment
const isVercel = process.env.VERCEL === '1';
const isProduction = process.env.NODE_ENV === 'production';

// Define log directory
const logsDir = isVercel ? '/tmp/logs' : path.join(process.cwd(), 'logs');

// Function to ensure log directory exists
const ensureLogDir = (dir) => {
  console.log(`[serverLogger] Attempting to create log directory: ${dir}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[serverLogger] Log directory created or already exists: ${dir}`);
    return true;
  } catch (error) {
    console.error(`[serverLogger] Failed to create log directory ${dir}: ${error.message}`);
    return false;
  }
};

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) =>
    stack
      ? `${timestamp} [${level.toUpperCase()}]: ${message} - ${stack}`
      : `${timestamp} [${level.toUpperCase()}]: ${message}`
  )
);

// Initialize transports with console as default
const transports = [
  new winston.transports.Console({
    level: isProduction ? 'info' : 'debug',
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      logFormat
    ),
  }),
];

// Create logger instance
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: logFormat,
  transports,
});

// Add file transports based on environment
(() => {
  console.log(`[serverLogger] Environment: ${isVercel ? 'Vercel' : 'Local'}, Production: ${isProduction}`);
  
  if (isVercel && isProduction) {
    // Vercel in production: Skip file transports, rely on console
    logger.info('[serverLogger] Skipping file transports on Vercel in production; using console logging');
  } else {
    // Local or Vercel in development: Add file transports
    const logDirCreated = ensureLogDir(logsDir);
    if (logDirCreated) {
      logger.add(
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
        })
      );
      logger.add(
        new winston.transports.File({
          filename: path.join(logsDir, 'combined.log'),
          level: logger.level,
        })
      );
      logger.info(`[serverLogger] File transports added for directory: ${logsDir}`);
    } else {
      logger.warn('[serverLogger] File transports not added due to directory creation failure');
    }
  }

  logger.info(`[serverLogger] Logger initialized in ${isVercel ? 'Vercel' : 'Local'} mode`);
})();

module.exports = { logger };