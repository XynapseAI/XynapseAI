// utils/initDb.js
import { query } from './postgres.js';
import { logger } from '../utils/serverLogger.js';

export async function initializeDatabase() {
  try {
    // blockchain_cache
    await query(`
      CREATE TABLE IF NOT EXISTS blockchain_cache (
        id VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);

    // api_keys
    await query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        api_key VARCHAR(255) PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        active BOOLEAN NOT NULL
      );
    `);

    // eth_price
    await query(`
      CREATE TABLE IF NOT EXISTS eth_price (
        id VARCHAR(255) PRIMARY KEY,
        price NUMERIC NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);

    // pending_wallets_to_analyze
    await query(`
      CREATE TABLE IF NOT EXISTS pending_wallets_to_analyze (
        address VARCHAR(42) PRIMARY KEY,
        primary_wallet VARCHAR(42) NOT NULL,
        primary_wallet_name TEXT,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_wallets_address ON pending_wallets_to_analyze (address);
    `);

    // wallet_analysis
    await query(`
      CREATE TABLE IF NOT EXISTS wallet_analysis (
        wallet VARCHAR(42) PRIMARY KEY,
        is_deposit BOOLEAN NOT NULL,
        deposit_confidence_percentage NUMERIC,
        nametag TEXT,
        image TEXT,
        reason TEXT,
        metrics JSONB,
        gemini_analysis TEXT,
        last_analysis TIMESTAMP WITH TIME ZONE
      );
    `);

    // nametags
    await query(`
      CREATE TABLE IF NOT EXISTS nametags (
        address VARCHAR(42) PRIMARY KEY,
        nametag TEXT,
        image TEXT,
        description TEXT,
        subcategory TEXT
      );
    `);

    // large_flows
    await query(`
      CREATE TABLE IF NOT EXISTS large_flows (
        source_wallet_scanned VARCHAR(42),
        from_address VARCHAR(42),
        to_address VARCHAR(42),
        value_usd NUMERIC,
        tx_hash TEXT,
        block_time TIMESTAMP WITH TIME ZONE,
        from_nametag TEXT,
        to_nametag TEXT,
        timestamp_recorded TIMESTAMP WITH TIME ZONE
      );
    `);

    // admins
    await query(`
      CREATE TABLE IF NOT EXISTS admins (
        uid VARCHAR(255) PRIMARY KEY,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE
      );
    `);

    logger.info('Successfully initialized all database tables.');
  } catch (error) {
    logger.error(`Error initializing database tables: ${error.message}`, { stack: error.stack });
    throw error;
  }
}