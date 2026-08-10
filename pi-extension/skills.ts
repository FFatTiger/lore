/**
 * Pi skills adapter — thin wrapper over vendor/skill-workcopy.
 * Owns lore_skill_* tools, session helpers, and discovery formatting for hooks.
 */

import { fetchJson, textResult } from './api';
import {
  ensureSkillWorkCopy as ensureSharedWorkCopy,
  listAllLocalWorkCopyStatuses,
  listLocalWorkCopyStatuses,
  normalizeSkillCandidate,
  normalizeSkillDetail,
  normalizeSkillSummary,
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
  readWorkCopyMarker,
  readMirrorMarker,
  inspectLocalWorkCopy,
  inspectLocalMirror,
  validateSkillPayload,
  materializeSkillWorkCopy,
  writeSkillMirrorAtomic,
  listAllLocalWorkCopyStatuses,
  listLocalWorkCopyStatuses,
  listLocalMirrorStatuses,
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
  lastError?: string;
}

export interface SkillCatalog {
  project_id: string;
  catalog_revision: string;
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

export async function getSkillApi(pluginCfg: any, skillId: string): Promise<SkillDetail> {
  const data = await fetchJson(pluginCfg, `/skills/${encodeURIComponent(skillId)}`, { method: 'GET' });
  return normalizeSkillDetail(data);
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

/**
 * Ensure a writable work copy via shared DI core.
 * loadSkill=getSkillApi, loadCatalog=listSkillsApi.
 */
export async function ensureSkillWorkCopy(opts: {
  pluginCfg: any;
  loreHome?: string;
  skillId: string;
  projectId?: string;
}) {
  const loreHome = opts.loreHome
    || (typeof opts.pluginCfg?.loreHome === 'string' && opts.pluginCfg.loreHome.trim()
      ? opts.pluginCfg.loreHome.trim()
      : resolveLoreHome());
  return ensureSharedWorkCopy({
    loreHome,
    skillId: opts.skillId,
    projectId: opts.projectId,
    loadSkill: (skillId: string) => getSkillApi(opts.pluginCfg, skillId),
    loadCatalog: async () => listSkillsApi(opts.pluginCfg, true),
  });
}

// ---- candidate discovery (recall only; no download / no local path) ----

export function formatSkillCandidateBlock(candidates: Array<{
  skill_id: string;
  name: string;
  version?: string | number;
  description?: string;
}>): string {
  if (!candidates.length) return '';
  const lines = ['<lore-skills>'];
  lines.push('Matched Lore skills. Call lore_skill_get with skill_id to materialize a local work copy.');
  for (const c of candidates) {
    const version = c.version === undefined || c.version === '' ? '' : ` v${c.version}`;
    const desc = c.description ? ` — ${String(c.description).replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`- ${c.name}${version}${desc}`);
    lines.push(`  skill_id: ${c.skill_id}`);
    if (c.version !== undefined && c.version !== '') {
      lines.push(`  version: ${c.version}`);
    }
  }
  lines.push('</lore-skills>');
  return lines.join('\n');
}

export function appendSkillBlockToRecallMessage(message: any, skillBlock: string): any {
  const block = String(skillBlock || '').trim();
  if (!block) return message;

  if (!message || typeof message !== 'object') {
    return {
      customType: 'lore-recall',
      content: block,
      display: false,
      details: { source: 'lore-skills' },
    };
  }

  const existing = typeof message.content === 'string' ? message.content : '';
  const content = existing.trim() ? `${existing.trim()}\n\n${block}` : block;
  return {
    ...message,
    content,
    display: false,
    customType: message.customType || 'lore-recall',
  };
}

/**
 * Discovery-only candidates from lifecycle response. No download, no local path, no integrity check.
 */
export function discoveryCandidateEntries(candidates: SkillCandidate[]): Array<{
  skill_id: string;
  name: string;
  version?: string | number;
  description?: string;
}> {
  const out: Array<{ skill_id: string; name: string; version?: string | number; description?: string }> = [];
  for (const candidate of candidates || []) {
    const name = String(candidate.name || '').trim();
    const skillId = skillIdOf(candidate);
    if (!name || !skillId) continue;
    out.push({
      skill_id: skillId,
      name,
      version: skillVersionOf(candidate),
      description: typeof candidate.description === 'string' ? candidate.description : undefined,
    });
  }
  return out;
}

// ---- session-scoped skills client used by hooks ----

export function createSkillsSession(pluginCfg: any) {
  const state: SkillsClientState = {};
  const loreHome = () => (typeof pluginCfg?.loreHome === 'string' && pluginCfg.loreHome.trim()
    ? pluginCfg.loreHome.trim()
    : resolveLoreHome());

  /**
   * Session start: record project/catalog identity only. No auto-download / reconcile.
   */
  async function onSessionStart(lifecycleResponse: any): Promise<void> {
    const catalog = readSkillCatalog(lifecycleResponse);
    if (!catalog?.project_id) return;
    state.projectId = catalog.project_id;
    state.catalogRevision = catalog.catalog_revision;
  }

  /**
   * Prompt lifecycle: discovery candidates only. Append candidate block to recall message.
   * Does not download, reconcile, or inject local paths.
   */
  async function onPromptLifecycle(lifecycleResponse: any): Promise<{ messagePatch?: any; skillBlock?: string }> {
    const catalog = readSkillCatalog(lifecycleResponse);
    if (catalog?.project_id) {
      state.projectId = catalog.project_id;
      state.catalogRevision = catalog.catalog_revision;
    }

    const candidates = readSkillCandidates(lifecycleResponse);
    if (candidates.length === 0) return {};

    const discovered = discoveryCandidateEntries(candidates);
    const skillBlock = formatSkillCandidateBlock(discovered);
    if (!skillBlock) return {};

    const hostMessage = lifecycleResponse?.host_output?.mode === 'return_value'
      ? lifecycleResponse.host_output?.value?.message
      : undefined;
    return {
      skillBlock,
      messagePatch: appendSkillBlockToRecallMessage(hostMessage, skillBlock),
    };
  }

  function getStatus(): {
    project_id?: string;
    catalog_revision?: string;
    work_copies: WorkCopyStatus[];
    /** @deprecated alias of work_copies */
    mirrors: WorkCopyStatus[];
    last_error?: string;
  } {
    const projectId = state.projectId;
    const work_copies = projectId
      ? listLocalWorkCopyStatuses(loreHome(), projectId)
      : listAllLocalWorkCopyStatuses(loreHome());
    return {
      project_id: projectId,
      catalog_revision: state.catalogRevision,
      work_copies,
      mirrors: work_copies,
      last_error: state.lastError,
    };
  }

  return {
    state,
    loreHome,
    onSessionStart,
    onPromptLifecycle,
    getStatus,
    ensureSkillWorkCopy: (skillId: string) => ensureSkillWorkCopy({
      pluginCfg,
      loreHome: loreHome(),
      skillId,
      projectId: state.projectId,
    }),
  };
}

export type SkillsSession = ReturnType<typeof createSkillsSession>;

export function readSkillCatalog(lifecycleResponse: any): SkillCatalog | null {
  const catalog = lifecycleResponse?.skill_catalog;
  if (!catalog || typeof catalog !== 'object') return null;
  const project_id = String(catalog.project_id || '').trim();
  if (!project_id) return null;
  return {
    project_id,
    catalog_revision: String(catalog.catalog_revision || ''),
  };
}

export function readSkillCandidates(lifecycleResponse: any): SkillCandidate[] {
  const raw = lifecycleResponse?.skill_candidates;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map(normalizeSkillCandidate);
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
    name: 'lore_skill_get',
    label: 'Lore skill get',
    description:
      'Fetch a Lore skill and materialize a writable local work copy when missing or when the server version differs. '
      + 'Returns local SKILL.md content and absolute skill_dir. Same-version local edits are preserved.',
    parameters: Type.Object({
      skill_id: Type.String({ description: 'Skill id.' }),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const skillId = String(params?.skill_id || '').trim();
        if (!skillId) throw new Error('skill_id is required');
        const result = await ensureSkillWorkCopy({
          pluginCfg,
          loreHome: session.loreHome(),
          skillId,
          projectId: session.state.projectId,
        });
        if (result.project_id) session.state.projectId = result.project_id;
        const text = [
          `Skill work copy ready: ${result.skill.name || skillId}`,
          `skill_dir: ${result.skill_dir}`,
          `server_version: ${result.server_version ?? '?'}`,
          `local_version: ${result.local_version}`,
          `downloaded: ${result.downloaded}`,
          '',
          result.skill_md,
        ].join('\n');
        return textResult(text, {
          ok: true,
          skill_dir: result.skill_dir,
          skill_md: result.skill_md,
          skill_md_path: result.skill_md_path,
          server_version: result.server_version,
          local_version: result.local_version,
          downloaded: result.downloaded,
          project_id: result.project_id,
          skill: {
            skill_id: skillIdOf(result.skill),
            name: result.skill.name,
            description: result.skill.description,
            version: result.server_version,
          },
          marker: result.marker,
        });
      } catch (error: any) {
        return textResult(`Lore skill get failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_create',
    label: 'Lore skill create',
    description: 'Create a Lore skill on the server. Does not auto-materialize a local work copy; call lore_skill_get later if needed.',
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
    description:
      'Update a Lore skill on the server with optimistic concurrency via expected_version. '
      + 'Does not auto-reconcile the local work copy; call lore_skill_get later if the version differs.',
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
    description: 'Archive/delete a Lore skill on the server. Does not auto-remove the local work copy.',
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
    name: 'lore_skill_status',
    label: 'Lore skill status',
    description:
      'Report local writable skill work-copy states (ready/missing/outdated/unmanaged/invalid). '
      + 'Read-only: never mutates or reconciles work copies.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId: string, _params: any = {}) {
      try {
        const status = session.getStatus();
        const lines = status.work_copies.map((m) => {
          const ver = m.version !== undefined ? ` v${m.version}` : '';
          const msg = m.message ? ` — ${m.message}` : '';
          return `- ${m.name}: ${m.state}${ver}${msg}`;
        });
        const header = `project=${status.project_id || '?'} catalog_revision=${status.catalog_revision || '?'}`;
        const text = [header, ...(lines.length ? lines : ['(no local work copies)']), status.last_error ? `last_error: ${status.last_error}` : '']
          .filter(Boolean)
          .join('\n');
        return textResult(text, { ok: true, ...status });
      } catch (error: any) {
        return textResult(`Lore skill status failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  return session;
}
