import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { config } from '../config.js';

// Initialize Solana connection
export const connection = new Connection(config.solanaRpcUrl, 'confirmed');

// Get treasury keypair from private key
export function getTreasuryKeypair(): Keypair {
  if (!config.treasuryPrivateKey) {
    throw new Error('Treasury private key not configured');
  }
  const secretKey = bs58.decode(config.treasuryPrivateKey);
  return Keypair.fromSecretKey(secretKey);
}

// Get treasury public key
export function getTreasuryPublicKey(): PublicKey {
  if (!config.treasuryWallet) {
    throw new Error('Treasury wallet not configured');
  }
  return new PublicKey(config.treasuryWallet);
}

// Get token mint public key
export function getTokenMint(): PublicKey {
  if (!config.tokenMint) {
    throw new Error('Token mint not configured');
  }
  return new PublicKey(config.tokenMint);
}

// Get SOL balance of treasury wallet
export async function getTreasuryBalance(): Promise<bigint> {
  try {
    const balance = await connection.getBalance(getTreasuryPublicKey());
    return BigInt(balance);
  } catch (error) {
    console.error('Error getting treasury balance:', error);
    // Re-throw the error instead of silently returning 0
    // This prevents false "empty treasury" scenarios
    throw new Error(`Failed to get treasury balance: ${(error as Error).message}`);
  }
}

// Get token balance for a wallet
export async function getTokenBalance(walletAddress: string): Promise<bigint> {
  try {
    const wallet = new PublicKey(walletAddress);
    const tokenMint = getTokenMint();
    const tokenAccount = await getAssociatedTokenAddress(tokenMint, wallet);

    const account = await getAccount(connection, tokenAccount);
    return account.amount;
  } catch (error) {
    // Account doesn't exist or other error
    console.error('Error getting token balance:', error);
    return 0n;
  }
}

// Verify a signed message from a wallet
export function verifySignature(
  message: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = new PublicKey(publicKey).toBytes();

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

// Transfer SOL from treasury to user
export async function transferSolToUser(
  recipientAddress: string,
  lamports: bigint
): Promise<string> {
  const treasury = getTreasuryKeypair();
  const recipient = new PublicKey(recipientAddress);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: treasury.publicKey,
      toPubkey: recipient,
      lamports: lamports
    })
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [treasury]
  );

  return signature;
}

// Transfer tokens from treasury to user (for unstaking)
export async function transferTokensToUser(
  recipientAddress: string,
  amount: bigint
): Promise<string> {
  const treasury = getTreasuryKeypair();
  const recipient = new PublicKey(recipientAddress);
  const tokenMint = getTokenMint();

  // Get token accounts
  const treasuryTokenAccount = await getAssociatedTokenAddress(tokenMint, treasury.publicKey);
  const recipientTokenAccount = await getAssociatedTokenAddress(tokenMint, recipient);

  const transaction = new Transaction().add(
    createTransferInstruction(
      treasuryTokenAccount,
      recipientTokenAccount,
      treasury.publicKey,
      amount
    )
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [treasury]
  );

  return signature;
}

// Get recent SOL transactions to treasury (for fee tracking)
export async function getRecentTreasuryTransactions(
  limit: number = 100
): Promise<Array<{ signature: string; lamports: bigint; timestamp: number }>> {
  try {
    const treasury = getTreasuryPublicKey();
    const signatures = await connection.getSignaturesForAddress(treasury, { limit });

    const transactions: Array<{ signature: string; lamports: bigint; timestamp: number }> = [];

    for (const sig of signatures) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0
        });

        if (tx && tx.meta) {
          const preBalance = tx.meta.preBalances[0];
          const postBalance = tx.meta.postBalances[0];
          const diff = postBalance - preBalance;

          // Only count incoming transactions
          if (diff > 0) {
            transactions.push({
              signature: sig.signature,
              lamports: BigInt(diff),
              timestamp: sig.blockTime || 0
            });
          }
        }
      } catch (error) {
        // Skip failed transaction fetches
        continue;
      }
    }

    return transactions;
  } catch (error) {
    console.error('Error fetching treasury transactions:', error);
    return [];
  }
}

// Format lamports to SOL for display
export function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL;
  if (sol < 0.001) {
    return sol.toFixed(9);
  } else if (sol < 1) {
    return sol.toFixed(6);
  } else if (sol < 100) {
    return sol.toFixed(4);
  } else {
    return sol.toFixed(2);
  }
}

// Validate Solana address
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// Verify a token transfer transaction
export async function verifyTokenTransfer(
  signature: string,
  expectedSender: string,
  expectedAmount: bigint
): Promise<{ valid: boolean; error?: string; actualAmount?: bigint }> {
  try {
    const treasury = getTreasuryPublicKey();
    const tokenMint = getTokenMint();

    // Fetch the transaction
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });

    if (!tx) {
      return { valid: false, error: 'Transaction not found or not confirmed' };
    }

    if (tx.meta?.err) {
      return { valid: false, error: 'Transaction failed on chain' };
    }

    // Get pre and post token balances
    const preBalances = tx.meta?.preTokenBalances || [];
    const postBalances = tx.meta?.postTokenBalances || [];

    // Find the treasury's token account balance change
    let treasuryReceived = 0n;
    let senderSent = 0n;

    for (const post of postBalances) {
      if (post.mint === tokenMint.toBase58() && post.owner === treasury.toBase58()) {
        const pre = preBalances.find(
          p => p.accountIndex === post.accountIndex && p.mint === tokenMint.toBase58()
        );
        const preAmount = BigInt(pre?.uiTokenAmount?.amount || '0');
        const postAmount = BigInt(post.uiTokenAmount?.amount || '0');
        treasuryReceived = postAmount - preAmount;
      }

      if (post.mint === tokenMint.toBase58() && post.owner === expectedSender) {
        const pre = preBalances.find(
          p => p.accountIndex === post.accountIndex && p.mint === tokenMint.toBase58()
        );
        const preAmount = BigInt(pre?.uiTokenAmount?.amount || '0');
        const postAmount = BigInt(post.uiTokenAmount?.amount || '0');
        senderSent = preAmount - postAmount;
      }
    }

    if (treasuryReceived <= 0n) {
      return { valid: false, error: 'No tokens received by treasury' };
    }

    if (treasuryReceived < expectedAmount) {
      return {
        valid: false,
        error: `Insufficient amount: expected ${expectedAmount}, received ${treasuryReceived}`,
        actualAmount: treasuryReceived
      };
    }

    return { valid: true, actualAmount: treasuryReceived };
  } catch (error) {
    console.error('Error verifying token transfer:', error);
    return { valid: false, error: (error as Error).message };
  }
}
