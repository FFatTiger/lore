import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database and external dependencies
vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../view/embeddings', () => ({
  embedTexts: vi.fn(),
  vectorLiteral: vi.fn(),
  resolveEmbeddingConfig: vi.fn(),
}));
vi.mock('../../view/retrieval', () => ({
  NORMALIZED_DOCUMENTS_CTE: '',
}));
vi.mock('../../view/viewBuilders', () => ({
  getFtsConfig: vi.fn().mockResolvedValue('simple'),
  getFtsQueryConfig: vi.fn().mockResolvedValue('simple'),
}));

import { sql } from '../../../db';
import { resolveEmbeddingConfig, embedTexts, vectorLiteral } from '../../view/embeddings';
import { mergeSearchResults, dedupeMatchedOn, searchMemories } from '../search';

// ---- Typed helpers ----

function makeLexicalRow(overrides: Record<string, unknown> = {}) {
  return {
    uri: 'core://test',
    domain: 'core',
    path: 'test',
    priority: 0,
    disclosure: null,
    snippet: 'test snippet',
    fts_score: 0,
    exact_score: 0,
    fts_hit: false,
    uri_hit: false,
    path_hit: false,
    name_hit: false,
    glossary_hit: false,
    disclosure_hit: false,
    content_hit: false,
    ...overrides,
  };
}

function makeSemanticRow(overrides: Record<string, unknown> = {}) {
  return {
    uri: 'core://test',
    domain: 'core',
    path: 'test',
    priority: 0,
    disclosure: null,
    snippet: 'semantic snippet',
    semantic_score: 0.8,
    ...overrides,
  };
}

// ---- mergeSearchResults ----

describe('mergeSearchResults', () => {
  it('merges lexical-only results', () => {
    const lexicalRows = [
      makeLexicalRow({
        uri: 'core://a',
        path: 'a',
        snippet: 'test',
        fts_score: 0.5,
        exact_score: 0.1,
        fts_hit: true,
        content_hit: true,
      }),
    ];
    const result = mergeSearchResults({ lexicalRows, semanticRows: [], limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].uri).toBe('core://a');
    expect(result[0].score).toBeCloseTo(0.6, 5);
    expect(result[0].matched_on).toContain('fts');
    expect(result[0].matched_on).toContain('content');
  });

  it('merges semantic-only results', () => {
    const semanticRows = [
      makeSemanticRow({ uri: 'core://b', path: 'b', priority: 1, semantic_score: 0.9 }),
    ];
    const result = mergeSearchResults({ lexicalRows: [], semanticRows, limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].uri).toBe('core://b');
    expect(result[0].score).toBeCloseTo(0.9 * 0.55, 5);
    expect(result[0].matched_on).toEqual(['semantic']);
  });

  it('combines scores for same URI from lexical and semantic', () => {
    const lexicalRows = [
      makeLexicalRow({
        uri: 'core://c',
        path: 'c',
        snippet: 'test',
        fts_score: 0.4,
        exact_score: 0.1,
        fts_hit: true,
      }),
    ];
    const semanticRows = [
      makeSemanticRow({ uri: 'core://c', path: 'c', snippet: '', semantic_score: 0.8 }),
    ];
    const result = mergeSearchResults({ lexicalRows, semanticRows, limit: 10 });
    expect(result).toHaveLength(1);
    // lexical_score = 0.4 + 0.1 = 0.5; combined = 0.5 + 0.8 * 0.55 = 0.94
    expect(result[0].score).toBeCloseTo(0.94, 5);
    expect(result[0].matched_on).toContain('fts');
    expect(result[0].matched_on).toContain('semantic');
  });

  it('respects limit', () => {
    const lexicalRows = Array.from({ length: 5 }, (_, i) =>
      makeLexicalRow({
        uri: `core://item${i}`,
        path: `item${i}`,
        fts_score: 0.5 - i * 0.1,
        fts_hit: true,
      }),
    );
    const result = mergeSearchResults({ lexicalRows, semanticRows: [], limit: 3 });
    expect(result).toHaveLength(3);
  });

  it('sorts by score desc, then priority asc, then uri asc', () => {
    const lexicalRows = [
      makeLexicalRow({ uri: 'core://b', path: 'b', priority: 1, fts_score: 0.5, fts_hit: true }),
      makeLexicalRow({ uri: 'core://a', path: 'a', priority: 0, fts_score: 0.5, fts_hit: true }),
    ];
    const result = mergeSearchResults({ lexicalRows, semanticRows: [], limit: 10 });
    // Same score, priority 0 < 1, so 'a' first
    expect(result[0].uri).toBe('core://a');
    expect(result[1].uri).toBe('core://b');
  });

  it('returns empty for empty input', () => {
    const result = mergeSearchResults({ lexicalRows: [], semanticRows: [], limit: 10 });
    expect(result).toEqual([]);
  });

  it('includes score_breakdown in results', () => {
    const lexicalRows = [
      makeLexicalRow({
        uri: 'core://x',
        path: 'x',
        fts_score: 0.3,
        exact_score: 0.2,
        fts_hit: true,
      }),
    ];
    const result = mergeSearchResults({ lexicalRows, semanticRows: [], limit: 10 });
    expect(result[0].score_breakdown).toEqual({
      fts: expect.any(Number),
      exact: expect.any(Number),
      semantic: 0,
    });
  });

  // ---- New test cases ----

  it('semantic-only result has 0 lexical scores in breakdown', () => {
    const semanticRows = [makeSemanticRow({ uri: 'core://sem', path: 'sem', semantic_score: 0.7 })];
    const result = mergeSearchResults({ lexicalRows: [], semanticRows, limit: 10 });
    expect(result[0].score_breakdown.fts).toBe(0);
    expect(result[0].score_breakdown.exact).toBe(0);
    expect(result[0].score_breakdown.semantic).toBeCloseTo(0.7, 5);
  });

  it('score is rounded to 6 decimal places', () => {
    const lexicalRows = [
      makeLexicalRow({ uri: 'core://round', path: 'r', fts_score: 1 / 3, exact_score: 0 }),
    ];
    const result = mergeSearchResults({ lexicalRows, semanticRows: [], limit: 10 });
    const decimals = result[0].score.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });

  it('deduplicates matched_on when same URI appears in both lexical and semantic', () => {
    const lexicalRows = [
      makeLexicalRow({ uri: 'core://dup', path: 'dup', fts_hit: true }),
    ];
    const semanticRows = [makeSemanticRow({ uri: 'core://dup', path: 'dup', semantic_score: 0.5 })];
    const result = mergeSearchResults({ lexicalRows, semanticRows, limit: 10 });
    const matchedOn = result[0].matched_on;
    // Each value should appear at most once
    expect(matchedOn.length).toBe(new Set(matchedOn).size);
    expect(matchedOn).toContain('fts');
    expect(matchedOn).toContain('semantic');
  });

  it('falls back to semantic snippet when lexical snippet is empty', () => {
    const lexicalRows = [
      makeLexicalRow({ uri: 'core://snip', path: 'snip', snippet: '' }),
    ];
    const semanticRows = [
      makeSemanticRow({ uri: 'core://snip', path: 'snip', snippet: 'semantic text here', semantic_score: 0.6 }),
    ];
    const result = mergeSearchResults({ lexicalRows, semanticRows, limit: 10 });
    expect(result[0].snippet).toBe('semantic text here');
  });

  it('retains existing snippet if lexical snippet is non-empty', () => {
    const lexicalRows = [
      makeLexicalRow({ uri: 'core://snip2', path: 'snip2', snippet: 'lexical snippet' }),
    ];
    const semanticRows = [
      makeSemanticRow({ uri: 'core://snip2', path: 'snip2', snippet: 'semantic text', semantic_score: 0.6 }),
    ];
    const result = mergeSearchResults({ lexicalRows, semanticRows, limit: 10 });
    expect(result[0].snippet).toBe('lexical snippet');
  });

  it('orders multiple semantic-only results by score desc', () => {
    const semanticRows = [
      makeSemanticRow({ uri: 'core://low', path: 'low', semantic_score: 0.3 }),
      makeSemanticRow({ uri: 'core://high', path: 'high', semantic_score: 0.9 }),
      makeSemanticRow({ uri: 'core://mid', path: 'mid', semantic_score: 0.6 }),
    ];
    const result = mergeSearchResults({ lexicalRows: [], semanticRows, limit: 10 });
    expect(result[0].uri).toBe('core://high');
    expect(result[1].uri).toBe('core://mid');
    expect(result[2].uri).toBe('core://low');
  });

  it('all hit flags populate matched_on correctly', () => {
    const lexicalRows = [
      makeLexicalRow({
        uri: 'core://allhits',
        path: 'allhits',
        fts_hit: true,
        uri_hit: true,
        path_hit: true,
        name_hit: true,
        glossary_hit: true,
        disclosure_hit: true,
        content_hit: true,
      }),
    ];
    const result = mergeSearchResults({ lexicalRows, semanticRows: [], limit: 10 });
    expect(result[0].matched_on).toEqual(
      expect.arrayContaining(['fts', 'uri', 'path', 'name', 'glossary', 'disclosure', 'content']),
    );
    expect(result[0].matched_on).toHaveLength(7);
  });

  it('uses the larger semantic score when same URI appears in semantic rows multiple times via merge', () => {
    // Two semantic rows for the same URI (shouldn't happen from DB, but mergeSearchResults
    // processes rows in order — the second sets semantic_score = max(existing, new))
    const semanticRows = [
      makeSemanticRow({ uri: 'core://maxsem', path: 'ms', semantic_score: 0.4 }),
      makeSemanticRow({ uri: 'core://maxsem', path: 'ms', semantic_score: 0.9 }),
    ];
    const result = mergeSearchResults({ lexicalRows: [], semanticRows, limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].score_breakdown.semantic).toBeCloseTo(0.9, 5);
  });
});

// ---- dedupeMatchedOn ----

describe('dedupeMatchedOn', () => {
  it('removes duplicate values', () => {
    expect(dedupeMatchedOn(['fts', 'fts', 'semantic'])).toEqual(['fts', 'semantic']);
  });

  it('removes empty strings and whitespace-only values', () => {
    expect(dedupeMatchedOn(['', '  ', 'fts', null, undefined])).toEqual(['fts']);
  });

  it('returns empty array for all-empty input', () => {
    expect(dedupeMatchedOn([])).toEqual([]);
  });

  it('trims whitespace before deduplication', () => {
    expect(dedupeMatchedOn([' fts', 'fts ', 'fts'])).toEqual(['fts']);
  });
});

// ---- searchMemories ----

describe('searchMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: sql returns empty rows
    vi.mocked(sql).mockResolvedValue({ rows: [], rowCount: 0 } as any);
    vi.mocked(resolveEmbeddingConfig).mockRejectedValue(new Error('no embedding config'));
    vi.mocked(vectorLiteral).mockReturnValue('[0.1,0.2]');
    vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2]]);
  });

  it('returns empty results and mode=empty for blank query', async () => {
    const response = await searchMemories({ query: '' });
    expect(response.results).toEqual([]);
    expect(response.meta.mode).toBe('empty');
    expect(sql).not.toHaveBeenCalled();
  });

  it('returns empty results and mode=empty for whitespace-only query', async () => {
    const response = await searchMemories({ query: '   ' });
    expect(response.results).toEqual([]);
    expect(response.meta.mode).toBe('empty');
  });

  it('returns empty array when no results found', async () => {
    vi.mocked(sql).mockResolvedValue({ rows: [], rowCount: 0 } as any);
    const response = await searchMemories({ query: 'ghost query' });
    expect(response.results).toEqual([]);
    expect(response.meta.query).toBe('ghost query');
  });

  it('uses lexical-only mode when embedding not configured', async () => {
    vi.mocked(resolveEmbeddingConfig).mockRejectedValue(new Error('not configured'));
    const response = await searchMemories({ query: 'test' });
    expect(response.meta.mode).toBe('lexical');
  });

  it('uses hybrid mode when embedding is configured and hybrid=true', async () => {
    vi.mocked(resolveEmbeddingConfig).mockResolvedValue({
      base_url: 'http://embed',
      api_key: 'key',
      model: 'text-embed',
    });
    vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(sql).mockResolvedValue({ rows: [], rowCount: 0 } as any);
    const response = await searchMemories({ query: 'hybrid test', hybrid: true });
    expect(response.meta.mode).toBe('hybrid');
  });

  it('uses lexical-only mode when hybrid=false even if embedding configured', async () => {
    vi.mocked(resolveEmbeddingConfig).mockResolvedValue({
      base_url: 'http://embed',
      api_key: 'key',
      model: 'text-embed',
    });
    const response = await searchMemories({ query: 'test', hybrid: false });
    expect(response.meta.mode).toBe('lexical');
    // resolveEmbeddingConfig should NOT be called for embedding resolution
    // (it's called inside normalizeEmbedding → resolveEmbeddingConfig)
  });

  it('enforces limit in results', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      uri: `core://r${i}`,
      domain: 'core',
      path: `r${i}`,
      priority: 0,
      disclosure: null,
      snippet: '',
      fts_score: 1.0 - i * 0.05,
      exact_score: 0,
      fts_hit: true,
      uri_hit: false,
      path_hit: false,
      name_hit: false,
      glossary_hit: false,
      disclosure_hit: false,
      content_hit: false,
    }));
    vi.mocked(sql).mockResolvedValue({ rows, rowCount: rows.length } as any);
    const response = await searchMemories({ query: 'limit test', limit: 3 });
    expect(response.results.length).toBeLessThanOrEqual(3);
    expect(response.meta.limit).toBe(3);
  });

  it('records semantic_error when semantic search throws', async () => {
    vi.mocked(resolveEmbeddingConfig).mockResolvedValue({
      base_url: 'http://embed',
      api_key: 'key',
      model: 'text-embed',
    });
    // First sql call (lexical) succeeds; second (semantic, via embedTexts) throws
    vi.mocked(embedTexts).mockRejectedValue(new Error('embed service down'));
    vi.mocked(sql).mockResolvedValue({ rows: [], rowCount: 0 } as any);
    const response = await searchMemories({ query: 'err test', hybrid: true });
    expect(response.meta.semantic_error).toBe('embed service down');
    expect(response.meta.mode).toBe('hybrid');
  });

  it('includes meta fields in response', async () => {
    const response = await searchMemories({ query: 'meta check', domain: 'work', limit: 5 });
    expect(response.meta).toMatchObject({
      query: 'meta check',
      domain: 'work',
      limit: 5,
    });
  });

  it('trims query and reflects trimmed value in meta', async () => {
    const response = await searchMemories({ query: '  hello world  ' });
    expect(response.meta.query).toBe('hello world');
  });
});
