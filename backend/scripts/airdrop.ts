import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction, createTransferInstruction } from '@solana/spl-token';
import bs58 from 'bs58';

const TREASURY_PRIVATE_KEY = 'mk98owsXAww1FSAZsYomSAnQ8hU5cGj38QqK9JU9LFPhd8gpkfWs9H6T4Sw2peyV3SDEdrsQfn9jRSQh13k3xJ8';
const TOKEN_MINT = 'Few5c3UE7gjeWkqsFMtzPGh2TCmaiN7Kg6ohoN6pc4ae';
const RECIPIENT = 'C9pUf1vQdDa4193VXpGNU1WqkoVAwqgr59o8m41gwvmr';
const AMOUNT = 100_000_000n * 1_000_000_000n; // 100M tokens with 9 decimals

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  const treasury = Keypair.fromSecretKey(bs58.decode(TREASURY_PRIVATE_KEY));
  const tokenMint = new PublicKey(TOKEN_MINT);
  const recipient = new PublicKey(RECIPIENT);

  console.log('Treasury:', treasury.publicKey.toBase58());
  console.log('Token Mint:', TOKEN_MINT);
  console.log('Recipient:', RECIPIENT);
  console.log('Amount:', AMOUNT.toString(), 'raw units (100M tokens)');

  // Get token accounts
  const treasuryTokenAccount = await getAssociatedTokenAddress(tokenMint, treasury.publicKey);
  const recipientTokenAccount = await getAssociatedTokenAddress(tokenMint, recipient);

  // Check treasury balance
  const treasuryAccount = await getAccount(connection, treasuryTokenAccount);
  console.log('Treasury token balance:', treasuryAccount.amount.toString());

  if (treasuryAccount.amount < AMOUNT) {
    console.error('Insufficient balance in treasury! Has:', treasuryAccount.amount.toString());
    return;
  }

  const transaction = new Transaction();

  // Check if recipient token account exists
  try {
    await getAccount(connection, recipientTokenAccount);
    console.log('Recipient token account exists');
  } catch {
    console.log('Creating recipient token account...');
    transaction.add(
      createAssociatedTokenAccountInstruction(
        treasury.publicKey,
        recipientTokenAccount,
        recipient,
        tokenMint
      )
    );
  }

  // Add transfer instruction
  transaction.add(
    createTransferInstruction(
      treasuryTokenAccount,
      recipientTokenAccount,
      treasury.publicKey,
      AMOUNT
    )
  );

  console.log('Sending transaction...');
  const signature = await sendAndConfirmTransaction(connection, transaction, [treasury]);
  console.log('Success! Signature:', signature);
  console.log('View on Solscan: https://solscan.io/tx/' + signature + '?cluster=devnet');
}

main().catch(console.error);
