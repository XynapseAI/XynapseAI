// utils/serverLogger.js
import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Determine environment
const isVercel = process.env.VERCEL === '1';
const isProduction = process.env.NODE_ENV === 'production';

// Define log directory
const logsDir = isVercel ? '/tmp/logs' : path.join(process.cwd(), 'logs');

// Ensure log directory exists (synchronous)
const ensureLogDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.error(`Failed to create log directory ${dir}: ${error.message}`);
      return false;
    }
    return true; // Directory already exists
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

// Initialize transports array
const transports = [];

// Add console transport in non-production environments
if (!isProduction) {
  transports.push(
    new winston.transports.Console({
      level: 'debug',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        logFormat
      ),
    })
  );
}

// Create logger
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: logFormat,
  transports,
});

// Add transports based on environment (synchronous)
if (!isVercel) {
  // Local environment or non-Vercel production: Add file transports
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
    logger.info(`File transports added for directory: ${logsDir}`);
  } else {
    logger.warn('File transports not added due to directory creation failure');
  }
} else if (isProduction) {
  // Vercel in production: Add console transport (rely on Vercel's logging)
  logger.add(
    new winston.transports.Console({
      level: 'info',
      format: logFormat,
    })
  );
  logger.info('Console transport added for Vercel in production; relying on Vercel logging');
} else {
  // Vercel in development: Add file transports
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
        level: 'debug',
      })
    );
    logger.info(`File transports added for directory: ${logsDir}`);
  } else {
    logger.warn('File transports not added due to directory creation failure on Vercel');
  }
}

logger.info(
  `Server logger initialized in ${
    isVercel ? 'Vercel' : 'Local'
  } mode, production: ${isProduction}`
);

export { logger };