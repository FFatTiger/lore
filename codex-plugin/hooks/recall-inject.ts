/**
 * Codex UserPromptSubmit hook: injects <recall> context before each prompt.
 * The backend bridge owns recall formatting and query event metadata.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LORE_CONFIG_FILE = path.join(os.homedir(), ".lore", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:18901";
const CLIENT_TYPE = "codex";

interface HookInput {
  prompt?: string;
  session_id?: string;
  conversation_id?: string;
  [key: string]: any;
}

interface LoreConfig {
  base_url?: string;
  api_token?: string;
}

function readLoreConfig(): LoreConfig {
  try {
    return JSON.parse(fs.readFileSync(LORE_CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function pickString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function loadConfig() {
  const config = readLoreConfig();
  const baseUrl = pickString(config.base_url)
    || pickString(process.env.LORE_BASE_URL)
    || DEFAULT_BASE_URL;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiToken: pickString(config.api_token)
      || pickString(process.env.LORE_API_TOKEN)
      || pickString(process.env.API_TOKEN),
    timeoutMs: 10000,
    recallEnabled: true,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function postBridge(pathname: string, body: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const cfg = loadConfig();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;
  const response = await fetch(`${cfg.baseUrl}/api/bridge/${pathname}?client_type=${CLIENT_TYPE}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  return response.json();
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
    const bridge = await postBridge("recall", { session_id: sessionId, prompt }, cfg.timeoutMs);
    const context = typeof bridge?.context === "string" ? bridge.context.trim() : "";
    if (context) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context,
        },
      }));
    }
  } catch {
    // Recall is best-effort; fail silently.
  }
}

main();
