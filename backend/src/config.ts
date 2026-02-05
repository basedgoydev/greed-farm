import dotenv from 'dotenv';
dotenv.config();

// Validate critical environment variables in production
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  const requiredEnvVars = ['JWT_SECRET', 'TREASURY_WALLET', 'TREASURY_PRIVATE_KEY', 'TOKEN_MINT'];
  const missing = requiredEnvVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[SECURITY] Missing required environment variables in production: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.JWT_SECRET === 'dev-secret-change-me') {
    console.error('[SECURITY] JWT_SECRET must be changed from default value in production');
    process.exit(1);
  }
}

export const config = {
  // Database
  databaseUrl: process.env.DATABASE_URL || 'sqlite:./dev.db',

  // Solana
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  treasuryWallet: process.env.TREASURY_WALLET || '',
  treasuryPrivateKey: process.env.TREASURY_PRIVATE_KEY || '',
  tokenMint: process.env.TOKEN_MINT || '',

  // Token
  totalTokenSupply: BigInt(process.env.TOTAL_TOKEN_SUPPLY || '1000000000'),
  tokenDecimals: parseInt(process.env.TOKEN_DECIMALS || '6'),

  // Server
  port: parseInt(process.env.PORT || '3001'),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',

  // Game mechanics (in seconds)
  epochDuration: parseInt(process.env.EPOCH_DURATION || '900'), // 15 minutes
  warmupDuration: parseInt(process.env.WARMUP_DURATION || '300'), // 5 minutes
  sharedPoolPercentage: parseInt(process.env.SHARED_POOL_PERCENTAGE || '80'),
  greedPotPercentage: parseInt(process.env.GREED_POT_PERCENTAGE || '20'),

  get lamportsPerSol() {
    return 1_000_000_000n;
  }
};

// Dynamic quorum based on epoch number
// Epoch 1-100: 7%, Epoch 101-250: 14%, Epoch 251-500: 21%
export function getQuorumPercentage(epochNumber: number): number {
  if (epochNumber <= 100) return 7;
  if (epochNumber <= 250) return 14;
  if (epochNumber <= 500) return 21;
  return 21; // Default after epoch 500
}

export function getQuorumThreshold(epochNumber: number): bigint {
  const percentage = getQuorumPercentage(epochNumber);
  return (config.totalTokenSupply * BigInt(percentage)) / 100n;
}
