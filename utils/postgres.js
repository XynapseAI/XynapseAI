// utils/postgres.js
import dotenv from 'dotenv';
dotenv.config();
import { Pool } from 'pg';
import pkg from './logger.cjs';

const { logger } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    logger.error(`Failed to connect to PostgreSQL: ${err.message}`, { stack: err.stack });
    return;
  }
  logger.info('Successfully connected to PostgreSQL database');
  release();
});

export async function query(text, params) {
  try {
    const res = await pool.query(text, params);
    logger.info(`Query executed: ${text}`);
    return res;
  } catch (error) {
    logger.error(`Query error: ${error.message}`, { stack: error.stack });
    throw error;
  }
}