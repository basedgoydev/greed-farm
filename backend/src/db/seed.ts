import { db } from './index.js';
import { config } from '../config.js';
import { initDatabase } from './index.js';

async function seed() {
  console.log('🌱 Seeding database with test data...');

  await initDatabase();

  const isPostgres = config.databaseUrl.startsWith('postgresql:') ||
                     config.databaseUrl.startsWith('postgres:');

  try {
    const testWallets = [
      'TestWallet1111111111111111111111111111111111',
      'TestWallet2222222222222222222222222222222222',
      'TestWallet3333333333333333333333333333333333',
    ];

    for (const wallet of testWallets) {
      const sql = isPostgres
        ? `INSERT INTO users (wallet, claimable_lamports, total_claimed_lamports)
           VALUES (?, ?, ?)
           ON CONFLICT (wallet) DO NOTHING`
        : `INSERT OR IGNORE INTO users (wallet, claimable_lamports, total_claimed_lamports)
           VALUES (?, ?, ?)`;
      await db.run(sql, [wallet, '1000000000', '0']);
    }

    const sharedPoolLamports = '5000000000';
    const greedPotLamports = '2000000000';

    await db.run(
      `UPDATE global_state
       SET shared_pool_lamports = ?,
           greed_pot_lamports = ?,
           current_epoch = 1,
           last_updated = ?
       WHERE id = 1`,
      [sharedPoolLamports, greedPotLamports, new Date().toISOString()]
    );

    const epochSql = isPostgres
      ? `INSERT INTO epochs (epoch_number, started_at, treasury_balance_lamports)
         VALUES (?, ?, ?)
         ON CONFLICT (epoch_number) DO NOTHING`
      : `INSERT OR IGNORE INTO epochs (epoch_number, started_at, treasury_balance_lamports)
         VALUES (?, ?, ?)`;
    await db.run(epochSql, [1, new Date().toISOString(), '10000000000']);

    console.log('✅ Database seeded successfully!');
    console.log('');
    console.log('📊 Test data created:');
    console.log(`   - ${testWallets.length} test users with 1 SOL claimable each`);
    console.log(`   - Shared pool: 5 SOL`);
    console.log(`   - Greed pot: 2 SOL`);
    console.log(`   - Initial epoch started`);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
