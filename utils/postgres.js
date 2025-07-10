// utils/postgres.js
import pkg from 'pg';
import winston from 'winston';

const { Pool } = pkg;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

const poolConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT) || 5432,
  user: process.env.POSTGRES_USER || 'xynapseai_user',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'xynapseai',
};

if (!poolConfig.password) {
  logger.error('POSTGRES_PASSWORD is not defined in .env');
  process.exit(1);
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error:', { message: err.message, stack: err.stack });
});

export async function query(text, params) {
  try {
    const result = await pool.query(text, params);
    logger.info('Query executed successfully:', { query: text, params });
    return result;
  } catch (error) {
    logger.error(`Query error: ${text}, error: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

// Test connection
(async () => {
  try {
    await pool.query('SELECT NOW()');
    logger.info('PostgreSQL connection established');
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL:', { message: error.message, stack: error.stack });
    process.exit(1);
  }
})();