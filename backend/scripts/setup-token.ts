import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.devnet.solana.com';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry<T>(fn: () => Promise<T>, retries = 5, delay = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      console.log(`Attempt ${i + 1} failed: ${e.message}`);
      if (i < retries - 1) {
        console.log(`Retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= 1.5;
      } else {
        throw e;
      }
    }
  }
  throw new Error('Unreachable');
}

async function main() {
  console.log('🚀 Setting up test token on Devnet\n');

  const keysPath = path.join(process.cwd(), 'keys', 'treasury.json');
  const keypairData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  const treasury = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log(`Treasury: ${treasury.publicKey.toBase58()}`);

  const connection = new Connection(RPC_URL, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
  });

  const balance = await connection.getBalance(treasury.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Create token
  console.log('Creating token mint...');
  const mint = await retry(() => createMint(
    connection,
    treasury,
    treasury.publicKey,
    treasury.publicKey,
    6
  ));
  console.log(`Token Mint: ${mint.toBase58()}\n`);

  // Wait a bit for state to propagate
  await sleep(3000);

  // Create token account
  console.log('Creating token account...');
  const tokenAccount = await retry(() => getOrCreateAssociatedTokenAccount(
    connection,
    treasury,
    mint,
    treasury.publicKey
  ));
  console.log(`Token Account: ${tokenAccount.address.toBase58()}\n`);

  // Wait a bit
  await sleep(2000);

  // Mint tokens
  console.log('Minting 1 billion tokens...');
  const amount = BigInt(1_000_000_000) * BigInt(10 ** 6);
  await retry(() => mintTo(
    connection,
    treasury,
    mint,
    tokenAccount.address,
    treasury,
    amount
  ));
  console.log('Minted successfully!\n');

  // Update .env
  const envPath = path.join(process.cwd(), '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(/TOKEN_MINT=.*/, `TOKEN_MINT=${mint.toBase58()}`);
  fs.writeFileSync(envPath, envContent);

  console.log('========================================');
  console.log('Setup Complete!');
  console.log('========================================');
  console.log(`Token Mint: ${mint.toBase58()}`);
  console.log('\nRestart the backend to use new token.');
}

main().catch(console.error);
