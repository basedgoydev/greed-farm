// Database Schema for Greed Farm
// Supports both SQLite (dev) and PostgreSQL (production)

export const schema = `
-- Users table: stores wallet addresses and claimable balances
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE NOT NULL,
  claimable_lamports BIGINT DEFAULT 0,
  total_claimed_lamports BIGINT DEFAULT 0,
  total_won_lamports BIGINT DEFAULT 0,
  total_lost_lamports BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stakes table: active stakes with warmup tracking
CREATE TABLE IF NOT EXISTS stakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount BIGINT NOT NULL,
  staked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  unstaked_at TIMESTAMP,
  UNIQUE(user_id, is_active) -- Only one active stake per user
);

-- Epochs table: tracks each 15-minute epoch
CREATE TABLE IF NOT EXISTS epochs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epoch_number INTEGER UNIQUE NOT NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  treasury_balance_lamports BIGINT DEFAULT 0,
  fees_collected_lamports BIGINT DEFAULT 0,
  shared_pool_lamports BIGINT DEFAULT 0,
  greed_pot_addition_lamports BIGINT DEFAULT 0,
  total_eligible_stake BIGINT DEFAULT 0,
  quorum_reached BOOLEAN DEFAULT FALSE,
  distributed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Global state: tracks pools and current epoch
CREATE TABLE IF NOT EXISTS global_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_epoch INTEGER DEFAULT 0,
  shared_pool_lamports BIGINT DEFAULT 0,
  greed_pot_lamports BIGINT DEFAULT 0,
  total_staked BIGINT DEFAULT 0,
  treasury_last_balance BIGINT DEFAULT 0,
  quorum_reached_at TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table: idempotent action tracking
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id TEXT UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  amount_lamports BIGINT,
  status TEXT DEFAULT 'pending',
  solana_signature TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Greed history: tracks all greed gambles
CREATE TABLE IF NOT EXISTS greed_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  epoch_number INTEGER NOT NULL,
  risk_lamports BIGINT NOT NULL,
  risk_percentage INTEGER NOT NULL,
  won BOOLEAN NOT NULL,
  payout_lamports BIGINT DEFAULT 0,
  server_seed TEXT,
  server_seed_hash TEXT,
  client_seed TEXT,
  combined_hash TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Distribution history: tracks reward distributions per user per epoch
CREATE TABLE IF NOT EXISTS distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  epoch_number INTEGER NOT NULL,
  stake_amount BIGINT NOT NULL,
  reward_lamports BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, epoch_number)
);

-- Greed commitments table for provably fair gambling (persisted)
CREATE TABLE IF NOT EXISTS greed_commitments (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_greed_commitments_wallet ON greed_commitments(wallet, used);
CREATE INDEX IF NOT EXISTS idx_greed_commitments_expires ON greed_commitments(expires_at);
CREATE INDEX IF NOT EXISTS idx_stakes_user_active ON stakes(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_stakes_staked_at ON stakes(staked_at);
CREATE INDEX IF NOT EXISTS idx_transactions_tx_id ON transactions(tx_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_greed_history_user ON greed_history(user_id);
CREATE INDEX IF NOT EXISTS idx_distributions_user ON distributions(user_id);

-- Initialize global state if not exists (start at epoch 1)
INSERT OR IGNORE INTO global_state (id, current_epoch, shared_pool_lamports, greed_pot_lamports, total_staked, treasury_last_balance)
VALUES (1, 1, 0, 0, 0, 0);
`;

// PostgreSQL version with different syntax
export const schemaPostgres = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  wallet TEXT UNIQUE NOT NULL,
  claimable_lamports BIGINT DEFAULT 0,
  total_claimed_lamports BIGINT DEFAULT 0,
  total_won_lamports BIGINT DEFAULT 0,
  total_lost_lamports BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stakes table
CREATE TABLE IF NOT EXISTS stakes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount BIGINT NOT NULL,
  staked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  unstaked_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stakes_user_active_unique
ON stakes(user_id) WHERE is_active = TRUE;

-- Epochs table
CREATE TABLE IF NOT EXISTS epochs (
  id SERIAL PRIMARY KEY,
  epoch_number INTEGER UNIQUE NOT NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  treasury_balance_lamports BIGINT DEFAULT 0,
  fees_collected_lamports BIGINT DEFAULT 0,
  shared_pool_lamports BIGINT DEFAULT 0,
  greed_pot_addition_lamports BIGINT DEFAULT 0,
  total_eligible_stake BIGINT DEFAULT 0,
  quorum_reached BOOLEAN DEFAULT FALSE,
  distributed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Global state
CREATE TABLE IF NOT EXISTS global_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_epoch INTEGER DEFAULT 0,
  shared_pool_lamports BIGINT DEFAULT 0,
  greed_pot_lamports BIGINT DEFAULT 0,
  total_staked BIGINT DEFAULT 0,
  treasury_last_balance BIGINT DEFAULT 0,
  quorum_reached_at TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  tx_id TEXT UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  amount_lamports BIGINT,
  status TEXT DEFAULT 'pending',
  solana_signature TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Greed history
CREATE TABLE IF NOT EXISTS greed_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  epoch_number INTEGER NOT NULL,
  risk_lamports BIGINT NOT NULL,
  risk_percentage INTEGER NOT NULL,
  won BOOLEAN NOT NULL,
  payout_lamports BIGINT DEFAULT 0,
  server_seed TEXT,
  server_seed_hash TEXT,
  client_seed TEXT,
  combined_hash TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Distributions
CREATE TABLE IF NOT EXISTS distributions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  epoch_number INTEGER NOT NULL,
  stake_amount BIGINT NOT NULL,
  reward_lamports BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, epoch_number)
);

-- Greed commitments table for provably fair gambling (persisted)
CREATE TABLE IF NOT EXISTS greed_commitments (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_greed_commitments_wallet ON greed_commitments(wallet, used);
CREATE INDEX IF NOT EXISTS idx_greed_commitments_expires ON greed_commitments(expires_at);
CREATE INDEX IF NOT EXISTS idx_stakes_user_active ON stakes(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_stakes_staked_at ON stakes(staked_at);
CREATE INDEX IF NOT EXISTS idx_transactions_tx_id ON transactions(tx_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_greed_history_user ON greed_history(user_id);
CREATE INDEX IF NOT EXISTS idx_distributions_user ON distributions(user_id);

-- Initialize global state (start at epoch 1)
INSERT INTO global_state (id, current_epoch, shared_pool_lamports, greed_pot_lamports, total_staked, treasury_last_balance)
VALUES (1, 1, 0, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;
`;
