import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before imports
vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../embeddings', () => ({
  vectorLiteral: vi.fn((v: unknown) => (Array.isArray(v) ? `[${(v as number[]).join(',')}]` : String(v))),
}));
vi.mock('../retrieval', () => ({
  NORMALIZED_DOCUMENTS_CTE: 'WITH normalized_documents AS (SELECT 1)',
}));
vi.mock('../viewBuilders', () => ({
  getFtsConfig: vi.fn().mockResolvedValue('simple'),
  getFtsQueryConfig: vi.fn().mockResolvedValue('simple'),
}));
vi.mock('../../config/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({
    'views.weight.gist': 1.0,
    'views.weight.question': 0.96,
    'views.prior.gist': 0.03,
    'views.prior.question': 0.02,
    'view_llm.base_url': 'http://localhost:11434',
    'view_llm.model': 'llama3',
    'view_llm.temperature': 0.2,
    'view_llm.timeout_ms': 30000,
    'view_llm.max_docs_per_run': 10,
  }),
}));

import { sql } from '../../../db';
import {
  fetchDenseMemoryViewRows,
  fetchLexicalMemoryViewRows,
  fetchExactMemoryRows,
  buildCandidateKey,
  extractCueTerms,
  getViewPrior,
  getMemoryViewRuntimeConfig,
  listMemoryViewsByNode,
} from '../memoryViewQueries';

const mockSql = vi.mocked(sql);

// ---------------------------------------------------------------------------
// buildCandidateKey
// ---------------------------------------------------------------------------

describe('buildCandidateKey', () => {
  it('returns trimmed uri string', () => {
    expect(buildCandidateKey({ uri: '  core://soul/prefs  ' })).toBe('core://soul/prefs');
  });

  it('returns empty string when uri is missing', () => {
    expect(buildCandidateKey({ uri: undefined })).toBe('');
    expect(buildCandidateKey({})).toBe('');
  });

  it('returns empty string for null/undefined row', () => {
    expect(buildCandidateKey(null)).toBe('');
    expect(buildCandidateKey(undefined)).toBe('');
  });

  it('converts non-string uri to string', () => {
    expect(buildCandidateKey({ uri: 42 as unknown as string })).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// extractCueTerms
// ---------------------------------------------------------------------------

describe('extractCueTerms', () => {
  it('returns glossary_terms when present', () => {
    const row = { metadata: { glossary_terms: ['alpha', 'beta', 'gamma'] } };
    const terms = extractCueTerms(row);
    expect(terms).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('falls back to cue_terms when glossary_terms is empty', () => {
    const row = { metadata: { glossary_terms: [], cue_terms: ['x', 'y'] } };
    const terms = extractCueTerms(row);
    expect(terms).toEqual(['x', 'y']);
  });

  it('deduplicates terms (case-insensitive)', () => {
    const row = { metadata: { glossary_terms: ['Alpha', 'alpha', 'Beta'] } };
    const terms = extractCueTerms(row);
    expect(terms).toEqual(['Alpha', 'Beta']);
  });

  it('limits output to 6 terms', () => {
    const many = Array.from({ length: 20 }, (_, i) => `term${i}`);
    const row = { metadata: { glossary_terms: many } };
    const terms = extractCueTerms(row);
    expect(terms).toHaveLength(6);
  });

  it('returns empty array when metadata is absent', () => {
    expect(extractCueTerms({})).toEqual([]);
    expect(extractCueTerms(null)).toEqual([]);
    expect(extractCueTerms(undefined)).toEqual([]);
  });

  it('returns empty array when metadata is not an object', () => {
    expect(extractCueTerms({ metadata: 'string' })).toEqual([]);
    expect(extractCueTerms({ metadata: 42 })).toEqual([]);
  });

  it('prioritizes glossary_terms over cue_terms', () => {
    const row = {
      metadata: {
        glossary_terms: ['from-glossary'],
        cue_terms: ['from-cue'],
      },
    };
    const terms = extractCueTerms(row);
    expect(terms).toContain('from-glossary');
    expect(terms).not.toContain('from-cue');
  });
});

// ---------------------------------------------------------------------------
// getViewPrior
// ---------------------------------------------------------------------------

describe('getViewPrior', () => {
  it('returns 0.03 for gist', () => {
    expect(getViewPrior('gist')).toBe(0.03);
  });

  it('returns 0.02 for question', () => {
    expect(getViewPrior('question')).toBe(0.02);
  });

  it('returns 0 for unknown view types', () => {
    expect(getViewPrior('exact')).toBe(0);
    expect(getViewPrior('other')).toBe(0);
    expect(getViewPrior('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getMemoryViewRuntimeConfig
// ---------------------------------------------------------------------------

describe('getMemoryViewRuntimeConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns correct structure', async () => {
    const config = await getMemoryViewRuntimeConfig();
    expect(config).toHaveProperty('generator_version', 'phase1-v2-llm');
    expect(config).toHaveProperty('view_types');
    expect(config.view_types).toContain('gist');
    expect(config.view_types).toContain('question');
    expect(config).toHaveProperty('weights');
    expect(config).toHaveProperty('priors');
    expect(config).toHaveProperty('llm');
  });

  it('sets llm.enabled=true when base_url is provided', async () => {
    const config = await getMemoryViewRuntimeConfig();
    expect(config.llm.enabled).toBe(true);
    expect(config.llm.base_url).toBe('http://localhost:11434');
  });

  it('sets llm.enabled=false when base_url is empty', async () => {
    const { getSettings } = await import('../../config/settings');
    vi.mocked(getSettings).mockResolvedValueOnce({
      'views.weight.gist': 1.0,
      'views.weight.question': 0.96,
      'views.prior.gist': 0.03,
      'views.prior.question': 0.02,
      'view_llm.base_url': '',
      'view_llm.model': '',
      'view_llm.temperature': 0.2,
      'view_llm.timeout_ms': 30000,
      'view_llm.max_docs_per_run': 5,
    });
    const config = await getMemoryViewRuntimeConfig();
    expect(config.llm.enabled).toBe(false);
    expect(config.llm.base_url).toBeNull();
  });

  it('strips trailing slash from base_url', async () => {
    const { getSettings } = await import('../../config/settings');
    vi.mocked(getSettings).mockResolvedValueOnce({
      'views.weight.gist': 1.0,
      'views.weight.question': 0.96,
      'views.prior.gist': 0.03,
      'views.prior.question': 0.02,
      'view_llm.base_url': 'http://localhost:11434/',
      'view_llm.model': 'llama3',
      'view_llm.temperature': 0.2,
      'view_llm.timeout_ms': 30000,
      'view_llm.max_docs_per_run': 5,
    });
    const config = await getMemoryViewRuntimeConfig();
    expect(config.llm.base_url).toBe('http://localhost:11434');
  });

  it('normalizes numeric settings correctly', async () => {
    const config = await getMemoryViewRuntimeConfig();
    expect(config.llm.max_docs_per_run).toBe(10);
    expect(config.llm.timeout_ms).toBe(30000);
    expect(config.llm.temperature).toBe(0.2);
  });

  it('sets model to null when empty', async () => {
    const { getSettings } = await import('../../config/settings');
    vi.mocked(getSettings).mockResolvedValueOnce({
      'views.weight.gist': 1.0,
      'views.weight.question': 0.96,
      'views.prior.gist': 0.03,
      'views.prior.question': 0.02,
      'view_llm.base_url': 'http://localhost:11434',
      'view_llm.model': '   ',
      'view_llm.temperature': 0.2,
      'view_llm.timeout_ms': 30000,
      'view_llm.max_docs_per_run': 0,
    });
    const config = await getMemoryViewRuntimeConfig();
    expect(config.llm.model).toBeNull();
    expect(config.llm.max_docs_per_run).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchDenseMemoryViewRows
// ---------------------------------------------------------------------------

describe('fetchDenseMemoryViewRows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls sql and returns rows', async () => {
    mockSql.mockResolvedValueOnce({ rows: [{ uri: 'core://a', view_type: 'gist' }], rowCount: 1 } as any);
    const rows = await fetchDenseMemoryViewRows({
      embedding: { model: 'text-embed-ada' },
      queryVector: [0.1, 0.2, 0.3],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].uri).toBe('core://a');
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('includes domain filter when provided', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await fetchDenseMemoryViewRows({
      embedding: { model: 'model-x' },
      queryVector: [0.5],
      domain: 'work',
    });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('domain =');
    expect(params).toContain('work');
  });

  it('does not include domain filter when domain is null', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await fetchDenseMemoryViewRows({
      embedding: { model: 'model-x' },
      queryVector: [0.5],
      domain: null,
    });
    const [query] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).not.toContain('domain =');
  });

  it('clamps limit to 1-300 range', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await fetchDenseMemoryViewRows({
      embedding: { model: 'm' },
      queryVector: [],
      limit: 999,
    });
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[params.length - 1]).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// fetchLexicalMemoryViewRows
// ---------------------------------------------------------------------------

describe('fetchLexicalMemoryViewRows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty array for blank query', async () => {
    const rows = await fetchLexicalMemoryViewRows({ query: '' });
    expect(rows).toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns empty array for whitespace-only query', async () => {
    const rows = await fetchLexicalMemoryViewRows({ query: '   ' });
    expect(rows).toEqual([]);
  });

  it('calls sql and returns rows for valid query', async () => {
    mockSql.mockResolvedValueOnce({ rows: [{ uri: 'core://b' }], rowCount: 1 } as any);
    const rows = await fetchLexicalMemoryViewRows({ query: 'hello world' });
    expect(rows).toHaveLength(1);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('includes domain filter when provided', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await fetchLexicalMemoryViewRows({ query: 'test', domain: 'personal' });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('domain =');
    expect(params).toContain('personal');
  });
});

// ---------------------------------------------------------------------------
// fetchExactMemoryRows
// ---------------------------------------------------------------------------

describe('fetchExactMemoryRows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty array for blank query', async () => {
    const rows = await fetchExactMemoryRows({ query: '' });
    expect(rows).toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('calls sql for a valid query', async () => {
    mockSql.mockResolvedValueOnce({ rows: [{ uri: 'core://c', exact_score: 1.0 }], rowCount: 1 } as any);
    const rows = await fetchExactMemoryRows({ query: 'agent/prefs' });
    expect(rows).toHaveLength(1);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('includes domain filter when provided', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await fetchExactMemoryRows({ query: 'something', domain: 'work' });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('nd.domain =');
    expect(params).toContain('work');
  });
});

// ---------------------------------------------------------------------------
// listMemoryViewsByNode
// ---------------------------------------------------------------------------

describe('listMemoryViewsByNode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty array when neither nodeUuid nor uri provided', async () => {
    const rows = await listMemoryViewsByNode({});
    expect(rows).toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns empty array with no arguments', async () => {
    const rows = await listMemoryViewsByNode();
    expect(rows).toEqual([]);
  });

  it('queries by nodeUuid when provided', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await listMemoryViewsByNode({ nodeUuid: 'uuid-abc' });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('node_uuid =');
    expect(params).toContain('uuid-abc');
  });

  it('queries by uri when provided', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await listMemoryViewsByNode({ uri: 'core://soul/prefs' });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('uri =');
    expect(params).toContain('core://soul/prefs');
  });

  it('maps rows to typed objects with correct field transformations', async () => {
    const fakeRow = {
      id: 1,
      uri: 'core://test',
      node_uuid: 'u-1',
      memory_id: 10,
      view_type: 'gist',
      source: 'generated',
      status: 'active',
      weight: '1.5',
      text_content: 'hello',
      embedding_model: 'text-embed',
      embedding_dim: '384',
      metadata: { cue_terms: ['a'] },
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-06-01T12:00:00.000Z',
    };
    mockSql.mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 } as any);
    const rows = await listMemoryViewsByNode({ nodeUuid: 'u-1' });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.weight).toBe(1.5);
    expect(row.embedding_dim).toBe(384);
    expect(row.metadata).toEqual({ cue_terms: ['a'] });
    expect(typeof row.created_at).toBe('string');
    expect(typeof row.updated_at).toBe('string');
  });

  it('handles null created_at/updated_at gracefully', async () => {
    const fakeRow = {
      id: 2,
      uri: 'core://empty',
      node_uuid: 'u-2',
      memory_id: 11,
      view_type: 'question',
      source: null,
      status: 'active',
      weight: null,
      text_content: null,
      embedding_model: null,
      embedding_dim: null,
      metadata: null,
      created_at: null,
      updated_at: null,
    };
    mockSql.mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 } as any);
    const rows = await listMemoryViewsByNode({ uri: 'core://empty' });
    expect(rows[0].created_at).toBeNull();
    expect(rows[0].updated_at).toBeNull();
    expect(rows[0].weight).toBe(0);
    expect(rows[0].text_content).toBe('');
    expect(rows[0].metadata).toEqual({});
  });

  it('clamps limit between 1 and 50', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await listMemoryViewsByNode({ uri: 'core://x', limit: 999 });
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[params.length - 1]).toBe(50);
  });
});
