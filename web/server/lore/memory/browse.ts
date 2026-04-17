import type { ClientType } from '../../auth';
import { sql } from '../../db';
import { listMemoryViewsByNode } from '../view/viewCrud';
import { ROOT_NODE_UUID } from '../core/constants';
import {
  emptyLatestWriteMeta,
  emptyUpdaterSummaries,
  getLatestWriteMetaByNodeUuid,
  getUpdaterSummariesByNodeUuid,
  type UpdaterSummary,
} from './browseActivity';
import { getChildren, type ChildNode } from './browseChildren';
import {
  getAliases,
  getGlossaryKeywords,
  getMemoryByPath,
  type MemoryRow,
} from './browseNodeData';
import { buildBreadcrumbs, pickBestPath, type Breadcrumb } from './browsePaths';

// Re-export for backward compatibility — other modules import ROOT_NODE_UUID from './browse'
export { ROOT_NODE_UUID };
export { buildBreadcrumbs, pickBestPath };
export type { Breadcrumb };
export type { UpdaterSummary };
export type { ChildNode };

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface DomainSummary {
  domain: string;
  root_count: number;
}

export type { MemoryRow };

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
  updaters: UpdaterSummary[];
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

  const [aliases, glossaryKeywords, children, memoryViews, latestWriteMetaByNodeUuid, updaterSummariesByNodeUuid] = await Promise.all([
    getAliases(memory.node_uuid, domain, path),
    navOnly ? Promise.resolve([]) : getGlossaryKeywords(memory.node_uuid),
    getChildren({ nodeUuid: memory.node_uuid, contextDomain: domain, contextPath: path }),
    navOnly || memory.node_uuid === ROOT_NODE_UUID
      ? Promise.resolve([])
      : listMemoryViewsByNode({ nodeUuid: memory.node_uuid, uri: `${domain}://${path}` }),
    getLatestWriteMetaByNodeUuid([memory.node_uuid]),
    getUpdaterSummariesByNodeUuid([memory.node_uuid]),
  ]);
  const latestWriteMeta = latestWriteMetaByNodeUuid.get(memory.node_uuid) || emptyLatestWriteMeta();
  const updaters = updaterSummariesByNodeUuid.get(memory.node_uuid) || emptyUpdaterSummaries();

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
      updaters,
    },
    children,
    breadcrumbs: buildBreadcrumbs(path),
  };
}
