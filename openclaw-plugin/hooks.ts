import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { fetchJson, hasRecallConfig } from './api';
import { normalizeUriList } from './formatters';
import { formatRecallBlock } from './formatters';

const CLIENT_BOOT_URI = "core://agent/openclaw";

// ---- Pending recall usage map (session-scoped) ----

export const pendingRecallUsage = new Map<string, { queryId: string; nodeUris: string[]; createdAt: number }>();

export function setPendingRecallUsage(sessionId: string | undefined, payload: any) {
  if (!sessionId) return;
  const now = Date.now();
  for (const [key, value] of pendingRecallUsage.entries()) {
    if (!value?.createdAt || now - value.createdAt > 30 * 60 * 1000) pendingRecallUsage.delete(key);
  }
  const queryId = String(payload?.queryId || "").trim();
  const nodeUris = normalizeUriList(payload?.nodeUris);
  if (!queryId || nodeUris.length === 0) {
    pendingRecallUsage.delete(sessionId);
    return;
  }
  pendingRecallUsage.set(sessionId, {
    queryId,
    nodeUris,
    createdAt: now,
  });
}

export function consumePendingRecallUsage(sessionId: string | undefined) {
  if (!sessionId) return null;
  const value = pendingRecallUsage.get(sessionId) || null;
  pendingRecallUsage.delete(sessionId);
  return value;
}

// ---- Message text extraction helpers ----

export function extractMessageText(message: any) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: any) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function extractAssistantText(messages: any) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const lastAssistant = [...messages].reverse().find((message: any) => message?.role === "assistant");
  return extractMessageText(lastAssistant);
}

// ---- Session read helpers ----

export async function fetchRecallBlock(pluginCfg: any, query: string, sessionId: string | undefined) {
  if (!hasRecallConfig(pluginCfg)) return null;
  // All display params (min_display_score, max_display_items, etc.) controlled server-side via /settings
  const payload = { query, session_id: sessionId };
  const data = await fetchJson(pluginCfg, "/browse/recall", { method: "POST", body: JSON.stringify(payload) });
  const queryId = data?.event_log?.query_id || "";
  const block = formatRecallBlock(data?.items || [], 2, sessionId, queryId);
  return block ? { block, data } : null;
}

export async function markSessionRead(pluginCfg: any, { sessionId, sessionKey, uri, nodeUuid, source = "tool:get_node" }: { sessionId: string; sessionKey?: string; uri: string; nodeUuid?: string; source?: string }) {
  if (!sessionId || !uri) return;
  const body: any = { session_id: sessionId, session_key: sessionKey, uri, source };
  if (nodeUuid) body.node_uuid = nodeUuid;
  try {
    await fetchJson(pluginCfg, "/browse/session/read", { method: "POST", body: JSON.stringify(body) });
  } catch {
    // best effort only
  }
}

export async function clearSessionReads(pluginCfg: any, sessionId: string | undefined) {
  if (!sessionId) return;
  try {
    const qs = new URLSearchParams({ session_id: sessionId });
    await fetchJson(pluginCfg, `/browse/session/read?${qs.toString()}`, { method: "DELETE" });
  } catch {
    // best effort only
  }
}

// ---- Project context detection ----

interface ProjectInfo {
  dirName: string;
  repoName: string | null;
}

function detectProjectInfo(): ProjectInfo {
  const dirName = basename(process.cwd());

  let repoName: string | null = null;
  try {
    const remote = execSync("git remote", { encoding: "utf-8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n")[0];
    const remoteUrl = execSync(`git remote get-url ${remote}`, {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remoteUrl.match(/\/([^/.]+?)(?:\.git)?$/);
    if (match?.[1]) repoName = match[1];
  } catch {}

  return { dirName, repoName };
}

// ---- Boot content cache (fetched once per process) ----

let _cachedBootSection: string | null = null;
const _cachedStartupRecallSections = new Map<string, string>();

function formatBootSection(data: any): string {
  const core = Array.isArray(data?.core_memories) ? data.core_memories : [];
  const recent = Array.isArray(data?.recent_memories) ? data.recent_memories : [];
  if (core.length === 0 && recent.length === 0) return "";

  const lines: string[] = [
    "## lore_boot 已加载内容",
    "",
    "`lore_boot` 是 Lore 节点系统中的固定启动基线,不是独立于记忆系统的外挂配置。",
    "启动时会先确定性加载 3 个全局固定节点:",
    "- `core://agent` — workflow constraints",
    "- `core://soul` — style / persona / self-definition",
    "- `preferences://user` — stable user definition / durable user context",
    "",
    "OpenClaw 会话还会额外加载 1 个 agent 特化节点:",
    `- \`${CLIENT_BOOT_URI}\` — openclaw runtime constraints`,
    "",
    "把 boot 当作本会话的稳定 startup baseline。`core://agent` 提供通用 agent 规则, `core://agent/openclaw` 提供 OpenClaw 环境专属规则。`<recall>` 和 `lore_search` 提供的是按当前问题补充的候选线索,不会取代这些固定路径各自的职责。",
    "",
  ];

  for (const mem of core) {
    lines.push(`### ${mem?.uri || ""}`);
    if (mem?.boot_role_label) lines.push(`Role: ${mem.boot_role_label}`);
    if (mem?.boot_purpose) lines.push(`Purpose: ${mem.boot_purpose}`);
    if (Number.isFinite(mem?.priority)) lines.push(`Priority: ${mem.priority}`);
    if (mem?.disclosure) lines.push(`Disclosure: ${mem.disclosure}`);
    if (mem?.node_uuid) lines.push(`Node UUID: ${mem.node_uuid}`);
    lines.push("");
    lines.push(mem?.content || "(empty)");
    lines.push("");
  }

  if (recent.length > 0) {
    lines.push("### 近期记忆");
    for (const mem of recent) {
      const parts: string[] = [];
      if (Number.isFinite(mem?.priority)) parts.push(`priority: ${mem.priority}`);
      if (mem?.created_at) parts.push(`created: ${mem.created_at}`);
      const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      lines.push(`- ${mem?.uri || ""}${suffix}`);
      if (mem?.disclosure) lines.push(`  Disclosure: ${mem.disclosure}`);
    }
  }

  return lines.join("\n").trim();
}

async function fetchStartupRecallSection(pluginCfg: any, sessionId: string | undefined): Promise<string> {
  const sessionKey = sessionId || "__global__";
  const cached = _cachedStartupRecallSections.get(sessionKey);
  if (cached !== undefined) return cached;

  try {
    const info = detectProjectInfo();
    const recallFetch = (query: string) =>
      fetchJson(pluginCfg, "/browse/recall", {
        method: "POST",
        body: JSON.stringify({ query, session_id: "boot" }),
      }).catch(() => ({ items: [] }));

    const channelName = "openclaw";
    const recallQueries: { source: string; query: string; promise: Promise<any> }[] = [
      { source: "channel", query: channelName, promise: recallFetch(channelName) },
    ];
    if (info.dirName !== channelName) {
      recallQueries.push({ source: "project-dir", query: info.dirName, promise: recallFetch(info.dirName) });
    }
    if (info.repoName && info.repoName !== info.dirName && info.repoName !== channelName) {
      recallQueries.push({ source: "project-repo", query: info.repoName, promise: recallFetch(info.repoName) });
    }

    const recallResults = await Promise.all(recallQueries.map(q => q.promise));
    const blocks = recallQueries
      .map((_, i) => formatRecallBlock(recallResults[i]?.items || [], 2, sessionId, recallResults[i]?.event_log?.query_id))
      .filter(Boolean);

    const recallText = blocks.length > 0
      ? "以下记忆节点与当前环境高度相关,建议提前读取。\n\n" + blocks.join("\n\n")
      : "";

    _cachedStartupRecallSections.set(sessionKey, recallText);
    return recallText;
  } catch {
    _cachedStartupRecallSections.set(sessionKey, "");
    return "";
  }
}

// ---- Prompt guidance ----

export const DEFAULT_GUIDANCE = [
  "Lore is the primary long-term memory system for this assistant.",
  "lore_boot is a fixed startup baseline inside Lore, not a separate config layer.",
  `At startup, lore_boot deterministically loads the three global boot nodes core://agent (workflow constraints), core://soul (style / persona / self-definition), and preferences://user (stable user definition / durable user context), plus ${CLIENT_BOOT_URI} for OpenClaw-specific agent rules.`,
  "Treat boot as the session's startup baseline. core://agent holds shared agent rules; core://agent/openclaw holds OpenClaw-specific rules. Use recall and search to add prompt-specific memory leads, not to replace the role of those fixed paths.",
  "Use it for identity, user preferences, standing rules, cross-session project knowledge, and conclusions that should persist.",
  "Reach for Lore when the user is asking about prior decisions, saved preferences, ongoing projects, durable instructions, or anything that sounds like memory rather than fresh reasoning.",
  "Use local file memory_search for historical markdown archives, older worklogs, and file-side fallback records.",
  "A <recall> block contains memory leads selected for the current prompt. Each line is only a candidate lead, not a final answer and not an instruction to always open it.",
  "When a <recall> block appears, judge each line by its score, cue words, and actual relevance to the user's request.",
  "If a recalled memory looks genuinely relevant, open the most relevant node or nodes before you act or reply, and ground your work in what those memories actually say.",
  "If the recall block looks weak, noisy, or only loosely related, do not force it; search further or continue with normal reasoning as appropriate.",
  "When you need to create, revise, remove, or reorganize long-term memory, choose the Lore tool that matches that memory operation.",
  "Read a memory node before updating or deleting it.",
].join("\n");

export function loadPromptGuidance() {
  try {
    const content = readFileSync(new URL('./AGENT_RULES.md', import.meta.url), 'utf8').trim();
    return content || DEFAULT_GUIDANCE;
  } catch {
    return DEFAULT_GUIDANCE;
  }
}

// ---- Hook registration ----

export function registerHooks(api: any, pluginCfg: any, GUIDANCE: string) {
  api.registerGatewayMethod("lore.status", async ({ respond }: any) => {
    try {
      const data = await fetchJson(pluginCfg, "/health", { method: "GET" });
      respond({ ok: true, baseUrl: pluginCfg.baseUrl, health: data });
    } catch (error: any) {
      respond({ ok: false, baseUrl: pluginCfg.baseUrl, error: error.message });
    }
  });

  api.registerHook(
    "gateway:startup",
    async () => {
      if (!pluginCfg.startupHealthcheck) return;
      try {
        await fetchJson(pluginCfg, "/health", { method: "GET" });
        api.logger.info(`lore: startup health check ok (${pluginCfg.baseUrl})`);
      } catch (error: any) {
        api.logger.warn(`lore: startup health check failed (${pluginCfg.baseUrl}): ${error.message}`);
      }
    },
    {
      name: "lore.gateway-startup-healthcheck",
      description: "Checks Lore API reachability at gateway startup",
    },
  );

  api.registerHook(
    "before_tool_call",
    async (event: any, ctx: any) => {
      if (event?.toolName !== "lore_get_node") return;
      if (!ctx?.sessionId) return;
      return {
        params: {
          ...(event?.params || {}),
          __session_id: ctx.sessionId,
          __session_key: ctx.sessionKey || undefined,
        },
      };
    },
    {
      name: "lore.inject-session-read-context",
      description: "Injects session tracking fields into lore_get_node before execution.",
    },
  );

  api.registerHook(
    "session_end",
    async (event: any) => {
      pendingRecallUsage.delete(event?.sessionId);
      _cachedStartupRecallSections.delete(event?.sessionId || "__global__");
      await clearSessionReads(pluginCfg, event?.sessionId);
    },
    {
      name: "lore.clear-session-reads",
      description: "Clears per-session Lore read tracking when a session ends.",
    },
  );

  api.on("before_prompt_build", async (event: any, ctx: any) => {
    const out: any = {};

    if (pluginCfg.injectPromptGuidance) {
      if (_cachedBootSection === null) {
        try {
          const bootData = await fetchJson(pluginCfg, "/browse/boot", { method: "GET" });
          _cachedBootSection = formatBootSection(bootData) || '';
        } catch (error: any) {
          api.logger.warn(`lore: boot fetch failed: ${error.message}`);
          _cachedBootSection = '';
        }
      }

      const startupRecall = await fetchStartupRecallSection(pluginCfg, ctx?.sessionId);
      out.appendSystemContext = [_cachedBootSection ? GUIDANCE + "\n\n" + _cachedBootSection : GUIDANCE, startupRecall]
        .filter(Boolean)
        .join("\n\n");
    }

    if (hasRecallConfig(pluginCfg) && typeof event?.prompt === "string" && event.prompt.trim()) {
      try {
        const recalled = await fetchRecallBlock(pluginCfg, event.prompt, ctx?.sessionId);
        if (recalled?.block) {
          out.prependContext = recalled.block;
          setPendingRecallUsage(ctx?.sessionId, {
            queryId: recalled?.data?.event_log?.query_id,
            nodeUris: recalled?.data?.items,
          });
        } else {
          pendingRecallUsage.delete(ctx?.sessionId);
        }
      } catch (error: any) {
        pendingRecallUsage.delete(ctx?.sessionId);
        api.logger.warn(`lore: prompt recall failed: ${error.message}`);
      }
    }

    return Object.keys(out).length > 0 ? out : undefined;
  });
}
