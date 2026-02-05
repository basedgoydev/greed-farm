import { db, toBigInt, type User } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { transferSolToUser, getTreasuryBalance } from '../utils/solana.js';

// Minimum reserve to keep in treasury for transaction fees (0.01 SOL)
const TREASURY_RESERVE_LAMPORTS = 10_000_000n;

interface ClaimResult {
  success: boolean;
  message: string;
  txId?: string;
  solanaSignature?: string;
  amount?: string;
  remainingClaimable?: string;
  partialClaim?: boolean;
}

// Get user's claimable balance
export async function getClaimableBalance(wallet: string): Promise<bigint> {
  const user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);
  if (!user) {
    return 0n;
  }
  return toBigInt(user.claimable_lamports);
}

// Claim SOL rewards (partial claim if treasury has insufficient funds)
export async function claim(wallet: string): Promise<ClaimResult> {
  const txId = uuidv4();

  // Check treasury balance first (outside transaction for accuracy)
  let treasuryBalance: bigint;
  try {
    treasuryBalance = await getTreasuryBalance();
  } catch (error) {
    return {
      success: false,
      message: 'Unable to check treasury balance'
    };
  }

  // Calculate available amount (treasury minus reserve for fees)
  const availableInTreasury = treasuryBalance > TREASURY_RESERVE_LAMPORTS
    ? treasuryBalance - TREASURY_RESERVE_LAMPORTS
    : 0n;

  return db.transaction(async () => {
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
        message: 'No claimable rewards'
      };
    }

    // If treasury is empty, inform user but don't fail
    if (availableInTreasury <= 0n) {
      return {
        success: false,
        message: 'Treasury is currently empty. Your rewards are safe and will be claimable when treasury is funded.',
        remainingClaimable: claimable.toString()
      };
    }

    // Determine actual claim amount (partial if treasury has less)
    const claimAmount = claimable <= availableInTreasury ? claimable : availableInTreasury;
    const remainingClaimable = claimable - claimAmount;
    const isPartialClaim = remainingClaimable > 0n;

    // Create pending transaction record
    await db.run(
      'INSERT INTO transactions (tx_id, user_id, action, amount_lamports, status) VALUES (?, ?, ?, ?, ?)',
      [txId, user.id, 'claim', claimAmount.toString(), 'pending']
    );

    // Update claimable balance (partial or full)
    const now = new Date().toISOString();
    await db.run(
      `UPDATE users
       SET claimable_lamports = ?,
           total_claimed_lamports = total_claimed_lamports + ?,
           updated_at = ?
       WHERE id = ?`,
      [remainingClaimable.toString(), claimAmount.toString(), now, user.id]
    );

    const message = isPartialClaim
      ? `Partial claim initiated. ${(Number(remainingClaimable) / 1e9).toFixed(4)} SOL remains claimable.`
      : 'Claim initiated';

    return {
      success: true,
      message,
      txId,
      amount: claimAmount.toString(),
      remainingClaimable: remainingClaimable.toString(),
      partialClaim: isPartialClaim
    };
  });
}

// Execute the actual SOL transfer (call after claim() succeeds)
export async function executeClaimTransfer(
  txId: string,
  wallet: string,
  amountLamports: bigint
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    // Transfer SOL to user
    const signature = await transferSolToUser(wallet, amountLamports);

    // Update transaction as completed
    const now = new Date().toISOString();
    await db.run(
      'UPDATE transactions SET status = ?, solana_signature = ?, completed_at = ? WHERE tx_id = ?',
      ['completed', signature, now, txId]
    );

    // Update treasury_last_balance to reflect the outgoing claim
    // This ensures fee detection works correctly for the next epoch
    const newTreasuryBalance = await getTreasuryBalance();
    await db.run(
      'UPDATE global_state SET treasury_last_balance = ?, last_updated = ? WHERE id = 1',
      [newTreasuryBalance.toString(), now]
    );

    return { success: true, signature };
  } catch (error) {
    // Mark transaction as failed
    await db.run(
      'UPDATE transactions SET status = ? WHERE tx_id = ?',
      ['failed', txId]
    );

    // Refund the claimable balance
    const user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);
    if (user) {
      await db.run(
        `UPDATE users
         SET claimable_lamports = claimable_lamports + ?,
             total_claimed_lamports = total_claimed_lamports - ?
         WHERE id = ?`,
        [amountLamports.toString(), amountLamports.toString(), user.id]
      );
    }

    return {
      success: false,
      error: (error as Error).message
    };
  }
}

// Get claim history for a user
export async function getClaimHistory(wallet: string, limit: number = 20): Promise<Array<{
  txId: string;
  amount: string;
  status: string;
  signature: string | null;
  createdAt: string;
  completedAt: string | null;
}>> {
  const user = await db.get<User>('SELECT * FROM users WHERE wallet = ?', [wallet]);
  if (!user) {
    return [];
  }

  const transactions = await db.all<{
    tx_id: string;
    amount_lamports: string;
    status: string;
    solana_signature: string | null;
    created_at: string;
    completed_at: string | null;
  }>(
    `SELECT tx_id, amount_lamports, status, solana_signature, created_at, completed_at
     FROM transactions
     WHERE user_id = ? AND action = 'claim'
     ORDER BY created_at DESC
     LIMIT ?`,
    [user.id, limit]
  );

  return transactions.map(t => ({
    txId: t.tx_id,
    amount: t.amount_lamports,
    status: t.status,
    signature: t.solana_signature,
    createdAt: t.created_at,
    completedAt: t.completed_at
  }));
}
