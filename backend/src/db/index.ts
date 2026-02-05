import { config } from '../config.js';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import pg from 'pg';
import fs from 'fs';

export type DbRow = Record<string, unknown>;

// ============== SQLite Adapter ==============

let sqlJsDb: SqlJsDatabase | null = null;
let dbPath: string = './data.db';

async function initSqlite(): Promise<SqlJsDatabase> {
  if (sqlJsDb) return sqlJsDb;

  const SQL = await initSqlJs();

  if (config.databaseUrl.startsWith('sqlite:')) {
    dbPath = config.databaseUrl.replace('sqlite:', '');
  }

  try {
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      sqlJsDb = new SQL.Database(buffer);
      console.log(`[DB] Loaded existing SQLite database from ${dbPath}`);
    } else {
      sqlJsDb = new SQL.Database();
      console.log(`[DB] Created new SQLite database`);
    }
  } catch (error) {
    console.log(`[DB] Creating new SQLite database (${error})`);
    sqlJsDb = new SQL.Database();
  }

  return sqlJsDb;
}

function saveSqliteDb(): void {
  if (!sqlJsDb) return;
  try {
    const data = sqlJsDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (error) {
    console.error('[DB] Error saving SQLite database:', error);
  }
}

// ============== PostgreSQL Setup ==============

let pgPool: pg.Pool | null = null;

function initPostgres(): pg.Pool {
  if (pgPool) return pgPool;

  pgPool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pgPool.on('error', (err) => {
    console.error('[DB] PostgreSQL pool error:', err);
  });

  console.log('[DB] PostgreSQL pool initialized');
  return pgPool;
}

// Convert ? placeholders to $1, $2, etc. for PostgreSQL
function convertPlaceholders(sql: string): string {
  let index = 0;
  let result = sql.replace(/\?/g, () => `$${++index}`);

  // Add ::BIGINT cast for arithmetic operations on lamports/amount/stake columns
  // Match column names ending with _lamports, _amount, _stake, or named total_staked
  result = result.replace(
    /(\w*(?:_lamports|_amount|_stake|total_staked))\s*=\s*\1\s*\+\s*(\$\d+)/gi,
    '$1 = $1 + $2::BIGINT'
  );
  result = result.replace(
    /(\w*(?:_lamports|_amount|_stake|total_staked))\s*=\s*\1\s*-\s*(\$\d+)/gi,
    '$1 = $1 - $2::BIGINT'
  );

  return result;
}


// ============== Unified Database Interface ==============

class Database {
  private sqliteDb: SqlJsDatabase | null = null;
  private pgPool: pg.Pool | null = null;
  private _isPostgres: boolean = false;
  private initialized: boolean = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    this._isPostgres = config.databaseUrl.startsWith('postgresql:') ||
                       config.databaseUrl.startsWith('postgres:');

    if (this._isPostgres) {
      console.log('[DB] Using PostgreSQL database');
      this.pgPool = initPostgres();
      await this.pgPool.query('SELECT 1');
      console.log('[DB] PostgreSQL connection successful');
    } else {
      console.log('[DB] Using SQLite database');
      this.sqliteDb = await initSqlite();
    }

    this.initialized = true;
    console.log('[DB] Database initialized');
  }

  isPostgres(): boolean {
    return this._isPostgres;
  }

  // Async methods for PostgreSQL, sync for SQLite
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (this._isPostgres) {
      const pgSql = convertPlaceholders(sql);
      await this.pgPool!.query(pgSql, params);
    } else {
      this.sqliteDb!.run(sql, params as (string | number | null | Uint8Array)[]);
      saveSqliteDb();
    }
  }

  async get<T = DbRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    if (this._isPostgres) {
      const pgSql = convertPlaceholders(sql);
      const result = await this.pgPool!.query(pgSql, params);
      return result.rows[0] as T | undefined;
    } else {
      const stmt = this.sqliteDb!.prepare(sql);
      stmt.bind(params as (string | number | null | Uint8Array)[]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row as T;
      }
      stmt.free();
      return undefined;
    }
  }

  async all<T = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this._isPostgres) {
      const pgSql = convertPlaceholders(sql);
      const result = await this.pgPool!.query(pgSql, params);
      return result.rows as T[];
    } else {
      const results: T[] = [];
      const stmt = this.sqliteDb!.prepare(sql);
      stmt.bind(params as (string | number | null | Uint8Array)[]);
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return results;
    }
  }

  async exec(sql: string): Promise<void> {
    if (this._isPostgres) {
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const stmt of statements) {
        try {
          await this.pgPool!.query(stmt);
        } catch (err: any) {
          if (!err.message?.includes('already exists') &&
              !err.message?.includes('duplicate') &&
              !err.message?.includes('relation')) {
            throw err;
          }
        }
      }
    } else {
      this.sqliteDb!.exec(sql);
      saveSqliteDb();
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this._isPostgres) {
      const client = await this.pgPool!.connect();
      try {
        await client.query('BEGIN');
        const result = await fn();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      this.sqliteDb!.run('BEGIN TRANSACTION');
      try {
        const result = await fn();
        this.sqliteDb!.run('COMMIT');
        saveSqliteDb();
        return result;
      } catch (error) {
        this.sqliteDb!.run('ROLLBACK');
        throw error;
      }
    }
  }
}

export const db = new Database();

export async function initDatabase(): Promise<void> {
  await db.init();
}

// ============== Type Definitions ==============

export interface User {
  id: number;
  wallet: string;
  claimable_lamports: number | bigint | string;
  total_claimed_lamports: number | bigint | string;
  total_won_lamports: number | bigint | string;
  total_lost_lamports: number | bigint | string;
  created_at: string;
  updated_at: string;
}

export interface Stake {
  id: number;
  user_id: number;
  amount: number | bigint | string;
  staked_at: string;
  is_active: number | boolean;
  unstaked_at: string | null;
}

export interface Epoch {
  id: number;
  epoch_number: number;
  started_at: string;
  ended_at: string | null;
  treasury_balance_lamports: number | bigint | string;
  fees_collected_lamports: number | bigint | string;
  shared_pool_lamports: number | bigint | string;
  greed_pot_addition_lamports: number | bigint | string;
  total_eligible_stake: number | bigint | string;
  quorum_reached: number | boolean;
  distributed: number | boolean;
  created_at: string;
}

export interface GlobalState {
  id: number;
  current_epoch: number;
  shared_pool_lamports: number | bigint | string;
  greed_pot_lamports: number | bigint | string;
  total_staked: number | bigint | string;
  treasury_last_balance: number | bigint | string;
  last_updated: string;
}

export interface Transaction {
  id: number;
  tx_id: string;
  user_id: number | null;
  action: string;
  amount_lamports: number | bigint | string | null;
  status: string;
  solana_signature: string | null;
  created_at: string;
  completed_at: string | null;
}

// Convert BigInt from DB to bigint
export function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  return 0n;
}
