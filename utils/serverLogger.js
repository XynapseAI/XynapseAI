// utils/serverLogger.js
import winston from 'winston';
import path from 'path';
import fs from 'fs/promises';

// Xác định môi trường
const isVercel = process.env.VERCEL === '1';
const isProduction = process.env.NODE_ENV === 'production';

// Xác định thư mục log (local hoặc /tmp)
const logsDir = isVercel ? '/tmp/logs' : path.join(process.cwd(), 'logs');

// Hàm đảm bảo thư mục log tồn tại
const ensureLogDir = async (dir) => {
  try {
    await fs.mkdir(dir, { recursive: true });
    console.log(`Log directory ensured: ${dir}`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.error(`Failed to create log directory ${dir}: ${error.message}`);
    }
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

// Chỉ thêm file transport khi không chạy trong môi trường Vercel
if (!isVercel) {
  await ensureLogDir(logsDir);
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
    })
  );
} else if (isProduction) {
  // Nếu muốn ghi file log tạm trong /tmp trên Vercel, bật đoạn này:
  try {
    await ensureLogDir(logsDir);
    transports.push(
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
      })
    );
    console.log(`File transports added for directory: ${logsDir}`);
  } catch (error) {
    console.error(`Failed to add file transports: ${error.message}`);
  }
}

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
  transports,
});

logger.info(
  `Server logger initialized in ${
    isVercel ? 'Vercel (console only or /tmp)' : 'Local'
  } mode`
);

export { logger };
