/**
 * Codex UserPromptSubmit hook: forwards the lifecycle event to Lore.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LORE_CONFIG_FILE = path.join(os.homedir(), ".lore", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:18901";
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

interface HookInput {
  prompt?: string;
  session_id?: string;
  conversation_id?: string;
  [key: string]: any;
}

interface LoreConfig {
  base_url?: string;
  api_token?: string;
  server_profile?: {
    base_url?: string;
    capabilities?: Record<string, boolean>;
  };
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
    timeoutMs: 10000,
    skillsEnabled: resolveSkillsEnabled(config, baseUrl),
  };
}

async function readStdin(): Promise<string> {
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


function formatSkillCandidateBlock(candidates: any[]) {
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const lines = ["<lore-skills>"];
  lines.push("Matched Lore skills. Call lore_skill_get with skill_id to fetch a local copy; managed package files are read-only, and the skill directory stays writable for local outputs.");
  for (const c of candidates) {
    const skillId = String(c?.skill_id || c?.id || "").trim();
    const name = String(c?.name || "").trim();
    if (!skillId || !name) continue;
    const versionRaw = c?.version ?? c?.expected_version;
    const version = versionRaw === undefined || versionRaw === null || versionRaw === "" ? "" : ` v${versionRaw}`;
    const desc = typeof c?.description === "string" && c.description.trim()
      ? ` — ${c.description.replace(/\s+/g, " ").trim()}`
      : "";
    lines.push(`- ${name}${version}${desc}`);
    lines.push(`  skill_id: ${skillId}`);
    if (versionRaw !== undefined && versionRaw !== null && versionRaw !== "") {
      lines.push(`  version: ${versionRaw}`);
    }
  }
  lines.push("</lore-skills>");
  return lines.length > 3 ? lines.join("\n") : "";
}

function appendSkillCandidatesToHostOutput(response: any, enabled = false) {
  try {
    if (!enabled) return response;
    const block = formatSkillCandidateBlock(response?.skill_candidates);
    if (!block) return response;
    const output = response?.host_output;
    if (!output || output.mode === "none" || output.value == null) {
      // Prefer Codex/Claude structured JSON when no memory context was produced.
      return {
        ...response,
        host_output: {
          mode: "stdout_json",
          value: {
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: block,
            },
          },
        },
      };
    }
    if (output.mode === "stdout_text") {
      const existing = String(output.value || "");
      const value = existing.trim() ? `${existing.trim()}\n\n${block}` : block;
      return { ...response, host_output: { ...output, value } };
    }
    if (output.mode === "stdout_json" && output.value && typeof output.value === "object") {
      const value = { ...output.value };
      const hook = value.hookSpecificOutput && typeof value.hookSpecificOutput === "object"
        ? { ...value.hookSpecificOutput }
        : { hookEventName: "UserPromptSubmit" };
      const existing = typeof hook.additionalContext === "string" ? hook.additionalContext : "";
      hook.additionalContext = existing.trim() ? `${existing.trim()}\n\n${block}` : block;
      value.hookSpecificOutput = hook;
      return { ...response, host_output: { ...output, value } };
    }
    return response;
  } catch {
    return response;
  }
}

function writeHostOutput(response: any) {
  const output = response?.host_output;
  if (!output || output.mode === "none" || output.value == null) return;
  if (output.mode === "stdout_json") process.stdout.write(JSON.stringify(output.value));
  if (output.mode === "stdout_text") process.stdout.write(String(output.value));
}

async function main() {
  const cfg = loadConfig();

  let input: HookInput;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }

  const prompt = pickString(input.prompt);
  if (!prompt) process.exit(0);

  const sessionId = resolveSessionId(input);
  const nativeInputSnapshot = buildNativeInputSnapshot(input);
  const normalized: Record<string, string> = { prompt };
  if (sessionId) normalized.session_id = sessionId;

  try {
    const lifecycle = await postLifecycle({
      protocol_version: "lore.lifecycle.v1",
      runtime: { runtime_id: RUNTIME_FAMILY, runtime_family: RUNTIME_FAMILY },
      event: { name: "prompt.submit", native_name: "UserPromptSubmit" },
      normalized,
      ...(nativeInputSnapshot ? { native_input_snapshot: nativeInputSnapshot } : {}),
    }, cfg.timeoutMs);
    writeHostOutput(appendSkillCandidatesToHostOutput(lifecycle, cfg.skillsEnabled));
  } catch {
    // Lore lifecycle is best-effort; fail silently.
  }
}

main();
