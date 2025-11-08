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
    ssl: { rejectUnauthorized: false },  // Luôn dùng cho Vercel/Neon (bỏ check sslmode)
    max: 20,  // Giảm max để tránh overload cold start
    idleTimeoutMillis: 10000,  // Giảm idle để release nhanh
    connectionTimeoutMillis: 30000,  // TĂNG lên 30s cho mobile
    acquireTimeoutMillis: 60000,  // Thêm: timeout acquire connection
  };
} catch (err) {
  logger.error(`Failed to parse DATABASE_URL: ${err.message}`);
  throw err;
}

const pool = new Pool(poolConfig);

async function connectWithRetry(retries = 10, baseDelay = 2000) {  // Tăng retries cho cold start
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      logger.info('PG connected (attempt ' + (i + 1) + ')');
      client.release();
      return true;
    } catch (error) {
      const delay = baseDelay * Math.pow(2, i);  // Exponential: 2s, 4s, 8s...
      logger.error(`PG connect fail (attempt ${i + 1}/${retries}): ${error.message}. Retry in ${delay}ms`);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  logger.error('PG connect failed after all retries');
  throw new Error('PG connection failed');
}

connectWithRetry().catch(err => {
  logger.error('Initial PG fail:', err);
  // Fallback: Không throw để app start, retry per-query
});

export async function query(text, params, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await pool.query(text, params);
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.message.includes('timeout')) {
        logger.warn(`Query retry ${i + 1}/${maxRetries}: ${error.message}`);
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
          continue;
        }
      }
      logger.error(`Query fail: ${error.message}`, { text, params: params?.map(p => typeof p === 'string' ? p.substring(0, 50) + '...' : p) });
      throw error;
    }
  }
}

export { pool };