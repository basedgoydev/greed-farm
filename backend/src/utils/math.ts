/**
 * Safe math utilities for bigint operations
 * Ensures no overflow, underflow, or negative results for lamport calculations
 */

// Minimum value is 0 for all lamport amounts
export function safeSub(a: bigint, b: bigint): bigint {
  const result = a - b;
  return result < 0n ? 0n : result;
}

// Safe addition with overflow protection
export function safeAdd(a: bigint, b: bigint): bigint {
  const result = a + b;
  if (result < a || result < b) {
    throw new Error('Overflow in addition');
  }
  return result;
}

// Safe multiplication
export function safeMul(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  const result = a * b;
  if (result / a !== b) {
    throw new Error('Overflow in multiplication');
  }
  return result;
}

// Safe division (returns 0 if divisor is 0)
export function safeDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  return a / b;
}

// Calculate percentage (returns integer lamports)
export function percentage(amount: bigint, percent: number): bigint {
  if (percent <= 0) return 0n;
  if (percent >= 100) return amount;
  return (amount * BigInt(percent)) / 100n;
}

// Calculate share of pool based on stake ratio
export function calculateShare(pool: bigint, userStake: bigint, totalStake: bigint): bigint {
  if (totalStake === 0n || userStake === 0n || pool === 0n) return 0n;
  // Use higher precision calculation to minimize rounding errors
  return (pool * userStake) / totalStake;
}

// Calculate greed payout with cap to ensure solvency
export function calculateGreedPayout(
  riskAmount: bigint,
  greedPot: bigint,
  won: boolean
): { payout: bigint; newGreedPot: bigint } {
  if (!won) {
    // User lost - risk goes to greed pot
    return {
      payout: 0n,
      newGreedPot: safeAdd(greedPot, riskAmount)
    };
  }

  // User won - payout is capped at greed pot to maintain solvency
  // Base payout is 2x the risk (100% bonus)
  const maxPayout = greedPot;
  const desiredPayout = riskAmount; // Bonus = risk amount (not 2x, just the bonus)

  const actualPayout = desiredPayout > maxPayout ? maxPayout : desiredPayout;

  return {
    payout: actualPayout,
    newGreedPot: safeSub(greedPot, actualPayout)
  };
}

// Format lamports to SOL string
export function lamportsToSol(lamports: bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  return sol.toFixed(9);
}

// Parse SOL string to lamports
export function solToLamports(sol: string | number): bigint {
  const solNum = typeof sol === 'string' ? parseFloat(sol) : sol;
  return BigInt(Math.floor(solNum * 1_000_000_000));
}

// Check if quorum is reached
export function isQuorumReached(totalStaked: bigint, totalSupply: bigint, quorumPercent: number): boolean {
  const threshold = (totalSupply * BigInt(quorumPercent)) / 100n;
  return totalStaked >= threshold;
}

// Calculate time until next epoch
export function timeUntilNextEpoch(epochStartTime: Date, epochDuration: number): number {
  const now = Date.now();
  const epochStart = epochStartTime.getTime();
  const elapsed = now - epochStart;
  const remaining = epochDuration * 1000 - elapsed;
  return Math.max(0, remaining);
}

// Check if stake has passed warmup period
export function isWarmupComplete(stakedAt: Date, warmupDuration: number): boolean {
  const now = Date.now();
  const stakeTime = stakedAt.getTime();
  return (now - stakeTime) >= warmupDuration * 1000;
}
