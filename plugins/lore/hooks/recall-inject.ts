/**
 * Codex UserPromptSubmit hook: injects <recall> context before each prompt.
 *
 * Receives JSON on stdin: { prompt, session_id, ... }
 * Outputs JSON additionalContext to stdout (Codex appends it as context).
 * Exit code 0 = success, non-zero = skip silently.
 *
 * All recall parameters (min_display_score, max_display_items, etc.) are
 * controlled server-side via /settings. This hook only handles connection
 * config and formatting.
 *
 * Config priority: env var > ~/.config/lore/env > hardcoded default
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_BASE_URL = "http://127.0.0.1:18901";

interface HookInput {
  prompt?: string;
  session_id?: string;
  conversation_id?: string;
  [key: string]: any;
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
    timeoutMs: Number(process.env.LORE_TIMEOUT_MS) || 10000,
    recallEnabled: process.env.LORE_RECALL_ENABLED !== "false",
  };
}

function readCueList(item: any): string[] {
  const cues = Array.isArray(item?.cues) ? item.cues : [];
  return cues.map((x: any) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
}

function formatRecallBlock(items: any[], sessionId?: string, queryId?: string): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const attrs = [sessionId && `session_id="${sessionId}"`, queryId && `query_id="${queryId}"`].filter(Boolean).join(" ");
  const lines = [attrs ? `<recall ${attrs}>` : "<recall>"];
  for (const item of items) {
    const score = Number.isFinite(item?.score_display) ? Number(item.score_display).toFixed(2) : String(item?.score ?? "");
    const cues = readCueList(item);
    const cueText = `${item?.read ? "read · " : ""}${cues.join(" · ")}`.trim();
    lines.push(`${score} | ${item?.uri || ""}${cueText ? ` | ${cueText}` : ""}`);
  }
  lines.push("</recall>");
  return lines.join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.recallEnabled) process.exit(0);

  let input: HookInput;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }

  const prompt = String(input.prompt || "").trim();
  if (!prompt) process.exit(0);

  const sessionId = input.session_id || input.conversation_id || "codex";

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;

    // Only send query + session_id; all display params come from server settings
    const response = await fetch(`${cfg.baseUrl}/api/browse/recall?client_type=codex`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: prompt,
        session_id: sessionId,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    if (!response.ok) process.exit(0);

    const data = await response.json();
    const queryId = data?.event_log?.query_id || "";
    const block = formatRecallBlock(data?.items || [], sessionId, queryId);
    if (block) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: block,
        },
      }));
    }
  } catch {
    // Recall is best-effort; fail silently
  }
}

main();
