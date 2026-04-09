/**
 * Embedded MCP server for Lore.
 *
 * Registers the same 11 tools as the standalone lore-mcp package,
 * but calls internal server functions directly instead of going through HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { sql } from './db';
import { bootView } from './lore/memory/boot';
import { getNodePayload, listDomains } from './lore/memory/browse';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from './lore/memory/write';
import { searchMemories } from './lore/search/search';
import { markSessionRead, listSessionReads, clearSessionReads } from './lore/memory/session';
import { validateCreatePolicy, validateUpdatePolicy, validateDeletePolicy } from './lore/ops/policy';

import {
  ok,
  fail,
  formatPolicyResult,
  trimSlashes,
  normalizeKeywordList,
  resolveUri,
  formatNode,
  formatBootView,
  applyGlossaryMutations,
  loadGuidance,
  loadGuidanceReference,
} from './mcpFormatters';

// ── server factory ────────────────────────────────────────────────

export function createMcpServer(): InstanceType<typeof McpServer> {
  const guidance = loadGuidance();
  const server = new McpServer(
    {
      name: 'lore',
      version: '1.0.0',
    },
    guidance ? { instructions: guidance } : undefined,
  );

  const defaultDomain = process.env.LORE_DEFAULT_DOMAIN || 'core';

  // ── lore_guidance ─────────────────────────────────────────────
  server.tool(
    'lore_guidance',
    'Load the full Lore usage rules. Call this if your context does not already contain detailed usage guidance.',
    {},
    async () => {
      const text = loadGuidanceReference();
      return text ? ok(text) : fail('Guidance', new Error('file not found'));
    },
  );

  // ── lore_status ──────────────────────────────────────────────
  server.tool(
    'lore_status',
    'Check memory backend availability and connection health.',
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
    'Load the boot memory view that restores long-term identity and core operating context.',
    {},
    async () => {
      try {
        const data = await bootView(process.env.CORE_MEMORY_URIS);
        return ok(formatBootView(data));
      } catch (error) {
        return fail('Lore boot failed', error);
      }
    },
  );

  // ── lore_get_node ────────────────────────────────────────────
  server.tool(
    'lore_get_node',
    'Open a memory node to inspect its full content, metadata, and nearby structure.',
    {
      uri: z.string().describe('Full memory URI for the node you want to open, such as core://soul.'),
      nav_only: z.boolean().optional().describe('If true, skip expensive glossary processing.'),
    },
    async (args) => {
      try {
        const { domain, path } = resolveUri(args, defaultDomain);
        const data = await getNodePayload({ domain, path, navOnly: args?.nav_only === true });

        // best-effort session read tracking
        const node = data?.node || {};
        if (node.uri && node.node_uuid) {
          try {
            await markSessionRead({
              session_id: 'mcp-embedded',
              uri: node.uri,
              node_uuid: node.node_uuid,
              source: 'mcp:lore_get_node',
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
    'Find relevant memories by keyword or domain when you need to locate prior knowledge.',
    {
      query: z.string().describe('Search query text.'),
      domain: z.string().optional().describe('Optional domain filter to narrow the search.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of results.'),
    },
    async (args) => {
      try {
        const query = String(args?.query || '').trim();
        const safeLimit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(100, args.limit!)) : 10;
        const domainFilter = typeof args?.domain === 'string' && args.domain.trim() ? args.domain.trim() : null;

        const data = await searchMemories({ query, domain: domainFilter, limit: safeLimit, hybrid: true });
        const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];

        const text = results.length > 0
          ? (results as Record<string, unknown>[]).map((item: Record<string, unknown>, idx: number) => {
              const parts = [`${idx + 1}. ${item.uri} (priority: ${item.priority}`];
              if (typeof item?.score === 'number') parts.push(`score: ${item.score.toFixed(3)}`);
              if (Array.isArray(item?.matched_on) && item.matched_on.length > 0) parts.push(`via: ${item.matched_on.join('+')}`);
              return `${parts.join(', ')})\n   ${item.snippet}`;
            }).join('\n')
          : 'No matching memories found.';

        const meta = (data as unknown as Record<string, unknown>)?.meta as Record<string, unknown> | undefined;
        const suffix = meta?.semantic_error ? `\n\nSemantic fallback skipped: ${meta.semantic_error}` : '';
        return ok(`${text}${suffix}`);
      } catch (error) {
        return fail('Lore search failed', error);
      }
    },
  );

  // ── lore_list_domains ────────────────────────────────────────
  server.tool(
    'lore_list_domains',
    'Browse the top-level memory domains available in the memory system.',
    {},
    async () => {
      try {
        const data = await listDomains();
        const text = Array.isArray(data) && data.length > 0
          ? (data as unknown as Record<string, unknown>[]).map((item: Record<string, unknown>) => `- ${item.domain} (${item.root_count})`).join('\n')
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
    'Create a new long-term memory node for durable facts, rules, project knowledge, or conclusions worth keeping.',
    {
      content: z.string().describe('Memory text body.'),
      priority: z.number().int().min(0).describe('Importance tier (0=core identity, 1=key facts, 2+=general).'),
      glossary: z.array(z.string()).describe('Search keywords to associate with this memory.'),
      uri: z.string().optional().describe('Optional final memory URI. Use when you know exactly where to place it.'),
      domain: z.string().optional().describe('Target memory domain when not using uri.'),
      parent_path: z.string().optional().describe('Parent location inside the chosen domain.'),
      title: z.string().optional().describe('Final path segment for the new memory.'),
      disclosure: z.string().optional().describe('When this memory should be recalled.'),
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

        const eventContext = { source: 'mcp:lore_create_node' };
        const data = await createNode({
          domain,
          parentPath,
          content: String(args?.content || ''),
          priority: Number(args?.priority),
          title,
          disclosure: args?.disclosure ?? null,
        }, eventContext);

        const nodeUuid = String(data?.node_uuid || '').trim();
        const glossaryResult = nodeUuid && glossary.length > 0
          ? await applyGlossaryMutations(nodeUuid, { add: glossary }, eventContext)
          : { added: [] };
        const suffix = glossaryResult.added.length > 0 ? `\nGlossary: ${glossaryResult.added.join(', ')}` : '';
        return ok(formatPolicyResult(`Created ${data?.uri || `${domain}://${parentPath}`}${suffix}`, policyResult.warnings));
      } catch (error) {
        return fail('Lore create failed', error);
      }
    },
  );

  // ── lore_update_node ─────────────────────────────────────────
  server.tool(
    'lore_update_node',
    'Revise an existing long-term memory node when stored knowledge becomes clearer, newer, or more accurate.',
    {
      uri: z.string().describe('Full memory URI for the node you want to revise.'),
      content: z.string().optional().describe('New content to replace the existing content.'),
      priority: z.number().int().min(0).optional().describe('New priority level.'),
      disclosure: z.string().optional().describe('New disclosure / trigger condition.'),
      glossary_add: z.array(z.string()).optional().describe('Keywords to add to the glossary.'),
      glossary_remove: z.array(z.string()).optional().describe('Keywords to remove from the glossary.'),
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
          sessionId: 'mcp-embedded',
        });
        if (policyResult.errors.length > 0) return fail('Lore update blocked by policy', policyResult.errors.join('; '));

        const eventContext = { source: 'mcp:lore_update_node' };
        const body: Record<string, unknown> = {};
        if (typeof args?.content === 'string') body.content = args.content;
        if (Number.isFinite(args?.priority)) body.priority = args!.priority;
        if (typeof args?.disclosure === 'string') body.disclosure = args.disclosure;

        await updateNodeByPath({ domain, path, ...body }, eventContext);

        const glossaryAdd = normalizeKeywordList(args?.glossary_add);
        const glossaryRemove = normalizeKeywordList(args?.glossary_remove);
        let glossaryResult = { added: [] as string[], removed: [] as string[] };
        if (glossaryAdd.length > 0 || glossaryRemove.length > 0) {
          const nodeData = await getNodePayload({ domain, path, navOnly: true });
          const nodeUuid = String(nodeData?.node?.node_uuid || '').trim();
          if (!nodeUuid) throw new Error(`Node UUID not found for ${domain}://${path}`);
          glossaryResult = await applyGlossaryMutations(nodeUuid, { add: glossaryAdd, remove: glossaryRemove }, eventContext);
        }

        const suffixParts: string[] = [];
        if (glossaryResult.added.length > 0) suffixParts.push(`glossary+ ${glossaryResult.added.join(', ')}`);
        if (glossaryResult.removed.length > 0) suffixParts.push(`glossary- ${glossaryResult.removed.join(', ')}`);
        const suffix = suffixParts.length > 0 ? `\n${suffixParts.join('\n')}` : '';
        return ok(formatPolicyResult(`Updated ${domain}://${path}${suffix}`, policyResult.warnings));
      } catch (error) {
        return fail('Lore update failed', error);
      }
    },
  );

  // ── lore_delete_node ─────────────────────────────────────────
  server.tool(
    'lore_delete_node',
    'Remove a memory path that is obsolete, duplicated, or no longer wanted.',
    {
      uri: z.string().describe('Full memory URI for the path you want to remove.'),
    },
    async (args) => {
      try {
        const { domain, path } = resolveUri(args, defaultDomain);
        if (!path) throw new Error('uri is required.');

        // -- policy gate --
        const policyResult = await validateDeletePolicy({ domain, path, sessionId: 'mcp-embedded' });
        if (policyResult.errors.length > 0) return fail('Lore delete blocked by policy', policyResult.errors.join('; '));

        await deleteNodeByPath({ domain, path }, { source: 'mcp:lore_delete_node' });
        return ok(formatPolicyResult(`Deleted ${domain}://${path}`, policyResult.warnings));
      } catch (error) {
        return fail('Lore delete failed', error);
      }
    },
  );

  // ── lore_move_node ───────────────────────────────────────────
  server.tool(
    'lore_move_node',
    'Move or rename a memory node to a new URI path. Updates all child paths automatically.',
    {
      old_uri: z.string().describe('Current memory URI to move from.'),
      new_uri: z.string().describe('New memory URI to move to.'),
    },
    async (args) => {
      try {
        const result = await moveNode({
          old_uri: String(args?.old_uri || '').trim(),
          new_uri: String(args?.new_uri || '').trim(),
        }, { source: 'mcp:lore_move_node' });
        return ok(`Moved ${result.old_uri} → ${result.new_uri}`);
      } catch (error) {
        return fail('Lore move failed', error);
      }
    },
  );

  // ── lore_list_session_reads ──────────────────────────────────
  server.tool(
    'lore_list_session_reads',
    'Show which memory nodes have already been opened in this session.',
    {
      session_id: z.string().describe('Session identifier.'),
    },
    async (args) => {
      try {
        const sessionId = String(args?.session_id || '').trim();
        const data = await listSessionReads(sessionId);
        const text = Array.isArray(data) && data.length > 0
          ? (data as unknown as Record<string, unknown>[]).map((item: Record<string, unknown>) => `- ${item.uri} (${item.read_count})`).join('\n')
          : 'No read nodes tracked for this session.';
        return ok(text);
      } catch (error) {
        return fail('Lore session reads failed', error);
      }
    },
  );

  // ── lore_clear_session_reads ─────────────────────────────────
  server.tool(
    'lore_clear_session_reads',
    'Reset per-session memory read tracking.',
    {
      session_id: z.string().describe('Session identifier.'),
    },
    async (args) => {
      try {
        const sessionId = String(args?.session_id || '').trim();
        await clearSessionReads(sessionId);
        return ok(`Cleared Lore read tracking for ${sessionId}`);
      } catch (error) {
        return fail('Lore clear session reads failed', error);
      }
    },
  );

  return server;
}
