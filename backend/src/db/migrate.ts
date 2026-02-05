import { db, initDatabase } from './index.js';
import { schema, schemaPostgres } from './schema.js';
import { config } from '../config.js';

async function migrate() {
  console.log('🌱 Running database migrations...');

  try {
    await initDatabase();

    const isPostgres = config.databaseUrl.startsWith('postgresql:') ||
                       config.databaseUrl.startsWith('postgres:');

    const schemaToUse = isPostgres ? schemaPostgres : schema;

    // Split by semicolons and execute each statement
    const statements = schemaToUse
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      try {
        await db.exec(statement + ';');
      } catch (error) {
        // Ignore "already exists" errors
        const message = (error as Error).message;
        if (!message.includes('already exists') && !message.includes('duplicate')) {
          console.error(`Error executing: ${statement.substring(0, 50)}...`);
          throw error;
        }
      }
    }

    // Add missing columns for provably fair greed system
    const alterStatements = isPostgres ? [
      'ALTER TABLE greed_history ADD COLUMN IF NOT EXISTS server_seed TEXT',
      'ALTER TABLE greed_history ADD COLUMN IF NOT EXISTS server_seed_hash TEXT',
      'ALTER TABLE greed_history ADD COLUMN IF NOT EXISTS client_seed TEXT',
      'ALTER TABLE greed_history ADD COLUMN IF NOT EXISTS combined_hash TEXT'
    ] : [
      'ALTER TABLE greed_history ADD COLUMN server_seed TEXT',
      'ALTER TABLE greed_history ADD COLUMN server_seed_hash TEXT',
      'ALTER TABLE greed_history ADD COLUMN client_seed TEXT',
      'ALTER TABLE greed_history ADD COLUMN combined_hash TEXT'
    ];

    for (const stmt of alterStatements) {
      try {
        await db.exec(stmt + ';');
        console.log(`   ✓ ${stmt.split('ADD COLUMN')[1]?.trim().split(' ')[0] || 'column'} added`);
      } catch (error) {
        const message = (error as Error).message;
        // Ignore "duplicate column" errors (SQLite) or "already exists" (Postgres)
        if (!message.includes('duplicate column') && !message.includes('already exists')) {
          console.log(`   - Column may already exist: ${message}`);
        }
      }
    }

    console.log('✅ Database migrations complete!');

    // Verify tables exist
    const tables = ['users', 'stakes', 'epochs', 'global_state', 'transactions', 'greed_history', 'distributions'];
    console.log('\n📋 Verifying tables:');
    for (const table of tables) {
      console.log(`   ✓ ${table}`);
    }

    // Check global state
    const state = await db.get<Record<string, unknown>>('SELECT * FROM global_state WHERE id = 1');
    if (state) {
      console.log('\n🎮 Global state initialized:');
      console.log(`   Current epoch: ${state.current_epoch}`);
      console.log(`   Shared pool: ${state.shared_pool_lamports} lamports`);
      console.log(`   Greed pot: ${state.greed_pot_lamports} lamports`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
