import { sql } from '../../db';
import type { SourceDocument } from '../core/types';

export const NORMALIZED_DOCUMENTS_CTE: string = `
  WITH normalized_documents AS (
    SELECT
      p.domain,
      p.path,
      e.child_uuid AS node_uuid,
      e.priority,
      e.disclosure,
      m.id AS memory_id,
      (p.domain || '://' || p.path) AS uri,
      COALESCE(NULLIF(REGEXP_REPLACE(p.path, '^.*/', ''), ''), 'root') AS name,
      COALESCE(gk.glossary_keywords, ARRAY[]::text[]) AS glossary_keywords,
      COALESCE(gk.glossary_text, '') AS glossary_text,
      m.content AS latest_content,
      m.created_at AS memory_created_at
    FROM paths p
    JOIN edges e ON p.edge_id = e.id
    JOIN LATERAL (
      SELECT id, content, created_at
      FROM memories
      WHERE node_uuid = e.child_uuid AND deprecated = FALSE
      ORDER BY created_at DESC
      LIMIT 1
    ) m ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(array_agg(keyword ORDER BY keyword), ARRAY[]::text[]) AS glossary_keywords,
        COALESCE(string_agg(keyword, ' ' ORDER BY keyword), '') AS glossary_text
      FROM glossary_keywords
      WHERE node_uuid = e.child_uuid
    ) gk ON TRUE
  )
`;

interface LoadNormalizedDocumentsOptions {
  domain?: string | null;
  path?: string | null;
  pathPrefix?: string | null;
}

// Row returned from the CTE query (a subset of SourceDocument fields + extras)
interface NormalizedDocumentRow {
  domain: string;
  path: string;
  node_uuid: string;
  priority: number | null;
  disclosure: string | null;
  memory_id: number;
  uri: string;
  name: string | null;
  glossary_keywords: string[] | null;
  glossary_text: string | null;
  latest_content: string | null;
}

export async function loadNormalizedDocuments(
  { domain = null, path = null, pathPrefix = null }: LoadNormalizedDocumentsOptions = {},
): Promise<NormalizedDocumentRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (domain) {
    params.push(domain);
    where.push(`domain = $${params.length}`);
  }

  if (path !== null && path !== undefined && String(path).trim() !== '') {
    params.push(String(path).trim().replace(/^\/+|\/+$/g, ''));
    where.push(`path = $${params.length}`);
  } else if (pathPrefix !== null && pathPrefix !== undefined && String(pathPrefix).trim() !== '') {
    params.push(`${String(pathPrefix).trim().replace(/^\/+|\/+$/g, '')}/%`);
    where.push(`path LIKE $${params.length}`);
  }

  const result = await sql(
    `
      ${NORMALIZED_DOCUMENTS_CTE}
      SELECT
        domain,
        path,
        node_uuid,
        priority,
        disclosure,
        memory_id,
        uri,
        name,
        glossary_keywords,
        glossary_text,
        latest_content
      FROM normalized_documents
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY domain, path
    `,
    params,
  );

  return result.rows.map((row: NormalizedDocumentRow) => ({
    domain: row.domain,
    path: row.path,
    node_uuid: row.node_uuid,
    priority: row.priority || 0,
    disclosure: row.disclosure || '',
    memory_id: row.memory_id,
    uri: row.uri,
    name: row.name || 'root',
    glossary_keywords: Array.isArray(row.glossary_keywords) ? row.glossary_keywords : [],
    glossary_text: row.glossary_text || '',
    latest_content: row.latest_content || '',
  }));
}
