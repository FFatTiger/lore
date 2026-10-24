/**
 * Pi skills adapter — thin wrapper over vendor/skill-workcopy.
 * Owns the lore_skill_* management tools and the resources_discover
 * registration that exposes Lore skills through Pi's native skill system.
 */

import * as fs from 'node:fs';
import { fetchJson, textResult } from './api';
import { runSkillsSync } from './vendor/skill-workcopy/skills-sync.mjs';
import {
  normalizeSkillCandidate,
  normalizeSkillDetail,
  normalizeSkillSummary,
  projectWorkCopyRoot,
  skillIdOf,
  skillVersionOf,
  resolveLoreHome as resolveVendorLoreHome,
  type SkillCandidate,
  type SkillDetail,
  type SkillSummary,
  type WorkCopyMarker,
  type WorkCopyStatus,
  type WorkCopyState,
  type SkillFile,
  type MirrorState,
  type MirrorMarker,
  type MirrorStatus,
} from './vendor/skill-workcopy/index.mjs';

// Re-export shared core surface used by tests/index.
export {
  LORE_SKILL_MARKER,
  LORE_SKILL_SCHEMA,
  LEGACY_MIRROR_SCHEMA,
  SKILL_MD,
  workCopiesRoot,
  projectWorkCopyRoot,
  skillsRoot,
  installedRoot,
  stagingRoot,
  skillInstallPath,
  sanitizeSegment,
  validateSafeRelativePath,
  skillIdOf,
  skillVersionOf,
  skillRevisionOf,
  validateManagedFileList,
  normalizeSkillSummary,
  normalizeSkillDetail,
  normalizeSkillCandidate,
  sha256Buffer,
  sha256Text,
  decodeSkillFileContent,
  computeManifestHash,
  hashLocalSkillFiles,
  readWorkCopyMarker,
  readMirrorMarker,
  inspectLocalWorkCopy,
  inspectLocalMirror,
  validateSkillPayload,
  materializeSkillWorkCopy,
  writeSkillMirrorAtomic,
} from './vendor/skill-workcopy/index.mjs';

export type {
  SkillCandidate,
  SkillDetail,
  SkillSummary,
  SkillFile,
  WorkCopyMarker,
  WorkCopyStatus,
  WorkCopyState,
  MirrorState,
  MirrorMarker,
  MirrorStatus,
};

export function resolveLoreHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolveVendorLoreHome(env);
}

export interface SkillsClientState {
  projectId?: string;
  catalogRevision?: string;
}

// ---- API ----

export async function listSkillsApi(pluginCfg: any, includeDisabled = true): Promise<{
  project_id: string;
  catalog_revision: string;
  skills: SkillSummary[];
}> {
  const qs = new URLSearchParams({ include_disabled: includeDisabled ? 'true' : 'false' });
  const data = await fetchJson(pluginCfg, `/skills?${qs.toString()}`, { method: 'GET' });
  return {
    project_id: String(data?.project_id || ''),
    catalog_revision: String(data?.catalog_revision || ''),
    skills: Array.isArray(data?.skills) ? data.skills.map(normalizeSkillSummary) : [],
  };
}

export async function searchSkillsApi(pluginCfg: any, query: string, limit?: number): Promise<any> {
  const qs = new URLSearchParams({ query: query || '' });
  if (Number.isFinite(limit)) qs.set('limit', String(limit));
  const data = await fetchJson(pluginCfg, `/skills/recall?${qs.toString()}`, { method: 'GET' });
  if (Array.isArray(data?.candidates)) {
    return { ...data, candidates: data.candidates.map(normalizeSkillCandidate) };
  }
  return data;
}

export async function createSkillApi(pluginCfg: any, body: Record<string, unknown>): Promise<any> {
  return fetchJson(pluginCfg, '/skills', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateSkillApi(pluginCfg: any, skillId: string, body: Record<string, unknown>): Promise<any> {
  return fetchJson(pluginCfg, `/skills/${encodeURIComponent(skillId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteSkillApi(pluginCfg: any, skillId: string): Promise<any> {
  return fetchJson(pluginCfg, `/skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' });
}

export async function importSkillApi(pluginCfg: any, body: Record<string, unknown>): Promise<any> {
  return fetchJson(pluginCfg, '/skills/import', { method: 'POST', body: JSON.stringify(body) });
}

export function formatSkillImportText(data: any): string {
  const repo = String(data?.repo || '');
  const ref = String(data?.ref || '');
  const repoLabel = repo ? (ref ? `${repo}@${ref}` : repo) : 'unknown repo';
  const pathLabel = data?.path ? ` (path: ${data.path})` : '';
  if (!Array.isArray(data?.results)) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    const lines = candidates.map((c: any) => {
      const parts = [`- ${c?.name ?? '?'}`];
      if (c?.error) parts.push(`error: ${c.error}`);
      else if (c?.exists) parts.push('already exists');
      else parts.push(c?.selected === false ? 'not selected' : 'will import');
      if (c?.path) parts.push(String(c.path));
      if (Number.isFinite(c?.file_count)) parts.push(`${c.file_count} files`);
      if (Number.isFinite(c?.total_size)) parts.push(`${c.total_size} bytes`);
      return parts.join(' — ');
    });
    return [
      `Dry run from ${repoLabel}${pathLabel}: ${candidates.length} candidate skill(s)`,
      ...(lines.length ? lines : ['(no skills found)']),
    ].join('\n');
  }
  const results = Array.isArray(data?.results) ? data.results : [];
  const counts = new Map<string, number>();
  for (const r of results) {
    const status = String(r?.status || 'unknown');
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  const summary = [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(', ');
  const lines = results.map((r: any) => {
    const id = r?.skill_id ? ` (skill_id: ${r.skill_id})` : '';
    const err = r?.status === 'failed' && r?.error ? ` — ${r.error}` : '';
    return `- ${r?.name ?? '?'}: ${r?.status ?? '?'}${id}${err}`;
  });
  return [`Import from ${repoLabel}${pathLabel}: ${summary || 'no results'}`, ...lines].join('\n');
}

// ---- session-scoped skills client used by hooks ----

export function createSkillsSession(pluginCfg: any) {
  // Project/catalog identity is recorded from the skills catalog list request
  // (see registerSkillResourceDiscovery) and by the lore_skill_* tools; the
  // session itself never downloads or reconciles skills.
  const state: SkillsClientState = {};
  const loreHome = () => (typeof pluginCfg?.loreHome === 'string' && pluginCfg.loreHome.trim()
    ? pluginCfg.loreHome.trim()
    : resolveLoreHome());

  return { state, loreHome };
}

export type SkillsSession = ReturnType<typeof createSkillsSession>;

// ---- host-native skill directory (resources_discover + background sync) ----

/** The catalog list gates skill-path registration, so it keeps a tight deadline. */
const SKILLS_DISCOVER_TIMEOUT_MS = 3_000;

export interface RegisteredSkillResources {
  session: SkillsSession;
  /** Resolves once the latest background sync has recorded its outcome. */
  currentSync: () => Promise<void> | undefined;
}

/**
 * Register Pi's resources_discover handler that exposes the Lore work-copy root
 * (~/.lore/skills/<project-id>/) as a native skill directory. The directory is
 * reconciled with the server catalog by a background sync whose result lands in
 * <root>/.lore-sync-status.json; the previous sync's skills are visible in the
 * current session, this sync's in the next one (or after /reload).
 */
export function registerSkillResourceDiscovery(pi: any, pluginCfg: any, skillsSession?: SkillsSession): RegisteredSkillResources {
  const session = skillsSession || createSkillsSession(pluginCfg);
  let activeSync: Promise<void> | undefined;

  pi.on('resources_discover', async () => {
    let catalog: any;
    try {
      catalog = await fetchJson(
        { ...pluginCfg, timeoutMs: Math.min(pluginCfg.timeoutMs || SKILLS_DISCOVER_TIMEOUT_MS, SKILLS_DISCOVER_TIMEOUT_MS) },
        '/skills',
        { method: 'GET' },
      );
    } catch (error: any) {
      pi.logger?.debug?.(`lore: skills catalog unavailable (${error.message}); not registering skill paths`);
      return undefined;
    }
    const projectId = String(catalog?.project_id || '').trim();
    if (!projectId) return undefined;
    session.state.projectId = projectId;
    session.state.catalogRevision = catalog?.catalog_revision === undefined || catalog?.catalog_revision === null
      ? ''
      : String(catalog.catalog_revision);
    const root = projectWorkCopyRoot(session.loreHome(), projectId);
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch (error: any) {
      pi.logger?.debug?.(`lore: cannot create skills root (${error.message})`);
      return undefined;
    }
    activeSync = runSkillsSync({
      clientType: 'pi',
      root,
      loreHome: session.loreHome(),
      baseUrl: pluginCfg.baseUrl,
      apiToken: pluginCfg.apiToken,
    }).then((status) => {
      if (status.errors.length > 0) {
        pi.logger?.debug?.(`lore: background skills sync finished with ${status.errors.length} error(s)`);
      }
    });
    return { skillPaths: [root] };
  });

  return { session, currentSync: () => activeSync };
}

// ---- tool registration ----

const Type = {
  String: (meta?: Record<string, unknown>) => ({ type: 'string', ...meta }),
  Number: (meta?: Record<string, unknown>) => ({ type: 'number', ...meta }),
  Boolean: (meta?: Record<string, unknown>) => ({ type: 'boolean', ...meta }),
  Array: (items: Record<string, unknown>) => ({ type: 'array', items }),
  Optional: (schema: Record<string, unknown>) => ({ ...schema }),
  Object: (properties: Record<string, unknown>, rest?: Record<string, unknown>) => ({
    type: 'object',
    properties,
    ...rest,
  }),
};

function skillFileParamSchema() {
  return Type.Object({
    path: Type.String({ description: 'Relative path inside the skill (must include SKILL.md).' }),
    content: Type.Optional(Type.String({ description: 'UTF-8 file content.' })),
    content_base64: Type.Optional(Type.String({ description: 'Base64 file content for binary files.' })),
    media_type: Type.Optional(Type.String({ description: 'Optional media type.' })),
  });
}

export function registerSkillTools(pi: any, pluginCfg: any, skillsSession?: SkillsSession) {
  const session = skillsSession || createSkillsSession(pluginCfg);

  pi.registerTool({
    name: 'lore_skill_list',
    label: 'Lore skill list',
    description: 'List Lore skills for the active project, including disabled skills when requested.',
    parameters: Type.Object({
      include_disabled: Type.Optional(Type.Boolean({ description: 'Include disabled skills (default true).' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const includeDisabled = params?.include_disabled !== false;
        const data = await listSkillsApi(pluginCfg, includeDisabled);
        if (data.project_id) session.state.projectId = data.project_id;
        if (data.catalog_revision) session.state.catalogRevision = data.catalog_revision;
        const lines = (data.skills || []).map((s) => {
          const enabled = s.enabled === false ? 'disabled' : 'enabled';
          return `- ${s.name} (${skillIdOf(s)}) ${enabled} v${skillVersionOf(s) ?? '?'}`;
        });
        const text = lines.length > 0
          ? `Project ${data.project_id} rev ${data.catalog_revision}\n${lines.join('\n')}`
          : `Project ${data.project_id || '?'} rev ${data.catalog_revision || '?'}\nNo skills.`;
        return textResult(text, { ok: true, ...data });
      } catch (error: any) {
        return textResult(`Lore skill list failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_search',
    label: 'Lore skill search',
    description: 'Search or recall Lore skills by query.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query.' }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: 'Max candidates.' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const query = String(params?.query || '');
        const limit = Number.isFinite(params?.limit) ? params.limit : undefined;
        const data = await searchSkillsApi(pluginCfg, query, limit);
        return textResult(JSON.stringify(data, null, 2), { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill search failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_create',
    label: 'Lore skill create',
    description: 'Create a Lore skill on the server. Changes sync to the local skills directory when the next session starts (Pi: /reload).',
    parameters: Type.Object({
      name: Type.String({ description: 'Skill name.' }),
      enabled: Type.Optional(Type.Boolean({ description: 'Whether the skill is enabled (default true).' })),
      files: Type.Array(skillFileParamSchema(), { description: 'Skill files; must include SKILL.md.' }),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      const body = {
        name: String(params?.name || '').trim(),
        enabled: params?.enabled !== false,
        files: Array.isArray(params?.files) ? params.files : [],
      };
      try {
        if (!body.name) throw new Error('name is required');
        const data = normalizeSkillDetail(await createSkillApi(pluginCfg, body));
        if (data?.project_id) session.state.projectId = String(data.project_id);
        const createdId = skillIdOf(data) || '?';
        const createdVersion = skillVersionOf(data);
        const createdSuffix = createdVersion !== undefined && createdVersion !== null && createdVersion !== ''
          ? `skill_id: ${createdId}, version: ${createdVersion}`
          : `skill_id: ${createdId}`;
        return textResult(`Created skill ${data?.name || body.name} (${createdSuffix})`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill create failed: ${error.message}`, { ok: false, error: error.message, body });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_update',
    label: 'Lore skill update',
    description: 'Update a Lore skill on the server with optimistic concurrency via expected_version. '
      + 'Changes sync to the local skills directory when the next session starts (Pi: /reload).',
    parameters: Type.Object({
      skill_id: Type.String({ description: 'Skill id.' }),
      expected_version: Type.Number({ description: 'Expected current integer version (optimistic concurrency).' }),
      enabled: Type.Optional(Type.Boolean({ description: 'Enable or disable the skill.' })),
      upsert_files: Type.Optional(Type.Array(skillFileParamSchema(), { description: 'Files to create or replace.' })),
      delete_paths: Type.Optional(Type.Array(Type.String({ description: 'Relative path to delete.' }), { description: 'Paths to delete.' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      const skillId = String(params?.skill_id || '').trim();
      const expectedVersionRaw = params?.expected_version;
      const body: Record<string, unknown> = {};
      if (typeof params?.enabled === 'boolean') body.enabled = params.enabled;
      if (Array.isArray(params?.upsert_files)) body.upsert_files = params.upsert_files;
      if (Array.isArray(params?.delete_paths)) body.delete_paths = params.delete_paths;
      try {
        if (!skillId) throw new Error('skill_id is required');
        if (!Number.isInteger(expectedVersionRaw) || expectedVersionRaw < 1) {
          throw new Error('expected_version is required and must be a positive integer');
        }
        body.expected_version = expectedVersionRaw;
        const data = normalizeSkillDetail(await updateSkillApi(pluginCfg, skillId, body));
        const updatedId = skillIdOf(data) || skillId;
        const updatedVersion = skillVersionOf(data);
        const updatedSuffix = updatedVersion !== undefined && updatedVersion !== null && updatedVersion !== ''
          ? `skill_id: ${updatedId}, version: ${updatedVersion}`
          : `skill_id: ${updatedId}`;
        return textResult(`Updated skill ${data?.name || skillId} (${updatedSuffix})`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill update failed: ${error.message}`, { ok: false, error: error.message, skill_id: skillId, body });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_delete',
    label: 'Lore skill delete',
    description: 'Archive/delete a Lore skill on the server. Changes sync to the local skills directory when the next session starts (Pi: /reload).',
    parameters: Type.Object({
      skill_id: Type.String({ description: 'Skill id.' }),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const skillId = String(params?.skill_id || '').trim();
        if (!skillId) throw new Error('skill_id is required');
        const data = await deleteSkillApi(pluginCfg, skillId);
        if (data?.project_id) session.state.projectId = String(data.project_id);
        if (data?.catalog_revision !== undefined) session.state.catalogRevision = String(data.catalog_revision);
        return textResult(`Deleted skill ${skillId}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill delete failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_import',
    label: 'Lore skill import',
    description:
      'Import skills from a public GitHub repository (owner/repo, a GitHub URL, a tree URL to one skill, or a pasted npx skills add command) into Lore. '
      + 'Run with dry_run first to see what will be imported. Never overwrites existing skills.',
    parameters: Type.Object({
      source: Type.String({ description: 'GitHub source: owner/repo, a GitHub URL, a tree URL, or a pasted npx skills add command.' }),
      skills: Type.Optional(Type.Array(Type.String({ description: 'Skill name to import.' }), { description: 'Skill names to import; omit or pass * to import all found.' })),
      visibility_client_types: Type.Optional(Type.Array(Type.String({ description: 'Client type allowed to use the imported skills.' }), { description: 'Client types that can use the imported skills (same meaning as on create); omit for the server default.' })),
      dry_run: Type.Optional(Type.Boolean({ description: 'Only list candidate skills without importing.' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      const source = String(params?.source || '').trim();
      const body: Record<string, unknown> = {};
      if (Array.isArray(params?.skills)) {
        body.skills = params.skills.map((s: unknown) => String(s || '').trim()).filter(Boolean);
      }
      if (Array.isArray(params?.visibility_client_types)) {
        body.visibility_client_types = params.visibility_client_types.map((s: unknown) => String(s || '').trim()).filter(Boolean);
      }
      if (params?.dry_run === true) body.dry_run = true;
      try {
        if (!source) throw new Error('source is required');
        body.source = source;
        const data = await importSkillApi(pluginCfg, body);
        return textResult(`${formatSkillImportText(data)}\n\n${JSON.stringify(data, null, 2)}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill import failed: ${error.message}`, { ok: false, error: error.message, source });
      }
    },
  });

  return session;
}
