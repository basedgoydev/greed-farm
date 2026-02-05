'use client';

import { useCallback, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

// Get program ID from env or use placeholder
const STAKING_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_STAKING_PROGRAM_ID || 'GReeD1111111111111111111111111111111111111'
);

const TOKEN_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_TOKEN_MINT || '11111111111111111111111111111111'
);

// Instruction discriminators
const DISCRIMINATORS = {
  stake: Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]),
  unstake: Buffer.from([90, 95, 107, 42, 205, 124, 50, 225]),
};

// PDA derivations
function getStakePoolAddress(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool'), TOKEN_MINT.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

function getVaultAddress(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), TOKEN_MINT.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

function getUserStakeAddress(stakePool: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakePool.toBuffer(), user.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

export function useStakingProgram() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stake = useCallback(
    async (amount: bigint): Promise<string | null> => {
      if (!publicKey || !signTransaction) {
        setError('Wallet not connected');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const [stakePool] = getStakePoolAddress();
        const [vault] = getVaultAddress();
        const [userStake] = getUserStakeAddress(stakePool, publicKey);

        // Get user's token account
        const userTokenAccount = await getAssociatedTokenAddress(
          TOKEN_MINT,
          publicKey
        );

        // Check if user token account exists
        const userTokenAccountInfo = await connection.getAccountInfo(userTokenAccount);

        const transaction = new Transaction();

        // Create ATA if it doesn't exist
        if (!userTokenAccountInfo) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              userTokenAccount,
              publicKey,
              TOKEN_MINT
            )
          );
        }

        // Build stake instruction
        const keys = [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: stakePool, isSigner: false, isWritable: true },
          { pubkey: userStake, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: userTokenAccount, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ];

        // Encode amount as u64 little-endian
        const amountBuffer = Buffer.alloc(8);
        const amountBigInt = BigInt(amount);
        for (let i = 0; i < 8; i++) {
          amountBuffer[i] = Number((amountBigInt >> BigInt(i * 8)) & BigInt(0xff));
        }

        const data = Buffer.concat([DISCRIMINATORS.stake, amountBuffer]);

        transaction.add(
          new TransactionInstruction({
            keys,
            programId: STAKING_PROGRAM_ID,
            data,
          })
        );

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        // Sign and send
        const signed = await signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signed.serialize());

        // Confirm
        await connection.confirmTransaction(signature, 'confirmed');

        return signature;
      } catch (err: any) {
        console.error('Stake error:', err);
        setError(err.message || 'Failed to stake');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [publicKey, signTransaction, connection]
  );

  const unstake = useCallback(async (): Promise<string | null> => {
    if (!publicKey || !signTransaction) {
      setError('Wallet not connected');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const [stakePool] = getStakePoolAddress();
      const [vault] = getVaultAddress();
      const [userStake] = getUserStakeAddress(stakePool, publicKey);

      // Get user's token account
      const userTokenAccount = await getAssociatedTokenAddress(
        TOKEN_MINT,
        publicKey
      );

      // Build unstake instruction
      const keys = [
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: stakePool, isSigner: false, isWritable: true },
        { pubkey: userStake, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      const transaction = new Transaction();
      transaction.add(
        new TransactionInstruction({
          keys,
          programId: STAKING_PROGRAM_ID,
          data: DISCRIMINATORS.unstake,
        })
      );

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign and send
      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      // Confirm
      await connection.confirmTransaction(signature, 'confirmed');

      return signature;
    } catch (err: any) {
      console.error('Unstake error:', err);
      setError(err.message || 'Failed to unstake');
      return null;
    } finally {
      setLoading(false);
    }
  }, [publicKey, signTransaction, connection]);

  return {
    stake,
    unstake,
    loading,
    error,
    programId: STAKING_PROGRAM_ID.toBase58(),
    vaultAddress: getVaultAddress()[0].toBase58(),
  };
}
