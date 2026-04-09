import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool, sql } from '../../db';
import { getSettings } from '../config/settings';

const BACKUP_DIR = path.join(process.env.SNAPSHOT_DIR || '/app/snapshots', 'backups');
const FORMAT_VERSION = 'lore-backup-v1';

// Tables in dependency order (parents first for INSERT, children first for TRUNCATE)
const CORE_TABLES: Array<{ name: string; query: string }> = [
  { name: 'nodes',      query: 'SELECT uuid, created_at FROM nodes' },
  { name: 'memories',   query: 'SELECT id, node_uuid, content, deprecated, migrated_to, created_at FROM memories' },
  { name: 'edges',      query: 'SELECT id, parent_uuid, child_uuid, priority, disclosure, created_at FROM edges' },
  { name: 'paths',      query: 'SELECT domain, path, edge_id, created_at FROM paths' },
  { name: 'glossary_keywords', query: 'SELECT id, keyword, node_uuid, created_at FROM glossary_keywords' },
  { name: 'app_settings',     query: 'SELECT key, value, updated_at FROM app_settings' },
  { name: 'memory_events',    query: 'SELECT id, event_type, node_uri, node_uuid, domain, path, source, session_id, before_snapshot, after_snapshot, details, created_at FROM memory_events' },
  { name: 'dream_diary',      query: 'SELECT id, started_at, completed_at, duration_ms, status, summary, narrative, tool_calls, details, error FROM dream_diary' },
  { name: 'glossary_term_embeddings', query: 'SELECT id, domain, path, uri, node_uuid, memory_id, priority, disclosure, keyword, match_text, source, status, embedding_model, embedding_dim, metadata, source_signature, created_at, updated_at FROM glossary_term_embeddings' },
];

const OPTIONAL_TABLES: Array<{ name: string; query: string }> = [
  { name: 'recall_events', query: 'SELECT * FROM recall_events' },
];

// Regenerable / ephemeral tables to truncate on restore but not backup
const TRUNCATE_ONLY = ['memory_views', 'recall_documents', 'search_documents', 'session_read_nodes', 'schema_migrations'];

// Tables with BIGSERIAL/SERIAL id columns that need sequence reset after restore
const SERIAL_TABLES = ['memories', 'edges', 'glossary_keywords', 'memory_events', 'dream_diary', 'glossary_term_embeddings'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportOptions {
  includeRecallEvents?: boolean;
}

export interface BackupData {
  format: string;
  created_at: string;
  tables: Record<string, Record<string, unknown>[]>;
  stats: Record<string, number>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  stats: Record<string, number>;
}

export interface RestoreResult {
  restored: Record<string, number>;
  duration_ms: number;
}

export interface LocalBackupEntry {
  filename: string;
  size: number;
  created_at: string;
}

export interface ExportLocalResult {
  filename: string;
  path: string;
  size: number;
  stats: Record<string, number>;
}

export interface ExportWebDAVResult {
  filename: string;
  url: string;
  size: number;
  stats: Record<string, number>;
}

interface WebDAVConfig {
  username: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportDatabase(options: ExportOptions = {}): Promise<BackupData> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const stats: Record<string, number> = {};

  for (const t of CORE_TABLES) {
    const result = await sql(t.query);
    tables[t.name] = result.rows as Record<string, unknown>[];
    stats[t.name] = result.rows.length;
  }

  if (options.includeRecallEvents) {
    for (const t of OPTIONAL_TABLES) {
      try {
        const result = await sql(t.query);
        tables[t.name] = result.rows as Record<string, unknown>[];
        stats[t.name] = result.rows.length;
      } catch { /* table may not exist */ }
    }
  }

  return {
    format: FORMAT_VERSION,
    created_at: new Date().toISOString(),
    tables,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validateBackup(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') errors.push('备份数据不是有效的 JSON 对象');
  else if ((data as BackupData).format !== FORMAT_VERSION) errors.push(`格式版本不匹配: 期望 ${FORMAT_VERSION}, 得到 ${(data as BackupData).format}`);
  else {
    const required = ['nodes', 'memories', 'edges', 'paths'];
    for (const t of required) {
      if (!Array.isArray((data as BackupData).tables?.[t])) errors.push(`缺少必要的表: ${t}`);
    }
  }
  return { valid: errors.length === 0, errors, stats: (data as BackupData)?.stats || {} };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export async function restoreDatabase(data: unknown): Promise<RestoreResult> {
  const validation = validateBackup(data);
  if (!validation.valid) {
    const err = Object.assign(new Error(validation.errors.join('; ')), { status: 400 });
    throw err;
  }

  const backupData = data as BackupData;
  const client = await getPool().connect();
  const start = Date.now();
  const restored: Record<string, number> = {};

  try {
    await client.query('BEGIN');

    // 1. Truncate all tables (reverse dependency + regenerable)
    const allTruncate = [...CORE_TABLES].reverse().map((t) => t.name).concat(TRUNCATE_ONLY);
    for (const name of allTruncate) {
      try { await client.query(`TRUNCATE ${name} CASCADE`); } catch { /* table may not exist */ }
    }
    // Also truncate optional tables if present in backup
    for (const t of OPTIONAL_TABLES) {
      if (backupData.tables[t.name]) {
        try { await client.query(`TRUNCATE ${t.name} CASCADE`); } catch {}
      }
    }

    // 2. Insert in dependency order
    const allTables = [...CORE_TABLES, ...OPTIONAL_TABLES.filter((t) => backupData.tables[t.name])];
    for (const t of allTables) {
      const rows = backupData.tables[t.name];
      if (!rows?.length) { restored[t.name] = 0; continue; }

      // Build INSERT from first row's keys
      const keys = Object.keys(rows[0]);
      const cols = keys.join(', ');
      let inserted = 0;

      // Batch insert in chunks of 100
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const values: unknown[] = [];
        const placeholders: string[] = [];

        for (let r = 0; r < chunk.length; r++) {
          const row = chunk[r];
          const rowPlaceholders = keys.map((_, c) => `$${r * keys.length + c + 1}`);
          placeholders.push(`(${rowPlaceholders.join(', ')})`);
          for (const k of keys) {
            const v = row[k];
            values.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
          }
        }

        await client.query(`INSERT INTO ${t.name} (${cols}) VALUES ${placeholders.join(', ')}`, values);
        inserted += chunk.length;
      }

      restored[t.name] = inserted;
    }

    // 3. Reset sequences
    for (const name of SERIAL_TABLES) {
      try {
        await client.query(`SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM ${name}), 0) + 1, false)`);
      } catch { /* table may not have serial or may be empty */ }
    }

    await client.query('COMMIT');
    return { restored, duration_ms: Date.now() - start };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Local file operations
// ---------------------------------------------------------------------------

async function ensureBackupDir(): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

function backupFilename(): string {
  return `lore-backup-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json`;
}

export async function exportToLocal(options: ExportOptions = {}): Promise<ExportLocalResult> {
  await ensureBackupDir();
  const data = await exportDatabase(options);
  const filename = backupFilename();
  const filepath = path.join(BACKUP_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(data));
  const stat = await fs.stat(filepath);
  console.log(`[backup] saved local: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  return { filename, path: filepath, size: stat.size, stats: data.stats };
}

export async function listLocalBackups(): Promise<LocalBackupEntry[]> {
  await ensureBackupDir();
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const backups: LocalBackupEntry[] = [];
    for (const f of files) {
      if (!f.startsWith('lore-backup-') || !f.endsWith('.json')) continue;
      const stat = await fs.stat(path.join(BACKUP_DIR, f));
      backups.push({ filename: f, size: stat.size, created_at: stat.mtime.toISOString() });
    }
    backups.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return backups;
  } catch { return []; }
}

export async function readLocalBackup(filename: string): Promise<string> {
  const safe = path.basename(filename);
  return fs.readFile(path.join(BACKUP_DIR, safe), 'utf-8');
}

export async function deleteLocalBackup(filename: string): Promise<void> {
  const safe = path.basename(filename);
  await fs.unlink(path.join(BACKUP_DIR, safe));
}

export async function cleanupLocalBackups(retentionCount: number): Promise<number> {
  const backups = await listLocalBackups();
  if (backups.length <= retentionCount) return 0;
  const toDelete = backups.slice(retentionCount);
  for (const b of toDelete) {
    try { await deleteLocalBackup(b.filename); } catch {}
  }
  console.log(`[backup] cleaned up ${toDelete.length} old local backups`);
  return toDelete.length;
}

// ---------------------------------------------------------------------------
// WebDAV operations
// ---------------------------------------------------------------------------

function webdavAuth(config: WebDAVConfig): string {
  return 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
}

function webdavUrl(base: string, filename: string): string {
  const u = base.endsWith('/') ? base : base + '/';
  return u + filename;
}

async function webdavPut(url: string, content: string, config: WebDAVConfig): Promise<void> {
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: webdavAuth(config), 'Content-Type': 'application/json' },
    body: content,
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`WebDAV PUT ${resp.status}: ${resp.statusText}`);
}

async function webdavGet(url: string, config: WebDAVConfig): Promise<string> {
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: webdavAuth(config) },
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`WebDAV GET ${resp.status}: ${resp.statusText}`);
  return resp.text();
}

async function webdavDelete(url: string, config: WebDAVConfig): Promise<void> {
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: webdavAuth(config) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok && resp.status !== 404) throw new Error(`WebDAV DELETE ${resp.status}: ${resp.statusText}`);
}

async function webdavList(baseUrl: string, config: WebDAVConfig): Promise<string[]> {
  const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const resp = await fetch(url, {
    method: 'PROPFIND',
    headers: { Authorization: webdavAuth(config), Depth: '1', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>',
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`WebDAV PROPFIND ${resp.status}: ${resp.statusText}`);
  const xml = await resp.text();
  // Minimal XML parsing — extract href values that look like backup files
  const files: string[] = [];
  const hrefRegex = /<[^:]*:href[^>]*>([^<]*lore-backup-[^<]*\.json)<\//gi;
  let match;
  while ((match = hrefRegex.exec(xml)) !== null) {
    const href = match[1];
    const filename = href.split('/').pop();
    if (filename) files.push(filename);
  }
  files.sort().reverse();
  return files;
}

export async function exportToWebDAV(options: ExportOptions = {}): Promise<ExportWebDAVResult> {
  const s = await getSettings(['backup.webdav.url', 'backup.webdav.username', 'backup.webdav.password', 'backup.include_recall_events']);
  const config: WebDAVConfig = { username: String(s['backup.webdav.username'] || ''), password: String(s['backup.webdav.password'] || '') };
  const baseUrl = String(s['backup.webdav.url'] || '');
  if (!baseUrl) throw new Error('WebDAV URL not configured');

  const data = await exportDatabase({ includeRecallEvents: s['backup.include_recall_events'] === true, ...options });
  const filename = backupFilename();
  const json = JSON.stringify(data);
  await webdavPut(webdavUrl(baseUrl, filename), json, config);
  console.log(`[backup] uploaded to WebDAV: ${filename} (${(json.length / 1024 / 1024).toFixed(1)}MB)`);
  return { filename, url: webdavUrl(baseUrl, filename), size: json.length, stats: data.stats };
}

export async function listWebDAVBackups(): Promise<string[]> {
  const s = await getSettings(['backup.webdav.url', 'backup.webdav.username', 'backup.webdav.password']);
  const config: WebDAVConfig = { username: String(s['backup.webdav.username'] || ''), password: String(s['backup.webdav.password'] || '') };
  const baseUrl = String(s['backup.webdav.url'] || '');
  if (!baseUrl) return [];
  return webdavList(baseUrl, config);
}

export async function cleanupWebDAVBackups(retentionCount: number): Promise<number> {
  const s = await getSettings(['backup.webdav.url', 'backup.webdav.username', 'backup.webdav.password']);
  const config: WebDAVConfig = { username: String(s['backup.webdav.username'] || ''), password: String(s['backup.webdav.password'] || '') };
  const baseUrl = String(s['backup.webdav.url'] || '');
  if (!baseUrl) return 0;

  const files = await webdavList(baseUrl, config);
  if (files.length <= retentionCount) return 0;
  const toDelete = files.slice(retentionCount);
  for (const f of toDelete) {
    try { await webdavDelete(webdavUrl(baseUrl, f), config); } catch {}
  }
  console.log(`[backup] cleaned up ${toDelete.length} old WebDAV backups`);
  return toDelete.length;
}
