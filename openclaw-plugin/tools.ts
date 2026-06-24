import { Type } from "@sinclair/typebox";
import { textResult, fetchJson, hasRecallConfig } from "./api";
import { resolveMemoryLocator, splitParentPathAndTitle, trimSlashes } from "./uri";
import { formatNode, formatBootView, normalizeSearchResults, normalizeKeywordList } from "./formatters";

// Shared TypeBox schemas for tool parameters
const EmptySchema = Type.Object({});

const UriParam = Type.String({
  description: "Full memory URI, such as core://soul. Use core:// or project:// to browse a domain root; bare words are paths in the default domain.",
});

const GetNodeDescription = "Open a memory node. REQUIRED when opening a URI from a <recall>: copy the exact session_id and query_id from that <recall> tag.";

const SessionIdParam = Type.String({
  description: "REQUIRED when the URI came from <recall>: copy the exact session_id from that <recall> tag.",
});

const QueryIdParam = Type.String({
  description: "REQUIRED when the URI came from <recall>: copy the exact query_id from that <recall> tag.",
});

export function registerTools(api: any, pluginCfg: any) {
  api.logger?.info?.("lore: registerTools() starting");
  api.registerTool({
    name: "lore_status",
    label: "Lore status",
    description: "Check memory backend availability and connection health.",
    parameters: EmptySchema,
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
    description: "Load the fixed boot memory view that restores the deterministic startup baseline and core operating context.",
    parameters: EmptySchema,
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
    description: GetNodeDescription,
    parameters: Type.Object({
      uri: UriParam,
      nav_only: Type.Optional(Type.Boolean({ description: "If true, skip expensive glossary processing." })),
      session_id: Type.Optional(SessionIdParam),
      query_id: Type.Optional(QueryIdParam),
    }),
    async execute(_id: any, params: any) {
      const navOnly = params?.nav_only === true;
      const sessionId = typeof params?.session_id === "string" && params.session_id.trim() ? params.session_id.trim() : "";
      const queryId = typeof params?.query_id === "string" && params.query_id.trim() ? params.query_id.trim() : "";
      let domain = pluginCfg.defaultDomain;
      let path = "";
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: "__unused_path", allowEmptyPath: true, label: "uri" }));
        const qs = new URLSearchParams({ domain, path, nav_only: String(navOnly) });
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: "GET" });
        const node = data?.node || {};
        if (queryId && node?.uri) {
          try {
            await fetchJson(pluginCfg, "/browse/recall/usage", {
              method: "POST",
              body: JSON.stringify({
                query_id: queryId,
                session_id: sessionId || "openclaw-embedded",
                node_uris: [node.uri],
                source: "tool:lore_get_node",
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

  api.registerTool({
    name: "lore_search",
    label: "Lore search",
    description: "Find relevant memories by keyword or domain when you need to locate prior knowledge.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query text. Use a meaningful keyword or phrase; passing an empty string or * with a domain filter browses that domain root." }),
      domain: Type.Optional(Type.String({ description: "Optional domain filter to narrow the search." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum number of results (1-100)." })),
      content_limit: Type.Optional(Type.Integer({ minimum: 0, maximum: 20, description: "How many top results include full content (default 5)." })),
    }),
    async execute(_id: any, params: any) {
      const query = String(params?.query || "").trim();
      const domainFilter = typeof params?.domain === "string" && params.domain.trim() ? params.domain.trim() : null;
      const safeLimit = Number.isFinite(params?.limit) ? Math.max(1, Math.min(100, params.limit)) : 10;
      const safeContentLimit = Number.isFinite(params?.content_limit) ? Math.max(0, Math.min(20, params.content_limit)) : 5;
      try {
        if (domainFilter && (!query || query === "*")) {
          const qs = new URLSearchParams({ domain: domainFilter, path: "", nav_only: "true" });
          const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: "GET" });
          const text = `Domain root: ${domainFilter}://\n\n${formatNode(data)}`;
          return textResult(text, { ok: true, mode: "domain_root", domain: domainFilter, node: data?.node, children: data?.children || [] });
        }
        let data;
        if (hasRecallConfig(pluginCfg)) {
          data = await fetchJson(pluginCfg, `/browse/search`, {
            method: "POST",
            body: JSON.stringify({
              query,
              domain: domainFilter,
              limit: safeLimit,
              content_limit: safeContentLimit,
              hybrid: true,
            }),
          });
        } else {
          const qs = new URLSearchParams({ query });
          if (domainFilter) qs.set("domain", domainFilter);
          qs.set("limit", String(safeLimit));
          qs.set("content_limit", String(safeContentLimit));
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
          : `No matching memories found${domainFilter ? ` in domain ${domainFilter}` : ""}.`;
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
    parameters: EmptySchema,
    async execute() {
      try {
        const data = await fetchJson(pluginCfg, "/browse/domains", { method: "GET" });
        const text = Array.isArray(data) && data.length > 0
          ? data.map((item: any) => `- ${item.domain} (${item.root_count}) — open root with lore_get_node uri="${item.domain}://" nav_only=true`).join("\n")
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
    description: "Create a new long-term memory node only when no existing stable node should own the fact. Use stable semantic snake_case URI/title segments. A multi-segment path is a semantic memory tree; every intermediate segment must be a real abstraction parent node with memory content, disclosure, and glossary, so create parents first. Do not append dates, timestamps, or epoch values to ordinary memory paths; put dates in content instead. Date suffixes are only for explicit diary/log/release/archive nodes. Prefer lore_update_node after search/get_node.",
    parameters: Type.Object({
      content: Type.String({ description: "Memory text body." }),
      priority: Type.Integer({ minimum: 0, description: "Importance tier: 0=core identity (max 5), 1=key facts (max 15), 2+=general." }),
      glossary: Type.Array(Type.String({ description: "Search keyword." }), { description: "Initial glossary keywords written with this node create event for later retrieval." }),
      uri: Type.Optional(Type.String({ description: "Optional final stable semantic memory URI. Do not append dates, timestamps, or epoch values for ordinary memories. Intermediate paths must already exist as real abstraction parent nodes with content." })),
      domain: Type.Optional(Type.String({ description: "Target memory domain when you are not using `uri`." })),
      parent_path: Type.Optional(Type.String({ description: "Parent location inside the chosen domain." })),
      title: Type.Optional(Type.String({ description: "Final stable semantic path segment for the new memory; ordinary memories must not end with dates or timestamps." })),
      disclosure: Type.Optional(Type.String({ description: "When this memory should be recalled." })),
    }),
    async execute(_id: any, params: any) {
      const glossary = normalizeKeywordList(params?.glossary);
      const body: any = {
        domain: typeof params?.domain === "string" && params.domain.trim() ? params.domain.trim() : pluginCfg.defaultDomain,
        parent_path: typeof params?.parent_path === "string" ? trimSlashes(params.parent_path) : "",
        content: String(params?.content || ""),
        priority: Number(params?.priority),
        glossary,
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
        const suffix = glossary.length > 0 ? `\nGlossary: ${glossary.join(", ")}` : "";
        return textResult(`Created ${data?.uri || `${body.domain}://${body.parent_path}`}${suffix}`, { ok: true, result: data, glossary });
      } catch (error: any) {
        return textResult(`Lore create failed: ${error.message}`, { ok: false, error: error.message, body, glossary });
      }
    },
  });

  api.registerTool({
    name: "lore_update_node",
    label: "Lore update node",
    description: "Revise an existing long-term memory node. Omitted content, metadata, and glossary mutation fields are left unchanged.",
    parameters: Type.Object({
      uri: UriParam,
      content: Type.Optional(Type.String({ description: "New content to replace the existing content; omit to leave content unchanged." })),
      priority: Type.Optional(Type.Integer({ minimum: 0, description: "New priority level; omit to leave priority unchanged." })),
      disclosure: Type.Optional(Type.String({ description: "New disclosure / trigger condition; omit to leave disclosure unchanged." })),
      glossary_add: Type.Optional(Type.Array(Type.String({ description: "Search keyword." }), { description: "Keywords to add as part of this same node update event." })),
      glossary_remove: Type.Optional(Type.Array(Type.String({ description: "Search keyword." }), { description: "Keywords to remove as part of this same node update event." })),
    }),
    async execute(_id: any, params: any) {
      const body: any = {};
      const glossaryAdd = normalizeKeywordList(params?.glossary_add);
      const glossaryRemove = normalizeKeywordList(params?.glossary_remove);
      if (typeof params?.content === "string") body.content = params.content;
      if (Number.isFinite(params?.priority)) body.priority = params.priority;
      if (typeof params?.disclosure === "string") body.disclosure = params.disclosure;
      if (glossaryAdd.length > 0) body.glossary_add = glossaryAdd;
      if (glossaryRemove.length > 0) body.glossary_remove = glossaryRemove;
      let domain = pluginCfg.defaultDomain;
      let path = "";
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: "__unused_path", allowEmptyPath: false, label: "uri" }));
        const qs = new URLSearchParams({ domain, path });
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: "PUT", body: JSON.stringify(body) });
        const suffixParts: string[] = [];
        if (glossaryAdd.length > 0) suffixParts.push(`glossary+ ${glossaryAdd.join(", ")}`);
        if (glossaryRemove.length > 0) suffixParts.push(`glossary- ${glossaryRemove.join(", ")}`);
        const suffix = suffixParts.length > 0 ? `\n${suffixParts.join("\n")}` : "";
        return textResult(`Updated ${data?.uri || `${domain}://${path}`}${suffix}`, { ok: true, result: data, glossary_add: glossaryAdd, glossary_remove: glossaryRemove });
      } catch (error: any) {
        return textResult(`Lore update failed: ${error.message}`, { ok: false, error: error.message, domain, path, glossary_add: glossaryAdd, glossary_remove: glossaryRemove });
      }
    },
  });

  api.registerTool({
    name: "lore_delete_node",
    label: "Lore delete node",
    description: "Remove a memory path that is obsolete, duplicated, or no longer wanted.",
    parameters: Type.Object({
      uri: UriParam,
    }),
    async execute(_id: any, params: any) {
      let domain = pluginCfg.defaultDomain;
      let path = "";
      try {
        ({ domain, path } = resolveMemoryLocator(params, { defaultDomain: pluginCfg.defaultDomain, pathKey: "__unused_path", allowEmptyPath: false, label: "uri" }));
        const qs = new URLSearchParams({ domain, path });
        const data = await fetchJson(pluginCfg, `/browse/node?${qs.toString()}`, { method: "DELETE" });
        const deletedUri = String(data?.deleted_uri || data?.uri || `${domain}://${path}`).trim();
        const canonicalUri = String(data?.uri || deletedUri).trim();
        const suffix = canonicalUri && canonicalUri !== deletedUri ? ` (canonical: ${canonicalUri})` : "";
        return textResult(`Deleted ${deletedUri}${suffix}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore delete failed: ${error.message}`, { ok: false, error: error.message, domain, path });
      }
    },
  });

  api.registerTool({
    name: "lore_move_node",
    label: "Lore move node",
    description: "Move or rename a memory node to a new URI path. A multi-segment path is a semantic memory tree; the target parent must already be a real abstraction parent node with memory content. The operation reparents the moved node to that parent and updates all child paths automatically.",
    parameters: Type.Object({
      old_uri: Type.String({ description: "Current memory URI to move from." }),
      new_uri: Type.String({ description: "New memory URI to move to. For multi-segment paths, the target parent must already be a real abstraction node with content." }),
    }),
    async execute(_id: any, params: any) {
      const body = {
        old_uri: String(params?.old_uri || "").trim(),
        new_uri: String(params?.new_uri || "").trim(),
      };
      try {
        const data = await fetchJson(pluginCfg, `/browse/move`, { method: "POST", body: JSON.stringify(body) });
        const oldUri = String(data?.old_uri || body.old_uri).trim();
        const newUri = String(data?.new_uri || data?.uri || body.new_uri).trim();
        return textResult(`Moved ${oldUri} → ${newUri}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore move failed: ${error.message}`, { ok: false, error: error.message, body });
      }
    },
  });

}
