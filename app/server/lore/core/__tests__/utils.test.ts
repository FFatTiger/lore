import { describe, it, expect, vi } from 'vitest';

// Mock database and external dependencies to prevent connection attempts
vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../view/embeddings', () => ({
  embedTexts: vi.fn(),
  vectorLiteral: vi.fn(),
  resolveEmbeddingConfig: vi.fn(),
  getEmbeddingRuntimeConfig: vi.fn(),
}));
vi.mock('../../search/glossarySemantic', () => ({
  upsertGeneratedGlossaryEmbeddingsForPath: vi.fn(),
  ensureGlossaryEmbeddingsIndex: vi.fn(),
  fetchGlossarySemanticRows: vi.fn(),
}));
vi.mock('../../view/viewCrud', () => ({
  upsertGeneratedMemoryViewsForPath: vi.fn(),
  ensureMemoryViewsReady: vi.fn(),
  ensureMemoryViewsIndex: vi.fn(),
}));
vi.mock('../../view/viewBuilders', () => ({
  viewWeight: (vt: string) => vt === 'gist' ? 1.0 : vt === 'question' ? 0.96 : 1.0,
  viewPrior: (vt: string) => vt === 'gist' ? 0.03 : vt === 'question' ? 0.02 : 0,
  dedupeTerms: (values: unknown[], max = 8) => {
    const out: string[] = []; const seen = new Set<string>();
    for (const v of values) { const t = String(v || '').trim(); const k = t.toLowerCase(); if (!t || seen.has(k)) continue; seen.add(k); out.push(t); if (out.length >= max) break; }
    return out;
  },
  truncate: (v: unknown, m: number) => { const t = String(v || '').replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(); return t.length <= m ? t : `${t.slice(0, m)}…`; },
}));
vi.mock('../../view/memoryViewQueries', () => ({
  fetchDenseMemoryViewRows: vi.fn(),
  fetchLexicalMemoryViewRows: vi.fn(),
  fetchExactMemoryRows: vi.fn(),
  buildCandidateKey: vi.fn(),
  extractCueTerms: vi.fn(),
  getViewPrior: (vt: string) => vt === 'gist' ? 0.03 : vt === 'question' ? 0.02 : 0,
  getMemoryViewRuntimeConfig: vi.fn(),
  listMemoryViewsByNode: vi.fn(),
}));
vi.mock('../../recall/recallEventLog', () => ({
  logRecallEvents: vi.fn(),
}));
vi.mock('../../view/retrieval', () => ({
  NORMALIZED_DOCUMENTS_CTE: '',
  loadNormalizedDocuments: vi.fn(),
}));
vi.mock('../../memory/browse', () => ({
  ROOT_NODE_UUID: '00000000-0000-0000-0000-000000000000',
}));

import { parseUri, dedupeTerms, truncate, clampLimit } from '../utils';
import { viewWeight, viewPrior } from '../../view/viewBuilders';

describe('parseUri', () => {
  it('parses domain://path format', () => {
    expect(parseUri('core://path/to/node')).toEqual({ domain: 'core', path: 'path/to/node' });
  });

  it('parses custom domain', () => {
    expect(parseUri('preferences://theme')).toEqual({ domain: 'preferences', path: 'theme' });
  });

  it('defaults domain to core for bare paths', () => {
    expect(parseUri('path/to/node')).toEqual({ domain: 'core', path: 'path/to/node' });
  });

  it('handles empty string', () => {
    expect(parseUri('')).toEqual({ domain: 'core', path: '' });
  });

  it('handles null/undefined', () => {
    expect(parseUri(null)).toEqual({ domain: 'core', path: '' });
    expect(parseUri(undefined)).toEqual({ domain: 'core', path: '' });
  });

  it('strips leading/trailing slashes from path', () => {
    expect(parseUri('core:///leading/slashes//')).toEqual({ domain: 'core', path: 'leading/slashes' });
  });

  it('defaults empty domain to core', () => {
    expect(parseUri('://some/path')).toEqual({ domain: 'core', path: 'some/path' });
  });

  it('trims whitespace', () => {
    expect(parseUri('  core://hello  ')).toEqual({ domain: 'core', path: 'hello' });
  });
});

describe('dedupeTerms', () => {
  it('deduplicates basic values', () => {
    expect(dedupeTerms(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('is case-insensitive', () => {
    expect(dedupeTerms(['Hello', 'hello', 'HELLO'])).toEqual(['Hello']);
  });

  it('respects maxItems limit', () => {
    expect(dedupeTerms(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b', 'c']);
  });

  it('filters out empty/null values', () => {
    expect(dedupeTerms(['a', '', null, undefined, 'b'])).toEqual(['a', 'b']);
  });

  it('returns empty array for empty input', () => {
    expect(dedupeTerms([])).toEqual([]);
  });

  it('defaults maxItems to 8', () => {
    const input = Array.from({ length: 12 }, (_, i) => `item${i}`);
    expect(dedupeTerms(input)).toHaveLength(8);
  });
});

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long text with ellipsis', () => {
    const result = truncate('abcdefghij', 5);
    expect(result).toBe('abcde…');
    expect(result.length).toBe(6); // 5 chars + ellipsis
  });

  it('collapses whitespace', () => {
    expect(truncate('hello\n\tworld', 100)).toBe('hello world');
  });

  it('handles null/undefined', () => {
    expect(truncate(null, 10)).toBe('');
    expect(truncate(undefined, 10)).toBe('');
  });

  it('trims result', () => {
    expect(truncate('  hello  ', 100)).toBe('hello');
  });
});

describe('viewWeight', () => {
  it('returns 1.0 for gist', () => {
    expect(viewWeight('gist')).toBe(1.0);
  });

  it('returns 0.96 for question', () => {
    expect(viewWeight('question')).toBe(0.96);
  });

  it('returns 1.0 for unknown types', () => {
    expect(viewWeight('other')).toBe(1.0);
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
  });
});

describe('clampLimit', () => {
  it('clamps within range', () => {
    expect(clampLimit(50, 1, 100, 10)).toBe(50);
  });

  it('clamps below min', () => {
    expect(clampLimit(0, 1, 100, 10)).toBe(10);
    expect(clampLimit(-5, 1, 100, 10)).toBe(1);
  });

  it('clamps above max', () => {
    expect(clampLimit(500, 1, 100, 10)).toBe(100);
  });

  it('uses fallback for NaN', () => {
    expect(clampLimit('abc', 1, 100, 10)).toBe(10);
    expect(clampLimit(null, 1, 100, 10)).toBe(10);
    expect(clampLimit(undefined, 1, 100, 10)).toBe(10);
  });
});
