import { Router, Request, Response, NextFunction } from 'express';
import { config, getQuorumPercentage } from '../config.js';
import { db, toBigInt } from '../db/index.js';
import {
  stake,
  unstake,
  getStakeInfo,
  getOrCreateUser
} from '../services/staking.js';
import {
  getGlobalState,
  getHarvestProgress,
  getTimeUntilNextEpoch,
  getEpochHistory
} from '../services/epoch.js';
import {
  claim,
  executeClaimTransfer,
  getClaimableBalance,
  getClaimHistory
} from '../services/claims.js';
import {
  greed,
  createCommitment,
  verifyGreed,
  getGreedHistory,
  getGreedStats
} from '../services/greed.js';
import { isValidSolanaAddress, formatSol, verifySignature, getTreasuryBalance } from '../utils/solana.js';
import { strictRateLimit } from '../middleware/auth.js';
import {
  STAKING_PROGRAM_ID,
  getStakePoolAddress,
  getVaultAddress,
  isPoolInitialized
} from '../utils/staking-program.js';
import { PublicKey } from '@solana/web3.js';

const router = Router();

// Strict rate limits for sensitive endpoints
const claimRateLimit = strictRateLimit(5, 60000); // 5 claims per minute
const greedRateLimit = strictRateLimit(10, 60000); // 10 greed attempts per minute
const stakeRateLimit = strictRateLimit(10, 60000); // 10 stake/unstake per minute

// Used signatures cache to prevent replay attacks (with TTL cleanup)
const usedSignatures = new Map<string, number>();
const SIGNATURE_TTL_MS = 60 * 1000; // 60 seconds
const MAX_SIGNATURE_CACHE_SIZE = 10000;

// Clean up expired signatures periodically
setInterval(() => {
  const now = Date.now();
  for (const [sig, expiry] of usedSignatures) {
    if (expiry < now) {
      usedSignatures.delete(sig);
    }
  }
}, 30 * 1000); // Clean every 30 seconds

// Middleware to verify wallet ownership via signature
function requireWalletSignature(req: Request, res: Response, next: NextFunction): void {
  const { wallet, signature, message } = req.body;

  if (!wallet || !signature || !message) {
    res.status(401).json({
      error: 'Authentication required. Please sign the message with your wallet.'
    });
    return;
  }

  // Check if signature was already used (replay attack prevention)
  if (usedSignatures.has(signature)) {
    res.status(401).json({
      error: 'Signature already used. Please sign a fresh message.'
    });
    return;
  }

  // Verify the message was signed by the wallet
  if (!verifySignature(message, signature, wallet)) {
    res.status(401).json({
      error: 'Invalid signature - wallet ownership verification failed'
    });
    return;
  }

  // Verify message timestamp (prevent replay attacks)
  try {
    const parts = message.split(':');
    const timestamp = parseInt(parts[parts.length - 1]);
    const now = Date.now();
    const maxAge = 60 * 1000; // 60 seconds (reduced from 5 minutes)

    if (isNaN(timestamp) || now - timestamp > maxAge) {
      res.status(401).json({
        error: 'Signature expired. Please sign a fresh message.'
      });
      return;
    }

    // Prevent future timestamps (clock skew tolerance: 5 seconds)
    if (timestamp > now + 5000) {
      res.status(401).json({
        error: 'Invalid timestamp - clock skew detected.'
      });
      return;
    }
  } catch {
    res.status(401).json({
      error: 'Invalid message format'
    });
    return;
  }

  // Mark signature as used (with expiry for cleanup)
  if (usedSignatures.size >= MAX_SIGNATURE_CACHE_SIZE) {
    // Emergency cleanup if cache grows too large
    const now = Date.now();
    for (const [sig, expiry] of usedSignatures) {
      if (expiry < now) {
        usedSignatures.delete(sig);
      }
    }
  }
  usedSignatures.set(signature, Date.now() + SIGNATURE_TTL_MS);

  next();
}

// Middleware to validate wallet address
function validateWallet(req: Request, res: Response, next: NextFunction): void {
  const wallet = req.params.wallet || req.body.wallet;
  if (!wallet || !isValidSolanaAddress(wallet)) {
    res.status(400).json({ error: 'Invalid wallet address' });
    return;
  }
  next();
}

// GET /api/status - Get current game status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const { getTreasuryBalance } = await import('../utils/solana.js');

    const state = await getGlobalState();
    const harvestProgress = await getHarvestProgress();
    const timeUntilNextEpoch = await getTimeUntilNextEpoch();

    // Get active staker count
    const stakerCount = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM stakes WHERE is_active = TRUE AND amount > 0'
    );

    // Get current treasury balance
    const currentTreasuryBalance = await getTreasuryBalance();
    const lastBalance = toBigInt(state.treasury_last_balance || 0);
    const pendingFees = currentTreasuryBalance > lastBalance
      ? currentTreasuryBalance - lastBalance
      : 0n;
    const pendingSharedPool = (pendingFees * 90n) / 100n;
    const pendingGreedPot = (pendingFees * 10n) / 100n;

    res.json({
      currentEpoch: state.current_epoch,
      treasury: {
        balance: currentTreasuryBalance.toString(),
        sol: formatSol(currentTreasuryBalance)
      },
      sharedPool: {
        lamports: state.shared_pool_lamports.toString(),
        sol: formatSol(toBigInt(state.shared_pool_lamports)),
        pending: formatSol(pendingSharedPool),
        pendingLamports: pendingSharedPool.toString()
      },
      greedPot: {
        lamports: state.greed_pot_lamports.toString(),
        sol: formatSol(toBigInt(state.greed_pot_lamports)),
        pending: formatSol(pendingGreedPot),
        pendingLamports: pendingGreedPot.toString()
      },
      totalStaked: {
        tokens: state.total_staked.toString(),
        formatted: formatTokens(toBigInt(state.total_staked))
      },
      harvest: {
        currentEligible: harvestProgress.currentStake,
        requiredForQuorum: harvestProgress.requiredStake,
        percentage: harvestProgress.percentage
      },
      nextEpoch: {
        inMs: timeUntilNextEpoch,
        inSeconds: Math.floor(timeUntilNextEpoch / 1000)
      },
      config: {
        epochDuration: config.epochDuration,
        warmupDuration: config.warmupDuration,
        quorumPercentage: harvestProgress.quorumPercentage,
        totalSupply: config.totalTokenSupply.toString()
      },
      stakerCount: stakerCount?.count || 0
    });
  } catch (error) {
    console.error('Error in /status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/staking-program - Get on-chain staking program info
router.get('/staking-program', async (req: Request, res: Response) => {
  try {
    const tokenMint = config.tokenMint ? new PublicKey(config.tokenMint) : null;

    if (!tokenMint) {
      res.json({
        initialized: false,
        error: 'Token mint not configured'
      });
      return;
    }

    const [stakePool, stakePoolBump] = getStakePoolAddress(tokenMint);
    const [vault, vaultBump] = getVaultAddress(tokenMint);
    const initialized = await isPoolInitialized();

    res.json({
      initialized,
      programId: STAKING_PROGRAM_ID.toBase58(),
      tokenMint: tokenMint.toBase58(),
      stakePool: stakePool.toBase58(),
      vault: vault.toBase58(),
      stakePoolBump,
      vaultBump
    });
  } catch (error) {
    console.error('Error in /staking-program:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/user/:wallet - Get user info
router.get('/user/:wallet', validateWallet, async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const user = await getOrCreateUser(wallet);
    const stakeInfo = await getStakeInfo(wallet);
    const claimable = await getClaimableBalance(wallet);

    res.json({
      wallet,
      stake: {
        amount: stakeInfo.staked,
        stakedAt: stakeInfo.stakedAt,
        isEligible: stakeInfo.isEligible,
        warmupRemaining: stakeInfo.warmupRemaining,
        eligibleAt: stakeInfo.eligibleAt
      },
      claimable: {
        lamports: claimable.toString(),
        sol: formatSol(claimable)
      },
      stats: {
        totalClaimed: toBigInt(user.total_claimed_lamports).toString(),
        totalWon: toBigInt(user.total_won_lamports).toString(),
        totalLost: toBigInt(user.total_lost_lamports).toString()
      }
    });
  } catch (error) {
    console.error('Error in /user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/stake - Stake tokens
router.post('/stake', stakeRateLimit, validateWallet, async (req: Request, res: Response) => {
  try {
    const { wallet, amount, signature } = req.body;

    if (!amount || !signature) {
      return res.status(400).json({ error: 'Missing amount or signature' });
    }

    const amountBigInt = toBigInt(amount);
    if (amountBigInt <= 0n) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const result = await stake(wallet, amountBigInt, signature);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in /stake:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/unstake - Unstake tokens (requires wallet signature)
router.post('/unstake', stakeRateLimit, validateWallet, requireWalletSignature, async (req: Request, res: Response) => {
  try {
    const { wallet } = req.body;
    const result = await unstake(wallet);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in /unstake:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/migrate-stake - Return custodial tokens so user can restake on-chain (requires wallet signature)
router.post('/migrate-stake', stakeRateLimit, validateWallet, requireWalletSignature, async (req: Request, res: Response) => {
  try {
    const { wallet } = req.body;

    // Find user and their custodial stake
    const user = await db.get<{ id: number; wallet: string }>(
      'SELECT id, wallet FROM users WHERE wallet = ?',
      [wallet]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get active custodial stake
    const stake = await db.get<{ id: number; amount: string; staked_at: string }>(
      'SELECT id, amount, staked_at FROM stakes WHERE user_id = ? AND is_active = TRUE',
      [user.id]
    );

    if (!stake) {
      return res.status(400).json({
        success: false,
        message: 'No active custodial stake found to migrate'
      });
    }

    const amount = toBigInt(stake.amount);
    if (amount <= 0n) {
      return res.status(400).json({
        success: false,
        message: 'Stake amount is zero'
      });
    }

    // Transfer tokens from treasury back to user
    let signature: string;
    try {
      const { transferTokensToUser } = await import('../utils/solana.js');
      signature = await transferTokensToUser(wallet, amount);
    } catch (error: any) {
      console.error('Token transfer failed:', error);
      return res.status(500).json({
        success: false,
        message: `Failed to transfer tokens: ${error.message}`
      });
    }

    // Mark stake as migrated (inactive)
    const now = new Date().toISOString();
    await db.run(
      'UPDATE stakes SET is_active = FALSE, unstaked_at = ? WHERE id = ?',
      [now, stake.id]
    );

    // Update global total staked
    const state = await db.get<{ total_staked: string }>('SELECT total_staked FROM global_state WHERE id = 1');
    const currentTotal = toBigInt(state?.total_staked || 0);
    const newTotal = currentTotal > amount ? currentTotal - amount : 0n;
    await db.run(
      'UPDATE global_state SET total_staked = ?, last_updated = ? WHERE id = 1',
      [newTotal.toString(), now]
    );

    // Log the migration
    await db.run(
      'INSERT INTO transactions (tx_id, user_id, action, amount_lamports, status, solana_signature, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        `migrate-${Date.now()}`,
        user.id,
        'migrate',
        amount.toString(),
        'completed',
        signature,
        now
      ]
    );

    const decimals = config.tokenDecimals;
    const formattedAmount = (Number(amount) / 10 ** decimals).toLocaleString();

    res.json({
      success: true,
      message: `Migrated ${formattedAmount} tokens back to your wallet. You can now stake them on-chain.`,
      amount: amount.toString(),
      formattedAmount,
      signature
    });
  } catch (error) {
    console.error('Error in /migrate-stake:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/claim - Claim SOL rewards (requires wallet signature)
router.post('/claim', claimRateLimit, validateWallet, requireWalletSignature, async (req: Request, res: Response) => {
  try {
    const { wallet } = req.body;

    const claimResult = await claim(wallet);

    if (!claimResult.success) {
      // Return treasury empty message with 200 status (not an error, just no funds available)
      if (claimResult.remainingClaimable) {
        return res.json(claimResult);
      }
      return res.status(400).json(claimResult);
    }

    const transferResult = await executeClaimTransfer(
      claimResult.txId!,
      wallet,
      toBigInt(claimResult.amount!)
    );

    if (transferResult.success) {
      const response: Record<string, unknown> = {
        success: true,
        message: claimResult.partialClaim
          ? `Partial claim successful. ${(Number(claimResult.remainingClaimable) / 1e9).toFixed(4)} SOL still claimable.`
          : 'SOL claimed successfully',
        amount: claimResult.amount,
        signature: transferResult.signature
      };

      if (claimResult.partialClaim) {
        response.partialClaim = true;
        response.remainingClaimable = claimResult.remainingClaimable;
      }

      res.json(response);
    } else {
      res.status(500).json({
        success: false,
        message: 'Transfer failed, balance refunded',
        error: transferResult.error
      });
    }
  } catch (error) {
    console.error('Error in /claim:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/greed/commit - Get server commitment for provably fair gambling (requires wallet signature)
router.post('/greed/commit', greedRateLimit, validateWallet, requireWalletSignature, async (req: Request, res: Response) => {
  try {
    const { wallet } = req.body;
    const result = await createCommitment(wallet);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in /greed/commit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/greed - Risk claimable for greed pot (requires wallet signature)
router.post('/greed', greedRateLimit, validateWallet, requireWalletSignature, async (req: Request, res: Response) => {
  try {
    const { wallet, riskPercentage, commitmentId, clientSeed } = req.body;

    if (!riskPercentage || ![25, 50, 100].includes(riskPercentage)) {
      return res.status(400).json({
        error: 'Invalid risk percentage. Must be 25, 50, or 100'
      });
    }

    if (!commitmentId) {
      return res.status(400).json({
        error: 'Missing commitmentId. Request a commitment first via POST /api/greed/commit'
      });
    }

    if (!clientSeed || clientSeed.length < 8) {
      return res.status(400).json({
        error: 'Invalid clientSeed. Must be at least 8 characters.'
      });
    }

    const result = await greed(wallet, riskPercentage, commitmentId, clientSeed);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in /greed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/greed/verify/:id - Verify a past greed gamble
router.get('/greed/verify/:id', async (req: Request, res: Response) => {
  try {
    const greedId = parseInt(req.params.id, 10);
    if (isNaN(greedId)) {
      return res.status(400).json({ error: 'Invalid greed ID' });
    }

    const result = await verifyGreed(greedId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error in /greed/verify:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/history/claims/:wallet - Get claim history
router.get('/history/claims/:wallet', validateWallet, async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const history = await getClaimHistory(wallet);
    res.json({ history });
  } catch (error) {
    console.error('Error in /history/claims:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/history/greed/:wallet - Get greed history
router.get('/history/greed/:wallet', validateWallet, async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const history = await getGreedHistory(wallet);
    res.json({ history });
  } catch (error) {
    console.error('Error in /history/greed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/epochs - Get epoch history
router.get('/epochs', async (req: Request, res: Response) => {
  try {
    const limitParam = req.query.limit as string;
    const limit = limitParam && /^\d+$/.test(limitParam)
      ? Math.min(parseInt(limitParam, 10), 100)
      : 10;
    const epochs = await getEpochHistory(limit);
    res.json({ epochs });
  } catch (error) {
    console.error('Error in /epochs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stats/greed - Get greed stats
router.get('/stats/greed', async (req: Request, res: Response) => {
  try {
    const stats = await getGreedStats();
    res.json(stats);
  } catch (error) {
    console.error('Error in /stats/greed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/leaderboard/greed - Get top greeders by net winnings
router.get('/leaderboard/greed', async (req: Request, res: Response) => {
  try {
    const limitParam = req.query.limit as string;
    const limit = limitParam && /^\d+$/.test(limitParam)
      ? Math.min(parseInt(limitParam, 10), 50)
      : 10;

    // Get users with net positive greed winnings (total_won - total_lost)
    const leaderboard = await db.all<{
      wallet: string;
      total_won_lamports: string;
      total_lost_lamports: string;
    }>(
      `SELECT wallet, total_won_lamports, total_lost_lamports
       FROM users
       WHERE CAST(total_won_lamports AS BIGINT) > 0
       ORDER BY (CAST(total_won_lamports AS BIGINT) - CAST(total_lost_lamports AS BIGINT)) DESC
       LIMIT ?`,
      [limit]
    );

    const formatted = leaderboard.map((user, index) => {
      const won = toBigInt(user.total_won_lamports);
      const lost = toBigInt(user.total_lost_lamports);
      const net = won - lost;
      return {
        rank: index + 1,
        wallet: user.wallet,
        netWinnings: net.toString(),
        netWinningsSol: formatSol(net),
        totalWon: won.toString(),
        totalWonSol: formatSol(won),
        totalLost: lost.toString(),
        totalLostSol: formatSol(lost)
      };
    });

    res.json({ leaderboard: formatted });
  } catch (error) {
    console.error('Error in /leaderboard/greed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Debug auth middleware - requires DEBUG_SECRET header in production
function debugAuth(req: Request, res: Response, next: NextFunction): void {
  const debugKey = req.headers['x-debug-key'] as string | undefined;
  const debugSecret = process.env.DEBUG_SECRET;

  // In production or if DEBUG_SECRET is set, always require valid key
  const isProduction = process.env.NODE_ENV === 'production';
  const hasDebugSecret = debugSecret && debugSecret.length > 0;

  if (isProduction || hasDebugSecret) {
    // Require DEBUG_SECRET to be configured
    if (!hasDebugSecret) {
      res.status(403).json({ error: 'Debug endpoints disabled (no DEBUG_SECRET configured)' });
      return;
    }
    // Require valid key header
    if (!debugKey || debugKey !== debugSecret) {
      res.status(403).json({ error: 'Invalid or missing debug key' });
      return;
    }
  }

  // Only allow through in development mode without DEBUG_SECRET
  next();
}

// GET /api/debug/distributions - Check distributions table
router.get('/debug/distributions', debugAuth, async (req: Request, res: Response) => {
  try {
    const distributions = await db.all('SELECT * FROM distributions ORDER BY id DESC LIMIT 20');
    const users = await db.all('SELECT id, wallet, claimable_lamports FROM users');
    const globalState = await db.get('SELECT * FROM global_state WHERE id = 1');
    res.json({ distributions, users, globalState });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/debug/credit-user - Directly credit a user's claimable balance
router.post('/debug/credit-user', debugAuth, async (req: Request, res: Response) => {
  try {
    const { wallet, amount } = req.body;

    if (!wallet || !amount) {
      return res.status(400).json({ error: 'Missing wallet or amount' });
    }

    const user = await db.get<{ id: number; claimable_lamports: string }>(
      'SELECT id, claimable_lamports FROM users WHERE wallet = ?',
      [wallet]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldBalance = user.claimable_lamports;
    await db.run(
      'UPDATE users SET claimable_lamports = ? WHERE id = ?',
      [amount.toString(), user.id]
    );

    res.json({
      success: true,
      wallet,
      oldBalance,
      newBalance: amount.toString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/debug/sync-distributions - Sync claimable from distributions
router.get('/debug/sync-distributions', debugAuth, async (req: Request, res: Response) => {
  try {
    const distributions = await db.all<{ user_id: number; reward_lamports: string }>(
      'SELECT user_id, reward_lamports FROM distributions'
    );

    const userTotals: Record<number, bigint> = {};
    for (const dist of distributions) {
      const userId = dist.user_id;
      const reward = toBigInt(dist.reward_lamports);
      userTotals[userId] = (userTotals[userId] || 0n) + reward;
    }

    const results: { userId: number; wallet: string; total: string; current: string }[] = [];

    for (const [userId, total] of Object.entries(userTotals)) {
      const user = await db.get<{ wallet: string; claimable_lamports: string }>(
        'SELECT wallet, claimable_lamports FROM users WHERE id = ?',
        [userId]
      );

      if (user) {
        results.push({
          userId: Number(userId),
          wallet: user.wallet,
          total: total.toString(),
          current: user.claimable_lamports
        });
      }
    }

    res.json({ distributions: results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/debug/fix-claimable - Recalculate claimable from distributions, greed wins/losses, and claims
router.post('/debug/fix-claimable', debugAuth, async (req: Request, res: Response) => {
  try {
    // Get all users
    const users = await db.all<{ id: number; wallet: string; claimable_lamports: string }>(
      'SELECT id, wallet, claimable_lamports FROM users'
    );

    const fixed: { wallet: string; oldBalance: string; newBalance: string; breakdown: object }[] = [];

    for (const user of users) {
      // Get total distributed rewards
      const distributions = await db.get<{ total: string }>(
        `SELECT COALESCE(SUM(CAST(reward_lamports AS BIGINT)), 0) as total
         FROM distributions WHERE user_id = ?`,
        [user.id]
      );
      const totalDistributed = toBigInt(distributions?.total || 0);

      // Get total claimed
      const claims = await db.get<{ total: string }>(
        `SELECT COALESCE(SUM(CAST(amount_lamports AS BIGINT)), 0) as total
         FROM transactions
         WHERE user_id = ? AND action = 'claim' AND status = 'completed'`,
        [user.id]
      );
      const totalClaimed = toBigInt(claims?.total || 0);

      // Get greed wins (payout when won=true)
      const greedWins = await db.get<{ total: string }>(
        `SELECT COALESCE(SUM(CAST(payout_lamports AS BIGINT)), 0) as total
         FROM greed_history WHERE user_id = ? AND won = TRUE`,
        [user.id]
      );
      const totalWon = toBigInt(greedWins?.total || 0);

      // Get greed losses (risk when won=false)
      const greedLosses = await db.get<{ total: string }>(
        `SELECT COALESCE(SUM(CAST(risk_lamports AS BIGINT)), 0) as total
         FROM greed_history WHERE user_id = ? AND won = FALSE`,
        [user.id]
      );
      const totalLost = toBigInt(greedLosses?.total || 0);

      // Calculate correct claimable: distributed + greed_wins - greed_losses - claimed
      const correctClaimable = totalDistributed + totalWon - totalLost - totalClaimed;
      const newClaimable = correctClaimable > 0n ? correctClaimable : 0n;

      if (toBigInt(user.claimable_lamports) !== newClaimable) {
        await db.run(
          'UPDATE users SET claimable_lamports = ? WHERE id = ?',
          [newClaimable.toString(), user.id]
        );

        fixed.push({
          wallet: user.wallet,
          oldBalance: user.claimable_lamports,
          newBalance: newClaimable.toString(),
          breakdown: {
            distributed: totalDistributed.toString(),
            greedWins: totalWon.toString(),
            greedLosses: totalLost.toString(),
            claimed: totalClaimed.toString()
          }
        });
      }
    }

    res.json({
      success: true,
      message: `Fixed ${fixed.length} user(s)`,
      fixed
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/debug/reset-treasury-tracking - Reset treasury balance tracking
router.post('/debug/reset-treasury-tracking', debugAuth, async (req: Request, res: Response) => {
  try {
    await db.run(
      'UPDATE global_state SET treasury_last_balance = ? WHERE id = 1',
      ['0']
    );
    res.json({
      success: true,
      message: 'Treasury tracking reset. Next epoch will count current balance as new fees.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/debug/sync-treasury - Sync treasury_last_balance to actual balance
router.post('/debug/sync-treasury', debugAuth, async (req: Request, res: Response) => {
  try {
    const currentBalance = await getTreasuryBalance();
    const state = await getGlobalState();
    const oldBalance = toBigInt(state.treasury_last_balance);

    await db.run(
      'UPDATE global_state SET treasury_last_balance = ?, last_updated = ? WHERE id = 1',
      [currentBalance.toString(), new Date().toISOString()]
    );

    res.json({
      success: true,
      message: 'Treasury balance synced',
      oldTrackedBalance: oldBalance.toString(),
      newTrackedBalance: currentBalance.toString(),
      actualTreasury: currentBalance.toString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/debug/reactivate-stakes - Reactivate recently deactivated stakes (fix for sync bug)
router.post('/debug/reactivate-stakes', debugAuth, async (req: Request, res: Response) => {
  try {
    // Find stakes that were deactivated in the last hour (likely by the buggy sync)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const deactivatedStakes = await db.all<{
      id: number;
      user_id: number;
      wallet: string;
      amount: string;
      unstaked_at: string;
    }>(
      `SELECT s.id, s.user_id, u.wallet, s.amount, s.unstaked_at
       FROM stakes s
       JOIN users u ON s.user_id = u.id
       WHERE s.is_active = FALSE
         AND s.unstaked_at >= ?
         AND CAST(s.amount AS BIGINT) > 0`,
      [oneHourAgo]
    );

    const reactivated: string[] = [];

    for (const stake of deactivatedStakes) {
      // Check if user doesn't have another active stake
      const activeStake = await db.get(
        'SELECT id FROM stakes WHERE user_id = ? AND is_active = TRUE',
        [stake.user_id]
      );

      if (!activeStake) {
        await db.run(
          'UPDATE stakes SET is_active = TRUE, unstaked_at = NULL WHERE id = ?',
          [stake.id]
        );
        reactivated.push(stake.wallet);
      }
    }

    // Also update global total staked
    const totalResult = await db.get<{ total: string }>(
      'SELECT COALESCE(SUM(CAST(amount AS BIGINT)), 0) as total FROM stakes WHERE is_active = TRUE'
    );
    const total = totalResult?.total || '0';

    await db.run(
      'UPDATE global_state SET total_staked = ?, last_updated = ? WHERE id = 1',
      [total, new Date().toISOString()]
    );

    res.json({
      success: true,
      message: `Reactivated ${reactivated.length} stake(s)`,
      reactivated,
      newTotalStaked: total
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/debug/stakes - Check all active stakes
router.get('/debug/stakes', debugAuth, async (req: Request, res: Response) => {
  try {
    const stakes = await db.all<{
      id: number;
      user_id: number;
      wallet: string;
      amount: string;
      staked_at: string;
      is_active: boolean;
    }>(
      `SELECT s.id, s.user_id, u.wallet, s.amount, s.staked_at, s.is_active
       FROM stakes s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.staked_at DESC
       LIMIT 50`
    );

    const decimals = config.tokenDecimals;
    const formatted = stakes.map(s => ({
      ...s,
      amountFormatted: (Number(toBigInt(s.amount)) / (10 ** decimals)).toLocaleString()
    }));

    res.json({
      count: stakes.length,
      stakes: formatted
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/debug/user-stake/:wallet - Check specific user's stake
router.get('/debug/user-stake/:wallet', debugAuth, async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;

    // Get DB stake
    const user = await db.get<{ id: number; wallet: string }>(
      'SELECT id, wallet FROM users WHERE wallet = ?',
      [wallet]
    );

    let dbStake = null;
    if (user) {
      dbStake = await db.get<{
        amount: string;
        staked_at: string;
        is_active: boolean;
      }>(
        'SELECT amount, staked_at, is_active FROM stakes WHERE user_id = ? AND is_active = TRUE',
        [user.id]
      );
    }

    // Get on-chain stake
    let onChainStake = null;
    try {
      const initialized = await isPoolInitialized();
      if (initialized) {
        const { fetchUserStake } = await import('../utils/staking-program.js');
        onChainStake = await fetchUserStake(wallet);
      }
    } catch (e: any) {
      onChainStake = { error: e.message };
    }

    res.json({
      wallet,
      user: user || null,
      dbStake: dbStake || null,
      onChainStake
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/debug/migrate-orphaned-stakes - Return tokens for stakes deactivated by bug
router.post('/debug/migrate-orphaned-stakes', debugAuth, async (req: Request, res: Response) => {
  try {
    const { transferTokensToUser } = await import('../utils/solana.js');

    // Find all inactive stakes that don't have a corresponding migration/unstake transaction
    // These were deactivated by the buggy sync but never got tokens back
    const orphanedStakes = await db.all<{
      stake_id: number;
      user_id: number;
      wallet: string;
      amount: string;
    }>(
      `SELECT s.id as stake_id, s.user_id, u.wallet, s.amount
       FROM stakes s
       JOIN users u ON s.user_id = u.id
       WHERE s.is_active = FALSE
         AND CAST(s.amount AS BIGINT) > 0
         AND NOT EXISTS (
           SELECT 1 FROM transactions t
           WHERE t.user_id = s.user_id
             AND t.action IN ('unstake', 'migrate')
             AND t.status = 'completed'
             AND CAST(t.amount_lamports AS BIGINT) = CAST(s.amount AS BIGINT)
         )`
    );

    if (orphanedStakes.length === 0) {
      return res.json({
        success: true,
        message: 'No orphaned stakes to migrate',
        migrated: []
      });
    }

    // Group by wallet to avoid duplicate transfers
    const walletTotals = new Map<string, { amount: bigint; stakeIds: number[]; userId: number }>();
    for (const stake of orphanedStakes) {
      const existing = walletTotals.get(stake.wallet);
      const amount = toBigInt(stake.amount);
      if (existing) {
        existing.amount += amount;
        existing.stakeIds.push(stake.stake_id);
      } else {
        walletTotals.set(stake.wallet, { amount, stakeIds: [stake.stake_id], userId: stake.user_id });
      }
    }

    const migrated: { wallet: string; amount: string; signature: string }[] = [];
    const failed: { wallet: string; amount: string; error: string }[] = [];

    for (const [wallet, data] of walletTotals) {
      try {
        const signature = await transferTokensToUser(wallet, data.amount);

        // Log the migration
        const now = new Date().toISOString();
        await db.run(
          'INSERT INTO transactions (tx_id, user_id, action, amount_lamports, status, solana_signature, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            `migrate-orphan-${Date.now()}-${data.userId}`,
            data.userId,
            'migrate',
            data.amount.toString(),
            'completed',
            signature,
            now
          ]
        );

        migrated.push({
          wallet,
          amount: data.amount.toString(),
          signature
        });

        console.log(`[MIGRATE-ORPHAN] Returned ${data.amount} tokens to ${wallet}`);
      } catch (error: any) {
        console.error(`[MIGRATE-ORPHAN] Failed for ${wallet}:`, error);
        failed.push({
          wallet,
          amount: data.amount.toString(),
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Migrated ${migrated.length} wallets, ${failed.length} failed`,
      migrated,
      failed
    });
  } catch (error: any) {
    console.error('Error in /debug/migrate-orphaned-stakes:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/debug/migrate-all-custodial - Return tokens to ALL custodial stakers
router.post('/debug/migrate-all-custodial', debugAuth, async (req: Request, res: Response) => {
  try {
    const { transferTokensToUser } = await import('../utils/solana.js');

    // Get all active custodial stakes
    const stakes = await db.all<{
      stake_id: number;
      user_id: number;
      wallet: string;
      amount: string;
    }>(
      `SELECT s.id as stake_id, s.user_id, u.wallet, s.amount
       FROM stakes s
       JOIN users u ON s.user_id = u.id
       WHERE s.is_active = TRUE AND CAST(s.amount AS BIGINT) > 0`
    );

    if (stakes.length === 0) {
      return res.json({
        success: true,
        message: 'No custodial stakes to migrate',
        migrated: []
      });
    }

    const migrated: { wallet: string; amount: string; signature: string }[] = [];
    const failed: { wallet: string; amount: string; error: string }[] = [];

    for (const stake of stakes) {
      const amount = toBigInt(stake.amount);

      try {
        // Transfer tokens back to user
        const signature = await transferTokensToUser(stake.wallet, amount);

        // Mark stake as migrated
        const now = new Date().toISOString();
        await db.run(
          'UPDATE stakes SET is_active = FALSE, unstaked_at = ? WHERE id = ?',
          [now, stake.stake_id]
        );

        // Log the migration
        await db.run(
          'INSERT INTO transactions (tx_id, user_id, action, amount_lamports, status, solana_signature, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            `migrate-admin-${Date.now()}-${stake.user_id}`,
            stake.user_id,
            'migrate',
            amount.toString(),
            'completed',
            signature,
            now
          ]
        );

        migrated.push({
          wallet: stake.wallet,
          amount: amount.toString(),
          signature
        });

        console.log(`[MIGRATE] Returned ${amount} tokens to ${stake.wallet}`);
      } catch (error: any) {
        console.error(`[MIGRATE] Failed for ${stake.wallet}:`, error);
        failed.push({
          wallet: stake.wallet,
          amount: amount.toString(),
          error: error.message
        });
      }
    }

    // Update global total staked
    const totalResult = await db.get<{ total: string }>(
      'SELECT COALESCE(SUM(CAST(amount AS BIGINT)), 0) as total FROM stakes WHERE is_active = TRUE'
    );
    await db.run(
      'UPDATE global_state SET total_staked = ?, last_updated = ? WHERE id = 1',
      [totalResult?.total || '0', new Date().toISOString()]
    );

    res.json({
      success: true,
      message: `Migrated ${migrated.length} stakes, ${failed.length} failed`,
      migrated,
      failed
    });
  } catch (error: any) {
    console.error('Error in /debug/migrate-all-custodial:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/debug - Debug endpoint to check config
router.get('/debug', debugAuth, async (req: Request, res: Response) => {
  try {
    const { getTreasuryBalance, getTreasuryPublicKey } = await import('../utils/solana.js');

    let treasuryBalance = 0n;
    let balanceError = null;
    let treasuryAddress = '';

    try {
      treasuryAddress = getTreasuryPublicKey().toBase58();
      treasuryBalance = await getTreasuryBalance();
    } catch (e: any) {
      balanceError = e.message;
    }

    res.json({
      config: {
        solanaRpcUrl: config.solanaRpcUrl,
        treasuryWallet: config.treasuryWallet ? config.treasuryWallet.substring(0, 8) + '...' : 'NOT SET',
        treasuryWalletFull: treasuryAddress || 'ERROR',
        tokenMint: config.tokenMint ? config.tokenMint.substring(0, 8) + '...' : 'NOT SET',
        tokenDecimals: config.tokenDecimals,
        epochDuration: config.epochDuration,
        hasPrivateKey: !!config.treasuryPrivateKey
      },
      treasury: {
        balance: treasuryBalance.toString(),
        balanceSol: Number(treasuryBalance) / 1e9,
        error: balanceError
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to format tokens with decimals
function formatTokens(amount: bigint): string {
  const divisor = BigInt(10 ** config.tokenDecimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  return `${whole}.${fraction.toString().padStart(config.tokenDecimals, '0')}`;
}

export default router;
