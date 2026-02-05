import { db, toBigInt, type GlobalState, type Epoch } from '../db/index.js';
import { config, getQuorumPercentage, getQuorumThreshold } from '../config.js';
import { getTreasuryBalance } from '../utils/solana.js';
import {
  safeAdd,
  safeSub,
  percentage,
  calculateShare,
  isQuorumReached
} from '../utils/math.js';
import { getEligibleStakes, getTotalEligibleStake } from './staking.js';
import { fetchTotalStaked, isPoolInitialized } from '../utils/staking-program.js';

interface EpochResult {
  epochNumber: number;
  feesCollected: string;
  sharedPoolAddition: string;
  greedPotAddition: string;
  totalEligibleStake: string;
  quorumReached: boolean;
  distributed: boolean;
  distributedTo: number;
  totalDistributed: string;
}

// Get current global state
export async function getGlobalState(): Promise<GlobalState> {
  const state = await db.get<Record<string, unknown>>('SELECT * FROM global_state WHERE id = 1');
  if (!state) {
    throw new Error('Global state not initialized');
  }
  return {
    id: 1,
    current_epoch: state.current_epoch as number,
    shared_pool_lamports: toBigInt(state.shared_pool_lamports),
    greed_pot_lamports: toBigInt(state.greed_pot_lamports),
    total_staked: toBigInt(state.total_staked),
    treasury_last_balance: toBigInt(state.treasury_last_balance),
    last_updated: state.last_updated as string
  };
}

// Get current epoch info
export async function getCurrentEpoch(): Promise<Epoch | null> {
  const state = await getGlobalState();
  return await db.get<Epoch>(
    'SELECT * FROM epochs WHERE epoch_number = ?',
    [state.current_epoch]
  ) || null;
}

// Get epoch start time
export async function getEpochStartTime(): Promise<Date> {
  const epoch = await getCurrentEpoch();
  if (epoch) {
    return new Date(epoch.started_at);
  }
  return new Date();
}

// Finalize the current epoch and start a new one (only if quorum reached)
export async function finalizeEpoch(): Promise<EpochResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  // Get current treasury balance
  const currentTreasuryBalance = await getTreasuryBalance();

  const state = await getGlobalState();
  const currentEpochNumber = state.current_epoch;

  // Calculate fees received since last check
  const lastBalance = toBigInt(state.treasury_last_balance);
  const feesCollected = currentTreasuryBalance > lastBalance
    ? safeSub(currentTreasuryBalance, lastBalance)
    : 0n;

  // Split fees: 80% to shared pool, 20% to greed pot
  const sharedPoolAddition = percentage(feesCollected, config.sharedPoolPercentage);
  const greedPotAddition = percentage(feesCollected, config.greedPotPercentage);

  // Update pools with new fees
  let sharedPool = safeAdd(toBigInt(state.shared_pool_lamports), sharedPoolAddition);
  const greedPot = safeAdd(toBigInt(state.greed_pot_lamports), greedPotAddition);

  // Get eligible stakes (past warmup)
  const eligibleStakes = await getEligibleStakes();
  const totalEligibleStake = eligibleStakes.reduce((sum, s) => safeAdd(sum, s.amount), 0n);

  // Check quorum
  const quorumReached = isQuorumReached(
    totalEligibleStake,
    config.totalTokenSupply,
    getQuorumPercentage(currentEpochNumber)
  );

  let distributed = false;
  let distributedTo = 0;
  let totalDistributed = 0n;

  // Only distribute and advance epoch if quorum is reached
  if (quorumReached && sharedPool > 0n && totalEligibleStake > 0n) {
    for (const stake of eligibleStakes) {
      const reward = calculateShare(sharedPool, stake.amount, totalEligibleStake);

      if (reward > 0n) {
        // Credit reward to user's claimable balance
        await db.run(
          `UPDATE users
           SET claimable_lamports = claimable_lamports + ?,
               updated_at = ?
           WHERE id = ?`,
          [reward.toString(), nowIso, stake.userId]
        );

        // Record distribution
        await db.run(
          `INSERT INTO distributions (user_id, epoch_number, stake_amount, reward_lamports)
           VALUES (?, ?, ?, ?)`,
          [stake.userId, currentEpochNumber, stake.amount.toString(), reward.toString()]
        );

        totalDistributed = safeAdd(totalDistributed, reward);
        distributedTo++;
      }
    }

    // Clear shared pool after distribution
    sharedPool = safeSub(sharedPool, totalDistributed);
    distributed = true;

    // End current epoch and create new one (only when quorum reached)
    const newEpochNumber = currentEpochNumber + 1;

    await db.run(
      `UPDATE epochs
       SET ended_at = ?,
           fees_collected_lamports = ?,
           shared_pool_lamports = ?,
           greed_pot_addition_lamports = ?,
           total_eligible_stake = ?,
           quorum_reached = ?,
           distributed = ?
       WHERE epoch_number = ?`,
      [
        nowIso,
        feesCollected.toString(),
        sharedPoolAddition.toString(),
        greedPotAddition.toString(),
        totalEligibleStake.toString(),
        1,
        1,
        currentEpochNumber
      ]
    );

    // Create new epoch
    await db.run(
      `INSERT INTO epochs (epoch_number, started_at, treasury_balance_lamports)
       VALUES (?, ?, ?)`,
      [newEpochNumber, nowIso, currentTreasuryBalance.toString()]
    );

    // Update global state with new epoch
    await db.run(
      `UPDATE global_state
       SET current_epoch = ?,
           shared_pool_lamports = ?,
           greed_pot_lamports = ?,
           treasury_last_balance = ?,
           last_updated = ?
       WHERE id = 1`,
      [
        newEpochNumber,
        sharedPool.toString(),
        greedPot.toString(),
        currentTreasuryBalance.toString(),
        nowIso
      ]
    );

    return {
      epochNumber: newEpochNumber,
      feesCollected: feesCollected.toString(),
      sharedPoolAddition: sharedPoolAddition.toString(),
      greedPotAddition: greedPotAddition.toString(),
      totalEligibleStake: totalEligibleStake.toString(),
      quorumReached: true,
      distributed: true,
      distributedTo,
      totalDistributed: totalDistributed.toString()
    };
  }

  // Quorum not reached - just update pools and treasury balance, don't advance epoch
  await db.run(
    `UPDATE global_state
     SET shared_pool_lamports = ?,
         greed_pot_lamports = ?,
         treasury_last_balance = ?,
         last_updated = ?
     WHERE id = 1`,
    [
      sharedPool.toString(),
      greedPot.toString(),
      currentTreasuryBalance.toString(),
      nowIso
    ]
  );

  return {
    epochNumber: currentEpochNumber,
    feesCollected: feesCollected.toString(),
    sharedPoolAddition: sharedPoolAddition.toString(),
    greedPotAddition: greedPotAddition.toString(),
    totalEligibleStake: totalEligibleStake.toString(),
    quorumReached: false,
    distributed: false,
    distributedTo: 0,
    totalDistributed: '0'
  };
}

// Get epoch history
export async function getEpochHistory(limit: number = 10): Promise<Epoch[]> {
  return db.all<Epoch>(
    'SELECT * FROM epochs ORDER BY epoch_number DESC LIMIT ?',
    [limit]
  );
}

// Get time until next epoch
export async function getTimeUntilNextEpoch(): Promise<number> {
  const epochStart = await getEpochStartTime();
  const elapsed = Date.now() - epochStart.getTime();
  const remaining = config.epochDuration * 1000 - elapsed;
  return Math.max(0, remaining);
}

// Get harvest progress (percentage of quorum)
// Uses on-chain total for accurate staking data
export async function getHarvestProgress(): Promise<{
  currentStake: string;
  requiredStake: string;
  percentage: number;
  quorumPercentage: number;
}> {
  const state = await getGlobalState();
  const currentQuorumPct = getQuorumPercentage(state.current_epoch);
  const required = getQuorumThreshold(state.current_epoch);

  // Try to get on-chain total first (source of truth)
  let totalEligible = 0n;
  try {
    const poolReady = await isPoolInitialized();
    if (poolReady) {
      totalEligible = await fetchTotalStaked();
    }
  } catch (error) {
    console.error('Error fetching on-chain total:', error);
  }

  // Fall back to DB if on-chain returns 0
  if (totalEligible === 0n) {
    totalEligible = await getTotalEligibleStake();
  }

  const pct = required > 0n
    ? Math.min(100, Number((totalEligible * 100n) / required))
    : 0;

  return {
    currentStake: totalEligible.toString(),
    requiredStake: required.toString(),
    percentage: pct,
    quorumPercentage: currentQuorumPct
  };
}
