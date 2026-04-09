import { sql } from '../../db';
import { parseUri } from '../core/utils';

interface CoreMemory {
  uri: string;
  content: string;
  priority: number;
  disclosure: string | null;
  node_uuid: string;
}

interface RecentMemory {
  uri: string;
  priority: number;
  disclosure: string | null;
  created_at: string | null;
}

interface BootViewResult {
  loaded: number;
  total: number;
  failed: string[];
  core_memories: CoreMemory[];
  recent_memories: RecentMemory[];
}

interface CoreMemoryRow {
  node_uuid: string;
  priority: number | null;
  disclosure: string | null;
  content: string | null;
}

interface RecentMemoryRow {
  domain: string;
  path: string;
  priority: number | null;
  disclosure: string | null;
  created_at: Date | string | null;
}

export async function bootView(coreMemoryUris?: string | null): Promise<BootViewResult> {
  const uris = String(coreMemoryUris || process.env.CORE_MEMORY_URIS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const results: CoreMemory[] = [];
  const failed: string[] = [];

  for (const uri of uris) {
    try {
      const { domain, path } = parseUri(uri);
      const memoryResult = await sql(
        `
          SELECT e.child_uuid AS node_uuid, e.priority, e.disclosure, m.content
          FROM paths p
          JOIN edges e ON p.edge_id = e.id
          JOIN LATERAL (
            SELECT content
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
      const row = memoryResult.rows[0] as CoreMemoryRow | undefined;
      if (!row) {
        failed.push(`- ${uri}: not found`);
        continue;
      }
      results.push({
        uri: `${domain}://${path}`,
        content: row.content || '',
        priority: row.priority || 0,
        disclosure: row.disclosure,
        node_uuid: row.node_uuid,
      });
    } catch (error) {
      failed.push(`- ${uri}: ${(error as Error).message}`);
    }
  }

  const recentResult = await sql(
    `
      SELECT p.domain, p.path, e.priority, e.disclosure, MAX(m.created_at) AS created_at
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      JOIN memories m ON m.node_uuid = e.child_uuid
      WHERE m.deprecated = FALSE
      GROUP BY p.domain, p.path, e.priority, e.disclosure
      ORDER BY created_at DESC NULLS LAST
      LIMIT 5
    `,
  );

  return {
    loaded: results.length,
    total: uris.length,
    failed,
    core_memories: results,
    recent_memories: (recentResult.rows as RecentMemoryRow[]).map((row) => ({
      uri: `${row.domain}://${row.path}`,
      priority: row.priority || 0,
      disclosure: row.disclosure,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    })),
  };
}
