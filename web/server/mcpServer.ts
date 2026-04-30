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
import { markSessionRead, listSessionReads, clearSessionReads } from './lore/memory/session';
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
  applyGlossaryMutations,
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
      version: '1.0.4',
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
    'Open a memory node to inspect its full content, metadata, and nearby structure. Pass session_id and query_id from the <recall> tag to enable read tracking and adoption.',
    {
      uri: z.string().describe('Full memory URI for the node you want to open, such as core://soul.'),
      nav_only: z.boolean().optional().describe('If true, skip expensive glossary processing.'),
      session_id: z.string().optional().describe('Session identifier from the <recall session_id="..."> tag.'),
      query_id: z.string().optional().describe('Query identifier from the <recall query_id="..."> tag. Marks this recall as adopted.'),
    },
    async (args) => {
      try {
        const { domain, path } = resolveUri(args, defaultDomain);
        const data = await getNodePayload({ domain, path, navOnly: args?.nav_only === true });

        const node = data?.node || {};
        const sid = typeof args?.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : 'mcp-embedded';
        const qid = typeof args?.query_id === 'string' ? args.query_id.trim() : '';
        if (node.uri && node.node_uuid) {
          try {
            await Promise.all([
              markSessionRead({
                session_id: sid,
                uri: node.uri,
                node_uuid: node.node_uuid,
                source: 'mcp:lore_get_node',
              }),
              qid
                ? markRecallEventsUsedInAnswer({
                    queryId: qid,
                    sessionId: sid,
                    nodeUris: [node.uri],
                    source: 'mcp:lore_get_node',
                    success: true,
                    clientType: context.clientType ?? null,
                  })
                : Promise.resolve(),
            ]);
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
      query: z.string().describe('Search query text.'),
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

        const data = await searchMemories({ query, domain: domainFilter, limit: safeLimit, content_limit: safeContentLimit });
        const results = data?.results || [];

        if (results.length === 0) return ok('No matching memories found.');

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

        const eventContext = { source: 'mcp:lore_create_node', client_type: context.clientType ?? null };
        const data = await createNode({
          domain,
          parentPath,
          content: String(args?.content || ''),
          priority: Number(args?.priority),
          title,
          disclosure: args?.disclosure ?? null,
        }, eventContext);

        const targetUri = String(data?.uri || `${domain}://${parentPath}`).trim();
        const nodeUuid = String(data?.node_uuid || '').trim();
        const glossaryResult = nodeUuid && glossary.length > 0
          ? await applyGlossaryMutations(nodeUuid, { add: glossary }, eventContext)
          : { added: [] };
        const suffix = glossaryResult.added.length > 0 ? `\nGlossary: ${glossaryResult.added.join(', ')}` : '';
        return ok(formatPolicyResult(`Created ${targetUri}${suffix}`, policyResult.warnings));
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
      session_id: z.string().optional().describe('Session identifier from the <recall session_id="..."> tag.'),
    },
    async (args) => {
      try {
        const { domain, path } = resolveUri(args, defaultDomain);
        if (!path) throw new Error('uri is required.');
        const sid = typeof args?.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : 'mcp-embedded';

        // -- policy gate --
        const policyResult = await validateUpdatePolicy({
          domain, path,
          priority: Number.isFinite(args?.priority) ? args!.priority! : undefined,
          disclosure: typeof args?.disclosure === 'string' ? args.disclosure : undefined,
          sessionId: sid,
        });
        if (policyResult.errors.length > 0) return fail('Lore update blocked by policy', policyResult.errors.join('; '));

        const eventContext = { source: 'mcp:lore_update_node', client_type: context.clientType ?? null };
        const body: Record<string, unknown> = {};
        if (typeof args?.content === 'string') body.content = args.content;
        if (Number.isFinite(args?.priority)) body.priority = args!.priority;
        if (typeof args?.disclosure === 'string') body.disclosure = args.disclosure;

        const result = await updateNodeByPath({ domain, path, ...body }, eventContext);

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
      session_id: z.string().optional().describe('Session identifier from the <recall session_id="..."> tag.'),
    },
    async (args) => {
      try {
        const { domain, path } = resolveUri(args, defaultDomain);
        if (!path) throw new Error('uri is required.');
        const sid = typeof args?.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : 'mcp-embedded';

        // -- policy gate --
        const policyResult = await validateDeletePolicy({ domain, path, sessionId: sid });
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
