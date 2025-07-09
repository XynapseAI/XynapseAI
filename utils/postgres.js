import { Pool } from 'pg';
import pkg from './logger.cjs';

const { logger } = pkg;

// Cấu hình connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : false, // Kiểm tra chứng chỉ trong production
  },
  max: 20, // Số kết nối tối đa
  idleTimeoutMillis: 30000, // Đóng kết nối không hoạt động sau 30 giây
  connectionTimeoutMillis: 2000, // Timeout kết nối sau 2 giây
  keepAlive: true, // Bật keep-alive để duy trì kết nối ổn định
});

// Xử lý lỗi không mong muốn của pool
pool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client:', {
    message: err.message,
    stack: err.stack,
  });
  // Không gọi process.exit trong serverless, chỉ ghi log
});

// Kiểm tra kết nối khi khởi tạo
pool.on('connect', () => {
  logger.info('Successfully connected to PostgreSQL pool');
});

// Hàm query với đo lường thời gian và log chi tiết
export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.info(`PostgreSQL query executed in ${duration}ms`, {
      query: text,
      params: params ? params.length : 0,
    });
    return result;
  } catch (err) {
    logger.error(`PostgreSQL query error: ${err.message}`, {
      query: text,
      params,
      stack: err.stack,
    });
    throw err;
  }
}

// Kiểm tra và khởi tạo pool
export async function initializePool() {
  try {
    await pool.connect();
    logger.info('PostgreSQL pool initialized successfully');
  } catch (err) {
    logger.error('Failed to initialize PostgreSQL pool:', {
      message: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

// Đóng pool khi cần (cho script đồng bộ hoặc cleanup)
export async function closePool() {
  try {
    await pool.end();
    logger.info('PostgreSQL pool closed');
  } catch (err) {
    logger.error('Error closing PostgreSQL pool:', {
      message: err.message,
      stack: err.stack,
    });
  }
}

export default pool;