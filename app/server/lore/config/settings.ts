/**
 * Runtime-editable settings backed by the `app_settings` table.
 *
 * Resolution order for each key:
 *   1. Value stored in `app_settings` (runtime editable via /settings UI)
 *   2. Environment variable (when `env` is declared in the schema)
 *   3. Hard-coded default declared in SETTINGS_SCHEMA
 *
 * Callers use `getSetting(key)` (async, cached) or `getSettings(keys[])` to
 * resolve one or many values at once. The cache is process-local with a short
 * TTL; `updateSettings` clears it after every write.
 */

import { sql } from '../../db';
import {
  SETTINGS_SCHEMA,
  SECTIONS,
  SCHEMA_BY_KEY,
  type SettingDef,
} from './settingsSchema';

// Re-export schema for callers that import from './settings'
export { SETTINGS_SCHEMA, SECTIONS, SCHEMA_BY_KEY };

const CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let _cache: { values: Map<string, unknown>; expiresAt: number } | null = null;

export function clearCache(): void {
  _cache = null;
}

export async function loadValuesFromDb(): Promise<Map<string, unknown>> {
  const result = await sql(`SELECT key, value FROM app_settings`);
  const map = new Map<string, unknown>();
  for (const row of result.rows) map.set(row.key as string, row.value);
  return map;
}

export async function getCachedValues(): Promise<Map<string, unknown>> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.values;
  const values = await loadValuesFromDb();
  _cache = { values, expiresAt: now + CACHE_TTL_MS };
  return values;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function coerce(value: unknown, schema: SettingDef): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (schema.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (schema.type === 'integer') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (schema.type === 'enum') {
    const s = String(value);
    return schema.options?.includes(s) ? s : null;
  }
  if (schema.type === 'string') return String(value);
  if (schema.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
  }
  return value as string | number | boolean;
}

export function resolveFromEnvAndDefault(schema: SettingDef): string | number | boolean {
  if (schema.env) {
    const envValue = process.env[schema.env];
    if (envValue !== undefined && envValue !== '') {
      const coerced = coerce(envValue, schema);
      if (coerced !== null) return coerced;
    }
  }
  return schema.default;
}

export function resolveValue(key: string, dbValues: Map<string, unknown>): string | number | boolean | undefined {
  const schema = SCHEMA_BY_KEY.get(key);
  if (!schema) return undefined;
  if (dbValues.has(key)) {
    const raw = dbValues.get(key);
    // DB values are stored as JSONB -- unwrap single primitives
    const unwrapped = raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).value
      : raw;
    const coerced = coerce(unwrapped, schema);
    if (coerced !== null) return coerced;
  }
  return resolveFromEnvAndDefault(schema);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | number | boolean | undefined> {
  const values = await getCachedValues();
  return resolveValue(key, values);
}

export async function getSettings(keys: string[]): Promise<Record<string, string | number | boolean | undefined>> {
  const values = await getCachedValues();
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const key of keys) out[key] = resolveValue(key, values);
  return out;
}

export async function getAllSettings(): Promise<Record<string, string | number | boolean | undefined>> {
  const values = await getCachedValues();
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const schema of SETTINGS_SCHEMA) out[schema.key] = resolveValue(schema.key, values);
  return out;
}

/** Returns `{ values, defaults, sources }` for introspection/UI. */
export async function getSettingsSnapshot(): Promise<{
  values: Record<string, string | number | boolean | undefined>;
  defaults: Record<string, string | number | boolean>;
  sources: Record<string, 'db' | 'env' | 'default'>;
}> {
  const dbValues = await getCachedValues();
  const values: Record<string, string | number | boolean | undefined> = {};
  const defaults: Record<string, string | number | boolean> = {};
  const sources: Record<string, 'db' | 'env' | 'default'> = {};
  for (const schema of SETTINGS_SCHEMA) {
    const dbOverridden = dbValues.has(schema.key);
    const envOverridden = !dbOverridden && !!schema.env && process.env[schema.env] !== undefined && process.env[schema.env] !== '';
    values[schema.key] = resolveValue(schema.key, dbValues);
    defaults[schema.key] = schema.default;
    sources[schema.key] = dbOverridden ? 'db' : envOverridden ? 'env' : 'default';
  }
  return { values, defaults, sources };
}

export function validatePatchEntry(key: string, value: unknown): string | number | boolean {
  const schema = SCHEMA_BY_KEY.get(key);
  if (!schema) throw Object.assign(new Error(`Unknown setting key: ${key}`), { status: 400 });
  const coerced = coerce(value, schema);
  if (coerced === null) throw Object.assign(new Error(`Invalid value for ${key}`), { status: 400 });
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.min !== undefined && (coerced as number) < schema.min) {
      throw Object.assign(new Error(`${key} must be >= ${schema.min}`), { status: 400 });
    }
    if (schema.max !== undefined && (coerced as number) > schema.max) {
      throw Object.assign(new Error(`${key} must be <= ${schema.max}`), { status: 400 });
    }
  }
  return coerced;
}

export async function updateSettings(patch: Record<string, unknown>): ReturnType<typeof getSettingsSnapshot> {
  if (!patch || typeof patch !== 'object') {
    throw Object.assign(new Error('patch must be an object'), { status: 400 });
  }
  const entries = Object.entries(patch);
  for (const [key, value] of entries) {
    const coerced = validatePatchEntry(key, value);
    await sql(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify({ value: coerced })],
    );
  }
  clearCache();
  return getSettingsSnapshot();
}

export async function resetSettings(keys: string | string[]): ReturnType<typeof getSettingsSnapshot> {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    if (!SCHEMA_BY_KEY.has(key)) {
      throw Object.assign(new Error(`Unknown setting key: ${key}`), { status: 400 });
    }
    await sql(`DELETE FROM app_settings WHERE key = $1`, [key]);
  }
  clearCache();
  return getSettingsSnapshot();
}

export function getSchema(): { schema: SettingDef[]; sections: typeof SECTIONS } {
  return { schema: SETTINGS_SCHEMA, sections: SECTIONS };
}

// Test helper -- not part of public API
export function __clearSettingsCache(): void {
  clearCache();
}
