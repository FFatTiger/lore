import crypto from 'crypto';
import { sql } from '../../db';
import { embedTexts, resolveEmbeddingConfig, vectorLiteral } from '../view/embeddings';
import { loadNormalizedDocuments } from '../view/retrieval';
import { clampLimit } from '../core/utils';
import type { EmbeddingConfig } from '../core/types';

const GENERATED_SOURCE = 'generated';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface GlossarySourceDoc {
  domain: string;
  path: string;
  node_uuid: string;
  memory_id: number;
  uri: string;
  priority: number;
  disclosure: string;
  glossary_keywords: string[];
}

interface GlossaryRecord {
  domain: string;
  path: string;
  uri: string;
  node_uuid: string;
  memory_id: number;
  priority: number;
  disclosure: string;
  keyword: string;
  match_text: string;
  source: string;
  status: string;
  metadata: Record<string, unknown>;
  source_signature: string;
}

interface GlossarySemanticRow {
  domain: string;
  path: string;
  uri: string;
  node_uuid: string;
  memory_id: number;
  priority: number;
  disclosure: string | null;
  keyword: string;
  metadata: Record<string, unknown>;
  glossary_semantic_score: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function normalizeKeyword(value: unknown): string {
  return String(value || '')
    .replace(/[\/_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildGlossaryRecords(doc: GlossarySourceDoc): GlossaryRecord[] {
  const keywords = [
    ...new Set(
      (Array.isArray(doc.glossary_keywords) ? doc.glossary_keywords : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  ];
  return keywords.map((keyword) => ({
    domain: doc.domain,
    path: doc.path,
    uri: doc.uri,
    node_uuid: doc.node_uuid,
    memory_id: doc.memory_id,
    priority: Number(doc.priority || 0),
    disclosure: doc.disclosure || '',
    keyword,
    match_text: normalizeKeyword(keyword) || keyword,
    source: GENERATED_SOURCE,
    status: 'active',
    metadata: {
      keyword,
      normalized_keyword: normalizeKeyword(keyword) || keyword,
    },
    source_signature: hashPayload({
      uri: doc.uri,
      path: doc.path,
      node_uuid: doc.node_uuid,
      keyword,
      priority: Number(doc.priority || 0),
      disclosure: doc.disclosure || '',
      source: GENERATED_SOURCE,
    }),
  }));
}

async function upsertGlossaryRecord(
  record: GlossaryRecord,
  { embeddingModel = '', vector = null }: { embeddingModel?: string; vector?: number[] | null } = {},
): Promise<void> {
  const embeddingLiteral = Array.isArray(vector) ? vectorLiteral(vector) : null;
  const embeddingDim = Array.isArray(vector) ? vector.length : 0;
  await sql(
    `
      INSERT INTO glossary_term_embeddings (
        domain, path, uri, node_uuid, memory_id, priority, disclosure,
        keyword, match_text, source, status,
        embedding_model, embedding_dim, embedding_vector, metadata, source_signature,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, CASE WHEN $14::text IS NULL THEN NULL ELSE CAST($14 AS vector) END, $15::jsonb, $16,
        NOW(), NOW()
      )
      ON CONFLICT (node_uuid, keyword) DO UPDATE SET
        domain = EXCLUDED.domain,
        path = EXCLUDED.path,
        uri = EXCLUDED.uri,
        memory_id = EXCLUDED.memory_id,
        priority = EXCLUDED.priority,
        disclosure = EXCLUDED.disclosure,
        match_text = EXCLUDED.match_text,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        embedding_model = EXCLUDED.embedding_model,
        embedding_dim = EXCLUDED.embedding_dim,
        embedding_vector = EXCLUDED.embedding_vector,
        metadata = EXCLUDED.metadata,
        source_signature = EXCLUDED.source_signature,
        updated_at = NOW()
    `,
    [
      record.domain,
      record.path,
      record.uri,
      record.node_uuid,
      record.memory_id,
      record.priority,
      record.disclosure,
      record.keyword,
      record.match_text,
      record.source,
      record.status,
      embeddingModel,
      embeddingDim,
      embeddingLiteral,
      JSON.stringify(record.metadata || {}),
      record.source_signature,
    ],
  );
}

async function loadGlossarySourceDocuments(filters: { domain?: string | null; path?: string | null } = {}): Promise<GlossarySourceDoc[]> {
  return (await loadNormalizedDocuments(filters)).map((row) => ({
    domain: row.domain,
    path: row.path,
    node_uuid: row.node_uuid,
    memory_id: row.memory_id,
    uri: row.uri,
    priority: Number(row.priority || 0),
    disclosure: row.disclosure || '',
    glossary_keywords: Array.isArray(row.glossary_keywords) ? row.glossary_keywords : [],
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export async function upsertGeneratedGlossaryEmbeddingsForPath({
  domain,
  path,
  embedding = null,
}: {
  domain: string;
  path: string;
  embedding?: Partial<EmbeddingConfig> | null;
}): Promise<{ source_count: number; updated_count: number; deleted_count: number }> {
  const resolvedEmbedding = await resolveEmbeddingConfig(embedding);
  const docs = await loadGlossarySourceDocuments({ domain, path });

  if (!docs.length) {
    await sql(`DELETE FROM glossary_term_embeddings WHERE domain = $1 AND path = $2 AND source = $3`, [domain, path, GENERATED_SOURCE]);
    return { source_count: 0, updated_count: 0, deleted_count: 0 };
  }

  const sourceRecords = docs.flatMap(buildGlossaryRecords);
  const existing = await sql(
    `SELECT node_uuid, keyword, source_signature, embedding_model, status FROM glossary_term_embeddings WHERE source = $1 AND domain = $2 AND path = $3`,
    [GENERATED_SOURCE, domain, path],
  );
  const existingMap = new Map(existing.rows.map((row: any) => [`${row.node_uuid}::${row.keyword}`, row]));

  const stale = sourceRecords.filter((record) => {
    const row = existingMap.get(`${record.node_uuid}::${record.keyword}`) as any;
    return !row || row.source_signature !== record.source_signature || row.embedding_model !== resolvedEmbedding.model || row.status !== 'active';
  });

  if (stale.length) {
    const vectors = await embedTexts(resolvedEmbedding, stale.map((record) => record.match_text));
    for (let i = 0; i < stale.length; i += 1) {
      await upsertGlossaryRecord(stale[i], { embeddingModel: resolvedEmbedding.model, vector: vectors[i] });
    }
  }

  const sourceKeys = new Set(sourceRecords.map((record) => `${record.node_uuid}::${record.keyword}`));
  let deletedCount = 0;
  for (const row of existing.rows as any[]) {
    const key = `${row.node_uuid}::${row.keyword}`;
    if (!sourceKeys.has(key)) {
      const result = await sql(`DELETE FROM glossary_term_embeddings WHERE node_uuid = $1 AND keyword = $2`, [row.node_uuid, row.keyword]);
      deletedCount += result.rowCount || 0;
    }
  }

  return { source_count: sourceRecords.length, updated_count: stale.length, deleted_count: deletedCount };
}

export async function deleteGeneratedGlossaryEmbeddingsByPrefix({
  domain,
  path,
}: {
  domain: string;
  path: string;
}): Promise<{ deleted_count: number }> {
  const result = await sql(
    `DELETE FROM glossary_term_embeddings WHERE domain = $1 AND source = $2 AND (path = $3 OR path LIKE $4)`,
    [domain, GENERATED_SOURCE, path, `${path}/%`],
  );
  return { deleted_count: result.rowCount || 0 };
}

export async function ensureGlossaryEmbeddingsIndex(
  embedding?: Partial<EmbeddingConfig> | null,
): Promise<{ source_count: number; updated_count: number; deleted_count: number }> {
  const resolvedEmbedding = await resolveEmbeddingConfig(embedding);
  const docs = await loadGlossarySourceDocuments();
  const sourceRecords = docs.flatMap(buildGlossaryRecords);
  const existing = await sql(`SELECT node_uuid, keyword, source_signature, embedding_model, status FROM glossary_term_embeddings WHERE source = $1`, [GENERATED_SOURCE]);
  const existingMap = new Map(existing.rows.map((row: any) => [`${row.node_uuid}::${row.keyword}`, row]));

  const stale = sourceRecords.filter((record) => {
    const row = existingMap.get(`${record.node_uuid}::${record.keyword}`) as any;
    return !row || row.source_signature !== record.source_signature || row.embedding_model !== resolvedEmbedding.model || row.status !== 'active';
  });

  if (stale.length) {
    const vectors = await embedTexts(resolvedEmbedding, stale.map((record) => record.match_text));
    for (let i = 0; i < stale.length; i += 1) {
      await upsertGlossaryRecord(stale[i], { embeddingModel: resolvedEmbedding.model, vector: vectors[i] });
    }
  }

  const sourceKeys = new Set(sourceRecords.map((record) => `${record.node_uuid}::${record.keyword}`));
  let deletedCount = 0;
  for (const row of existing.rows as any[]) {
    const key = `${row.node_uuid}::${row.keyword}`;
    if (!sourceKeys.has(key)) {
      const result = await sql(`DELETE FROM glossary_term_embeddings WHERE node_uuid = $1 AND keyword = $2`, [row.node_uuid, row.keyword]);
      deletedCount += result.rowCount || 0;
    }
  }

  return {
    source_count: sourceRecords.length,
    updated_count: stale.length,
    deleted_count: deletedCount,
  };
}

export async function fetchGlossarySemanticRows({
  embedding,
  queryVector,
  limit = 36,
  domain = null,
}: {
  embedding: EmbeddingConfig;
  queryVector: number[];
  limit?: number;
  domain?: string | null;
}): Promise<GlossarySemanticRow[]> {
  const params: unknown[] = [vectorLiteral(queryVector), embedding.model];
  const where = [`status = 'active'`, `embedding_model = $2`, `embedding_vector IS NOT NULL`];
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
        keyword,
        metadata,
        1 - (embedding_vector <=> CAST($1 AS vector)) AS glossary_semantic_score,
        updated_at
      FROM glossary_term_embeddings
      WHERE ${where.join(' AND ')}
      ORDER BY embedding_vector <=> CAST($1 AS vector), priority ASC, char_length(path) ASC, keyword ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows;
}
