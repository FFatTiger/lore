import { textResult, fetchJson, hasRecallConfig } from './api';
import { resolveMemoryLocator, splitParentPathAndTitle, trimSlashes } from './uri';
import { formatNode, formatBootView, normalizeSearchResults, normalizeKeywordList } from './formatters';
import { markSessionRead } from './hooks';

async function applyGlossaryMutations(pluginCfg: any, nodeUuid: string, { add = [], remove = [] }: { add?: string[]; remove?: string[] } = {}) {
  const added: string[] = [];
  const removed: string[] = [];
  for (const keyword of normalizeKeywordList(add)) {
    await fetchJson(pluginCfg, "/browse/glossary", {
      method: "POST",
      body: JSON.stringify({ keyword, node_uuid: nodeUuid }),
    });
    added.push(keyword);
  }
  for (const keyword of normalizeKeywordList(remove)) {
    await fetchJson(pluginCfg, "/browse/glossary", {
      method: "DELETE",
      body: JSON.stringify({ keyword, node_uuid: nodeUuid }),
    });
    removed.push(keyword);
  }
  return { added, removed };
}

export function registerTools(api: any, pluginCfg: any) {
  api.registerTool({
    name: "lore_status",
    label: "Lore status",
    description: "Check memory backend availability and connection health.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      try {
        const data = await fetchJson(pluginCfg, "/health", { method: "GET" });
        return textResult(`Lore online\n\n${JSON.stringify(data, null, 2)}`, { ok: true, health: data, baseUrl: pluginCfg.baseUrl });
      } catch (error: any) {
        return textResult(`Lore offline: ${error.message}`, { ok: false, error: error.message, baseUrl: pluginCfg.baseUrl });
      }
    },
  });

  api.registerTool({
    name: "lore_boot",
    label: "Lore boot",
    description: "Load the boot memory view that restores long-term identity and core operating context.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      try {
        const data = await fetchJson(pluginCfg, "/browse/boot", { method: "GET" });
        const content = formatBootView(data);
        return textResult(content, { ok: true, content, boot: data });
      } catch (error: any) {
        return textResult(`Lore boot failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  api.registerTool({
    name: "lore_get_node",
    label: "Lore get node",
    description: "Open a memory node to inspect its full content, metadata, and nearby structure.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["uri"],
      properties: {
        uri: { type: "string", description: "Full memory URI for the node you want to open, such as core://soul." },
        nav_only: { type: "boolean", description: "If true, skip expensive glossary processing." },
        __session_id: { type: "string", description: "Internal session tracking field." },
        __session_key: { type: "string", description: "Internal session tracking field." }
      }
    },
    async execute(_id: any, params: any) {
      const navOnly = params?.nav_only === true;
      const sessionId = typeof params?.__session_id === "string" && params.__session_id.trim() ? params.__session_id.trim() : "";
      const sessionKey = typeof params?.__session_key === "string" && params.__session_key.trim() ? params.__session_key.trim() : "";
      let domain = pluginCfg.defaultDomain;
      let path = "";
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: "__unused_path", allowEmptyPath: true, label: "uri" }));
        const qs = new URLSearchParams({ domain, path, nav_only: String(navOnly) });
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: "GET" });
        const node = data?.node || {};
        if (sessionId && node?.uri) {
          await markSessionRead(pluginCfg, {
            sessionId,
            sessionKey,
            uri: node.uri,
            nodeUuid: node.node_uuid,
            source: "tool:lore_get_node",
          });
        }
        return textResult(formatNode(data), { ok: true, node, children: data?.children || [] });
      } catch (error: any) {
        return textResult(`Lore get node failed: ${error.message}`, { ok: false, error: error.message, domain, path });
      }
    },
  });

  api.registerTool({
    name: "lore_search",
    label: "Lore search",
    description: "Find relevant memories by keyword or domain when you need to locate prior knowledge.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        domain: { type: "string", description: "Optional domain filter to narrow the search." },
        limit: { type: "integer", minimum: 1, maximum: 100 }
      }
    },
    async execute(_id: any, params: any) {
      const query = String(params?.query || "").trim();
      const safeLimit = Number.isFinite(params?.limit) ? Math.max(1, Math.min(100, params.limit)) : 10;
      try {
        let data;
        if (hasRecallConfig(pluginCfg)) {
          data = await fetchJson(pluginCfg, `/browse/search`, {
            method: "POST",
            body: JSON.stringify({
              query,
              domain: typeof params?.domain === "string" && params.domain.trim() ? params.domain.trim() : null,
              limit: safeLimit,
              hybrid: true,
            }),
          });
        } else {
          const qs = new URLSearchParams({ query });
          if (typeof params?.domain === "string" && params.domain.trim()) qs.set("domain", params.domain.trim());
          qs.set("limit", String(safeLimit));
          data = await fetchJson(pluginCfg, `/browse/search?${qs.toString()}`, { method: "GET" });
        }
        const results = normalizeSearchResults(data);
        const meta = data?.meta || null;
        const text = results.length > 0
          ? results.map((item: any, idx: number) => {
              const parts = [`${idx + 1}. ${item.uri} (priority: ${item.priority}`];
              if (typeof item?.score === "number") parts.push(`score: ${item.score.toFixed(3)}`);
              if (Array.isArray(item?.matched_on) && item.matched_on.length > 0) parts.push(`via: ${item.matched_on.join("+")}`);
              return `${parts.join(", ")})\n   ${item.snippet}`;
            }).join("\n")
          : "No matching memories found.";
        const suffix = meta?.semantic_error ? `\n\nSemantic fallback skipped: ${meta.semantic_error}` : "";
        return textResult(`${text}${suffix}`, { ok: true, results, meta });
      } catch (error: any) {
        return textResult(`Lore search failed: ${error.message}`, { ok: false, error: error.message, query });
      }
    },
  });

  api.registerTool({
    name: "lore_list_domains",
    label: "Lore list domains",
    description: "Browse the top-level memory domains available in the memory system.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      try {
        const data = await fetchJson(pluginCfg, "/browse/domains", { method: "GET" });
        const text = Array.isArray(data) && data.length > 0
          ? data.map((item: any) => `- ${item.domain} (${item.root_count})`).join("\n")
          : "No domains found.";
        return textResult(text, { ok: true, domains: data });
      } catch (error: any) {
        return textResult(`Lore list domains failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  api.registerTool({
    name: "lore_create_node",
    label: "Lore create node",
    description: "Create a new long-term memory node for durable facts, rules, project knowledge, or conclusions worth keeping.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["content", "priority", "glossary"],
      properties: {
        uri: { type: "string", description: "Optional final memory URI. Use this when you already know exactly where the new memory should live." },
        domain: { type: "string", description: "Target memory domain when you are not using `uri`." },
        parent_path: { type: "string", description: "Parent location inside the chosen domain." },
        content: { type: "string" },
        priority: { type: "integer", minimum: 0 },
        title: { type: "string", description: "Final path segment for the new memory." },
        disclosure: { type: "string" },
        glossary: { type: "array", items: { type: "string" } }
      }
    },
    async execute(_id: any, params: any) {
      const glossary = normalizeKeywordList(params?.glossary);
      const body: any = {
        domain: typeof params?.domain === "string" && params.domain.trim() ? params.domain.trim() : pluginCfg.defaultDomain,
        parent_path: typeof params?.parent_path === "string" ? trimSlashes(params.parent_path) : "",
        content: String(params?.content || ""),
        priority: Number(params?.priority),
      };
      try {
        if (typeof params?.title === "string") body.title = params.title.trim();
        if (typeof params?.disclosure === "string") body.disclosure = params.disclosure;

        if (typeof params?.uri === "string" && params.uri.trim()) {
          const target = resolveMemoryLocator(params, {
            defaultDomain: pluginCfg.defaultDomain,
            domainKey: "domain",
            pathKey: "parent_path",
            uriKey: "uri",
            allowEmptyPath: false,
            label: "uri",
          });
          const derived = splitParentPathAndTitle(target.path);
          if (!derived.title) {
            throw new Error("Create target URI must include a final path segment, like project://workflow/browser_policy");
          }
          if (typeof params?.title === "string" && params.title.trim() && params.title.trim() !== derived.title) {
            throw new Error(`Conflicting uri and title: ${derived.title} vs ${params.title.trim()}`);
          }
          body.domain = target.domain;
          body.parent_path = derived.parentPath;
          body.title = derived.title;
        }

        const data = await fetchJson(pluginCfg, `/browse/node`, { method: "POST", body: JSON.stringify(body) });
        const nodeUuid = String(data?.node_uuid || "").trim();
        const glossaryResult = nodeUuid && glossary.length > 0
          ? await applyGlossaryMutations(pluginCfg, nodeUuid, { add: glossary })
          : { added: [], removed: [] };
        const suffix = glossaryResult.added.length > 0 ? `\nGlossary: ${glossaryResult.added.join(", ")}` : "";
        return textResult(`Created ${data?.uri || `${body.domain}://${body.parent_path}`}${suffix}`, { ok: true, result: data, glossary: glossaryResult });
      } catch (error: any) {
        return textResult(`Lore create failed: ${error.message}`, { ok: false, error: error.message, body, glossary });
      }
    },
  });

  api.registerTool({
    name: "lore_update_node",
    label: "Lore update node",
    description: "Revise an existing long-term memory node when stored knowledge becomes clearer, newer, or more accurate.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["uri"],
      properties: {
        uri: { type: "string", description: "Full memory URI for the node you want to revise." },
        content: { type: "string" },
        priority: { type: "integer", minimum: 0 },
        disclosure: { type: "string" },
        glossary_add: { type: "array", items: { type: "string" } },
        glossary_remove: { type: "array", items: { type: "string" } }
      }
    },
    async execute(_id: any, params: any) {
      const body: any = {};
      const glossaryAdd = normalizeKeywordList(params?.glossary_add);
      const glossaryRemove = normalizeKeywordList(params?.glossary_remove);
      if (typeof params?.content === "string") body.content = params.content;
      if (Number.isFinite(params?.priority)) body.priority = params.priority;
      if (typeof params?.disclosure === "string") body.disclosure = params.disclosure;
      let domain = pluginCfg.defaultDomain;
      let path = "";
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: "__unused_path", allowEmptyPath: false, label: "uri" }));
        const qs = new URLSearchParams({ domain, path });
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: "PUT", body: JSON.stringify(body) });
        let glossaryResult: { added: string[]; removed: string[] } = { added: [], removed: [] };
        if (glossaryAdd.length > 0 || glossaryRemove.length > 0) {
          const nodeData = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: "GET" });
          const nodeUuid = String(nodeData?.node?.node_uuid || "").trim();
          if (!nodeUuid) throw new Error(`Node UUID not found for ${domain}://${path}`);
          glossaryResult = await applyGlossaryMutations(pluginCfg, nodeUuid, { add: glossaryAdd, remove: glossaryRemove });
        }
        const suffixParts: string[] = [];
        if (glossaryResult.added.length > 0) suffixParts.push(`glossary+ ${glossaryResult.added.join(", ")}`);
        if (glossaryResult.removed.length > 0) suffixParts.push(`glossary- ${glossaryResult.removed.join(", ")}`);
        const suffix = suffixParts.length > 0 ? `\n${suffixParts.join("\n")}` : "";
        return textResult(`Updated ${domain}://${path}${suffix}`, { ok: true, result: data, glossary: glossaryResult });
      } catch (error: any) {
        return textResult(`Lore update failed: ${error.message}`, { ok: false, error: error.message, domain, path, glossary_add: glossaryAdd, glossary_remove: glossaryRemove });
      }
    },
  });

  api.registerTool({
    name: "lore_delete_node",
    label: "Lore delete node",
    description: "Remove a memory path that is obsolete, duplicated, or no longer wanted.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["uri"],
      properties: {
        uri: { type: "string", description: "Full memory URI for the path you want to remove." }
      }
    },
    async execute(_id: any, params: any) {
      let domain = pluginCfg.defaultDomain;
      let path = "";
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: "__unused_path", allowEmptyPath: false, label: "uri" }));
        const qs = new URLSearchParams({ domain, path });
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: "DELETE" });
        return textResult(`Deleted ${domain}://${path}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore delete failed: ${error.message}`, { ok: false, error: error.message, domain, path });
      }
    },
  });

  api.registerTool({
    name: "lore_move_node",
    label: "Lore move node",
    description: "Move or rename a memory node to a new URI path. Updates all child paths automatically.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["old_uri", "new_uri"],
      properties: {
        old_uri: { type: "string", description: "Current memory URI to move from." },
        new_uri: { type: "string", description: "New memory URI to move to." },
      }
    },
    async execute(_id: any, params: any) {
      const body = {
        old_uri: String(params?.old_uri || "").trim(),
        new_uri: String(params?.new_uri || "").trim(),
      };
      try {
        const data = await fetchJson(pluginCfg, `/browse/move`, { method: "POST", body: JSON.stringify(body) });
        return textResult(`Moved ${body.old_uri} → ${body.new_uri}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore move failed: ${error.message}`, { ok: false, error: error.message, body });
      }
    },
  });

  api.registerTool({
    name: "lore_list_session_reads",
    label: "Lore list session reads",
    description: "Show which memory nodes have already been opened in this session.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["session_id"],
      properties: { session_id: { type: "string" } }
    },
    async execute(_id: any, params: any) {
      const sessionId = String(params?.session_id || "").trim();
      try {
        const qs = new URLSearchParams({ session_id: sessionId });
        const data = await fetchJson(pluginCfg, `/browse/session/read?${qs.toString()}`, { method: "GET" });
        const text = Array.isArray(data) && data.length > 0
          ? data.map((item: any) => `- ${item.uri} (${item.read_count})`).join("\n")
          : "No read nodes tracked for this session.";
        return textResult(text, { ok: true, reads: data });
      } catch (error: any) {
        return textResult(`Lore session reads failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  api.registerTool({
    name: "lore_clear_session_reads",
    label: "Lore clear session reads",
    description: "Reset per-session memory read tracking.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["session_id"],
      properties: { session_id: { type: "string" } }
    },
    async execute(_id: any, params: any) {
      const sessionId = String(params?.session_id || "").trim();
      try {
        const qs = new URLSearchParams({ session_id: sessionId });
        const data = await fetchJson(pluginCfg, `/browse/session/read?${qs.toString()}`, { method: "DELETE" });
        return textResult(`Cleared Lore read tracking for ${sessionId}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore clear session reads failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });
}
