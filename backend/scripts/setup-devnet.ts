import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.devnet.solana.com';

async function main() {
  console.log('🚀 Setting up Greed Farm on Devnet\n');

  // Load treasury keypair
  const keysPath = path.join(process.cwd(), 'keys', 'treasury.json');
  const keypairData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  const treasury = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log(`Treasury Wallet: ${treasury.publicKey.toBase58()}`);

  const connection = new Connection(RPC_URL, 'confirmed');

  // Check current balance
  let balance = await connection.getBalance(treasury.publicKey);
  console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // Airdrop if needed
  if (balance < 2 * LAMPORTS_PER_SOL) {
    console.log('\n📦 Requesting airdrop...');
    try {
      const airdropSig = await connection.requestAirdrop(
        treasury.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig, 'confirmed');
      balance = await connection.getBalance(treasury.publicKey);
      console.log(`New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    } catch (e: any) {
      console.log(`Airdrop failed (may have hit rate limit): ${e.message}`);
      console.log('You can request airdrop manually at: https://faucet.solana.com');
    }
  }

  // Create test token with pump.fun metrics (6 decimals)
  console.log('\n🪙 Creating test token (6 decimals like pump.fun)...');

  const mint = await createMint(
    connection,
    treasury,           // payer
    treasury.publicKey, // mint authority
    treasury.publicKey, // freeze authority
    6                   // decimals (pump.fun standard)
  );

  console.log(`Token Mint: ${mint.toBase58()}`);

  // Create token account for treasury
  console.log('\n💰 Creating token account...');
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury,
    mint,
    treasury.publicKey
  );
  console.log(`Token Account: ${tokenAccount.address.toBase58()}`);

  // Mint 1 billion tokens (pump.fun total supply)
  console.log('\n⚡ Minting 1 billion tokens...');
  const amount = BigInt(1_000_000_000) * BigInt(10 ** 6); // 1B with 6 decimals

  await mintTo(
    connection,
    treasury,
    mint,
    tokenAccount.address,
    treasury,
    amount
  );

  console.log('Minted 1,000,000,000 tokens to treasury');

  // Update .env file
  const envPath = path.join(process.cwd(), '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(
    /TOKEN_MINT=.*/,
    `TOKEN_MINT=${mint.toBase58()}`
  );
  fs.writeFileSync(envPath, envContent);
  console.log('\n✅ Updated .env with TOKEN_MINT');

  console.log('\n========================================');
  console.log('Setup Complete!');
  console.log('========================================');
  console.log(`Treasury: ${treasury.publicKey.toBase58()}`);
  console.log(`Token Mint: ${mint.toBase58()}`);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  console.log(`Token Supply: 1,000,000,000`);
  console.log('\nNext steps:');
  console.log('1. Run: npm run dev:backend');
  console.log('2. Run: npm run dev:frontend');
  console.log('3. Connect your Phantom wallet (set to Devnet)');
}

main().catch(console.error);
