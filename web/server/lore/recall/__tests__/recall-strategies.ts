/**
 * Alternative recall ranking strategies for benchmark comparison.
 *
 * Each strategy takes the same input as aggregateCandidates:
 *   { exactRows, glossarySemanticRows, denseRows, lexicalRows }
 * Plus a `params` object for configurable weights.
 *
 * Each returns a sorted array of { uri, score, priority, matched_on, ... }
 */

import { buildCandidateKey, extractCueTerms, getViewPrior } from '../../view/memoryViewQueries';
import { dedupeTerms } from '../../core/utils';

// ─── helpers shared across strategies ────────────────────────────────

export function collectCandidates({ exactRows, glossarySemanticRows, denseRows, lexicalRows }) {
  const byUri = new Map();

  function getOrCreate(row) {
    const key = buildCandidateKey(row);
    if (!key) return null;
    if (byUri.has(key)) return byUri.get(key);
    const item = {
      uri: row.uri,
      priority: Number(row.priority || 0),
      disclosure: row.disclosure || '',
      exact_score: 0,
      glossary_semantic_score: 0,
      dense_score: 0,
      lexical_score: 0,
      view_bonus: 0,
      matched_on: new Set(),
      cues: new Set(),
      view_types: new Set(),
      // track per-path ranks
      exact_rank: Infinity,
      glossary_semantic_rank: Infinity,
      dense_rank: Infinity,
      lexical_rank: Infinity,
    };
    byUri.set(key, item);
    return item;
  }

  for (const row of exactRows) {
    const item = getOrCreate(row);
    if (!item) continue;
    const s = Number(row.exact_score || 0) * Number(row.weight || 1);
    item.exact_score = Math.max(item.exact_score, s);
    item.matched_on.add('exact');
    for (const cue of extractCueTerms(row)) item.cues.add(cue);
  }

  for (const row of glossarySemanticRows) {
    const item = getOrCreate(row);
    if (!item) continue;
    const s = Number(row.glossary_semantic_score || 0);
    item.glossary_semantic_score = Math.max(item.glossary_semantic_score, s);
    item.matched_on.add('glossary_semantic');
    if (row.keyword) item.cues.add(row.keyword);
  }

  for (const row of denseRows) {
    const item = getOrCreate(row);
    if (!item) continue;
    const s = Number(row.semantic_score || 0) * Number(row.weight || 1);
    item.dense_score = Math.max(item.dense_score, s);
    item.view_bonus = Math.max(item.view_bonus, getViewPrior(row.view_type));
    item.matched_on.add('dense');
    item.view_types.add(row.view_type);
    for (const cue of extractCueTerms(row)) item.cues.add(cue);
  }

  for (const row of lexicalRows) {
    const item = getOrCreate(row);
    if (!item) continue;
    const s = Number(row.lexical_score || 0) * Number(row.weight || 1);
    item.lexical_score = Math.max(item.lexical_score, s);
    item.view_bonus = Math.max(item.view_bonus, getViewPrior(row.view_type));
    item.matched_on.add('lexical');
    item.view_types.add(row.view_type);
    for (const cue of extractCueTerms(row)) item.cues.add(cue);
  }

  // assign per-path ranks
  const sorted = (field) => [...byUri.values()].filter(i => i[field] > 0).sort((a, b) => b[field] - a[field]);
  sorted('exact_score').forEach((item, i) => { item.exact_rank = i + 1; });
  sorted('glossary_semantic_score').forEach((item, i) => { item.glossary_semantic_rank = i + 1; });
  sorted('dense_score').forEach((item, i) => { item.dense_rank = i + 1; });
  sorted('lexical_score').forEach((item, i) => { item.lexical_rank = i + 1; });

  return byUri;
}

function formatResult(item, score) {
  return {
    uri: item.uri,
    score: Number(score.toFixed(6)),
    exact_score: Number(item.exact_score.toFixed(6)),
    glossary_semantic_score: Number(item.glossary_semantic_score.toFixed(6)),
    dense_score: Number(item.dense_score.toFixed(6)),
    lexical_score: Number(item.lexical_score.toFixed(6)),
    cues: dedupeTerms([...item.cues], 3),
    matched_on: [...item.matched_on].sort(),
    priority: item.priority,
  };
}

function sortResults(items) {
  return items.sort((a, b) => b.score - a.score || a.priority - b.priority || a.uri.localeCompare(b.uri));
}

// ─── Strategy B: Normalized Linear ───────────────────────────────────

export function normalizedLinearStrategy(rows, params = {}) {
  const {
    w_exact = 0.30,
    w_glossary_semantic = 0.25,
    w_semantic = 0.30,
    w_lexical = 0.15,
    priority_weight = 0.05,
    gs_min_score = 0.82,
  } = params;

  const byUri = collectCandidates(rows);
  const items = [...byUri.values()];

  // find max of each score for normalization
  const maxExact = Math.max(0.001, ...items.map(i => i.exact_score));
  const maxGS = Math.max(0.001, ...items.map(i => i.glossary_semantic_score));
  const maxDense = Math.max(0.001, ...items.map(i => i.dense_score));
  const maxLexical = Math.max(0.001, ...items.map(i => i.lexical_score));

  return sortResults(items.map(item => {
    const normExact = item.exact_score / maxExact;
    const normGS = item.glossary_semantic_score >= gs_min_score
      ? item.glossary_semantic_score / maxGS : 0;
    const normDense = item.dense_score / maxDense;
    const normLexical = item.lexical_score / maxLexical;
    const priorityBonus = Math.max(0, priority_weight - item.priority * 0.01);

    const score = normExact * w_exact
      + normGS * w_glossary_semantic
      + normDense * w_semantic
      + normLexical * w_lexical
      + priorityBonus;

    return formatResult(item, score);
  }));
}

// ─── Strategy C: Reciprocal Rank Fusion (RRF) ────────────────────────

export function rrfStrategy(rows, params = {}) {
  const { k = 60, priority_weight = 0.03 } = params;
  const byUri = collectCandidates(rows);

  return sortResults([...byUri.values()].map(item => {
    let score = 0;
    if (item.exact_rank < Infinity) score += 1 / (k + item.exact_rank);
    if (item.glossary_semantic_rank < Infinity) score += 1 / (k + item.glossary_semantic_rank);
    if (item.dense_rank < Infinity) score += 1 / (k + item.dense_rank);
    if (item.lexical_rank < Infinity) score += 1 / (k + item.lexical_rank);
    score += Math.max(0, priority_weight - item.priority * 0.005);
    return formatResult(item, score);
  }));
}

// ─── Strategy D: Weighted RRF ────────────────────────────────────────

export function weightedRrfStrategy(rows, params = {}) {
  const {
    k = 60,
    w_exact = 1.5,
    w_glossary_semantic = 1.2,
    w_dense = 1.0,
    w_lexical = 0.8,
    priority_weight = 0.03,
  } = params;
  const byUri = collectCandidates(rows);

  return sortResults([...byUri.values()].map(item => {
    let score = 0;
    if (item.exact_rank < Infinity) score += w_exact / (k + item.exact_rank);
    if (item.glossary_semantic_rank < Infinity) score += w_glossary_semantic / (k + item.glossary_semantic_rank);
    if (item.dense_rank < Infinity) score += w_dense / (k + item.dense_rank);
    if (item.lexical_rank < Infinity) score += w_lexical / (k + item.lexical_rank);
    score += Math.max(0, priority_weight - item.priority * 0.005);
    return formatResult(item, score);
  }));
}

// ─── Strategy E: Max-Signal + Bonus ──────────────────────────────────

export function maxSignalStrategy(rows, params = {}) {
  const {
    exact_weight = 0.56,
    gs_weight = 0.50,
    semantic_weight = 0.78,
    lexical_weight = 0.35,
    count_bonus = 0.05,
    priority_weight = 0.05,
    gs_min_score = 0.85,
  } = params;
  const byUri = collectCandidates(rows);

  return sortResults([...byUri.values()].map(item => {
    const signals = [];
    if (item.exact_score > 0) signals.push(item.exact_score * exact_weight);
    if (item.glossary_semantic_score >= gs_min_score) signals.push(item.glossary_semantic_score * gs_weight);
    if (item.dense_score > 0) signals.push(item.dense_score * semantic_weight);
    if (item.lexical_score > 0) signals.push(item.lexical_score * lexical_weight);

    const maxSig = signals.length ? Math.max(...signals) : 0;
    const pathCount = signals.length;
    const bonus = Math.max(0, pathCount - 1) * count_bonus;
    const priorityBonus = Math.max(0, priority_weight - item.priority * 0.01);

    return formatResult(item, maxSig + bonus + priorityBonus);
  }));
}

// ─── Strategy G: Raw-Score (no min-max normalization) ─────────────────
// Rationale: min-max normalization promotes top-1 of every path to 1.0
// regardless of absolute quality. Raw scores preserve the quality signal:
// cosine similarity is already in [0,1] and reflects match strength.

export function rawScoreStrategy(rows, params = {}) {
  const {
    w_exact = 0.30,
    w_glossary_semantic = 0.25,
    w_dense = 0.30,
    w_lexical = 0.05,
    priority_base = 0.05,
    multi_view_step = 0.015,
    multi_view_cap = 0.05,
  } = params;
  const byUri = collectCandidates(rows);
  return sortResults([...byUri.values()].map(item => {
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * 0.01);
    const score = item.exact_score * w_exact
      + item.glossary_semantic_score * w_glossary_semantic
      + item.dense_score * w_dense
      + item.lexical_score * w_lexical
      + item.view_bonus + priorityBonus + multiViewBonus;
    return formatResult(item, score);
  }));
}

// ─── Strategy H: Lexical Length-Damped ──────────────────────────────
// Rationale: OR-mode ts_rank_cd grows with query token count because more
// tokens → more matches are accumulated. Damp by log(tokens) to counteract.

export function lexLengthDampedStrategy(rows, params = {}) {
  const {
    query_tokens = 5,
    w_exact = 0.30,
    w_glossary_semantic = 0.25,
    w_dense = 0.30,
    w_lexical = 0.05,
    priority_base = 0.05,
    multi_view_step = 0.015,
    multi_view_cap = 0.05,
  } = params;
  const byUri = collectCandidates(rows);
  const items = [...byUri.values()];
  const maxExact = Math.max(0.001, ...items.map(i => i.exact_score));
  const maxGS = Math.max(0.001, ...items.map(i => i.glossary_semantic_score));
  const maxDense = Math.max(0.001, ...items.map(i => i.dense_score));
  const maxLexical = Math.max(0.001, ...items.map(i => i.lexical_score));
  // log-based damping: 1 tok→1.0, 5→0.55, 20→0.31, 50→0.21
  const lengthDamp = 1 / Math.log2(2 + query_tokens);
  return sortResults(items.map(item => {
    const normExact = item.exact_score / maxExact;
    const normGS = item.glossary_semantic_score / maxGS;
    const normDense = item.dense_score / maxDense;
    const normLexical = (item.lexical_score / maxLexical) * lengthDamp;
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * 0.01);
    const score = normExact * w_exact + normGS * w_glossary_semantic
      + normDense * w_dense + normLexical * w_lexical
      + item.view_bonus + priorityBonus + multiViewBonus;
    return formatResult(item, score);
  }));
}

// ─── Strategy I: Raw + Length-damped lexical (G+H) ──────────────────

export function rawPlusLexDampStrategy(rows, params = {}) {
  const {
    query_tokens = 5,
    w_exact = 0.30,
    w_glossary_semantic = 0.25,
    w_dense = 0.30,
    w_lexical = 0.03,
    priority_base = 0.05,
    multi_view_step = 0.015,
    multi_view_cap = 0.05,
  } = params;
  const byUri = collectCandidates(rows);
  const lengthDamp = 1 / Math.log2(2 + query_tokens);
  return sortResults([...byUri.values()].map(item => {
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * 0.01);
    const score = item.exact_score * w_exact
      + item.glossary_semantic_score * w_glossary_semantic
      + item.dense_score * w_dense
      + item.lexical_score * lengthDamp * w_lexical
      + item.view_bonus + priorityBonus + multiViewBonus;
    return formatResult(item, score);
  }));
}

// ─── Strategy J: Dense Cosine Floor ──────────────────────────────────
// Rationale: long queries produce moderate cosines (0.3-0.5) across many
// docs. Drop dense signals below threshold so only confident matches count.

export function denseFloorStrategy(rows, params = {}) {
  const {
    dense_floor = 0.40,
    gs_floor = 0.30,
    w_exact = 0.30,
    w_glossary_semantic = 0.25,
    w_dense = 0.30,
    w_lexical = 0.05,
    priority_base = 0.05,
    multi_view_step = 0.015,
    multi_view_cap = 0.05,
  } = params;
  const byUri = collectCandidates(rows);
  const items = [...byUri.values()];
  // Gate dense/GS: zero them out below floor before normalizing
  for (const i of items) {
    if (i.dense_score < dense_floor) i.dense_score = 0;
    if (i.glossary_semantic_score < gs_floor) i.glossary_semantic_score = 0;
  }
  const maxExact = Math.max(0.001, ...items.map(i => i.exact_score));
  const maxGS = Math.max(0.001, ...items.map(i => i.glossary_semantic_score));
  const maxDense = Math.max(0.001, ...items.map(i => i.dense_score));
  const maxLexical = Math.max(0.001, ...items.map(i => i.lexical_score));
  return sortResults(items.map(item => {
    const normExact = item.exact_score / maxExact;
    const normGS = item.glossary_semantic_score > 0 ? item.glossary_semantic_score / maxGS : 0;
    const normDense = item.dense_score > 0 ? item.dense_score / maxDense : 0;
    const normLexical = item.lexical_score / maxLexical;
    const multiViewBonus = Math.min(multi_view_cap, Math.max(0, item.view_types.size - 1) * multi_view_step);
    const priorityBonus = Math.max(0, priority_base - item.priority * 0.01);
    const score = normExact * w_exact + normGS * w_glossary_semantic
      + normDense * w_dense + normLexical * w_lexical
      + item.view_bonus + priorityBonus + multiViewBonus;
    return formatResult(item, score);
  }));
}

// ─── Strategy F: Cascade Scoring ─────────────────────────────────────

export function cascadeStrategy(rows, params = {}) {
  const {
    exact_threshold = 0.7,
    gs_threshold = 0.88,
    semantic_threshold = 0.65,
    exact_base = 0.80,
    gs_base = 0.65,
    semantic_base = 0.50,
    lexical_base = 0.20,
    priority_weight = 0.05,
    secondary_bonus = 0.08,
  } = params;
  const byUri = collectCandidates(rows);

  return sortResults([...byUri.values()].map(item => {
    let score;
    let secondaryCount = 0;

    // Count secondary signals
    if (item.exact_score >= exact_threshold) secondaryCount++;
    if (item.glossary_semantic_score >= gs_threshold) secondaryCount++;
    if (item.dense_score >= semantic_threshold) secondaryCount++;
    if (item.lexical_score > 0) secondaryCount++;
    const bonus = Math.max(0, secondaryCount - 1) * secondary_bonus;

    // Cascade: use highest-confidence tier
    if (item.exact_score >= exact_threshold) {
      score = exact_base + item.exact_score * 0.2 + bonus;
    } else if (item.glossary_semantic_score >= gs_threshold) {
      score = gs_base + item.glossary_semantic_score * 0.2 + bonus;
    } else if (item.dense_score >= semantic_threshold) {
      score = semantic_base + item.dense_score * 0.3 + bonus;
    } else {
      // Fallback: weighted sum of whatever we have
      score = lexical_base * (item.lexical_score > 0 ? 1 : 0)
        + item.dense_score * 0.5
        + item.glossary_semantic_score * 0.3
        + item.exact_score * 0.2;
    }

    score += Math.max(0, priority_weight - item.priority * 0.01);
    return formatResult(item, score);
  }));
}
