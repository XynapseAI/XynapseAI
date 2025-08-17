// utils/postgres.js
import { Pool } from 'pg';
import { logger } from './serverLogger.js';
import { parse } from 'url';

const connectionString = process.env.DATABASE_URL;
let poolConfig = { connectionString };

if (connectionString) {
  const parsedUrl = parse(connectionString);
  const [username, password] = parsedUrl.auth ? parsedUrl.auth.split(':') : [null, null];
  poolConfig = {
    user: username,
    password: password || '', // Ensure password is a string
    host: parsedUrl.hostname,
    port: parsedUrl.port || 5432,
    database: parsedUrl.pathname?.slice(1),
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    max: 40,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
} else {
  logger.error('DATABASE_URL is not set in .env');
}

const pool = new Pool(poolConfig);

async function connectWithRetry(retries = 5, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      logger.info('Successfully connected to PostgreSQL database');
      client.release();
      return true;
    } catch (error) {
      logger.error(`Failed to connect to PostgreSQL (attempt ${i + 1}/${retries}): ${error.message}`, { stack: error.stack });
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  logger.error('Failed to connect to PostgreSQL after all retries');
  return false;
}

connectWithRetry().catch((error) => {
  logger.error('Initial PostgreSQL connection failed:', { error: error.message, stack: error.stack });
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

export { pool };