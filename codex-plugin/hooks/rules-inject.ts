/**
 * Codex SessionStart hook: forwards the lifecycle event to Lore.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const LORE_CONFIG_FILE = path.join(os.homedir(), ".lore", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:18901";
const BOOT_TIMEOUT_MS = 8000;
const RUNTIME_FAMILY = "codex";
const SNAPSHOT_ALLOWLIST = [
  "session_id",
  "conversation_id",
  "source",
  "turn_id",
  "agent_id",
  "agent_type",
  "cwd",
  "model",
  "permission_mode",
  "transcript_path",
] as const;

interface LoreConfig {
  base_url?: string;
  api_token?: string;
  server_profile?: {
    base_url?: string;
    capabilities?: Record<string, boolean>;
  };
}

interface HookInput {
  session_id?: string;
  conversation_id?: string;
  [key: string]: any;
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

function resolveSessionId(input: HookInput): string {
  return pickString(input.session_id) || pickString(input.conversation_id);
}

function buildNativeInputSnapshot(input: HookInput): Record<string, string> | undefined {
  const snapshot: Record<string, string> = {};
  for (const key of SNAPSHOT_ALLOWLIST) {
    const value = pickString(input[key]);
    if (value) snapshot[key] = value;
  }
  return Object.keys(snapshot).length ? snapshot : undefined;
}

function resolveSkillsEnabled(config: LoreConfig, baseUrl: string): boolean {
  if (process.env.LORE_SKILLS_ENABLED === "0") return false;
  const profileBase = pickString(config.server_profile?.base_url).replace(/\/+$/, "").toLowerCase();
  if (profileBase === baseUrl.toLowerCase()) {
    return config.server_profile?.capabilities?.skills === true;
  }
  return process.env.LORE_SKILLS_ENABLED === "1";
}

function loadConfig() {
  const config = readLoreConfig();
  const baseUrl = (pickString(process.env.LORE_CODEX_HOOK_BASE_URL)
    || pickString(config.base_url)
    || pickString(process.env.LORE_BASE_URL)
    || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    baseUrl,
    apiToken: pickString(config.api_token)
      || pickString(process.env.LORE_API_TOKEN)
      || pickString(process.env.API_TOKEN),
    skillsEnabled: resolveSkillsEnabled(config, baseUrl),
  };
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

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function postLifecycle(body: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const cfg = loadConfig();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;
  const response = await fetch(`${cfg.baseUrl}/api/lifecycle/event`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  return response.json();
}

function writeHostOutput(response: any) {
  const output = response?.host_output;
  if (!output || output.mode === "none" || output.value == null) return;
  if (output.mode === "stdout_json") process.stdout.write(JSON.stringify(output.value));
  if (output.mode === "stdout_text") process.stdout.write(String(output.value));
}

async function main() {
  let input: HookInput = {};
  try {
    const raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {}

  const sessionId = resolveSessionId(input);
  const nativeInputSnapshot = buildNativeInputSnapshot(input);
  const { skillsEnabled } = loadConfig();
  const lifecycle = await postLifecycle({
    protocol_version: "lore.lifecycle.v1",
    runtime: { runtime_id: RUNTIME_FAMILY, runtime_family: RUNTIME_FAMILY },
    event: { name: "session.start", native_name: "SessionStart" },
    normalized: sessionId ? { session_id: sessionId } : {},
    project: detectProjectInfo(),
    // Lore appends the Skills catalog only for clients that expose Skills tools.
    ...(skillsEnabled ? { features: { skills: true } } : {}),
    ...(nativeInputSnapshot ? { native_input_snapshot: nativeInputSnapshot } : {}),
  }, BOOT_TIMEOUT_MS).catch(() => null);

  writeHostOutput(lifecycle);
}

main();
