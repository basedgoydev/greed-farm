#!/bin/bash

# GreedFi Staking Program Deployment Script
# This script builds and deploys the Anchor program to Solana mainnet

set -e

echo "=========================================="
echo "  GreedFi Staking Program Deployment"
echo "=========================================="

# Check dependencies
command -v anchor >/dev/null 2>&1 || { echo "Anchor CLI not installed. Install with: cargo install --git https://github.com/coral-xyz/anchor avm --locked --force && avm install latest && avm use latest"; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "Solana CLI not installed. Install from: https://docs.solana.com/cli/install-solana-cli-tools"; exit 1; }

# Configuration
NETWORK=${1:-mainnet-beta}
echo "Network: $NETWORK"

# Set Solana config
echo "Setting Solana network to $NETWORK..."
solana config set --url $NETWORK

# Check wallet balance
BALANCE=$(solana balance | awk '{print $1}')
echo "Wallet balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo "WARNING: Low balance. Program deployment requires ~2 SOL"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Navigate to project root
cd "$(dirname "$0")/.."

# Build the program
echo "Building program..."
anchor build

# Get program keypair
PROGRAM_KEYPAIR="target/deploy/greed_staking-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
    echo "Generating new program keypair..."
    solana-keygen new -o "$PROGRAM_KEYPAIR" --no-bip39-passphrase
fi

# Get program ID
PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "Program ID: $PROGRAM_ID"

# Update program ID in lib.rs
echo "Updating program ID in source..."
sed -i "s/declare_id!(\".*\")/declare_id!(\"$PROGRAM_ID\")/" programs/greed-staking/src/lib.rs

# Update Anchor.toml
echo "Updating Anchor.toml..."
sed -i "s/greed_staking = \".*\"/greed_staking = \"$PROGRAM_ID\"/" Anchor.toml

# Rebuild with correct program ID
echo "Rebuilding with correct program ID..."
anchor build

# Deploy
echo "Deploying program..."
anchor deploy --provider.cluster $NETWORK

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "Program ID: $PROGRAM_ID"
echo ""
echo "Next steps:"
echo "1. Add to backend/.env:"
echo "   STAKING_PROGRAM_ID=$PROGRAM_ID"
echo ""
echo "2. Add to frontend/.env.local:"
echo "   NEXT_PUBLIC_STAKING_PROGRAM_ID=$PROGRAM_ID"
echo ""
echo "3. Initialize the stake pool by running:"
echo "   npx ts-node scripts/init-pool.ts"
echo ""
