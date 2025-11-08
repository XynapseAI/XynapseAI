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

  if (!username || !password || !parsedUrl.hostname) {
    throw new Error('Invalid DATABASE_URL: missing username/password/hostname');
  }

  poolConfig = {
    user: username,
    password: password,
    host: parsedUrl.hostname,
    port: parsedUrl.port || 5432,
    database: parsedUrl.pathname?.slice(1),
    ssl: { rejectUnauthorized: false },  // Luôn dùng cho Vercel (Neon/Supabase)
    max: 10,  // Giảm để tránh overload cold start
    idleTimeoutMillis: 10000,  // Release idle nhanh
    connectionTimeoutMillis: 45000,  // TĂNG 45s cho mobile latency
    acquireTimeoutMillis: 60000,  // Thêm: timeout lấy connection từ pool
    reapIntervalMillis: 5000,  // Check dead connections thường xuyên
  };
} catch (err) {
  logger.error(`Failed to parse DATABASE_URL: ${err.message}`);
  throw err;
}

const pool = new Pool(poolConfig);

// Improved connectWithRetry: Exponential backoff, hơn retries cho cold start
async function connectWithRetry(retries = 8, baseDelay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connect timeout')), poolConfig.connectionTimeoutMillis))
      ]);
      logger.info(`PG connected successfully (attempt ${i + 1})`);
      client.release();
      return true;
    } catch (error) {
      const delay = baseDelay * Math.pow(2, i);  // 1.5s → 3s → 6s → 12s...
      logger.error(`PG connect fail (attempt ${i + 1}/${retries}): ${error.message}. Retry in ${delay}ms`, { stack: error.stack });
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  logger.error('PG connect failed after all retries');
  return false;  // Không throw, để query retry riêng
}

// Init sớm, nhưng không block
connectWithRetry().catch(err => logger.error('Initial PG fail:', { error: err.message }));

// Query với retry (wrap cho adapter)
export async function query(text, params, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Pre-check pool health
      if (i > 0) await connectWithRetry(2, 1000);  // Quick retry trước query
      const res = await pool.query(text, params);
      return res;
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.message.includes('timeout') || error.message.includes('terminated')) {
        logger.warn(`Query retry ${i + 1}/${maxRetries} (timeout-related): ${error.message}`);
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000 * (i + 1)));  // Backoff 3s, 6s...
          continue;
        }
      }
      logger.error(`Query fail after retries: ${error.message}`, { 
        text: text.substring(0, 100) + '...', 
        params: params?.map(p => typeof p === 'string' ? `${p.substring(0, 20)}...` : p) 
      });
      throw error;
    }
  }
}

export { pool };