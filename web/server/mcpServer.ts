/**
 * Embedded MCP server for Lore.
 *
 * Registers the same 12 tools as the standalone lore-mcp package,
 * but calls internal server functions directly instead of going through HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ClientType } from './auth';
import { sql } from './db';
import { bootView } from './lore/memory/boot';
import { getNodePayload, listDomains } from './lore/memory/browse';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from './lore/memory/write';
import { searchMemories } from './lore/search/search';
import { markRecallEventsUsedInAnswer } from './lore/recall/recallEventLog';
import { validateCreatePolicy, validateUpdatePolicy, validateDeletePolicy } from './lore/ops/policy';
import { loadLifecycleTextConfig } from './lore/lifecycle/config';

import {
  ok,
  fail,
  formatPolicyResult,
  trimSlashes,
  normalizeKeywordList,
  resolveUri,
  formatNode,
  formatBootView,
} from './mcpFormatters';

// ── server factory ────────────────────────────────────────────────

interface McpServerContext {
  clientType?: ClientType | null;
}

export interface LoreToolParameterContract {
  name: string;
  description: string;
  required: boolean;
}

export interface LoreToolContract {
  name: string;
  description: string;
  parameters: LoreToolParameterContract[];
}

type LoreToolContractSource = {
  name: string;
  description: string;
  parameters: Record<string, { description: string; required: boolean }>;
};

const loreToolContractSources: readonly LoreToolContractSource[] = [
  {
    name: 'lore_guidance',
    description: 'Load the full Lore usage rules. Call this if your context does not already contain detailed usage guidance.',
    parameters: {},
  },
  {
    name: 'lore_status',
    description: 'Check memory backend availability and connection health.',
    parameters: {},
  },
  {
    name: 'lore_boot',
    description: 'Load the fixed boot memory view that restores the deterministic startup baseline and core operating context.',
    parameters: {},
  },
  {
    name: 'lore_get_node',
    description: 'Open a memory node. REQUIRED when opening a URI from a <recall>: copy the exact session_id and query_id from that <recall> tag.',
    parameters: {
      uri: { description: 'Full memory URI for the node you want to open, such as core://soul. Use core:// or project:// to browse a domain root; bare words are paths in the default domain.', required: true },
      nav_only: { description: 'If true, skip expensive glossary processing.', required: false },
      session_id: { description: 'REQUIRED when the URI came from <recall>: copy the exact session_id from that <recall> tag.', required: false },
      query_id: { description: 'REQUIRED when the URI came from <recall>: copy the exact query_id from that <recall> tag.', required: false },
    },
  },
  {
    name: 'lore_search',
    description: 'Search memories by keyword, semantic similarity, or both. Returns full content for top results — use this when you need to read memory content directly without a separate get_node call.',
    parameters: {
      query: { description: 'Search query text. Not a wildcard — use a meaningful keyword or phrase. Passing an empty string or * with a domain filter browses that domain root.', required: true },
      domain: { description: 'Optional domain filter to narrow the search.', required: false },
      limit: { description: 'Maximum number of results.', required: false },
      content_limit: { description: 'How many top results include full content (default 5).', required: false },
    },
  },
  {
    name: 'lore_list_domains',
    description: 'Browse the top-level memory domains available in the memory system.',
    parameters: {},
  },
  {
    name: 'lore_create_node',
    description: 'Create a new long-term memory concept in the Lore living semantic tree. A URI path names the concept identity with durable snake_case segments; event time belongs in the node narrative or in explicit archive, diary, release, or incident concepts. For multi-segment paths, first make the parent abstraction real with content, disclosure, and glossary, then place the child under that conceptual home. Prefer update or merge when an existing concept already owns the fact.',
    parameters: {
      content: { description: 'Memory text body.', required: true },
      priority: { description: 'Importance tier (0=core identity, 1=key facts, 2+=general).', required: true },
      glossary: { description: 'Initial glossary keywords written with this node create event.', required: true },
      uri: { description: 'Optional final memory URI. It names a durable concept identity; event time belongs in content or in explicit archive, diary, release, or incident concepts. Intermediate paths grow from real parent abstractions with content.', required: false },
      domain: { description: 'Target memory domain when not using uri.', required: false },
      parent_path: { description: 'Parent concept path inside the chosen domain; for multi-segment paths this parent abstraction explains why the children belong together and carries content, disclosure, and glossary.', required: false },
      title: { description: 'Final concept segment for the new memory; name the reusable idea, module, decision, preference, or archive concept.', required: false },
      disclosure: { description: 'When this memory should be recalled.', required: false },
    },
  },
  {
    name: 'lore_update_node',
    description: 'Revise an existing long-term memory node. Omitted content, metadata, and glossary mutation fields are left unchanged.',
    parameters: {
      uri: { description: 'Full memory URI for the node you want to revise.', required: true },
      content: { description: 'New content to replace the existing content; omit to leave content unchanged.', required: false },
      priority: { description: 'New priority level; omit to leave priority unchanged.', required: false },
      disclosure: { description: 'New disclosure / trigger condition; omit to leave disclosure unchanged.', required: false },
      glossary_add: { description: 'Keywords to add as part of this same node update event.', required: false },
      glossary_remove: { description: 'Keywords to remove as part of this same node update event.', required: false },
    },
  },
  {
    name: 'lore_delete_node',
    description: 'Remove a memory path that is obsolete, duplicated, or no longer wanted.',
    parameters: {
      uri: { description: 'Full memory URI for the path you want to remove.', required: true },
    },
  },
  {
    name: 'lore_move_node',
    description: 'Move or rename a memory concept inside the semantic memory tree. The target parent represents the conceptual home; it must already be a real parent abstraction with memory content so the move can reparent the node and its subtree into that abstraction.',
    parameters: {
      old_uri: { description: 'Current memory URI to move from.', required: true },
      new_uri: { description: 'New memory URI. For multi-segment paths, the target parent is the parent abstraction that becomes the node conceptual home.', required: true },
    },
  },
];

function loreToolContractSource(name: string): LoreToolContractSource {
  const contract = loreToolContractSources.find((item) => item.name === name);
  if (!contract) throw new Error(`Missing Lore tool contract: ${name}`);
  return contract;
}

function loreToolParameterDescription(toolName: string, parameterName: string): string {
  const parameter = loreToolContractSource(toolName).parameters[parameterName];
  if (!parameter) throw new Error(`Missing Lore tool parameter contract: ${toolName}.${parameterName}`);
  return parameter.description;
}

export function getLoreToolContracts(): LoreToolContract[] {
  return loreToolContractSources.map((contract) => ({
    name: contract.name,
    description: contract.description,
    parameters: Object.entries(contract.parameters).map(([name, parameter]) => ({
      name,
      description: parameter.description,
      required: parameter.required,
    })),
  }));
}

export async function createMcpServer(context: McpServerContext = {}): Promise<InstanceType<typeof McpServer>> {
  const guidance = await loadLifecycleTextConfig().then((config) => config.guidance).catch(() => '');
  const server = new McpServer(
    {
      name: 'lore',
      version: '1.3.22-pre.3',
    },
    guidance ? { instructions: guidance } : undefined,
  );

  const defaultDomain = process.env.LORE_DEFAULT_DOMAIN || 'core';

  // ── lore_guidance ─────────────────────────────────────────────
  server.tool(
    'lore_guidance',
    loreToolContractSource('lore_guidance').description,
    {},
    async () => {
      const text = (await loadLifecycleTextConfig()).guidance;
      return text ? ok(text) : fail('Guidance', new Error('not configured'));
    },
  );

  // ── lore_status ──────────────────────────────────────────────
  server.tool(
    'lore_status',
    loreToolContractSource('lore_status').description,
    {},
    async () => {
      try {
        await sql('SELECT 1');
        return ok('Lore online\n\n{"status":"ok","database":"connected"}');
      } catch (error) {
        return fail('Lore offline', error);
      }
    },
  );

  // ── lore_boot ────────────────────────────────────────────────
  server.tool(
    'lore_boot',
    loreToolContractSource('lore_boot').description,
    {},
    async () => {
      try {
        const data = await bootView({ client_type: context.clientType ?? null });
        return ok(formatBootView(data));
      } catch (error) {
        return fail('Lore boot failed', error);
      }
    },
  );

  // ── lore_get_node ────────────────────────────────────────────
  server.tool(
    'lore_get_node',
    loreToolContractSource('lore_get_node').description,
    {
      uri: z.string().describe(loreToolParameterDescription('lore_get_node', 'uri')),
      nav_only: z.boolean().optional().describe(loreToolParameterDescription('lore_get_node', 'nav_only')),
      session_id: z.string().optional().describe(loreToolParameterDescription('lore_get_node', 'session_id')),
      query_id: z.string().optional().describe(loreToolParameterDescription('lore_get_node', 'query_id')),
    },
    async (args) => {
      try {
        const { domain, path } = resolveUri(args, defaultDomain);
        const data = await getNodePayload({ domain, path, navOnly: args?.nav_only === true });

        const node = data?.node || {};
        const sid = typeof args?.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : 'mcp-embedded';
        const qid = typeof args?.query_id === 'string' ? args.query_id.trim() : '';
        if (node.uri && qid) {
          try {
            await markRecallEventsUsedInAnswer({
              queryId: qid,
              sessionId: sid,
              nodeUris: [node.uri],
              source: 'mcp:lore_get_node',
              success: true,
              clientType: context.clientType ?? null,
            });
          } catch { /* best effort */ }
        }

        return ok(formatNode(data));
      } catch (error) {
        return fail('Lore get node failed', error);
      }
    },
  );

  // ── lore_search ──────────────────────────────────────────────
  server.tool(
    'lore_search',
    loreToolContractSource('lore_search').description,
    {
      query: z.string().describe(loreToolParameterDescription('lore_search', 'query')),
      domain: z.string().optional().describe(loreToolParameterDescription('lore_search', 'domain')),
      limit: z.number().int().min(1).max(100).optional().describe(loreToolParameterDescription('lore_search', 'limit')),
      content_limit: z.number().int().min(0).max(20).optional().describe(loreToolParameterDescription('lore_search', 'content_limit')),
    },
    async (args) => {
      try {
        const query = String(args?.query || '').trim();
        const safeLimit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(100, args.limit!)) : 10;
        const safeContentLimit = Number.isFinite(args?.content_limit) ? Math.max(0, Math.min(20, args.content_limit!)) : 5;
        const domainFilter = typeof args?.domain === 'string' && args.domain.trim() ? args.domain.trim() : null;

        if (domainFilter && (!query || query === '*')) {
          const data = await getNodePayload({ domain: domainFilter, path: '', navOnly: true });
          return ok(`Domain root: ${domainFilter}://\n\n${formatNode(data)}`);
        }

        const data = await searchMemories({ query, domain: domainFilter, limit: safeLimit, content_limit: safeContentLimit });
        const results = data?.results || [];

        if (results.length === 0) return ok(`No matching memories found${domainFilter ? ` in domain ${domainFilter}` : ''}.`);

        const text = results.map((item, idx) => {
          const parts = [`${idx + 1}. ${item.uri} (priority: ${item.priority}, score: ${item.score_display})`];
          if (item.cues.length > 0) parts.push(`   via: ${item.cues.join(', ')}`);
          if (item.content) {
            parts.push(`   ---\n${item.content}`);
          } else if (item.snippet) {
            parts.push(`   ${item.snippet}`);
          }
          return parts.join('\n');
        }).join('\n\n');

        return ok(text);
      } catch (error) {
        return fail('Lore search failed', error);
      }
    },
  );

  // ── lore_list_domains ────────────────────────────────────────
  server.tool(
    'lore_list_domains',
    loreToolContractSource('lore_list_domains').description,
    {},
    async () => {
      try {
        const data = await listDomains();
        const text = Array.isArray(data) && data.length > 0
          ? (data as unknown as Record<string, unknown>[]).map((item: Record<string, unknown>) => `- ${item.domain} (${item.root_count}) — open root with lore_get_node uri=\"${item.domain}://\" nav_only=true`).join('\n')
          : 'No domains found.';
        return ok(text);
      } catch (error) {
        return fail('Lore list domains failed', error);
      }
    },
  );

  // ── lore_create_node ─────────────────────────────────────────
  server.tool(
    'lore_create_node',
    loreToolContractSource('lore_create_node').description,
    {
      content: z.string().describe(loreToolParameterDescription('lore_create_node', 'content')),
      priority: z.number().int().min(0).describe(loreToolParameterDescription('lore_create_node', 'priority')),
      glossary: z.array(z.string()).describe(loreToolParameterDescription('lore_create_node', 'glossary')),
      uri: z.string().optional().describe(loreToolParameterDescription('lore_create_node', 'uri')),
      domain: z.string().optional().describe(loreToolParameterDescription('lore_create_node', 'domain')),
      parent_path: z.string().optional().describe(loreToolParameterDescription('lore_create_node', 'parent_path')),
      title: z.string().optional().describe(loreToolParameterDescription('lore_create_node', 'title')),
      disclosure: z.string().optional().describe(loreToolParameterDescription('lore_create_node', 'disclosure')),
    },
    async (args) => {
      try {
        const glossary = normalizeKeywordList(args?.glossary);
        let domain = typeof args?.domain === 'string' && args.domain.trim() ? args.domain.trim() : defaultDomain;
        let parentPath = typeof args?.parent_path === 'string' ? trimSlashes(args.parent_path) : '';
        let title = typeof args?.title === 'string' ? args.title.trim() : '';

        // If a full URI is provided, derive domain/parentPath/title from it
        if (typeof args?.uri === 'string' && args.uri.trim()) {
          const target = resolveUri(args, defaultDomain);
          const segments = target.path.split('/').filter(Boolean);
          if (segments.length === 0) throw new Error('Create target URI must include a final path segment.');
          const derivedTitle = segments[segments.length - 1];
          if (title && title !== derivedTitle) throw new Error(`Conflicting uri and title: ${derivedTitle} vs ${title}`);
          domain = target.domain;
          parentPath = segments.slice(0, -1).join('/');
          title = derivedTitle;
        }

        // -- policy gate --
        const policyResult = await validateCreatePolicy({
          priority: Number(args?.priority),
          disclosure: args?.disclosure ?? null,
        });
        if (policyResult.errors.length > 0) return fail('Lore create blocked by policy', policyResult.errors.join('; '));

        const eventContext = { source: 'mcp:lore_create_node', client_type: context.clientType ?? null };
        const data = await createNode({
          domain,
          parentPath,
          content: String(args?.content || ''),
          priority: Number(args?.priority),
          title,
          disclosure: args?.disclosure ?? null,
          glossary,
        }, eventContext);

        const targetUri = String(data?.uri || `${domain}://${parentPath}`).trim();
        const suffix = glossary.length > 0 ? `\nGlossary: ${glossary.join(', ')}` : '';
        return ok(formatPolicyResult(`Created ${targetUri}${suffix}`, policyResult.warnings));
      } catch (error) {
        return fail('Lore create failed', error);
      }
    },
  );

  // ── lore_update_node ─────────────────────────────────────────
  server.tool(
    'lore_update_node',
    loreToolContractSource('lore_update_node').description,
    {
      uri: z.string().describe(loreToolParameterDescription('lore_update_node', 'uri')),
      content: z.string().optional().describe(loreToolParameterDescription('lore_update_node', 'content')),
      priority: z.number().int().min(0).optional().describe(loreToolParameterDescription('lore_update_node', 'priority')),
      disclosure: z.string().optional().describe(loreToolParameterDescription('lore_update_node', 'disclosure')),
      glossary_add: z.array(z.string()).optional().describe(loreToolParameterDescription('lore_update_node', 'glossary_add')),
      glossary_remove: z.array(z.string()).optional().describe(loreToolParameterDescription('lore_update_node', 'glossary_remove')),
    },
    async (args) => {
      try {
        const { domain, path } = resolveUri(args, defaultDomain);
        if (!path) throw new Error('uri is required.');

        // -- policy gate --
        const policyResult = await validateUpdatePolicy({
          domain, path,
          priority: Number.isFinite(args?.priority) ? args!.priority! : undefined,
          disclosure: typeof args?.disclosure === 'string' ? args.disclosure : undefined,
        });
        if (policyResult.errors.length > 0) return fail('Lore update blocked by policy', policyResult.errors.join('; '));

        const eventContext = { source: 'mcp:lore_update_node', client_type: context.clientType ?? null };
        const body: Record<string, unknown> = {};
        if (typeof args?.content === 'string') body.content = args.content;
        if (Number.isFinite(args?.priority)) body.priority = args!.priority;
        if (typeof args?.disclosure === 'string') body.disclosure = args.disclosure;

        const glossaryAdd = normalizeKeywordList(args?.glossary_add);
        const glossaryRemove = normalizeKeywordList(args?.glossary_remove);
        const result = await updateNodeByPath({
          domain,
          path,
          ...body,
          glossaryAdd,
          glossaryRemove,
        }, eventContext);

        const suffixParts: string[] = [];
        if (glossaryAdd.length > 0) suffixParts.push(`glossary+ ${glossaryAdd.join(', ')}`);
        if (glossaryRemove.length > 0) suffixParts.push(`glossary- ${glossaryRemove.join(', ')}`);
        const suffix = suffixParts.length > 0 ? `\n${suffixParts.join('\n')}` : '';
        return ok(formatPolicyResult(`Updated ${result.uri}${suffix}`, policyResult.warnings));
      } catch (error) {
        return fail('Lore update failed', error);
      }
    },
  );

  // ── lore_delete_node ─────────────────────────────────────────
  server.tool(
    'lore_delete_node',
    loreToolContractSource('lore_delete_node').description,
    {
      uri: z.string().describe(loreToolParameterDescription('lore_delete_node', 'uri')),
    },
    async (args) => {
      try {
        const { domain, path } = resolveUri(args, defaultDomain);
        if (!path) throw new Error('uri is required.');

        // -- policy gate --
        const policyResult = await validateDeletePolicy({ domain, path });
        if (policyResult.errors.length > 0) return fail('Lore delete blocked by policy', policyResult.errors.join('; '));

        const result = await deleteNodeByPath({ domain, path }, {
          source: 'mcp:lore_delete_node',
          client_type: context.clientType ?? null,
        });
        return ok(formatPolicyResult(`Deleted ${result.deleted_uri}${result.uri !== result.deleted_uri ? ` (canonical: ${result.uri})` : ''}`, policyResult.warnings));
      } catch (error) {
        return fail('Lore delete failed', error);
      }
    },
  );

  // ── lore_move_node ───────────────────────────────────────────
  server.tool(
    'lore_move_node',
    loreToolContractSource('lore_move_node').description,
    {
      old_uri: z.string().describe(loreToolParameterDescription('lore_move_node', 'old_uri')),
      new_uri: z.string().describe(loreToolParameterDescription('lore_move_node', 'new_uri')),
    },
    async (args) => {
      try {
        const result = await moveNode({
          old_uri: String(args?.old_uri || '').trim(),
          new_uri: String(args?.new_uri || '').trim(),
        }, {
          source: 'mcp:lore_move_node',
          client_type: context.clientType ?? null,
        });
        return ok(`Moved ${result.old_uri} → ${result.new_uri}`);
      } catch (error) {
        return fail('Lore move failed', error);
      }
    },
  );

  return server;
}
