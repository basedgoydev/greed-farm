import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Keypair,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { config } from '../config.js';
import BN from 'bn.js';

// Program ID - UPDATE THIS after deployment
export const STAKING_PROGRAM_ID = new PublicKey(
  process.env.STAKING_PROGRAM_ID || 'HQ6hdQikYcCMxrMo6kXayYXYn5RPQmRLwZswiUjytuiy'
);

// Get connection
function getConnection(): Connection {
  return new Connection(config.solanaRpcUrl, 'confirmed');
}

// Derive PDA addresses
export function getStakePoolAddress(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool'), tokenMint.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

export function getVaultAddress(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), tokenMint.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

export function getUserStakeAddress(stakePool: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakePool.toBuffer(), user.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

// Instruction discriminators (first 8 bytes of sha256 hash of instruction name)
const INSTRUCTION_DISCRIMINATORS = {
  initialize: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
  stake: Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]),
  unstake: Buffer.from([90, 95, 107, 42, 205, 124, 50, 225]),
};

// Build initialize instruction (Token-2022)
export function buildInitializeInstruction(
  authority: PublicKey,
  tokenMint: PublicKey,
  decimals: number = 6
): TransactionInstruction {
  const [stakePool] = getStakePoolAddress(tokenMint);
  const [vault] = getVaultAddress(tokenMint);

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: tokenMint, isSigner: false, isWritable: false },
    { pubkey: stakePool, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  // Add decimals to instruction data
  const decimalsBuffer = Buffer.alloc(1);
  decimalsBuffer.writeUInt8(decimals, 0);
  const data = Buffer.concat([INSTRUCTION_DISCRIMINATORS.initialize, decimalsBuffer]);

  return new TransactionInstruction({
    keys,
    programId: STAKING_PROGRAM_ID,
    data,
  });
}

// Build stake instruction (Token-2022)
export function buildStakeInstruction(
  user: PublicKey,
  tokenMint: PublicKey,
  userTokenAccount: PublicKey,
  amount: bigint
): TransactionInstruction {
  const [stakePool] = getStakePoolAddress(tokenMint);
  const [vault] = getVaultAddress(tokenMint);
  const [userStake] = getUserStakeAddress(stakePool, user);

  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: stakePool, isSigner: false, isWritable: true },
    { pubkey: tokenMint, isSigner: false, isWritable: false },
    { pubkey: userStake, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Encode amount as u64 little-endian
  const amountBuffer = Buffer.alloc(8);
  new BN(amount.toString()).toArrayLike(Buffer, 'le', 8).copy(amountBuffer);

  const data = Buffer.concat([INSTRUCTION_DISCRIMINATORS.stake, amountBuffer]);

  return new TransactionInstruction({
    keys,
    programId: STAKING_PROGRAM_ID,
    data,
  });
}

// Build unstake instruction (Token-2022)
export function buildUnstakeInstruction(
  user: PublicKey,
  tokenMint: PublicKey,
  userTokenAccount: PublicKey
): TransactionInstruction {
  const [stakePool] = getStakePoolAddress(tokenMint);
  const [vault] = getVaultAddress(tokenMint);
  const [userStake] = getUserStakeAddress(stakePool, user);

  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: stakePool, isSigner: false, isWritable: true },
    { pubkey: tokenMint, isSigner: false, isWritable: false },
    { pubkey: userStake, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: STAKING_PROGRAM_ID,
    data: INSTRUCTION_DISCRIMINATORS.unstake,
  });
}

// Fetch user stake from chain
export async function fetchUserStake(
  userWallet: string
): Promise<{ amount: bigint; stakedAt: number } | null> {
  try {
    const connection = getConnection();
    const tokenMint = new PublicKey(config.tokenMint);
    const user = new PublicKey(userWallet);

    const [stakePool] = getStakePoolAddress(tokenMint);
    const [userStakeAddress] = getUserStakeAddress(stakePool, user);

    const accountInfo = await connection.getAccountInfo(userStakeAddress);
    if (!accountInfo) {
      return null;
    }

    // Parse UserStake account data
    // Skip 8-byte discriminator
    const data = accountInfo.data.slice(8);

    // owner: Pubkey (32 bytes)
    // amount: u64 (8 bytes)
    // staked_at: i64 (8 bytes)
    // bump: u8 (1 byte)

    const amount = new BN(data.slice(32, 40), 'le').toString();
    const stakedAt = new BN(data.slice(40, 48), 'le').toNumber();

    return {
      amount: BigInt(amount),
      stakedAt,
    };
  } catch (error) {
    console.error('Error fetching user stake:', error);
    return null;
  }
}

// Fetch total staked from pool
export async function fetchTotalStaked(): Promise<bigint> {
  try {
    const connection = getConnection();
    const tokenMint = new PublicKey(config.tokenMint);
    const [stakePoolAddress] = getStakePoolAddress(tokenMint);

    const accountInfo = await connection.getAccountInfo(stakePoolAddress);
    if (!accountInfo) {
      return 0n;
    }

    // Parse StakePool account data
    // Skip 8-byte discriminator
    const data = accountInfo.data.slice(8);

    // authority: Pubkey (32 bytes)
    // token_mint: Pubkey (32 bytes)
    // vault: Pubkey (32 bytes)
    // total_staked: u64 (8 bytes)
    // bump: u8 (1 byte)
    // vault_bump: u8 (1 byte)
    // decimals: u8 (1 byte)

    const totalStaked = new BN(data.slice(96, 104), 'le').toString();
    return BigInt(totalStaked);
  } catch (error) {
    console.error('Error fetching total staked:', error);
    return 0n;
  }
}

// Check if stake pool is initialized
export async function isPoolInitialized(): Promise<boolean> {
  try {
    const connection = getConnection();
    const tokenMint = new PublicKey(config.tokenMint);
    const [stakePoolAddress] = getStakePoolAddress(tokenMint);

    const accountInfo = await connection.getAccountInfo(stakePoolAddress);
    return accountInfo !== null;
  } catch (error) {
    return false;
  }
}

// Get vault address for token deposits
export function getVaultAddressString(): string {
  const tokenMint = new PublicKey(config.tokenMint);
  const [vault] = getVaultAddress(tokenMint);
  return vault.toBase58();
}

// Fetch ALL user stakes from on-chain using getProgramAccounts
// This scans all UserStake PDAs to find every staker
export async function fetchAllOnChainStakes(): Promise<Array<{
  wallet: string;
  amount: bigint;
  stakedAt: number;
}>> {
  try {
    const connection = getConnection();
    const tokenMint = new PublicKey(config.tokenMint);
    const [stakePool] = getStakePoolAddress(tokenMint);

    // UserStake accounts have a specific structure:
    // 8 bytes discriminator + 32 bytes owner + 8 bytes amount + 8 bytes staked_at + 1 byte bump
    // Total: 57 bytes (but Anchor pads to 8-byte alignment, so likely 64 bytes)

    // Filter by the stake_pool in the PDA seeds - we look for accounts that start with "user_stake" seed
    const accounts = await connection.getProgramAccounts(STAKING_PROGRAM_ID, {
      filters: [
        // Filter by account size (UserStake struct size)
        { dataSize: 57 }, // 8 discriminator + 32 owner + 8 amount + 8 staked_at + 1 bump
      ],
    });

    console.log(`[SYNC] Found ${accounts.length} potential stake accounts on-chain`);

    const stakes: Array<{ wallet: string; amount: bigint; stakedAt: number }> = [];

    for (const account of accounts) {
      try {
        const data = account.account.data;

        // Skip 8-byte discriminator
        const accountData = data.slice(8);

        // owner: Pubkey (32 bytes)
        const ownerBytes = accountData.slice(0, 32);
        const owner = new PublicKey(ownerBytes).toBase58();

        // amount: u64 (8 bytes)
        const amount = new BN(accountData.slice(32, 40), 'le').toString();

        // staked_at: i64 (8 bytes)
        const stakedAt = new BN(accountData.slice(40, 48), 'le').toNumber();

        const amountBigInt = BigInt(amount);

        // Only include stakes with amount > 0
        if (amountBigInt > 0n) {
          stakes.push({
            wallet: owner,
            amount: amountBigInt,
            stakedAt,
          });
        }
      } catch (parseError) {
        // Skip accounts that don't parse correctly (might be different account type)
        continue;
      }
    }

    console.log(`[SYNC] Parsed ${stakes.length} active stakes from on-chain`);
    return stakes;
  } catch (error) {
    console.error('Error fetching all on-chain stakes:', error);
    return [];
  }
}
