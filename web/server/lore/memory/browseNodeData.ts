import { sql } from '../../db';
import { ROOT_NODE_UUID } from '../core/constants';

export interface MemoryRow {
  id: number;
  node_uuid: string;
  content: string;
  priority: number;
  disclosure: string | null;
  deprecated: boolean;
  created_at: string | null;
  domain: string;
  path: string;
  alias_count: number;
}

export async function getMemoryByPath(domain: string, path: string): Promise<MemoryRow | null> {
  if (!path) {
    return {
      id: 0,
      node_uuid: ROOT_NODE_UUID,
      content: '',
      priority: 0,
      disclosure: null,
      deprecated: false,
      created_at: null,
      domain,
      path: '',
      alias_count: 0,
    };
  }

  const result = await sql(
    `
      SELECT
        p.domain,
        p.path,
        e.child_uuid AS node_uuid,
        e.priority,
        e.disclosure,
        m.id,
        m.content,
        m.deprecated,
        m.created_at
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      JOIN LATERAL (
        SELECT id, content, deprecated, created_at
        FROM memories
        WHERE node_uuid = e.child_uuid AND deprecated = FALSE
        ORDER BY created_at DESC
        LIMIT 1
      ) m ON TRUE
      WHERE p.domain = $1 AND p.path = $2
      LIMIT 1
    `,
    [domain, path],
  );

  const row = result.rows[0];
  if (!row) return null;

  const aliasResult = await sql(
    `
      SELECT COUNT(*) AS total_paths
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      WHERE e.child_uuid = $1
    `,
    [row.node_uuid],
  );

  return {
    id: row.id,
    node_uuid: row.node_uuid,
    content: row.content,
    priority: row.priority,
    disclosure: row.disclosure,
    deprecated: row.deprecated,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    domain: row.domain,
    path: row.path,
    alias_count: Math.max(0, Number(aliasResult.rows[0]?.total_paths || 0) - 1),
  };
}

export async function getAliases(nodeUuid: string, domain: string, path: string): Promise<string[]> {
  if (!nodeUuid || nodeUuid === ROOT_NODE_UUID) return [];
  const result = await sql(
    `
      SELECT p.domain, p.path
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      WHERE e.child_uuid = $1
      ORDER BY p.domain, p.path
    `,
    [nodeUuid],
  );

  return result.rows
    .filter((row) => !(row.domain === domain && row.path === path))
    .map((row) => `${row.domain}://${row.path}`);
}

export async function getGlossaryKeywords(nodeUuid: string): Promise<string[]> {
  if (!nodeUuid || nodeUuid === ROOT_NODE_UUID) return [];
  const result = await sql(
    `
      SELECT keyword
      FROM glossary_keywords
      WHERE node_uuid = $1
      ORDER BY keyword ASC
    `,
    [nodeUuid],
  );
  return result.rows.map((row) => row.keyword);
}
