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
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      // Ghi log lỗi bằng console vì logger chưa được khởi tạo
      console.error(`Failed to create log directory ${dir}: ${error.message}`);
      return false;
    }
    return true; // Thư mục đã tồn tại
  }
};

// Định dạng log tùy chỉnh
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) =>
    stack
      ? `${timestamp} [${level.toUpperCase()}]: ${message} - ${stack}`
      : `${timestamp} [${level.toUpperCase()}]: ${message}`
  )
);

// Base transports
const transports = [];

// Console transport với mức log khác nhau giữa production và development
transports.push(
  new winston.transports.Console({
    level: isProduction ? 'info' : 'debug', // Chỉ ghi log mức info trở lên trong production
    format: isProduction
      ? logFormat // Không sử dụng colorize trong production
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
          logFormat
        ),
  })
);

// Khởi tạo logger
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug', // Mức log mặc định
  format: logFormat,
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
          level: 'debug', // Ghi tất cả log từ debug trở lên
        })
      );
      logger.info(`File transports added for directory: ${logsDir}`);
    } else {
      logger.warn('File transports not added due to directory creation failure');
    }
  } else if (isProduction) {
    // Môi trường Vercel trong production: Chỉ sử dụng console
    logger.info('File transports skipped on Vercel in production; using console only');
  } else {
    // Môi trường Vercel trong development: Có thể thêm file transports nếu cần
    const logDirCreated = await ensureLogDir(logsDir);
    if (logDirCreated) {
      transports.push(
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
        }),
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
})();

export { logger };