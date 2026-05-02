import { sql } from '../../db';
import { clampLimit } from '../core/utils';
import { getSettings } from '../config/settings';
import { getSessionReadUris } from './recallSessionReads';
import {
  intervalDaysSql,
  asNumber,
  asObject,
  truncateText,
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
  clientType?: string;
}

interface StatsWhereResult {
  where: string;
  params: unknown[];
  filters: { query_id: string; query_text: string; client_type: string };
}

interface CandidateWhereResult {
  joinSql: string;
  where: string;
  params: unknown[];
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
  clientType = '',
}: StatsWhereArgs = {}): StatsWhereResult {
  const safeDays = intervalDaysSql(days);
  const clauses = [`created_at >= NOW() - ($1::int * INTERVAL '1 day')`];
  const params: unknown[] = [safeDays];

  const safeQueryId = sanitizeFilter(queryId, 120);
  const safeQueryText = sanitizeFilter(queryText, 240);
  const safeClientType = sanitizeFilter(clientType, 120).toLowerCase();

  if (safeQueryId) {
    params.push(safeQueryId);
    clauses.push(`query_id = $${params.length}`);
  }
  if (safeQueryText) {
    params.push(`%${safeQueryText}%`);
    clauses.push(`query_text ILIKE $${params.length}`);
  }
  if (safeClientType) {
    if (safeClientType === LEGACY_CLIENT_TYPE_FILTER) {
      clauses.push(`COALESCE(client_type, '') = ''`);
    } else {
      params.push(safeClientType);
      clauses.push(`client_type = $${params.length}`);
    }
  }

  return {
    where: clauses.join(' AND '),
    params,
    filters: {
      query_id: safeQueryId,
      query_text: safeQueryText,
      client_type: safeClientType,
    },
  };
}

function buildCandidateWhere({
  days,
  queryId = '',
  queryText = '',
  clientType = '',
}: StatsWhereArgs = {}, { includeClientType = true }: { includeClientType?: boolean } = {}): CandidateWhereResult {
  const safeDays = intervalDaysSql(days);
  const clauses = [`c.created_at >= NOW() - ($1::int * INTERVAL '1 day')`];
  const params: unknown[] = [safeDays];
  let needsQueryJoin = false;

  const safeQueryId = sanitizeFilter(queryId, 120);
  const safeQueryText = sanitizeFilter(queryText, 240);
  const safeClientType = sanitizeFilter(clientType, 120).toLowerCase();

  if (safeQueryId) {
    params.push(safeQueryId);
    clauses.push(`c.query_id = $${params.length}`);
  }
  if (safeQueryText) {
    needsQueryJoin = true;
    params.push(`%${safeQueryText}%`);
    clauses.push(`q.query_text ILIKE $${params.length}`);
  }
  if (includeClientType && safeClientType) {
    if (safeClientType === LEGACY_CLIENT_TYPE_FILTER) {
      clauses.push(`COALESCE(c.client_type, '') = ''`);
    } else {
      params.push(safeClientType);
      clauses.push(`c.client_type = $${params.length}`);
    }
  }

  return {
    joinSql: needsQueryJoin ? 'JOIN recall_queries q ON q.query_id = c.query_id' : '',
    where: clauses.join(' AND '),
    params,
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

interface DreamQueryRecallDetailArgs {
  days?: number;
  queryId?: string;
  queryText?: string;
  limit?: number;
}

interface DreamQueryCandidatesArgs {
  queryId?: string;
  limit?: number;
  selectedOnly?: boolean;
  usedOnly?: boolean;
}

interface DreamQueryPathArgs {
  queryId?: string;
}

interface DreamQueryNodePathArgs {
  queryId?: string;
  nodeUri?: string;
}

interface DreamQueryEventSamplesArgs {
  queryId?: string;
  nodeUri?: string;
  retrievalPath?: string;
  limit?: number;
  includeMetadata?: boolean;
}

function buildDreamQueryWhere({
  days,
  queryId = '',
  queryText = '',
}: DreamQueryRecallDetailArgs): { where: string; params: unknown[]; filters: { query_id: string; query_text: string } } {
  const safeDays = intervalDaysSql(days);
  const safeQueryId = sanitizeFilter(queryId, 120);
  const safeQueryText = sanitizeFilter(queryText, 240);
  const clauses = [`q.created_at >= NOW() - ($1::int * INTERVAL '1 day')`];
  const params: unknown[] = [safeDays];

  if (safeQueryId) {
    params.push(safeQueryId);
    clauses.push(`q.query_id = $${params.length}`);
  }
  if (safeQueryText) {
    params.push(`%${safeQueryText}%`);
    clauses.push(`q.query_text ILIKE $${params.length}`);
  }

  return {
    where: clauses.join(' AND '),
    params,
    filters: { query_id: safeQueryId, query_text: safeQueryText },
  };
}

function formatQueryPathBreakdownRow(row: Record<string, unknown>) {
  return {
    retrieval_path: row.retrieval_path ?? null,
    view_type: row.view_type ?? null,
    total: Number(row.total || 0),
    selected: Number(row.selected || 0),
    used_in_answer: Number(row.used_in_answer || 0),
    avg_pre_rank_score: asNumber(row.avg_pre_rank_score),
    avg_final_rank_score: asNumber(row.avg_final_rank_score),
  };
}

function formatQueryNodePathRow(row: Record<string, unknown>) {
  return {
    retrieval_path: row.retrieval_path ?? null,
    view_type: row.view_type ?? null,
    events: Number(row.events || 0),
    selected_events: Number(row.selected_events || 0),
    used_events: Number(row.used_events || 0),
    avg_pre_rank_score: asNumber(row.avg_pre_rank_score),
    avg_final_rank_score: asNumber(row.avg_final_rank_score),
  };
}

export async function getDreamQueryRecallDetail({
  days = 7,
  queryId = '',
  queryText = '',
  limit = 50,
}: DreamQueryRecallDetailArgs = {}) {
  const safeDays = intervalDaysSql(days);
  const safeLimit = clampLimit(limit, 1, 100, 50);
  const { where, params, filters } = buildDreamQueryWhere({ days, queryId, queryText });

  const queryResult = await sql(
    `
      SELECT
        q.query_id,
        q.query_text,
        q.session_id,
        q.client_type,
        q.merged_count,
        q.shown_count,
        q.used_count,
        q.created_at
      FROM recall_queries q
      WHERE ${where}
      ORDER BY q.created_at DESC, q.query_id DESC
      LIMIT 1
    `,
    params,
  );

  const queryRow = queryResult.rows[0] as Record<string, unknown> | undefined;
  if (!queryRow) {
    return {
      window_days: safeDays,
      filters,
      query_detail: null,
      status: 'not_found',
      note: 'No recall query matched the provided query_id/query_text in this window.',
    };
  }

  const selectedQueryId = String(queryRow.query_id || '');
  const candidateResult = await sql(
    `
      SELECT c.node_uri
      FROM recall_query_candidates c
      WHERE c.query_id = $1
        AND c.selected = TRUE
      ORDER BY c.displayed_position NULLS LAST,
        c.ranked_position NULLS LAST,
        c.final_rank_score DESC NULLS LAST,
        c.node_uri ASC
      LIMIT $2
    `,
    [selectedQueryId, safeLimit],
  );

  return {
    query_id: selectedQueryId,
    query_text: truncateText(queryRow.query_text, 1200),
    session_id: typeof queryRow.session_id === 'string' && queryRow.session_id.trim() ? queryRow.session_id.trim() : null,
    client_type: typeof queryRow.client_type === 'string' && queryRow.client_type.trim() ? queryRow.client_type.trim() : null,
    created_at: queryRow.created_at ? new Date(queryRow.created_at as string).toISOString() : null,
    merged_count: Number(queryRow.merged_count || 0),
    shown_count: Number(queryRow.shown_count || 0),
    used_count: Number(queryRow.used_count || 0),
    shown_node_uris: candidateResult.rows.map((row: Record<string, unknown>) => String(row.node_uri || '')).filter(Boolean),
  };
}

export async function getDreamQueryCandidates({
  queryId = '',
  limit = 50,
  selectedOnly = false,
  usedOnly = false,
}: DreamQueryCandidatesArgs = {}) {
  const safeQueryId = sanitizeFilter(queryId, 120);
  const safeLimit = clampLimit(limit, 1, 100, 50);
  if (!safeQueryId) return { query_id: '', candidates: [] };

  const clauses = ['c.query_id = $1'];
  if (selectedOnly) clauses.push('c.selected = TRUE');
  if (usedOnly) clauses.push('c.used_in_answer = TRUE');

  const result = await sql(
    `
      SELECT
        c.node_uri,
        c.final_rank_score,
        c.selected,
        c.used_in_answer,
        c.ranked_position,
        c.displayed_position
      FROM recall_query_candidates c
      WHERE ${clauses.join(' AND ')}
      ORDER BY c.ranked_position NULLS LAST,
        c.displayed_position NULLS LAST,
        c.final_rank_score DESC NULLS LAST,
        c.node_uri ASC
      LIMIT $2
    `,
    [safeQueryId, safeLimit],
  );

  return {
    query_id: safeQueryId,
    candidates: result.rows.map((row: Record<string, unknown>) => ({
      node_uri: String(row.node_uri || ''),
      final_rank_score: asNumber(row.final_rank_score),
      selected: row.selected === true,
      used_in_answer: row.used_in_answer === true,
      ranked_position: asNumber(row.ranked_position),
      displayed_position: asNumber(row.displayed_position),
    })),
  };
}

export async function getDreamQueryPathBreakdown({ queryId = '' }: DreamQueryPathArgs = {}) {
  const safeQueryId = sanitizeFilter(queryId, 120);
  if (!safeQueryId) return { query_id: '', paths: [] };

  const result = await sql(
    `
      SELECT
        e.retrieval_path,
        e.view_type,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE e.selected)::int AS selected,
        COUNT(*) FILTER (WHERE e.used_in_answer)::int AS used_in_answer,
        AVG(e.pre_rank_score) AS avg_pre_rank_score,
        AVG(e.final_rank_score) AS avg_final_rank_score
      FROM recall_events e
      WHERE e.query_id = $1
      GROUP BY e.retrieval_path, e.view_type
      ORDER BY total DESC, e.retrieval_path ASC, e.view_type ASC
    `,
    [safeQueryId],
  );

  return {
    query_id: safeQueryId,
    paths: result.rows.map((row: Record<string, unknown>) => formatQueryPathBreakdownRow(row)),
  };
}

export async function getDreamQueryNodePaths({
  queryId = '',
  nodeUri = '',
}: DreamQueryNodePathArgs = {}) {
  const safeQueryId = sanitizeFilter(queryId, 120);
  const safeNodeUri = sanitizeFilter(nodeUri, 240);
  if (!safeQueryId || !safeNodeUri) return { query_id: safeQueryId, node_uri: safeNodeUri, paths: [] };

  const result = await sql(
    `
      SELECT
        e.retrieval_path,
        e.view_type,
        COUNT(*)::int AS events,
        COUNT(*) FILTER (WHERE e.selected)::int AS selected_events,
        COUNT(*) FILTER (WHERE e.used_in_answer)::int AS used_events,
        AVG(e.pre_rank_score) AS avg_pre_rank_score,
        AVG(e.final_rank_score) AS avg_final_rank_score
      FROM recall_events e
      WHERE e.query_id = $1
        AND e.node_uri = $2
      GROUP BY e.retrieval_path, e.view_type
      ORDER BY events DESC, e.retrieval_path ASC, e.view_type ASC
    `,
    [safeQueryId, safeNodeUri],
  );

  return {
    query_id: safeQueryId,
    node_uri: safeNodeUri,
    paths: result.rows.map((row: Record<string, unknown>) => formatQueryNodePathRow(row)),
  };
}

export async function getDreamQueryEventSamples({
  queryId = '',
  nodeUri = '',
  retrievalPath = '',
  limit = 10,
  includeMetadata = false,
}: DreamQueryEventSamplesArgs = {}) {
  const safeQueryId = sanitizeFilter(queryId, 120);
  const safeNodeUri = sanitizeFilter(nodeUri, 240);
  const safeRetrievalPath = sanitizeFilter(retrievalPath, 80);
  const safeLimit = clampLimit(limit, 1, 50, 10);
  if (!safeQueryId) return { query_id: '', events: [] };

  const clauses = ['e.query_id = $1'];
  const params: unknown[] = [safeQueryId];
  if (safeNodeUri) {
    params.push(safeNodeUri);
    clauses.push(`e.node_uri = $${params.length}`);
  }
  if (safeRetrievalPath) {
    params.push(safeRetrievalPath);
    clauses.push(`e.retrieval_path = $${params.length}`);
  }
  params.push(safeLimit);

  const result = await sql(
    `
      SELECT
        e.id,
        e.node_uri,
        e.retrieval_path,
        e.view_type,
        e.pre_rank_score,
        e.final_rank_score,
        e.selected,
        e.used_in_answer,
        e.ranked_position,
        e.displayed_position,
        e.metadata,
        e.created_at
      FROM recall_events e
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${params.length}
    `,
    params,
  );

  return {
    query_id: safeQueryId,
    ...(safeNodeUri ? { node_uri: safeNodeUri } : {}),
    ...(safeRetrievalPath ? { retrieval_path: safeRetrievalPath } : {}),
    events: result.rows.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      node_uri: String(row.node_uri || ''),
      retrieval_path: row.retrieval_path ?? null,
      view_type: row.view_type ?? null,
      pre_rank_score: asNumber(row.pre_rank_score),
      final_rank_score: asNumber(row.final_rank_score),
      selected: row.selected === true,
      used_in_answer: row.used_in_answer === true,
      ranked_position: asNumber(row.ranked_position),
      displayed_position: asNumber(row.displayed_position),
      created_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
      ...(includeMetadata ? { metadata: asObject(row.metadata) } : {}),
    })),
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
        q.query_id,
        q.query_text,
        q.session_id,
        q.client_type,
        q.merged_count,
        q.shown_count,
        q.used_count,
        q.created_at
      FROM recall_queries q
      WHERE q.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND EXISTS (
          SELECT 1
          FROM recall_query_candidates c
          JOIN paths p ON (p.domain || '://' || p.path) = c.node_uri
          WHERE c.query_id = q.query_id
        )
      ORDER BY q.created_at DESC, q.query_id DESC
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
          c.query_id,
          c.node_uri,
          c.selected,
          c.used_in_answer
        FROM recall_query_candidates c
        WHERE c.query_id = ANY($1::text[])
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = c.node_uri)
      `,
      [queryIds],
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
  clientType = '',
}: RecallStatsArgs = {}) {
  const safeDays = intervalDaysSql(days);
  const safeLimit = Math.max(3, Math.min(50, Number(limit) || 12));
  const safeRecentQueriesLimit = clampLimit(recentQueriesLimit, 1, 100, 20);
  const safeRecentQueriesOffset = Math.max(0, Number(recentQueriesOffset) || 0);
  const { where: filterWhere, params: filterParams, filters } = buildStatsWhere({ days, queryId, queryText, clientType });
  const { joinSql: candidateJoinSql, where: candidateWhere, params: candidateParams } = buildCandidateWhere({ days, queryId, queryText, clientType });
  const { joinSql: breakdownJoinSql, where: breakdownWhere, params: breakdownParams } = buildCandidateWhere({ days, queryId, queryText, clientType: '' }, { includeClientType: false });
  const hasFilter = filters.query_id || filters.query_text || filters.client_type;

  await sql('SET LOCAL work_mem = \'64MB\'', []);

  const recentQueriesListParams = [...filterParams, safeRecentQueriesLimit, safeRecentQueriesOffset];
  let queryDetail: Record<string, unknown> | null = null;

  const [summary, recentQueriesCount, recentQueries, displayThreshold, clientTypeBreakdown] = await Promise.all([
    sql(
      `
        SELECT
          COALESCE(SUM(merged_count), 0)::int AS total_merged,
          COALESCE(SUM(shown_count), 0)::int AS total_shown,
          COALESCE(SUM(used_count), 0)::int AS total_used,
          COUNT(*)::int AS query_count,
          MAX(created_at) AS last_event_at
        FROM recall_queries
        WHERE ${filterWhere}
      `,
      filterParams,
    ),
    sql(
      `
        SELECT COUNT(*)::int AS total
        FROM recall_queries
        WHERE ${filterWhere}
      `,
      filterParams,
    ),
    sql(
      `
        SELECT
          query_id,
          query_text,
          merged_count,
          shown_count,
          used_count,
          client_type,
          created_at
        FROM recall_queries
        WHERE ${filterWhere}
        ORDER BY created_at DESC, query_id DESC
        LIMIT $${filterParams.length + 1}
        OFFSET $${filterParams.length + 2}
      `,
      recentQueriesListParams,
    ),
    sql(
      `
        SELECT
          COUNT(*) FILTER (WHERE c.selected = TRUE) AS shown_candidates,
          COUNT(*) FILTER (WHERE c.used_in_answer = TRUE) AS used_candidates,
          AVG(c.final_rank_score) FILTER (WHERE c.selected = TRUE) AS avg_shown_score,
          AVG(c.final_rank_score) FILTER (WHERE c.used_in_answer = TRUE) AS avg_used_score,
          AVG(c.final_rank_score) FILTER (WHERE c.selected = TRUE AND c.used_in_answer = FALSE) AS avg_unused_shown_score,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY c.final_rank_score)
            FILTER (WHERE c.used_in_answer = TRUE AND c.final_rank_score IS NOT NULL) AS used_p25_score,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY c.final_rank_score)
            FILTER (WHERE c.used_in_answer = TRUE AND c.final_rank_score IS NOT NULL) AS used_p50_score,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY c.final_rank_score)
            FILTER (WHERE c.selected = TRUE AND c.used_in_answer = FALSE AND c.final_rank_score IS NOT NULL) AS unused_shown_p75_score
        FROM recall_query_candidates c
        ${candidateJoinSql}
        WHERE ${candidateWhere}
      `,
      candidateParams,
    ),
    sql(
      `
        SELECT
          LOWER(COALESCE(c.client_type, '')) AS client_type,
          COUNT(*) FILTER (WHERE c.selected = TRUE) AS shown_candidates,
          COUNT(*) FILTER (WHERE c.used_in_answer = TRUE) AS used_candidates,
          AVG(c.final_rank_score) FILTER (WHERE c.selected = TRUE) AS avg_shown_score,
          AVG(c.final_rank_score) FILTER (WHERE c.used_in_answer = TRUE) AS avg_used_score,
          AVG(c.final_rank_score) FILTER (WHERE c.selected = TRUE AND c.used_in_answer = FALSE) AS avg_unused_shown_score,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY c.final_rank_score)
            FILTER (WHERE c.used_in_answer = TRUE AND c.final_rank_score IS NOT NULL) AS used_p25_score,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY c.final_rank_score)
            FILTER (WHERE c.used_in_answer = TRUE AND c.final_rank_score IS NOT NULL) AS used_p50_score,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY c.final_rank_score)
            FILTER (WHERE c.selected = TRUE AND c.used_in_answer = FALSE AND c.final_rank_score IS NOT NULL) AS unused_shown_p75_score
        FROM recall_query_candidates c
        ${breakdownJoinSql}
        WHERE ${breakdownWhere}
        GROUP BY LOWER(COALESCE(c.client_type, ''))
        ORDER BY COUNT(*) FILTER (WHERE c.selected = TRUE) DESC, client_type ASC
      `,
      breakdownParams,
    ),
  ]);

  const summaryRow = summary.rows[0] || {};
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

  let recentEventRows: Record<string, unknown>[] = [];

  if (filters.query_id) {
    const [qQuery, qCandidates, qEventsForMerge, qPaths] = await Promise.all([
      sql(
        `
          SELECT query_id, query_text, session_id, client_type, merged_count, shown_count, used_count, created_at
          FROM recall_queries
          WHERE ${filterWhere}
          LIMIT 1
        `,
        filterParams,
      ),
      sql(
        `
          SELECT c.node_uri, c.final_rank_score, c.selected, c.used_in_answer,
            c.ranked_position, c.displayed_position, c.client_type, c.created_at
          FROM recall_query_candidates c
          ${candidateJoinSql}
          WHERE ${candidateWhere}
          ORDER BY c.ranked_position NULLS LAST, c.final_rank_score DESC NULLS LAST, c.node_uri ASC
        `,
        candidateParams,
      ),
      sql(
        `
          SELECT id, query_text, node_uri, retrieval_path, view_type,
            pre_rank_score, final_rank_score, selected, used_in_answer, metadata,
            client_type, ranked_position, displayed_position, created_at
          FROM recall_events
          WHERE ${filterWhere}
          ORDER BY created_at DESC, id DESC
          LIMIT $${filterParams.length + 1}
        `,
        [...filterParams, safeLimit * 8],
      ),
      sql(
        `SELECT retrieval_path, view_type, COUNT(*) AS total, COUNT(*) FILTER (WHERE selected) AS selected,
          AVG(pre_rank_score) AS avg_pre_rank_score, AVG(final_rank_score) AS avg_final_rank_score
        FROM recall_events WHERE ${filterWhere}
        GROUP BY retrieval_path, view_type ORDER BY total DESC`,
        filterParams,
      ),
    ]);
    recentEventRows = qEventsForMerge.rows as Record<string, unknown>[];

    const queryRow = qQuery.rows[0] || {};
    const candidateByUri = new Map((qCandidates.rows as Record<string, unknown>[]).map((row) => [String(row.node_uri || ''), row]));
    const mergedByUri = new Map(mergeEventsByNode(qEventsForMerge.rows).map((candidate) => [candidate.uri, candidate]));
    const mergedCandidates = [...candidateByUri.entries()].map(([uri, row]) => {
      const eventCandidate = mergedByUri.get(uri);
      return {
        uri,
        score: asNumber(row.final_rank_score) ?? eventCandidate?.score ?? 0,
        exact_score: eventCandidate?.exact_score ?? 0,
        glossary_semantic_score: eventCandidate?.glossary_semantic_score ?? 0,
        dense_score: eventCandidate?.dense_score ?? 0,
        lexical_score: eventCandidate?.lexical_score ?? 0,
        selected: row.selected === true,
        used_in_answer: row.used_in_answer === true,
        matched_on: eventCandidate?.matched_on ?? [],
        cues: eventCandidate?.cues ?? [],
        view_types: eventCandidate?.view_types ?? [],
        client_type: typeof row.client_type === 'string' && row.client_type.trim() ? row.client_type.trim() : eventCandidate?.client_type ?? null,
        score_breakdown: eventCandidate?.score_breakdown ?? null,
        ranked_position: asNumber(row.ranked_position),
        displayed_position: asNumber(row.displayed_position),
        paths: eventCandidate?.paths ?? [],
      };
    }).sort((a, b) => {
      const ar = a.ranked_position ?? 999999;
      const br = b.ranked_position ?? 999999;
      return ar - br || b.score - a.score || a.uri.localeCompare(b.uri);
    });
    const debugShape = reshapeEventsForDebugView(qEventsForMerge.rows, mergedCandidates);
    const shownCount = qCandidates.rows.filter((row: Record<string, unknown>) => row.selected === true).length;
    const usedCount = qCandidates.rows.filter((row: Record<string, unknown>) => row.used_in_answer === true).length;

    queryDetail = {
      query_id: filters.query_id,
      query_text: queryRow.query_text || recentEventRows[0]?.query_text || '',
      query: queryRow.query_text || recentEventRows[0]?.query_text || '',
      client_type: typeof queryRow.client_type === 'string' && queryRow.client_type.trim() ? queryRow.client_type.trim() : null,
      merged_count: Number(queryRow.merged_count ?? qCandidates.rows.length ?? 0),
      shown_count: Number(queryRow.shown_count ?? shownCount),
      used_count: Number(queryRow.used_count ?? usedCount),
      merged_candidates: mergedCandidates,
      ...debugShape,
      nodes: qCandidates.rows.map((r: Record<string, unknown>) => ({
        node_uri: r.node_uri,
        total: 1,
        selected: r.selected === true ? 1 : 0,
        used_in_answer: r.used_in_answer === true ? 1 : 0,
        avg_pre_rank_score: null,
        avg_final_rank_score: asNumber(r.final_rank_score),
        max_final_rank_score: asNumber(r.final_rank_score),
      })),
      paths: qPaths.rows.map((r: Record<string, unknown>) => ({ retrieval_path: r.retrieval_path, view_type: r.view_type, total: Number(r.total), selected: Number(r.selected), avg_pre_rank_score: asNumber(r.avg_pre_rank_score), avg_final_rank_score: asNumber(r.avg_final_rank_score) })),
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
      query_count: Number(summaryRow.query_count || 0),
      last_event_at: summaryRow.last_event_at ? new Date(summaryRow.last_event_at).toISOString() : null,
    },
    display_threshold_analysis: displayThresholdAnalysis,
    client_type_threshold_analysis: clientTypeRows,
    by_path: [],
    by_view_type: [],
    noisy_nodes: [],
    recent_queries: {
      items: recentQueryRows,
      total: recentQueriesTotal,
      limit: safeRecentQueriesLimit,
      offset: safeRecentQueriesOffset,
      has_more: safeRecentQueriesOffset + recentQueryRows.length < recentQueriesTotal,
    },
    recent_events: recentEventRows.map((row: Record<string, unknown>) => ({
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
  };
}
