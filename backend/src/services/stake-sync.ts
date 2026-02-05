import { db, toBigInt } from '../db/index.js';
import { config } from '../config.js';
import { fetchUserStake, fetchTotalStaked, isPoolInitialized, fetchAllOnChainStakes } from '../utils/staking-program.js';
import { Connection, PublicKey } from '@solana/web3.js';

// Sync a user's stake from on-chain data
// IMPORTANT: This only ADDS on-chain stakes to DB, it does NOT deactivate custodial stakes
export async function syncUserStake(wallet: string): Promise<{
  amount: bigint;
  stakedAt: Date | null;
  isEligible: boolean;
}> {
  const onChainStake = await fetchUserStake(wallet);

  // If no on-chain stake, just return current DB state - DO NOT deactivate
  // Users may be using custodial staking (tokens sent to treasury wallet)
  if (!onChainStake || onChainStake.amount === 0n) {
    // Return DB state if exists
    const user = await db.get<{ id: number }>('SELECT id FROM users WHERE wallet = ?', [wallet]);
    if (user) {
      const dbStake = await db.get<{ amount: string; staked_at: string }>(
        'SELECT amount, staked_at FROM stakes WHERE user_id = ? AND is_active = TRUE',
        [user.id]
      );
      if (dbStake) {
        const stakedAt = new Date(dbStake.staked_at);
        const warmupEnds = new Date(stakedAt.getTime() + config.warmupDuration * 1000);
        const isEligible = new Date() >= warmupEnds;
        return {
          amount: toBigInt(dbStake.amount),
          stakedAt,
          isEligible,
        };
      }
    }
    return { amount: 0n, stakedAt: null, isEligible: false };
  }

  // Get or create user for on-chain stake
  let user = await db.get<{ id: number }>('SELECT id FROM users WHERE wallet = ?', [wallet]);
  if (!user) {
    await db.run(
      'INSERT INTO users (wallet, claimable_lamports, total_claimed_lamports, total_won_lamports, total_lost_lamports) VALUES (?, 0, 0, 0, 0)',
      [wallet]
    );
    user = await db.get<{ id: number }>('SELECT id FROM users WHERE wallet = ?', [wallet]);
  }

  const stakedAt = new Date(onChainStake.stakedAt * 1000);
  const now = new Date();
  const warmupEnds = new Date(stakedAt.getTime() + config.warmupDuration * 1000);
  const isEligible = now >= warmupEnds;

  // Update or create stake record in DB (only if on-chain stake exists)
  const existingStake = await db.get(
    'SELECT id FROM stakes WHERE user_id = ? AND is_active = TRUE',
    [user!.id]
  );

  if (existingStake) {
    await db.run(
      'UPDATE stakes SET amount = ?, staked_at = ? WHERE id = ?',
      [onChainStake.amount.toString(), stakedAt.toISOString(), (existingStake as { id: number }).id]
    );
  } else {
    await db.run(
      'INSERT INTO stakes (user_id, amount, staked_at, is_active) VALUES (?, ?, ?, TRUE)',
      [user!.id, onChainStake.amount.toString(), stakedAt.toISOString()]
    );
  }

  return {
    amount: onChainStake.amount,
    stakedAt,
    isEligible,
  };
}

// Sync total staked - prioritizes on-chain data
export async function syncTotalStaked(): Promise<bigint> {
  // Get on-chain total (source of truth for on-chain staking)
  const onChainTotal = await fetchTotalStaked();

  // Get custodial total from DB (legacy stakes not yet migrated)
  const dbTotal = await db.get<{ total: string }>(
    'SELECT COALESCE(SUM(CAST(amount AS BIGINT)), 0) as total FROM stakes WHERE is_active = TRUE'
  );
  const custodialTotal = toBigInt(dbTotal?.total || 0);

  // Use on-chain total if available, otherwise fall back to DB
  // On-chain is now the primary staking method
  const totalStaked = onChainTotal > 0n ? onChainTotal : custodialTotal;

  console.log(`[SYNC] On-chain total: ${onChainTotal}, DB total: ${custodialTotal}, Using: ${totalStaked}`);

  await db.run(
    'UPDATE global_state SET total_staked = ?, last_updated = ? WHERE id = 1',
    [totalStaked.toString(), new Date().toISOString()]
  );

  return totalStaked;
}

// Check if on-chain program is ready
export async function checkProgramReady(): Promise<boolean> {
  if (!config.tokenMint) {
    console.log('[SYNC] Token mint not configured');
    return false;
  }

  const initialized = await isPoolInitialized();
  if (!initialized) {
    console.log('[SYNC] Stake pool not initialized on-chain');
    return false;
  }

  return true;
}

// Sync ALL on-chain stakes to database
// This ensures every on-chain staker is in the DB for reward distribution
export async function syncAllOnChainStakesToDB(): Promise<number> {
  const programReady = await checkProgramReady();
  if (!programReady) {
    console.log('[SYNC] Program not ready, cannot sync on-chain stakes');
    return 0;
  }

  console.log('[SYNC] Fetching all on-chain stakes...');

  const onChainStakes = await fetchAllOnChainStakes();
  let syncedCount = 0;

  for (const stake of onChainStakes) {
    try {
      // Get or create user
      let user = await db.get<{ id: number }>('SELECT id FROM users WHERE wallet = ?', [stake.wallet]);
      if (!user) {
        await db.run(
          'INSERT INTO users (wallet, claimable_lamports, total_claimed_lamports, total_won_lamports, total_lost_lamports) VALUES (?, 0, 0, 0, 0)',
          [stake.wallet]
        );
        user = await db.get<{ id: number }>('SELECT id FROM users WHERE wallet = ?', [stake.wallet]);
        console.log(`[SYNC] Created new user for wallet ${stake.wallet}`);
      }

      const stakedAt = new Date(stake.stakedAt * 1000);

      // Check if stake already exists and update, or create new
      const existingStake = await db.get<{ id: number; amount: string }>(
        'SELECT id, amount FROM stakes WHERE user_id = ? AND is_active = TRUE',
        [user!.id]
      );

      if (existingStake) {
        // Update if amount changed
        if (toBigInt(existingStake.amount) !== stake.amount) {
          await db.run(
            'UPDATE stakes SET amount = ?, staked_at = ? WHERE id = ?',
            [stake.amount.toString(), stakedAt.toISOString(), existingStake.id]
          );
          console.log(`[SYNC] Updated stake for ${stake.wallet}: ${stake.amount}`);
        }
      } else {
        // Create new stake record
        await db.run(
          'INSERT INTO stakes (user_id, amount, staked_at, is_active) VALUES (?, ?, ?, TRUE)',
          [user!.id, stake.amount.toString(), stakedAt.toISOString()]
        );
        console.log(`[SYNC] Created stake for ${stake.wallet}: ${stake.amount}`);
      }

      syncedCount++;
    } catch (error) {
      console.error(`[SYNC] Error syncing stake for ${stake.wallet}:`, error);
    }
  }

  console.log(`[SYNC] Synced ${syncedCount} on-chain stakes to DB`);
  return syncedCount;
}

// Sync stakes - updates total from both on-chain and DB
export async function syncAllStakes(): Promise<void> {
  const programReady = await checkProgramReady();
  if (!programReady) {
    console.log('[SYNC] Program not ready, syncing from DB only');
  }

  console.log('[SYNC] Syncing stakes...');

  // Sync all on-chain stakes to DB first
  await syncAllOnChainStakesToDB();

  // Sync total staked (combines on-chain + DB)
  await syncTotalStaked();

  console.log('[SYNC] Stake sync complete');
}

// Start periodic sync job
let syncInterval: NodeJS.Timeout | null = null;

export function startStakeSync(intervalMs: number = 60000): void {
  if (syncInterval) {
    clearInterval(syncInterval);
  }

  console.log(`[SYNC] Starting stake sync job (every ${intervalMs / 1000}s)`);

  // Initial sync after 5 seconds
  setTimeout(() => {
    syncAllStakes().catch(console.error);
  }, 5000);

  // Periodic sync
  syncInterval = setInterval(() => {
    syncAllStakes().catch(console.error);
  }, intervalMs);
}

export function stopStakeSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
