import type { ClientType } from '../../auth';
import { sql } from '../../db';
import { ROOT_NODE_UUID } from '../core/constants';
import {
  emptyLatestWriteMeta,
  emptyUpdaterSummaries,
  getLatestWriteMetaByNodeUuid,
  getUpdaterSummariesByNodeUuid,
  type UpdaterSummary,
} from './browseActivity';
import { pickBestPath, type PathEntry } from './browsePaths';

interface ChildRow {
  edge_id: number | string;
  child_uuid: string;
  priority: number;
  disclosure: string | null;
  content: string;
}

export interface ChildNode {
  node_uuid: string;
  edge_id: number;
  domain: string;
  path: string;
  uri: string;
  priority: number;
  disclosure: string | null;
  content_snippet: string;
  approx_children_count: number;
  last_updated_client_type: ClientType | null;
  last_updated_source: string | null;
  last_updated_at: string | null;
  updaters: UpdaterSummary[];
}

function toSnippet(content: unknown): string {
  const text = String(content || '');
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
}

function normalizeEdgeId(value: unknown): number | null {
  const edgeId = Number(value);
  if (!Number.isFinite(edgeId)) return null;
  return edgeId;
}

export async function getChildren({
  nodeUuid,
  contextDomain,
  contextPath,
}: {
  nodeUuid: string;
  contextDomain: string;
  contextPath: string;
}): Promise<ChildNode[]> {
  const childResult = await sql(
    `
      SELECT
        e.id AS edge_id,
        e.child_uuid,
        e.priority,
        e.disclosure,
        m.content
      FROM edges e
      JOIN LATERAL (
        SELECT content
        FROM memories
        WHERE node_uuid = e.child_uuid AND deprecated = FALSE
        ORDER BY created_at DESC
        LIMIT 1
      ) m ON TRUE
      WHERE e.parent_uuid = $1
      ORDER BY e.priority ASC, e.id ASC
    `,
    [nodeUuid],
  );

  const childRows: ChildRow[] = childResult.rows;
  if (childRows.length === 0) return [];

  const normalizedChildRows = childRows
    .map((row) => {
      const edgeId = normalizeEdgeId(row.edge_id);
      if (edgeId == null) return null;
      return {
        ...row,
        edge_id: edgeId,
      };
    })
    .filter((row): row is ChildRow & { edge_id: number } => row !== null);
  if (normalizedChildRows.length === 0) return [];

  const childUuids = [...new Set(normalizedChildRows.map((row) => row.child_uuid))];
  const edgeIds = [...new Set(normalizedChildRows.map((row) => row.edge_id))];
  const latestWriteMetaByNodeUuid = await getLatestWriteMetaByNodeUuid(childUuids);
  const updaterSummariesByNodeUuid = await getUpdaterSummariesByNodeUuid(childUuids);

  const countsResult = await sql(
    `
      SELECT parent_uuid, COUNT(id) AS child_count
      FROM edges
      WHERE parent_uuid = ANY($1::text[])
      GROUP BY parent_uuid
    `,
    [childUuids],
  );
  const childCountMap = new Map<string, number>(
    countsResult.rows.map((row) => [row.parent_uuid, Number(row.child_count || 0)]),
  );

  const pathResult = await sql(
    `
      SELECT edge_id, domain, path
      FROM paths
      WHERE edge_id = ANY($1::int[])
      ORDER BY domain ASC, path ASC
    `,
    [edgeIds],
  );

  const pathsByEdgeId = new Map<number, PathEntry[]>();
  for (const rawRow of pathResult.rows as Record<string, unknown>[]) {
    const edgeId = normalizeEdgeId(rawRow.edge_id);
    if (edgeId == null) continue;
    const list = pathsByEdgeId.get(edgeId) || [];
    list.push({ domain: String(rawRow.domain || ''), path: String(rawRow.path || '') });
    pathsByEdgeId.set(edgeId, list);
  }

  const prefix = contextPath ? `${contextPath}/` : null;
  const children: ChildNode[] = [];
  const seen = new Set<string>();

  for (const row of normalizedChildRows) {
    if (seen.has(row.child_uuid)) continue;
    seen.add(row.child_uuid);

    const allPaths = pathsByEdgeId.get(row.edge_id) || [];
    if (nodeUuid === ROOT_NODE_UUID && contextDomain) {
      const hasDomainPath = allPaths.some((item) => item.domain === contextDomain);
      if (!hasDomainPath) continue;
    }

    const pathObj = pickBestPath(allPaths, contextDomain, prefix);
    const latestWriteMeta = latestWriteMetaByNodeUuid.get(row.child_uuid) || emptyLatestWriteMeta();
    const updaters = updaterSummariesByNodeUuid.get(row.child_uuid) || emptyUpdaterSummaries();
    children.push({
      node_uuid: row.child_uuid,
      edge_id: row.edge_id,
      domain: pathObj?.domain || 'core',
      path: pathObj?.path || '',
      uri: pathObj ? `${pathObj.domain}://${pathObj.path}` : '',
      priority: row.priority,
      disclosure: row.disclosure,
      content_snippet: toSnippet(row.content),
      approx_children_count: childCountMap.get(row.child_uuid) || 0,
      ...latestWriteMeta,
      updaters,
    });
  }

  children.sort((a, b) => {
    const priorityA = Number.isFinite(a.priority) ? a.priority : 999;
    const priorityB = Number.isFinite(b.priority) ? b.priority : 999;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.path.localeCompare(b.path);
  });

  return children;
}
