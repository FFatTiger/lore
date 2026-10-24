#!/usr/bin/env node
/**
 * Host-shared Lore skills sync: fetch the server catalog and reconcile a
 * host-native skills directory via syncSkillsToDir, then record the outcome in
 * <root>/.lore-sync-status.json (atomic tmp + rename).
 *
 * This is the single implementation shared by every host:
 * - Hook-based hosts (Claude Code, Codex) spawn it detached as a CLI:
 *     node skills-sync.mjs --client-type <type> --root <dir> [--lore-home <dir>]
 *   The CLI installer runs the same command for the first sync after install.
 * - In-process hosts (Pi, OpenClaw, dsh) import runSkillsSync directly.
 *
 * Connection resolution matches the other Lore scripts: <loreHome>/config.json
 * (base_url, api_token) with LORE_BASE_URL / LORE_API_TOKEN / API_TOKEN env
 * fallbacks; explicit options win. One AbortSignal.timeout (default 120s)
 * covers the catalog request and every skill detail request. Network and
 * other failures never throw: they are recorded in status.errors, and the
 * explicit process.exit in the CLI keeps lingering keep-alive sockets from
 * holding a finished run open.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLoreHome, syncSkillsToDir } from './index.mjs';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const DEFAULT_TIMEOUT_MS = 120000;
const STATUS_FILE = '.lore-sync-status.json';
const OPENAI_YAML_PATH = 'agents/openai.yaml';
// Codex has no disable-model-invocation frontmatter support; the equivalent is
// an agents/openai.yaml policy file shipped inside the skill package.
const OPENAI_POLICY_YAML = 'policy:\n  allow_implicit_invocation: false\n';
// Codex bundles a static lore-memory skill without a Lore marker: an expected
// conflict, kept out of the recorded conflicts to avoid noisy status files.
const CODEX_BUNDLED_SKILLS = ['lore-memory'];

function pickString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function loadConnection({ loreHome, baseUrl, apiToken, env = process.env }) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(loreHome, 'config.json'), 'utf-8'));
  } catch { /* best-effort */ }
  return {
    baseUrl: (pickString(baseUrl)
      || pickString(config.base_url)
      || pickString(env.LORE_BASE_URL)
      || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiToken: pickString(apiToken)
      || pickString(config.api_token)
      || pickString(env.LORE_API_TOKEN)
      || pickString(env.API_TOKEN),
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

/** Per-host packaging tweaks applied before a work copy is materialized. */
function hostAdapter(clientType) {
  if (clientType === 'codex') {
    return {
      adapt: adaptCodexSkill,
      filterConflicts: (conflicts) => conflicts.filter((name) => !CODEX_BUNDLED_SKILLS.includes(name)),
    };
  }
  return {};
}

async function fetchSkillsJson(baseUrl, apiToken, clientType, skillPath, signal) {
  const url = new URL(`/api/skills${skillPath}`, `${baseUrl}/`);
  url.searchParams.set('client_type', clientType);
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

/**
 * Sync the server skill catalog into a host-native skills directory and record
 * the outcome in <root>/.lore-sync-status.json. Never throws: failures land in
 * status.errors. Returns the recorded status object.
 */
export async function runSkillsSync(opts) {
  const clientType = pickString(opts?.clientType);
  const root = pickString(opts?.root);
  const loreHome = pickString(opts?.loreHome) ? path.resolve(pickString(opts?.loreHome)) : resolveLoreHome();
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;

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
    if (!clientType) throw new Error('runSkillsSync requires clientType');
    if (!root) throw new Error('runSkillsSync requires root');
    const { baseUrl, apiToken } = loadConnection({
      loreHome,
      baseUrl: opts?.baseUrl,
      apiToken: opts?.apiToken,
    });
    // One deadline covers the whole run: catalog + every skill detail.
    const signal = AbortSignal.timeout(timeoutMs);
    const catalog = await fetchSkillsJson(baseUrl, apiToken, clientType, '', signal);
    status.project_id = pickString(catalog?.project_id);
    status.catalog_revision = catalog?.catalog_revision === undefined || catalog?.catalog_revision === null
      ? ''
      : String(catalog.catalog_revision);
    const { adapt, filterConflicts } = hostAdapter(clientType);
    const result = await syncSkillsToDir({
      root,
      projectId: status.project_id,
      skills: Array.isArray(catalog?.skills) ? catalog.skills : [],
      loadSkill: (skillId) => fetchSkillsJson(baseUrl, apiToken, clientType, `/${encodeURIComponent(skillId)}`, signal),
      adapt,
    });
    status.created = result.created;
    status.updated = result.updated;
    status.unchanged = result.unchanged;
    status.removed = result.removed;
    status.conflicts = filterConflicts ? filterConflicts(result.conflicts) : result.conflicts;
    status.errors = result.errors;
  } catch (error) {
    status.errors.push({ name: '', message: error instanceof Error ? error.message : String(error) });
  }
  status.finished_at = new Date().toISOString();
  if (root) {
    try {
      writeStatusFile(root, status);
    } catch { /* silent: background best-effort */ }
  }
  return status;
}

// ---- CLI entry (spawned detached by hooks; run directly by the installer) ----

function usage() {
  console.error('usage: skills-sync.mjs --client-type <type> --root <dir> [--lore-home <dir>]');
}

function parseArgs(argv) {
  const out = {};
  const flags = { '--client-type': 'clientType', '--root': 'root', '--lore-home': 'loreHome' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!Object.hasOwn(flags, key) || value === undefined) {
      usage();
      process.exit(2);
    }
    out[flags[key]] = value;
  }
  return out;
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.clientType || !args.root) {
    usage();
    process.exit(2);
  }
  runSkillsSync(args)
    .catch(() => { /* recorded in the status file when possible */ })
    .finally(() => process.exit(0));
}
