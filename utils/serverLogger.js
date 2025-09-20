// utils/serverLogger.js
import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Determine environment
const isVercel = process.env.VERCEL === '1';
const isProduction = process.env.NODE_ENV === 'production';

// Define log directory
const logsDir = isVercel ? '/tmp/logs' : path.join(process.cwd(), 'logs');

// Ensure log directory exists
const ensureLogDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.error(`Failed to create log directory ${dir}: ${error.message}`);
      return false;
    }
    return true;
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

// Initialize transports
const transports = [];

// Add console transport only in non-production environments
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

// Create base logger
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: logFormat,
  transports,
});

// Add file or console transports depending on environment
if (!isVercel) {
  // Local (dev or prod): log to files
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
    if (!isProduction) {
      logger.info(`File transports added at: ${logsDir}`);
    }
  } else {
    logger.warn('Failed to create log directory; file transports not added');
  }
} else if (isProduction) {
  // Vercel production: use console only (Vercel collects console output)
  logger.add(
    new winston.transports.Console({
      level: 'info',
      format: logFormat,
    })
  );
} else {
  // Vercel dev: log to files
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
    logger.info(`File transports added for Vercel dev at: ${logsDir}`);
  }
}

logger.info(
  `Server logger initialized → ${isVercel ? 'Vercel' : 'Local'}, production: ${isProduction}`
);

export { logger };
