/**
 * Recall scoring — candidate collection, formatting, and strategy routing.
 *
 * This module collects candidates from the four retrieval paths (exact,
 * glossary-semantic, dense, lexical), merges them by URI, and dispatches
 * to the appropriate scoring strategy from ./scoringStrategies.
 */

import { buildCandidateKey, extractCueTerms, getViewPrior } from '../view/memoryViewQueries';
import {
  scoreNormalizedLinear,
  scoreRawScore,
  scoreRawPlusLexDamp,
  scoreRrf,
  scoreDenseFloor,
  scoreWeightedRrf,
  scoreMaxSignal,
  scoreCascade,
} from './scoringStrategies';

// Re-export constants and types from scoringStrategies so that existing
// import sites (e.g. recall.js) keep working with a single import source.
export {
  STRATEGIES,
  DEFAULT_STRATEGY,
  STRATEGY_LABELS,
  type StrategyName,
} from './scoringStrategies';

// ─── Types ──────────────────────────────────────────────────────────

export interface ScoringCandidate {
  uri: string;
  priority: number;
  disclosure: string;
  exact_score: number;
  glossary_semantic_score: number;
  dense_score: number;
  lexical_score: number;
  view_bonus: number;
  matched_on: Set<string>;
  cues: Set<string>;
  view_types: Set<string>;
  semantic_views: Set<string>;
  lexical_views: Set<string>;
  updated_at: Date | null;
  // Ranks assigned by assignRanks (used by RRF strategies)
  exact_rank?: number;
  glossary_semantic_rank?: number;
  dense_rank?: number;
  lexical_rank?: number;
}

export interface ScoredResult {
  uri: string;
  score: number;
  exact_score: number;
  glossary_semantic_score: number;
  dense_score: number;
  lexical_score: number;
  score_breakdown: Record<string, number | string>;
  cues: string[];
  matched_on: string[];
  priority: number;
  memory_age_days?: number;
  recency_bonus?: number;
}

export interface ScoringConfig {
  strategy?: string;
  w_exact: number;
  w_glossary_semantic: number;
  w_dense: number;
  w_lexical: number;
  priority_base: number;
  priority_step: number;
  multi_view_step: number;
  multi_view_cap: number;
  rrf_k?: number;
  dense_floor?: number;
  gs_floor?: number;
  query_tokens?: number;
  recency_enabled?: boolean;
  recency_half_life_days?: number;
  recency_max_bonus?: number;
  recency_priority_exempt?: number;
  view_priors?: Record<string, number> | null;
  [key: string]: unknown;
}

export interface CandidateRows {
  exactRows: Record<string, unknown>[];
  glossarySemanticRows: Record<string, unknown>[];
  denseRows: Record<string, unknown>[];
  lexicalRows: Record<string, unknown>[];
}

// ─── Candidate collection ───────────────────────────────────────────

export function collectCandidates(
  { exactRows, glossarySemanticRows, denseRows, lexicalRows }: CandidateRows,
  { viewPriors = null }: { viewPriors?: Record<string, number> | null } = {},
): Map<string, ScoringCandidate> {
  const byUri = new Map<string, ScoringCandidate>();
  const viewPriorOf = (vt: string): number => {
    if (viewPriors) return Number(viewPriors[vt] || 0);
    return getViewPrior(vt);
  };

  function getOrCreate(row: Record<string, unknown>): ScoringCandidate | null {
    const key = buildCandidateKey(row);
    if (!key) return null;
    const existing = byUri.get(key);
    if (existing) return existing;
    const created: ScoringCandidate = {
      uri: row.uri as string,
      priority: Number(row.priority || 0),
      disclosure: (row.disclosure as string) || '',
      exact_score: 0,
      glossary_semantic_score: 0,
      dense_score: 0,
      lexical_score: 0,
      view_bonus: 0,
      matched_on: new Set(),
      cues: new Set(),
      view_types: new Set(),
      semantic_views: new Set(),
      lexical_views: new Set(),
      updated_at: null,
    };
    byUri.set(key, created);
    return created;
  }

  function mergeTimestamp(item: ScoringCandidate, row: Record<string, unknown>): void {
    if (row.updated_at) {
      const ts = new Date(row.updated_at as string);
      if (!item.updated_at || ts > item.updated_at) item.updated_at = ts;
    }
  }

  for (const row of exactRows) {
    const item = getOrCreate(row);
    if (!item) continue;
    const s = Number(row.exact_score || 0) * Number(row.weight || 1);
    item.exact_score = Math.max(item.exact_score, s);
    item.matched_on.add('exact');
    if (row.glossary_exact_hit) item.matched_on.add('glossary');
    if (row.glossary_text_hit) item.matched_on.add('glossary_text');
    if (row.query_contains_glossary_hit) item.matched_on.add('query_contains_glossary');
    if (row.glossary_fts_hit) item.matched_on.add('glossary_fts');
    if (row.path_exact_hit) item.matched_on.add('path');
    for (const cue of extractCueTerms(row)) item.cues.add(cue);
    mergeTimestamp(item, row);
  }
  for (const row of glossarySemanticRows) {
    const item = getOrCreate(row);
    if (!item) continue;
    item.glossary_semantic_score = Math.max(item.glossary_semantic_score, Number(row.glossary_semantic_score || 0));
    item.matched_on.add('glossary_semantic');
    if (row.keyword) item.cues.add(row.keyword as string);
    mergeTimestamp(item, row);
  }
  for (const row of denseRows) {
    const item = getOrCreate(row);
    if (!item) continue;
    const s = Number(row.semantic_score || 0) * Number(row.weight || 1);
    item.dense_score = Math.max(item.dense_score, s);
    item.view_bonus = Math.max(item.view_bonus, viewPriorOf(row.view_type as string));
    item.matched_on.add('dense');
    item.view_types.add(row.view_type as string);
    item.semantic_views.add(row.view_type as string);
    for (const cue of extractCueTerms(row)) item.cues.add(cue);
    mergeTimestamp(item, row);
  }
  for (const row of lexicalRows) {
    const item = getOrCreate(row);
    if (!item) continue;
    const s = Number(row.lexical_score || 0) * Number(row.weight || 1);
    item.lexical_score = Math.max(item.lexical_score, s);
    item.view_bonus = Math.max(item.view_bonus, viewPriorOf(row.view_type as string));
    item.matched_on.add('lexical');
    item.view_types.add(row.view_type as string);
    item.lexical_views.add(row.view_type as string);
    if (row.fts_hit) item.matched_on.add('fts');
    if (row.text_hit) item.matched_on.add('text');
    if (row.uri_hit) item.matched_on.add('uri');
    for (const cue of extractCueTerms(row)) item.cues.add(cue);
    mergeTimestamp(item, row);
  }

  return byUri;
}

// ─── Router ──────────────────────────────────────────────────────────

export function runStrategy(
  strategyName: string,
  byUri: Map<string, ScoringCandidate>,
  config: ScoringConfig,
): ScoredResult[] {
  switch (strategyName) {
    case 'normalized_linear': return scoreNormalizedLinear(byUri, config);
    case 'raw_score': return scoreRawScore(byUri, config);
    case 'raw_plus_lex_damp': return scoreRawPlusLexDamp(byUri, config);
    case 'rrf': return scoreRrf(byUri, config);
    case 'weighted_rrf': return scoreWeightedRrf(byUri, config);
    case 'max_signal': return scoreMaxSignal(byUri, config);
    case 'cascade': return scoreCascade(byUri, config);
    case 'dense_floor': return scoreDenseFloor(byUri, config);
    default:
      throw new Error(`Unknown scoring strategy: ${strategyName}`);
  }
}
