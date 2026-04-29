import { textResult, fetchJson, hasRecallConfig } from './api';
import { resolveMemoryLocator, splitParentPathAndTitle, trimSlashes } from './uri';
import { formatNode, formatBootView, normalizeSearchResults, normalizeKeywordList } from './formatters';
import { markSessionRead } from './hooks';

const Type = {
  String: (meta?: Record<string, unknown>) => ({ type: 'string', ...meta }),
  Number: (meta?: Record<string, unknown>) => ({ type: 'number', ...meta }),
  Boolean: (meta?: Record<string, unknown>) => ({ type: 'boolean', ...meta }),
  Array: (items: Record<string, unknown>) => ({ type: 'array', items }),
  Optional: (schema: Record<string, unknown>) => ({ ...schema }),
  Object: (properties: Record<string, unknown>, rest?: Record<string, unknown>) => ({
    type: 'object',
    properties,
    ...rest,
  }),
};

async function applyGlossaryMutations(pluginCfg: any, nodeUuid: string, { add = [], remove = [] }: { add?: string[]; remove?: string[] } = {}) {
  const added: string[] = [];
  const removed: string[] = [];
  for (const keyword of normalizeKeywordList(add)) {
    await fetchJson(pluginCfg, '/browse/glossary', {
      method: 'POST',
      body: JSON.stringify({ keyword, node_uuid: nodeUuid }),
    });
    added.push(keyword);
  }
  for (const keyword of normalizeKeywordList(remove)) {
    await fetchJson(pluginCfg, '/browse/glossary', {
      method: 'DELETE',
      body: JSON.stringify({ keyword, node_uuid: nodeUuid }),
    });
    removed.push(keyword);
  }
  return { added, removed };
}

export function registerTools(pi: any, pluginCfg: any) {
  pi.registerTool({
    name: 'lore_status',
    label: 'Lore status',
    description: 'Check memory backend availability and connection health.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId: string, _params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      try {
        const data = await fetchJson(pluginCfg, '/health', { method: 'GET' });
        return textResult(`Lore online\n\n${JSON.stringify(data, null, 2)}`, { ok: true, health: data, baseUrl: pluginCfg.baseUrl });
      } catch (error: any) {
        return textResult(`Lore offline: ${error.message}`, { ok: false, error: error.message, baseUrl: pluginCfg.baseUrl });
      }
    },
  });

  pi.registerTool({
    name: 'lore_boot',
    label: 'Lore boot',
    description: 'Load the fixed boot memory view that restores the deterministic startup baseline and core operating context.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId: string, _params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      try {
        const data = await fetchJson(pluginCfg, '/browse/boot', { method: 'GET' });
        const content = formatBootView(data);
        return textResult(content, { ok: true, content, boot: data });
      } catch (error: any) {
        return textResult(`Lore boot failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_get_node',
    label: 'Lore get node',
    description: 'Open a memory node to inspect its full content, metadata, and nearby structure. Pass session_id and query_id from the <recall> tag to enable read tracking and adoption.',
    parameters: Type.Object({
      uri: Type.String({ description: 'Full memory URI such as core://agent/pi.' }),
      nav_only: Type.Optional(Type.Boolean()),
      session_id: Type.Optional(Type.String()),
      query_id: Type.Optional(Type.String()),
      __session_id: Type.Optional(Type.String()),
    }),
    promptSnippet: 'Open a Lore memory node by URI.',
    promptGuidelines: [
      'Use lore_get_node to open a recalled Lore URI before relying on it in an answer or code change.',
      'Pass session_id and query_id from a <recall> block to lore_get_node when those fields are available.',
    ],
    async execute(_toolCallId: string, params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      const navOnly = params?.nav_only === true;
      const sessionId = (typeof params?.session_id === 'string' && params.session_id.trim()) || (typeof params?.__session_id === 'string' && params.__session_id.trim()) || '';
      const queryId = typeof params?.query_id === 'string' && params.query_id.trim() ? params.query_id.trim() : '';
      let domain = pluginCfg.defaultDomain;
      let path = '';
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: '__unused_path', allowEmptyPath: true, label: 'uri' }));
        const qs = new URLSearchParams({ domain, path, nav_only: String(navOnly) });
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: 'GET' });
        const node = data?.node || {};
        if (sessionId && node?.uri) {
          await markSessionRead(pluginCfg, {
            sessionId,
            uri: node.uri,
            nodeUuid: node.node_uuid,
            source: 'tool:lore_get_node',
          });
        }
        if (queryId && node?.uri) {
          try {
            await fetchJson(pluginCfg, '/browse/recall/usage', {
              method: 'POST',
              body: JSON.stringify({
                query_id: queryId,
                session_id: sessionId || 'pi-embedded',
                node_uris: [node.uri],
                source: 'tool:lore_get_node',
                success: true,
              }),
            });
          } catch {
            // best effort
          }
        }
        return textResult(formatNode(data), { ok: true, node, children: data?.children || [] });
      } catch (error: any) {
        return textResult(`Lore get node failed: ${error.message}`, { ok: false, error: error.message, domain, path });
      }
    },
  });

  pi.registerTool({
    name: 'lore_search',
    label: 'Lore search',
    description: 'Search memories by keyword, semantic similarity, or both. Returns full content for top results.',
    parameters: Type.Object({
      query: Type.String(),
      domain: Type.Optional(Type.String({ description: 'Optional domain filter to narrow the search.' })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
      content_limit: Type.Optional(Type.Number({ minimum: 0, maximum: 20, description: 'How many top results include full content (default 5).' })),
    }),
    promptSnippet: 'Search Lore long-term memory for durable project or user context.',
    promptGuidelines: [
      'Use lore_search when the user asks about prior decisions, saved preferences, project memory, or durable context.',
    ],
    async execute(_toolCallId: string, params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      const query = String(params?.query || '').trim();
      const safeLimit = Number.isFinite(params?.limit) ? Math.max(1, Math.min(100, params.limit)) : 10;
      const safeContentLimit = Number.isFinite(params?.content_limit) ? Math.max(0, Math.min(20, params.content_limit)) : 5;
      try {
        let data;
        if (hasRecallConfig(pluginCfg)) {
          data = await fetchJson(pluginCfg, '/browse/search', {
            method: 'POST',
            body: JSON.stringify({
              query,
              domain: typeof params?.domain === 'string' && params.domain.trim() ? params.domain.trim() : null,
              limit: safeLimit,
              content_limit: safeContentLimit,
              hybrid: true,
            }),
          });
        } else {
          const qs = new URLSearchParams({ query });
          if (typeof params?.domain === 'string' && params.domain.trim()) qs.set('domain', params.domain.trim());
          qs.set('limit', String(safeLimit));
          qs.set('content_limit', String(safeContentLimit));
          data = await fetchJson(pluginCfg, `/browse/search?${qs.toString()}`, { method: 'GET' });
        }
        const results = normalizeSearchResults(data);
        const meta = data?.meta || null;
        const text = results.length > 0
          ? results.map((item: any, idx: number) => {
              const parts = [`${idx + 1}. ${item.uri} (priority: ${item.priority}`];
              if (typeof item?.score === 'number') parts.push(`score: ${item.score.toFixed(3)}`);
              if (Array.isArray(item?.matched_on) && item.matched_on.length > 0) parts.push(`via: ${item.matched_on.join('+')}`);
              return `${parts.join(', ')})\n   ${item.snippet}`;
            }).join('\n')
          : 'No matching memories found.';
        const suffix = meta?.semantic_error ? `\n\nSemantic fallback skipped: ${meta.semantic_error}` : '';
        return textResult(`${text}${suffix}`, { ok: true, results, meta });
      } catch (error: any) {
        return textResult(`Lore search failed: ${error.message}`, { ok: false, error: error.message, query });
      }
    },
  });

  pi.registerTool({
    name: 'lore_list_domains',
    label: 'Lore list domains',
    description: 'Browse the top-level memory domains available in the memory system.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId: string, _params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      try {
        const data = await fetchJson(pluginCfg, '/browse/domains', { method: 'GET' });
        const text = Array.isArray(data) && data.length > 0
          ? data.map((item: any) => `- ${item.domain} (${item.root_count})`).join('\n')
          : 'No domains found.';
        return textResult(text, { ok: true, domains: data });
      } catch (error: any) {
        return textResult(`Lore list domains failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_create_node',
    label: 'Lore create node',
    description: 'Create a new long-term memory node for durable facts, rules, project knowledge, or conclusions worth keeping.',
    parameters: Type.Object({
      content: Type.String(),
      priority: Type.Number({ minimum: 0 }),
      glossary: Type.Array(Type.String()),
      uri: Type.Optional(Type.String({ description: 'Optional final memory URI when you know exactly where to place it.' })),
      domain: Type.Optional(Type.String({ description: 'Target memory domain when not using uri.' })),
      parent_path: Type.Optional(Type.String({ description: 'Parent location inside the chosen domain.' })),
      title: Type.Optional(Type.String({ description: 'Final path segment for the new memory.' })),
      disclosure: Type.Optional(Type.String({ description: 'When this memory should be recalled.' })),
    }),
    async execute(_toolCallId: string, params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      const glossary = normalizeKeywordList(params?.glossary);
      const body: any = {
        domain: typeof params?.domain === 'string' && params.domain.trim() ? params.domain.trim() : pluginCfg.defaultDomain,
        parent_path: typeof params?.parent_path === 'string' ? trimSlashes(params.parent_path) : '',
        content: String(params?.content || ''),
        priority: Number(params?.priority),
      };
      try {
        if (typeof params?.title === 'string') body.title = params.title.trim();
        if (typeof params?.disclosure === 'string') body.disclosure = params.disclosure;

        if (typeof params?.uri === 'string' && params.uri.trim()) {
          const target = resolveMemoryLocator(params, {
            defaultDomain: pluginCfg.defaultDomain,
            domainKey: 'domain',
            pathKey: 'parent_path',
            uriKey: 'uri',
            allowEmptyPath: false,
            label: 'uri',
          });
          const derived = splitParentPathAndTitle(target.path);
          if (!derived.title) {
            throw new Error('Create target URI must include a final path segment, like project://workflow/browser_policy');
          }
          if (typeof params?.title === 'string' && params.title.trim() && params.title.trim() !== derived.title) {
            throw new Error(`Conflicting uri and title: ${derived.title} vs ${params.title.trim()}`);
          }
          body.domain = target.domain;
          body.parent_path = derived.parentPath;
          body.title = derived.title;
        }

        const data = await fetchJson(pluginCfg, '/browse/node', { method: 'POST', body: JSON.stringify(body) });
        const nodeUuid = String(data?.node_uuid || '').trim();
        const glossaryResult = nodeUuid && glossary.length > 0
          ? await applyGlossaryMutations(pluginCfg, nodeUuid, { add: glossary })
          : { added: [], removed: [] };
        const suffix = glossaryResult.added.length > 0 ? `\nGlossary: ${glossaryResult.added.join(', ')}` : '';
        return textResult(`Created ${data?.uri || `${body.domain}://${body.parent_path}`}${suffix}`, { ok: true, result: data, glossary: glossaryResult });
      } catch (error: any) {
        return textResult(`Lore create failed: ${error.message}`, { ok: false, error: error.message, body, glossary });
      }
    },
  });

  pi.registerTool({
    name: 'lore_update_node',
    label: 'Lore update node',
    description: 'Revise an existing long-term memory node when stored knowledge becomes clearer, newer, or more accurate.',
    parameters: Type.Object({
      uri: Type.String({ description: 'Full memory URI for the node you want to revise.' }),
      content: Type.Optional(Type.String()),
      priority: Type.Optional(Type.Number({ minimum: 0 })),
      disclosure: Type.Optional(Type.String()),
      session_id: Type.Optional(Type.String({ description: 'Session ID for read-before-update validation.' })),
      glossary_add: Type.Optional(Type.Array(Type.String())),
      glossary_remove: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_toolCallId: string, params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      const body: any = {};
      const glossaryAdd = normalizeKeywordList(params?.glossary_add);
      const glossaryRemove = normalizeKeywordList(params?.glossary_remove);
      if (typeof params?.content === 'string') body.content = params.content;
      if (Number.isFinite(params?.priority)) body.priority = params.priority;
      if (typeof params?.disclosure === 'string') body.disclosure = params.disclosure;
      if (typeof params?.session_id === 'string' && params.session_id.trim()) body.session_id = params.session_id.trim();
      let domain = pluginCfg.defaultDomain;
      let path = '';
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: '__unused_path', allowEmptyPath: false, label: 'uri' }));
        const qs = new URLSearchParams({ domain, path });
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: 'PUT', body: JSON.stringify(body) });
        let glossaryResult: { added: string[]; removed: string[] } = { added: [], removed: [] };
        if (glossaryAdd.length > 0 || glossaryRemove.length > 0) {
          const nodeUuid = String(data?.node_uuid || '').trim();
          if (!nodeUuid) throw new Error(`Node UUID not found for ${domain}://${path}`);
          glossaryResult = await applyGlossaryMutations(pluginCfg, nodeUuid, { add: glossaryAdd, remove: glossaryRemove });
        }
        const suffixParts: string[] = [];
        if (glossaryResult.added.length > 0) suffixParts.push(`glossary+ ${glossaryResult.added.join(', ')}`);
        if (glossaryResult.removed.length > 0) suffixParts.push(`glossary- ${glossaryResult.removed.join(', ')}`);
        const suffix = suffixParts.length > 0 ? `\n${suffixParts.join('\n')}` : '';
        return textResult(`Updated ${data?.uri || `${domain}://${path}`}${suffix}`, { ok: true, result: data, glossary: glossaryResult });
      } catch (error: any) {
        return textResult(`Lore update failed: ${error.message}`, { ok: false, error: error.message, domain, path, glossary_add: glossaryAdd, glossary_remove: glossaryRemove });
      }
    },
  });

  pi.registerTool({
    name: 'lore_delete_node',
    label: 'Lore delete node',
    description: 'Remove a memory path that is obsolete, duplicated, or no longer wanted.',
    parameters: Type.Object({
      uri: Type.String({ description: 'Full memory URI for the path you want to remove.' }),
      session_id: Type.Optional(Type.String({ description: 'Session ID for read-before-delete validation.' })),
    }),
    async execute(_toolCallId: string, params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      let domain = pluginCfg.defaultDomain;
      let path = '';
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: '__unused_path', allowEmptyPath: false, label: 'uri' }));
        const qs = new URLSearchParams({ domain, path });
        if (typeof params?.session_id === 'string' && params.session_id.trim()) {
          qs.set('session_id', params.session_id.trim());
        }
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: 'DELETE' });
        const deletedUri = String(data?.deleted_uri || data?.uri || `${domain}://${path}`).trim();
        const canonicalUri = String(data?.uri || deletedUri).trim();
        const suffix = canonicalUri && canonicalUri !== deletedUri ? ` (canonical: ${canonicalUri})` : '';
        return textResult(`Deleted ${deletedUri}${suffix}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore delete failed: ${error.message}`, { ok: false, error: error.message, domain, path });
      }
    },
  });

  pi.registerTool({
    name: 'lore_move_node',
    label: 'Lore move node',
    description: 'Move or rename a memory node to a new URI path. Updates all child paths automatically.',
    parameters: Type.Object({
      old_uri: Type.String({ description: 'Current memory URI to move from.' }),
      new_uri: Type.String({ description: 'New memory URI to move to.' }),
    }),
    async execute(_toolCallId: string, params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      const body = {
        old_uri: String(params?.old_uri || '').trim(),
        new_uri: String(params?.new_uri || '').trim(),
      };
      try {
        const data = await fetchJson(pluginCfg, '/browse/move', { method: 'POST', body: JSON.stringify(body) });
        const oldUri = String(data?.old_uri || body.old_uri).trim();
        const newUri = String(data?.new_uri || data?.uri || body.new_uri).trim();
        return textResult(`Moved ${oldUri} → ${newUri}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore move failed: ${error.message}`, { ok: false, error: error.message, body });
      }
    },
  });

  pi.registerTool({
    name: 'lore_list_session_reads',
    label: 'Lore list session reads',
    description: 'Show which memory nodes have already been opened in this session.',
    parameters: Type.Object({
      session_id: Type.String({ description: 'Session identifier.' }),
    }),
    async execute(_toolCallId: string, params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      const sessionId = String(params?.session_id || '').trim();
      try {
        const qs = new URLSearchParams({ session_id: sessionId });
        const data = await fetchJson(pluginCfg, `/browse/session/read?${qs.toString()}`, { method: 'GET' });
        const text = Array.isArray(data) && data.length > 0
          ? data.map((item: any) => `- ${item.uri} (${item.read_count})`).join('\n')
          : 'No read nodes tracked for this session.';
        return textResult(text, { ok: true, reads: data });
      } catch (error: any) {
        return textResult(`Lore session reads failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_clear_session_reads',
    label: 'Lore clear session reads',
    description: 'Reset per-session memory read tracking.',
    parameters: Type.Object({
      session_id: Type.String({ description: 'Session identifier.' }),
    }),
    async execute(_toolCallId: string, params: any = {}, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: any) {
      const sessionId = String(params?.session_id || '').trim();
      try {
        const qs = new URLSearchParams({ session_id: sessionId });
        const data = await fetchJson(pluginCfg, `/browse/session/read?${qs.toString()}`, { method: 'DELETE' });
        return textResult(`Cleared Lore read tracking for ${sessionId}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore clear session reads failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });
}
