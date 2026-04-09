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
  STRATEGIES,
  DEFAULT_STRATEGY,
  STRATEGY_LABELS,
  scoreNormalizedLinear,
  scoreRawScore,
  scoreRawPlusLexDamp,
  scoreRrf,
  scoreDenseFloor,
  scoreWeightedRrf,
  scoreMaxSignal,
  scoreCascade,
  computeRecencyBonus,
  getRecencyInfo,
  round,
  sortResults,
  assignRanks,
  formatResult,
  type StrategyName,
} from '../scoringStrategies';

// ─── Test helpers ───────────────────────────────────────────────────

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    uri: overrides.uri as string || 'test://a',
    priority: (overrides.priority as number) ?? 1,
    disclosure: '',
    exact_score: (overrides.exact_score as number) ?? 0,
    glossary_semantic_score: (overrides.glossary_semantic_score as number) ?? 0,
    dense_score: (overrides.dense_score as number) ?? 0,
    lexical_score: (overrides.lexical_score as number) ?? 0,
    view_bonus: (overrides.view_bonus as number) ?? 0,
    matched_on: (overrides.matched_on as Set<string>) ?? new Set<string>(),
    cues: (overrides.cues as Set<string>) ?? new Set<string>(),
    view_types: (overrides.view_types as Set<string>) ?? new Set<string>(),
    semantic_views: new Set<string>(),
    lexical_views: new Set<string>(),
    updated_at: (overrides.updated_at as Date) ?? null,
  };
}

function makeCandidateMap(...candidates: ReturnType<typeof makeCandidate>[]) {
  const map = new Map();
  for (const c of candidates) map.set(c.uri, c);
  return map;
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

// ─── Constants tests ────────────────────────────────────────────────

describe('Constants', () => {
  it('STRATEGIES has 8 entries', () => {
    expect(STRATEGIES).toHaveLength(8);
  });

  it('DEFAULT_STRATEGY is raw_plus_lex_damp', () => {
    expect(DEFAULT_STRATEGY).toBe('raw_plus_lex_damp');
  });

  it('STRATEGY_LABELS has one label per strategy', () => {
    for (const s of STRATEGIES) {
      expect(STRATEGY_LABELS[s]).toBeDefined();
      expect(typeof STRATEGY_LABELS[s]).toBe('string');
    }
  });

  it('STRATEGIES includes all expected names', () => {
    const expected = [
      'raw_plus_lex_damp', 'raw_score', 'normalized_linear',
      'weighted_rrf', 'rrf', 'max_signal', 'cascade', 'dense_floor',
    ];
    for (const name of expected) {
      expect(STRATEGIES).toContain(name);
    }
  });
});

// ─── Shared helper tests ────────────────────────────────────────────

describe('round', () => {
  it('rounds to 6 decimal places', () => {
    expect(round(1.23456789)).toBe(1.234568);
    expect(round(0)).toBe(0);
    expect(round(1)).toBe(1);
  });
});

describe('sortResults', () => {
  it('sorts by score descending', () => {
    const items = [
      { uri: 'a', score: 0.5, priority: 1 },
      { uri: 'b', score: 0.8, priority: 1 },
      { uri: 'c', score: 0.3, priority: 1 },
    ] as any[];
    const sorted = sortResults(items);
    expect(sorted.map((i: any) => i.uri)).toEqual(['b', 'a', 'c']);
  });

  it('breaks ties by priority ascending', () => {
    const items = [
      { uri: 'a', score: 0.5, priority: 2 },
      { uri: 'b', score: 0.5, priority: 1 },
    ] as any[];
    const sorted = sortResults(items);
    expect(sorted[0].uri).toBe('b');
  });

  it('breaks double ties by uri alphabetically', () => {
    const items = [
      { uri: 'b', score: 0.5, priority: 1 },
      { uri: 'a', score: 0.5, priority: 1 },
    ] as any[];
    const sorted = sortResults(items);
    expect(sorted[0].uri).toBe('a');
  });
});

describe('assignRanks', () => {
  it('assigns per-path ranks', () => {
    const candidates = [
      makeCandidate({ uri: 'a', exact_score: 0.9, dense_score: 0.5 }),
      makeCandidate({ uri: 'b', exact_score: 0.7, dense_score: 0.8 }),
    ];
    assignRanks(candidates);
    expect(candidates[0].exact_rank).toBe(1);
    expect(candidates[1].exact_rank).toBe(2);
    expect(candidates[0].dense_rank).toBe(2);
    expect(candidates[1].dense_rank).toBe(1);
  });

  it('sets Infinity for zero-score paths', () => {
    const candidates = [
      makeCandidate({ uri: 'a', exact_score: 0.5, dense_score: 0 }),
    ];
    assignRanks(candidates);
    expect(candidates[0].exact_rank).toBe(1);
    expect(candidates[0].dense_rank).toBe(Infinity);
  });
});

describe('computeRecencyBonus', () => {
  it('returns 0 when recency_enabled is false', () => {
    const item = makeCandidate({ updated_at: new Date() });
    const bonus = computeRecencyBonus(item, { ...baseConfig, recency_enabled: false, recency_max_bonus: 0.04 });
    expect(bonus).toBe(0);
  });

  it('returns 0 when updated_at is null', () => {
    const item = makeCandidate({ updated_at: null });
    const bonus = computeRecencyBonus(item, { ...baseConfig, recency_enabled: true, recency_max_bonus: 0.04 });
    expect(bonus).toBe(0);
  });

  it('returns full bonus for high-priority exempt memories', () => {
    const item = makeCandidate({ updated_at: new Date('2020-01-01'), priority: 0 });
    const bonus = computeRecencyBonus(item, {
      ...baseConfig,
      recency_enabled: true,
      recency_max_bonus: 0.04,
      recency_priority_exempt: 1,
    });
    expect(bonus).toBe(0.04);
  });

  it('decays bonus for old low-priority memories', () => {
    const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);
    const item = makeCandidate({ updated_at: oneYearAgo, priority: 3 });
    const bonus = computeRecencyBonus(item, {
      ...baseConfig,
      recency_enabled: true,
      recency_max_bonus: 0.04,
      recency_half_life_days: 180,
      recency_priority_exempt: 1,
    });
    expect(bonus).toBeGreaterThan(0);
    expect(bonus).toBeLessThan(0.04);
  });
});

describe('getRecencyInfo', () => {
  it('returns null when updated_at is null', () => {
    const item = makeCandidate({ updated_at: null });
    expect(getRecencyInfo(item, 0)).toBeNull();
  });

  it('returns info with bonus and age', () => {
    const item = makeCandidate({ updated_at: new Date() });
    const info = getRecencyInfo(item, 0.03);
    expect(info).not.toBeNull();
    expect(info!.recency_bonus).toBe(0.03);
    expect(info!.memory_age_days).toBeGreaterThanOrEqual(0);
  });
});

describe('formatResult', () => {
  it('returns correct structure', () => {
    const item = makeCandidate({ uri: 'test://x', exact_score: 0.5, priority: 1 });
    item.matched_on.add('exact');
    item.cues.add('hello');
    const result = formatResult(item, 0.75, { exact: 0.5 }, 0);
    expect(result.uri).toBe('test://x');
    expect(result.score).toBe(0.75);
    expect(result.matched_on).toContain('exact');
    expect(result.cues).toContain('hello');
    expect(result.priority).toBe(1);
    expect(result.score_breakdown.exact).toBe(0.5);
  });

  it('includes recency in breakdown when bonus > 0', () => {
    const item = makeCandidate({ updated_at: new Date() });
    const result = formatResult(item, 0.5, {}, 0.03);
    expect(result.score_breakdown.recency).toBe(0.03);
    expect(result.recency_bonus).toBeDefined();
  });

  it('excludes recency from breakdown when bonus is 0', () => {
    const item = makeCandidate({});
    const result = formatResult(item, 0.5, {}, 0);
    expect(result.score_breakdown.recency).toBeUndefined();
  });
});

// ─── Strategy: scoreNormalizedLinear ─────────────────────────────────

describe('scoreNormalizedLinear', () => {
  it('normalizes scores per-path then sums', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 1.0, dense_score: 0.5 }),
      makeCandidate({ uri: 'b', exact_score: 0.5, dense_score: 1.0 }),
    );
    const results = scoreNormalizedLinear(byUri, baseConfig);
    expect(results).toHaveLength(2);
    expect(results[0].uri).toBeDefined();
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('top-1 exact gets normalized to 1.0 in exact component', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.8 }),
      makeCandidate({ uri: 'b', exact_score: 0.4 }),
    );
    const results = scoreNormalizedLinear(byUri, baseConfig);
    // The item with 0.8 becomes norm=1.0 -> contribution = 0.30
    const top = results.find(r => r.uri === 'a')!;
    expect(top.score_breakdown.exact).toBeCloseTo(0.30, 4);
  });

  it('returns results sorted by score descending', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.3 }),
      makeCandidate({ uri: 'b', exact_score: 0.9 }),
    );
    const results = scoreNormalizedLinear(byUri, baseConfig);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('handles empty map', () => {
    const results = scoreNormalizedLinear(new Map(), baseConfig);
    expect(results).toEqual([]);
  });
});

// ─── Strategy: scoreRawScore ────────────────────────────────────────

describe('scoreRawScore', () => {
  it('uses raw scores without normalization', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.8, dense_score: 0.6 }),
    );
    const results = scoreRawScore(byUri, baseConfig);
    expect(results).toHaveLength(1);
    // exact: 0.8 * 0.30 = 0.24, dense: 0.6 * 0.30 = 0.18
    const r = results[0];
    expect(r.score_breakdown.exact).toBeCloseTo(0.24, 4);
    expect(r.score_breakdown.semantic).toBeCloseTo(0.18, 4);
  });

  it('includes priority and multi-view bonuses', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.5, priority: 0, view_types: new Set(['gist', 'question']) }),
    );
    const results = scoreRawScore(byUri, baseConfig);
    expect(results[0].score_breakdown.priority).toBeGreaterThan(0);
    expect(results[0].score_breakdown.multi_view).toBeGreaterThan(0);
  });

  it('handles zero-score candidates', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a' }),
    );
    const results = scoreRawScore(byUri, baseConfig);
    // Only priority bonus matters
    expect(results[0].score).toBeGreaterThanOrEqual(0);
  });
});

// ─── Strategy: scoreRawPlusLexDamp ──────────────────────────────────

describe('scoreRawPlusLexDamp', () => {
  it('applies log-based damping to lexical scores', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', lexical_score: 1.0 }),
    );
    const short = scoreRawPlusLexDamp(byUri, { ...baseConfig, query_tokens: 5 });
    const long = scoreRawPlusLexDamp(byUri, { ...baseConfig, query_tokens: 100 });
    // Longer queries should produce lower lexical contribution
    expect(short[0].score_breakdown.lexical).toBeGreaterThan(long[0].score_breakdown.lexical as number);
  });

  it('includes lexical_damp in breakdown', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', lexical_score: 0.5 }),
    );
    const results = scoreRawPlusLexDamp(byUri, { ...baseConfig, query_tokens: 5 });
    expect(results[0].score_breakdown.lexical_damp).toBeDefined();
    expect(results[0].score_breakdown.lexical_damp).toBeGreaterThan(0);
  });

  it('defaults to query_tokens=5 when not specified', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', lexical_score: 0.5 }),
    );
    const config = { ...baseConfig };
    delete (config as any).query_tokens;
    const results = scoreRawPlusLexDamp(byUri, config);
    const expectedDamp = 1 / Math.log2(2 + 5);
    expect(results[0].score_breakdown.lexical_damp).toBeCloseTo(expectedDamp, 4);
  });
});

// ─── Strategy: scoreRrf ─────────────────────────────────────────────

describe('scoreRrf', () => {
  it('produces scores in expected range', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.9, dense_score: 0.7 }),
      makeCandidate({ uri: 'b', exact_score: 0.3, dense_score: 0.5 }),
    );
    const results = scoreRrf(byUri, baseConfig);
    // RRF scores are typically in 0-0.25 range
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThan(1);
    }
  });

  it('ranks multi-path candidates higher', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'multi', exact_score: 0.8, dense_score: 0.7, lexical_score: 0.5 }),
      makeCandidate({ uri: 'single', exact_score: 0.9 }),
    );
    const results = scoreRrf(byUri, baseConfig);
    const multi = results.find(r => r.uri === 'multi')!;
    const single = results.find(r => r.uri === 'single')!;
    expect(multi.score).toBeGreaterThan(single.score);
  });

  it('uses rrf_k from config', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.9 }),
    );
    const k20 = scoreRrf(byUri, { ...baseConfig, rrf_k: 20 });
    const k60 = scoreRrf(byUri, { ...baseConfig, rrf_k: 60 });
    // Smaller k -> higher scores
    expect(k20[0].score).toBeGreaterThan(k60[0].score);
  });

  it('handles empty map', () => {
    const results = scoreRrf(new Map(), baseConfig);
    expect(results).toEqual([]);
  });
});

// ─── Strategy: scoreDenseFloor ──────────────────────────────────────

describe('scoreDenseFloor', () => {
  it('zeros out dense scores below floor', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', dense_score: 0.30 }),  // below 0.40 floor
      makeCandidate({ uri: 'b', dense_score: 0.60 }),  // above floor
    );
    const results = scoreDenseFloor(byUri, baseConfig);
    const a = results.find(r => r.uri === 'a')!;
    const b = results.find(r => r.uri === 'b')!;
    expect(a.score_breakdown.semantic).toBe(0);
    expect(b.score_breakdown.semantic).toBeGreaterThan(0);
  });

  it('zeros out gs scores below gs_floor', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', glossary_semantic_score: 0.20 }),  // below 0.30
    );
    const results = scoreDenseFloor(byUri, baseConfig);
    expect(results[0].score_breakdown.glossary_semantic).toBe(0);
  });

  it('marks dense_floored in breakdown when score was zeroed', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', dense_score: 0.35 }),  // below 0.40
    );
    const results = scoreDenseFloor(byUri, baseConfig);
    expect(results[0].score_breakdown.dense_floored).toBe(1);
  });

  it('does not mark dense_floored when score was already 0', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', dense_score: 0 }),
    );
    const results = scoreDenseFloor(byUri, baseConfig);
    expect(results[0].score_breakdown.dense_floored).toBe(0);
  });
});

// ─── Strategy: scoreWeightedRrf ─────────────────────────────────────

describe('scoreWeightedRrf', () => {
  it('applies weight multipliers to RRF contributions', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.9 }),
    );
    const results = scoreWeightedRrf(byUri, baseConfig);
    // exact: w_exact / (rrf_k + 1) = 0.30 / 21
    const expected = 0.30 / 21;
    expect(results[0].score_breakdown.exact).toBeCloseTo(expected, 4);
  });

  it('weights affect relative ranking', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'exact_strong', exact_score: 0.9 }),
      makeCandidate({ uri: 'dense_strong', dense_score: 0.9 }),
    );
    // With equal ranks, the path with higher weight should rank higher
    const highExact = scoreWeightedRrf(byUri, { ...baseConfig, w_exact: 2.0, w_dense: 0.1 });
    expect(highExact[0].uri).toBe('exact_strong');
  });

  it('handles zero-score paths with Infinity rank', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.5 }),
    );
    const results = scoreWeightedRrf(byUri, baseConfig);
    expect(results[0].score_breakdown.semantic).toBe(0);
    expect(results[0].score_breakdown.lexical).toBe(0);
  });
});

// ─── Strategy: scoreMaxSignal ───────────────────────────────────────

describe('scoreMaxSignal', () => {
  it('uses max single signal as base', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.8, dense_score: 0.3, lexical_score: 0.1 }),
    );
    const results = scoreMaxSignal(byUri, baseConfig);
    // Max signal is exact: 0.8 * 0.30 = 0.24
    expect(results[0].score_breakdown.exact).toBeCloseTo(0.24, 4);
  });

  it('adds path count bonus for multiple signals', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.8, dense_score: 0.3, lexical_score: 0.1 }),
    );
    const results = scoreMaxSignal(byUri, { ...baseConfig, path_bonus: 0.05 });
    // 3 paths -> bonus = (3-1) * 0.05 = 0.10
    expect(results[0].score_breakdown.path_count_bonus).toBeCloseTo(0.10, 4);
  });

  it('no path bonus for single signal', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.8 }),
    );
    const results = scoreMaxSignal(byUri, baseConfig);
    expect(results[0].score_breakdown.path_count_bonus).toBe(0);
  });

  it('returns 0 score for no-signal candidate', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a' }),
    );
    const results = scoreMaxSignal(byUri, baseConfig);
    // Only priority bonus
    expect(results[0].score_breakdown.exact).toBe(0);
    expect(results[0].score_breakdown.semantic).toBe(0);
  });
});

// ─── Strategy: scoreCascade ─────────────────────────────────────────

describe('scoreCascade', () => {
  it('uses exact tier for high exact_score', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.85 }),
    );
    const results = scoreCascade(byUri, baseConfig);
    expect(results[0].score_breakdown.tier).toBe('exact');
    // exact_base(0.80) + 0.85*0.2 = 0.97
    expect(results[0].score).toBeGreaterThan(0.9);
  });

  it('uses gs tier when exact is low but gs is high', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.3, glossary_semantic_score: 0.75 }),
    );
    const results = scoreCascade(byUri, { ...baseConfig, gs_threshold: 0.60 });
    expect(results[0].score_breakdown.tier).toBe('gs');
  });

  it('uses dense tier as third choice', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', dense_score: 0.65 }),
    );
    const results = scoreCascade(byUri, { ...baseConfig, semantic_threshold: 0.55 });
    expect(results[0].score_breakdown.tier).toBe('dense');
  });

  it('falls back for no strong signals', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', lexical_score: 0.1 }),
    );
    const results = scoreCascade(byUri, baseConfig);
    expect(results[0].score_breakdown.tier).toBe('fallback');
  });

  it('adds secondary bonus for multiple strong signals', () => {
    const byUri = makeCandidateMap(
      makeCandidate({ uri: 'a', exact_score: 0.85, dense_score: 0.65, lexical_score: 0.1 }),
    );
    const results = scoreCascade(byUri, {
      ...baseConfig,
      exact_threshold: 0.70,
      semantic_threshold: 0.55,
      secondary_bonus: 0.08,
    });
    // 3 secondary signals (exact, dense, lexical) -> bonus = (3-1)*0.08 = 0.16
    expect(results[0].score_breakdown.secondary_bonus).toBeCloseTo(0.16, 4);
    expect(results[0].score_breakdown.secondary_count).toBe(3);
  });

  it('scores can exceed 1.0', () => {
    const byUri = makeCandidateMap(
      makeCandidate({
        uri: 'a',
        exact_score: 0.95,
        glossary_semantic_score: 0.80,
        dense_score: 0.70,
        lexical_score: 0.3,
      }),
    );
    const results = scoreCascade(byUri, {
      ...baseConfig,
      exact_threshold: 0.70,
      gs_threshold: 0.60,
      semantic_threshold: 0.55,
      secondary_bonus: 0.10,
    });
    expect(results[0].score).toBeGreaterThan(1.0);
  });
});
