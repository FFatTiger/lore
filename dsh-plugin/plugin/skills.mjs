/**
 * Lore skills integration for DeepSeek Harness (dsh).
 *
 * Two cooperating halves:
 *
 * - `createLoreSkills()` returns shared state plus `triggerSync()`, a
 *   fire-and-forget catalog fetch + `runSkillsSync` into
 *   `${LORE_HOME:-~/.lore}/skills/<project-id>/`. The project id comes from
 *   `GET /api/skills?client_type=dsh` and is cached for the process lifetime;
 *   the sync itself re-fetches the catalog, so only the root needs the id.
 * - `createLoreSkillProvider()` builds the `ctx.skills` provider (verified
 *   against @deepseek-ai/dsh-skill 0.0.1-rc.1's SkillProvider interface):
 *   `list()` scans the synced directory for marker-owned work copies and
 *   parses SKILL.md frontmatter; `get()` returns the body. Until the project
 *   id is known the provider reports an incomplete empty observation (never
 *   cached as authoritative) and kicks discovery itself, so an early `list()`
 *   also starts the first sync.
 *
 * `disable-model-invocation: true` maps to dsh's
 * `invocation.modelInvocable: false`; `user-invocable: false` maps to
 * `invocation.userInvocable: false`. Skill names must be kebab-case
 * (/^[a-z0-9]+(?:-[a-z0-9]+)*$/) or the registry rejects the whole provider
 * catalog, so other names are skipped.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadLoreConfig, pickString } from '../vendor/lore-config.mjs';
import { runSkillsSync } from '../vendor/skill-workcopy/skills-sync.mjs';
import {
  projectWorkCopyRoot,
  readWorkCopyMarker,
  SKILL_MD,
} from '../vendor/skill-workcopy/index.mjs';

const CLIENT_TYPE = 'dsh';
const PROVIDER_NAME = 'lore';
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function debug(message) {
  if (pickString(process.env.LORE_DEBUG) === '1') process.stderr.write(`[lore] ${message}\n`);
}

/** Minimal YAML-frontmatter reader for name/description/invocation flags. */
export function parseSkillFrontmatter(text) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---')) return { fm: {}, body: text };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: text };
  const fmText = src.slice(3, end);
  const body = src.slice(end + 4).replace(/^\n+/, '');
  const fm = {};
  for (const line of fmText.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (match) fm[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fm, body };
}

/**
 * Shared per-process skills state. `projectId` is set by the first successful
 * catalog fetch; `syncing` keeps at most one fire-and-forget sync in flight.
 */
export function createLoreSkills() {
  const state = { projectId: '', syncing: false };

  async function fetchProjectId(config) {
    const url = new URL('/api/skills', `${config.baseUrl}/`);
    url.searchParams.set('client_type', CLIENT_TYPE);
    const headers = { accept: 'application/json' };
    if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`skills catalog HTTP ${response.status}`);
    const payload = await response.json();
    const projectId = pickString(payload?.project_id);
    if (!projectId) throw new Error('skills catalog returned no project_id');
    return projectId;
  }

  /** Fire-and-forget: resolve the project id once, then sync the skills root. */
  function triggerSync() {
    const config = loadLoreConfig();
    if (!config.skillsEnabled || state.syncing) return;
    state.syncing = true;
    void (async () => {
      try {
        if (!state.projectId) state.projectId = await fetchProjectId(config);
        const root = projectWorkCopyRoot(config.loreHome, state.projectId);
        await runSkillsSync({
          clientType: CLIENT_TYPE,
          root,
          loreHome: config.loreHome,
          baseUrl: config.baseUrl,
          apiToken: config.apiToken,
        });
      } catch (error) {
        debug(`skills sync failed open: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        state.syncing = false;
      }
    })();
  }

  return { state, triggerSync };
}

function skillRootFor(state) {
  if (!state.projectId) return '';
  return projectWorkCopyRoot(loadLoreConfig().loreHome, state.projectId);
}

/** Scan the synced skills root; returns null when the root is not usable yet. */
function collectCandidates(state) {
  const root = skillRootFor(state);
  if (!root) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const byName = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const dir = path.join(root, entry.name);
    const marker = readWorkCopyMarker(dir);
    if (!marker) continue; // never claim unmarked directories
    const skillMdPath = path.join(dir, SKILL_MD);
    let parsed;
    try {
      parsed = parseSkillFrontmatter(fs.readFileSync(skillMdPath, 'utf8'));
    } catch {
      continue;
    }
    const name = pickString(parsed.fm.name);
    if (!SKILL_NAME_RE.test(name)) continue; // dsh rejects non-kebab names
    if (byName.has(name)) continue;
    const userInvocable = pickString(parsed.fm['user-invocable']);
    byName.set(name, {
      name,
      description: pickString(parsed.fm.description),
      whenToUse: pickString(parsed.fm['when-to-use']) || undefined,
      invocation: {
        modelInvocable: pickString(parsed.fm['disable-model-invocation']) !== 'true',
        userInvocable: userInvocable === '' ? true : userInvocable !== 'false',
      },
      provider: PROVIDER_NAME,
      source: 'custom',
      resourceBase: { kind: 'directory', path: dir },
      rank: 0,
      locator: dir,
      path: skillMdPath,
    });
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The `ctx.skills` provider. `list()` returns an empty incomplete observation
 * until the project id is known (and kicks the first sync), then the real
 * catalog from the synced directory.
 */
export function createLoreSkillProvider(skills, control) {
  function throwIfAborted(options) {
    if (control.signal?.aborted) throw control.signal.reason;
    if (options?.signal?.aborted) throw options.signal.reason;
  }

  return {
    name: PROVIDER_NAME,
    async list(options = {}) {
      throwIfAborted(options);
      if (!skills.state.projectId) {
        skills.triggerSync();
        return { candidates: [], complete: false };
      }
      const candidates = collectCandidates(skills.state);
      if (candidates === null) return { candidates: [], complete: false };
      return { candidates, complete: true };
    },
    async get(candidate, options = {}) {
      throwIfAborted(options);
      const source = typeof candidate.path === 'string' && candidate.path
        ? candidate.path
        : String(candidate.locator || '');
      const dir = path.dirname(source);
      try {
        const parsed = parseSkillFrontmatter(fs.readFileSync(path.join(dir, SKILL_MD), 'utf8'));
        return {
          name: candidate.name,
          description: candidate.description,
          ...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
          invocation: candidate.invocation,
          provider: PROVIDER_NAME,
          source: 'custom',
          resourceBase: candidate.resourceBase,
          path: candidate.path,
          content: parsed.body,
        };
      } catch (error) {
        debug(`skill load failed: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    },
  };
}
