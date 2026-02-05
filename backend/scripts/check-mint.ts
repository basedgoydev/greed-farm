import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

const TOKEN_MINT = 'Few5c3UE7gjeWkqsFMtzPGh2TCmaiN7Kg6ohoN6pc4ae';

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const mint = await getMint(connection, new PublicKey(TOKEN_MINT));
  
  console.log('Token Mint:', TOKEN_MINT);
  console.log('Decimals:', mint.decimals);
  console.log('Supply:', mint.supply.toString());
  console.log('Mint Authority:', mint.mintAuthority?.toBase58() || 'NONE (frozen)');
  console.log('Freeze Authority:', mint.freezeAuthority?.toBase58() || 'NONE');
}

main().catch(console.error);
