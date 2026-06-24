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

import {
  ok,
  fail,
  formatPolicyResult,
  trimSlashes,
  normalizeKeywordList,
  resolveUri,
  formatNode,
  formatBootView,
  loadGuidance,
  loadGuidanceReference,
} from './mcpFormatters';

// ── server factory ────────────────────────────────────────────────

interface McpServerContext {
  clientType?: ClientType | null;
}

export function createMcpServer(context: McpServerContext = {}): InstanceType<typeof McpServer> {
  const guidance = loadGuidance();
  const server = new McpServer(
    {
      name: 'lore',
      version: '1.3.9',
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
    'Load the fixed boot memory view that restores the deterministic startup baseline and core operating context.',
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
    'Open a memory node. REQUIRED when opening a URI from a <recall>: copy the exact session_id and query_id from that <recall> tag.',
    {
      uri: z.string().describe('Full memory URI for the node you want to open, such as core://soul. Use core:// or project:// to browse a domain root; bare words are paths in the default domain.'),
      nav_only: z.boolean().optional().describe('If true, skip expensive glossary processing.'),
      session_id: z.string().optional().describe('REQUIRED when the URI came from <recall>: copy the exact session_id from that <recall> tag.'),
      query_id: z.string().optional().describe('REQUIRED when the URI came from <recall>: copy the exact query_id from that <recall> tag.'),
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
    'Search memories by keyword, semantic similarity, or both. Returns full content for top results — use this when you need to read memory content directly without a separate get_node call.',
    {
      query: z.string().describe('Search query text. Not a wildcard — use a meaningful keyword or phrase. Passing an empty string or * with a domain filter browses that domain root.'),
      domain: z.string().optional().describe('Optional domain filter to narrow the search.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of results.'),
      content_limit: z.number().int().min(0).max(20).optional().describe('How many top results include full content (default 5).'),
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
    'Browse the top-level memory domains available in the memory system.',
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
    'Create a new long-term memory node only when no existing stable node should own the fact. Use stable semantic snake_case URI/title segments. A multi-segment path is a semantic memory tree; every intermediate segment must be a real abstraction parent node with memory content, disclosure, and glossary, so create parents first. Do not append dates, timestamps, or epoch values to ordinary memory paths; put dates in content instead.',
    {
      content: z.string().describe('Memory text body.'),
      priority: z.number().int().min(0).describe('Importance tier (0=core identity, 1=key facts, 2+=general).'),
      glossary: z.array(z.string()).describe('Initial glossary keywords written with this node create event.'),
      uri: z.string().optional().describe('Optional final stable semantic memory URI. Do not append dates, timestamps, or epoch values for ordinary memories. Intermediate paths must already exist as real abstraction parent nodes with content.'),
      domain: z.string().optional().describe('Target memory domain when not using uri.'),
      parent_path: z.string().optional().describe('Parent location inside the chosen domain; for multi-segment paths this must be a real abstraction node with content, disclosure, and glossary.'),
      title: z.string().optional().describe('Final stable semantic path segment for the new memory; ordinary memories must not end with dates or timestamps.'),
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
    'Revise an existing long-term memory node. Omitted content, metadata, and glossary mutation fields are left unchanged.',
    {
      uri: z.string().describe('Full memory URI for the node you want to revise.'),
      content: z.string().optional().describe('New content to replace the existing content; omit to leave content unchanged.'),
      priority: z.number().int().min(0).optional().describe('New priority level; omit to leave priority unchanged.'),
      disclosure: z.string().optional().describe('New disclosure / trigger condition; omit to leave disclosure unchanged.'),
      glossary_add: z.array(z.string()).optional().describe('Keywords to add as part of this same node update event.'),
      glossary_remove: z.array(z.string()).optional().describe('Keywords to remove as part of this same node update event.'),
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
    'Remove a memory path that is obsolete, duplicated, or no longer wanted.',
    {
      uri: z.string().describe('Full memory URI for the path you want to remove.'),
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
    'Move or rename a memory node to a new URI path. A multi-segment path is a semantic memory tree; the target parent must already be a real abstraction parent node with memory content. The operation reparents the moved node to that parent and updates all child paths automatically.',
    {
      old_uri: z.string().describe('Current memory URI to move from.'),
      new_uri: z.string().describe('New memory URI to move to. For multi-segment paths, the target parent must already be a real abstraction node with content.'),
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
