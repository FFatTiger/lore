import { sql } from '../../db';
import { NORMALIZED_DOCUMENTS_CTE } from '../view/retrieval';
import { embedTexts, resolveEmbeddingConfig } from '../view/embeddings';
import { countQueryTokens, getFtsConfig, getFtsQueryConfig } from '../view/viewBuilders';
import { clampLimit } from '../core/utils';
import {
  fetchDenseMemoryViewRows,
  fetchLexicalMemoryViewRows,
  fetchExactMemoryRows,
} from '../view/memoryViewQueries';
import { fetchGlossarySemanticRows } from './glossarySemantic';
import { collectCandidates, runStrategy, DEFAULT_STRATEGY, STRATEGIES } from '../recall/recallScoring';
import { getSettings as getSettingsBatch } from '../config/settings';
import type { EmbeddingConfig } from '../core/types';
import type { ScoredResult, ScoringConfig } from '../recall/recallScoring';

// ---- Types ----

export interface SearchResult {
  uri: string;
  domain: string;
  path: string;
  priority: number;
  disclosure: string | null;
  score: number;
  score_display: number;
  /** Actual node content — included for top results only */
  content: string | null;
  /** Short snippet for results without full content */
  snippet: string | null;
  matched_on: string[];
  cues: string[];
}

export interface SearchMeta {
  query: string;
  domain: string | null;
  limit: number;
  content_limit: number;
  strategy: string;
  candidates: {
    exact: number;
    glossary_semantic: number;
    dense: number;
    view_lexical: number;
    content_lexical: number;
  };
}

export interface SearchResponse {
  results: SearchResult[];
  meta: SearchMeta;
}

// ---- Scoring config loader (reuses recall settings) ----

const SCORING_KEYS = [
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

async function loadScoringConfig(): Promise<ScoringConfig & { strategy: string }> {
  const s = await getSettingsBatch([...SCORING_KEYS]);
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
    recency_enabled: (s['recall.recency.enabled'] === true),
    recency_half_life_days: Number(s['recall.recency.half_life_days'] || 180),
    recency_max_bonus: Number(s['recall.recency.max_bonus'] || 0.04),
    recency_priority_exempt: Number(s['recall.recency.priority_exempt'] ?? 1),
    view_priors: {
      gist: Number(s['views.prior.gist'] ?? 0.03),
      question: Number(s['views.prior.question'] ?? 0.02),
    },
  };
}

// ---- Raw content lexical search (searches actual node content, not views) ----

interface ContentLexicalRow {
  uri: string;
  domain: string;
  path: string;
  priority: number;
  disclosure: string | null;
  snippet: string | null;
  content_score: number;
}

async function fetchContentLexicalRows({
  query,
  domain = null,
  limit = 40,
}: {
  query: string;
  domain?: string | null;
  limit?: number;
}): Promise<ContentLexicalRow[]> {
  const cleaned = String(query || '').trim();
  if (!cleaned) return [];
  const fts = await getFtsConfig();
  const ftsQuery = await getFtsQueryConfig();
  const candidateLimit = clampLimit(limit, 1, 300, 40);
  const params: unknown[] = [cleaned];
  const where: string[] = [
    `(
      sd.search_vector @@ si.ts_query
      OR sd.uri ILIKE si.like_query
      OR sd.latest_content ILIKE si.like_query
    )`,
  ];

  if (domain) {
    params.push(domain);
    where.push(`sd.domain = $${params.length}`);
  }
  params.push(candidateLimit);

  const result = await sql(
    `
      ${NORMALIZED_DOCUMENTS_CTE},
      search_input AS (
        SELECT
          plainto_tsquery('${ftsQuery}', $1) AS ts_query,
          ('%' || $1 || '%') AS like_query
      ),
      search_documents AS (
        SELECT
          nd.*,
          REGEXP_REPLACE(COALESCE(nd.latest_content, ''), E'[\n\r\t]+', ' ', 'g') AS flat_content,
          (
            setweight(to_tsvector('${fts}', COALESCE(nd.name, '')), 'A') ||
            setweight(to_tsvector('${fts}', COALESCE(nd.glossary_text, '')), 'A') ||
            setweight(to_tsvector('${fts}', COALESCE(nd.disclosure, '')), 'B') ||
            setweight(to_tsvector('${fts}', COALESCE(nd.latest_content, '')), 'C')
          ) AS search_vector
        FROM normalized_documents nd
      )
      SELECT
        sd.uri, sd.domain, sd.path, sd.priority, sd.disclosure,
        COALESCE(
          NULLIF(
            ts_headline('simple', sd.flat_content, si.ts_query,
              'MaxFragments=2, MinWords=8, MaxWords=25, FragmentDelimiter= … '),
            ''
          ),
          LEFT(sd.flat_content, 250)
        ) AS snippet,
        ts_rank_cd(sd.search_vector, si.ts_query, 32) AS content_score
      FROM search_documents sd
      CROSS JOIN search_input si
      WHERE ${where.join(' AND ')}
      ORDER BY ts_rank_cd(sd.search_vector, si.ts_query, 32) DESC,
        sd.priority ASC, sd.uri ASC
      LIMIT $${params.length}
    `,
    params,
  );
  return result.rows as ContentLexicalRow[];
}

// ---- Fetch actual content for top results ----

async function fetchContentForUris(uris: string[]): Promise<Map<string, string>> {
  if (uris.length === 0) return new Map();
  const placeholders = uris.map((_, i) => `$${i + 1}`).join(',');
  const result = await sql(
    `
      ${NORMALIZED_DOCUMENTS_CTE}
      SELECT uri, latest_content
      FROM normalized_documents
      WHERE uri IN (${placeholders})
    `,
    uris,
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.uri as string, (row.latest_content as string) || '');
  }
  return map;
}

// ---- Main search function ----

export async function searchMemories({
  query,
  domain = null,
  limit = 10,
  embedding = null,
  content_limit = 5,
}: {
  query: unknown;
  domain?: string | null;
  limit?: number;
  embedding?: Partial<EmbeddingConfig> | null;
  content_limit?: number;
}): Promise<SearchResponse> {
  const cleaned = String(query || '').trim();
  if (!cleaned) {
    return {
      results: [],
      meta: { query: cleaned, domain, limit: 0, content_limit: 0, strategy: DEFAULT_STRATEGY, candidates: { exact: 0, glossary_semantic: 0, dense: 0, view_lexical: 0, content_lexical: 0 } },
    };
  }

  const safeLimit = clampLimit(limit, 1, 100, 10);
  const safeContentLimit = clampLimit(content_limit, 0, 20, 5);
  const candidateLimit = Math.max(safeLimit * 4, 40);

  // 1. Resolve embedding
  const resolvedEmbedding = await resolveEmbeddingConfig(embedding);

  // 2. Run all 5 retrieval paths in parallel
  const [queryVector] = await embedTexts(resolvedEmbedding, [cleaned]);
  const scoringConfig = await loadScoringConfig();
  scoringConfig.query_tokens = await countQueryTokens(cleaned);

  const [exactRows, gsRows, denseRows, viewLexicalRows, contentRows] = await Promise.all([
    fetchExactMemoryRows({ query: cleaned, limit: candidateLimit, domain }),
    fetchGlossarySemanticRows({ embedding: resolvedEmbedding, queryVector, limit: candidateLimit, domain }),
    fetchDenseMemoryViewRows({ embedding: resolvedEmbedding, queryVector, limit: candidateLimit, domain }),
    fetchLexicalMemoryViewRows({ query: cleaned, limit: candidateLimit, domain }),
    fetchContentLexicalRows({ query: cleaned, domain, limit: candidateLimit }),
  ]);

  // 3. Score via recall's strategy engine (4 view-based paths)
  const byUri = collectCandidates(
    { exactRows: exactRows as unknown as Record<string, unknown>[], glossarySemanticRows: gsRows as unknown as Record<string, unknown>[], denseRows: denseRows as unknown as Record<string, unknown>[], lexicalRows: viewLexicalRows as unknown as Record<string, unknown>[] },
    { viewPriors: scoringConfig.view_priors as Record<string, number> | null },
  );
  const scored = runStrategy(scoringConfig.strategy, byUri, scoringConfig);

  // 4. Merge content lexical hits — boost score for URI matches, add new URIs
  const scoredMap = new Map<string, ScoredResult>();
  for (const item of scored) scoredMap.set(item.uri, item);

  for (const row of contentRows) {
    const contentBonus = Number(row.content_score || 0) * 0.15; // moderate boost for raw content match
    const existing = scoredMap.get(row.uri);
    if (existing) {
      existing.score += contentBonus;
      if (!existing.cues.includes('content')) existing.cues.push('content');
    } else {
      // Content-only match (not in views) — add as new candidate
      scoredMap.set(row.uri, {
        uri: row.uri,
        score: contentBonus + 0.05,
        exact_score: 0,
        glossary_semantic_score: 0,
        dense_score: 0,
        lexical_score: contentBonus,
        score_breakdown: { content: contentBonus },
        priority: row.priority,
        cues: ['content'],
        matched_on: ['content'],
      });
    }
  }

  // 5. Re-sort and slice
  const merged = [...scoredMap.values()]
    .sort((a, b) => b.score - a.score || a.priority - b.priority || a.uri.localeCompare(b.uri))
    .slice(0, safeLimit);

  // 6. Fetch content for top N
  const topUris = merged.slice(0, safeContentLimit).map((r) => r.uri);
  const contentMap = await fetchContentForUris(topUris);

  // 7. Build snippet map from content lexical rows
  const snippetMap = new Map<string, string>();
  for (const row of contentRows) {
    if (row.snippet && !snippetMap.has(row.uri)) snippetMap.set(row.uri, row.snippet);
  }

  // 8. Build disclosure map from content rows
  const disclosureMap = new Map<string, string>();
  for (const row of contentRows) {
    if (row.disclosure && !disclosureMap.has(row.uri)) disclosureMap.set(row.uri, row.disclosure);
  }

  // 9. Build results
  const results: SearchResult[] = merged.map((item) => ({
    uri: item.uri,
    domain: item.uri.split('://')[0] || '',
    path: item.uri.includes('://') ? item.uri.split('://')[1] : item.uri,
    priority: item.priority,
    disclosure: disclosureMap.get(item.uri) || null,
    score: Number(item.score.toFixed(6)),
    score_display: Number(item.score.toFixed(2)),
    content: contentMap.get(item.uri) || null,
    snippet: snippetMap.get(item.uri) || null,
    matched_on: item.matched_on || item.cues || [],
    cues: item.cues || [],
  }));

  return {
    results,
    meta: {
      query: cleaned,
      domain: domain || null,
      limit: safeLimit,
      content_limit: safeContentLimit,
      strategy: scoringConfig.strategy,
      candidates: {
        exact: exactRows.length,
        glossary_semantic: gsRows.length,
        dense: denseRows.length,
        view_lexical: viewLexicalRows.length,
        content_lexical: contentRows.length,
      },
    },
  };
}

// Legacy exports for backward compatibility with existing tests
export { fetchContentLexicalRows };
export function dedupeMatchedOn(values: unknown[]): string[] {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}
export function mergeSearchResults({ lexicalRows, semanticRows, limit }: { lexicalRows: any[]; semanticRows: any[]; limit: number }) {
  // Deprecated — kept for test compatibility only
  return [];
}
