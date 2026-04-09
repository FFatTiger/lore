/**
 * Pluggable recall scoring strategies.
 *
 * Each strategy takes a pre-collected candidate map (via `collectCandidates`)
 * plus a config object, and returns a sorted array of scored candidates with
 * the same output shape, so downstream code (events logging, filtering,
 * display) doesn't need to know which strategy ran.
 *
 * Strategies:
 *   - normalized_linear: legacy A-Current — per-path min-max normalization.
 *       Inflates top scores on long queries (every top-1 becomes 1.0).
 *   - raw_score: use raw path scores x weight (no normalization). Preserves
 *       the absolute quality signal. Good calibration.
 *   - raw_plus_lex_damp: raw_score + lexical contribution divided by
 *       log2(2+query_tokens) to counter OR-mode ts_rank_cd inflation.
 *       DEFAULT — best calibration in benchmark without breaking ranking.
 *   - rrf: reciprocal rank fusion — 1/(k+rank) per path. Scores compressed
 *       to 0.05-0.25 range. Strong ranking, needs threshold re-tuning.
 *   - dense_floor: normalized_linear but drop dense/gs signals below floor
 *       before normalizing. Best topical-vs-noise discrimination on
 *       moderate-length queries but has threshold cliffs.
 *   - weighted_rrf: RRF with per-path weights as multipliers on rank
 *       contribution.
 *   - max_signal: take strongest single signal + bonus per extra path.
 *   - cascade: tiered scoring — exact > gs > dense > fallback.
 */

import type { ScoringCandidate, ScoredResult, ScoringConfig } from './recallScoring';

// ─── Constants ──────────────────────────────────────────────────────

export const STRATEGIES = [
  'raw_plus_lex_damp',
  'raw_score',
  'normalized_linear',
  'weighted_rrf',
  'rrf',
  'max_signal',
  'cascade',
  'dense_floor',
] as const;

export type StrategyName = (typeof STRATEGIES)[number];

export const DEFAULT_STRATEGY: StrategyName = 'raw_plus_lex_damp';

// Short labels shown in UI dropdowns. Format: "<中文名> · <特点> · <推荐场景/警告>"
export const STRATEGY_LABELS: Record<StrategyName, string> = {
  raw_plus_lex_damp: '原始分+lex长压 · 推荐 · 抗长query',
  raw_score: '原始分相加 · 最诚实 · 质量=分数',
  normalized_linear: '排名归一化 · 旧默认 · 长query虚高',
  weighted_rrf: '加权rank融合 · 用路径权重 · 0-0.3分',
  rrf: 'rank融合 · 0-0.2分 · 只看排名',
  max_signal: '取最强信号 · 多路径加分 · 宽容',
  cascade: '信号分级 · exact>gs>dense · 可超1.0',
  dense_floor: '语义阈值 · 余弦低砍掉 · 激进',
};

// ─── Shared helpers ─────────────────────────────────────────────────

function computeRecencyBonus(item: ScoringCandidate, config: ScoringConfig): number {
  if (!config.recency_enabled) return 0;
  if (!item.updated_at) return 0;
  const maxBonus = config.recency_max_bonus || 0;
  if (!maxBonus) return 0;
  // High-priority memories are exempt from decay — always get full bonus
  if (item.priority <= (config.recency_priority_exempt ?? 1)) return maxBonus;
  const ageDays = Math.max(0, (Date.now() - item.updated_at.getTime()) / 86_400_000);
  const halfLife = config.recency_half_life_days || 180;
  return maxBonus * Math.pow(2, -ageDays / halfLife);
}

function getRecencyInfo(item: ScoringCandidate, recencyBonus: number) {
  if (!item.updated_at) return null;
  const ageDays = Math.max(0, (Date.now() - item.updated_at.getTime()) / 86_400_000);
  return { recency_bonus: round(recencyBonus), memory_age_days: round(ageDays) };
}

function round(n: number): number { return Number(n.toFixed(6)); }

function sortResults(items: ScoredResult[]): ScoredResult[] {
  return items.sort((a, b) => b.score - a.score || a.priority - b.priority || a.uri.localeCompare(b.uri));
}

function assignRanks(candidates: ScoringCandidate[]): void {
  const sorted = (field: keyof ScoringCandidate) =>
    [...candidates].filter((i) => (i[field] as number) > 0).sort((a, b) => (b[field] as number) - (a[field] as number));
  for (const item of candidates) {
    item.exact_rank = Infinity;
    item.glossary_semantic_rank = Infinity;
    item.dense_rank = Infinity;
    item.lexical_rank = Infinity;
  }
  sorted('exact_score').forEach((it, i) => { it.exact_rank = i + 1; });
  sorted('glossary_semantic_score').forEach((it, i) => { it.glossary_semantic_rank = i + 1; });
  sorted('dense_score').forEach((it, i) => { it.dense_rank = i + 1; });
  sorted('lexical_score').forEach((it, i) => { it.lexical_rank = i + 1; });
}

import { dedupeTerms } from '../core/utils';

function formatResult(
  item: ScoringCandidate,
  score: number,
  breakdown: Record<string, number | string>,
  recencyBonus = 0,
): ScoredResult {
  const recencyInfo = getRecencyInfo(item, recencyBonus);
  return {
    uri: item.uri,
    score: Number(score.toFixed(6)),
    exact_score: Number(item.exact_score.toFixed(6)),
    glossary_semantic_score: Number(item.glossary_semantic_score.toFixed(6)),
    dense_score: Number(item.dense_score.toFixed(6)),
    lexical_score: Number(item.lexical_score.toFixed(6)),
    score_breakdown: {
      ...breakdown,
      ...(recencyBonus ? { recency: round(recencyBonus) } : {}),
    },
    cues: dedupeTerms([...item.cues], 3),
    matched_on: [...item.matched_on].sort(),
    priority: item.priority,
    ...(recencyInfo ? { memory_age_days: recencyInfo.memory_age_days, recency_bonus: recencyInfo.recency_bonus } : {}),
  };
}

// ─── Strategy: normalized_linear (legacy) ────────────────────────────

export function scoreNormalizedLinear(byUri: Map<string, ScoringCandidate>, config: ScoringConfig): ScoredResult[] {
  const {
    w_exact, w_glossary_semantic, w_dense, w_lexical,
    priority_base, priority_step, multi_view_step, multi_view_cap,
  } = config;
  const candidates = [...byUri.values()];
  const maxOf = (field: keyof ScoringCandidate) => {
    let m = 0;
    for (const c of candidates) if ((c[field] as number) > m) m = c[field] as number;
    return m || 1;
  };
  const maxExact = maxOf('exact_score');
  const maxGS = maxOf('glossary_semantic_score');
  const maxDense = maxOf('dense_score');
  const maxLexical = maxOf('lexical_score');

  return sortResults(candidates.map((item) => {
    const normExact = item.exact_score / maxExact;
    const normGS = item.glossary_semantic_score / maxGS;
    const normDense = item.dense_score / maxDense;
    const normLexical = item.lexical_score / maxLexical;
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * priority_step);
    const recencyBonus = computeRecencyBonus(item, config);
    const score = normExact * w_exact + normGS * w_glossary_semantic
      + normDense * w_dense + normLexical * w_lexical
      + item.view_bonus + priorityBonus + multiViewBonus + recencyBonus;
    return formatResult(item, score, {
      exact: round(normExact * w_exact),
      glossary_semantic: round(normGS * w_glossary_semantic),
      semantic: round(normDense * w_dense),
      lexical: round(normLexical * w_lexical),
      view: round(item.view_bonus),
      priority: round(priorityBonus),
      multi_view: round(multiViewBonus),
    }, recencyBonus);
  }));
}

// ─── Strategy: raw_score (G) ─────────────────────────────────────────

export function scoreRawScore(byUri: Map<string, ScoringCandidate>, config: ScoringConfig): ScoredResult[] {
  const {
    w_exact, w_glossary_semantic, w_dense, w_lexical,
    priority_base, priority_step, multi_view_step, multi_view_cap,
  } = config;
  return sortResults([...byUri.values()].map((item) => {
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * priority_step);
    const recencyBonus = computeRecencyBonus(item, config);
    const score = item.exact_score * w_exact
      + item.glossary_semantic_score * w_glossary_semantic
      + item.dense_score * w_dense
      + item.lexical_score * w_lexical
      + item.view_bonus + priorityBonus + multiViewBonus + recencyBonus;
    return formatResult(item, score, {
      exact: round(item.exact_score * w_exact),
      glossary_semantic: round(item.glossary_semantic_score * w_glossary_semantic),
      semantic: round(item.dense_score * w_dense),
      lexical: round(item.lexical_score * w_lexical),
      view: round(item.view_bonus),
      priority: round(priorityBonus),
      multi_view: round(multiViewBonus),
    }, recencyBonus);
  }));
}

// ─── Strategy: raw_plus_lex_damp (I — DEFAULT) ───────────────────────

export function scoreRawPlusLexDamp(byUri: Map<string, ScoringCandidate>, config: ScoringConfig): ScoredResult[] {
  const {
    w_exact, w_glossary_semantic, w_dense, w_lexical,
    priority_base, priority_step, multi_view_step, multi_view_cap,
    query_tokens = 5,
  } = config;
  // Log-based damping counters OR-mode ts_rank_cd length inflation:
  //   5 tok -> 0.55, 20 -> 0.31, 100 -> 0.15, 200 -> 0.13, 500 -> 0.11
  const lengthDamp = 1 / Math.log2(2 + Math.max(1, query_tokens));

  return sortResults([...byUri.values()].map((item) => {
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * priority_step);
    const lexContribution = item.lexical_score * lengthDamp * w_lexical;
    const recencyBonus = computeRecencyBonus(item, config);
    const score = item.exact_score * w_exact
      + item.glossary_semantic_score * w_glossary_semantic
      + item.dense_score * w_dense
      + lexContribution
      + item.view_bonus + priorityBonus + multiViewBonus + recencyBonus;
    return formatResult(item, score, {
      exact: round(item.exact_score * w_exact),
      glossary_semantic: round(item.glossary_semantic_score * w_glossary_semantic),
      semantic: round(item.dense_score * w_dense),
      lexical: round(lexContribution),
      lexical_damp: round(lengthDamp),
      view: round(item.view_bonus),
      priority: round(priorityBonus),
      multi_view: round(multiViewBonus),
    }, recencyBonus);
  }));
}

// ─── Strategy: rrf (Reciprocal Rank Fusion) ──────────────────────────

export function scoreRrf(byUri: Map<string, ScoringCandidate>, config: ScoringConfig): ScoredResult[] {
  const { rrf_k = 20, priority_base, priority_step } = config;
  const candidates = [...byUri.values()];
  assignRanks(candidates);

  return sortResults(candidates.map((item) => {
    let s = 0;
    const parts: Record<string, number> = {};
    if (item.exact_rank! < Infinity) { const c = 1 / (rrf_k + item.exact_rank!); s += c; parts.exact = round(c); } else parts.exact = 0;
    if (item.glossary_semantic_rank! < Infinity) { const c = 1 / (rrf_k + item.glossary_semantic_rank!); s += c; parts.glossary_semantic = round(c); } else parts.glossary_semantic = 0;
    if (item.dense_rank! < Infinity) { const c = 1 / (rrf_k + item.dense_rank!); s += c; parts.semantic = round(c); } else parts.semantic = 0;
    if (item.lexical_rank! < Infinity) { const c = 1 / (rrf_k + item.lexical_rank!); s += c; parts.lexical = round(c); } else parts.lexical = 0;
    const priorityBonus = Math.max(0, priority_base - item.priority * priority_step);
    const recencyBonus = computeRecencyBonus(item, config);
    s += priorityBonus + recencyBonus;
    parts.priority = round(priorityBonus);
    parts.view = round(item.view_bonus);  // view bonus not counted in RRF rank-based sum
    parts.multi_view = 0;
    return formatResult(item, s, parts, recencyBonus);
  }));
}

// ─── Strategy: dense_floor (J) ───────────────────────────────────────

export function scoreDenseFloor(byUri: Map<string, ScoringCandidate>, config: ScoringConfig): ScoredResult[] {
  const {
    dense_floor, gs_floor,
    w_exact, w_glossary_semantic, w_dense, w_lexical,
    priority_base, priority_step, multi_view_step, multi_view_cap,
  } = config;
  const candidates = [...byUri.values()];
  // Gate: zero out weak dense/gs before normalizing
  const adjusted = candidates.map((c) => ({
    ...c,
    dense_score: c.dense_score < dense_floor! ? 0 : c.dense_score,
    glossary_semantic_score: c.glossary_semantic_score < gs_floor! ? 0 : c.glossary_semantic_score,
  }));
  const maxOf = (field: 'exact_score' | 'glossary_semantic_score' | 'dense_score' | 'lexical_score') => {
    let m = 0;
    for (const c of adjusted) if (c[field] > m) m = c[field];
    return m || 1;
  };
  const maxExact = maxOf('exact_score');
  const maxGS = maxOf('glossary_semantic_score');
  const maxDense = maxOf('dense_score');
  const maxLexical = maxOf('lexical_score');

  return sortResults(adjusted.map((item) => {
    const normExact = item.exact_score / maxExact;
    const normGS = item.glossary_semantic_score > 0 ? item.glossary_semantic_score / maxGS : 0;
    const normDense = item.dense_score > 0 ? item.dense_score / maxDense : 0;
    const normLexical = item.lexical_score / maxLexical;
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * priority_step);
    const recencyBonus = computeRecencyBonus(item, config);
    const score = normExact * w_exact + normGS * w_glossary_semantic
      + normDense * w_dense + normLexical * w_lexical
      + item.view_bonus + priorityBonus + multiViewBonus + recencyBonus;
    return formatResult(item, score, {
      exact: round(normExact * w_exact),
      glossary_semantic: round(normGS * w_glossary_semantic),
      semantic: round(normDense * w_dense),
      lexical: round(normLexical * w_lexical),
      view: round(item.view_bonus),
      priority: round(priorityBonus),
      multi_view: round(multiViewBonus),
      dense_floored: item.dense_score === 0 && candidates.find((c) => c.uri === item.uri)?.dense_score! > 0 ? 1 : 0,
    }, recencyBonus);
  }));
}

// ─── Strategy: weighted_rrf (D) ──────────────────────────────────────

export function scoreWeightedRrf(byUri: Map<string, ScoringCandidate>, config: ScoringConfig): ScoredResult[] {
  const {
    rrf_k = 20,
    w_exact, w_glossary_semantic, w_dense, w_lexical,
    priority_base, priority_step,
  } = config;
  const candidates = [...byUri.values()];
  assignRanks(candidates);

  return sortResults(candidates.map((item) => {
    let s = 0;
    const parts: Record<string, number> = {};
    if (item.exact_rank! < Infinity) { const c = w_exact / (rrf_k + item.exact_rank!); s += c; parts.exact = round(c); } else parts.exact = 0;
    if (item.glossary_semantic_rank! < Infinity) { const c = w_glossary_semantic / (rrf_k + item.glossary_semantic_rank!); s += c; parts.glossary_semantic = round(c); } else parts.glossary_semantic = 0;
    if (item.dense_rank! < Infinity) { const c = w_dense / (rrf_k + item.dense_rank!); s += c; parts.semantic = round(c); } else parts.semantic = 0;
    if (item.lexical_rank! < Infinity) { const c = w_lexical / (rrf_k + item.lexical_rank!); s += c; parts.lexical = round(c); } else parts.lexical = 0;
    const priorityBonus = Math.max(0, priority_base - item.priority * priority_step);
    const recencyBonus = computeRecencyBonus(item, config);
    s += priorityBonus + recencyBonus;
    parts.priority = round(priorityBonus);
    parts.view = round(item.view_bonus);
    parts.multi_view = 0;
    return formatResult(item, s, parts, recencyBonus);
  }));
}

// ─── Strategy: max_signal (E) ────────────────────────────────────────

export function scoreMaxSignal(byUri: Map<string, ScoringCandidate>, config: ScoringConfig): ScoredResult[] {
  const {
    w_exact, w_glossary_semantic, w_dense, w_lexical,
    priority_base, priority_step,
    multi_view_step, multi_view_cap,
  } = config;
  const path_bonus = Number((config as Record<string, unknown>).path_bonus ?? 0.05);
  return sortResults([...byUri.values()].map((item) => {
    const signals: { val: number; path: string }[] = [];
    if (item.exact_score > 0) signals.push({ val: item.exact_score * w_exact, path: 'exact' });
    if (item.glossary_semantic_score > 0) signals.push({ val: item.glossary_semantic_score * w_glossary_semantic, path: 'glossary_semantic' });
    if (item.dense_score > 0) signals.push({ val: item.dense_score * w_dense, path: 'semantic' });
    if (item.lexical_score > 0) signals.push({ val: item.lexical_score * w_lexical, path: 'lexical' });
    const maxSig = signals.length ? Math.max(...signals.map((s) => s.val)) : 0;
    const pathCount = signals.length;
    const pathBonus = Math.max(0, pathCount - 1) * path_bonus;
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * priority_step);
    const recencyBonus = computeRecencyBonus(item, config);
    const score = maxSig + pathBonus + item.view_bonus + priorityBonus + multiViewBonus + recencyBonus;
    const parts: Record<string, number> = { exact: 0, glossary_semantic: 0, semantic: 0, lexical: 0 };
    for (const s of signals) parts[s.path] = round(s.val);
    parts.path_count_bonus = round(pathBonus);
    parts.view = round(item.view_bonus);
    parts.priority = round(priorityBonus);
    parts.multi_view = round(multiViewBonus);
    return formatResult(item, score, parts, recencyBonus);
  }));
}

// ─── Strategy: cascade (F) ───────────────────────────────────────────

export function scoreCascade(byUri: Map<string, ScoringCandidate>, config: ScoringConfig): ScoredResult[] {
  const {
    priority_base, priority_step,
    multi_view_step, multi_view_cap,
  } = config;
  const configAny = config as Record<string, unknown>;
  const exact_threshold = Number(configAny.exact_threshold ?? 0.70);
  const gs_threshold = Number(configAny.gs_threshold ?? 0.60);
  const semantic_threshold = Number(configAny.semantic_threshold ?? 0.55);
  const exact_base = Number(configAny.exact_base ?? 0.80);
  const gs_base = Number(configAny.gs_base ?? 0.65);
  const semantic_base = Number(configAny.semantic_base ?? 0.50);
  const secondary_bonus = Number(configAny.secondary_bonus ?? 0.08);

  return sortResults([...byUri.values()].map((item) => {
    let score: number;
    let tier: string;
    let secondaryCount = 0;
    if (item.exact_score >= exact_threshold) secondaryCount++;
    if (item.glossary_semantic_score >= gs_threshold) secondaryCount++;
    if (item.dense_score >= semantic_threshold) secondaryCount++;
    if (item.lexical_score > 0) secondaryCount++;
    const bonus = Math.max(0, secondaryCount - 1) * secondary_bonus;

    if (item.exact_score >= exact_threshold) {
      score = exact_base + item.exact_score * 0.2 + bonus;
      tier = 'exact';
    } else if (item.glossary_semantic_score >= gs_threshold) {
      score = gs_base + item.glossary_semantic_score * 0.2 + bonus;
      tier = 'gs';
    } else if (item.dense_score >= semantic_threshold) {
      score = semantic_base + item.dense_score * 0.3 + bonus;
      tier = 'dense';
    } else {
      // Fallback: weighted sum of whatever we have
      score = 0.20 * (item.lexical_score > 0 ? 1 : 0)
        + item.dense_score * 0.5
        + item.glossary_semantic_score * 0.3
        + item.exact_score * 0.2;
      tier = 'fallback';
    }
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * priority_step);
    const recencyBonus = computeRecencyBonus(item, config);
    score += item.view_bonus + priorityBonus + multiViewBonus + recencyBonus;
    return formatResult(item, score, {
      exact: round(item.exact_score), glossary_semantic: round(item.glossary_semantic_score),
      semantic: round(item.dense_score), lexical: round(item.lexical_score),
      tier, secondary_count: secondaryCount, secondary_bonus: round(bonus),
      view: round(item.view_bonus), priority: round(priorityBonus), multi_view: round(multiViewBonus),
    }, recencyBonus);
  }));
}

// ─── Exports for testing ────────────────────────────────────────────

export { computeRecencyBonus, getRecencyInfo, round, sortResults, assignRanks, formatResult };
