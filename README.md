# GreedFi

A Solana staking protocol with provably fair gambling mechanics.

## Overview

GreedFi rewards stakers with real SOL from protocol fees. No minting, no inflation - just pure redistribution.

### Features

- **Staking** - Lock tokens to earn proportional SOL rewards
- **Epoch System** - Rewards distributed every 15 minutes
- **Dynamic Quorum** - Required stake scales with protocol maturity (7% → 14% → 21%)
- **Greed Pot** - Risk your rewards for a chance to double them (provably fair)
- **Leaderboard** - Track top performers in real-time

### Fee Distribution

| Pool | Share |
|------|-------|
| Stakers | 80% |
| Greed Pot | 20% |

### How It Works

1. **Stake** your tokens (5 min warmup)
2. **Earn** SOL rewards each epoch
3. **Claim** anytime without unstaking
4. **Greed** - gamble rewards for bigger wins

## Stack

- **Frontend**: Next.js, TailwindCSS, Solana Wallet Adapter
- **Backend**: Express.js, PostgreSQL
- **Blockchain**: Solana

## Links

- [Twitter](https://x.com/GreedFiSOL/)

## License

MIT
