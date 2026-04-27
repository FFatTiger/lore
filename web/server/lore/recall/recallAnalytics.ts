import { sql } from '../../db';
import { clampLimit } from '../core/utils';
import { getSettings } from '../config/settings';
import { getSessionReadUris } from './recallSessionReads';
import {
  intervalDaysSql,
  asNumber,
  asObject,
} from './recallEventLog';

const LEGACY_CLIENT_TYPE_FILTER = '__legacy__';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function sanitizeFilter(value: unknown, maxChars = 240): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxChars) : '';
}

interface StatsWhereArgs {
  days?: unknown;
  queryId?: string;
  queryText?: string;
  nodeUri?: string;
  clientType?: string;
}

interface StatsWhereResult {
  where: string;
  params: unknown[];
  filters: { query_id: string; query_text: string; node_uri: string; client_type: string };
}

interface DisplayThresholdAnalysis {
  status: 'insufficient_data' | 'ready';
  basis: string;
  shown_candidate_count: number;
  used_candidate_count: number;
  unused_shown_candidate_count: number;
  avg_shown_score: number | null;
  avg_used_score: number | null;
  avg_unused_shown_score: number | null;
  used_p25_score: number | null;
  used_p50_score: number | null;
  unused_shown_p75_score: number | null;
  separation_gap: number | null;
}

function roundMetric(value: number | null, digits = 3): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function buildDisplayThresholdAnalysis(row: Record<string, unknown>): DisplayThresholdAnalysis {
  const shownCandidateCount = Number(row.shown_candidates || 0);
  const usedCandidateCount = Number(row.used_candidates || 0);
  const unusedShownCandidateCount = Math.max(0, shownCandidateCount - usedCandidateCount);
  const avgShownScore = asNumber(row.avg_shown_score);
  const avgUsedScore = asNumber(row.avg_used_score);
  const avgUnusedShownScore = asNumber(row.avg_unused_shown_score);
  const usedP25Score = asNumber(row.used_p25_score);
  const usedP50Score = asNumber(row.used_p50_score);
  const unusedShownP75Score = asNumber(row.unused_shown_p75_score);
  const separationGap =
    usedP25Score !== null && unusedShownP75Score !== null
      ? roundMetric(usedP25Score - unusedShownP75Score)
      : null;

  const status: 'insufficient_data' | 'ready' = usedCandidateCount >= 3 && shownCandidateCount >= 5
    ? 'ready'
    : 'insufficient_data';
  const basis = status === 'ready' ? 'sample_metrics' : 'insufficient_data';

  return {
    status,
    basis,
    shown_candidate_count: shownCandidateCount,
    used_candidate_count: usedCandidateCount,
    unused_shown_candidate_count: unusedShownCandidateCount,
    avg_shown_score: roundMetric(avgShownScore),
    avg_used_score: roundMetric(avgUsedScore),
    avg_unused_shown_score: roundMetric(avgUnusedShownScore),
    used_p25_score: roundMetric(usedP25Score),
    used_p50_score: roundMetric(usedP50Score),
    unused_shown_p75_score: roundMetric(unusedShownP75Score),
    separation_gap: separationGap,
  };
}

export function buildStatsWhere({
  days,
  queryId = '',
  queryText = '',
  nodeUri = '',
  clientType = '',
}: StatsWhereArgs = {}): StatsWhereResult {
  const safeDays = intervalDaysSql(days);
  const clauses = [`created_at >= NOW() - ($1::int * INTERVAL '1 day')`];
  const params: unknown[] = [safeDays];

  const safeQueryId = sanitizeFilter(queryId, 120);
  const safeQueryText = sanitizeFilter(queryText, 240);
  const safeNodeUri = sanitizeFilter(nodeUri, 240);
  const safeClientType = sanitizeFilter(clientType, 120).toLowerCase();
  const legacyClientType = safeClientType === LEGACY_CLIENT_TYPE_FILTER;

  if (safeQueryId) {
    params.push(safeQueryId);
    clauses.push(`metadata->>'query_id' = $${params.length}`);
  }
  if (safeQueryText) {
    params.push(`%${safeQueryText}%`);
    clauses.push(`query_text ILIKE $${params.length}`);
  }
  if (safeNodeUri) {
    params.push(safeNodeUri);
    clauses.push(`node_uri = $${params.length}`);
  }
  if (safeClientType) {
    params.push(safeClientType);
    clauses.push(
      legacyClientType
        ? `LOWER(COALESCE(metadata->>'client_type', '')) = ''`
        : `LOWER(COALESCE(metadata->>'client_type', '')) = $${params.length}`,
    );
  }

  return {
    where: clauses.join(' AND '),
    params: legacyClientType ? params.slice(0, -1) : params,
    filters: {
      query_id: safeQueryId,
      query_text: safeQueryText,
      node_uri: safeNodeUri,
      client_type: safeClientType,
    },
  };
}

// ---------------------------------------------------------------------------
// mergeEventsByNode
// ---------------------------------------------------------------------------

interface EventRow {
  node_uri?: string;
  retrieval_path?: string;
  view_type?: string | null;
  pre_rank_score?: number | null;
  final_rank_score?: number | null;
  selected?: boolean;
  used_in_answer?: boolean;
  metadata?: Record<string, unknown>;
}

interface MergedCandidate {
  uri: string;
  score: number;
  exact_score: number;
  glossary_semantic_score: number;
  dense_score: number;
  lexical_score: number;
  selected: boolean;
  used_in_answer: boolean;
  matched_on: string[];
  cues: string[];
  view_types: string[];
  client_type: string | null;
  score_breakdown: Record<string, unknown> | null;
  ranked_position: number | null;
  displayed_position: number | null;
  paths: Array<{
    retrieval_path: string;
    view_type: string | null;
    pre_rank_score: number | null;
    raw_score: number | null;
  }>;
}

/**
 * Aggregate per-path recall_events rows back into merged candidates, mirroring
 * what aggregateCandidates produced at query time. One entry per node_uri with
 * the four per-path raw scores, merged final score, matched_on union, cues and
 * score_breakdown (captured identically across all rows of the same node).
 */
export function mergeEventsByNode(rows: EventRow[]): MergedCandidate[] {
  const byNode = new Map<string, {
    uri: string;
    score: number;
    exact_score: number;
    glossary_semantic_score: number;
    dense_score: number;
    lexical_score: number;
    selected: boolean;
    used_in_answer: boolean;
    matched_on: Set<string>;
    cues: Set<string>;
    view_types: Set<string>;
    client_type: string | null;
    score_breakdown: Record<string, unknown> | null;
    ranked_position: number | null;
    displayed_position: number | null;
    paths: Array<{ retrieval_path: string; view_type: string | null; pre_rank_score: number | null; raw_score: number | null }>;
  }>();

  for (const row of rows) {
    const uri = String(row.node_uri || '').trim();
    if (!uri) continue;
    const meta = asObject(row.metadata);
    const rawScore = asNumber(meta.raw_score);
    const entry = byNode.get(uri) || {
      uri,
      score: 0,
      exact_score: 0,
      glossary_semantic_score: 0,
      dense_score: 0,
      lexical_score: 0,
      selected: false,
      used_in_answer: false,
      matched_on: new Set<string>(),
      cues: new Set<string>(),
      view_types: new Set<string>(),
      client_type: null,
      score_breakdown: null,
      ranked_position: null,
      displayed_position: null,
      paths: [],
    };

    // final score (same for every row of this node, but use max to be safe)
    const finalScore = asNumber(row.final_rank_score);
    if (finalScore !== null && finalScore > entry.score) entry.score = finalScore;

    // per-path raw scores
    if (row.retrieval_path === 'exact' && rawScore !== null && rawScore > entry.exact_score) entry.exact_score = rawScore;
    if (row.retrieval_path === 'glossary_semantic' && rawScore !== null && rawScore > entry.glossary_semantic_score) entry.glossary_semantic_score = rawScore;
    if (row.retrieval_path === 'dense' && rawScore !== null && rawScore > entry.dense_score) entry.dense_score = rawScore;
    if (row.retrieval_path === 'lexical' && rawScore !== null && rawScore > entry.lexical_score) entry.lexical_score = rawScore;

    if (row.selected) entry.selected = true;
    if (row.used_in_answer) entry.used_in_answer = true;
    if (!entry.client_type && typeof meta.client_type === 'string' && meta.client_type.trim()) {
      entry.client_type = meta.client_type.trim();
    }
    if (row.view_type) entry.view_types.add(row.view_type);
    if (row.retrieval_path) entry.paths.push({ retrieval_path: row.retrieval_path, view_type: row.view_type || null, pre_rank_score: asNumber(row.pre_rank_score), raw_score: rawScore });

    const rowMatched = Array.isArray(meta.matched_on) ? meta.matched_on : [];
    for (const m of rowMatched) entry.matched_on.add(String(m));
    const rowCues = Array.isArray(meta.cue_terms) ? meta.cue_terms
      : Array.isArray(meta.glossary_terms) ? meta.glossary_terms : [];
    for (const c of rowCues) {
      const t = String(c || '').trim();
      if (t) entry.cues.add(t);
    }

    if (!entry.score_breakdown && meta.score_breakdown && typeof meta.score_breakdown === 'object') {
      entry.score_breakdown = meta.score_breakdown as Record<string, unknown>;
    }
    if (entry.ranked_position == null && meta.ranked_position != null) entry.ranked_position = Number(meta.ranked_position);
    if (entry.displayed_position == null && meta.displayed_position != null) entry.displayed_position = Number(meta.displayed_position);

    byNode.set(uri, entry);
  }

  return [...byNode.values()]
    .map((e) => ({
      uri: e.uri,
      score: e.score,
      exact_score: e.exact_score,
      glossary_semantic_score: e.glossary_semantic_score,
      dense_score: e.dense_score,
      lexical_score: e.lexical_score,
      selected: e.selected,
      used_in_answer: e.used_in_answer,
      matched_on: [...e.matched_on].sort(),
      cues: [...e.cues].slice(0, 6),
      view_types: [...e.view_types],
      client_type: e.client_type,
      score_breakdown: e.score_breakdown,
      ranked_position: e.ranked_position,
      displayed_position: e.displayed_position,
      paths: e.paths,
    }))
    .sort((a, b) => b.score - a.score || a.uri.localeCompare(b.uri));
}

// ---------------------------------------------------------------------------
// reshapeEventsForDebugView
// ---------------------------------------------------------------------------

/**
 * Reshape recall_events rows into per-path hit arrays that mirror the debug
 * recall API output, so the drilldown UI can reuse RecallStages as-is.
 */
export function reshapeEventsForDebugView(rows: EventRow[], mergedCandidates: MergedCandidate[]) {
  const exact_hits: Record<string, unknown>[] = [];
  const glossary_semantic_hits: Record<string, unknown>[] = [];
  const dense_hits: Record<string, unknown>[] = [];
  const lexical_hits: Record<string, unknown>[] = [];
  const byNode = new Map(mergedCandidates.map((c) => [c.uri, c]));

  for (const row of rows) {
    const uri = String(row.node_uri || '').trim();
    if (!uri) continue;
    const meta = asObject(row.metadata);
    const raw = asNumber(meta.raw_score);
    const weight = asNumber(meta.source_weight);
    const cues = Array.isArray(meta.cue_terms) ? meta.cue_terms
      : Array.isArray(meta.glossary_terms) ? meta.glossary_terms : [];

    if (row.retrieval_path === 'exact') {
      const flags = asObject(meta.exact_flags);
      exact_hits.push({
        uri,
        exact_score: raw,
        path_exact_hit: flags.path_exact_hit === true,
        glossary_exact_hit: flags.glossary_exact_hit === true,
        glossary_text_hit: flags.glossary_text_hit === true,
        query_contains_glossary_hit: flags.query_contains_glossary_hit === true,
        glossary_fts_hit: flags.glossary_fts_hit === true,
        cue_terms: cues,
        client_type: typeof meta.client_type === 'string' ? meta.client_type : null,
        disclosure: '',
      });
    } else if (row.retrieval_path === 'glossary_semantic') {
      glossary_semantic_hits.push({
        uri,
        keyword: cues[0] || '',
        glossary_semantic_score: raw,
        cue_terms: cues,
        client_type: typeof meta.client_type === 'string' ? meta.client_type : null,
        disclosure: '',
      });
    } else if (row.retrieval_path === 'dense') {
      dense_hits.push({
        uri,
        view_type: row.view_type || null,
        weight,
        semantic_score: raw,
        cue_terms: cues,
        llm_refined: meta.llm_refined === true,
        llm_model: meta.llm_model || null,
        client_type: typeof meta.client_type === 'string' ? meta.client_type : null,
        disclosure: '',
      });
    } else if (row.retrieval_path === 'lexical') {
      const flags = asObject(meta.lexical_flags);
      lexical_hits.push({
        uri,
        view_type: row.view_type || null,
        weight,
        lexical_score: raw,
        fts_hit: flags.fts_hit === true,
        text_hit: flags.text_hit === true,
        uri_hit: flags.uri_hit === true,
        cue_terms: cues,
        llm_refined: meta.llm_refined === true,
        llm_model: meta.llm_model || null,
        client_type: typeof meta.client_type === 'string' ? meta.client_type : null,
        disclosure: '',
      });
    }
  }

  // items: the candidates that were selected (shown to user)
  const items = mergedCandidates
    .filter((c) => c.selected)
    .sort((a, b) => (a.displayed_position ?? 999) - (b.displayed_position ?? 999))
    .map((c) => ({
      uri: c.uri,
      score: c.score,
      score_display: c.score,
      matched_on: c.matched_on,
      cues: c.cues,
      client_type: c.client_type,
      score_breakdown: c.score_breakdown,
      read: false,
      boot: false,
    }));

  return {
    exact_hits,
    glossary_semantic_hits,
    dense_hits,
    lexical_hits,
    items,
    retrieval_meta: {
      exact_candidates: exact_hits.length,
      glossary_semantic_candidates: glossary_semantic_hits.length,
      dense_candidates: dense_hits.length,
      lexical_candidates: lexical_hits.length,
      strategy: 'drilldown',
    },
  };
}

// ---------------------------------------------------------------------------
// getRecallStats
// ---------------------------------------------------------------------------

interface RecallStatsArgs {
  days?: number;
  limit?: number;
  recentQueriesLimit?: number;
  recentQueriesOffset?: number;
  queryId?: string;
  queryText?: string;
  nodeUri?: string;
  clientType?: string;
}

interface DreamRecallReviewQuery {
  query_id: string;
  query_text: string;
  session_id: string | null;
  client_type: string | null;
  created_at: string | null;
  merged_count: number;
  shown_count: number;
  used_count: number;
  flags: string[];
  session_reads: string[];
  selected_uris: string[];
  used_uris: string[];
  unrecalled_session_reads: string[];
  unshown_session_reads: string[];
  missed_recall_signals: Array<{
    type: string;
    uri?: string;
    note?: string;
  }>;
}

interface DreamRecallReviewResult {
  window_days: number;
  signal_coverage: {
    manual_read_after_weak_recall: {
      status: 'session_scoped_proxy';
      note: string;
    };
  };
  reviewed_queries: DreamRecallReviewQuery[];
  summary: {
    reviewed_queries: number;
    zero_use_queries: number;
    low_use_queries: number;
    high_merge_low_use_queries: number;
    unrecalled_session_reads: number;
    unshown_session_reads: number;
    possible_missed_recalls: number;
  };
}

export async function getDreamRecallReview({
  days = 1,
  limit = 12,
  offset = 0,
}: {
  days?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<DreamRecallReviewResult> {
  const safeDays = intervalDaysSql(days);
  const safeLimit = clampLimit(limit, 1, 50, 12);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const reviewedQueriesResult = await sql(
    `
      SELECT
        COALESCE(metadata->>'query_id', id::text) AS query_id,
        MIN(query_text) AS query_text,
        MIN(NULLIF(metadata->>'session_id', '')) AS session_id,
        MIN(NULLIF(metadata->>'client_type', '')) AS client_type,
        COUNT(DISTINCT node_uri) AS merged_count,
        COUNT(DISTINCT node_uri) FILTER (WHERE selected) AS shown_count,
        COUNT(DISTINCT node_uri) FILTER (WHERE used_in_answer) AS used_count,
        MAX(created_at) AS created_at
      FROM recall_events
      WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
      GROUP BY COALESCE(metadata->>'query_id', id::text)
      ORDER BY MAX(created_at) DESC, COALESCE(metadata->>'query_id', id::text) DESC
      LIMIT $2
      OFFSET $3
    `,
    [safeDays, safeLimit, safeOffset],
  );

  const queryIds = reviewedQueriesResult.rows
    .map((row: Record<string, unknown>) => String(row.query_id || '').trim())
    .filter(Boolean);

  let candidateRows: Array<Record<string, unknown>> = [];
  if (queryIds.length > 0) {
    const candidateResult = await sql(
      `
        SELECT
          COALESCE(metadata->>'query_id', id::text) AS query_id,
          node_uri,
          BOOL_OR(selected) AS selected,
          BOOL_OR(used_in_answer) AS used_in_answer
        FROM recall_events
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND COALESCE(metadata->>'query_id', id::text) = ANY($2::text[])
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
        GROUP BY COALESCE(metadata->>'query_id', id::text), node_uri
      `,
      [safeDays, queryIds],
    );
    candidateRows = candidateResult.rows as Array<Record<string, unknown>>;
  }

  const candidatesByQuery = new Map<string, Array<Record<string, unknown>>>();
  for (const row of candidateRows) {
    const queryId = String(row.query_id || '').trim();
    if (!queryId) continue;
    const current = candidatesByQuery.get(queryId) || [];
    current.push(row);
    candidatesByQuery.set(queryId, current);
  }

  const sessionReadsCache = new Map<string, Promise<Set<string>>>();
  const reviewedQueries = await Promise.all(reviewedQueriesResult.rows.map(async (row: Record<string, unknown>) => {
    const queryId = String(row.query_id || '').trim();
    const sessionId = typeof row.session_id === 'string' && row.session_id.trim() ? row.session_id.trim() : null;
    const mergedCount = Number(row.merged_count || 0);
    const shownCount = Number(row.shown_count || 0);
    const usedCount = Number(row.used_count || 0);
    const queryCandidates = candidatesByQuery.get(queryId) || [];
    const candidateUris = new Set<string>();
    const selectedUris = new Set<string>();
    const usedUris = new Set<string>();

    for (const candidate of queryCandidates) {
      const uri = String(candidate.node_uri || '').trim();
      if (!uri) continue;
      candidateUris.add(uri);
      if (candidate.selected === true) selectedUris.add(uri);
      if (candidate.used_in_answer === true) usedUris.add(uri);
    }

    let sessionReads: string[] = [];
    if (sessionId) {
      let sessionReadsPromise = sessionReadsCache.get(sessionId);
      if (!sessionReadsPromise) {
        sessionReadsPromise = getSessionReadUris(sessionId);
        sessionReadsCache.set(sessionId, sessionReadsPromise);
      }
      sessionReads = [...await sessionReadsPromise].sort((a, b) => a.localeCompare(b));
    }

    const unrecalledSessionReads = sessionReads.filter((uri) => !candidateUris.has(uri));
    const unshownSessionReads = sessionReads.filter((uri) => candidateUris.has(uri) && !selectedUris.has(uri));
    const flags: string[] = [];
    if (usedCount === 0 && mergedCount > 0) flags.push('zero_use');
    if (usedCount === 1 && mergedCount >= 4) flags.push('low_use');
    if (mergedCount >= 6 && usedCount <= 1) flags.push('high_merge_low_use');

    const missedRecallSignals: Array<{ type: string; uri?: string; note?: string }> = [];
    const signalKeys = new Set<string>();
    const addSignal = (type: string, uri?: string, note?: string) => {
      const key = `${type}::${uri || ''}::${note || ''}`;
      if (signalKeys.has(key)) return;
      signalKeys.add(key);
      missedRecallSignals.push({
        type,
        ...(uri ? { uri } : {}),
        ...(note ? { note } : {}),
      });
    };

    if (flags.includes('zero_use')) {
      addSignal('zero_use', undefined, `Merged ${mergedCount} candidates but none were used in the answer.`);
    }
    if (flags.includes('low_use')) {
      addSignal('low_use', undefined, `Merged ${mergedCount} candidates but only ${usedCount} candidate was used in the answer.`);
    }
    if (flags.includes('high_merge_low_use')) {
      addSignal('high_merge_low_use', undefined, `Merged ${mergedCount} candidates but only ${usedCount} candidate${usedCount === 1 ? '' : 's'} were used.`);
    }
    for (const uri of unrecalledSessionReads) {
      addSignal('never_retrieved', uri, 'Node was manually read in the same session but was never retrieved for this query.');
    }
    for (const uri of unshownSessionReads) {
      addSignal('retrieved_not_selected', uri, 'Node was manually read in the same session after being retrieved without being shown.');
    }
    if (sessionReads.length > 0 && unshownSessionReads.length > 0 && (usedCount === 0 || shownCount <= 1)) {
      addSignal(
        'manual_read_after_weak_recall_proxy',
        undefined,
        'Session-scoped proxy only: same-session manual reads suggest a follow-up lookup after a weak recall result, but timing is not query-scoped.',
      );
    }

    return {
      query_id: queryId,
      query_text: String(row.query_text || ''),
      session_id: sessionId,
      client_type: typeof row.client_type === 'string' && row.client_type.trim() ? row.client_type.trim() : null,
      created_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
      merged_count: mergedCount,
      shown_count: shownCount,
      used_count: usedCount,
      flags,
      session_reads: sessionReads,
      selected_uris: [...selectedUris].sort((a, b) => a.localeCompare(b)),
      used_uris: [...usedUris].sort((a, b) => a.localeCompare(b)),
      unrecalled_session_reads: unrecalledSessionReads,
      unshown_session_reads: unshownSessionReads,
      missed_recall_signals: missedRecallSignals,
    };
  }));

  const summary = reviewedQueries.reduce(
    (acc, query) => {
      if (query.flags.includes('zero_use')) acc.zero_use_queries += 1;
      if (query.flags.includes('low_use')) acc.low_use_queries += 1;
      if (query.flags.includes('high_merge_low_use')) acc.high_merge_low_use_queries += 1;
      acc.unrecalled_session_reads += query.unrecalled_session_reads.length;
      acc.unshown_session_reads += query.unshown_session_reads.length;
      acc.possible_missed_recalls += query.missed_recall_signals.length;
      return acc;
    },
    {
      reviewed_queries: reviewedQueries.length,
      zero_use_queries: 0,
      low_use_queries: 0,
      high_merge_low_use_queries: 0,
      unrecalled_session_reads: 0,
      unshown_session_reads: 0,
      possible_missed_recalls: 0,
    },
  );

  return {
    window_days: safeDays,
    signal_coverage: {
      manual_read_after_weak_recall: {
        status: 'session_scoped_proxy',
        note: 'Dream can only infer manual-read-after-weak-recall from session-level reads, not strict per-query post-read timing.',
      },
    },
    reviewed_queries: reviewedQueries,
    summary,
  };
}

export async function getRecallStats({
  days = 7,
  limit = 12,
  recentQueriesLimit = 20,
  recentQueriesOffset = 0,
  queryId = '',
  queryText = '',
  nodeUri = '',
  clientType = '',
}: RecallStatsArgs = {}) {
  const safeDays = intervalDaysSql(days);
  const safeLimit = Math.max(3, Math.min(50, Number(limit) || 12));
  const safeRecentQueriesLimit = clampLimit(recentQueriesLimit, 1, 100, 20);
  const safeRecentQueriesOffset = Math.max(0, Number(recentQueriesOffset) || 0);
  const { where: filterWhere, params: filterParams, filters } = buildStatsWhere({ days, queryId, queryText, nodeUri, clientType });
  const { where: breakdownWhere, params: breakdownParams } = buildStatsWhere({ days, queryId, queryText, nodeUri, clientType: '' });
  const hasFilter = filters.query_id || filters.query_text || filters.node_uri || filters.client_type;

  await sql('SET LOCAL work_mem = \'64MB\'', []);

  const recentQueriesListParams = [...filterParams, safeRecentQueriesLimit, safeRecentQueriesOffset];
  let queryDetail: Record<string, unknown> | null = null;
  let nodeDetail: Record<string, unknown> | null = null;

  const [summary, byPath, byViewType, noisyNodes, recentQueriesCount, recentQueries, recentEvents, displayThreshold, clientTypeBreakdown, queryCount] = await Promise.all([
    sql(
      `
        WITH node_summary AS (
          SELECT node_uri, BOOL_OR(selected) AS selected, BOOL_OR(used_in_answer) AS used_in_answer
          FROM recall_events
          WHERE ${filterWhere}
            AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
          GROUP BY node_uri
        )
        SELECT
          COUNT(*) AS total_merged,
          COUNT(*) FILTER (WHERE selected) AS total_shown,
          COUNT(*) FILTER (WHERE used_in_answer) AS total_used
        FROM node_summary
      `,
      filterParams,
    ),
    sql(
      `
        SELECT
          retrieval_path,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE selected) AS selected,
          COUNT(*) FILTER (WHERE used_in_answer) AS used_in_answer,
          AVG(pre_rank_score) AS avg_pre_rank_score,
          AVG(final_rank_score) AS avg_final_rank_score
        FROM recall_events
        WHERE ${filterWhere}
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
        GROUP BY retrieval_path
        ORDER BY selected DESC, total DESC, retrieval_path ASC
      `,
      filterParams,
    ),
    sql(
      `
        SELECT
          COALESCE(view_type, 'unknown') AS view_type,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE selected) AS selected,
          COUNT(*) FILTER (WHERE used_in_answer) AS used_in_answer,
          AVG(pre_rank_score) AS avg_pre_rank_score,
          AVG(final_rank_score) AS avg_final_rank_score
        FROM recall_events
        WHERE ${filterWhere}
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
        GROUP BY COALESCE(view_type, 'unknown')
        ORDER BY selected DESC, total DESC, view_type ASC
      `,
      filterParams,
    ),
    sql(
      `
        SELECT
          node_uri,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE selected) AS selected,
          AVG(final_rank_score) AS avg_final_rank_score,
          MAX(created_at) AS last_event_at
        FROM recall_events
        WHERE ${filterWhere}
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
        GROUP BY node_uri
        HAVING COUNT(*) >= 2
        ORDER BY (COUNT(*) - COUNT(*) FILTER (WHERE selected)) DESC, COUNT(*) DESC, node_uri ASC
        LIMIT $${filterParams.length + 1}
      `,
      [...filterParams, safeLimit],
    ),
    sql(
      `
        SELECT COUNT(DISTINCT COALESCE(metadata->>'query_id', id::text))::int AS total
        FROM recall_events
        WHERE ${filterWhere}
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
      `,
      filterParams,
    ),
    sql(
      `
        WITH per_query_node AS (
          SELECT
            COALESCE(metadata->>'query_id', id::text) AS query_id,
            node_uri,
            BOOL_OR(selected) AS selected,
            BOOL_OR(used_in_answer) AS used_in_answer,
            MIN(query_text) AS query_text,
            MIN(metadata->>'client_type') AS client_type,
            MAX(created_at) AS created_at
          FROM recall_events
          WHERE ${filterWhere}
            AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
          GROUP BY COALESCE(metadata->>'query_id', id::text), node_uri
        )
        SELECT
          query_id,
          MIN(query_text) AS query_text,
          COUNT(*) AS merged_count,
          COUNT(*) FILTER (WHERE selected) AS shown_count,
          COUNT(*) FILTER (WHERE used_in_answer) AS used_count,
          MIN(client_type) AS client_type,
          MAX(created_at) AS created_at
        FROM per_query_node
        GROUP BY query_id
        ORDER BY MAX(created_at) DESC, query_id DESC
        LIMIT $${filterParams.length + 1}
        OFFSET $${filterParams.length + 2}
      `,
      recentQueriesListParams,
    ),
    sql(
      `
        SELECT id, query_text, node_uri, retrieval_path, view_type,
          pre_rank_score, final_rank_score, selected, used_in_answer, metadata,
          metadata->>'client_type' AS client_type, created_at
        FROM recall_events
        WHERE ${filterWhere}
        ORDER BY created_at DESC, id DESC
        LIMIT $${filterParams.length + 1}
      `,
      [...filterParams, safeLimit * 4],
    ),
    sql(
      `
        WITH candidate_rows AS (
          SELECT
            COALESCE(metadata->>'query_id', id::text) AS query_id,
            node_uri,
            BOOL_OR(selected) AS selected,
            BOOL_OR(used_in_answer) AS used_in_answer,
            MAX(final_rank_score) AS final_rank_score
          FROM recall_events
          WHERE ${filterWhere}
            AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
          GROUP BY COALESCE(metadata->>'query_id', id::text), node_uri
        )
        SELECT
          COUNT(*) FILTER (WHERE selected) AS shown_candidates,
          COUNT(*) FILTER (WHERE used_in_answer) AS used_candidates,
          AVG(final_rank_score) FILTER (WHERE selected) AS avg_shown_score,
          AVG(final_rank_score) FILTER (WHERE used_in_answer) AS avg_used_score,
          AVG(final_rank_score) FILTER (WHERE selected AND used_in_answer = FALSE) AS avg_unused_shown_score,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY final_rank_score) FILTER (WHERE used_in_answer) AS used_p25_score,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY final_rank_score) FILTER (WHERE used_in_answer) AS used_p50_score,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY final_rank_score) FILTER (WHERE selected AND used_in_answer = FALSE) AS unused_shown_p75_score
        FROM candidate_rows
      `,
      filterParams,
    ),
    sql(
      `
        WITH candidate_rows AS (
          SELECT
            LOWER(COALESCE(metadata->>'client_type', '')) AS client_type,
            COALESCE(metadata->>'query_id', id::text) AS query_id,
            node_uri,
            BOOL_OR(selected) AS selected,
            BOOL_OR(used_in_answer) AS used_in_answer,
            MAX(final_rank_score) AS final_rank_score
          FROM recall_events
          WHERE ${breakdownWhere}
            AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
          GROUP BY LOWER(COALESCE(metadata->>'client_type', '')), COALESCE(metadata->>'query_id', id::text), node_uri
        )
        SELECT
          client_type,
          COUNT(*) FILTER (WHERE selected) AS shown_candidates,
          COUNT(*) FILTER (WHERE used_in_answer) AS used_candidates,
          AVG(final_rank_score) FILTER (WHERE selected) AS avg_shown_score,
          AVG(final_rank_score) FILTER (WHERE used_in_answer) AS avg_used_score,
          AVG(final_rank_score) FILTER (WHERE selected AND used_in_answer = FALSE) AS avg_unused_shown_score,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY final_rank_score) FILTER (WHERE used_in_answer) AS used_p25_score,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY final_rank_score) FILTER (WHERE used_in_answer) AS used_p50_score,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY final_rank_score) FILTER (WHERE selected AND used_in_answer = FALSE) AS unused_shown_p75_score
        FROM candidate_rows
        GROUP BY client_type
        ORDER BY COUNT(*) FILTER (WHERE selected) DESC, client_type ASC
      `,
      breakdownParams,
    ),
    sql(
      `
        SELECT
          COUNT(DISTINCT COALESCE(metadata->>'query_id', id::text))::int AS query_count,
          MAX(created_at) AS last_event_at
        FROM recall_events
        WHERE ${filterWhere}
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
      `,
      filterParams,
    ),
  ]);

  const summaryRow = summary.rows[0] || {};
  const queryCountRow = queryCount.rows[0] || {};
  const displayThresholdRow = displayThreshold.rows[0] || {};
  const displayThresholdAnalysisBase = buildDisplayThresholdAnalysis(displayThresholdRow);
  const runtimeSettings = await getSettings(['recall.display.min_display_score']);
  const runtimeMinDisplayScore = asNumber(runtimeSettings['recall.display.min_display_score']);
  const displayThresholdAnalysis = {
    ...displayThresholdAnalysisBase,
    current_min_display_score: roundMetric(runtimeMinDisplayScore),
  };
  const clientTypeBreakdownResult = clientTypeBreakdown as Awaited<ReturnType<typeof sql>>;
  const clientTypeRows = clientTypeBreakdownResult.rows.map((row: Record<string, unknown>) => {
    const analysisBase = buildDisplayThresholdAnalysis(row);
    return {
      client_type: typeof row.client_type === 'string' && row.client_type.trim() ? row.client_type.trim() : null,
      current_min_display_score: roundMetric(runtimeMinDisplayScore),
      analysis: {
        ...analysisBase,
        current_min_display_score: roundMetric(runtimeMinDisplayScore),
      },
    };
  });
  const recentQueriesTotal = Number(recentQueriesCount.rows[0]?.total || 0);
  const recentQueryRows = recentQueries.rows.map((row: Record<string, unknown>) => ({
    query_id: row.query_id,
    query_text: row.query_text,
    merged_count: Number(row.merged_count || 0),
    shown_count: Number(row.shown_count || 0),
    used_count: Number(row.used_count || 0),
    client_type: typeof row.client_type === 'string' && row.client_type.trim() ? row.client_type.trim() : null,
    created_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
  }));

  // Query detail: when filtering by queryId, fetch per-node and per-path breakdowns
  if (filters.query_id) {
    const qEventsForMerge = await sql(
      `SELECT node_uri, retrieval_path, view_type, pre_rank_score, final_rank_score,
         selected, used_in_answer, metadata
       FROM recall_events WHERE ${filterWhere}`,
      filterParams,
    );
    const mergedCandidates = mergeEventsByNode(qEventsForMerge.rows);
    const debugShape = reshapeEventsForDebugView(qEventsForMerge.rows, mergedCandidates);
    const [qNodes, qPaths] = await Promise.all([
      sql(
        `SELECT node_uri, COUNT(*) AS total, COUNT(*) FILTER (WHERE selected) AS selected,
          COUNT(*) FILTER (WHERE used_in_answer) AS used_in_answer,
          AVG(pre_rank_score) AS avg_pre_rank_score, AVG(final_rank_score) AS avg_final_rank_score,
          MAX(final_rank_score) AS max_final_rank_score
        FROM recall_events WHERE ${filterWhere}
        GROUP BY node_uri ORDER BY total DESC LIMIT $${filterParams.length + 1}`,
        [...filterParams, safeLimit],
      ),
      sql(
        `SELECT retrieval_path, view_type, COUNT(*) AS total, COUNT(*) FILTER (WHERE selected) AS selected,
          AVG(pre_rank_score) AS avg_pre_rank_score, AVG(final_rank_score) AS avg_final_rank_score
        FROM recall_events WHERE ${filterWhere}
        GROUP BY retrieval_path, view_type ORDER BY total DESC`,
        filterParams,
      ),
    ]);
    queryDetail = {
      query_id: filters.query_id,
      query_text: recentEvents.rows[0]?.query_text || '',
      query: recentEvents.rows[0]?.query_text || '',
      client_type: typeof recentEvents.rows[0]?.client_type === 'string' && recentEvents.rows[0]?.client_type.trim() ? recentEvents.rows[0].client_type.trim() : null,
      merged_count: Number(summaryRow.total_merged || 0),
      shown_count: Number(summaryRow.total_shown || 0),
      used_count: Number(summaryRow.total_used || 0),
      merged_candidates: mergedCandidates,
      ...debugShape,
      nodes: qNodes.rows.map((r: Record<string, unknown>) => ({ node_uri: r.node_uri, total: Number(r.total), selected: Number(r.selected), used_in_answer: Number(r.used_in_answer), avg_pre_rank_score: asNumber(r.avg_pre_rank_score), avg_final_rank_score: asNumber(r.avg_final_rank_score), max_final_rank_score: asNumber(r.max_final_rank_score) })),
      paths: qPaths.rows.map((r: Record<string, unknown>) => ({ retrieval_path: r.retrieval_path, view_type: r.view_type, total: Number(r.total), selected: Number(r.selected), avg_pre_rank_score: asNumber(r.avg_pre_rank_score), avg_final_rank_score: asNumber(r.avg_final_rank_score) })),
    };
  }

  // Node detail: when filtering by nodeUri, fetch per-query breakdowns
  if (filters.node_uri) {
    const nQueries = await sql(
      `SELECT COALESCE(metadata->>'query_id', id::text) AS query_id, MIN(query_text) AS query_text,
        COUNT(*) AS total, COUNT(*) FILTER (WHERE selected) AS selected,
        COUNT(*) FILTER (WHERE used_in_answer) AS used_in_answer,
        AVG(final_rank_score) AS avg_final_rank_score, MAX(final_rank_score) AS max_final_rank_score
      FROM recall_events WHERE ${filterWhere}
      GROUP BY COALESCE(metadata->>'query_id', id::text) ORDER BY MAX(created_at) DESC LIMIT $${filterParams.length + 1}`,
      [...filterParams, safeLimit],
    );
    nodeDetail = {
      node_uri: filters.node_uri,
      merged_count: Number(summaryRow.total_merged || 0),
      shown_count: Number(summaryRow.total_shown || 0),
      avg_final_rank_score: asNumber(summaryRow.avg_final_rank_score),
      queries: nQueries.rows.map((r: Record<string, unknown>) => ({ query_id: r.query_id, query_text: r.query_text, total: Number(r.total), selected: Number(r.selected), used_in_answer: Number(r.used_in_answer), avg_final_rank_score: asNumber(r.avg_final_rank_score), max_final_rank_score: asNumber(r.max_final_rank_score) })),
    };
  }

  return {
    window_days: safeDays,
    aggregation_unit: 'path_event',
    filters: hasFilter ? filters : null,
    summary: {
      merged_count: Number(summaryRow.total_merged || 0),
      shown_count: Number(summaryRow.total_shown || 0),
      used_count: Number(summaryRow.total_used || 0),
      query_count: Number(queryCountRow.query_count || 0),
      last_event_at: queryCountRow.last_event_at ? new Date(queryCountRow.last_event_at).toISOString() : null,
    },
    display_threshold_analysis: displayThresholdAnalysis,
    client_type_threshold_analysis: clientTypeRows,
    by_path: byPath.rows.map((row: Record<string, unknown>) => ({
      retrieval_path: row.retrieval_path,
      total: Number(row.total || 0),
      selected: Number(row.selected || 0),
      used_in_answer: Number(row.used_in_answer || 0),
      avg_pre_rank_score: asNumber(row.avg_pre_rank_score),
      avg_final_rank_score: asNumber(row.avg_final_rank_score),
    })),
    by_view_type: byViewType.rows.map((row: Record<string, unknown>) => ({
      view_type: row.view_type,
      total: Number(row.total || 0),
      selected: Number(row.selected || 0),
      used_in_answer: Number(row.used_in_answer || 0),
      avg_pre_rank_score: asNumber(row.avg_pre_rank_score),
      avg_final_rank_score: asNumber(row.avg_final_rank_score),
    })),
    noisy_nodes: noisyNodes.rows.map((row: Record<string, unknown>) => ({
      node_uri: row.node_uri,
      total: Number(row.total || 0),
      selected: Number(row.selected || 0),
      avg_final_rank_score: asNumber(row.avg_final_rank_score),
      last_event_at: row.last_event_at ? new Date(row.last_event_at as string).toISOString() : null,
    })),
    recent_queries: {
      items: recentQueryRows,
      total: recentQueriesTotal,
      limit: safeRecentQueriesLimit,
      offset: safeRecentQueriesOffset,
      has_more: safeRecentQueriesOffset + recentQueryRows.length < recentQueriesTotal,
    },
    recent_events: recentEvents.rows.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      query_text: row.query_text,
      node_uri: row.node_uri,
      retrieval_path: row.retrieval_path,
      view_type: row.view_type,
      pre_rank_score: asNumber(row.pre_rank_score),
      final_rank_score: asNumber(row.final_rank_score),
      selected: row.selected === true,
      used_in_answer: row.used_in_answer === true,
      metadata: asObject(row.metadata),
      client_type: typeof row.client_type === 'string' && row.client_type.trim() ? row.client_type.trim() : null,
      created_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
    })),
    ...(queryDetail ? { query_detail: queryDetail } : {}),
    ...(nodeDetail ? { node_detail: nodeDetail } : {}),
  };
}
