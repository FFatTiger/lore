#!/usr/bin/env node
/**
 * Background Lore skills sync for the Codex plugin.
 *
 * The SessionStart hook spawns this script detached (stdio: 'ignore') so the
 * hook can write its lifecycle output and exit immediately - Codex only
 * discovers new skills in the next session anyway, so waiting buys nothing.
 * The outcome of the last run is recorded in
 * <pluginRoot>/skills/.lore-sync-status.json (atomic tmp + rename).
 *
 * The plugin root comes from LORE_CODEX_PLUGIN_ROOT (pinned by the installer;
 * install-hooks.sh forwards it to the copied-out location) and falls back to
 * this script's own location, which is the real plugin root in the
 * marketplace layout.
 *
 * Total runtime is bounded by SYNC_TIMEOUT_MS; the explicit process.exit keeps
 * lingering keep-alive sockets from holding the process open after a timeout.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncSkillsToDir } from './vendor/skill-workcopy/index.mjs';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const SYNC_TIMEOUT_MS = 120000;
const STATUS_FILE = '.lore-sync-status.json';
const OPENAI_YAML_PATH = 'agents/openai.yaml';
// Codex has no disable-model-invocation frontmatter support; the equivalent is
// an agents/openai.yaml policy file shipped inside the skill package.
const OPENAI_POLICY_YAML = 'policy:\n  allow_implicit_invocation: false\n';
// Bundled static skill without a Lore marker: an expected conflict, kept out of
// the recorded conflicts to avoid noisy status files.
const BUNDLED_SKILLS = ['lore-memory'];

function pickString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolvePluginRoot() {
  const fromEnv = pickString(process.env.LORE_CODEX_PLUGIN_ROOT);
  if (fromEnv) return fromEnv;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function loadConnection() {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.lore', 'config.json'), 'utf-8'));
  } catch { /* best-effort */ }
  return {
    baseUrl: (pickString(process.env.LORE_CODEX_HOOK_BASE_URL)
      || pickString(config.base_url)
      || pickString(process.env.LORE_BASE_URL)
      || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiToken: pickString(config.api_token)
      || pickString(process.env.LORE_API_TOKEN)
      || pickString(process.env.API_TOKEN),
  };
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

function writeStatusFile(root, status) {
  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(root, `${STATUS_FILE}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, path.join(root, STATUS_FILE));
}

async function main() {
  const root = path.join(resolvePluginRoot(), 'skills');
  const status = {
    finished_at: '',
    project_id: '',
    catalog_revision: '',
    created: [],
    updated: [],
    unchanged: [],
    removed: [],
    conflicts: [],
    errors: [],
  };
  try {
    const { baseUrl, apiToken } = loadConnection();
    // One deadline covers the whole run: catalog + every skill detail.
    const signal = AbortSignal.timeout(SYNC_TIMEOUT_MS);
    // include_user_only: user-trigger-only skills must still be discovered by the host.
    const catalog = await fetchSkillsJson(baseUrl, apiToken, '?include_user_only=true', signal);
    status.project_id = pickString(catalog?.project_id);
    status.catalog_revision = catalog?.catalog_revision === undefined || catalog?.catalog_revision === null
      ? ''
      : String(catalog.catalog_revision);
    const result = await syncSkillsToDir({
      root,
      projectId: status.project_id,
      skills: Array.isArray(catalog?.skills) ? catalog.skills : [],
      loadSkill: (skillId) => fetchSkillsJson(baseUrl, apiToken, `/${encodeURIComponent(skillId)}`, signal),
      adapt: adaptCodexSkill,
    });
    status.created = result.created;
    status.updated = result.updated;
    status.unchanged = result.unchanged;
    status.removed = result.removed;
    status.conflicts = result.conflicts.filter((name) => !BUNDLED_SKILLS.includes(name));
    status.errors = result.errors;
    if (result.skipped) status.skipped = result.skipped;
  } catch (error) {
    status.errors.push({ name: '', message: error instanceof Error ? error.message : String(error) });
  }
  status.finished_at = new Date().toISOString();
  try {
    writeStatusFile(root, status);
  } catch { /* silent: background best-effort */ }
}

main()
  .catch(() => { /* recorded in the status file when possible */ })
  .finally(() => process.exit(0));
