import { CronJob } from 'cron';
import { config } from '../config.js';
import { finalizeEpoch, getGlobalState } from '../services/epoch.js';
import { formatSol } from '../utils/solana.js';

let isRunning = false;

// Run epoch finalization
async function runEpochFinalization() {
  if (isRunning) {
    console.log('[EPOCH] Previous epoch finalization still running, skipping...');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log('\n[EPOCH] Starting epoch finalization...');

    const result = await finalizeEpoch();

    const duration = Date.now() - startTime;
    console.log(`[EPOCH] Epoch #${result.epochNumber} complete (${duration}ms)`);
    console.log(`  - Fees collected: ${formatSol(BigInt(result.feesCollected))} SOL`);
    console.log(`  - Added to shared pool: ${formatSol(BigInt(result.sharedPoolAddition))} SOL`);
    console.log(`  - Added to greed pot: ${formatSol(BigInt(result.greedPotAddition))} SOL`);
    console.log(`  - Total eligible stake: ${result.totalEligibleStake}`);
    console.log(`  - Quorum reached: ${result.quorumReached}`);

    if (result.distributed) {
      console.log(`  - Distributed to ${result.distributedTo} stakers`);
      console.log(`  - Total distributed: ${formatSol(BigInt(result.totalDistributed))} SOL`);
    } else {
      console.log(`  - No distribution (quorum not reached or no pool)`);
    }

  } catch (error) {
    console.error('[EPOCH] Error during finalization:', error);
  } finally {
    isRunning = false;
  }
}

// Calculate cron expression for epoch duration
function getCronExpression(): string {
  const minutes = Math.floor(config.epochDuration / 60);

  if (minutes <= 0) {
    return '* * * * *';
  } else if (minutes < 60) {
    return `*/${minutes} * * * *`;
  } else {
    return '0 * * * *';
  }
}

// Create and start the cron job
export function startEpochCron(): CronJob {
  const cronExpression = getCronExpression();

  console.log(`[EPOCH] Starting epoch cron job: "${cronExpression}"`);
  console.log(`[EPOCH] Epoch duration: ${config.epochDuration} seconds`);
  console.log(`[EPOCH] Warmup period: ${config.warmupDuration} seconds`);
  console.log(`[EPOCH] Quorum: 7% (1-100) → 14% (101-250) → 21% (251-500)`);

  const job = new CronJob(
    cronExpression,
    runEpochFinalization,
    null,
    true,
    'UTC'
  );

  // Initialize epoch 1 record on startup if needed
  setTimeout(async () => {
    try {
      const state = await getGlobalState();
      console.log(`[EPOCH] Current epoch: ${state.current_epoch}`);

      // Check if epoch 1 record exists, create if not
      const { db } = await import('../db/index.js');
      const epoch1 = await db.get('SELECT * FROM epochs WHERE epoch_number = 1');
      if (!epoch1) {
        console.log('[EPOCH] Initializing epoch 1 record...');
        await db.run(
          `INSERT INTO epochs (epoch_number, started_at, treasury_balance_lamports)
           VALUES (1, ?, 0)`,
          [new Date().toISOString()]
        );
        console.log('[EPOCH] Epoch 1 initialized. Waiting for quorum to advance.');
      }
    } catch (error) {
      console.error('[EPOCH] Error initializing:', error);
    }
  }, 1000);

  return job;
}

// Manual trigger for testing
export async function triggerEpochManually(): Promise<void> {
  await runEpochFinalization();
}
