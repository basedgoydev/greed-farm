-- Migration: Add provably fair gambling columns to greed_history
-- This migration adds the columns needed for the commit-reveal scheme

-- Add columns to greed_history if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'greed_history' AND column_name = 'server_seed') THEN
        ALTER TABLE greed_history ADD COLUMN server_seed TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'greed_history' AND column_name = 'server_seed_hash') THEN
        ALTER TABLE greed_history ADD COLUMN server_seed_hash TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'greed_history' AND column_name = 'client_seed') THEN
        ALTER TABLE greed_history ADD COLUMN client_seed TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'greed_history' AND column_name = 'combined_hash') THEN
        ALTER TABLE greed_history ADD COLUMN combined_hash TEXT;
    END IF;
END $$;

-- Create greed_commitments table if it doesn't exist
CREATE TABLE IF NOT EXISTS greed_commitments (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_greed_commitments_wallet ON greed_commitments(wallet, used);
CREATE INDEX IF NOT EXISTS idx_greed_commitments_expires ON greed_commitments(expires_at);
