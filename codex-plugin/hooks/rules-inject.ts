/**
 * Codex SessionStart hook: injects Lore guidance + backend bridge startup context.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const LORE_CONFIG_FILE = path.join(os.homedir(), ".lore", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:18901";
const BOOT_TIMEOUT_MS = 8000;
const CLIENT_TYPE = "codex";

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
  };
}

function resolveRulesPath(): string {
  const pluginRoot = process.env.LORE_CODEX_PLUGIN_ROOT;
  if (pluginRoot) return path.join(pluginRoot, "rules", "lore-guidance.md");
  return path.resolve(process.cwd(), "rules", "lore-guidance.md");
}

interface ProjectInfo {
  dir_name: string;
  repo_name: string | null;
}

function detectProjectInfo(): ProjectInfo {
  const dir_name = path.basename(process.cwd());
  let repo_name: string | null = null;
  try {
    const remote = execSync("git remote", { encoding: "utf-8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n")[0];
    const remoteUrl = execSync(`git remote get-url ${remote}`, {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remoteUrl.match(/\/([^/.]+?)(?:\.git)?$/);
    if (match?.[1]) repo_name = match[1];
  } catch {}
  return { dir_name, repo_name };
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
  let rules = "";
  try {
    rules = fs.readFileSync(resolveRulesPath(), "utf-8").trim();
  } catch {}

  const bridge = await postBridge("startup", {
    channel: CLIENT_TYPE,
    project: detectProjectInfo(),
    include_guidance: false,
  }, BOOT_TIMEOUT_MS).catch(() => null);

  const parts = [
    rules,
    typeof bridge?.boot_context === "string" ? bridge.boot_context : "",
    typeof bridge?.startup_recall_context === "string" ? bridge.startup_recall_context : "",
  ].map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: parts.join("\n\n"),
    },
  }));
}

main();
