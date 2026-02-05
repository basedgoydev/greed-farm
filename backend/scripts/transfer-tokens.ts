import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, transfer } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const RECIPIENT = process.argv[2];
const AMOUNT = process.argv[3] || '100000000'; // Default 100M tokens

if (!RECIPIENT) {
  console.error('Usage: tsx scripts/transfer-tokens.ts <recipient-wallet> [amount]');
  process.exit(1);
}

async function main() {
  const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');

  // Load treasury keypair
  const keysPath = path.join(process.cwd(), 'keys', 'treasury.json');
  const keypairData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  const treasury = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  const tokenMint = new PublicKey(process.env.TOKEN_MINT!);
  const recipient = new PublicKey(RECIPIENT);
  const decimals = parseInt(process.env.TOKEN_DECIMALS || '6');

  console.log(`Transferring tokens...`);
  console.log(`From: ${treasury.publicKey.toBase58()}`);
  console.log(`To: ${recipient.toBase58()}`);
  console.log(`Token: ${tokenMint.toBase58()}`);

  // Get treasury token account
  const fromAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury,
    tokenMint,
    treasury.publicKey
  );

  // Get or create recipient token account
  const toAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury, // payer
    tokenMint,
    recipient
  );

  const amount = BigInt(AMOUNT) * BigInt(10 ** decimals);

  const sig = await transfer(
    connection,
    treasury,
    fromAccount.address,
    toAccount.address,
    treasury,
    amount
  );

  console.log(`\n✅ Transferred ${AMOUNT} tokens`);
  console.log(`Transaction: ${sig}`);
  console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch(console.error);
