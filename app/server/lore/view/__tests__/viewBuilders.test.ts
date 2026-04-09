import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));

import { sql } from '../../../db';
import { getSettings } from '../../config/settings';
import {
  getFtsConfig,
  getFtsQueryConfig,
  countQueryTokens,
  viewWeight,
  viewPrior,
  hashPayload,
  loadViewWeights,
  loadViewPriors,
  normalizeList,
  buildGlossaryTerms,
  buildQuestionLines,
  buildRuleBasedViewText,
  buildSourceDocument,
  _resetFtsCache,
  VIEW_GENERATOR_VERSION,
} from '../viewBuilders';

const mockSql = vi.mocked(sql);
const mockGetSettings = vi.mocked(getSettings);

// ---------------------------------------------------------------------------
// FTS detection
// ---------------------------------------------------------------------------

describe('getFtsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFtsCache();
  });

  it('returns jiebacfg when pg_jieba is available', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const result = await getFtsConfig();
    expect(result).toBe('jiebacfg');
  });

  it('returns zhparser when pg_jieba fails but zhparser works', async () => {
    mockSql.mockRejectedValueOnce(new Error('no jieba'));
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const result = await getFtsConfig();
    expect(result).toBe('zhparser');
  });

  it('returns simple when both jieba and zhparser fail', async () => {
    mockSql.mockRejectedValueOnce(new Error('no jieba'));
    mockSql.mockRejectedValueOnce(new Error('no zhparser'));
    const result = await getFtsConfig();
    expect(result).toBe('simple');
  });

  it('caches the result after first call', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await getFtsConfig();
    const result2 = await getFtsConfig();
    expect(result2).toBe('jiebacfg');
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});

describe('getFtsQueryConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFtsCache();
  });

  it('returns jiebaqry when pg_jieba is available', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const result = await getFtsQueryConfig();
    expect(result).toBe('jiebaqry');
  });

  it('returns zhparser when only zhparser is available', async () => {
    mockSql.mockRejectedValueOnce(new Error('no jieba'));
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const result = await getFtsQueryConfig();
    expect(result).toBe('zhparser');
  });

  it('returns simple as final fallback', async () => {
    mockSql.mockRejectedValueOnce(new Error('no jieba'));
    mockSql.mockRejectedValueOnce(new Error('no zhparser'));
    const result = await getFtsQueryConfig();
    expect(result).toBe('simple');
  });
});

// ---------------------------------------------------------------------------
// countQueryTokens
// ---------------------------------------------------------------------------

describe('countQueryTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFtsCache();
  });

  it('returns 1 for empty/blank query', async () => {
    expect(await countQueryTokens('')).toBe(1);
    expect(await countQueryTokens('  ')).toBe(1);
    expect(await countQueryTokens(null)).toBe(1);
  });

  it('returns token count from database', async () => {
    // First call triggers FTS detection
    mockSql.mockRejectedValueOnce(new Error('no jieba'));
    mockSql.mockRejectedValueOnce(new Error('no zhparser'));
    // Token count query
    mockSql.mockResolvedValueOnce({ rows: [{ tokens: '5' }], rowCount: 1 } as any);
    expect(await countQueryTokens('hello world test')).toBe(5);
  });

  it('falls back to char-based estimate on SQL error', async () => {
    // FTS detection
    mockSql.mockRejectedValueOnce(new Error('no jieba'));
    mockSql.mockRejectedValueOnce(new Error('no zhparser'));
    // Token query fails
    mockSql.mockRejectedValueOnce(new Error('SQL error'));
    const result = await countQueryTokens('abcdef');
    expect(result).toBe(Math.max(1, Math.round(6 / 3)));
  });
});

// ---------------------------------------------------------------------------
// viewWeight / viewPrior
// ---------------------------------------------------------------------------

describe('viewWeight', () => {
  it('returns 1.0 for gist', () => {
    expect(viewWeight('gist')).toBe(1.0);
  });

  it('returns 0.96 for question', () => {
    expect(viewWeight('question')).toBe(0.96);
  });

  it('returns 1.0 for unknown types', () => {
    expect(viewWeight('other')).toBe(1.0);
    expect(viewWeight('')).toBe(1.0);
  });
});

describe('viewPrior', () => {
  it('returns 0.03 for gist', () => {
    expect(viewPrior('gist')).toBe(0.03);
  });

  it('returns 0.02 for question', () => {
    expect(viewPrior('question')).toBe(0.02);
  });

  it('returns 0 for unknown types', () => {
    expect(viewPrior('other')).toBe(0);
    expect(viewPrior('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadViewWeights / loadViewPriors
// ---------------------------------------------------------------------------

describe('loadViewWeights', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches weight settings', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'views.weight.gist': 1.2,
      'views.weight.question': 0.8,
    });
    const result = await loadViewWeights();
    expect(result).toEqual({ gist: 1.2, question: 0.8 });
  });
});

describe('loadViewPriors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches prior settings', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'views.prior.gist': 0.05,
      'views.prior.question': 0.03,
    });
    const result = await loadViewPriors();
    expect(result).toEqual({ gist: 0.05, question: 0.03 });
  });
});

// ---------------------------------------------------------------------------
// hashPayload
// ---------------------------------------------------------------------------

describe('hashPayload', () => {
  it('returns a hex string', () => {
    const result = hashPayload({ key: 'value' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different hashes for different payloads', () => {
    const a = hashPayload({ a: 1 });
    const b = hashPayload({ b: 2 });
    expect(a).not.toBe(b);
  });

  it('returns same hash for same payload', () => {
    const a = hashPayload({ x: 'y', z: 1 });
    const b = hashPayload({ x: 'y', z: 1 });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// normalizeList
// ---------------------------------------------------------------------------

describe('normalizeList', () => {
  it('truncates and deduplicates', () => {
    const result = normalizeList(['hello', 'world', 'hello']);
    expect(result).toEqual(['hello', 'world']);
  });

  it('limits to maxItems', () => {
    const input = Array.from({ length: 20 }, (_, i) => `item${i}`);
    expect(normalizeList(input, 3)).toHaveLength(3);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeList(null as any)).toEqual([]);
    expect(normalizeList(undefined as any)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildGlossaryTerms
// ---------------------------------------------------------------------------

describe('buildGlossaryTerms', () => {
  it('deduplicates glossary_keywords', () => {
    const result = buildGlossaryTerms({ glossary_keywords: ['a', 'b', 'a'] });
    expect(result).toEqual(['a', 'b']);
  });

  it('returns empty array when glossary_keywords is not an array', () => {
    expect(buildGlossaryTerms({ glossary_keywords: undefined })).toEqual([]);
    expect(buildGlossaryTerms({})).toEqual([]);
  });

  it('limits to 8 items', () => {
    const keywords = Array.from({ length: 15 }, (_, i) => `kw${i}`);
    expect(buildGlossaryTerms({ glossary_keywords: keywords })).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// buildQuestionLines
// ---------------------------------------------------------------------------

describe('buildQuestionLines', () => {
  it('generates 3 question lines', () => {
    const doc = {
      path: 'agent/prefs',
      uri: 'core://agent/prefs',
      disclosure: 'when testing',
      glossary_terms: ['preference'],
    };
    const lines = buildQuestionLines(doc);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('agent/prefs');
  });

  it('uses uri fallback when path is empty', () => {
    const doc = {
      path: '',
      uri: 'core://test',
      disclosure: '',
      glossary_terms: [],
    };
    const lines = buildQuestionLines(doc);
    expect(lines[0]).toContain('core://test');
  });

  it('uses disclosure in second line when present', () => {
    const doc = {
      path: 'test',
      uri: 'core://test',
      disclosure: 'at night',
      glossary_terms: [],
    };
    const lines = buildQuestionLines(doc);
    expect(lines[1]).toContain('at night');
  });

  it('uses glossary_terms[0] in third line when present', () => {
    const doc = {
      path: 'test',
      uri: 'core://test',
      disclosure: '',
      glossary_terms: ['my_term'],
    };
    const lines = buildQuestionLines(doc);
    expect(lines[2]).toContain('my_term');
  });
});

// ---------------------------------------------------------------------------
// buildRuleBasedViewText
// ---------------------------------------------------------------------------

describe('buildRuleBasedViewText', () => {
  const doc = {
    body_preview: 'This is a test body preview.',
    disclosure: 'when relevant',
    glossary_terms: ['term1'],
    path: 'test/path',
    uri: 'core://test/path',
  };

  it('returns body + disclosure for gist', () => {
    const result = buildRuleBasedViewText(doc, 'gist');
    expect(result).toContain('This is a test body preview.');
    expect(result).toContain('when relevant');
  });

  it('returns question lines for question type', () => {
    const result = buildRuleBasedViewText(doc, 'question');
    expect(result).toContain('test/path');
  });

  it('omits empty disclosure in gist', () => {
    const result = buildRuleBasedViewText({ ...doc, disclosure: '' }, 'gist');
    expect(result).not.toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// buildSourceDocument
// ---------------------------------------------------------------------------

describe('buildSourceDocument', () => {
  it('returns a document with expected fields', () => {
    const row = {
      domain: 'core',
      path: 'agent/test',
      node_uuid: 'uuid-1',
      memory_id: 42,
      uri: 'core://agent/test',
      priority: 5,
      disclosure: 'when testing',
      glossary_keywords: ['kw1', 'kw2'],
      glossary_text: 'some glossary',
      latest_content: 'Hello world content',
    };
    const doc = buildSourceDocument(row);
    expect(doc.domain).toBe('core');
    expect(doc.path).toBe('agent/test');
    expect(doc.node_uuid).toBe('uuid-1');
    expect(doc.memory_id).toBe(42);
    expect(doc.priority).toBe(5);
    expect(doc.disclosure).toBe('when testing');
    expect(doc.glossary_terms).toEqual(['kw1', 'kw2']);
    expect(doc.body_preview).toBe('Hello world content');
    expect(doc.source_signature).toBeTruthy();
    expect(typeof doc.source_signature).toBe('string');
  });

  it('handles missing fields gracefully', () => {
    const row = {
      domain: 'core',
      path: 'empty',
      node_uuid: 'uuid-2',
      memory_id: 1,
      uri: 'core://empty',
      priority: null,
      disclosure: null,
      glossary_keywords: null,
      glossary_text: null,
      latest_content: null,
    };
    const doc = buildSourceDocument(row);
    expect(doc.priority).toBe(0);
    expect(doc.disclosure).toBe('');
    expect(doc.glossary_keywords).toEqual([]);
    expect(doc.glossary_terms).toEqual([]);
    expect(doc.body_preview).toBe('');
  });

  it('generates a consistent source_signature', () => {
    const row = {
      domain: 'core', path: 'x', node_uuid: 'u', memory_id: 1,
      uri: 'core://x', priority: 0, disclosure: '', glossary_keywords: [],
      glossary_text: '', latest_content: 'abc',
    };
    const doc1 = buildSourceDocument(row);
    const doc2 = buildSourceDocument(row);
    expect(doc1.source_signature).toBe(doc2.source_signature);
  });

  it('truncates body_preview to 900 chars', () => {
    const longContent = 'x'.repeat(2000);
    const row = {
      domain: 'core', path: 'long', node_uuid: 'u', memory_id: 1,
      uri: 'core://long', priority: 0, disclosure: '', glossary_keywords: [],
      glossary_text: '', latest_content: longContent,
    };
    const doc = buildSourceDocument(row);
    // truncate adds ellipsis
    expect((doc.body_preview as string).length).toBeLessThanOrEqual(901);
  });
});
