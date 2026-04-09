import { sql } from '../../db';
import { vectorLiteral } from './embeddings';
import { NORMALIZED_DOCUMENTS_CTE } from './retrieval';
import { dedupeTerms, clampLimit } from '../core/utils';
import { getFtsConfig, getFtsQueryConfig } from './viewBuilders';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingRef {
  model: string;
}

export interface FetchDenseOptions {
  embedding: EmbeddingRef;
  queryVector: number[] | string;
  limit?: number;
  domain?: string | null;
}

export interface FetchLexicalOptions {
  query: unknown;
  limit?: number;
  domain?: string | null;
}

export interface FetchExactOptions {
  query: unknown;
  limit?: number;
  domain?: string | null;
}

export interface MemoryViewRow {
  domain: string;
  path: string;
  uri: string;
  node_uuid: string;
  memory_id: number;
  priority: number;
  disclosure: string | null;
  view_type: string;
  weight: number;
  metadata: Record<string, unknown>;
  text_content: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface MemoryViewSummaryRow {
  id: number;
  uri: string;
  node_uuid: string;
  memory_id: number;
  view_type: string;
  source: string | null;
  status: string;
  weight: number;
  text_content: string;
  embedding_model: string | null;
  embedding_dim: number;
  metadata: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

export interface ListMemoryViewsByNodeOptions {
  nodeUuid?: string | null;
  uri?: string | null;
  limit?: number;
}

export interface MemoryViewRuntimeConfig {
  generator_version: string;
  view_types: string[];
  weights: { gist: unknown; question: unknown };
  priors: { gist: unknown; question: unknown };
  llm: {
    enabled: boolean;
    base_url: string | null;
    model: string | null;
    max_docs_per_run: number;
    timeout_ms: number;
    temperature: number;
  };
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

export async function fetchDenseMemoryViewRows({
  embedding,
  queryVector,
  limit = 36,
  domain = null,
}: FetchDenseOptions): Promise<MemoryViewRow[]> {
  const params: unknown[] = [vectorLiteral(queryVector), embedding.model];
  const where: string[] = [
    `status = 'active'`,
    `embedding_model = $2`,
    `embedding_vector IS NOT NULL`,
    `view_type IN ('gist', 'question')`,
  ];
  if (domain) {
    params.push(domain);
    where.push(`domain = $${params.length}`);
  }
  params.push(clampLimit(limit, 1, 300, 36));

  const result = await sql(
    `
      SELECT
        domain,
        path,
        uri,
        node_uuid,
        memory_id,
        priority,
        disclosure,
        view_type,
        weight,
        metadata,
        text_content,
        1 - (embedding_vector <=> CAST($1 AS vector)) AS semantic_score,
        updated_at
      FROM memory_views
      WHERE ${where.join(' AND ')}
      ORDER BY embedding_vector <=> CAST($1 AS vector), priority ASC, char_length(path) ASC, view_type ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows as MemoryViewRow[];
}

export async function fetchLexicalMemoryViewRows({
  query,
  limit = 36,
  domain = null,
}: FetchLexicalOptions): Promise<MemoryViewRow[]> {
  const cleanedQuery = String(query || '').trim();
  if (!cleanedQuery) return [];

  const fts = await getFtsConfig();
  const ftsQuery = await getFtsQueryConfig();
  const params: unknown[] = [cleanedQuery];
  const where: string[] = [
    `status = 'active'`,
    `view_type IN ('gist', 'question')`,
    `(fts @@ to_tsquery('${fts}', regexp_replace(plainto_tsquery('${ftsQuery}', $1)::text, ' & ', ' | ', 'g')) OR text_content ILIKE ('%' || $1 || '%') OR uri ILIKE ('%' || $1 || '%'))`,
  ];
  if (domain) {
    params.push(domain);
    where.push(`domain = $${params.length}`);
  }
  params.push(clampLimit(limit, 1, 300, 36));

  const result = await sql(
    `
      SELECT
        domain,
        path,
        uri,
        node_uuid,
        memory_id,
        priority,
        disclosure,
        view_type,
        weight,
        metadata,
        text_content,
        ts_rank_cd(fts, to_tsquery('${fts}', regexp_replace(plainto_tsquery('${ftsQuery}', $1)::text, ' & ', ' | ', 'g')), 32) AS lexical_score,
        (fts @@ to_tsquery('${fts}', regexp_replace(plainto_tsquery('${ftsQuery}', $1)::text, ' & ', ' | ', 'g'))) AS fts_hit,
        (text_content ILIKE ('%' || $1 || '%')) AS text_hit,
        (uri ILIKE ('%' || $1 || '%')) AS uri_hit,
        updated_at
      FROM memory_views
      WHERE ${where.join(' AND ')}
      ORDER BY (ts_rank_cd(fts, to_tsquery('${fts}', regexp_replace(plainto_tsquery('${ftsQuery}', $1)::text, ' & ', ' | ', 'g')), 32) * weight) DESC, priority ASC, char_length(path) ASC, view_type ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows as MemoryViewRow[];
}

export async function fetchExactMemoryRows({
  query,
  limit = 36,
  domain = null,
}: FetchExactOptions): Promise<MemoryViewRow[]> {
  const cleanedQuery = String(query || '').trim();
  if (!cleanedQuery) return [];

  const fts = await getFtsConfig();
  const ftsQuery = await getFtsQueryConfig();

  // Build FTS query expression (OR-mode to tolerate tokenization differences)
  // The field composed of glossary_text + uri + path gets tokenized at query time.
  const tsQueryExpr = `to_tsquery('${fts}', regexp_replace(plainto_tsquery('${ftsQuery}', $1)::text, ' & ', ' | ', 'g'))`;
  const tsVectorExpr = `to_tsvector('${fts}', COALESCE(nd.glossary_text, '') || ' ' || COALESCE(nd.uri, '') || ' ' || COALESCE(nd.path, ''))`;

  const params: unknown[] = [cleanedQuery];
  const where: string[] = [
    `(
      lower(nd.uri) = lower($1)
      OR lower(nd.path) = lower($1)
      OR nd.uri ILIKE ('%' || $1 || '%')
      OR nd.path ILIKE ('%' || $1 || '%')
      OR nd.glossary_text ILIKE ('%' || $1 || '%')
      OR EXISTS (SELECT 1 FROM unnest(nd.glossary_keywords) AS kw WHERE lower(kw) = lower($1))
      OR EXISTS (SELECT 1 FROM unnest(nd.glossary_keywords) AS kw WHERE length(kw) >= 2 AND lower($1) LIKE ('%' || lower(kw) || '%'))
      OR ${tsVectorExpr} @@ ${tsQueryExpr}
    )`,
  ];
  if (domain) {
    params.push(domain);
    where.push(`nd.domain = $${params.length}`);
  }
  params.push(clampLimit(limit, 1, 300, 36));

  const result = await sql(
    `
      ${NORMALIZED_DOCUMENTS_CTE}
      SELECT
        nd.domain,
        nd.path,
        nd.uri,
        nd.node_uuid,
        nd.memory_id,
        nd.priority,
        nd.disclosure,
        'exact' AS view_type,
        1.0::real AS weight,
        jsonb_build_object(
          'cue_terms', nd.glossary_keywords,
          'glossary_terms', nd.glossary_keywords,
          'path', nd.path
        ) AS metadata,
        nd.glossary_text AS text_content,
        CASE
          WHEN lower(nd.uri) = lower($1) OR lower(nd.path) = lower($1) THEN 1.0
          WHEN EXISTS (SELECT 1 FROM unnest(nd.glossary_keywords) AS kw WHERE lower(kw) = lower($1)) THEN 0.98
          WHEN nd.glossary_text ILIKE ('%' || $1 || '%') THEN 0.9
          WHEN EXISTS (SELECT 1 FROM unnest(nd.glossary_keywords) AS kw WHERE length(kw) >= 2 AND lower($1) LIKE ('%' || lower(kw) || '%')) THEN 0.84
          WHEN ${tsVectorExpr} @@ ${tsQueryExpr} THEN 0.78
          WHEN nd.uri ILIKE ('%' || $1 || '%') OR nd.path ILIKE ('%' || $1 || '%') THEN 0.72
          ELSE 0
        END AS exact_score,
        (lower(nd.uri) = lower($1) OR lower(nd.path) = lower($1)) AS path_exact_hit,
        EXISTS (SELECT 1 FROM unnest(nd.glossary_keywords) AS kw WHERE lower(kw) = lower($1)) AS glossary_exact_hit,
        (nd.glossary_text ILIKE ('%' || $1 || '%')) AS glossary_text_hit,
        EXISTS (SELECT 1 FROM unnest(nd.glossary_keywords) AS kw WHERE length(kw) >= 2 AND lower($1) LIKE ('%' || lower(kw) || '%')) AS query_contains_glossary_hit,
        (${tsVectorExpr} @@ ${tsQueryExpr}) AS glossary_fts_hit,
        nd.memory_created_at AS updated_at
      FROM normalized_documents nd
      WHERE ${where.join(' AND ')}
      ORDER BY exact_score DESC, nd.priority ASC, char_length(nd.path) ASC, nd.uri ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows as MemoryViewRow[];
}

export function buildCandidateKey(row: { uri?: unknown } | null | undefined): string {
  return String(row?.uri || '').trim();
}

export function extractCueTerms(row: { metadata?: unknown } | null | undefined): string[] {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {};
  const glossaryTerms = Array.isArray(metadata.glossary_terms) ? (metadata.glossary_terms as unknown[]) : [];
  const cueTerms = Array.isArray(metadata.cue_terms) ? (metadata.cue_terms as unknown[]) : [];
  return dedupeTerms(glossaryTerms.length ? glossaryTerms : cueTerms, 6);
}

export function getViewPrior(viewType: string): number {
  if (viewType === 'gist') return 0.03;
  if (viewType === 'question') return 0.02;
  return 0;
}

export async function getMemoryViewRuntimeConfig(
  _embedding: EmbeddingRef | null = null,
): Promise<MemoryViewRuntimeConfig> {
  // Lazy import to avoid circular deps
  const settings = await import('../config/settings');
  const s = await settings.getSettings([
    'views.weight.gist',
    'views.weight.question',
    'views.prior.gist',
    'views.prior.question',
    'view_llm.base_url',
    'view_llm.model',
    'view_llm.temperature',
    'view_llm.timeout_ms',
    'view_llm.max_docs_per_run',
  ]);
  const VIEW_GENERATOR_VERSION = 'phase1-v2-llm';
  const baseUrl = String(s['view_llm.base_url'] || '').trim().replace(/\/$/, '');
  const llmEnabled = Boolean(baseUrl);

  return {
    generator_version: VIEW_GENERATOR_VERSION,
    view_types: ['gist', 'question'],
    weights: {
      gist: s['views.weight.gist'],
      question: s['views.weight.question'],
    },
    priors: {
      gist: s['views.prior.gist'],
      question: s['views.prior.question'],
    },
    llm: {
      enabled: llmEnabled,
      base_url: baseUrl || null,
      model: String(s['view_llm.model'] || '').trim() || null,
      max_docs_per_run: Math.max(0, Number(s['view_llm.max_docs_per_run'] || 0)),
      timeout_ms: Number(s['view_llm.timeout_ms']) || 30000,
      temperature: Number(s['view_llm.temperature']) || 0.2,
    },
  };
}

export async function listMemoryViewsByNode({
  nodeUuid = null,
  uri = null,
  limit = 12,
}: ListMemoryViewsByNodeOptions = {}): Promise<MemoryViewSummaryRow[]> {
  const cleanedUri = String(uri || '').trim();
  const cleanedNodeUuid = String(nodeUuid || '').trim();
  if (!cleanedUri && !cleanedNodeUuid) return [];

  const params: unknown[] = [];
  const where: string[] = [];
  if (cleanedNodeUuid) {
    params.push(cleanedNodeUuid);
    where.push(`node_uuid = $${params.length}`);
  }
  if (cleanedUri) {
    params.push(cleanedUri);
    where.push(`uri = $${params.length}`);
  }
  params.push(clampLimit(limit, 1, 50, 12));

  const result = await sql(
    `
      SELECT
        id,
        domain,
        path,
        uri,
        node_uuid,
        memory_id,
        priority,
        disclosure,
        view_type,
        source,
        status,
        weight,
        text_content,
        embedding_model,
        embedding_dim,
        metadata,
        created_at,
        updated_at
      FROM memory_views
      WHERE ${where.join(' OR ')}
      ORDER BY CASE view_type WHEN 'gist' THEN 1 WHEN 'question' THEN 2 ELSE 9 END,
               updated_at DESC,
               id DESC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as number,
    uri: row.uri as string,
    node_uuid: row.node_uuid as string,
    memory_id: row.memory_id as number,
    view_type: row.view_type as string,
    source: (row.source as string) || null,
    status: row.status as string,
    weight: Number(row.weight || 0),
    text_content: (row.text_content as string) || '',
    embedding_model: (row.embedding_model as string) || null,
    embedding_dim: Number(row.embedding_dim || 0),
    metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {},
    created_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  }));
}
