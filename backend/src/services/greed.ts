import { db, toBigInt, type User } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { createHash, createHmac, randomBytes } from 'crypto';
import { getGlobalState } from './epoch.js';
import { safeAdd, safeSub, percentage, calculateGreedPayout } from '../utils/math.js';

interface GreedResult {
  success: boolean;
  message: string;
  won?: boolean;
  riskAmount?: string;
  payoutAmount?: string;
  newClaimable?: string;
  newGreedPot?: string;
  greedId?: number;
  serverSeed?: string;
}

interface CommitmentResult {
  success: boolean;
  message: string;
  commitmentId?: string;
  serverSeedHash?: string;
  expiresAt?: number;
}

interface VerifyResult {
  success: boolean;
  message: string;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed?: string;
  combinedHash?: string;
  won?: boolean;
  instructions?: string;
}

interface DbCommitment {
  id: string;
  wallet: string;
  server_seed: string;
  server_seed_hash: string;
  expires_at: number;
  used: boolean;
}

// Commitment TTL (5 minutes)
const COMMITMENT_TTL_MS = 5 * 60 * 1000;

// Clean up expired commitments periodically (from database)
setInterval(async () => {
  try {
    const now = Date.now();
    await db.run('DELETE FROM greed_commitments WHERE expires_at < ? OR used = TRUE', [now]);
  } catch (error) {
    console.error('Error cleaning up expired commitments:', error);
  }
}, 60 * 1000); // Check every minute

// Valid risk percentages
const VALID_RISK_PERCENTAGES = [25, 50, 100] as const;
type RiskPercentage = typeof VALID_RISK_PERCENTAGES[number];

// Win probability for greed gamble (50%)
const WIN_PROBABILITY = 0.5;

// Generate cryptographically random boolean for win/lose (legacy, kept for reference)
function rollDice(): boolean {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] / (0xFFFFFFFF + 1) < WIN_PROBABILITY;
}

// Calculate deterministic outcome from server and client seeds
function calculateOutcome(serverSeed: string, clientSeed: string): { won: boolean; combinedHash: string } {
  const combined = createHmac('sha256', serverSeed)
    .update(clientSeed)
    .digest('hex');

  // Use first 8 chars as hex number, check if < 50% of max
  const roll = parseInt(combined.substring(0, 8), 16);
  const maxValue = 0xFFFFFFFF;
  const won = roll < maxValue * WIN_PROBABILITY;

  return { won, combinedHash: combined };
}

// Create a commitment for provably fair gambling
export async function createCommitment(wallet: string): Promise<CommitmentResult> {
  const now = Date.now();

  // Check if wallet already has a pending commitment in database
  const existing = await db.get<DbCommitment>(
    'SELECT * FROM greed_commitments WHERE wallet = ? AND used = FALSE AND expires_at > ?',
    [wallet, now]
  );

  if (existing) {
    return {
      success: true,
      message: 'Existing commitment found',
      commitmentId: existing.id,
      serverSeedHash: existing.server_seed_hash,
      expiresAt: existing.expires_at
    };
  }

  // Generate new server seed
  const serverSeed = randomBytes(32).toString('hex');
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex');
  const commitmentId = uuidv4();
  const expiresAt = now + COMMITMENT_TTL_MS;

  // Store commitment in database
  await db.run(
    'INSERT INTO greed_commitments (id, wallet, server_seed, server_seed_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [commitmentId, wallet, serverSeed, serverSeedHash, expiresAt]
  );

  return {
    success: true,
    message: 'Commitment created',
    commitmentId,
    serverSeedHash,
    expiresAt
  };
}

// Perform a greed gamble with provably fair commit-reveal scheme
export async function greed(
  wallet: string,
  riskPercentage: number,
  commitmentId: string,
  clientSeed: string
): Promise<GreedResult> {
  if (!VALID_RISK_PERCENTAGES.includes(riskPercentage as RiskPercentage)) {
    return {
      success: false,
      message: `Invalid risk percentage. Must be one of: ${VALID_RISK_PERCENTAGES.join(', ')}`
    };
  }

  // Validate client seed early
  if (!clientSeed || clientSeed.length < 8) {
    return {
      success: false,
      message: 'Invalid client seed. Must be at least 8 characters.'
    };
  }

  // Atomically claim the commitment using a transaction
  // This prevents race conditions where two requests try to use the same commitment
  return db.transaction(async () => {
    // Fetch and lock the commitment
    const commitment = await db.get<DbCommitment>(
      'SELECT * FROM greed_commitments WHERE id = ? AND used = FALSE',
      [commitmentId]
    );

    if (!commitment) {
      return {
        success: false,
        message: 'Invalid or expired commitment. Please request a new commitment.'
      };
    }

    if (commitment.wallet !== wallet) {
      return {
        success: false,
        message: 'Commitment does not belong to this wallet'
      };
    }

    if (commitment.expires_at < Date.now()) {
      await db.run('UPDATE greed_commitments SET used = TRUE WHERE id = ?', [commitmentId]);
      return {
        success: false,
        message: 'Commitment has expired. Please request a new commitment.'
      };
    }

    // Mark commitment as used immediately (within transaction)
    await db.run('UPDATE greed_commitments SET used = TRUE WHERE id = ?', [commitmentId]);

    const serverSeed = commitment.server_seed;
    const serverSeedHash = commitment.server_seed_hash;
    const txId = uuidv4();

    const user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);
    if (!user) {
      return {
        success: false,
        message: 'User not found'
      };
    }

    const claimable = toBigInt(user.claimable_lamports);
    if (claimable <= 0n) {
      return {
        success: false,
        message: 'No claimable rewards to risk'
      };
    }

    const riskAmount = percentage(claimable, riskPercentage);
    if (riskAmount <= 0n) {
      return {
        success: false,
        message: 'Risk amount too small'
      };
    }

    const state = await getGlobalState();
    const greedPot = toBigInt(state.greed_pot_lamports);

    // Calculate deterministic outcome
    const { won, combinedHash } = calculateOutcome(serverSeed, clientSeed);
    const { payout, newGreedPot } = calculateGreedPayout(riskAmount, greedPot, won);

    const now = new Date().toISOString();
    let newClaimable: bigint;

    if (won) {
      newClaimable = safeAdd(claimable, payout);
      await db.run(
        `UPDATE users
         SET claimable_lamports = ?,
             total_won_lamports = total_won_lamports + ?,
             updated_at = ?
         WHERE id = ?`,
        [newClaimable.toString(), payout.toString(), now, user.id]
      );
    } else {
      newClaimable = safeSub(claimable, riskAmount);
      await db.run(
        `UPDATE users
         SET claimable_lamports = ?,
             total_lost_lamports = total_lost_lamports + ?,
             updated_at = ?
         WHERE id = ?`,
        [newClaimable.toString(), riskAmount.toString(), now, user.id]
      );
    }

    await db.run(
      'UPDATE global_state SET greed_pot_lamports = ?, last_updated = ? WHERE id = 1',
      [newGreedPot.toString(), now]
    );

    await db.run(
      `INSERT INTO greed_history (user_id, epoch_number, risk_lamports, risk_percentage, won, payout_lamports, server_seed, server_seed_hash, client_seed, combined_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.id, state.current_epoch, riskAmount.toString(), riskPercentage, won ? 1 : 0, payout.toString(), serverSeed, serverSeedHash, clientSeed, combinedHash]
    );

    // Get the last inserted greed history ID
    const lastInsert = await db.get<{ id: number }>(
      'SELECT id FROM greed_history WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [user.id]
    );

    await db.run(
      'INSERT INTO transactions (tx_id, user_id, action, amount_lamports, status) VALUES (?, ?, ?, ?, ?)',
      [txId, user.id, 'greed', riskAmount.toString(), 'completed']
    );

    return {
      success: true,
      message: won ? 'You won! Greed paid off!' : 'You lost. The pot grows...',
      won,
      riskAmount: riskAmount.toString(),
      payoutAmount: payout.toString(),
      newClaimable: newClaimable.toString(),
      newGreedPot: newGreedPot.toString(),
      greedId: lastInsert?.id,
      serverSeed
    };
  });
}

// Get greed history for a user
export async function getGreedHistory(wallet: string, limit: number = 20): Promise<Array<{
  id: number;
  epochNumber: number;
  riskAmount: string;
  riskPercentage: number;
  won: boolean;
  payoutAmount: string;
  createdAt: string;
  hasVerificationData: boolean;
}>> {
  const user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);
  if (!user) {
    return [];
  }

  const history = await db.all<{
    id: number;
    epoch_number: number;
    risk_lamports: string;
    risk_percentage: number;
    won: number;
    payout_lamports: string;
    created_at: string;
    server_seed: string | null;
  }>(
    `SELECT id, epoch_number, risk_lamports, risk_percentage, won, payout_lamports, created_at, server_seed
     FROM greed_history
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [user.id, limit]
  );

  return history.map(h => ({
    id: h.id,
    epochNumber: h.epoch_number,
    riskAmount: h.risk_lamports,
    riskPercentage: h.risk_percentage,
    won: Boolean(h.won),
    payoutAmount: h.payout_lamports,
    createdAt: h.created_at,
    hasVerificationData: h.server_seed !== null
  }));
}

// Verify a past greed gamble
export async function verifyGreed(greedId: number): Promise<VerifyResult> {
  const record = await db.get<{
    server_seed: string | null;
    server_seed_hash: string | null;
    client_seed: string | null;
    combined_hash: string | null;
    won: number;
  }>(
    `SELECT server_seed, server_seed_hash, client_seed, combined_hash, won
     FROM greed_history
     WHERE id = ?`,
    [greedId]
  );

  if (!record) {
    return {
      success: false,
      message: 'Greed record not found'
    };
  }

  if (!record.server_seed || !record.client_seed) {
    return {
      success: false,
      message: 'This greed gamble was made before provably fair system was implemented'
    };
  }

  return {
    success: true,
    message: 'Verification data retrieved',
    serverSeed: record.server_seed,
    serverSeedHash: record.server_seed_hash!,
    clientSeed: record.client_seed,
    combinedHash: record.combined_hash!,
    won: Boolean(record.won),
    instructions: `To verify this bet:
1. Verify commitment: SHA256("${record.server_seed}") should equal "${record.server_seed_hash}"
2. Verify outcome: HMAC-SHA256 with server seed as key and client seed "${record.client_seed}" as message should equal "${record.combined_hash}"
3. The first 8 hex characters of the combined hash (${record.combined_hash!.substring(0, 8)}) converted to decimal (${parseInt(record.combined_hash!.substring(0, 8), 16)}) should be ${Boolean(record.won) ? 'less than' : 'greater than or equal to'} 2147483647 (50% threshold)`
  };
}

// Get greed pot size
export async function getGreedPotSize(): Promise<bigint> {
  const state = await getGlobalState();
  return toBigInt(state.greed_pot_lamports);
}

// Get greed stats
export async function getGreedStats(): Promise<{
  totalGambles: number;
  totalWins: number;
  totalLosses: number;
  totalRisked: string;
  totalPaidOut: string;
  currentPot: string;
}> {
  const stats = await db.get<{
    total_gambles: number;
    total_wins: number;
    total_risked: string;
    total_paid: string;
  }>(
    `SELECT
       COUNT(*) as total_gambles,
       SUM(CASE WHEN won = TRUE THEN 1 ELSE 0 END) as total_wins,
       SUM(risk_lamports) as total_risked,
       SUM(payout_lamports) as total_paid
     FROM greed_history`
  );

  const pot = await getGreedPotSize();

  return {
    totalGambles: stats?.total_gambles || 0,
    totalWins: stats?.total_wins || 0,
    totalLosses: (stats?.total_gambles || 0) - (stats?.total_wins || 0),
    totalRisked: stats?.total_risked || '0',
    totalPaidOut: stats?.total_paid || '0',
    currentPot: pot.toString()
  };
}
