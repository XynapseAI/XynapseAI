// utils/postgres.js
import { Pool } from 'pg';
import pkg from './logger.cjs';

const { logger } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Cần điều chỉnh tùy theo cấu hình
  }
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client:', err.message, { stack: err.stack });
  process.exit(-1);
});

export async function query(text, params) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    logger.error(`PostgreSQL query error: ${err.message}`, { query: text, params, stack: err.stack });
    throw err;
  }
}

export default pool;