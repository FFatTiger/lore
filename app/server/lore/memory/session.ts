import { sql } from '../../db';
import { ROOT_NODE_UUID } from '../core/constants';
import { parseUri } from '../core/utils';

interface SessionReadNode {
  session_id: string;
  uri: string;
  node_uuid: string;
  session_key: string | null;
  source: string;
  read_count: number;
  first_read_at: string;
  last_read_at: string;
}

interface MarkSessionReadParams {
  session_id: string;
  uri: string;
  node_uuid?: string | null;
  session_key?: string | null;
  source?: string;
}

async function getNodeUuidByPath(domain: string, path: string): Promise<string | null> {
  if (!path) return ROOT_NODE_UUID;
  const result = await sql(
    `
      SELECT e.child_uuid AS node_uuid
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      WHERE p.domain = $1 AND p.path = $2
      LIMIT 1
    `,
    [domain, path],
  );
  return (result.rows[0] as { node_uuid: string } | undefined)?.node_uuid || null;
}

export async function markSessionRead({
  session_id,
  uri,
  node_uuid,
  session_key = null,
  source = 'tool:get_node',
}: MarkSessionReadParams): Promise<SessionReadNode> {
  let resolvedNodeUuid = node_uuid;
  if (!resolvedNodeUuid) {
    const parsed = parseUri(uri);
    resolvedNodeUuid = await getNodeUuidByPath(parsed.domain, parsed.path);
  }
  if (!resolvedNodeUuid) {
    const error = Object.assign(new Error(`Memory at '${uri}' not found.`), { status: 404 });
    throw error;
  }

  const result = await sql(
    `
      INSERT INTO session_read_nodes (session_id, uri, node_uuid, session_key, source, read_count, first_read_at, last_read_at)
      VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW())
      ON CONFLICT (session_id, uri)
      DO UPDATE SET
        node_uuid = EXCLUDED.node_uuid,
        session_key = EXCLUDED.session_key,
        source = EXCLUDED.source,
        read_count = session_read_nodes.read_count + 1,
        last_read_at = NOW()
      RETURNING session_id, uri, node_uuid, session_key, source, read_count, first_read_at, last_read_at
    `,
    [session_id, uri, resolvedNodeUuid, session_key, source],
  );
  return result.rows[0] as SessionReadNode;
}

export async function listSessionReads(sessionId: string): Promise<SessionReadNode[]> {
  const result = await sql(
    `
      SELECT session_id, uri, node_uuid, session_key, source, read_count, first_read_at, last_read_at
      FROM session_read_nodes
      WHERE session_id = $1
      ORDER BY last_read_at DESC
    `,
    [sessionId],
  );
  return result.rows as SessionReadNode[];
}

export async function clearSessionReads(
  sessionId: string,
): Promise<{ success: boolean; session_id: string; cleared: number | null }> {
  const result = await sql(`DELETE FROM session_read_nodes WHERE session_id = $1`, [sessionId]);
  return { success: true, session_id: sessionId, cleared: result.rowCount };
}
