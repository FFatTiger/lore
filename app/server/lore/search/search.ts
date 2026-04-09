import { sql } from '../../db';
import { NORMALIZED_DOCUMENTS_CTE } from '../view/retrieval';
import { embedTexts, vectorLiteral, resolveEmbeddingConfig } from '../view/embeddings';
import { clampLimit } from '../core/utils';
import { getFtsConfig, getFtsQueryConfig } from '../view/viewBuilders';
import type { EmbeddingConfig } from '../core/types';

// ---- Internal row shapes returned from SQL ----

interface LexicalRow {
  uri: string;
  domain: string;
  path: string;
  priority: number;
  disclosure: string | null;
  snippet: string | null;
  fts_score: number | string;
  exact_score: number | string;
  fts_hit: boolean;
  uri_hit: boolean;
  path_hit: boolean;
  name_hit: boolean;
  glossary_hit: boolean;
  disclosure_hit: boolean;
  content_hit: boolean;
}

interface SemanticRow {
  uri: string;
  domain: string;
  path: string;
  priority: number;
  disclosure: string | null;
  snippet: string | null;
  cue_text?: string | null;
  semantic_score: number | string;
}

// ---- Public result shape ----

export interface SearchMergedResult {
  uri: string;
  domain: string;
  path: string;
  priority: number;
  disclosure: string | null;
  snippet: string;
  score: number;
  score_breakdown: { fts: number; exact: number; semantic: number };
  matched_on: string[];
}

export interface SearchMeta {
  query: string;
  domain: string | null;
  limit?: number;
  mode: 'empty' | 'lexical' | 'hybrid';
  lexical_candidates?: number;
  semantic_candidates?: number;
  semantic_error?: string | null;
}

export interface SearchResponse {
  results: SearchMergedResult[];
  meta: SearchMeta;
}

// ---- Internal accumulator used during merge ----

interface MergeAccumulator {
  uri: string;
  domain: string;
  path: string;
  priority: number;
  disclosure: string | null;
  snippet: string;
  lexical_score: number;
  semantic_score: number;
  score: number;
  score_breakdown: { fts: number; exact: number; semantic: number };
  matched_on: string[];
}

// ---- Helper functions ----

async function normalizeEmbedding(
  embedding: Partial<EmbeddingConfig> | null | undefined,
): Promise<EmbeddingConfig | null> {
  try {
    return await resolveEmbeddingConfig(embedding);
  } catch {
    return null;
  }
}

export function dedupeMatchedOn(values: unknown[]): string[] {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

async function fetchLexicalSearchRows({
  query,
  domain = null,
  limit = 10,
}: {
  query: string;
  domain?: string | null;
  limit?: number;
}): Promise<LexicalRow[]> {
  const cleanedQuery = String(query || '').trim();
  if (!cleanedQuery) return [];
  const fts = await getFtsConfig();
  const ftsQuery = await getFtsQueryConfig();

  const candidateLimit = clampLimit(limit, 1, 200, 10);
  const params: unknown[] = [cleanedQuery];
  const where: string[] = [
    `(
      sd.search_vector @@ si.ts_query
      OR sd.uri ILIKE si.like_query
      OR sd.path ILIKE si.like_query
      OR sd.name ILIKE si.like_query
      OR sd.glossary_text ILIKE si.like_query
      OR sd.disclosure ILIKE si.like_query
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
            setweight(to_tsvector('${fts}', REGEXP_REPLACE(COALESCE(nd.path, ''), '[/_\\-]+', ' ', 'g')), 'A') ||
            setweight(to_tsvector('${fts}', COALESCE(nd.glossary_text, '')), 'A') ||
            setweight(to_tsvector('${fts}', COALESCE(nd.disclosure, '')), 'B') ||
            setweight(to_tsvector('${fts}', COALESCE(nd.latest_content, '')), 'C')
          ) AS search_vector
        FROM normalized_documents nd
      )
      SELECT
        sd.domain,
        sd.path,
        sd.uri,
        sd.name,
        sd.priority,
        sd.disclosure,
        COALESCE(
          NULLIF(
            ts_headline(
              'simple',
              sd.flat_content,
              si.ts_query,
              'MaxFragments=2, MinWords=8, MaxWords=18, FragmentDelimiter= … '
            ),
            ''
          ),
          LEFT(sd.flat_content, 220)
        ) AS snippet,
        ts_rank_cd(sd.search_vector, si.ts_query, 32) AS fts_score,
        (
          CASE WHEN sd.uri ILIKE si.like_query THEN 0.2 ELSE 0 END +
          CASE WHEN sd.path ILIKE si.like_query THEN 0.12 ELSE 0 END +
          CASE WHEN sd.name ILIKE si.like_query THEN 0.12 ELSE 0 END +
          CASE WHEN sd.glossary_text ILIKE si.like_query THEN 0.18 ELSE 0 END +
          CASE WHEN sd.disclosure ILIKE si.like_query THEN 0.06 ELSE 0 END
        ) AS exact_score,
        (sd.search_vector @@ si.ts_query) AS fts_hit,
        (sd.uri ILIKE si.like_query) AS uri_hit,
        (sd.path ILIKE si.like_query) AS path_hit,
        (sd.name ILIKE si.like_query) AS name_hit,
        (sd.glossary_text ILIKE si.like_query) AS glossary_hit,
        (sd.disclosure ILIKE si.like_query) AS disclosure_hit,
        (sd.latest_content ILIKE si.like_query) AS content_hit
      FROM search_documents sd
      CROSS JOIN search_input si
      WHERE ${where.join(' AND ')}
      ORDER BY (ts_rank_cd(sd.search_vector, si.ts_query, 32) + (
        CASE WHEN sd.uri ILIKE si.like_query THEN 0.2 ELSE 0 END +
        CASE WHEN sd.path ILIKE si.like_query THEN 0.12 ELSE 0 END +
        CASE WHEN sd.name ILIKE si.like_query THEN 0.12 ELSE 0 END +
        CASE WHEN sd.glossary_text ILIKE si.like_query THEN 0.18 ELSE 0 END +
        CASE WHEN sd.disclosure ILIKE si.like_query THEN 0.06 ELSE 0 END
      )) DESC,
      sd.priority ASC,
      char_length(sd.path) ASC,
      sd.uri ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows as LexicalRow[];
}

async function fetchSemanticSearchRows({
  query,
  domain = null,
  limit = 10,
  embedding,
}: {
  query: string;
  domain?: string | null;
  limit?: number;
  embedding: EmbeddingConfig;
}): Promise<SemanticRow[]> {
  const normalizedEmbedding = await normalizeEmbedding(embedding);
  if (!normalizedEmbedding) return [];

  const [queryVector] = await embedTexts(normalizedEmbedding, [String(query || '').trim()]);
  const candidateLimit = clampLimit(limit, 1, 200, 10);
  const params: unknown[] = [vectorLiteral(queryVector), normalizedEmbedding.model];
  const where: string[] = [`embedding_model = $2`];

  if (domain) {
    params.push(domain);
    where.push(`domain = $${params.length}`);
  }

  params.push(candidateLimit);

  const result = await sql(
    `
      SELECT
        domain,
        path,
        uri,
        COALESCE(NULLIF(REGEXP_REPLACE(path, '^.*/', ''), ''), 'root') AS name,
        priority,
        disclosure,
        LEFT(text_content, 220) AS snippet,
        NULL AS cue_text,
        1 - (embedding_vector <=> CAST($1 AS vector)) AS semantic_score
      FROM memory_views
      WHERE status = 'active' AND ${where.join(' AND ')}
      ORDER BY embedding_vector <=> CAST($1 AS vector), priority ASC, char_length(path) ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows as SemanticRow[];
}

export function mergeSearchResults({
  lexicalRows,
  semanticRows,
  limit,
}: {
  lexicalRows: LexicalRow[];
  semanticRows: SemanticRow[];
  limit: number;
}): SearchMergedResult[] {
  const byUri = new Map<string, MergeAccumulator>();

  for (const row of lexicalRows) {
    const ftsScore = Number(row.fts_score || 0);
    const exactScore = Number(row.exact_score || 0);
    const lexicalScore = ftsScore + exactScore;
    const matched_on: string[] = [];
    if (row.fts_hit) matched_on.push('fts');
    if (row.uri_hit) matched_on.push('uri');
    if (row.path_hit) matched_on.push('path');
    if (row.name_hit) matched_on.push('name');
    if (row.glossary_hit) matched_on.push('glossary');
    if (row.disclosure_hit) matched_on.push('disclosure');
    if (row.content_hit) matched_on.push('content');

    byUri.set(row.uri, {
      uri: row.uri,
      domain: row.domain,
      path: row.path,
      priority: row.priority,
      disclosure: row.disclosure,
      snippet: row.snippet || '',
      lexical_score: lexicalScore,
      semantic_score: 0,
      score: lexicalScore,
      score_breakdown: {
        fts: Number(ftsScore.toFixed(6)),
        exact: Number(exactScore.toFixed(6)),
        semantic: 0,
      },
      matched_on,
    });
  }

  for (const row of semanticRows) {
    const semanticScore = Number(row.semantic_score || 0);
    const existing = byUri.get(row.uri);
    if (existing) {
      existing.semantic_score = Math.max(existing.semantic_score, semanticScore);
      existing.score_breakdown.semantic = Number(existing.semantic_score.toFixed(6));
      existing.score = existing.lexical_score + existing.semantic_score * 0.55;
      existing.matched_on = dedupeMatchedOn([...existing.matched_on, 'semantic']);
      if (!existing.snippet && row.snippet) existing.snippet = row.snippet;
      continue;
    }

    byUri.set(row.uri, {
      uri: row.uri,
      domain: row.domain,
      path: row.path,
      priority: row.priority,
      disclosure: row.disclosure,
      snippet: row.snippet || '',
      lexical_score: 0,
      semantic_score: semanticScore,
      score: semanticScore * 0.55,
      score_breakdown: {
        fts: 0,
        exact: 0,
        semantic: Number(semanticScore.toFixed(6)),
      },
      matched_on: ['semantic'],
    });
  }

  return [...byUri.values()]
    .map((item): SearchMergedResult => ({
      uri: item.uri,
      domain: item.domain,
      path: item.path,
      priority: item.priority,
      disclosure: item.disclosure,
      snippet: item.snippet || '',
      score: Number(item.score.toFixed(6)),
      score_breakdown: item.score_breakdown,
      matched_on: dedupeMatchedOn(item.matched_on),
    }))
    .sort((a, b) => b.score - a.score || a.priority - b.priority || a.uri.localeCompare(b.uri))
    .slice(0, limit);
}

export async function searchMemories({
  query,
  domain = null,
  limit = 10,
  embedding = null,
  hybrid = true,
}: {
  query: unknown;
  domain?: string | null;
  limit?: number;
  embedding?: Partial<EmbeddingConfig> | null;
  hybrid?: boolean;
}): Promise<SearchResponse> {
  const cleanedQuery = String(query || '').trim();
  if (!cleanedQuery) return { results: [], meta: { query: cleanedQuery, domain: null, mode: 'empty' } };

  const safeLimit = clampLimit(limit, 1, 100, 10);
  const candidateLimit = Math.max(safeLimit * 4, 20);
  const lexicalRows = await fetchLexicalSearchRows({ query: cleanedQuery, domain, limit: candidateLimit });

  let semanticRows: SemanticRow[] = [];
  let semanticError: string | null = null;
  const normalizedEmbedding = hybrid ? await normalizeEmbedding(embedding) : null;
  if (normalizedEmbedding) {
    try {
      semanticRows = await fetchSemanticSearchRows({
        query: cleanedQuery,
        domain,
        limit: candidateLimit,
        embedding: normalizedEmbedding,
      });
    } catch (error: unknown) {
      semanticError = (error instanceof Error ? error.message : null) ?? 'Semantic search failed';
    }
  }

  const results = mergeSearchResults({ lexicalRows, semanticRows, limit: safeLimit });
  return {
    results,
    meta: {
      query: cleanedQuery,
      domain: domain || null,
      limit: safeLimit,
      mode: normalizedEmbedding ? 'hybrid' : 'lexical',
      lexical_candidates: lexicalRows.length,
      semantic_candidates: semanticRows.length,
      semantic_error: semanticError,
    },
  };
}
