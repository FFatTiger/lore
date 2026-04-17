import { sql } from '../../db';
import type { ChangesetRow } from './reviewRowHelpers';

interface ReviewNodeMeta {
  priority: number | null;
  disclosure: string | null;
}

export async function extractContentAndMeta(
  rows: ChangesetRow[],
  slot: 'before' | 'after',
  nodeUuid: string,
): Promise<{ content: string | null; meta: ReviewNodeMeta }> {
  let memoryId: number | null = null;
  const meta = { priority: null as number | null, disclosure: null as string | null };

  for (const row of rows) {
    const data = row[slot] as Record<string, unknown> | null;
    if (!data) continue;
    if (row.table === 'memories' && !data.deprecated) memoryId = data.id as number;
    if (row.table === 'edges') {
      meta.priority = (data.priority as number) ?? null;
      meta.disclosure = (data.disclosure as string) ?? null;
    }
  }

  let content: string | null = null;
  if (memoryId != null) {
    const result = await sql(`SELECT content FROM memories WHERE id = $1 LIMIT 1`, [memoryId]);
    content = (result.rows[0]?.content as string) ?? null;
  } else {
    const shouldFetchActive = slot === 'after' || rows.every((row) => row.table !== 'memories');
    if (shouldFetchActive) {
      const result = await sql(
        `
          SELECT content
          FROM memories
          WHERE node_uuid = $1 AND deprecated = FALSE
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [nodeUuid],
      );
      content = (result.rows[0]?.content as string) ?? null;
    }
  }

  if (meta.priority == null && meta.disclosure == null) {
    const edgeResult = await sql(
      `SELECT priority, disclosure FROM edges WHERE child_uuid = $1 ORDER BY id LIMIT 1`,
      [nodeUuid],
    );
    if (edgeResult.rows[0]) {
      meta.priority = edgeResult.rows[0].priority as number;
      meta.disclosure = edgeResult.rows[0].disclosure as string;
    }
  }

  return { content, meta };
}

export async function listActivePaths(nodeUuid: string): Promise<string[]> {
  const activePathsResult = await sql(
    `
      SELECT p.domain, p.path
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      WHERE e.child_uuid = $1
      ORDER BY p.domain, p.path
    `,
    [nodeUuid],
  );
  return activePathsResult.rows.map((row: Record<string, unknown>) => `${row.domain}://${row.path}`);
}
