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
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
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