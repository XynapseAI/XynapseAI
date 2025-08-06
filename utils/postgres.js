import { Pool } from 'pg';
import { logger } from './serverLogger.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  max: 40, // Maximum number of connections
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 10000, // Timeout for acquiring a connection
});

// Retry connection with exponential backoff
async function connectWithRetry(retries = 5, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      logger.info('Successfully connected to PostgreSQL database');
      client.release();
      return;
    } catch (error) {
      logger.error(`Failed to connect to PostgreSQL (attempt ${i + 1}/${retries}): ${error.message}`, { stack: error.stack });
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  logger.error('Failed to connect to PostgreSQL after all retries');
  throw new Error('Unable to connect to PostgreSQL');
}

// Initialize connection
connectWithRetry().catch((error) => {
  logger.error('Initial PostgreSQL connection failed:', { error: error.message, stack: error.stack });
  process.exit(1); // Exit if connection fails on startup
});

export async function query(text, params) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (error) {
    logger.error(`Query error: ${error.message}`, { stack: error.stack, query: text, params });
    throw error;
  }
}

export { pool }; // Export pool for advanced use cases (e.g., transactions)