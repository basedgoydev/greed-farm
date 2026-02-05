/**
 * Initialize the GreedFi staking pool
 * Run this ONCE after deploying the program
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

// Token-2022 Program ID
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// Configuration
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const PROGRAM_ID = new PublicKey(process.env.STAKING_PROGRAM_ID || 'GReeD1111111111111111111111111111111111111');
const TOKEN_MINT = new PublicKey(process.env.TOKEN_MINT || '');
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || '6');

// Load wallet from file or env
function loadWallet(): Keypair {
  // Try environment variable first (base58)
  if (process.env.AUTHORITY_PRIVATE_KEY) {
    const bs58 = require('bs58');
    return Keypair.fromSecretKey(bs58.decode(process.env.AUTHORITY_PRIVATE_KEY));
  }

  // Try default Solana wallet
  const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  if (fs.existsSync(walletPath)) {
    const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  throw new Error('No wallet found. Set AUTHORITY_PRIVATE_KEY or configure Solana CLI wallet.');
}

// PDA derivations
function getStakePoolAddress(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool'), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );
}

function getVaultAddress(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );
}

async function main() {
  console.log('========================================');
  console.log('  GreedFi Stake Pool Initialization');
  console.log('  (Token-2022 Support)');
  console.log('========================================');
  console.log('');

  if (!process.env.TOKEN_MINT) {
    console.error('ERROR: TOKEN_MINT environment variable not set');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`  RPC: ${RPC_URL}`);
  console.log(`  Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`  Token Mint: ${TOKEN_MINT.toBase58()}`);
  console.log(`  Token Decimals: ${TOKEN_DECIMALS}`);
  console.log(`  Token Program: Token-2022`);
  console.log('');

  const connection = new Connection(RPC_URL, 'confirmed');
  const authority = loadWallet();

  console.log(`Authority wallet: ${authority.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  if (balance < 0.05 * 1e9) {
    console.error('ERROR: Insufficient balance. Need at least 0.05 SOL for rent.');
    process.exit(1);
  }

  // Derive PDAs
  const [stakePool, stakePoolBump] = getStakePoolAddress();
  const [vault, vaultBump] = getVaultAddress();

  console.log('');
  console.log('PDAs:');
  console.log(`  Stake Pool: ${stakePool.toBase58()}`);
  console.log(`  Vault: ${vault.toBase58()}`);
  console.log('');

  // Check if already initialized
  const stakePoolInfo = await connection.getAccountInfo(stakePool);
  if (stakePoolInfo) {
    console.log('Stake pool already initialized!');
    process.exit(0);
  }

  // Build initialize instruction
  // Discriminator for "initialize" + decimals (u8)
  const INIT_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  const decimalsBuffer = Buffer.alloc(1);
  decimalsBuffer.writeUInt8(TOKEN_DECIMALS, 0);
  const instructionData = Buffer.concat([INIT_DISCRIMINATOR, decimalsBuffer]);

  const keys = [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: TOKEN_MINT, isSigner: false, isWritable: false },
    { pubkey: stakePool, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: instructionData,
  });

  console.log('Initializing stake pool...');

  const transaction = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(connection, transaction, [authority]);

  console.log('');
  console.log('========================================');
  console.log('  Initialization Complete!');
  console.log('========================================');
  console.log('');
  console.log(`Transaction: ${signature}`);
  console.log(`Stake Pool: ${stakePool.toBase58()}`);
  console.log(`Vault: ${vault.toBase58()}`);
  console.log('');
  console.log('Users can now stake tokens to the vault!');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
