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
