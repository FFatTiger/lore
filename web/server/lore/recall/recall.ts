import crypto from 'crypto';
import { sql } from '../../db';
import { normalizeClientType, type ClientType } from '../../auth';
import { embedTexts, getEmbeddingRuntimeConfig, resolveEmbeddingConfig } from '../view/embeddings';
import { ensureMemoryViewsIndex, ensureMemoryViewsReady } from '../view/viewCrud';
import { countQueryTokens } from '../view/viewBuilders';
import {
  fetchDenseMemoryViewRows,
  fetchLexicalMemoryViewRows,
  fetchExactMemoryRows,
  extractCueTerms,
  getMemoryViewRuntimeConfig,
} from '../view/memoryViewQueries';
import { ensureGlossaryEmbeddingsIndex, fetchGlossarySemanticRows } from '../search/glossarySemantic';
import { logRecallEvents } from './recallEventLog';
import { getSettings as getSettingsBatch } from '../config/settings';
import {
  collectCandidates,
  runStrategy,
  STRATEGIES,
  DEFAULT_STRATEGY,
  type ScoredResult,
  type ScoringConfig,
} from './recallScoring';
import type { EmbeddingConfig } from '../core/types';
import { getBootUris, getBootUriSet } from '../memory/boot';

// ─── Settings key lists ────────────────────────────────────────────────────

const SCORING_SETTING_KEYS = [
  'recall.scoring.strategy',
  'recall.scoring.rrf_k',
  'recall.scoring.dense_floor',
  'recall.scoring.gs_floor',
  'recall.weights.w_exact',
  'recall.weights.w_glossary_semantic',
  'recall.weights.w_dense',
  'recall.weights.w_lexical',
  'recall.bonus.priority_base',
  'recall.bonus.priority_step',
  'recall.bonus.multi_view_step',
  'recall.bonus.multi_view_cap',
  'recall.recency.enabled',
  'recall.recency.half_life_days',
  'recall.recency.max_bonus',
  'recall.recency.priority_exempt',
  'views.prior.gist',
  'views.prior.question',
] as const;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SanitizedDenseRow {
  uri: string;
  view_type: string;
  weight: number;
  semantic_score: number;
  cue_terms: string[];
  llm_refined: boolean;
  llm_model: string | null;
  disclosure: string;
}

export interface SanitizedLexicalRow {
  uri: string;
  view_type: string;
  weight: number;
  lexical_score: number;
  fts_hit: boolean;
  text_hit: boolean;
  uri_hit: boolean;
  cue_terms: string[];
  llm_refined: boolean;
  llm_model: string | null;
  disclosure: string;
}

export interface SanitizedExactRow {
  uri: string;
  exact_score: number;
  path_exact_hit: boolean;
  glossary_exact_hit: boolean;
  glossary_text_hit: boolean;
  query_contains_glossary_hit: boolean;
  glossary_fts_hit: boolean;
  cue_terms: string[];
  disclosure: string;
}

export interface SanitizedGlossarySemanticRow {
  uri: string;
  keyword: string;
  glossary_semantic_score: number;
  cue_terms: string[];
  disclosure: string;
}

export interface RecallSuppressed {
  boot: number;
  read: number;
  score: number;
}

export interface RecallPipelineResult {
  query: string;
  session_id: string | null;
  resolved_embedding: EmbeddingConfig;
  index: Record<string, unknown>;
  exact_rows: Record<string, unknown>[];
  glossary_semantic_rows: Record<string, unknown>[];
  dense_rows: Record<string, unknown>[];
  lexical_rows: Record<string, unknown>[];
  ranked: ScoredResult[];
  candidates: ScoredResult[];
  items: Array<ScoredResult & { score_display: number; read: boolean; boot: boolean }>;
  suppressed: RecallSuppressed;
  boot_uris: string[];
  read_node_display_mode: string;
  retrieval_meta: {
    exact_candidates: number;
    glossary_semantic_candidates: number;
    dense_candidates: number;
    lexical_candidates: number;
    model: string | null;
    strategy: string;
    query_tokens: number;
    recency_enabled: boolean;
    view_types: string[];
  };
}

export interface RecallMemoriesResult {
  query: string;
  index: Record<string, unknown>;
  candidates: ScoredResult[];
  items: Array<ScoredResult & { score_display: number; read: boolean; boot: boolean }>;
  suppressed: RecallSuppressed;
  boot_uris: string[];
  read_node_display_mode: string;
  retrieval_meta: RecallPipelineResult['retrieval_meta'];
  event_log: { query_id: string; enabled: boolean };
}

export interface DebugRecallMemoriesResult {
  query: string;
  index: Record<string, unknown>;
  runtime: Awaited<ReturnType<typeof getRecallRuntimeConfig>>;
  retrieval_meta: RecallPipelineResult['retrieval_meta'];
  exact_hits: SanitizedExactRow[];
  glossary_semantic_hits: SanitizedGlossarySemanticRow[];
  dense_hits: SanitizedDenseRow[];
  lexical_hits: SanitizedLexicalRow[];
  merged_candidates: ScoredResult[];
  candidates: ScoredResult[];
  items: Array<ScoredResult & { score_display: number; read: boolean; boot: boolean }>;
  suppressed: RecallSuppressed;
  boot_uris: string[];
  read_node_display_mode: string;
  event_log: { query_id: string; enabled: boolean } | null;
}

interface LoadedScoringConfig extends ScoringConfig {
  strategy: string;
  rrf_k: number;
  dense_floor: number;
  gs_floor: number;
  recency_enabled: boolean;
  recency_half_life_days: number;
  recency_max_bonus: number;
  recency_priority_exempt: number;
  view_priors: { gist: number; question: number };
  query_tokens?: number;
}

interface LoadedDisplayConfig {
  min_display_score: unknown;
  max_display_items: unknown;
  read_node_display_mode: unknown;
}

interface RecallRequestBody {
  query?: string;
  embedding?: Partial<EmbeddingConfig> | null;
  strategy?: string;
  session_id?: string | null;
  domain?: string | null;
  limit?: number;
  max_display_items?: number;
  min_display_score?: number;
  min_score?: number;
  score_precision?: number;
  read_node_display_mode?: string;
  exclude_boot_from_results?: boolean;
  log_events?: boolean;
  client_type?: string | null;
}

interface RecallRequestContext {
  clientType?: ClientType | null;
}

interface AggregateCandidatesOptions {
  exactRows: Record<string, unknown>[];
  glossarySemanticRows: Record<string, unknown>[];
  denseRows: Record<string, unknown>[];
  lexicalRows: Record<string, unknown>[];
  scoringConfig?: ScoringConfig | null;
  /** @deprecated alias for scoringConfig; kept for backward compat with benchmark tests */
  normalizedConfig?: ScoringConfig | null;
}

function resolveRequestClientType(body: RecallRequestBody, context?: RecallRequestContext): ClientType | null {
  return context?.clientType ?? normalizeClientType(body?.client_type);
}

// ─── Internal helpers ──────────────────────────────────────────────────────

async function loadScoringConfig(): Promise<LoadedScoringConfig> {
  const s = await getSettingsBatch([...SCORING_SETTING_KEYS]);
  const rawStrategy = String(s['recall.scoring.strategy'] || DEFAULT_STRATEGY);
  const strategy = STRATEGIES.includes(rawStrategy as typeof STRATEGIES[number]) ? rawStrategy : DEFAULT_STRATEGY;
  return {
    strategy,
    rrf_k: Number(s['recall.scoring.rrf_k'] || 20),
    dense_floor: Number(s['recall.scoring.dense_floor'] || 0.50),
    gs_floor: Number(s['recall.scoring.gs_floor'] || 0.40),
    w_exact: s['recall.weights.w_exact'] as number,
    w_glossary_semantic: s['recall.weights.w_glossary_semantic'] as number,
    w_dense: s['recall.weights.w_dense'] as number,
    w_lexical: s['recall.weights.w_lexical'] as number,
    priority_base: s['recall.bonus.priority_base'] as number,
    priority_step: s['recall.bonus.priority_step'] as number,
    multi_view_step: s['recall.bonus.multi_view_step'] as number,
    multi_view_cap: s['recall.bonus.multi_view_cap'] as number,
    recency_enabled: s['recall.recency.enabled'] === true,
    recency_half_life_days: Number(s['recall.recency.half_life_days'] || 180),
    recency_max_bonus: Number(s['recall.recency.max_bonus'] || 0.04),
    recency_priority_exempt: Number(s['recall.recency.priority_exempt'] ?? 1),
    view_priors: {
      gist: Number(s['views.prior.gist'] ?? 0.03),
      question: Number(s['views.prior.question'] ?? 0.02),
    },
  };
}

async function loadDisplayConfig(): Promise<LoadedDisplayConfig> {
  const s = await getSettingsBatch([
    'recall.display.min_display_score',
    'recall.display.max_display_items',
    'recall.display.read_node_display_mode',
  ]);
  return {
    min_display_score: s['recall.display.min_display_score'],
    max_display_items: s['recall.display.max_display_items'],
    read_node_display_mode: s['recall.display.read_node_display_mode'],
  };
}

/**
 * Run scoring on a set of candidate rows using the requested strategy.
 * Accepts legacy `normalizedConfig` alias (maps to normalized_linear strategy
 * for backward compat with benchmark tests).
 */
export function aggregateCandidates({
  exactRows,
  glossarySemanticRows,
  denseRows,
  lexicalRows,
  scoringConfig = null,
  normalizedConfig = null,
}: AggregateCandidatesOptions): ScoredResult[] {
  const config: ScoringConfig = scoringConfig || normalizedConfig || {
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
  const strategy = config.strategy || 'normalized_linear';
  const byUri = collectCandidates(
    { exactRows, glossarySemanticRows, denseRows, lexicalRows },
    { viewPriors: config.view_priors as Record<string, number> | null },
  );
  return runStrategy(strategy, byUri, config);
}

export function sanitizeGlossarySemanticRow(row: Record<string, unknown>): SanitizedGlossarySemanticRow {
  return {
    uri: row.uri as string,
    keyword: (row.keyword as string) || '',
    glossary_semantic_score: Number(Number(row.glossary_semantic_score || 0).toFixed(6)),
    cue_terms: extractCueTerms(row),
    disclosure: (row.disclosure as string) || '',
  };
}

export function sanitizeDenseRow(row: Record<string, unknown>): SanitizedDenseRow {
  const metadata = (row.metadata as Record<string, unknown>) || {};
  return {
    uri: row.uri as string,
    view_type: row.view_type as string,
    weight: Number(row.weight || 0),
    semantic_score: Number(Number(row.semantic_score || 0).toFixed(6)),
    cue_terms: extractCueTerms(row),
    llm_refined: metadata.llm_refined === true,
    llm_model: (metadata.llm_model as string) || null,
    disclosure: (row.disclosure as string) || '',
  };
}

export function sanitizeLexicalRow(row: Record<string, unknown>): SanitizedLexicalRow {
  const metadata = (row.metadata as Record<string, unknown>) || {};
  return {
    uri: row.uri as string,
    view_type: row.view_type as string,
    weight: Number(row.weight || 0),
    lexical_score: Number(Number(row.lexical_score || 0).toFixed(6)),
    fts_hit: row.fts_hit === true,
    text_hit: row.text_hit === true,
    uri_hit: row.uri_hit === true,
    cue_terms: extractCueTerms(row),
    llm_refined: metadata.llm_refined === true,
    llm_model: (metadata.llm_model as string) || null,
    disclosure: (row.disclosure as string) || '',
  };
}

export function sanitizeExactRow(row: Record<string, unknown>): SanitizedExactRow {
  return {
    uri: row.uri as string,
    exact_score: Number(Number(row.exact_score || 0).toFixed(6)),
    path_exact_hit: row.path_exact_hit === true,
    glossary_exact_hit: row.glossary_exact_hit === true,
    glossary_text_hit: row.glossary_text_hit === true,
    query_contains_glossary_hit: row.query_contains_glossary_hit === true,
    glossary_fts_hit: row.glossary_fts_hit === true,
    cue_terms: extractCueTerms(row),
    disclosure: (row.disclosure as string) || '',
  };
}

export async function getRecallRuntimeConfig(embedding: Partial<EmbeddingConfig> | null = null) {
  const resolvedEmbedding = await resolveEmbeddingConfig(embedding);
  const scoring = await loadScoringConfig();
  const display = await loadDisplayConfig();
  return {
    embedding: await getEmbeddingRuntimeConfig(resolvedEmbedding),
    memory_views: await getMemoryViewRuntimeConfig(resolvedEmbedding),
    scoring: {
      strategy: scoring.strategy,
      strategies_available: STRATEGIES,
      rrf_k: scoring.rrf_k,
      dense_floor: scoring.dense_floor,
      gs_floor: scoring.gs_floor,
    },
    recency: {
      enabled: scoring.recency_enabled,
      half_life_days: scoring.recency_half_life_days,
      max_bonus: scoring.recency_max_bonus,
      priority_exempt: scoring.recency_priority_exempt,
    },
    // kept under original key for UI backward compat
    normalized_linear: {
      w_exact: scoring.w_exact,
      w_glossary_semantic: scoring.w_glossary_semantic,
      w_dense: scoring.w_dense,
      w_lexical: scoring.w_lexical,
      priority_base: scoring.priority_base,
      priority_step: scoring.priority_step,
      multi_view_step: scoring.multi_view_step,
      multi_view_cap: scoring.multi_view_cap,
    },
    display,
    core_memory_uris: [...getBootUris()].sort(),
  };
}

// Strip known chat-platform metadata PREFIX from recall queries.
// OpenClaw prepends structured blocks before the user's actual message:
//   "Conversation info (untrusted metadata): ```json ... ```"
//   "Sender (untrusted metadata): ```json ... ```"
// Only strips blocks that appear at the START of the query with known labels,
// so user content containing similar patterns mid-message is left untouched.
const METADATA_PREFIX_RE =
  /^(?:\s*(?:Conversation info|Sender|Channel info|Reply info)\s*\(untrusted metadata\)\s*:\s*```[a-z]*[\s\S]*?```\s*)+/i;

function sanitizeRecallQuery(raw: string): string {
  if (!raw) return '';
  return raw.replace(METADATA_PREFIX_RE, '').trim();
}

async function runRecallPipeline(body: RecallRequestBody): Promise<RecallPipelineResult> {
  const rawQuery = body.query || '';
  body.query = sanitizeRecallQuery(rawQuery);
  if (!body.query) body.query = rawQuery; // fallback: if sanitization empties it, keep original

  const resolvedEmbedding = await resolveEmbeddingConfig(body?.embedding || null);
  const index = await ensureMemoryViewsReady();
  const scoringConfig = await loadScoringConfig();
  const displayConfig = await loadDisplayConfig();

  // Per-request strategy override (without mutating settings)
  if (body.strategy && STRATEGIES.includes(body.strategy as typeof STRATEGIES[number])) {
    scoringConfig.strategy = body.strategy;
  }
  // Count query tokens once — needed by raw_plus_lex_damp strategy
  scoringConfig.query_tokens = await countQueryTokens(body.query);

  const [queryVector] = await embedTexts(resolvedEmbedding, [body.query]);
  const maxDisplayItems = Number(body.max_display_items ?? displayConfig.max_display_items);
  const candidateLimit = Math.max(body.limit || 12, maxDisplayItems, 1) * 8;

  const [exactRows, glossarySemanticRows, denseRows, lexicalRows] = await Promise.all([
    fetchExactMemoryRows({
      query: body.query,
      limit: candidateLimit,
      domain: body.domain || null,
    }),
    fetchGlossarySemanticRows({
      embedding: resolvedEmbedding,
      queryVector,
      limit: candidateLimit,
      domain: body.domain || null,
    }),
    fetchDenseMemoryViewRows({
      embedding: resolvedEmbedding,
      queryVector,
      limit: candidateLimit,
      domain: body.domain || null,
    }),
    fetchLexicalMemoryViewRows({
      query: body.query,
      limit: candidateLimit,
      domain: body.domain || null,
    }),
  ]);

  const readUris = new Set<string>();
  if (body.session_id) {
    const readResult = await sql(`SELECT uri FROM session_read_nodes WHERE session_id = $1`, [body.session_id]);
    for (const row of readResult.rows) readUris.add(row.uri as string);
  }

  const bootUris = body.exclude_boot_from_results === false ? new Set<string>() : getBootUriSet();
  const scorePrecision = body.score_precision || 2;
  const minDisplayScore = Number(body.min_display_score ?? displayConfig.min_display_score);
  const readNodeDisplayMode = (body.read_node_display_mode || displayConfig.read_node_display_mode) as string;
  const ranked = aggregateCandidates({ exactRows: exactRows as unknown as Record<string, unknown>[], glossarySemanticRows: glossarySemanticRows as unknown as Record<string, unknown>[], denseRows: denseRows as unknown as Record<string, unknown>[], lexicalRows: lexicalRows as unknown as Record<string, unknown>[], scoringConfig })
    .map((item) => ({
      ...item,
      score_display: Number(item.score.toFixed(scorePrecision)),
      read: readUris.has(item.uri),
      boot: bootUris.has(item.uri),
    }))
    .filter((item) => item.score >= Number(body.min_score || 0));

  const candidates = ranked.slice(0, Math.max(body.limit || 12, maxDisplayItems));
  const display: typeof ranked = [];
  const suppressed: RecallSuppressed = { boot: 0, read: 0, score: 0 };
  for (const item of candidates) {
    if (item.boot) {
      suppressed.boot += 1;
      continue;
    }
    if (item.read) {
      if (readNodeDisplayMode === 'hard') {
        suppressed.read += 1;
        continue;
      }
      if (readNodeDisplayMode === 'soft' && item.score < Math.max(minDisplayScore + 0.1, 0.62)) {
        suppressed.read += 1;
        continue;
      }
    }
    if (item.score < minDisplayScore) {
      suppressed.score += 1;
      continue;
    }
    display.push(item);
    if (display.length >= maxDisplayItems) break;
  }

  return {
    query: body.query,
    session_id: body.session_id || null,
    resolved_embedding: resolvedEmbedding,
    index: index as Record<string, unknown>,
    exact_rows: exactRows as unknown as Record<string, unknown>[],
    glossary_semantic_rows: glossarySemanticRows as unknown as Record<string, unknown>[],
    dense_rows: denseRows as unknown as Record<string, unknown>[],
    lexical_rows: lexicalRows as unknown as Record<string, unknown>[],
    ranked,
    candidates,
    items: display,
    suppressed,
    boot_uris: [...bootUris].sort(),
    read_node_display_mode: readNodeDisplayMode,
    retrieval_meta: {
      exact_candidates: exactRows.length,
      glossary_semantic_candidates: glossarySemanticRows.length,
      dense_candidates: denseRows.length,
      lexical_candidates: lexicalRows.length,
      model: resolvedEmbedding?.model || null,
      strategy: scoringConfig.strategy,
      query_tokens: scoringConfig.query_tokens as number,
      recency_enabled: scoringConfig.recency_enabled,
      view_types: ['gist', 'question'],
    },
  };
}

export async function ensureRecallIndex(embedding: Partial<EmbeddingConfig> | null = null) {
  const resolvedEmbedding = await resolveEmbeddingConfig(embedding);
  const [views, glossary] = await Promise.all([
    ensureMemoryViewsIndex(resolvedEmbedding),
    ensureGlossaryEmbeddingsIndex(resolvedEmbedding),
  ]);
  return {
    ...views,
    glossary_embedding_source_count: glossary.source_count,
    glossary_embedding_updated_count: glossary.updated_count,
    glossary_embedding_deleted_count: glossary.deleted_count,
  };
}

export async function recallMemories(body: RecallRequestBody, context: RecallRequestContext = {}): Promise<RecallMemoriesResult> {
  const result = await runRecallPipeline(body);
  const eventLog = { query_id: crypto.randomUUID(), enabled: true };
  logRecallEvents({
    queryId: eventLog.query_id,
    queryText: result.query,
    exactRows: result.exact_rows,
    glossarySemanticRows: result.glossary_semantic_rows,
    denseRows: result.dense_rows,
    lexicalRows: result.lexical_rows,
    rankedCandidates: result.ranked,
    displayedItems: result.items,
    retrievalMeta: result.retrieval_meta,
    sessionId: result.session_id,
    clientType: resolveRequestClientType(body, context),
  }).catch((error: unknown) => {
    console.error('[recall_events] failed to log recall events', error);
  });

  return {
    query: result.query,
    index: result.index,
    candidates: result.candidates,
    items: result.items,
    suppressed: result.suppressed,
    boot_uris: result.boot_uris,
    read_node_display_mode: result.read_node_display_mode,
    retrieval_meta: result.retrieval_meta,
    event_log: eventLog,
  };
}

export async function debugRecallMemories(body: RecallRequestBody, context: RecallRequestContext = {}): Promise<DebugRecallMemoriesResult> {
  const result = await runRecallPipeline(body);
  const eventLog =
    body?.log_events === true ? { query_id: crypto.randomUUID(), enabled: true } : null;
  if (eventLog) {
    logRecallEvents({
      queryId: eventLog.query_id,
      queryText: result.query,
      exactRows: result.exact_rows,
      glossarySemanticRows: result.glossary_semantic_rows,
      denseRows: result.dense_rows,
      lexicalRows: result.lexical_rows,
      rankedCandidates: result.ranked,
      displayedItems: result.items,
      retrievalMeta: result.retrieval_meta,
      sessionId: result.session_id,
      clientType: resolveRequestClientType(body, context),
    }).catch((error: unknown) => {
      console.error('[recall_events] failed to log debug recall events', error);
    });
  }
  return {
    query: result.query,
    index: result.index,
    runtime: await getRecallRuntimeConfig(result.resolved_embedding),
    retrieval_meta: result.retrieval_meta,
    exact_hits: result.exact_rows.slice(0, 30).map(sanitizeExactRow),
    glossary_semantic_hits: result.glossary_semantic_rows.slice(0, 30).map(sanitizeGlossarySemanticRow),
    dense_hits: result.dense_rows.slice(0, 30).map(sanitizeDenseRow),
    lexical_hits: result.lexical_rows.slice(0, 30).map(sanitizeLexicalRow),
    merged_candidates: result.ranked.slice(0, 30),
    candidates: result.candidates,
    items: result.items,
    suppressed: result.suppressed,
    boot_uris: result.boot_uris,
    read_node_display_mode: result.read_node_display_mode,
    event_log: eventLog,
  };
}
