/**
 * Lightweight SQL migration runner.
 *
 * Convention:
 *   migrations/001_description.sql
 *   migrations/002_description.sql
 *   ...
 *
 * On server start (via instrumentation.ts), runMigrations() is called once.
 * It creates a `schema_migrations` tracking table, reads the migrations/
 * directory, and executes any that haven't been applied yet — in order.
 *
 * Each migration runs inside its own transaction. Already-applied migrations
 * (tracked by integer version number) are skipped.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPool } from '../../db';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');
const DEFAULT_DB_STARTUP_WAIT_MS = 120_000;
const DEFAULT_DB_STARTUP_RETRY_MS = 2_000;
const TRANSIENT_CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  '57P01',
  '08000',
  '08001',
  '08003',
  '08006',
]);

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getDatabaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isTransientDatabaseStartupError(error: unknown): boolean {
  const code = getDatabaseErrorCode(error);
  if (code && TRANSIENT_CONNECTION_CODES.has(code)) return true;

  const message = error instanceof Error ? error.message : String(error || '');
  return /terminating connection|connection terminated|database system is starting up|the database system is in recovery mode/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabaseReady(): Promise<void> {
  const waitMs = getPositiveIntegerEnv('LORE_DB_STARTUP_WAIT_MS', DEFAULT_DB_STARTUP_WAIT_MS);
  const retryMs = getPositiveIntegerEnv('LORE_DB_STARTUP_RETRY_MS', DEFAULT_DB_STARTUP_RETRY_MS);
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      await getPool().query('SELECT 1');
      if (attempt > 1) console.log('[migrations] database is ready');
      return;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = waitMs - elapsedMs;
      if (!isTransientDatabaseStartupError(error) || remainingMs <= 0) {
        throw error;
      }

      const code = getDatabaseErrorCode(error);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[migrations] waiting for database (${code || 'unknown'}): ${message}; retrying in ${Math.min(retryMs, remainingMs)}ms`,
      );
      await sleep(Math.min(retryMs, remainingMs));
    }
  }
}

async function ensureTrackingTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function loadMigrationFiles(): { version: number; name: string; sql: string }[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort()
    .map((f) => {
      const version = parseInt(f.slice(0, 3), 10);
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
      return { version, name: f, sql: content };
    });
}

export async function runMigrations(): Promise<void> {
  await waitForDatabaseReady();
  await ensureTrackingTable();

  const applied = await getPool().query('SELECT version FROM schema_migrations');
  const appliedSet = new Set((applied.rows as { version: number }[]).map((r) => r.version));

  const pending = loadMigrationFiles().filter((m) => !appliedSet.has(m.version));
  if (pending.length === 0) return;

  for (const migration of pending) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
      await client.query('COMMIT');
      console.log(`[migrations] applied ${migration.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrations] failed ${migration.name}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }
}
