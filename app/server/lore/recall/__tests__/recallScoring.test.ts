import { describe, it, expect, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../view/embeddings', () => ({
  embedTexts: vi.fn(),
  vectorLiteral: vi.fn(),
  resolveEmbeddingConfig: vi.fn(),
  getEmbeddingRuntimeConfig: vi.fn(),
}));
vi.mock('../../search/glossarySemantic', () => ({
  ensureGlossaryEmbeddingsIndex: vi.fn(),
  fetchGlossarySemanticRows: vi.fn(),
}));
vi.mock('../../view/viewCrud', () => ({
  ensureMemoryViewsReady: vi.fn(),
  ensureMemoryViewsIndex: vi.fn(),
}));
vi.mock('../../view/viewBuilders', () => ({
  countQueryTokens: vi.fn().mockResolvedValue(3),
}));
vi.mock('../../view/memoryViewQueries', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchDenseMemoryViewRows: vi.fn(),
    fetchLexicalMemoryViewRows: vi.fn(),
    fetchExactMemoryRows: vi.fn(),
  };
});
vi.mock('../recallEventLog', () => ({ logRecallEvents: vi.fn() }));
vi.mock('../../view/retrieval', () => ({
  NORMALIZED_DOCUMENTS_CTE: '',
  loadNormalizedDocuments: vi.fn(),
}));

// ─── Imports ────────────────────────────────────────────────────────

import {
  collectCandidates,
  runStrategy,
  STRATEGIES,
  DEFAULT_STRATEGY,
  STRATEGY_LABELS,
} from '../recallScoring';

// ─── Test helpers ───────────────────────────────────────────────────

function makeRows({
  exact = [] as Record<string, unknown>[],
  gs = [] as Record<string, unknown>[],
  dense = [] as Record<string, unknown>[],
  lexical = [] as Record<string, unknown>[],
} = {}) {
  return {
    exactRows: exact,
    glossarySemanticRows: gs,
    denseRows: dense,
    lexicalRows: lexical,
  };
}

const baseConfig = {
  w_exact: 0.30,
  w_glossary_semantic: 0.25,
  w_dense: 0.30,
  w_lexical: 0.05,
  priority_base: 0.05,
  priority_step: 0.01,
  multi_view_step: 0.015,
  multi_view_cap: 0.05,
  rrf_k: 20,
  dense_floor: 0.40,
  gs_floor: 0.30,
};

// ─── Re-export tests ────────────────────────────────────────────────

describe('Re-exports from scoringStrategies', () => {
  it('re-exports STRATEGIES', () => {
    expect(STRATEGIES).toHaveLength(8);
  });

  it('re-exports DEFAULT_STRATEGY', () => {
    expect(DEFAULT_STRATEGY).toBe('raw_plus_lex_damp');
  });

  it('re-exports STRATEGY_LABELS', () => {
    expect(STRATEGY_LABELS).toBeDefined();
    expect(typeof STRATEGY_LABELS.rrf).toBe('string');
  });
});

// ─── collectCandidates ──────────────────────────────────────────────

describe('collectCandidates', () => {
  it('merges rows from all four paths by URI', () => {
    const rows = makeRows({
      exact: [{ uri: 'test://a', exact_score: 0.9, weight: 1 }],
      dense: [{ uri: 'test://a', semantic_score: 0.7, weight: 1, view_type: 'gist' }],
      lexical: [{ uri: 'test://a', lexical_score: 0.5, weight: 1, view_type: 'gist' }],
    });
    const byUri = collectCandidates(rows);
    expect(byUri.size).toBe(1);
    const item = byUri.get('test://a')!;
    expect(item.exact_score).toBe(0.9);
    expect(item.dense_score).toBe(0.7);
    expect(item.lexical_score).toBe(0.5);
  });

  it('keeps separate URIs separate', () => {
    const rows = makeRows({
      exact: [
        { uri: 'test://a', exact_score: 0.9, weight: 1 },
        { uri: 'test://b', exact_score: 0.5, weight: 1 },
      ],
    });
    const byUri = collectCandidates(rows);
    expect(byUri.size).toBe(2);
  });

  it('takes max score when same URI appears multiple times', () => {
    const rows = makeRows({
      exact: [
        { uri: 'test://a', exact_score: 0.5, weight: 1 },
        { uri: 'test://a', exact_score: 0.9, weight: 1 },
      ],
    });
    const byUri = collectCandidates(rows);
    expect(byUri.get('test://a')!.exact_score).toBe(0.9);
  });

  it('applies weight multiplier', () => {
    const rows = makeRows({
      exact: [{ uri: 'test://a', exact_score: 0.5, weight: 2 }],
    });
    const byUri = collectCandidates(rows);
    expect(byUri.get('test://a')!.exact_score).toBe(1.0);
  });

  it('collects matched_on from all paths', () => {
    const rows = makeRows({
      exact: [{ uri: 'test://a', exact_score: 0.5, weight: 1 }],
      dense: [{ uri: 'test://a', semantic_score: 0.3, weight: 1, view_type: 'gist' }],
      lexical: [{ uri: 'test://a', lexical_score: 0.2, weight: 1, view_type: 'gist' }],
    });
    const byUri = collectCandidates(rows);
    const item = byUri.get('test://a')!;
    expect(item.matched_on.has('exact')).toBe(true);
    expect(item.matched_on.has('dense')).toBe(true);
    expect(item.matched_on.has('lexical')).toBe(true);
  });

  it('tracks glossary exact and text hits', () => {
    const rows = makeRows({
      exact: [{
        uri: 'test://a', exact_score: 0.5, weight: 1,
        glossary_exact_hit: true, glossary_text_hit: true,
        path_exact_hit: true, glossary_fts_hit: true,
        query_contains_glossary_hit: true,
      }],
    });
    const byUri = collectCandidates(rows);
    const item = byUri.get('test://a')!;
    expect(item.matched_on.has('glossary')).toBe(true);
    expect(item.matched_on.has('glossary_text')).toBe(true);
    expect(item.matched_on.has('path')).toBe(true);
    expect(item.matched_on.has('glossary_fts')).toBe(true);
    expect(item.matched_on.has('query_contains_glossary')).toBe(true);
  });

  it('collects cues from metadata', () => {
    const rows = makeRows({
      exact: [{
        uri: 'test://a', exact_score: 0.5, weight: 1,
        metadata: { glossary_terms: ['alpha', 'beta'] },
      }],
    });
    const byUri = collectCandidates(rows);
    const item = byUri.get('test://a')!;
    expect(item.cues.has('alpha')).toBe(true);
    expect(item.cues.has('beta')).toBe(true);
  });

  it('merges glossary_semantic keywords as cues', () => {
    const rows = makeRows({
      gs: [{ uri: 'test://a', glossary_semantic_score: 0.85, keyword: 'hello' }],
    });
    const byUri = collectCandidates(rows);
    expect(byUri.get('test://a')!.cues.has('hello')).toBe(true);
  });

  it('tracks view_types from dense and lexical', () => {
    const rows = makeRows({
      dense: [{ uri: 'test://a', semantic_score: 0.5, weight: 1, view_type: 'gist' }],
      lexical: [{ uri: 'test://a', lexical_score: 0.3, weight: 1, view_type: 'question' }],
    });
    const byUri = collectCandidates(rows);
    const item = byUri.get('test://a')!;
    expect(item.view_types.has('gist')).toBe(true);
    expect(item.view_types.has('question')).toBe(true);
    expect(item.semantic_views.has('gist')).toBe(true);
    expect(item.lexical_views.has('question')).toBe(true);
  });

  it('tracks lexical hit types', () => {
    const rows = makeRows({
      lexical: [{
        uri: 'test://a', lexical_score: 0.3, weight: 1, view_type: 'gist',
        fts_hit: true, text_hit: true, uri_hit: true,
      }],
    });
    const byUri = collectCandidates(rows);
    const item = byUri.get('test://a')!;
    expect(item.matched_on.has('fts')).toBe(true);
    expect(item.matched_on.has('text')).toBe(true);
    expect(item.matched_on.has('uri')).toBe(true);
  });

  it('handles empty rows', () => {
    const byUri = collectCandidates(makeRows());
    expect(byUri.size).toBe(0);
  });

  it('skips rows with null buildCandidateKey', () => {
    const rows = makeRows({
      exact: [{ uri: '', exact_score: 0.5, weight: 1 }],
    });
    const byUri = collectCandidates(rows);
    expect(byUri.size).toBe(0);
  });

  it('uses custom viewPriors when provided', () => {
    const rows = makeRows({
      dense: [{ uri: 'test://a', semantic_score: 0.5, weight: 1, view_type: 'gist' }],
    });
    const byUri = collectCandidates(rows, { viewPriors: { gist: 0.10 } });
    expect(byUri.get('test://a')!.view_bonus).toBe(0.10);
  });

  it('merges updated_at timestamps (takes newest)', () => {
    const rows = makeRows({
      exact: [{ uri: 'test://a', exact_score: 0.5, weight: 1, updated_at: '2025-01-01' }],
      dense: [{ uri: 'test://a', semantic_score: 0.3, weight: 1, view_type: 'gist', updated_at: '2026-01-01' }],
    });
    const byUri = collectCandidates(rows);
    const item = byUri.get('test://a')!;
    expect(item.updated_at!.getFullYear()).toBe(2026);
  });
});

// ─── runStrategy ────────────────────────────────────────────────────

describe('runStrategy', () => {
  const simpleMap = new Map();
  simpleMap.set('test://a', {
    uri: 'test://a', priority: 1, disclosure: '',
    exact_score: 0.5, glossary_semantic_score: 0, dense_score: 0.4, lexical_score: 0.1,
    view_bonus: 0, matched_on: new Set(['exact', 'dense']), cues: new Set(),
    view_types: new Set(['gist']), semantic_views: new Set(['gist']),
    lexical_views: new Set(), updated_at: null,
  });

  it('dispatches to normalized_linear', () => {
    const results = runStrategy('normalized_linear', simpleMap, baseConfig);
    expect(results).toHaveLength(1);
    expect(results[0].uri).toBe('test://a');
  });

  it('dispatches to raw_score', () => {
    const results = runStrategy('raw_score', simpleMap, baseConfig);
    expect(results).toHaveLength(1);
  });

  it('dispatches to raw_plus_lex_damp', () => {
    const results = runStrategy('raw_plus_lex_damp', simpleMap, baseConfig);
    expect(results).toHaveLength(1);
  });

  it('dispatches to rrf', () => {
    const results = runStrategy('rrf', simpleMap, baseConfig);
    expect(results).toHaveLength(1);
  });

  it('dispatches to weighted_rrf', () => {
    const results = runStrategy('weighted_rrf', simpleMap, baseConfig);
    expect(results).toHaveLength(1);
  });

  it('dispatches to max_signal', () => {
    const results = runStrategy('max_signal', simpleMap, baseConfig);
    expect(results).toHaveLength(1);
  });

  it('dispatches to cascade', () => {
    const results = runStrategy('cascade', simpleMap, baseConfig);
    expect(results).toHaveLength(1);
  });

  it('dispatches to dense_floor', () => {
    const results = runStrategy('dense_floor', simpleMap, baseConfig);
    expect(results).toHaveLength(1);
  });

  it('throws for unknown strategy', () => {
    expect(() => runStrategy('nonexistent', simpleMap, baseConfig)).toThrow('Unknown scoring strategy: nonexistent');
  });
});
