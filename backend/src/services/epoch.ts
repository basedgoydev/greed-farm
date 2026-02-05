import { db, toBigInt, type GlobalState, type Epoch } from '../db/index.js';
import { config, getQuorumPercentage, getQuorumThreshold } from '../config.js';
import { getTreasuryBalance } from '../utils/solana.js';
import {
  safeAdd,
  safeSub,
  percentage,
  calculateShare
} from '../utils/math.js';
import { getEligibleStakes, getTotalEligibleStake } from './staking.js';
import { fetchTotalStaked, isPoolInitialized } from '../utils/staking-program.js';
import { syncAllOnChainStakesToDB } from './stake-sync.js';

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
    quorum_reached_at: state.quorum_reached_at as string | null,
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

// Check and update quorum status - called frequently to track when quorum is reached
export async function checkAndUpdateQuorum(): Promise<{
  quorumReached: boolean;
  quorumReachedAt: string | null;
  countdownActive: boolean;
  countdownRemaining: number;
}> {
  const now = new Date();
  const nowIso = now.toISOString();
  const state = await getGlobalState();

  // Sync on-chain stakes to DB
  await syncAllOnChainStakesToDB();

  // Get eligible stake total
  let totalEligibleStake = 0n;
  try {
    const poolReady = await isPoolInitialized();
    if (poolReady) {
      totalEligibleStake = await fetchTotalStaked();
    }
  } catch (error) {
    console.error('[EPOCH] Error fetching on-chain total:', error);
  }

  // Fall back to DB if needed
  if (totalEligibleStake === 0n) {
    totalEligibleStake = await getTotalEligibleStake();
  }

  const quorumThreshold = getQuorumThreshold(state.current_epoch);
  const quorumReached = totalEligibleStake >= quorumThreshold;

  let quorumReachedAt = state.quorum_reached_at;
  let countdownActive = false;
  let countdownRemaining = 0;

  if (quorumReached) {
    // Quorum is reached
    if (!quorumReachedAt) {
      // First time quorum reached - start countdown
      quorumReachedAt = nowIso;
      await db.run(
        'UPDATE global_state SET quorum_reached_at = ?, last_updated = ? WHERE id = 1',
        [quorumReachedAt, nowIso]
      );
      console.log(`[EPOCH] Quorum reached! Countdown started at ${quorumReachedAt}`);
    }

    // Calculate countdown remaining
    const quorumTime = new Date(quorumReachedAt).getTime();
    const elapsed = now.getTime() - quorumTime;
    countdownRemaining = Math.max(0, config.epochDuration * 1000 - elapsed);
    countdownActive = countdownRemaining > 0;
  } else {
    // Quorum not reached - reset countdown if it was active
    if (quorumReachedAt) {
      await db.run(
        'UPDATE global_state SET quorum_reached_at = NULL, last_updated = ? WHERE id = 1',
        [nowIso]
      );
      console.log('[EPOCH] Quorum lost - countdown reset');
    }
    quorumReachedAt = null;
  }

  return {
    quorumReached,
    quorumReachedAt,
    countdownActive,
    countdownRemaining
  };
}

// Finalize the current epoch and start a new one (only if quorum reached AND countdown complete)
export async function finalizeEpoch(): Promise<EpochResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  // IMPORTANT: Sync all on-chain stakes to DB BEFORE distribution
  // This ensures every on-chain staker is in the database and gets rewards
  console.log('[EPOCH] Syncing all on-chain stakes to DB before distribution...');
  await syncAllOnChainStakesToDB();

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

  // Get eligible stakes (past warmup) - check on-chain first
  let totalEligibleStake = 0n;
  let eligibleStakes: Array<{ userId: number; wallet: string; amount: bigint }> = [];

  try {
    const poolReady = await isPoolInitialized();
    if (poolReady) {
      totalEligibleStake = await fetchTotalStaked();
    }
  } catch (error) {
    console.error('[EPOCH] Error fetching on-chain total:', error);
  }

  // Get DB eligible stakes for distribution (these are synced from on-chain)
  eligibleStakes = await getEligibleStakes();
  const dbEligibleTotal = eligibleStakes.reduce((sum, s) => safeAdd(sum, s.amount), 0n);

  // Use the higher of on-chain or DB total for quorum check
  if (dbEligibleTotal > totalEligibleStake) {
    totalEligibleStake = dbEligibleTotal;
  }

  // Check quorum using corrected threshold (includes decimals)
  const quorumThreshold = getQuorumThreshold(currentEpochNumber);
  const quorumReached = totalEligibleStake >= quorumThreshold;

  console.log(`[EPOCH] On-chain stake: ${totalEligibleStake}, DB eligible: ${dbEligibleTotal}, Threshold: ${quorumThreshold}, Quorum: ${quorumReached}`);

  // Check if countdown is complete
  let countdownComplete = false;
  if (quorumReached && state.quorum_reached_at) {
    const quorumTime = new Date(state.quorum_reached_at).getTime();
    const elapsed = now.getTime() - quorumTime;
    countdownComplete = elapsed >= config.epochDuration * 1000;
    console.log(`[EPOCH] Countdown: ${elapsed}ms elapsed, ${config.epochDuration * 1000}ms required, complete: ${countdownComplete}`);
  } else if (quorumReached && !state.quorum_reached_at) {
    // Quorum just reached - set timestamp and wait for countdown
    await db.run(
      'UPDATE global_state SET quorum_reached_at = ?, last_updated = ? WHERE id = 1',
      [nowIso, nowIso]
    );
    console.log('[EPOCH] Quorum just reached - countdown started, will distribute after countdown completes');
  }

  let distributed = false;
  let distributedTo = 0;
  let totalDistributed = 0n;

  // Only distribute if quorum reached AND countdown complete
  if (quorumReached && countdownComplete && sharedPool > 0n && dbEligibleTotal > 0n) {
    // Use DB total for distribution (these are the users we can actually pay)
    // On-chain total is used for quorum check only
    for (const stake of eligibleStakes) {
      const reward = calculateShare(sharedPool, stake.amount, dbEligibleTotal);

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

    console.log(`[EPOCH] Distributed ${totalDistributed} lamports to ${distributedTo} stakers (pool denominator: ${dbEligibleTotal})`);

    // End current epoch and create new one
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

    // Update global state - reset quorum_reached_at for new epoch
    await db.run(
      `UPDATE global_state
       SET current_epoch = ?,
           shared_pool_lamports = ?,
           greed_pot_lamports = ?,
           treasury_last_balance = ?,
           quorum_reached_at = NULL,
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

  // Quorum not reached OR countdown not complete - just update pools and treasury balance
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
    quorumReached,
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

// Get time until next epoch (countdown from when quorum was reached)
export async function getTimeUntilNextEpoch(): Promise<number> {
  const state = await getGlobalState();

  // If quorum not reached yet, return -1 to indicate no countdown
  if (!state.quorum_reached_at) {
    return -1;
  }

  const quorumTime = new Date(state.quorum_reached_at).getTime();
  const elapsed = Date.now() - quorumTime;
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
