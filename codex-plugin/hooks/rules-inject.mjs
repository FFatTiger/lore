/**
 * Codex SessionStart hook: forwards the lifecycle event to Lore.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { syncSkillsToDir } from './vendor/skill-workcopy/index.mjs';

const LORE_CONFIG_FILE = path.join(os.homedir(), '.lore', 'config.json');
const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const BOOT_TIMEOUT_MS = 8000;
// Codex gives the hook 10s; keep the skills sync well under that and
// independent of the lifecycle request's budget.
const SKILLS_SYNC_TIMEOUT_MS = 7000;
const OPENAI_YAML_PATH = 'agents/openai.yaml';
// Codex has no disable-model-invocation frontmatter support; the equivalent is
// an agents/openai.yaml policy file shipped inside the skill package.
const OPENAI_POLICY_YAML = 'policy:\n  allow_implicit_invocation: false\n';
const RUNTIME_FAMILY = 'codex';
const SNAPSHOT_ALLOWLIST = [
  'session_id',
  'conversation_id',
  'source',
  'turn_id',
  'agent_id',
  'agent_type',
  'cwd',
  'model',
  'permission_mode',
  'transcript_path',
];

function readLoreConfig() {
  try {
    return JSON.parse(fs.readFileSync(LORE_CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function pickString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveSessionId(input) {
  return pickString(input.session_id) || pickString(input.conversation_id);
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
  if (process.env.LORE_SKILLS_ENABLED === '0') return false;
  const profile = config?.server_profile;
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    const profileBase = pickString(profile.base_url).replace(/\/+$/, '').toLowerCase();
    if (profileBase === baseUrl.toLowerCase()) {
      return Boolean(profile.capabilities && typeof profile.capabilities === 'object'
        && !Array.isArray(profile.capabilities)
        && profile.capabilities.skills === true);
    }
  }
  return process.env.LORE_SKILLS_ENABLED === '1';
}

function loadConfig() {
  const config = readLoreConfig();
  const baseUrl = (pickString(process.env.LORE_CODEX_HOOK_BASE_URL)
    || pickString(config.base_url)
    || pickString(process.env.LORE_BASE_URL)
    || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    baseUrl,
    apiToken: pickString(config.api_token)
      || pickString(process.env.LORE_API_TOKEN)
      || pickString(process.env.API_TOKEN),
    skillsEnabled: resolveSkillsEnabled(config, baseUrl),
  };
}

function resolvePluginVersion() {
  const hookDir = path.dirname(fileURLToPath(import.meta.url));
  // Repo/marketplace layout keeps the manifest under .codex-plugin; the legacy
  // user-level hooks layout gets a plugin.json copy next to the hooks dir.
  for (const manifestPath of [path.join(hookDir, '..', '.codex-plugin', 'plugin.json'), path.join(hookDir, '..', 'plugin.json')]) {
    try {
      const version = pickString(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))?.version);
      if (version) return version;
    } catch {}
  }
  return '';
}

function lifecycleRuntime() {
  const runtime = { runtime_id: RUNTIME_FAMILY, runtime_family: RUNTIME_FAMILY };
  const pluginVersion = resolvePluginVersion();
  if (pluginVersion) runtime.plugin_version = pluginVersion;
  return runtime;
}

function detectProjectInfo() {
  const dir_name = path.basename(process.cwd());
  let repo_name = null;
  try {
    const remote = execSync('git remote', { encoding: 'utf-8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
    const remoteUrl = execSync(`git remote get-url ${remote}`, {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = remoteUrl.match(/\/([^/.]+?)(?:\.git)?$/);
    if (match?.[1]) repo_name = match[1];
  } catch {}
  return { dir_name, repo_name };
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function postLifecycle(body, timeoutMs) {
  const cfg = loadConfig();
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;
  const response = await fetch(`${cfg.baseUrl}/api/lifecycle/event`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  return response.json();
}

function writeHostOutput(response) {
  const output = response?.host_output;
  if (!output || output.mode === 'none' || output.value == null) return;
  if (output.mode === 'stdout_json') process.stdout.write(JSON.stringify(output.value));
  if (output.mode === 'stdout_text') process.stdout.write(String(output.value));
}

function resolvePluginRoot() {
  // The marketplace layout runs this hook in place (<pluginRoot>/hooks), but
  // install-hooks.sh copies it elsewhere; the installer pins the real root via
  // LORE_CODEX_PLUGIN_ROOT so the skills/ target is never a guessed path.
  const fromEnv = pickString(process.env.LORE_CODEX_PLUGIN_ROOT);
  if (fromEnv) return fromEnv;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function adaptCodexSkill(detail) {
  if (!detail || !detail.disable_model_invocation) return detail;
  const files = Array.isArray(detail.files) ? detail.files : [];
  if (files.some((file) => file && file.path === OPENAI_YAML_PATH)) return detail;
  return {
    ...detail,
    files: [...files, { path: OPENAI_YAML_PATH, content: OPENAI_POLICY_YAML }],
  };
}

async function fetchSkillsJson(baseUrl, apiToken, skillPath, signal) {
  const url = new URL(`/api/skills${skillPath}`, `${baseUrl}/`);
  url.searchParams.set('client_type', 'codex');
  const headers = {};
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new Error(`skills request failed: ${response.status}`);
  return response.json();
}

/**
 * Sync the server catalog into the plugin's own skills/ directory so Codex
 * discovers Lore skills natively ($name and /skills). Bundled skills without a
 * Lore marker (skills/lore-memory) are expected conflicts and stay untouched.
 * Failures are silent (single stderr line) and never affect boot output.
 */
async function runSkillsSync() {
  const pluginRoot = resolvePluginRoot();
  const { baseUrl, apiToken } = loadConfig();
  const signal = AbortSignal.timeout(SKILLS_SYNC_TIMEOUT_MS);
  // include_user_only: user-trigger-only skills must still be discovered by the host.
  const catalog = await fetchSkillsJson(baseUrl, apiToken, '?include_user_only=true', signal);
  const skills = Array.isArray(catalog?.skills) ? catalog.skills : [];
  const projectId = pickString(catalog?.project_id);
  if (!projectId) return;
  await syncSkillsToDir({
    root: path.join(pluginRoot, 'skills'),
    projectId,
    skills,
    loadSkill: (skillId) => fetchSkillsJson(baseUrl, apiToken, `/${encodeURIComponent(skillId)}`, signal),
    adapt: adaptCodexSkill,
  });
}

async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {}

  const sessionId = resolveSessionId(input);
  const nativeInputSnapshot = buildNativeInputSnapshot(input);
  const { skillsEnabled } = loadConfig();
  const lifecyclePromise = postLifecycle({
    protocol_version: 'lore.lifecycle.v1',
    runtime: lifecycleRuntime(),
    event: { name: 'session.start', native_name: 'SessionStart' },
    normalized: sessionId ? { session_id: sessionId } : {},
    project: detectProjectInfo(),
    ...(nativeInputSnapshot ? { native_input_snapshot: nativeInputSnapshot } : {}),
  }, BOOT_TIMEOUT_MS).catch(() => null);
  // Skills sync runs next to the lifecycle request (host skills are discovered
  // natively, so the lifecycle call no longer advertises features.skills).
  const skillsPromise = skillsEnabled
    ? runSkillsSync().catch((error) => {
      process.stderr.write(`lore: skills sync skipped (${error instanceof Error ? error.message : String(error)})\n`);
    })
    : Promise.resolve();

  const lifecycle = await lifecyclePromise;
  writeHostOutput(lifecycle);
  await skillsPromise;
}

main();
