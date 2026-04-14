import { normalizeClientType, type ClientType } from '../../auth';
import { sql } from '../../db';
import { listMemoryViewsByNode } from '../view/viewCrud';
import { ROOT_NODE_UUID } from '../core/constants';

// Re-export for backward compatibility — other modules import ROOT_NODE_UUID from './browse'
export { ROOT_NODE_UUID };

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PathEntry {
  domain: string;
  path: string;
}

interface MemoryRow {
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

interface ChildRow {
  edge_id: number;
  child_uuid: string;
  priority: number;
  disclosure: string | null;
  content: string;
}

interface LatestWriteMeta {
  last_updated_client_type: ClientType | null;
  last_updated_source: string | null;
  last_updated_at: string | null;
}

export interface DomainSummary {
  domain: string;
  root_count: number;
}

export interface Breadcrumb {
  path: string;
  label: string;
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
}

export interface NodeData {
  path: string;
  domain: string;
  uri: string;
  content: string;
  priority: number;
  disclosure: string | null;
  created_at: string | null;
  is_virtual: boolean;
  aliases: string[];
  node_uuid: string;
  glossary_keywords: string[];
  glossary_matches: string[];
  memory_views: unknown[];
  last_updated_client_type: ClientType | null;
  last_updated_source: string | null;
  last_updated_at: string | null;
}

export interface NodePayload {
  node: NodeData;
  children: ChildNode[];
  breadcrumbs: Breadcrumb[];
}

export interface GetNodePayloadOptions {
  domain?: string;
  path?: string;
  navOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSnippet(content: unknown): string {
  const text = String(content || '');
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
}

export function pickBestPath(
  paths: PathEntry[],
  contextDomain: string | null | undefined,
  prefix: string | null | undefined,
): PathEntry | null {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  if (paths.length === 1) return paths[0];

  if (contextDomain && prefix) {
    const tier1 = paths.find((item) => item.domain === contextDomain && item.path.startsWith(prefix));
    if (tier1) return tier1;
  }

  if (contextDomain) {
    const tier2 = paths.find((item) => item.domain === contextDomain);
    if (tier2) return tier2;
  }

  return paths[0];
}

export function buildBreadcrumbs(path: string | null | undefined): Breadcrumb[] {
  if (!path) return [{ path: '', label: 'root' }];
  const segments = path.split('/').filter(Boolean);
  const breadcrumbs: Breadcrumb[] = [{ path: '', label: 'root' }];
  let accumulated = '';
  for (const seg of segments) {
    accumulated = accumulated ? `${accumulated}/${seg}` : seg;
    breadcrumbs.push({ path: accumulated, label: seg });
  }
  return breadcrumbs;
}

function emptyLatestWriteMeta(): LatestWriteMeta {
  return {
    last_updated_client_type: null,
    last_updated_source: null,
    last_updated_at: null,
  };
}

function formatLatestWriteMeta(row?: Record<string, unknown> | null): LatestWriteMeta {
  if (!row) return emptyLatestWriteMeta();
  return {
    last_updated_client_type: normalizeClientType(row.client_type),
    last_updated_source: typeof row.source === 'string' && row.source.trim() ? row.source : null,
    last_updated_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

export async function listDomains(): Promise<DomainSummary[]> {
  const result = await sql(
    `
      SELECT p.domain, COUNT(DISTINCT p.path) AS root_count
      FROM paths p
      WHERE p.path NOT LIKE '%/%'
      GROUP BY p.domain
      ORDER BY p.domain ASC
    `,
  );

  return result.rows.map((row) => ({
    domain: row.domain,
    root_count: Number(row.root_count || 0),
  }));
}

async function getMemoryByPath(domain: string, path: string): Promise<MemoryRow | null> {
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

async function getAliases(nodeUuid: string, domain: string, path: string): Promise<string[]> {
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

async function getGlossaryKeywords(nodeUuid: string): Promise<string[]> {
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

async function getLatestWriteMetaByNodeUuid(nodeUuids: string[]): Promise<Map<string, LatestWriteMeta>> {
  const safeNodeUuids = [...new Set(
    (Array.isArray(nodeUuids) ? nodeUuids : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  if (safeNodeUuids.length === 0) return new Map();

  const result = await sql(
    `
      SELECT DISTINCT ON (node_uuid)
        node_uuid,
        source,
        details->>'client_type' AS client_type,
        created_at,
        id
      FROM memory_events
      WHERE node_uuid = ANY($1::text[])
      ORDER BY node_uuid ASC, created_at DESC, id DESC
    `,
    [safeNodeUuids],
  );

  const map = new Map<string, LatestWriteMeta>();
  for (const rawRow of result.rows as Record<string, unknown>[]) {
    const nodeUuid = String(rawRow.node_uuid || '').trim();
    if (!nodeUuid) continue;
    map.set(nodeUuid, formatLatestWriteMeta(rawRow));
  }
  return map;
}

async function getChildren(
  nodeUuid: string,
  contextDomain: string,
  contextPath: string,
): Promise<ChildNode[]> {
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

  const childUuids = [...new Set(childRows.map((row) => row.child_uuid))];
  const edgeIds = [...new Set(childRows.map((row) => row.edge_id))];
  const latestWriteMetaByNodeUuid = await getLatestWriteMetaByNodeUuid(childUuids);

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
  for (const row of pathResult.rows) {
    const list = pathsByEdgeId.get(row.edge_id) || [];
    list.push({ domain: row.domain, path: row.path });
    pathsByEdgeId.set(row.edge_id, list);
  }

  const prefix = contextPath ? `${contextPath}/` : null;
  const children: ChildNode[] = [];
  const seen = new Set<string>();

  for (const row of childRows) {
    if (seen.has(row.child_uuid)) continue;
    seen.add(row.child_uuid);

    const allPaths = pathsByEdgeId.get(row.edge_id) || [];
    if (nodeUuid === ROOT_NODE_UUID && contextDomain) {
      const hasDomainPath = allPaths.some((item) => item.domain === contextDomain);
      if (!hasDomainPath) continue;
    }

    const pathObj = pickBestPath(allPaths, contextDomain, prefix);
    const latestWriteMeta = latestWriteMetaByNodeUuid.get(row.child_uuid) || emptyLatestWriteMeta();
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

export async function getNodePayload({
  domain = 'core',
  path = '',
  navOnly = false,
}: GetNodePayloadOptions = {}): Promise<NodePayload> {
  const memory = await getMemoryByPath(domain, path);
  if (!memory) {
    const error = Object.assign(new Error(`Path not found: ${domain}://${path}`), { status: 404 });
    throw error;
  }

  const [aliases, glossaryKeywords, children, memoryViews, latestWriteMetaByNodeUuid] = await Promise.all([
    getAliases(memory.node_uuid, domain, path),
    navOnly ? Promise.resolve([]) : getGlossaryKeywords(memory.node_uuid),
    getChildren(memory.node_uuid, domain, path),
    navOnly || memory.node_uuid === ROOT_NODE_UUID
      ? Promise.resolve([])
      : listMemoryViewsByNode({ nodeUuid: memory.node_uuid, uri: `${domain}://${path}` }),
    getLatestWriteMetaByNodeUuid([memory.node_uuid]),
  ]);
  const latestWriteMeta = latestWriteMetaByNodeUuid.get(memory.node_uuid) || emptyLatestWriteMeta();

  return {
    node: {
      path,
      domain,
      uri: `${domain}://${path}`,
      content: memory.content,
      priority: memory.priority,
      disclosure: memory.disclosure,
      created_at: memory.created_at,
      is_virtual: memory.node_uuid === ROOT_NODE_UUID,
      aliases,
      node_uuid: memory.node_uuid,
      glossary_keywords: glossaryKeywords,
      glossary_matches: [],
      memory_views: memoryViews,
      ...latestWriteMeta,
    },
    children,
    breadcrumbs: buildBreadcrumbs(path),
  };
}
