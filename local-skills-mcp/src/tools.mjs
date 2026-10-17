/**
 * lore_skill_* tool implementations for the local stdio MCP adapter.
 * Owns ALL skill tools for codex/claudecode so remote MCP can omit them.
 */

import {
  skillIdOf,
  skillVersionOf,
  normalizeSkillSummary,
  normalizeSkillDetail,
  normalizeSkillCandidate,
  ensureSkillWorkCopy as ensureSharedWorkCopy,
  listAllLocalWorkCopyStatuses,
  listLocalWorkCopyStatuses,
} from '../vendor/index.mjs';
import { fetchSkillsJson } from './http.mjs';

function textContent(text, isError = false) {
  return {
    content: [{ type: 'text', text: String(text) }],
    ...(isError ? { isError: true } : {}),
  };
}

function okJson(value) {
  return textContent(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function errText(prefix, error) {
  const message = error instanceof Error ? error.message : String(error);
  return textContent(`${prefix}: ${message}`, true);
}

function skillFileSchema() {
  return {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path inside the skill (must include SKILL.md).' },
      content: { type: 'string', description: 'UTF-8 file content.' },
      content_base64: { type: 'string', description: 'Base64 file content for binary files.' },
      media_type: { type: 'string', description: 'Optional media type.' },
    },
    required: ['path'],
  };
}

export const TOOL_DEFINITIONS = [
  {
    name: 'lore_skill_list',
    description: 'List Lore skills for the active project, including disabled skills when requested.',
    inputSchema: {
      type: 'object',
      properties: {
        include_disabled: {
          type: 'boolean',
          description: 'Include disabled skills (default true).',
        },
      },
    },
  },
  {
    name: 'lore_skill_search',
    description: 'Search or recall Lore skills by query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        limit: { type: 'number', description: 'Max candidates.', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
  },
  {
    name: 'lore_skill_get',
    description:
      'Load a Lore skill (cloud-stored, not part of the host\'s own skill system) by skill_id, including its package files. '
      + 'Use it when a task matches a Lore skill or another skill\'s instructions name one.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id.' },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'lore_skill_create',
    description: 'Create a Lore skill on the server. Does not auto-materialize a local copy; call lore_skill_get later if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name.' },
        enabled: { type: 'boolean', description: 'Whether the skill is enabled (default true).' },
        files: {
          type: 'array',
          description: 'Skill files; must include SKILL.md.',
          items: skillFileSchema(),
        },
      },
      required: ['name', 'files'],
    },
  },
  {
    name: 'lore_skill_update',
    description:
      'Update a Lore skill on the server with optimistic concurrency via expected_version. '
      + 'Does not auto-reconcile the local copy; call lore_skill_get later if the version differs.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id.' },
        expected_version: {
          type: 'integer',
          minimum: 1,
          description: 'Expected current integer version (optimistic concurrency).',
        },
        enabled: { type: 'boolean', description: 'Enable or disable the skill.' },
        upsert_files: {
          type: 'array',
          description: 'Files to create or replace.',
          items: skillFileSchema(),
        },
        delete_paths: {
          type: 'array',
          description: 'Paths to delete.',
          items: { type: 'string', description: 'Relative path to delete.' },
        },
      },
      required: ['skill_id', 'expected_version'],
    },
  },
  {
    name: 'lore_skill_delete',
    description: 'Archive/delete a Lore skill on the server. Does not auto-remove the local copy.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id.' },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'lore_skill_import',
    description:
      'Import skills from a public GitHub repository (owner/repo, a GitHub URL, a tree URL to one skill, or a pasted npx skills add command) into Lore. '
      + 'Run with dry_run first to see what will be imported. Never overwrites existing skills.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'GitHub source: owner/repo, a GitHub URL, a tree URL, or a pasted npx skills add command.',
        },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Skill names to import; omit or pass * to import all found.',
        },
        visibility_client_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Client types that can use the imported skills (same meaning as on create); omit for the server default.',
        },
        dry_run: {
          type: 'boolean',
          description: 'Only list candidate skills without importing.',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'lore_skill_status',
    description:
      'Report local skill work-copy states (ready/missing/outdated/tampered/unmanaged/invalid). '
      + 'Read-only: never mutates or reconciles copies.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

async function listSkills(config, includeDisabled = true) {
  const qs = new URLSearchParams({ include_disabled: includeDisabled ? 'true' : 'false' });
  const data = await fetchSkillsJson(config, `?${qs.toString()}`, { method: 'GET' });
  return {
    project_id: String(data?.project_id || ''),
    catalog_revision: String(data?.catalog_revision || ''),
    skills: Array.isArray(data?.skills) ? data.skills.map(normalizeSkillSummary) : [],
  };
}

export async function ensureSkillWorkCopy(config, skillId, state = {}) {
  return ensureSharedWorkCopy({
    loreHome: config.loreHome,
    skillId,
    projectId: state.projectId,
    loadSkill: async (id) => {
      const detail = await fetchSkillsJson(config, `/${encodeURIComponent(id)}`, { method: 'GET' });
      return normalizeSkillDetail(detail);
    },
    loadCatalog: async () => listSkills(config, true),
  });
}

export function createToolState() {
  return { projectId: undefined, catalogRevision: undefined, lastError: undefined };
}

export function skillsEnabled(config) {
  if (config?.skillsEnabled === true) return true;
  if (config?.skillsEnabled === false) return false;
  return config?.env?.LORE_SKILLS_ENABLED === '1';
}

export function formatSkillImportText(data) {
  const repo = String(data?.repo || '');
  const ref = String(data?.ref || '');
  const repoLabel = repo ? (ref ? `${repo}@${ref}` : repo) : 'unknown repo';
  const pathLabel = data?.path ? ` (path: ${data.path})` : '';
  if (!Array.isArray(data?.results)) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    const lines = candidates.map((c) => {
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
  const counts = new Map();
  for (const r of results) {
    const status = String(r?.status || 'unknown');
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  const summary = [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(', ');
  const lines = results.map((r) => {
    const id = r?.skill_id ? ` (skill_id: ${r.skill_id})` : '';
    const err = r?.status === 'failed' && r?.error ? ` — ${r.error}` : '';
    return `- ${r?.name ?? '?'}: ${r?.status ?? '?'}${id}${err}`;
  });
  return [`Import from ${repoLabel}${pathLabel}: ${summary || 'no results'}`, ...lines].join('\n');
}

export async function callTool(config, name, args = {}, state = createToolState()) {
  if (!skillsEnabled(config)) {
    return textContent('Connected Lore server does not advertise Skills support.', true);
  }
  try {
    switch (name) {
      case 'lore_skill_list': {
        const includeDisabled = args?.include_disabled !== false;
        const data = await listSkills(config, includeDisabled);
        if (data.project_id) state.projectId = data.project_id;
        if (data.catalog_revision) state.catalogRevision = data.catalog_revision;
        const lines = (data.skills || []).map((s) => {
          const enabled = s.enabled === false ? 'disabled' : 'enabled';
          return `- ${s.name} (${skillIdOf(s)}) ${enabled} v${skillVersionOf(s) ?? '?'}`;
        });
        const text = lines.length > 0
          ? `Project ${data.project_id} rev ${data.catalog_revision}\n${lines.join('\n')}`
          : `Project ${data.project_id || '?'} rev ${data.catalog_revision || '?'}\nNo skills.`;
        return textContent(text);
      }
      case 'lore_skill_search': {
        const query = String(args?.query || '');
        const qs = new URLSearchParams({ query });
        if (Number.isFinite(args?.limit)) qs.set('limit', String(args.limit));
        const data = await fetchSkillsJson(config, `/recall?${qs.toString()}`, { method: 'GET' });
        if (Array.isArray(data?.candidates)) {
          data.candidates = data.candidates.map(normalizeSkillCandidate);
        }
        return okJson(data);
      }
      case 'lore_skill_get': {
        const skillId = String(args?.skill_id || '').trim();
        if (!skillId) throw new Error('skill_id is required');
        const result = await ensureSkillWorkCopy(config, skillId, state);
        if (result.project_id) state.projectId = result.project_id;
        const text = [
          `Skill ready: ${result.skill.name || skillId}`,
          `skill_dir: ${result.skill_dir}`,
          'Files from Lore in skill_dir are read-only and refreshed by lore_skill_get. Any other file there is a local artifact: never checked or uploaded. Save deliverables for the user where they asked or in the working directory, not in skill_dir.',
          `server_version: ${result.server_version ?? '?'}`,
          `local_version: ${result.local_version}`,
          `downloaded: ${result.downloaded}`,
          '',
          result.skill_md,
        ].join('\n');
        return textContent(text);
      }
      case 'lore_skill_create': {
        const body = {
          name: String(args?.name || '').trim(),
          enabled: args?.enabled !== false,
          files: Array.isArray(args?.files) ? args.files : [],
        };
        if (!body.name) throw new Error('name is required');
        const data = normalizeSkillDetail(await fetchSkillsJson(config, '', {
          method: 'POST',
          body: JSON.stringify(body),
        }));
        if (data?.project_id) state.projectId = String(data.project_id);
        const createdId = skillIdOf(data) || '?';
        const createdVersion = skillVersionOf(data);
        const createdSuffix = createdVersion !== undefined && createdVersion !== null && createdVersion !== ''
          ? `skill_id: ${createdId}, version: ${createdVersion}`
          : `skill_id: ${createdId}`;
        return textContent(`Created skill ${data?.name || body.name} (${createdSuffix})`);
      }
      case 'lore_skill_update': {
        const skillId = String(args?.skill_id || '').trim();
        const expectedVersionRaw = args?.expected_version;
        if (!skillId) throw new Error('skill_id is required');
        if (!Number.isInteger(expectedVersionRaw) || expectedVersionRaw < 1) {
          throw new Error('expected_version is required and must be a positive integer');
        }
        const body = { expected_version: expectedVersionRaw };
        if (typeof args?.enabled === 'boolean') body.enabled = args.enabled;
        if (Array.isArray(args?.upsert_files)) body.upsert_files = args.upsert_files;
        if (Array.isArray(args?.delete_paths)) body.delete_paths = args.delete_paths;
        const data = normalizeSkillDetail(await fetchSkillsJson(config, `/${encodeURIComponent(skillId)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }));
        const updatedId = skillIdOf(data) || skillId;
        const updatedVersion = skillVersionOf(data);
        const updatedSuffix = updatedVersion !== undefined && updatedVersion !== null && updatedVersion !== ''
          ? `skill_id: ${updatedId}, version: ${updatedVersion}`
          : `skill_id: ${updatedId}`;
        return textContent(`Updated skill ${data?.name || skillId} (${updatedSuffix})`);
      }
      case 'lore_skill_delete': {
        const skillId = String(args?.skill_id || '').trim();
        if (!skillId) throw new Error('skill_id is required');
        const data = await fetchSkillsJson(config, `/${encodeURIComponent(skillId)}`, { method: 'DELETE' });
        if (data?.project_id) state.projectId = String(data.project_id);
        if (data?.catalog_revision !== undefined) state.catalogRevision = String(data.catalog_revision);
        return textContent(`Deleted skill ${skillId}`);
      }
      case 'lore_skill_import': {
        const source = String(args?.source || '').trim();
        if (!source) throw new Error('source is required');
        const body = { source };
        if (Array.isArray(args?.skills)) {
          body.skills = args.skills.map((s) => String(s || '').trim()).filter(Boolean);
        }
        if (Array.isArray(args?.visibility_client_types)) {
          body.visibility_client_types = args.visibility_client_types.map((s) => String(s || '').trim()).filter(Boolean);
        }
        if (args?.dry_run === true) body.dry_run = true;
        const data = await fetchSkillsJson(config, '/import', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return textContent(`${formatSkillImportText(data)}\n\n${JSON.stringify(data, null, 2)}`);
      }
      case 'lore_skill_status': {
        if (!state.projectId) {
          try {
            const catalog = await listSkills(config, true);
            if (catalog.project_id) {
              state.projectId = catalog.project_id;
              state.catalogRevision = catalog.catalog_revision;
            }
          } catch {
            // keep local-only status
          }
        }
        const work_copies = state.projectId
          ? listLocalWorkCopyStatuses(config.loreHome, state.projectId)
          : listAllLocalWorkCopyStatuses(config.loreHome);
        const lines = work_copies.map((m) => {
          const project = 'project_id' in m && m.project_id ? ` [${m.project_id}]` : '';
          const ver = m.version !== undefined ? ` v${m.version}` : '';
          const msg = m.message ? ` — ${m.message}` : '';
          return `- ${m.name}${project}: ${m.state}${ver}${msg}`;
        });
        const header = `project=${state.projectId || '?'} catalog_revision=${state.catalogRevision || '?'}`;
        const text = [header, ...(lines.length ? lines : ['(no local work copies)'])].join('\n');
        return textContent(text);
      }
      default:
        return textContent(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    return errText(`Lore skill tool ${name} failed`, error);
  }
}
