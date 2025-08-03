import winston from 'winston';
import path from 'path';
import fs from 'fs/promises';

// Xác định môi trường
const isVercel = process.env.VERCEL === '1';
const isProduction = process.env.NODE_ENV === 'production';

// Xác định thư mục log
const logsDir = isVercel ? '/tmp/logs' : path.join(process.cwd(), 'logs');

// Hàm đảm bảo thư mục log tồn tại
const ensureLogDir = async (dir) => {
  try {
    await fs.mkdir(dir, { recursive: true });
    console.log(`Log directory ensured: ${dir}`);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.error(`Failed to create log directory ${dir}: ${error.message}`);
      return false;
    }
    return true; // Thư mục đã tồn tại, không cần xử lý thêm
  }
};

// Base transports (console)
const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }),
];

// Khởi tạo logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) =>
      stack
        ? `${timestamp} [${level.toUpperCase()}]: ${message} - ${stack}`
        : `${timestamp} [${level.toUpperCase()}]: ${message}`
    )
  ),
  transports,
});

// Thêm file transports dựa trên môi trường
(async () => {
  if (!isVercel) {
    // Môi trường local: Ghi log vào ./logs
    const logDirCreated = await ensureLogDir(logsDir);
    if (logDirCreated) {
      transports.push(
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
        }),
        new winston.transports.File({
          filename: path.join(logsDir, 'combined.log'),
        })
      );
      logger.info(`File transports added for directory: ${logsDir}`);
    } else {
      logger.warn('File transports not added due to directory creation failure');
    }
  } else if (isProduction) {
    // Môi trường Vercel: Chỉ ghi log vào console (hoặc tùy chọn ghi vào /tmp/logs)
    // Nếu muốn ghi vào /tmp/logs, bỏ comment đoạn code dưới đây
    /*
    const logDirCreated = await ensureLogDir(logsDir);
    if (logDirCreated) {
      transports.push(
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
        }),
        new winston.transports.File({
          filename: path.join(logsDir, 'combined.log'),
        })
      );
      logger.info(`File transports added for directory: ${logsDir}`);
    } else {
      logger.warn('File transports not added due to directory creation failure on Vercel');
    }
    */
    logger.info('File transports skipped on Vercel; using console only');
  }

  logger.info(
    `Server logger initialized in ${
      isVercel ? 'Vercel (console only)' : 'Local'
    } mode`
  );
})();

export { logger };