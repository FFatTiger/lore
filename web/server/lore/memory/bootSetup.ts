import type { ClientType } from '../../auth';
import { sql } from '../../db';
import { parseUri } from '../core/utils';
import {
  getBootNodeSpec,
  getBootUris,
  type BootClientType,
  type BootNodeRole,
  type BootNodeSpec,
} from './boot';
import { createNode, updateNodeByPath } from './write';
import { resolveViewLlmConfig } from '../llm/config';
import { generateText, type ProviderMessage } from '../llm/provider';
import { extractJsonObject } from '../view/viewLlm';

interface EventContext {
  source?: string;
  session_id?: string | null;
  client_type?: ClientType | null;
}

interface ExistingBootNodeRow {
  node_uuid: string;
  priority: number | null;
  disclosure: string | null;
  content: string | null;
}

interface ExistingBootNodeState {
  uri: string;
  exists: boolean;
  node_uuid: string | null;
  priority: number | null;
  disclosure: string | null;
  content: string;
}

export type BootSaveStatus = 'created' | 'updated' | 'unchanged' | 'failed';
export type BootDraftStatus = 'generated' | 'failed';

export interface SaveBootNodesInput {
  nodes: Record<string, unknown>;
}

export interface SaveBootNodeResult {
  uri: string;
  status: BootSaveStatus;
  node_uuid: string | null;
  detail: string | null;
}

export interface SaveBootNodesResult {
  results: SaveBootNodeResult[];
}

export interface GenerateBootDraftsInput {
  uris?: unknown;
  shared_context?: unknown;
  node_context?: Record<string, unknown> | null;
}

export interface BootDraftResult {
  uri: string;
  status: BootDraftStatus;
  content: string | null;
  detail: string | null;
}

export interface GenerateBootDraftsResult {
  model: string;
  results: BootDraftResult[];
}

const ROLE_DRAFT_INSTRUCTIONS: Record<BootNodeRole, string[]> = {
  agent: [
    'Write the agent-facing working protocol for this Lore instance.',
    'Focus on collaboration rules, execution style, boundaries, and decision defaults.',
    'Prefer concise sections that can be saved directly as memory content.',
  ],
  soul: [
    'Write the agent persona baseline for this Lore instance.',
    'Focus on tone, style, self-definition, and how the agent should feel in conversation.',
    'Keep it grounded and reusable across future sessions.',
  ],
  user: [
    'Write the durable user profile for this Lore instance.',
    'Focus on stable user preferences, collaboration preferences, and important context about the user.',
    'Do not invent highly specific facts that are not supported by the provided context.',
  ],
};

const CLIENT_DRAFT_INSTRUCTIONS: Record<BootClientType, string[]> = {
  claudecode: [
    'Focus on Claude Code-specific runtime defaults, hooks, tool behavior, and coding workflow expectations.',
    'Describe what only applies inside Claude Code rather than repeating generic agent rules.',
  ],
  openclaw: [
    'Focus on OpenClaw-specific runtime defaults, plugin behavior, tool preferences, and operational constraints.',
    'Describe what only applies inside OpenClaw rather than repeating generic agent rules.',
  ],
  hermes: [
    'Focus on Hermes-specific memory-provider behavior, runtime conventions, and tool usage constraints.',
    'Describe what only applies inside Hermes rather than repeating generic agent rules.',
  ],
  codex: [
    'Focus on Codex-specific runtime defaults, plugin behavior, hooks, MCP usage, and coding workflow expectations.',
    'Describe what only applies inside Codex rather than repeating generic agent rules.',
  ],
};

function asStatusError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function requireBootSpec(uri: unknown) {
  const spec = getBootNodeSpec(uri);
  if (!spec) {
    throw asStatusError(`Unsupported boot URI: ${String(uri || '').trim() || '(empty)'}`, 422);
  }
  return spec;
}

function buildDraftInstructionList(spec: BootNodeSpec): string[] {
  const instructions = [...ROLE_DRAFT_INSTRUCTIONS[spec.role]];

  if (spec.scope === 'global' && spec.role === 'agent') {
    instructions.push('Keep this node strictly for agent-wide rules that apply across every supported runtime.');
    instructions.push('Do not duplicate host-specific constraints that belong under core://agent/<client_type>.');
  }

  if (spec.scope === 'client' && spec.client_type) {
    instructions.push(`This boot node is specific to the ${spec.client_type} runtime.`);
    instructions.push('Assume core://agent already contains the shared agent rules; focus only on the host-specific delta.');
    instructions.push(...CLIENT_DRAFT_INSTRUCTIONS[spec.client_type]);
  }

  return instructions;
}

function normalizeBootRecord(nodes: unknown): Array<{ uri: string; content: string }> {
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
    throw asStatusError('nodes must be an object that maps fixed boot URIs to content.', 422);
  }

  const normalized = new Map<string, string>();
  for (const [rawUri, rawContent] of Object.entries(nodes as Record<string, unknown>)) {
    const spec = requireBootSpec(rawUri);
    normalized.set(spec.uri, String(rawContent ?? ''));
  }

  if (normalized.size === 0) {
    throw asStatusError('At least one fixed boot node must be provided.', 422);
  }

  return getBootUris()
    .filter((uri) => normalized.has(uri))
    .map((uri) => ({ uri, content: normalized.get(uri) || '' }));
}

function normalizeBootUriList(uris: unknown): string[] {
  if (uris === undefined || uris === null) return getBootUris();
  if (!Array.isArray(uris)) {
    throw asStatusError('uris must be an array of fixed boot URIs.', 422);
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const rawUri of uris) {
    const spec = requireBootSpec(rawUri);
    if (!seen.has(spec.uri)) {
      seen.add(spec.uri);
      ordered.push(spec.uri);
    }
  }

  return ordered.length > 0 ? ordered : getBootUris();
}

function normalizeNodeContext(nodeContext: unknown): Record<string, string> {
  if (nodeContext === undefined || nodeContext === null) return {};
  if (typeof nodeContext !== 'object' || Array.isArray(nodeContext)) {
    throw asStatusError('node_context must be an object that maps fixed boot URIs to prompt text.', 422);
  }

  const out: Record<string, string> = {};
  for (const [rawUri, rawValue] of Object.entries(nodeContext as Record<string, unknown>)) {
    const spec = requireBootSpec(rawUri);
    out[spec.uri] = String(rawValue ?? '').trim();
  }
  return out;
}

async function getExistingBootNodeState(uri: string): Promise<ExistingBootNodeState> {
  const spec = requireBootSpec(uri);
  const { domain, path } = parseUri(spec.uri);
  const result = await sql(
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
  const row = result.rows[0] as ExistingBootNodeRow | undefined;
  if (!row) {
    return {
      uri: spec.uri,
      exists: false,
      node_uuid: null,
      priority: null,
      disclosure: null,
      content: '',
    };
  }

  return {
    uri: spec.uri,
    exists: true,
    node_uuid: row.node_uuid,
    priority: row.priority ?? 0,
    disclosure: row.disclosure,
    content: row.content || '',
  };
}

function buildDraftMessages(spec: BootNodeSpec, sharedContext: string, nodeContext: string): ProviderMessage[] {
  const instructions = buildDraftInstructionList(spec).join(' ');
  const payload = {
    id: spec.id,
    uri: spec.uri,
    role: spec.role,
    role_label: spec.role_label,
    purpose: spec.purpose,
    scope: spec.scope,
    client_type: spec.client_type,
    setup_title: spec.setup_title,
    setup_description: spec.setup_description,
    shared_context: sharedContext || '',
    node_context: nodeContext || '',
  };

  return [
    {
      role: 'system',
      content: [
        'You are generating a first-pass draft for a fixed Lore boot memory.',
        'Return strict JSON only with keys uri and content.',
        'The content must be directly saveable as the memory body.',
        'Do not include markdown fences or explanatory preambles.',
        'Use the dominant language of the provided context; if the context is sparse or mixed, default to Chinese.',
        'Be concrete and useful, but do not invent unsupported personal facts.',
        instructions,
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify(payload, null, 2),
    },
  ];
}

export async function saveBootNodes(
  { nodes }: SaveBootNodesInput,
  eventContext: EventContext = {},
): Promise<SaveBootNodesResult> {
  const entries = normalizeBootRecord(nodes);
  const results: SaveBootNodeResult[] = [];

  for (const entry of entries) {
    try {
      const spec = requireBootSpec(entry.uri);
      const current = await getExistingBootNodeState(spec.uri);
      const { domain, path } = parseUri(spec.uri);
      const segments = path.split('/').filter(Boolean);
      const title = segments[segments.length - 1] || path;
      const parentPath = segments.slice(0, -1).join('/');

      if (!current.exists) {
        const created = await createNode(
          {
            domain,
            parentPath,
            title,
            content: entry.content,
          },
          eventContext,
        );
        results.push({
          uri: spec.uri,
          status: 'created',
          node_uuid: created.node_uuid,
          detail: null,
        });
        continue;
      }

      if (current.content === entry.content) {
        results.push({
          uri: spec.uri,
          status: 'unchanged',
          node_uuid: current.node_uuid,
          detail: null,
        });
        continue;
      }

      const updated = await updateNodeByPath(
        {
          domain,
          path,
          content: entry.content,
        },
        eventContext,
      );
      results.push({
        uri: spec.uri,
        status: 'updated',
        node_uuid: updated.node_uuid,
        detail: null,
      });
    } catch (error) {
      results.push({
        uri: entry.uri,
        status: 'failed',
        node_uuid: null,
        detail: (error as Error)?.message || 'Failed to save boot node',
      });
    }
  }

  return { results };
}

export async function generateBootDrafts({
  uris,
  shared_context,
  node_context,
}: GenerateBootDraftsInput = {}): Promise<GenerateBootDraftsResult> {
  const requestedUris = normalizeBootUriList(uris);
  const normalizedNodeContext = normalizeNodeContext(node_context);
  const sharedContext = String(shared_context ?? '').trim();
  const config = await resolveViewLlmConfig();

  if (!config) {
    throw asStatusError('View LLM draft generation is unavailable. Configure View LLM in /settings first.', 409);
  }

  const results: BootDraftResult[] = [];
  for (const uri of requestedUris) {
    const spec = requireBootSpec(uri);
    try {
      const response = await generateText(
        config,
        buildDraftMessages(spec, sharedContext, normalizedNodeContext[spec.uri] || ''),
      );
      const parsed = extractJsonObject(response.content);
      const content = typeof parsed?.content === 'string' ? parsed.content.trim() : '';
      const returnedUri = typeof parsed?.uri === 'string' ? parsed.uri.trim() : '';

      if (!content) {
        throw new Error('Draft response did not include content.');
      }
      if (returnedUri && returnedUri !== spec.uri) {
        throw new Error(`Draft response URI mismatch: expected ${spec.uri}, got ${returnedUri}.`);
      }

      results.push({
        uri: spec.uri,
        status: 'generated',
        content,
        detail: null,
      });
    } catch (error) {
      results.push({
        uri: spec.uri,
        status: 'failed',
        content: null,
        detail: (error as Error)?.message || 'Failed to generate draft',
      });
    }
  }

  return {
    model: config.model,
    results,
  };
}
