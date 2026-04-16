import { sql } from '../../db';
import { parseUri } from '../core/utils';

export type BootNodeRole = 'agent' | 'soul' | 'user';

export interface BootNodeSpec {
  uri: string;
  role: BootNodeRole;
  role_label: string;
  purpose: string;
  dream_protection: 'protected';
}

interface CoreMemory {
  uri: string;
  content: string;
  priority: number;
  disclosure: string | null;
  node_uuid: string;
  boot_role: BootNodeRole;
  boot_role_label: string;
  boot_purpose: string;
}

interface RecentMemory {
  uri: string;
  priority: number;
  disclosure: string | null;
  created_at: string | null;
}

export interface BootViewResult {
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

export const FIXED_BOOT_NODES: readonly BootNodeSpec[] = [
  {
    uri: 'core://agent',
    role: 'agent',
    role_label: 'workflow constraints',
    purpose: 'Working rules, collaboration constraints, and execution protocol.',
    dream_protection: 'protected',
  },
  {
    uri: 'core://soul',
    role: 'soul',
    role_label: 'style / persona / self-definition',
    purpose: 'Agent style, persona, and self-cognition baseline.',
    dream_protection: 'protected',
  },
  {
    uri: 'preferences://user',
    role: 'user',
    role_label: 'stable user definition',
    purpose: 'Stable user information, user preferences, and durable collaboration context.',
    dream_protection: 'protected',
  },
] as const;

function normalizeUri(uri: unknown): string {
  const { domain, path } = parseUri(uri);
  return `${domain.toLowerCase()}://${path.toLowerCase()}`;
}

const FIXED_BOOT_NODE_MAP = new Map<string, BootNodeSpec>(
  FIXED_BOOT_NODES.map((node) => [normalizeUri(node.uri), node]),
);

export function getBootNodeSpecs(): BootNodeSpec[] {
  return [...FIXED_BOOT_NODES];
}

export function getBootUris(): string[] {
  return FIXED_BOOT_NODES.map((node) => node.uri);
}

export function getBootUriSet(): Set<string> {
  return new Set(getBootUris());
}

export function getBootNodeSpec(uri: unknown): BootNodeSpec | null {
  if (!String(uri || '').trim()) return null;
  return FIXED_BOOT_NODE_MAP.get(normalizeUri(uri)) || null;
}

export function isBootUri(uri: unknown): boolean {
  return getBootNodeSpec(uri) !== null;
}

export async function bootView(): Promise<BootViewResult> {
  const uris = getBootUris();
  const results: CoreMemory[] = [];
  const failed: string[] = [];

  for (const spec of FIXED_BOOT_NODES) {
    try {
      const { domain, path } = parseUri(spec.uri);
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
        failed.push(`- ${spec.uri}: not found`);
        continue;
      }
      results.push({
        uri: spec.uri,
        content: row.content || '',
        priority: row.priority || 0,
        disclosure: row.disclosure,
        node_uuid: row.node_uuid,
        boot_role: spec.role,
        boot_role_label: spec.role_label,
        boot_purpose: spec.purpose,
      });
    } catch (error) {
      failed.push(`- ${spec.uri}: ${(error as Error).message}`);
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
