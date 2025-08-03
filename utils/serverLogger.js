// utils/serverLogger.js
import winston from 'winston';
import path from 'path';
import fs from 'fs/promises'; // Sử dụng fs/promises để hỗ trợ async
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Xác định thư mục log dựa trên môi trường
const isProduction = process.env.NODE_ENV === 'production';
const logsDir = isProduction ? '/tmp/logs' : path.join(process.cwd(), 'logs');

// Hàm đảm bảo thư mục log tồn tại (async)
const ensureLogDir = async (dir) => {
  try {
    await fs.mkdir(dir, { recursive: true });
    console.log(`Log directory ensured: ${dir}`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.error(`Failed to create log directory ${dir}: ${error.message}`);
      // Không throw error để tránh crash ứng dụng
    }
  }
};

// Tạo logger
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
  transports: [
    // Luôn ghi log vào console để Vercel thu thập
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Thêm file transports chỉ khi cần (trong môi trường cục bộ hoặc nếu /tmp khả dụng)
const addFileTransports = async () => {
  if (isProduction) {
    // Trong production, chỉ thêm file transports nếu /tmp có thể sử dụng
    try {
      await ensureLogDir(logsDir);
      logger.add(
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
        })
      );
      logger.add(
        new winston.transports.File({
          filename: path.join(logsDir, 'combined.log'),
        })
      );
      logger.info(`File transports added for directory: ${logsDir}`);
    } catch (error) {
      console.error(`Failed to add file transports: ${error.message}`);
      // Tiếp tục chạy mà không cần file transports
    }
  } else {
    // Trong môi trường cục bộ, luôn thêm file transports
    await ensureLogDir(logsDir);
    logger.add(
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
      })
    );
    logger.add(
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
      })
    );
    logger.info(`File transports added for directory: ${logsDir}`);
  }
};

// Gọi hàm thêm file transports
addFileTransports().catch((err) => {
  console.error(`Failed to initialize file transports: ${err.message}`);
});

// Ghi log khởi tạo
logger.info('Server logger initialized successfully');

export { logger };