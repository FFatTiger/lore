import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../view/embeddings', () => ({
  embedTexts: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  resolveEmbeddingConfig: vi.fn().mockResolvedValue({ model: 'test-model', base_url: '', api_key: '' }),
}));
vi.mock('../../view/retrieval', () => ({
  NORMALIZED_DOCUMENTS_CTE: 'WITH normalized_documents AS (SELECT 1)',
}));
vi.mock('../../view/viewBuilders', () => ({
  getFtsConfig: vi.fn().mockResolvedValue('simple'),
  getFtsQueryConfig: vi.fn().mockResolvedValue('simple'),
  countQueryTokens: vi.fn().mockResolvedValue(3),
}));
vi.mock('../../view/memoryViewQueries', () => ({
  fetchDenseMemoryViewRows: vi.fn().mockResolvedValue([]),
  fetchLexicalMemoryViewRows: vi.fn().mockResolvedValue([]),
  fetchExactMemoryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../glossarySemantic', () => ({
  fetchGlossarySemanticRows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../recall/recallScoring', () => ({
  collectCandidates: vi.fn().mockReturnValue(new Map()),
  runStrategy: vi.fn().mockReturnValue([]),
  DEFAULT_STRATEGY: 'raw_plus_lex_damp',
  STRATEGIES: ['raw_plus_lex_damp'],
}));
vi.mock('../../config/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({
    'recall.scoring.strategy': 'raw_plus_lex_damp',
    'recall.scoring.rrf_k': 20,
    'recall.scoring.dense_floor': 0.5,
    'recall.scoring.gs_floor': 0.4,
    'recall.weights.w_exact': 0.3,
    'recall.weights.w_glossary_semantic': 0.25,
    'recall.weights.w_dense': 0.3,
    'recall.weights.w_lexical': 0.03,
    'recall.bonus.priority_base': 0.05,
    'recall.bonus.priority_step': 0.01,
    'recall.bonus.multi_view_step': 0.015,
    'recall.bonus.multi_view_cap': 0.05,
    'recall.recency.enabled': false,
    'recall.recency.half_life_days': 180,
    'recall.recency.max_bonus': 0.04,
    'recall.recency.priority_exempt': 1,
    'views.prior.gist': 0.03,
    'views.prior.question': 0.02,
  }),
}));

import { sql } from '../../../db';
import { searchMemories } from '../search';
import { runStrategy } from '../../recall/recallScoring';

const mockSql = vi.mocked(sql);
const mockRunStrategy = vi.mocked(runStrategy);

describe('searchMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue({ rows: [], rowCount: 0 } as any);
  });

  it('returns empty for blank query', async () => {
    const result = await searchMemories({ query: '' });
    expect(result.results).toEqual([]);
  });

  it('returns results from recall pipeline', async () => {
    mockRunStrategy.mockReturnValue([
      { uri: 'core://test', score: 0.85, priority: 1, disclosure: 'test', cues: ['dense'], view_types: ['gist'], timestamps: [] },
    ]);
    // Mock content fetch
    mockSql.mockResolvedValue({
      rows: [{ uri: 'core://test', latest_content: 'Full content here' }],
      rowCount: 1,
    } as any);

    const result = await searchMemories({ query: 'test query', limit: 5, content_limit: 5 });
    expect(result.results.length).toBe(1);
    expect(result.results[0].uri).toBe('core://test');
    expect(result.results[0].content).toBe('Full content here');
    expect(result.results[0].score_display).toBe(0.85);
  });

  it('respects content_limit', async () => {
    mockRunStrategy.mockReturnValue([
      { uri: 'core://a', score: 0.9, priority: 0, disclosure: '', cues: [], view_types: [], timestamps: [] },
      { uri: 'core://b', score: 0.8, priority: 1, disclosure: '', cues: [], view_types: [], timestamps: [] },
      { uri: 'core://c', score: 0.7, priority: 2, disclosure: '', cues: [], view_types: [], timestamps: [] },
    ]);
    mockSql.mockResolvedValue({
      rows: [{ uri: 'core://a', latest_content: 'content A' }],
      rowCount: 1,
    } as any);

    const result = await searchMemories({ query: 'test', limit: 10, content_limit: 1 });
    expect(result.results.length).toBe(3);
    expect(result.results[0].content).toBe('content A');
    expect(result.results[1].content).toBeNull();
    expect(result.results[2].content).toBeNull();
  });

  it('includes meta with candidate counts', async () => {
    const result = await searchMemories({ query: 'test' });
    expect(result.meta.query).toBe('test');
    expect(result.meta.strategy).toBe('raw_plus_lex_damp');
    expect(result.meta.candidates).toHaveProperty('exact');
    expect(result.meta.candidates).toHaveProperty('dense');
    expect(result.meta.candidates).toHaveProperty('content_lexical');
  });
});
