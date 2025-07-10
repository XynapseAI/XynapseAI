// utils/logger.cjs
const winston = require('winston');
const path = require('path');
const fs = require('fs');

let logger;

if (typeof window === 'undefined') {
  const logsDir = path.join(process.cwd(), 'logs');

  // Tạo thư mục logs nếu chưa tồn tại
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }), // Ghi stack trace cho lỗi
      winston.format.printf(({ level, message, timestamp, stack }) => {
        return stack
          ? `${timestamp} [${level.toUpperCase()}]: ${message} - ${stack}`
          : `${timestamp} [${level.toUpperCase()}]: ${message}`;
      })
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
          winston.format.colorize(), // Màu sắc cho console
          winston.format.simple() // Định dạng đơn giản cho console
        ),
      }),
    ],
  });

  // Test log để xác nhận logger hoạt động
  logger.info('Logger initialized successfully');
  console.log('Logger initialized successfully');
} else {
  // Logic cho browser
  logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    log: (...args) => console.log('[LOG]', ...args),
  };
}

module.exports = { logger };