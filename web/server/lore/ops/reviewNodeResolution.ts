import { sql } from '../../db';
import type { ChangesetRow } from './reviewRowHelpers';

export function resolveNodeUuidSync(
  row: ChangesetRow,
  allRows: ChangesetRow[],
  dbEdgeToNode: Record<number, string>,
): string | null {
  const table = row.table;
  const ref = row.before || row.after;
  if (!ref) return null;
  if (table === 'nodes') return (ref.uuid as string) || null;
  if (table === 'memories') return (ref.node_uuid as string) || null;
  if (table === 'glossary_keywords') return (ref.node_uuid as string) || null;
  if (table === 'edges') return (ref.child_uuid as string) || null;
  if (table === 'paths') {
    if (ref.node_uuid) return ref.node_uuid as string;
    const edgeId = ref.edge_id as number | undefined;
    if (edgeId != null) {
      for (const item of allRows) {
        if (item.table !== 'edges') continue;
        const edgeRef = item.before || item.after;
        if (edgeRef?.id === edgeId && edgeRef?.child_uuid) return edgeRef.child_uuid as string;
      }
      return dbEdgeToNode[edgeId] || null;
    }
  }
  return null;
}

export async function buildEdgeResolutionMap(allRows: ChangesetRow[]): Promise<Record<number, string>> {
  const edgeIds = new Set<number>();
  for (const row of allRows) {
    if (row.table !== 'paths') continue;
    const ref = row.before || row.after;
    if (ref?.edge_id != null) edgeIds.add(ref.edge_id as number);
  }
  if (!edgeIds.size) return {};
  const result = await sql(`SELECT id, child_uuid FROM edges WHERE id = ANY($1::int[])`, [[...edgeIds]]);
  return Object.fromEntries(result.rows.map((row: Record<string, unknown>) => [row.id, row.child_uuid]));
}

export async function findDisplayUri(
  nodeUuid: string,
  allRows: ChangesetRow[],
  dbEdgeToNode: Record<number, string>,
): Promise<string> {
  for (const row of allRows) {
    if (row.table !== 'paths') continue;
    if (resolveNodeUuidSync(row, allRows, dbEdgeToNode) !== nodeUuid) continue;
    const ref = row.before || row.after;
    if (ref) return `${ref.domain || 'core'}://${ref.path || ''}`;
  }

  const liveResult = await sql(
    `
      SELECT p.domain, p.path
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      WHERE e.child_uuid = $1
      ORDER BY p.domain, p.path
      LIMIT 1
    `,
    [nodeUuid],
  );
  const live = liveResult.rows[0] as { domain: string; path: string } | undefined;
  if (live) return `${live.domain}://${live.path}`;
  return `[unmapped]/${nodeUuid}`;
}
