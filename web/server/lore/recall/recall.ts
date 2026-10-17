import { normalizeClientType, type ClientType } from '../../auth';
import type { EmbeddingConfig } from '../core/types';
import { ensureGlossaryEmbeddingsIndex } from '../search/glossarySemantic';
import { ensureMemoryViewsIndex } from '../view/viewCrud';
import { resolveEmbeddingConfig } from '../view/embeddings';
import {
  startRecallEventLog,
  type RecallEventLogState,
} from './recallEventDispatch';
import {
  getRecallRuntimeConfig as sharedGetRecallRuntimeConfig,
  loadRecallSafetyConfig,
} from './recallConfig';
import {
  sanitizeDenseRow,
  sanitizeExactRow,
  sanitizeGlossarySemanticRow,
  sanitizeLexicalRow,
  type SanitizedDenseRow,
  type SanitizedExactRow,
  type SanitizedGlossarySemanticRow,
  type SanitizedLexicalRow,
} from './recallDebugRows';
import type {
  RecallDisplayItem,
  RecallSuppressed,
} from './recallDisplay';
import { resolveRecallQuery, sanitizeRecallQuery } from './recallQuery';
import {
  collectCandidates,
  DEFAULT_STRATEGY,
  runStrategy,
  type ScoredResult,
  type ScoringConfig,
} from './recallScoring';
import {
  runRecallPipeline,
  type RecallPipelineResult,
  type RecallRequestBody,
} from './recallPipeline';

export const getRecallRuntimeConfig = sharedGetRecallRuntimeConfig;
export { loadRecallSafetyConfig };
export { sanitizeRecallQuery, resolveRecallQuery };
export {
  sanitizeDenseRow,
  sanitizeExactRow,
  sanitizeGlossarySemanticRow,
  sanitizeLexicalRow,
};
export type {
  RecallPipelineResult,
  RecallRequestBody,
  SanitizedDenseRow,
  SanitizedExactRow,
  SanitizedGlossarySemanticRow,
  SanitizedLexicalRow,
};
export type { RecallDisplayItem, RecallSuppressed };
export type { RecallEventLogState };

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RecallMemoriesResult {
  query: string;
  index: Record<string, unknown>;
  candidates: RecallDisplayItem[];
  items: RecallDisplayItem[];
  suppressed: RecallSuppressed;
  boot_uris: string[];
  retrieval_meta: RecallPipelineResult['retrieval_meta'];
  event_log: RecallEventLogState;
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
  merged_candidates: RecallDisplayItem[];
  candidates: RecallDisplayItem[];
  items: RecallDisplayItem[];
  suppressed: RecallSuppressed;
  boot_uris: string[];
  event_log: RecallEventLogState | null;
}

interface RecallRequestContext {
  clientType?: ClientType | null;
  /** Set to false for read-only replays that must not write recall logs. */
  logEvents?: boolean;
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

/**
 * Run fixed recall scoring on a set of candidate rows.
 * Accepts legacy `normalizedConfig` alias as a scoring weight source for
 * backward compat with benchmark tests; any strategy field is ignored.
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
    strategy: DEFAULT_STRATEGY,
    w_exact: 0.30,
    w_glossary_semantic: 0.25,
    w_dense: 0.30,
    w_lexical: 0.03,
    priority_base: 0.05,
    priority_step: 0.01,
    multi_view_step: 0.015,
    multi_view_cap: 0.05,
    view_priors: null,
    query_tokens: 5,
  };
  config.strategy = DEFAULT_STRATEGY;
  const byUri = collectCandidates(
    { exactRows, glossarySemanticRows, denseRows, lexicalRows },
    { viewPriors: config.view_priors as Record<string, number> | null },
  );
  return runStrategy(byUri, config);
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
  const startedAt = Date.now();
  const result = await runRecallPipeline(body, { aggregateCandidates });
  const durationMs = Date.now() - startedAt;
  const eventLog = context.logEvents === false
    ? { query_id: '', enabled: false }
    : startRecallEventLog({
        queryText: result.query,
        durationMs,
        exactRows: result.exact_rows,
        glossarySemanticRows: result.glossary_semantic_rows,
        denseRows: result.dense_rows,
        lexicalRows: result.lexical_rows,
        rankedCandidates: result.ranked,
        displayedItems: result.items,
        retrievalMeta: result.retrieval_meta,
        sessionId: result.session_id,
        clientType: resolveRequestClientType(body, context),
        errorLabel: '[recall_events] failed to log recall events',
      });

  return {
    query: result.query,
    index: result.index,
    candidates: result.candidates,
    items: result.items,
    suppressed: result.suppressed,
    boot_uris: result.boot_uris,
    retrieval_meta: result.retrieval_meta,
    event_log: eventLog,
  };
}

export async function debugRecallMemories(body: RecallRequestBody, context: RecallRequestContext = {}): Promise<DebugRecallMemoriesResult> {
  const startedAt = Date.now();
  const result = await runRecallPipeline(body, { aggregateCandidates });
  const durationMs = Date.now() - startedAt;
  const eventLog =
    body?.log_events === true
      ? startRecallEventLog({
          queryText: result.query,
          durationMs,
          exactRows: result.exact_rows,
          glossarySemanticRows: result.glossary_semantic_rows,
          denseRows: result.dense_rows,
          lexicalRows: result.lexical_rows,
          rankedCandidates: result.ranked,
          displayedItems: result.items,
          retrievalMeta: result.retrieval_meta,
          sessionId: result.session_id,
          clientType: resolveRequestClientType(body, context),
          errorLabel: '[recall_events] failed to log debug recall events',
        })
      : null;
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
    event_log: eventLog,
  };
}
