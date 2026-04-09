import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../db', () => ({ sql: vi.fn() }));
import { sql } from '../../../db';
import {
  coerce,
  resolveFromEnvAndDefault,
  resolveValue,
  getSetting,
  getSettings,
  getAllSettings,
  getSettingsSnapshot,
  updateSettings,
  resetSettings,
  validatePatchEntry,
  getSchema,
  __clearSettingsCache,
  clearCache,
} from '../settings';
import { SETTINGS_SCHEMA, SCHEMA_BY_KEY, SECTIONS } from '../settingsSchema';
import type { SettingDef } from '../settingsSchema';

const mockSql = vi.mocked(sql);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  __clearSettingsCache();
});

// ---------------------------------------------------------------------------
// settingsSchema sanity
// ---------------------------------------------------------------------------

describe('settingsSchema', () => {
  it('exports SETTINGS_SCHEMA with 47 entries', () => {
    expect(SETTINGS_SCHEMA.length).toBe(47);
  });

  it('SCHEMA_BY_KEY has an entry for every schema item', () => {
    for (const def of SETTINGS_SCHEMA) {
      expect(SCHEMA_BY_KEY.get(def.key)).toBe(def);
    }
  });

  it('SECTIONS covers all section ids used in schema', () => {
    const sectionIds = new Set(SETTINGS_SCHEMA.map((d) => d.section));
    const declaredIds = new Set(SECTIONS.map((s) => s.id));
    for (const id of sectionIds) {
      expect(declaredIds.has(id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// coerce
// ---------------------------------------------------------------------------

describe('coerce', () => {
  const numSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'number', default: 0 };
  const intSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'integer', default: 0 };
  const enumSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'enum', default: 'a', options: ['a', 'b'] };
  const strSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'string', default: '' };
  const boolSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'boolean', default: false };

  it('returns null for null/undefined', () => {
    expect(coerce(null, numSchema)).toBeNull();
    expect(coerce(undefined, strSchema)).toBeNull();
  });

  it('coerces number from string', () => {
    expect(coerce('3.14', numSchema)).toBeCloseTo(3.14);
  });

  it('returns null for non-finite number', () => {
    expect(coerce('abc', numSchema)).toBeNull();
  });

  it('coerces integer and truncates', () => {
    expect(coerce('7.9', intSchema)).toBe(7);
  });

  it('returns null for non-finite integer', () => {
    expect(coerce('xyz', intSchema)).toBeNull();
  });

  it('coerces valid enum', () => {
    expect(coerce('b', enumSchema)).toBe('b');
  });

  it('returns null for invalid enum', () => {
    expect(coerce('c', enumSchema)).toBeNull();
  });

  it('coerces string from number', () => {
    expect(coerce(42, strSchema)).toBe('42');
  });

  it('coerces boolean true from string', () => {
    expect(coerce('true', boolSchema)).toBe(true);
    expect(coerce('TRUE', boolSchema)).toBe(true);
  });

  it('coerces boolean false from string', () => {
    expect(coerce('false', boolSchema)).toBe(false);
    expect(coerce('anything', boolSchema)).toBe(false);
  });

  it('passes through native boolean', () => {
    expect(coerce(true, boolSchema)).toBe(true);
    expect(coerce(false, boolSchema)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveFromEnvAndDefault
// ---------------------------------------------------------------------------

describe('resolveFromEnvAndDefault', () => {
  const ENV_KEY = '__TEST_SETTINGS_RESOLVE_ENV__';

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('returns env value when env is set and valid', () => {
    process.env[ENV_KEY] = '42';
    const schema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'number', default: 10, env: ENV_KEY };
    expect(resolveFromEnvAndDefault(schema)).toBe(42);
  });

  it('falls back to default when env is empty', () => {
    process.env[ENV_KEY] = '';
    const schema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'number', default: 10, env: ENV_KEY };
    expect(resolveFromEnvAndDefault(schema)).toBe(10);
  });

  it('falls back to default when env is not set', () => {
    const schema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'string', default: 'hello', env: ENV_KEY };
    expect(resolveFromEnvAndDefault(schema)).toBe('hello');
  });

  it('falls back to default when schema has no env key', () => {
    const schema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'number', default: 99 };
    expect(resolveFromEnvAndDefault(schema)).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// resolveValue  (db -> env -> default fallback chain)
// ---------------------------------------------------------------------------

describe('resolveValue', () => {
  const ENV_KEY = '__TEST_RESOLVE_VALUE_ENV__';

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('returns db value when present (JSONB wrapped)', () => {
    const dbValues = new Map<string, unknown>([
      ['recall.scoring.rrf_k', { value: 60 }],
    ]);
    expect(resolveValue('recall.scoring.rrf_k', dbValues)).toBe(60);
  });

  it('returns db value when present (raw primitive)', () => {
    const dbValues = new Map<string, unknown>([
      ['recall.scoring.rrf_k', 45],
    ]);
    expect(resolveValue('recall.scoring.rrf_k', dbValues)).toBe(45);
  });

  it('falls back to env when db has no entry', () => {
    process.env.LORE_EMBEDDING_BASE_URL = 'http://from-env';
    const dbValues = new Map<string, unknown>();
    expect(resolveValue('embedding.base_url', dbValues)).toBe('http://from-env');
    delete process.env.LORE_EMBEDDING_BASE_URL;
  });

  it('falls back to schema default when db and env are absent', () => {
    const dbValues = new Map<string, unknown>();
    expect(resolveValue('recall.scoring.rrf_k', dbValues)).toBe(20); // schema default
  });

  it('returns undefined for unknown key', () => {
    expect(resolveValue('no.such.key', new Map())).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getSetting / getSettings  (with cache)
// ---------------------------------------------------------------------------

describe('getSetting / getSettings', () => {
  it('getSetting returns resolved value from DB', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ key: 'recall.scoring.rrf_k', value: { value: 50 } }]));

    const val = await getSetting('recall.scoring.rrf_k');
    expect(val).toBe(50);
  });

  it('getSettings returns multiple keys', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([
        { key: 'recall.scoring.rrf_k', value: { value: 33 } },
        { key: 'recall.weights.w_exact', value: { value: 0.5 } },
      ]));

    const vals = await getSettings(['recall.scoring.rrf_k', 'recall.weights.w_exact']);
    expect(vals['recall.scoring.rrf_k']).toBe(33);
    expect(vals['recall.weights.w_exact']).toBeCloseTo(0.5);
  });

  it('uses cache on second call within TTL', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ key: 'recall.scoring.rrf_k', value: { value: 77 } }]));

    await getSetting('recall.scoring.rrf_k');
    const second = await getSetting('recall.scoring.rrf_k');
    expect(second).toBe(77);
    // sql should only have been called once (loadValues), cached on second
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe('updateSettings', () => {
  it('writes a valid patch and clears cache', async () => {
    mockSql.mockResolvedValue(makeResult());

    await updateSettings({ 'recall.scoring.rrf_k': 40 });

    // Should have called: upsert, loadValues (for snapshot)
    expect(mockSql).toHaveBeenCalled();
    const upsertCall = mockSql.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO app_settings'),
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall![1]).toEqual(['recall.scoring.rrf_k', JSON.stringify({ value: 40 })]);
  });

  it('throws for unknown key', async () => {
    mockSql.mockResolvedValue(makeResult());
    await expect(updateSettings({ 'no.such.key': 1 })).rejects.toThrow('Unknown setting key');
  });

  it('throws for non-object patch', async () => {
    await expect(updateSettings(null as any)).rejects.toThrow('patch must be an object');
  });
});

// ---------------------------------------------------------------------------
// resetSettings
// ---------------------------------------------------------------------------

describe('resetSettings', () => {
  it('deletes key from db and clears cache', async () => {
    mockSql.mockResolvedValue(makeResult());

    await resetSettings('recall.scoring.rrf_k');

    const deleteCall = mockSql.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM app_settings'),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual(['recall.scoring.rrf_k']);
  });

  it('accepts array of keys', async () => {
    mockSql.mockResolvedValue(makeResult());
    await resetSettings(['recall.scoring.rrf_k', 'recall.weights.w_exact']);

    const deleteCalls = mockSql.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM app_settings'),
    );
    expect(deleteCalls).toHaveLength(2);
  });

  it('throws for unknown key', async () => {
    mockSql.mockResolvedValue(makeResult());
    await expect(resetSettings('no.such.key')).rejects.toThrow('Unknown setting key');
  });
});

// ---------------------------------------------------------------------------
// validatePatchEntry
// ---------------------------------------------------------------------------

describe('validatePatchEntry', () => {
  it('throws for unknown key', () => {
    expect(() => validatePatchEntry('no.key', 1)).toThrow('Unknown setting key');
  });

  it('throws when value is below min', () => {
    // rrf_k: min=5
    expect(() => validatePatchEntry('recall.scoring.rrf_k', 2)).toThrow('must be >= 5');
  });

  it('throws when value is above max', () => {
    // rrf_k: max=200
    expect(() => validatePatchEntry('recall.scoring.rrf_k', 999)).toThrow('must be <= 200');
  });

  it('throws for invalid enum value', () => {
    expect(() => validatePatchEntry('recall.scoring.strategy', 'nonexistent')).toThrow('Invalid value');
  });

  it('accepts valid enum value', () => {
    expect(validatePatchEntry('recall.scoring.strategy', 'rrf')).toBe('rrf');
  });

  it('accepts value within bounds', () => {
    expect(validatePatchEntry('recall.scoring.rrf_k', 60)).toBe(60);
  });

  it('coerces string number to number', () => {
    expect(validatePatchEntry('recall.scoring.rrf_k', '30')).toBe(30);
  });

  it('validates boolean type', () => {
    expect(validatePatchEntry('recall.recency.enabled', true)).toBe(true);
    expect(validatePatchEntry('recall.recency.enabled', 'true')).toBe(true);
    expect(validatePatchEntry('recall.recency.enabled', 'false')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// __clearSettingsCache
// ---------------------------------------------------------------------------

describe('__clearSettingsCache', () => {
  it('forces next getSetting to reload from DB', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ key: 'recall.scoring.rrf_k', value: { value: 10 } }]))
      .mockResolvedValueOnce(makeResult([{ key: 'recall.scoring.rrf_k', value: { value: 20 } }]));

    const first = await getSetting('recall.scoring.rrf_k');
    expect(first).toBe(10);

    __clearSettingsCache();

    const second = await getSetting('recall.scoring.rrf_k');
    expect(second).toBe(20);
    // Should have loaded from DB twice (2 x loadValues)
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// getSchema
// ---------------------------------------------------------------------------

describe('getSchema', () => {
  it('returns schema and sections', () => {
    const result = getSchema();
    expect(result.schema).toBe(SETTINGS_SCHEMA);
    expect(result.sections).toBe(SECTIONS);
  });
});
