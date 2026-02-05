import { db, toBigInt } from '../db/index.js';
import { config } from '../config.js';
import { fetchUserStake, fetchTotalStaked, isPoolInitialized } from '../utils/staking-program.js';
import { Connection, PublicKey } from '@solana/web3.js';

// Sync a user's stake from on-chain data
export async function syncUserStake(wallet: string): Promise<{
  amount: bigint;
  stakedAt: Date | null;
  isEligible: boolean;
}> {
  const onChainStake = await fetchUserStake(wallet);

  if (!onChainStake || onChainStake.amount === 0n) {
    // No on-chain stake - update DB if needed
    const user = await db.get<{ id: number }>('SELECT id FROM users WHERE wallet = ?', [wallet]);
    if (user) {
      await db.run(
        'UPDATE stakes SET is_active = FALSE, unstaked_at = ? WHERE user_id = ? AND is_active = TRUE',
        [new Date().toISOString(), user.id]
      );
    }
    return { amount: 0n, stakedAt: null, isEligible: false };
  }

  // Get or create user
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

  // Update or create stake record in DB
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

// Sync total staked from on-chain
export async function syncTotalStaked(): Promise<bigint> {
  const totalStaked = await fetchTotalStaked();

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

// Sync all known users' stakes from chain
export async function syncAllStakes(): Promise<void> {
  const programReady = await checkProgramReady();
  if (!programReady) {
    console.log('[SYNC] Program not ready, skipping sync');
    return;
  }

  console.log('[SYNC] Syncing stakes from on-chain...');

  // Get all users with active stakes in DB
  const users = await db.all<{ wallet: string }>(
    'SELECT DISTINCT u.wallet FROM users u JOIN stakes s ON u.id = s.user_id WHERE s.is_active = TRUE'
  );

  for (const user of users) {
    try {
      await syncUserStake(user.wallet);
    } catch (error) {
      console.error(`[SYNC] Error syncing stake for ${user.wallet}:`, error);
    }
  }

  // Sync total staked
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
