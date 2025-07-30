-- prisma/migrations/0_init/migration.sql
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  google_id VARCHAR(255) UNIQUE,
  profile_picture TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  google_name VARCHAR(255),
  wallet_address VARCHAR(255),
  points BIGINT DEFAULT 0,
  tweet_points BIGINT DEFAULT 0,
  ai_points BIGINT DEFAULT 0,
  task_points BIGINT DEFAULT 0,
  is_creator BOOLEAN DEFAULT FALSE,
  is_ai_rank BOOLEAN DEFAULT FALSE,
  tier VARCHAR(50) DEFAULT 'Basic',
  is_plus BOOLEAN DEFAULT FALSE,
  is_premium BOOLEAN DEFAULT FALSE,
  premium_expires_at TIMESTAMP,
  api_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP,
  last_connected TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
  uid VARCHAR(100) PRIMARY KEY,
  is_admin BOOLEAN
);

CREATE TABLE IF NOT EXISTS api_keys (
  api_key VARCHAR(64) PRIMARY KEY,
  created_at TIMESTAMP,
  expires_at TIMESTAMP,
  active BOOLEAN
);

CREATE TABLE IF NOT EXISTS blockchain_cache (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_ai_interactions (
  id VARCHAR(255) PRIMARY KEY,
  uid VARCHAR(100),
  date DATE NOT NULL,
  interaction_type VARCHAR(50),
  count INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eth_price (
  id VARCHAR(10) PRIMARY KEY,
  price DECIMAL,
  timestamp TIMESTAMP
);

CREATE TABLE IF NOT EXISTS large_flows (
  id SERIAL PRIMARY KEY,
  source_wallet_scanned VARCHAR(42),
  from_address VARCHAR(42),
  to_address VARCHAR(42),
  value_usd DECIMAL,
  tx_hash VARCHAR(66),
  block_time TIMESTAMP,
  from_nametag TEXT,
  to_nametag TEXT,
  timestamp_recorded TIMESTAMP,
  chain VARCHAR(50) DEFAULT 'ethereum'
);

CREATE TABLE IF NOT EXISTS nametags (
  address VARCHAR(42) PRIMARY KEY,
  nametag TEXT NOT NULL,
  image TEXT DEFAULT '/icons/default.png',
  description TEXT DEFAULT '',
  subcategory TEXT DEFAULT 'Others'
);

CREATE TABLE IF NOT EXISTS nametags_metadata (
  file_name VARCHAR(255) PRIMARY KEY,
  last_modified TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_wallets_to_analyze (
  address VARCHAR(42) PRIMARY KEY,
  primary_wallet VARCHAR(42),
  primary_wallet_name TEXT,
  timestamp TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_completions (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(100),
  task_id VARCHAR(50),
  completed_at DATE NOT NULL,
  completion_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(50) PRIMARY KEY,
  points INTEGER NOT NULL,
  is_daily BOOLEAN DEFAULT TRUE,
  max_completions INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tweet_analyses (
  id VARCHAR(100) PRIMARY KEY,
  user_id VARCHAR(100),
  tweet_id VARCHAR(100),
  text TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_analysis (
  wallet VARCHAR(42) PRIMARY KEY,
  is_deposit BOOLEAN,
  deposit_confidence_percentage INTEGER,
  nametag TEXT,
  image TEXT,
  reason TEXT,
  metrics JSONB,
  gemini_analysis TEXT,
  last_analysis TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_histories (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100),
  wallet_address VARCHAR(42),
  action VARCHAR(50),
  data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlists (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  name VARCHAR(255) DEFAULT 'Unnamed Wallet',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_user_wallet UNIQUE (user_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_admins_uid ON admins (uid);
CREATE INDEX IF NOT EXISTS idx_blockchain_cache_id ON blockchain_cache (id);
CREATE INDEX IF NOT EXISTS idx_daily_ai_interactions_date ON daily_ai_interactions (date);
CREATE INDEX IF NOT EXISTS idx_daily_ai_interactions_interaction_type ON daily_ai_interactions (interaction_type);
CREATE INDEX IF NOT EXISTS idx_daily_ai_interactions_uid ON daily_ai_interactions (uid);
CREATE INDEX IF NOT EXISTS idx_large_flows_source_wallet ON large_flows (source_wallet_scanned);
CREATE INDEX IF NOT EXISTS idx_large_flows_tx_hash ON large_flows (tx_hash);
CREATE INDEX IF NOT EXISTS idx_nametags_address ON nametags (address);
CREATE INDEX IF NOT EXISTS idx_pending_wallets_address ON pending_wallets_to_analyze (address);
CREATE INDEX IF NOT EXISTS idx_task_completions_completed_at ON task_completions (completed_at);
CREATE INDEX IF NOT EXISTS idx_task_completions_task_id ON task_completions (task_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_user_id ON task_completions (user_id);
CREATE INDEX IF NOT EXISTS idx_tweet_analyses_tweet_id ON tweet_analyses (tweet_id);
CREATE INDEX IF NOT EXISTS idx_tweet_analyses_user_id ON tweet_analyses (user_id);
CREATE INDEX IF NOT EXISTS idx_users_ai_points ON users (ai_points);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_points ON users (points);
CREATE INDEX IF NOT EXISTS idx_users_task_points ON users (task_points);
CREATE INDEX IF NOT EXISTS idx_users_tweet_points ON users (tweet_points);
CREATE INDEX IF NOT EXISTS idx_wallet_analysis_wallet ON wallet_analysis (wallet);
CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists (user_id);