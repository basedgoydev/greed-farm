import { db, toBigInt, type User, type Stake } from '../db/index.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';
import { isValidSolanaAddress, verifyTokenTransfer, transferTokensToUser } from '../utils/solana.js';
import { safeAdd, safeSub, isWarmupComplete } from '../utils/math.js';
import { syncUserStake } from './stake-sync.js';
import { fetchUserStake, getVaultAddressString, isPoolInitialized } from '../utils/staking-program.js';

interface StakeResult {
  success: boolean;
  message: string;
  txId?: string;
  stake?: {
    amount: string;
    stakedAt: string;
    warmupEndsAt: string;
  };
}

interface UnstakeResult {
  success: boolean;
  message: string;
  txId?: string;
  amount?: string;
  signature?: string;
}

// Get or create user by wallet address
export async function getOrCreateUser(wallet: string): Promise<User> {
  if (!isValidSolanaAddress(wallet)) {
    throw new Error('Invalid wallet address');
  }

  let user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);

  if (!user) {
    await db.run(
      'INSERT INTO users (wallet, claimable_lamports, total_claimed_lamports, total_won_lamports, total_lost_lamports) VALUES (?, 0, 0, 0, 0)',
      [wallet]
    );
    user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);
  }

  return user!;
}

// Get user's active stake
export async function getActiveStake(userId: number): Promise<Stake | undefined> {
  return db.get<Stake>(
    'SELECT * FROM stakes WHERE user_id = ? AND is_active = TRUE',
    [userId]
  );
}

// Get user's stake info with warmup status
// Now syncs from on-chain program first
export async function getStakeInfo(wallet: string): Promise<{
  staked: string;
  stakedAt: string | null;
  isEligible: boolean;
  warmupRemaining: number;
  eligibleAt: string | null;
}> {
  // Try to sync from on-chain first
  try {
    const programReady = await isPoolInitialized();
    if (programReady) {
      const onChainStake = await fetchUserStake(wallet);
      if (onChainStake && onChainStake.amount > 0n) {
        // Sync to DB
        await syncUserStake(wallet);

        const stakedAt = new Date(onChainStake.stakedAt * 1000);
        const warmupEndsAt = new Date(stakedAt.getTime() + config.warmupDuration * 1000);
        const warmupRemaining = Math.max(0, warmupEndsAt.getTime() - Date.now());
        const isEligible = warmupRemaining === 0;

        return {
          staked: onChainStake.amount.toString(),
          stakedAt: stakedAt.toISOString(),
          isEligible,
          warmupRemaining,
          eligibleAt: warmupEndsAt.toISOString()
        };
      } else if (onChainStake && onChainStake.amount === 0n) {
        // User has unstaked on-chain
        return {
          staked: '0',
          stakedAt: null,
          isEligible: false,
          warmupRemaining: 0,
          eligibleAt: null
        };
      }
    }
  } catch (error) {
    console.error('Error fetching on-chain stake, falling back to DB:', error);
  }

  // Fallback to DB (for backwards compatibility or if program not deployed)
  const user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);
  if (!user) {
    return {
      staked: '0',
      stakedAt: null,
      isEligible: false,
      warmupRemaining: 0,
      eligibleAt: null
    };
  }

  const stake = await getActiveStake(user.id);
  if (!stake) {
    return {
      staked: '0',
      stakedAt: null,
      isEligible: false,
      warmupRemaining: 0,
      eligibleAt: null
    };
  }

  const stakedAt = new Date(stake.staked_at);
  const isEligible = isWarmupComplete(stakedAt, config.warmupDuration);
  const warmupEndsAt = new Date(stakedAt.getTime() + config.warmupDuration * 1000);
  const warmupRemaining = Math.max(0, warmupEndsAt.getTime() - Date.now());

  return {
    staked: toBigInt(stake.amount).toString(),
    stakedAt: stake.staked_at,
    isEligible,
    warmupRemaining,
    eligibleAt: warmupEndsAt.toISOString()
  };
}

// Stake tokens
export async function stake(
  wallet: string,
  amount: bigint,
  signature: string
): Promise<StakeResult> {
  const txId = uuidv4();

  return db.transaction(async () => {
    // Check for existing pending/completed transaction (idempotency)
    const existingTx = await db.get(
      'SELECT * FROM transactions WHERE solana_signature = ? AND action = ?',
      [signature, 'stake']
    );
    if (existingTx) {
      return {
        success: false,
        message: 'Transaction already processed'
      };
    }

    // Verify the token transfer on Solana
    const verification = await verifyTokenTransfer(signature, wallet, amount);
    if (!verification.valid) {
      return {
        success: false,
        message: verification.error || 'Token transfer verification failed'
      };
    }

    // Use the actual amount received (in case it differs slightly)
    const verifiedAmount = verification.actualAmount || amount;

    const user = await getOrCreateUser(wallet);

    // Check if user already has an active stake
    const existingStake = await getActiveStake(user.id);
    const now = new Date().toISOString();

    // Create transaction record
    await db.run(
      'INSERT INTO transactions (tx_id, user_id, action, amount_lamports, status, solana_signature) VALUES (?, ?, ?, ?, ?, ?)',
      [txId, user.id, 'stake', verifiedAmount.toString(), 'completed', signature]
    );

    if (existingStake) {
      // Add to existing stake - reset warmup period
      const newAmount = safeAdd(toBigInt(existingStake.amount), verifiedAmount);
      await db.run(
        'UPDATE stakes SET amount = ?, staked_at = ? WHERE id = ?',
        [newAmount.toString(), now, existingStake.id]
      );
    } else {
      // Create new stake record
      await db.run(
        'INSERT INTO stakes (user_id, amount, staked_at, is_active) VALUES (?, ?, ?, TRUE)',
        [user.id, verifiedAmount.toString(), now]
      );
    }

    // Update global total staked
    const state = await db.get<{ total_staked: string }>('SELECT total_staked FROM global_state WHERE id = 1');
    const currentTotal = toBigInt(state?.total_staked || 0);
    const newTotal = safeAdd(currentTotal, verifiedAmount);
    await db.run(
      'UPDATE global_state SET total_staked = ?, last_updated = ? WHERE id = 1',
      [newTotal.toString(), now]
    );

    const warmupEndsAt = new Date(Date.now() + config.warmupDuration * 1000);
    const totalStaked = existingStake
      ? safeAdd(toBigInt(existingStake.amount), verifiedAmount)
      : verifiedAmount;

    return {
      success: true,
      message: existingStake ? 'Tokens added to stake (warmup reset)' : 'Tokens staked successfully',
      txId,
      stake: {
        amount: totalStaked.toString(),
        stakedAt: now,
        warmupEndsAt: warmupEndsAt.toISOString()
      }
    };
  });
}

// Unstake tokens
export async function unstake(wallet: string): Promise<UnstakeResult> {
  const txId = uuidv4();

  const user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);
  if (!user) {
    return {
      success: false,
      message: 'User not found'
    };
  }

  const stake = await getActiveStake(user.id);
  if (!stake) {
    return {
      success: false,
      message: 'No active stake found'
    };
  }

  const amount = toBigInt(stake.amount);
  const now = new Date().toISOString();

  // Use a transaction to mark stake as inactive FIRST, then transfer tokens
  // This prevents double-unstake race conditions
  return db.transaction(async () => {
    // Check if stake is still active (prevent race condition)
    const currentStake = await db.get<Stake>(
      'SELECT * FROM stakes WHERE id = ? AND is_active = TRUE',
      [stake.id]
    );
    if (!currentStake) {
      return {
        success: false,
        message: 'Stake already being processed or unstaked'
      };
    }

    // Create pending transaction record
    await db.run(
      'INSERT INTO transactions (tx_id, user_id, action, amount_lamports, status) VALUES (?, ?, ?, ?, ?)',
      [txId, user.id, 'unstake', amount.toString(), 'pending']
    );

    // Mark stake as inactive BEFORE Solana transfer
    await db.run(
      'UPDATE stakes SET is_active = FALSE, unstaked_at = ? WHERE id = ?',
      [now, stake.id]
    );

    // Update global total staked
    const state = await db.get<{ total_staked: string }>('SELECT total_staked FROM global_state WHERE id = 1');
    const currentTotal = toBigInt(state?.total_staked || 0);
    const newTotal = safeSub(currentTotal, amount);
    await db.run(
      'UPDATE global_state SET total_staked = ?, last_updated = ? WHERE id = 1',
      [newTotal.toString(), now]
    );

    // Now transfer tokens back to user
    let signature: string;
    try {
      signature = await transferTokensToUser(wallet, amount);
    } catch (error) {
      // Solana transfer failed - revert the database changes
      console.error('Failed to transfer tokens back:', error);

      // Reactivate the stake
      await db.run(
        'UPDATE stakes SET is_active = TRUE, unstaked_at = NULL WHERE id = ?',
        [stake.id]
      );

      // Restore global total staked
      await db.run(
        'UPDATE global_state SET total_staked = ?, last_updated = ? WHERE id = 1',
        [currentTotal.toString(), now]
      );

      // Mark transaction as failed
      await db.run(
        'UPDATE transactions SET status = ? WHERE tx_id = ?',
        ['failed', txId]
      );

      return {
        success: false,
        message: `Failed to transfer tokens: ${(error as Error).message}`
      };
    }

    // Update transaction as completed with signature
    await db.run(
      'UPDATE transactions SET status = ?, solana_signature = ?, completed_at = ? WHERE tx_id = ?',
      ['completed', signature, now, txId]
    );

    return {
      success: true,
      message: 'Tokens unstaked and returned to wallet',
      txId,
      amount: amount.toString(),
      signature
    };
  });
}

// Get all eligible stakes (past warmup period)
export async function getEligibleStakes(): Promise<Array<{
  userId: number;
  wallet: string;
  amount: bigint;
}>> {
  const warmupCutoff = new Date(Date.now() - config.warmupDuration * 1000).toISOString();

  const stakes = await db.all<{
    user_id: number;
    wallet: string;
    amount: string;
  }>(
    `SELECT s.user_id, u.wallet, s.amount
     FROM stakes s
     JOIN users u ON s.user_id = u.id
     WHERE s.is_active = TRUE AND s.staked_at <= ?`,
    [warmupCutoff]
  );

  return stakes.map(s => ({
    userId: s.user_id,
    wallet: s.wallet,
    amount: toBigInt(s.amount)
  }));
}

// Get total eligible stake amount
export async function getTotalEligibleStake(): Promise<bigint> {
  const stakes = await getEligibleStakes();
  return stakes.reduce((sum, s) => safeAdd(sum, s.amount), 0n);
}

// Get total staked (including warmup)
export async function getTotalStaked(): Promise<bigint> {
  const state = await db.get<{ total_staked: string }>('SELECT total_staked FROM global_state WHERE id = 1');
  return toBigInt(state?.total_staked || 0);
}
