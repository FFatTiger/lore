import type { ClientType } from '../../auth';
import { sql } from '../../db';
import { parseUri } from '../core/utils';
import { getSettings } from '../config/settings';
import { resolveViewLlmConfig } from '../llm/config';

export type BootNodeRole = 'agent' | 'soul' | 'user';
export type BootNodeState = 'missing' | 'empty' | 'initialized';
export type BootOverallState = 'uninitialized' | 'partial' | 'complete';
export type BootNodeScope = 'global' | 'client';
export type BootClientType = Extract<ClientType, 'claudecode' | 'openclaw' | 'hermes' | 'codex'>;

export interface BootNodeSpec {
  id: string;
  uri: string;
  role: BootNodeRole;
  role_label: string;
  purpose: string;
  dream_protection: 'protected';
  scope: BootNodeScope;
  client_type: BootClientType | null;
  setup_slug: string;
  setup_title: string;
  setup_description: string;
}

export interface BootStatusNode extends BootNodeSpec {
  state: BootNodeState;
  content: string;
  content_length: number;
  priority: number | null;
  disclosure: string | null;
  node_uuid: string | null;
}

interface CoreMemory extends BootNodeSpec {
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

export interface BootDraftGenerationStatus {
  available: boolean;
  reason: string | null;
  model: string | null;
}

export interface BootViewOptions {
  client_type?: ClientType | null;
  include_all_clients?: boolean;
}

export interface BootViewResult {
  loaded: number;
  total: number;
  failed: string[];
  core_memories: CoreMemory[];
  recent_memories: RecentMemory[];
  nodes: BootStatusNode[];
  overall_state: BootOverallState;
  remaining_count: number;
  draft_generation_available: boolean;
  draft_generation_reason: string | null;
  selected_client_type: ClientType | null;
  includes_all_clients: boolean;
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

const GLOBAL_BOOT_NODES: readonly BootNodeSpec[] = [
  {
    id: 'agent',
    uri: 'core://agent',
    role: 'agent',
    role_label: 'workflow constraints',
    purpose: 'Working rules, collaboration constraints, and execution protocol.',
    dream_protection: 'protected',
    scope: 'global',
    client_type: null,
    setup_slug: 'agent',
    setup_title: 'Agent boot memory',
    setup_description: 'Write the fixed workflow-constraints node that every Lore agent loads at startup.',
  },
  {
    id: 'soul',
    uri: 'core://soul',
    role: 'soul',
    role_label: 'style / persona / self-definition',
    purpose: 'Agent style, persona, and self-cognition baseline.',
    dream_protection: 'protected',
    scope: 'global',
    client_type: null,
    setup_slug: 'soul',
    setup_title: 'Soul boot memory',
    setup_description: 'Write the fixed persona baseline that Lore carries into every session.',
  },
  {
    id: 'user',
    uri: 'preferences://user',
    role: 'user',
    role_label: 'stable user definition',
    purpose: 'Stable user information, user preferences, and durable collaboration context.',
    dream_protection: 'protected',
    scope: 'global',
    client_type: null,
    setup_slug: 'user',
    setup_title: 'User boot memory',
    setup_description: 'Write the stable user profile Lore should remember across future sessions.',
  },
] as const;

const CLIENT_BOOT_NODES: readonly BootNodeSpec[] = [
  {
    id: 'agent-claudecode',
    uri: 'core://agent/claudecode',
    role: 'agent',
    role_label: 'claude code runtime constraints',
    purpose: 'Claude Code-specific tools, session hooks, and runtime workflow constraints.',
    dream_protection: 'protected',
    scope: 'client',
    client_type: 'claudecode',
    setup_slug: 'agent-claudecode',
    setup_title: 'Claude Code boot memory',
    setup_description: 'Write the Claude Code-specific agent rules that load together with core://agent.',
  },
  {
    id: 'agent-openclaw',
    uri: 'core://agent/openclaw',
    role: 'agent',
    role_label: 'openclaw runtime constraints',
    purpose: 'OpenClaw-specific tools, plugin behavior, and runtime workflow constraints.',
    dream_protection: 'protected',
    scope: 'client',
    client_type: 'openclaw',
    setup_slug: 'agent-openclaw',
    setup_title: 'OpenClaw boot memory',
    setup_description: 'Write the OpenClaw-specific agent rules that load together with core://agent.',
  },
  {
    id: 'agent-hermes',
    uri: 'core://agent/hermes',
    role: 'agent',
    role_label: 'hermes runtime constraints',
    purpose: 'Hermes-specific memory-provider behavior, tools, and runtime workflow constraints.',
    dream_protection: 'protected',
    scope: 'client',
    client_type: 'hermes',
    setup_slug: 'agent-hermes',
    setup_title: 'Hermes boot memory',
    setup_description: 'Write the Hermes-specific agent rules that load together with core://agent.',
  },
  {
    id: 'agent-codex',
    uri: 'core://agent/codex',
    role: 'agent',
    role_label: 'codex runtime constraints',
    purpose: 'Codex-specific plugins, hooks, MCP behavior, and runtime workflow constraints.',
    dream_protection: 'protected',
    scope: 'client',
    client_type: 'codex',
    setup_slug: 'agent-codex',
    setup_title: 'Codex boot memory',
    setup_description: 'Write the Codex-specific agent rules that load together with core://agent.',
  },
] as const;

export const FIXED_BOOT_NODES: readonly BootNodeSpec[] = [
  ...GLOBAL_BOOT_NODES,
  ...CLIENT_BOOT_NODES,
] as const;

const CLIENT_BOOT_NODE_MAP = new Map<BootClientType, BootNodeSpec>(
  CLIENT_BOOT_NODES.map((node) => [node.client_type as BootClientType, node]),
);

function normalizeUri(uri: unknown): string {
  const { domain, path } = parseUri(uri);
  return `${domain.toLowerCase()}://${path.toLowerCase()}`;
}

function getContentState(content: string): { state: BootNodeState; content_length: number } {
  const normalized = String(content || '');
  const trimmed = normalized.trim();
  return {
    state: trimmed ? 'initialized' : 'empty',
    content_length: trimmed.length,
  };
}

function deriveOverallState(nodes: BootStatusNode[]): BootOverallState {
  const initializedCount = nodes.filter((node) => node.state === 'initialized').length;
  if (initializedCount === nodes.length) return 'complete';
  if (initializedCount === 0) return 'uninitialized';
  return 'partial';
}

function isRuntimeBootClientType(value: ClientType | null | undefined): value is BootClientType {
  return value === 'claudecode' || value === 'openclaw' || value === 'hermes' || value === 'codex';
}

function shouldIncludeAllClientBootNodes(options: BootViewOptions): boolean {
  return options.include_all_clients === true || options.client_type === 'admin';
}

const FIXED_BOOT_NODE_MAP = new Map<string, BootNodeSpec>(
  FIXED_BOOT_NODES.map((node) => [normalizeUri(node.uri), node]),
);

export function getBootNodeSpecs(): BootNodeSpec[] {
  return [...FIXED_BOOT_NODES];
}

export function getRuntimeBootNodeSpecs(clientType?: ClientType | null): BootNodeSpec[] {
  const specs = [...GLOBAL_BOOT_NODES];
  const normalizedClientType = clientType ?? null;
  if (!isRuntimeBootClientType(normalizedClientType)) return specs;

  const clientSpec = CLIENT_BOOT_NODE_MAP.get(normalizedClientType);
  if (clientSpec) specs.push(clientSpec);
  return specs;
}

export function getBootUris(): string[] {
  return FIXED_BOOT_NODES.map((node) => node.uri);
}

export function getRuntimeBootUris(clientType?: ClientType | null): string[] {
  return getRuntimeBootNodeSpecs(clientType).map((node) => node.uri);
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

export async function getBootDraftGenerationStatus(): Promise<BootDraftGenerationStatus> {
  const resolved = await resolveViewLlmConfig();
  if (resolved) {
    return {
      available: true,
      reason: null,
      model: resolved.model,
    };
  }

  const settings = await getSettings(['view_llm.base_url', 'view_llm.api_key', 'view_llm.model']);
  const baseUrl = String(settings['view_llm.base_url'] || '').trim();
  const apiKey = String(settings['view_llm.api_key'] || '').trim();
  const model = String(settings['view_llm.model'] || '').trim();

  if (!baseUrl) {
    return {
      available: false,
      reason: 'View LLM base URL is not configured.',
      model: model || null,
    };
  }

  if (!apiKey) {
    return {
      available: false,
      reason: 'View LLM API key is not configured.',
      model: model || null,
    };
  }

  if (!model) {
    return {
      available: false,
      reason: 'View LLM model is not configured.',
      model: null,
    };
  }

  return {
    available: false,
    reason: 'View LLM is unavailable.',
    model,
  };
}

export async function bootView(options: BootViewOptions = {}): Promise<BootViewResult> {
  const includesAllClients = shouldIncludeAllClientBootNodes(options);
  const selectedNodes = includesAllClients
    ? getBootNodeSpecs()
    : getRuntimeBootNodeSpecs(options.client_type ?? null);
  const results: CoreMemory[] = [];
  const failed: string[] = [];
  const nodes: BootStatusNode[] = [];

  for (const spec of selectedNodes) {
    try {
      const { domain, path } = parseUri(spec.uri);
      const memoryResult = await sql(
        `
          SELECT e.child_uuid AS node_uuid, e.priority, e.disclosure, m.content
          FROM paths p
          JOIN edges e ON p.edge_id = e.id
          LEFT JOIN LATERAL (
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
        nodes.push({
          ...spec,
          state: 'missing',
          content: '',
          content_length: 0,
          priority: null,
          disclosure: null,
          node_uuid: null,
        });
        continue;
      }

      const content = row.content || '';
      const { state, content_length } = getContentState(content);
      nodes.push({
        ...spec,
        state,
        content,
        content_length,
        priority: row.priority ?? 0,
        disclosure: row.disclosure,
        node_uuid: row.node_uuid,
      });
      results.push({
        ...spec,
        uri: spec.uri,
        content,
        priority: row.priority || 0,
        disclosure: row.disclosure,
        node_uuid: row.node_uuid,
        boot_role: spec.role,
        boot_role_label: spec.role_label,
        boot_purpose: spec.purpose,
      });
    } catch (error) {
      failed.push(`- ${spec.uri}: ${(error as Error).message}`);
      nodes.push({
        ...spec,
        state: 'missing',
        content: '',
        content_length: 0,
        priority: null,
        disclosure: null,
        node_uuid: null,
      });
    }
  }

  const draftStatus = await getBootDraftGenerationStatus();
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
  const overall_state = deriveOverallState(nodes);
  const remaining_count = nodes.filter((node) => node.state !== 'initialized').length;

  return {
    loaded: results.length,
    total: selectedNodes.length,
    failed,
    core_memories: results,
    recent_memories: (recentResult.rows as RecentMemoryRow[]).map((row) => ({
      uri: `${row.domain}://${row.path}`,
      priority: row.priority || 0,
      disclosure: row.disclosure,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    })),
    nodes,
    overall_state,
    remaining_count,
    draft_generation_available: draftStatus.available,
    draft_generation_reason: draftStatus.reason,
    selected_client_type: options.client_type ?? null,
    includes_all_clients: includesAllClients,
  };
}
