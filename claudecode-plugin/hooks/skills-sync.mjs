#!/usr/bin/env node
/**
 * Background Lore skills sync for the Claude Code plugin.
 *
 * The SessionStart hook spawns this script detached (stdio: 'ignore') so the
 * hook can write its lifecycle output and exit immediately - Claude Code only
 * discovers new skills in the next session anyway, so waiting buys nothing.
 * The outcome of the last run is recorded in
 * <CLAUDE_PLUGIN_ROOT>/skills/.lore-sync-status.json (atomic tmp + rename).
 *
 * Total runtime is bounded by SYNC_TIMEOUT_MS; the explicit process.exit keeps
 * lingering keep-alive sockets from holding the process open after a timeout.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { syncSkillsToDir } from './vendor/skill-workcopy/index.mjs';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const SYNC_TIMEOUT_MS = 120000;
const STATUS_FILE = '.lore-sync-status.json';

function pickString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function loadConnection() {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.lore', 'config.json'), 'utf-8'));
  } catch { /* best-effort */ }
  return {
    baseUrl: (pickString(config.base_url)
      || pickString(process.env.LORE_BASE_URL)
      || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiToken: pickString(config.api_token)
      || pickString(process.env.LORE_API_TOKEN)
      || pickString(process.env.API_TOKEN),
  };
}

async function fetchSkillsJson(baseUrl, apiToken, skillPath, signal) {
  const url = new URL(`/api/skills${skillPath}`, `${baseUrl}/`);
  url.searchParams.set('client_type', 'claudecode');
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
  const pluginRoot = pickString(process.env.CLAUDE_PLUGIN_ROOT);
  const root = pluginRoot ? path.join(pluginRoot, 'skills') : '';
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
    if (!root) throw new Error('CLAUDE_PLUGIN_ROOT is not set');
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
    });
    status.created = result.created;
    status.updated = result.updated;
    status.unchanged = result.unchanged;
    status.removed = result.removed;
    status.conflicts = result.conflicts;
    status.errors = result.errors;
    if (result.skipped) status.skipped = result.skipped;
  } catch (error) {
    status.errors.push({ name: '', message: error instanceof Error ? error.message : String(error) });
  }
  status.finished_at = new Date().toISOString();
  if (root) {
    try {
      writeStatusFile(root, status);
    } catch { /* silent: background best-effort */ }
  }
}

main()
  .catch(() => { /* recorded in the status file when possible */ })
  .finally(() => process.exit(0));
