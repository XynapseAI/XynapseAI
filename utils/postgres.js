import { Pool } from 'pg';
import { logger } from './serverLogger.js';
import { parse } from 'url';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  logger.error('DATABASE_URL is not set in .env');
  throw new Error('DATABASE_URL is required');
}

let poolConfig;
try {
  const parsedUrl = parse(connectionString);
  const [username, password] = parsedUrl.auth ? parsedUrl.auth.split(':') : [null, null];

  if (!username || !password) {
    logger.error('Invalid DATABASE_URL: missing username or password');
    throw new Error('Invalid DATABASE_URL: username and password are required');
  }

  if (!parsedUrl.hostname) {
    logger.error('Invalid DATABASE_URL: missing hostname');
    throw new Error('Invalid DATABASE_URL: hostname is required');
  }

  poolConfig = {
    user: username,
    password: password,
    host: parsedUrl.hostname,
    port: parsedUrl.port || 5432,
    database: parsedUrl.pathname?.slice(1),
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    max: 40,
    idleTimeoutMillis: 60000,  // FIXED: Increased from 30000 for mobile latency tolerance
    connectionTimeoutMillis: 20000,  // FIXED: Increased from 10000 for better timeout handling
  };
} catch (err) {
  logger.error(`Failed to parse DATABASE_URL: ${err.message}`);
  throw err;
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
  throw new Error('Failed to connect to PostgreSQL after all retries');
}

connectWithRetry().catch((error) => {
  logger.error('Initial PostgreSQL connection failed:', { error: error.message, stack: error.message });
});

// FIXED: Wrapped query with retry for timeout/conn errors (e.g., mobile latency)
export async function query(text, params) {
  let retries = 0;
  const maxRetries = 5;
  while (retries < maxRetries) {
    try {
      const res = await pool.query(text, params);
      return res;
    } catch (error) {
      logger.error(`Query error (attempt ${retries + 1}/${maxRetries}): ${error.message}`, { stack: error.stack, query: text, params });
      if (
        (error.code === 'ECONNRESET' || error.message.includes('timeout') || error.message.includes('Connection terminated')) &&
        retries < maxRetries - 1
      ) {
        retries++;
        const backoffDelay = 1000 * Math.pow(2, retries);  // Exponential backoff: 2s, 4s, 8s, etc.
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        continue;
      }
      // If not retryable or max retries exceeded, re-throw
      throw error;
    }
  }
  throw new Error('DB query failed after all retries');
}

export { pool };