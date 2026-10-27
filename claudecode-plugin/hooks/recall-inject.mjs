/**
 * Claude Code UserPromptSubmit hook: forwards the lifecycle event to Lore.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const LORE_CONFIG_FILE = path.join(os.homedir(), ".lore", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:18901";
const RUNTIME_FAMILY = "claudecode";
const SNAPSHOT_ALLOWLIST = [
  "session_id",
  "conversation_id",
  "hook_event_name",
  "cwd",
  "permission_mode",
  "transcript_path",
  "source",
];

function readLoreConfig() {
  try {
    return JSON.parse(fs.readFileSync(LORE_CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function pickString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function resolveSessionId(input) {
  return pickString(input.session_id) || pickString(input.conversation_id);
}

function resolvePrompt(input) {
  return pickString(input.prompt) || pickString(input.user_prompt);
}

function buildNativeInputSnapshot(input) {
  const snapshot = {};
  for (const key of SNAPSHOT_ALLOWLIST) {
    const value = pickString(input[key]);
    if (value) snapshot[key] = value;
  }
  return Object.keys(snapshot).length ? snapshot : undefined;
}

function resolveSkillsEnabled(config, baseUrl) {
  if (process.env.LORE_SKILLS_ENABLED === "0") return false;
  const profileBase = pickString(config.server_profile?.base_url).replace(/\/+$/, "").toLowerCase();
  if (profileBase === baseUrl.toLowerCase()) {
    return config.server_profile?.capabilities?.skills === true;
  }
  return process.env.LORE_SKILLS_ENABLED === "1";
}

function resolvePluginVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"),
      "utf-8",
    ));
    return pickString(manifest?.version) || undefined;
  } catch {
    return undefined;
  }
}

function lifecycleRuntime() {
  const runtime = { runtime_id: RUNTIME_FAMILY, runtime_family: RUNTIME_FAMILY };
  const pluginVersion = resolvePluginVersion();
  if (pluginVersion) runtime.plugin_version = pluginVersion;
  return runtime;
}

function loadConfig() {
  const config = readLoreConfig();
  const baseUrl = (pickString(config.base_url)
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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function postLifecycle(body, timeoutMs) {
  const cfg = loadConfig();
  const headers = { "content-type": "application/json" };
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


function writeHostOutput(response) {
  const output = response?.host_output;
  if (!output || output.mode === "none" || output.value == null) return;
  if (output.mode === "stdout_json") process.stdout.write(JSON.stringify(output.value));
  if (output.mode === "stdout_text") process.stdout.write(String(output.value));
}

async function main() {
  const cfg = loadConfig();

  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }

  const prompt = resolvePrompt(input);
  if (!prompt) process.exit(0);

  const sessionId = resolveSessionId(input);
  const nativeInputSnapshot = buildNativeInputSnapshot(input);
  const normalized = { prompt };
  if (sessionId) normalized.session_id = sessionId;

  try {
    const lifecycle = await postLifecycle({
      protocol_version: "lore.lifecycle.v1",
      runtime: lifecycleRuntime(),
      event: { name: "prompt.submit", native_name: "UserPromptSubmit" },
      normalized,
      ...(nativeInputSnapshot ? { native_input_snapshot: nativeInputSnapshot } : {}),
    }, cfg.timeoutMs);
    writeHostOutput(lifecycle);
  } catch {
    // Lore lifecycle is best-effort; fail silently.
  }
}

main();
