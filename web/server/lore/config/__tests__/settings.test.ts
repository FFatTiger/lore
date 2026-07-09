import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));

import { sql } from '../../../db';
import {
  coerce,
  resolveFromDefault,
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

describe('settingsSchema', () => {
  it('exposes unique schema keys and expected settings-only additions', () => {
    expect(new Set(SETTINGS_SCHEMA.map((def) => def.key)).size).toBe(SETTINGS_SCHEMA.length);
    expect(SCHEMA_BY_KEY.get('embedding.api_key')?.secret).toBe(true);
    expect(SCHEMA_BY_KEY.get('view_llm.api_key')?.secret).toBe(true);
    expect(SCHEMA_BY_KEY.has('backup.local.path')).toBe(false);
    expect(SCHEMA_BY_KEY.has('review.local.path')).toBe(false);
    expect(SCHEMA_BY_KEY.get('embedding.model')?.default).toBe('text-embedding-3-small');
    expect(SCHEMA_BY_KEY.get('view_llm.model')?.default).toBe('deepseek-v4-flash');
    expect(SCHEMA_BY_KEY.get('backup.enabled')?.default).toBe(true);
    expect(SCHEMA_BY_KEY.get('cache.enabled')).toMatchObject({
      section: 'cache',
      type: 'boolean',
      default: true,
    });
    expect(SCHEMA_BY_KEY.get('dream.auto_approve_changes')).toMatchObject({
      section: 'dream',
      type: 'boolean',
      default: false,
    });
    expect(SECTIONS.some((section) => section.id === 'cache')).toBe(true);
    expect(SCHEMA_BY_KEY.get('lifecycle.guidance.global')).toMatchObject({
      section: 'lifecycle',
      type: 'text',
    });
    expect(String(SCHEMA_BY_KEY.get('lifecycle.guidance.global')?.default)).toContain('Lore 使用规则');
    expect(SCHEMA_BY_KEY.get('lifecycle.boot.preamble')).toMatchObject({
      section: 'lifecycle',
      type: 'text',
    });
    expect(SECTIONS.some((section) => section.id === 'lifecycle')).toBe(true);
    expect(SCHEMA_BY_KEY.get('prompts.view_generation.system')).toMatchObject({
      section: 'prompts',
      type: 'text',
    });
    expect(SCHEMA_BY_KEY.get('prompts.dream.system')?.default).toContain('{{guidance}}');
    expect(SECTIONS.some((section) => section.id === 'prompts')).toBe(true);
    expect(SCHEMA_BY_KEY.get('recall.safety.max_query_chars')).toMatchObject({
      section: 'recall_safety',
      type: 'integer',
      default: 200,
      min: 50,
      max: 2000,
    });
    expect(SCHEMA_BY_KEY.get('recall.safety.timeout_ms')).toMatchObject({
      section: 'recall_safety',
      type: 'integer',
      default: 2000,
      min: 500,
      max: 30000,
    });
    expect(SECTIONS.some((section) => section.id === 'recall_safety')).toBe(true);
  });

  it('does not expose selectable recall scoring algorithms', () => {
    expect(SCHEMA_BY_KEY.has('recall.scoring.strategy')).toBe(false);
    expect(SCHEMA_BY_KEY.has('recall.scoring.rrf_k')).toBe(false);
    expect(SCHEMA_BY_KEY.has('recall.scoring.dense_floor')).toBe(false);
    expect(SCHEMA_BY_KEY.has('recall.scoring.gs_floor')).toBe(false);
    expect(SECTIONS.some((section) => section.id === 'recall_scoring')).toBe(false);
  });

  it('SCHEMA_BY_KEY has an entry for every schema item', () => {
    for (const def of SETTINGS_SCHEMA) {
      expect(SCHEMA_BY_KEY.get(def.key)).toBe(def);
    }
  });

  it('SECTIONS covers all section ids used in schema', () => {
    const sectionIds = new Set(SETTINGS_SCHEMA.map((def) => def.section));
    const declaredIds = new Set(SECTIONS.map((section) => section.id));
    for (const id of sectionIds) {
      expect(declaredIds.has(id)).toBe(true);
    }
  });
});

describe('coerce', () => {
  const numSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'number', default: 0 };
  const intSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'integer', default: 0 };
  const enumSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'enum', default: 'a', options: ['a', 'b'] };
  const strSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'string', default: '' };
  const textSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'text', default: '' };
  const boolSchema: SettingDef = { key: 'x', section: 's', label: 'l', type: 'boolean', default: false };

  it('returns null for nullish values', () => {
    expect(coerce(null, numSchema)).toBeNull();
    expect(coerce(undefined, strSchema)).toBeNull();
  });

  it('coerces numbers from strings', () => {
    expect(coerce('3.14', numSchema)).toBeCloseTo(3.14);
  });

  it('returns null for non-finite numbers', () => {
    expect(coerce('abc', numSchema)).toBeNull();
  });

  it('coerces integers and truncates', () => {
    expect(coerce('7.9', intSchema)).toBe(7);
  });

  it('returns null for invalid enums', () => {
    expect(coerce('c', enumSchema)).toBeNull();
  });

  it('passes through valid enums', () => {
    expect(coerce('b', enumSchema)).toBe('b');
  });

  it('coerces strings', () => {
    expect(coerce(42, strSchema)).toBe('42');
  });

  it('coerces long text', () => {
    expect(coerce(42, textSchema)).toBe('42');
    expect(coerce('line 1\nline 2', textSchema)).toBe('line 1\nline 2');
  });

  it('coerces booleans', () => {
    expect(coerce(true, boolSchema)).toBe(true);
    expect(coerce('true', boolSchema)).toBe(true);
    expect(coerce('false', boolSchema)).toBe(false);
    expect(coerce('anything', boolSchema)).toBe(false);
  });
});

describe('resolveFromDefault', () => {
  it('returns the schema default', () => {
    expect(resolveFromDefault({ key: 'x', section: 's', label: 'l', type: 'string', default: 'hello' })).toBe('hello');
  });
});

describe('resolveValue', () => {
  it('returns db value when present as wrapped JSON', () => {
    const dbValues = new Map<string, unknown>([['recall.weights.w_exact', { value: 0.6 }]]);
    expect(resolveValue('recall.weights.w_exact', dbValues)).toBe(0.6);
  });

  it('returns db value when present as a raw primitive', () => {
    const dbValues = new Map<string, unknown>([['recall.weights.w_exact', 0.45]]);
    expect(resolveValue('recall.weights.w_exact', dbValues)).toBe(0.45);
  });

  it('falls back to schema default when db value is invalid or missing', () => {
    const invalid = new Map<string, unknown>([['recall.weights.w_exact', { value: 'bad' }]]);
    const missing = new Map<string, unknown>();
    expect(resolveValue('recall.weights.w_exact', invalid)).toBe(0.30);
    expect(resolveValue('recall.weights.w_exact', missing)).toBe(0.30);
  });

  it('returns undefined for unknown keys', () => {
    expect(resolveValue('no.such.key', new Map())).toBeUndefined();
  });
});

describe('getSetting / getSettings / getAllSettings / getSettingsSnapshot', () => {
  it('getSetting returns resolved db value', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ key: 'recall.weights.w_exact', value: { value: 0.5 } }]));

    await expect(getSetting('recall.weights.w_exact')).resolves.toBe(0.5);
  });

  it('getSettings returns multiple keys', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      { key: 'recall.weights.w_exact', value: { value: 0.33 } },
      { key: 'recall.weights.w_dense', value: { value: 0.5 } },
    ]));

    const values = await getSettings(['recall.weights.w_exact', 'recall.weights.w_dense']);
    expect(values['recall.weights.w_exact']).toBeCloseTo(0.33);
    expect(values['recall.weights.w_dense']).toBeCloseTo(0.5);
  });

  it('getAllSettings resolves defaults for missing keys', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ key: 'recall.weights.w_exact', value: { value: 0.77 } }]));

    const values = await getAllSettings();
    expect(values['recall.weights.w_exact']).toBeCloseTo(0.77);
    expect(values['embedding.provider']).toBe('openai_compatible');
  });

  it('uses cache on repeated reads within TTL', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ key: 'recall.weights.w_exact', value: { value: 0.77 } }]));

    await getSetting('recall.weights.w_exact');
    const second = await getSetting('recall.weights.w_exact');

    expect(second).toBeCloseTo(0.77);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('getSettingsSnapshot masks secret values and reports sources', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      { key: 'embedding.api_key', value: { value: 'secret-key' } },
      { key: 'embedding.base_url', value: { value: 'http://embed.local' } },
    ]));

    const snapshot = await getSettingsSnapshot();

    expect(snapshot.values['embedding.api_key']).toBe('');
    expect(snapshot.secret_configured['embedding.api_key']).toBe(true);
    expect(snapshot.sources['embedding.api_key']).toBe('db');
    expect(snapshot.values['embedding.base_url']).toBe('http://embed.local');
    expect(snapshot.sources['view_llm.api_key']).toBe('default');
    expect(snapshot.secret_configured['view_llm.api_key']).toBe(false);
    expect(snapshot.defaults['embedding.provider']).toBe('openai_compatible');
  });
});

describe('updateSettings', () => {
  it('writes a valid patch and returns a snapshot', async () => {
    mockSql.mockResolvedValue(makeResult());

    await updateSettings({ 'recall.weights.w_exact': 0.4 });

    const upsertCall = mockSql.mock.calls.find(([text]) => (text as string).includes('INSERT INTO app_settings'));
    expect(upsertCall).toBeDefined();
    expect(upsertCall?.[1]).toEqual(['recall.weights.w_exact', JSON.stringify({ value: 0.4 })]);
  });

  it('throws for unknown keys', async () => {
    await expect(updateSettings({ 'no.such.key': 1 })).rejects.toThrow('Unknown setting key');
  });

  it('throws for non-object patches', async () => {
    await expect(updateSettings(null as any)).rejects.toThrow('patch must be an object');
  });

  it('rejects blank writes for secret settings', async () => {
    await expect(updateSettings({ 'embedding.api_key': '' })).rejects.toThrow('Use reset to clear secret setting');
  });
});

describe('resetSettings', () => {
  it('deletes a single key from the db', async () => {
    mockSql.mockResolvedValue(makeResult());

    await resetSettings('recall.weights.w_exact');

    const deleteCall = mockSql.mock.calls.find(([text]) => (text as string).includes('DELETE FROM app_settings'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.[1]).toEqual(['recall.weights.w_exact']);
  });

  it('accepts arrays of keys', async () => {
    mockSql.mockResolvedValue(makeResult());

    await resetSettings(['recall.weights.w_exact', 'recall.weights.w_dense']);

    const deleteCalls = mockSql.mock.calls.filter(([text]) => (text as string).includes('DELETE FROM app_settings'));
    expect(deleteCalls).toHaveLength(2);
  });

  it('throws for unknown keys', async () => {
    await expect(resetSettings('no.such.key')).rejects.toThrow('Unknown setting key');
  });
});

describe('validatePatchEntry', () => {
  it('throws for unknown keys', () => {
    expect(() => validatePatchEntry('no.key', 1)).toThrow('Unknown setting key');
  });

  it('throws when numbers are below min', () => {
    expect(() => validatePatchEntry('recall.weights.w_exact', -0.1)).toThrow('must be >= 0');
  });

  it('throws when numbers are above max', () => {
    expect(() => validatePatchEntry('recall.weights.w_exact', 2)).toThrow('must be <= 1');
  });

  it('rejects removed recall scoring algorithm settings', () => {
    expect(() => validatePatchEntry('recall.scoring.strategy', 'raw_plus_lex_damp')).toThrow('Unknown setting key');
    expect(() => validatePatchEntry('recall.scoring.rrf_k', 30)).toThrow('Unknown setting key');
    expect(() => validatePatchEntry('recall.scoring.dense_floor', 0.5)).toThrow('Unknown setting key');
    expect(() => validatePatchEntry('recall.scoring.gs_floor', 0.4)).toThrow('Unknown setting key');
  });

  it('coerces numeric strings', () => {
    expect(validatePatchEntry('recall.weights.w_exact', '0.30')).toBe(0.30);
  });

  it('validates booleans', () => {
    expect(validatePatchEntry('recall.recency.enabled', true)).toBe(true);
    expect(validatePatchEntry('recall.recency.enabled', 'true')).toBe(true);
    expect(validatePatchEntry('recall.recency.enabled', 'false')).toBe(false);
  });

  it('rejects blank secret values', () => {
    expect(() => validatePatchEntry('embedding.api_key', '')).toThrow('Use reset to clear secret setting');
  });
});

describe('__clearSettingsCache', () => {
  it('forces the next getSetting call to reload from db', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ key: 'recall.weights.w_exact', value: { value: 0.1 } }]))
      .mockResolvedValueOnce(makeResult([{ key: 'recall.weights.w_exact', value: { value: 0.2 } }]));

    expect(await getSetting('recall.weights.w_exact')).toBe(0.1);

    __clearSettingsCache();

    expect(await getSetting('recall.weights.w_exact')).toBe(0.2);
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});

describe('getSchema', () => {
  it('returns schema and sections', () => {
    expect(getSchema()).toEqual({ schema: SETTINGS_SCHEMA, sections: SECTIONS });
  });
});
