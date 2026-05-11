/**
 * Codex SessionStart hook: injects Lore guidance + boot baseline +
 * startup recall context into the session on startup.
 *
 * 1. Reads rules/lore-guidance.md (behavioral guidance)
 * 2. Calls Lore boot API for the fixed boot baseline inside Lore
 * 3. Appends startup boot content and environment recall as loaded context
 *
 * Boot is best-effort: if the API call fails, guidance is still injected.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const DEFAULT_BASE_URL = "http://127.0.0.1:18901";
const BOOT_TIMEOUT_MS = 8000;
const CLIENT_BOOT_URI = "core://agent/codex";

function resolveRulesPath(): string {
  const pluginRoot = process.env.LORE_CODEX_PLUGIN_ROOT;
  if (pluginRoot) {
    return path.join(pluginRoot, "rules", "lore-guidance.md");
  }
  return path.resolve(process.cwd(), "rules", "lore-guidance.md");
}

function readConfigFile(): Record<string, string> {
  const files = [
    path.join(os.homedir(), ".config", "lore", "env"),
  ];
  for (const f of files) {
    try {
      const text = fs.readFileSync(f, "utf-8");
      const result: Record<string, string> = {};
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
      return result;
    } catch {}
  }
  return {};
}

function loadConfig() {
  const fileConfig = readConfigFile();
  return {
    baseUrl: (process.env.LORE_BASE_URL || fileConfig.LORE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
    apiToken: process.env.LORE_API_TOKEN || fileConfig.LORE_API_TOKEN || process.env.API_TOKEN || "",
  };
}

interface BootMemory {
  uri?: string;
  content?: string;
  priority?: number;
  disclosure?: string | null;
  node_uuid?: string;
  created_at?: string | null;
  boot_role_label?: string;
  boot_purpose?: string;
  scope?: string;
  client_type?: string | null;
}

interface BootResponse {
  loaded?: number;
  total?: number;
  failed?: string[];
  core_memories?: BootMemory[];
  recent_memories?: BootMemory[];
}

function formatBootSection(data: BootResponse): string {
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
    "Codex 会话还会额外加载 1 个 agent 特化节点:",
    `- \`${CLIENT_BOOT_URI}\` — codex runtime constraints`,
    "",
    "把 boot 当作本会话的稳定 startup baseline。`core://agent` 提供通用 agent 规则, `core://agent/codex` 提供 Codex 环境专属规则。`<recall>` 和 `lore_search` 提供的是按当前问题补充的候选线索,不会取代这些固定路径各自的职责。",
    "",
  ];

  for (const mem of core) {
    lines.push(`### ${mem.uri || ""}`);
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

// ---- Project context detection ----

interface ProjectInfo {
  dirName: string;
  repoName: string | null;
}

function detectProjectInfo(): ProjectInfo {
  const dirName = path.basename(process.cwd());

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

async function fetchRecallItems(query: string): Promise<any> {
  const cfg = loadConfig();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;

  const response = await fetch(`${cfg.baseUrl}/api/browse/recall?client_type=codex`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, session_id: "boot" }),
    signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
  });

  if (!response.ok) return { items: [] };
  const data = await response.json();
  return data || { items: [] };
}

function formatRecallTag(items: any[], sessionId?: string, queryId?: string): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const attrs = [sessionId && `session_id="${sessionId}"`, queryId && `query_id="${queryId}"`].filter(Boolean).join(" ");
  const lines = [attrs ? `<recall ${attrs}>` : "<recall>"];
  for (const item of items) {
    const score = Number.isFinite(item?.score_display)
      ? Number(item.score_display).toFixed(2)
      : String(item?.score ?? "");
    const cues = Array.isArray(item?.cues)
      ? item.cues.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 3)
      : [];
    const cueText = cues.join(" · ");
    lines.push(`${score} | ${item?.uri || ""}${cueText ? ` | ${cueText}` : ""}`);
  }
  lines.push("</recall>");
  return lines.join("\n");
}

async function fetchInitialRecalls(info: ProjectInfo): Promise<string> {
  const channelName = "codex";
  const queries: { source: string; query: string }[] = [
    { source: "channel", query: channelName },
  ];
  if (info.dirName !== channelName) {
    queries.push({ source: "project-dir", query: info.dirName });
  }
  if (info.repoName && info.repoName !== info.dirName && info.repoName !== channelName) {
    queries.push({ source: "project-repo", query: info.repoName });
  }

  const results = await Promise.all(
    queries.map(q =>
      fetchRecallItems(q.query)
        .then(data => ({ ...q, data }))
        .catch(() => ({ ...q, data: { items: [] } })),
    ),
  );

  const blocks = results
    .map(r => formatRecallTag(r.data?.items || [], "boot", r.data?.event_log?.query_id))
    .filter(Boolean);
  if (blocks.length === 0) return "";

  return "以下记忆节点与当前环境高度相关,建议提前读取。\n\n" + blocks.join("\n\n");
}

// ---- Boot content ----

async function fetchBoot(): Promise<string> {
  const cfg = loadConfig();
  const headers: Record<string, string> = {};
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;

  const url = `${cfg.baseUrl}/api/browse/boot?client_type=codex`;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
  });

  if (!response.ok) return "";
  const data: BootResponse = await response.json();
  return formatBootSection(data);
}

async function main() {
  // 1. Load static guidance (always)
  const rulesPath = resolveRulesPath();
  let rules = "";
  try {
    rules = fs.readFileSync(rulesPath, "utf-8").trim();
  } catch {
    // Silent: guidance file missing
  }

  // 2. Fetch boot content and initial recalls in parallel (best-effort)
  const projectInfo = detectProjectInfo();
  const [boot, recall] = await Promise.all([
    fetchBoot().catch(() => ""),
    fetchInitialRecalls(projectInfo).catch(() => ""),
  ]);

  // 4. Guidance first, boot content, then initial recall
  const parts = [rules, boot, recall].filter(Boolean);
  if (parts.length === 0) process.exit(0);

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: parts.join("\n\n"),
    },
  };

  process.stdout.write(JSON.stringify(output));
}

main();
