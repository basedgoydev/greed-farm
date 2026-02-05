import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const AMOUNT_SOL = parseFloat(process.argv[2] || '0.5');

async function main() {
  const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');

  // Load treasury keypair
  const keysPath = path.join(process.cwd(), 'keys', 'treasury.json');
  const keypairData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  const treasury = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log(`Treasury: ${treasury.publicKey.toBase58()}`);

  const balance = await connection.getBalance(treasury.publicKey);
  console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // The trick: send SOL from treasury to itself
  // This doesn't change total balance but triggers a transaction
  // Actually, we need SOL to "arrive" - let's just log the balance
  // The epoch cron will detect balance changes

  console.log(`\nTo simulate fees, the treasury needs to RECEIVE SOL.`);
  console.log(`Since this is devnet, you can:`);
  console.log(`1. Airdrop to treasury: solana airdrop 1 ${treasury.publicKey.toBase58()} --url devnet`);
  console.log(`2. Or send from another wallet`);
  console.log(`\nAfter adding SOL, wait for the next epoch (60 seconds) and the fees will appear.`);
}

main().catch(console.error);
