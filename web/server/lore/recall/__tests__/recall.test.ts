import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database and external dependencies
vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../view/embeddings', () => ({
  embedTexts: vi.fn(),
  vectorLiteral: vi.fn(),
  resolveEmbeddingConfig: vi.fn((e: unknown) => e || { model: 'test', base_url: 'http://test', dimensions: 768 }),
  getEmbeddingRuntimeConfig: vi.fn(),
}));
vi.mock('../../search/glossarySemantic', () => ({
  ensureGlossaryEmbeddingsIndex: vi.fn(),
  fetchGlossarySemanticRows: vi.fn(),
}));
vi.mock('../../view/viewCrud', () => ({
  ensureMemoryViewsReady: vi.fn(),
  ensureMemoryViewsIndex: vi.fn(),
  upsertGeneratedMemoryViewsForPath: vi.fn(),
}));
vi.mock('../../view/viewBuilders', () => ({
  countQueryTokens: vi.fn().mockResolvedValue(3),
  viewWeight: (vt: string) => vt === 'gist' ? 1.0 : vt === 'question' ? 0.96 : 1.0,
  viewPrior: (vt: string) => vt === 'gist' ? 0.03 : vt === 'question' ? 0.02 : 0,
  dedupeTerms: (values: unknown[], max = 8) => {
    const out: string[] = []; const seen = new Set<string>();
    for (const v of values) { const t = String(v || '').trim(); const k = t.toLowerCase(); if (!t || seen.has(k)) continue; seen.add(k); out.push(t); if (out.length >= max) break; }
    return out;
  },
  truncate: (v: unknown, m: number) => { const t = String(v || '').replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(); return t.length <= m ? t : `${t.slice(0, m)}…`; },
}));
vi.mock('../../view/memoryViewQueries', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchDenseMemoryViewRows: vi.fn(),
    fetchLexicalMemoryViewRows: vi.fn(),
    fetchExactMemoryRows: vi.fn(),
    getMemoryViewRuntimeConfig: vi.fn(),
  };
});
vi.mock('../recallEventLog', () => ({
  logRecallEvents: vi.fn(),
}));
vi.mock('../../view/retrieval', () => ({
  NORMALIZED_DOCUMENTS_CTE: '',
  loadNormalizedDocuments: vi.fn(),
}));
vi.mock('../../config/settings', () => ({
  getSettings: vi.fn(),
}));

import {
  sanitizeDenseRow,
  sanitizeLexicalRow,
  sanitizeExactRow,
  sanitizeGlossarySemanticRow,
  aggregateCandidates,
  getRecallRuntimeConfig,
} from '../recall';
import { buildCandidateKey, extractCueTerms, getViewPrior, getMemoryViewRuntimeConfig } from '../../view/memoryViewQueries';
import { getSettings as mockGetSettings } from '../../config/settings';
import {
  resolveEmbeddingConfig as mockResolveEmbeddingConfig,
  getEmbeddingRuntimeConfig as mockGetEmbeddingRuntimeConfig,
} from '../../view/embeddings';
import { getBootUris } from '../../memory/boot';
import { DEFAULT_STRATEGY, STRATEGIES } from '../recallScoring';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSettingsMock(overrides: Record<string, unknown> = {}) {
  return (keys: string[]) => {
    const defaults: Record<string, unknown> = {
      'recall.scoring.strategy': 'raw_plus_lex_damp',
      'recall.scoring.rrf_k': 20,
      'recall.scoring.dense_floor': 0.5,
      'recall.scoring.gs_floor': 0.4,
      'recall.weights.w_exact': 0.3,
      'recall.weights.w_glossary_semantic': 0.25,
      'recall.weights.w_dense': 0.3,
      'recall.weights.w_lexical': 0.05,
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
      'recall.display.min_display_score': 0.1,
      'recall.display.max_display_items': 8,
      'recall.display.read_node_display_mode': 'soft',
      ...overrides,
    };
    const result: Record<string, unknown> = {};
    for (const k of keys) result[k] = defaults[k];
    return Promise.resolve(result);
  };
}

// ─── sanitizeDenseRow ────────────────────────────────────────────────────

describe('sanitizeDenseRow', () => {
  it('sanitizes a dense row', () => {
    const row = {
      uri: 'core://test',
      view_type: 'gist',
      weight: 1.0,
      semantic_score: 0.876543210,
      metadata: { llm_refined: true, llm_model: 'glm-5.1', cue_terms: ['hello'] },
      disclosure: 'test disclosure',
    };
    const result = sanitizeDenseRow(row);
    expect(result.uri).toBe('core://test');
    expect(result.view_type).toBe('gist');
    expect(result.weight).toBe(1.0);
    expect(result.semantic_score).toBe(0.876543);
    expect(result.llm_refined).toBe(true);
    expect(result.llm_model).toBe('glm-5.1');
    expect(result.disclosure).toBe('test disclosure');
    expect(Array.isArray(result.cue_terms)).toBe(true);
  });

  it('handles missing fields gracefully', () => {
    const row = { uri: 'core://x', view_type: 'gist' };
    const result = sanitizeDenseRow(row);
    expect(result.weight).toBe(0);
    expect(result.semantic_score).toBe(0);
    expect(result.llm_refined).toBe(false);
    expect(result.llm_model).toBe(null);
    expect(result.disclosure).toBe('');
  });
});

// ─── sanitizeLexicalRow ──────────────────────────────────────────────────

describe('sanitizeLexicalRow', () => {
  it('sanitizes a lexical row', () => {
    const row = {
      uri: 'core://lex',
      view_type: 'question',
      weight: 0.96,
      lexical_score: 0.654321789,
      fts_hit: true,
      text_hit: false,
      uri_hit: true,
      metadata: { cue_terms: ['world'] },
      disclosure: '',
    };
    const result = sanitizeLexicalRow(row);
    expect(result.uri).toBe('core://lex');
    expect(result.lexical_score).toBe(0.654322); // rounded to 6 decimals
    expect(result.fts_hit).toBe(true);
    expect(result.text_hit).toBe(false);
    expect(result.uri_hit).toBe(true);
  });

  it('defaults boolean flags to false', () => {
    const row = { uri: 'core://x', view_type: 'gist' };
    const result = sanitizeLexicalRow(row);
    expect(result.fts_hit).toBe(false);
    expect(result.text_hit).toBe(false);
    expect(result.uri_hit).toBe(false);
  });
});

// ─── sanitizeExactRow ────────────────────────────────────────────────────

describe('sanitizeExactRow', () => {
  it('sanitizes an exact row', () => {
    const row = {
      uri: 'core://exact',
      exact_score: 0.56,
      path_exact_hit: true,
      glossary_exact_hit: false,
      glossary_text_hit: true,
      query_contains_glossary_hit: false,
      metadata: {},
      disclosure: 'note',
    };
    const result = sanitizeExactRow(row);
    expect(result.uri).toBe('core://exact');
    expect(result.exact_score).toBe(0.56);
    expect(result.path_exact_hit).toBe(true);
    expect(result.glossary_text_hit).toBe(true);
    expect(result.disclosure).toBe('note');
  });

  it('includes glossary_fts_hit field', () => {
    const row = { uri: 'core://x', glossary_fts_hit: true };
    const result = sanitizeExactRow(row);
    expect(result.glossary_fts_hit).toBe(true);
  });

  it('defaults all boolean flags to false', () => {
    const row = { uri: 'core://none' };
    const result = sanitizeExactRow(row);
    expect(result.path_exact_hit).toBe(false);
    expect(result.glossary_exact_hit).toBe(false);
    expect(result.glossary_text_hit).toBe(false);
    expect(result.query_contains_glossary_hit).toBe(false);
    expect(result.glossary_fts_hit).toBe(false);
  });

  it('rounds exact_score to 6 decimal places', () => {
    const row = { uri: 'core://x', exact_score: 0.123456789 };
    const result = sanitizeExactRow(row);
    expect(result.exact_score).toBe(0.123457);
  });
});

// ─── sanitizeGlossarySemanticRow ─────────────────────────────────────────

describe('sanitizeGlossarySemanticRow', () => {
  it('sanitizes a glossary semantic row', () => {
    const row = {
      uri: 'core://glossary',
      keyword: 'test keyword',
      glossary_semantic_score: 0.912345678,
      metadata: { glossary_terms: ['term1', 'term2'] },
      disclosure: 'disclosure text',
    };
    const result = sanitizeGlossarySemanticRow(row);
    expect(result.uri).toBe('core://glossary');
    expect(result.keyword).toBe('test keyword');
    expect(result.glossary_semantic_score).toBe(0.912346); // rounded
    expect(result.disclosure).toBe('disclosure text');
  });

  it('defaults keyword to empty string', () => {
    const row = { uri: 'core://x', metadata: {} };
    const result = sanitizeGlossarySemanticRow(row);
    expect(result.keyword).toBe('');
  });

  it('returns cue_terms as array', () => {
    const row = {
      uri: 'core://x',
      metadata: { glossary_terms: ['a', 'b'] },
    };
    const result = sanitizeGlossarySemanticRow(row);
    expect(Array.isArray(result.cue_terms)).toBe(true);
  });
});

// ─── buildCandidateKey ───────────────────────────────────────────────────

describe('buildCandidateKey', () => {
  it('returns trimmed URI string', () => {
    expect(buildCandidateKey({ uri: 'core://test' })).toBe('core://test');
  });

  it('trims whitespace', () => {
    expect(buildCandidateKey({ uri: '  core://test  ' })).toBe('core://test');
  });

  it('handles missing uri', () => {
    expect(buildCandidateKey({})).toBe('');
    expect(buildCandidateKey(null)).toBe('');
  });
});

// ─── extractCueTerms ─────────────────────────────────────────────────────

describe('extractCueTerms', () => {
  it('extracts glossary terms when present', () => {
    const row = {
      metadata: {
        glossary_terms: ['term1', 'term2'],
        cue_terms: ['cue1'],
      },
    };
    expect(extractCueTerms(row)).toEqual(['term1', 'term2']);
  });

  it('falls back to cue_terms when glossary_terms is empty', () => {
    const row = {
      metadata: {
        glossary_terms: [],
        cue_terms: ['cue1', 'cue2'],
      },
    };
    expect(extractCueTerms(row)).toEqual(['cue1', 'cue2']);
  });

  it('returns empty array for no metadata', () => {
    expect(extractCueTerms({})).toEqual([]);
    expect(extractCueTerms(null)).toEqual([]);
  });

  it('respects max 6 items', () => {
    const row = {
      metadata: {
        glossary_terms: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      },
    };
    expect(extractCueTerms(row)).toHaveLength(6);
  });
});

// ─── getViewPrior ────────────────────────────────────────────────────────

describe('getViewPrior', () => {
  it('returns 0.03 for gist', () => {
    expect(getViewPrior('gist')).toBe(0.03);
  });

  it('returns 0.02 for question', () => {
    expect(getViewPrior('question')).toBe(0.02);
  });

  it('returns 0 for unknown', () => {
    expect(getViewPrior('unknown')).toBe(0);
  });
});

// ─── fixed boot manifest integration ─────────────────────────────────────

describe('fixed boot manifest integration', () => {
  it('aggregateCandidates runs without CORE_MEMORY_URIS set', () => {
    const result = aggregateCandidates({
      exactRows: [],
      glossarySemanticRows: [],
      denseRows: [],
      lexicalRows: [],
    });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── aggregateCandidates ─────────────────────────────────────────────────

describe('aggregateCandidates', () => {
  it('returns empty array when all inputs are empty', () => {
    const result = aggregateCandidates({
      exactRows: [],
      glossarySemanticRows: [],
      denseRows: [],
      lexicalRows: [],
    });
    expect(result).toEqual([]);
  });

  it('deduplicates candidates with the same URI across retrieval paths', () => {
    const uri = 'core://shared-memory';
    const result = aggregateCandidates({
      exactRows: [{ uri, exact_score: 0.8, weight: 1.0, disclosure: '' }],
      glossarySemanticRows: [{ uri, glossary_semantic_score: 0.7, disclosure: '' }],
      denseRows: [{ uri, semantic_score: 0.9, weight: 1.0, view_type: 'gist', disclosure: '' }],
      lexicalRows: [{ uri, lexical_score: 0.6, weight: 1.0, view_type: 'gist', disclosure: '' }],
    });
    // Only one result per URI
    const uris = result.map((r) => r.uri);
    expect(uris.filter((u) => u === uri)).toHaveLength(1);
  });

  it('accepts normalizedConfig alias for backward compat', () => {
    const uri = 'core://compat-test';
    const normalizedConfig = {
      strategy: 'normalized_linear',
      w_exact: 0.30,
      w_glossary_semantic: 0.25,
      w_dense: 0.30,
      w_lexical: 0.05,
      priority_base: 0.05,
      priority_step: 0.01,
      multi_view_step: 0.015,
      multi_view_cap: 0.05,
      view_priors: null,
      query_tokens: 5,
    };
    const result = aggregateCandidates({
      exactRows: [{ uri, exact_score: 0.5, weight: 1.0 }],
      glossarySemanticRows: [],
      denseRows: [],
      lexicalRows: [],
      normalizedConfig,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].uri).toBe(uri);
  });

  it('scoringConfig takes priority over normalizedConfig', () => {
    const uri = 'core://priority-test';
    const scoringConfig = {
      strategy: 'raw_score',
      w_exact: 0.30,
      w_glossary_semantic: 0.25,
      w_dense: 0.30,
      w_lexical: 0.05,
      priority_base: 0.05,
      priority_step: 0.01,
      multi_view_step: 0.015,
      multi_view_cap: 0.05,
      view_priors: null,
    };
    const normalizedConfig = {
      strategy: 'normalized_linear',
      w_exact: 0.30,
      w_glossary_semantic: 0.25,
      w_dense: 0.30,
      w_lexical: 0.05,
      priority_base: 0.05,
      priority_step: 0.01,
      multi_view_step: 0.015,
      multi_view_cap: 0.05,
      view_priors: null,
    };
    // Should not throw; raw_score strategy used
    const result = aggregateCandidates({
      exactRows: [{ uri, exact_score: 0.5, weight: 1.0 }],
      glossarySemanticRows: [],
      denseRows: [],
      lexicalRows: [],
      scoringConfig,
      normalizedConfig,
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns sorted results by score descending', () => {
    const rows = [
      { uri: 'core://low', exact_score: 0.2, weight: 1.0 },
      { uri: 'core://high', exact_score: 0.9, weight: 1.0 },
      { uri: 'core://mid', exact_score: 0.5, weight: 1.0 },
    ];
    const result = aggregateCandidates({
      exactRows: rows,
      glossarySemanticRows: [],
      denseRows: [],
      lexicalRows: [],
    });
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it('uses default normalized_linear config when neither config provided', () => {
    const result = aggregateCandidates({
      exactRows: [{ uri: 'core://x', exact_score: 0.5, weight: 1.0 }],
      glossarySemanticRows: [],
      denseRows: [],
      lexicalRows: [],
    });
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result[0].score).toBe('number');
  });

  it('handles multiple URIs with different scores', () => {
    const result = aggregateCandidates({
      exactRows: [
        { uri: 'core://a', exact_score: 0.9, weight: 1.0 },
        { uri: 'core://b', exact_score: 0.4, weight: 1.0 },
      ],
      glossarySemanticRows: [],
      denseRows: [],
      lexicalRows: [],
    });
    expect(result).toHaveLength(2);
    const uris = result.map((r) => r.uri);
    expect(uris).toContain('core://a');
    expect(uris).toContain('core://b');
  });

  it('each result has uri, score, matched_on, and cues fields', () => {
    const result = aggregateCandidates({
      exactRows: [{ uri: 'core://check', exact_score: 0.7, weight: 1.0 }],
      glossarySemanticRows: [],
      denseRows: [],
      lexicalRows: [],
    });
    expect(result[0]).toHaveProperty('uri');
    expect(result[0]).toHaveProperty('score');
    expect(result[0]).toHaveProperty('matched_on');
    expect(result[0]).toHaveProperty('cues');
  });
});

// ─── loadScoringConfig (via getRecallRuntimeConfig) ──────────────────────

describe('loadScoringConfig (via getRecallRuntimeConfig)', () => {
  beforeEach(() => {
    vi.mocked(mockGetSettings).mockImplementation(makeSettingsMock() as ReturnType<typeof vi.fn>);
    vi.mocked(mockResolveEmbeddingConfig).mockResolvedValue({ model: 'test', base_url: 'http://test', api_key: 'k' });
    vi.mocked(mockGetEmbeddingRuntimeConfig).mockResolvedValue({ model: 'test', base_url: 'http://test' });
    vi.mocked(getMemoryViewRuntimeConfig).mockResolvedValue({ fts_config: 'simple', view_types: ['gist', 'question'] });
  });

  it('runtime config scoring includes strategy and available strategies', async () => {
    const config = await getRecallRuntimeConfig(null);
    expect(config.scoring).toBeDefined();
    expect(typeof config.scoring.strategy).toBe('string');
    expect(Array.isArray(config.scoring.strategies_available)).toBe(true);
    expect(config.scoring.strategies_available.length).toBeGreaterThan(0);
  });

  it('falls back to DEFAULT_STRATEGY for unknown strategy value', async () => {
    vi.mocked(mockGetSettings).mockImplementation(
      makeSettingsMock({ 'recall.scoring.strategy': 'TOTALLY_INVALID_STRATEGY' }) as ReturnType<typeof vi.fn>,
    );
    const config = await getRecallRuntimeConfig(null);
    expect(config.scoring.strategy).toBe(DEFAULT_STRATEGY);
  });

  it('accepts valid strategies from STRATEGIES list', async () => {
    for (const strategy of STRATEGIES) {
      vi.mocked(mockGetSettings).mockImplementation(
        makeSettingsMock({ 'recall.scoring.strategy': strategy }) as ReturnType<typeof vi.fn>,
      );
      const config = await getRecallRuntimeConfig(null);
      expect(config.scoring.strategy).toBe(strategy);
    }
  });

  it('runtime config has all required top-level keys', async () => {
    const config = await getRecallRuntimeConfig(null);
    expect(config).toHaveProperty('embedding');
    expect(config).toHaveProperty('memory_views');
    expect(config).toHaveProperty('scoring');
    expect(config).toHaveProperty('recency');
    expect(config).toHaveProperty('normalized_linear');
    expect(config).toHaveProperty('display');
    expect(config).toHaveProperty('core_memory_uris');
  });

  it('recency config uses numeric defaults when settings are missing', async () => {
    vi.mocked(mockGetSettings).mockImplementation(
      makeSettingsMock({
        'recall.recency.enabled': false,
        'recall.recency.half_life_days': undefined,
        'recall.recency.max_bonus': undefined,
        'recall.recency.priority_exempt': undefined,
      }) as ReturnType<typeof vi.fn>,
    );
    const config = await getRecallRuntimeConfig(null);
    expect(config.recency.half_life_days).toBe(180);
    expect(config.recency.max_bonus).toBe(0.04);
    expect(config.recency.priority_exempt).toBe(1);
  });

  it('core_memory_uris is sorted and matches the fixed boot manifest', async () => {
    const config = await getRecallRuntimeConfig(null);
    const expected = [...getBootUris()].sort();
    expect(Array.isArray(config.core_memory_uris)).toBe(true);
    expect(config.core_memory_uris).toEqual(expected);
  });
});

// ─── loadDisplayConfig (via getRecallRuntimeConfig) ──────────────────────

describe('loadDisplayConfig (via getRecallRuntimeConfig)', () => {
  beforeEach(() => {
    vi.mocked(mockGetSettings).mockImplementation(makeSettingsMock() as ReturnType<typeof vi.fn>);
    vi.mocked(mockResolveEmbeddingConfig).mockResolvedValue({ model: 'test', base_url: 'http://test', api_key: 'k' });
    vi.mocked(mockGetEmbeddingRuntimeConfig).mockResolvedValue({ model: 'test', base_url: 'http://test' });
    vi.mocked(getMemoryViewRuntimeConfig).mockResolvedValue({ fts_config: 'simple', view_types: ['gist', 'question'] });
  });

  it('display config is present in runtime config', async () => {
    const config = await getRecallRuntimeConfig(null);
    expect(config.display).toBeDefined();
    expect(config.display).toHaveProperty('min_display_score');
    expect(config.display).toHaveProperty('max_display_items');
    expect(config.display).toHaveProperty('read_node_display_mode');
  });

  it('display values come from settings mock', async () => {
    vi.mocked(mockGetSettings).mockImplementation(
      makeSettingsMock({
        'recall.display.min_display_score': 0.25,
        'recall.display.max_display_items': 12,
        'recall.display.read_node_display_mode': 'hard',
      }) as ReturnType<typeof vi.fn>,
    );
    const config = await getRecallRuntimeConfig(null);
    expect(config.display.min_display_score).toBe(0.25);
    expect(config.display.max_display_items).toBe(12);
    expect(config.display.read_node_display_mode).toBe('hard');
  });
});
