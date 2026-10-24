import { tool, type Hooks, type ToolContext, type ToolResult } from '@opencode-ai/plugin';
import contracts from './tool-contracts.json' with { type: 'json' };
import { loreFetchJson, type LoreRequestInit } from './api.js';
import type { LorePluginConfig } from './config.js';
import { formatBootView, formatNode, formatSearchResults, normalizeKeywordList } from './formatters.js';
import { resolveMemoryLocator, splitParentPathAndTitle } from './uri.js';
import {
  normalizeSkillCandidate,
  normalizeSkillDetail,
  normalizeSkillSummary,
  skillIdOf,
  skillVersionOf,
  type SkillSummary,
} from './vendor/skill-workcopy/index.mjs';

const MEMORY_TOOL_NAMES = [
  'lore_guidance',
  'lore_status',
  'lore_boot',
  'lore_get_node',
  'lore_search',
  'lore_list_domains',
  'lore_create_node',
  'lore_update_node',
  'lore_delete_node',
  'lore_move_node',
] as const;

const SKILL_TOOL_NAMES = [
  'lore_skill_list',
  'lore_skill_search',
  'lore_skill_create',
  'lore_skill_update',
  'lore_skill_delete',
  'lore_skill_import',
] as const;

export const OPEN_CODE_TOOL_NAMES = [
  ...MEMORY_TOOL_NAMES,
  ...SKILL_TOOL_NAMES,
] as const;

type ToolName = typeof OPEN_CODE_TOOL_NAMES[number];
type ToolContract = typeof contracts[number];

type LoreNodePayload = {
  node?: { uri?: string; content?: string };
  children?: unknown[];
};

function contract(name: ToolName): ToolContract {
  const found = contracts.find((item) => item.name === name);
  if (!found) throw new Error(`Missing generated OpenCode tool contract: ${name}`);
  return found;
}

function parameterDescription(name: ToolName, parameter: string): string {
  const found = contract(name).parameters.find((item) => item.name === parameter);
  if (!found) throw new Error(`Missing generated OpenCode tool parameter contract: ${name}.${parameter}`);
  return found.description;
}

function metadata(context: ToolContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    directory: context.directory,
    worktree: context.worktree,
    ...extra,
  };
}

function result(context: ToolContext, title: string, output: string, extra: Record<string, unknown> = {}): ToolResult {
  return { title, output, metadata: metadata(context, extra) };
}

async function request<T>(
  config: LorePluginConfig,
  context: ToolContext,
  pathname: string,
  init: LoreRequestInit = {},
): Promise<T> {
  return loreFetchJson<T>(config, pathname, { ...init, signal: context.abort });
}

function writeBody<T extends Record<string, unknown>>(context: ToolContext, body: T): T & { session_id: string } {
  return { ...body, session_id: context.sessionID };
}

function skillFileSchema() {
  return tool.schema.object({
    path: tool.schema.string().describe('Relative path inside the skill (must include SKILL.md).'),
    content: tool.schema.string().optional().describe('UTF-8 file content.'),
    content_base64: tool.schema.string().optional().describe('Base64 file content for binary files.'),
    media_type: tool.schema.string().optional().describe('Optional media type.'),
  });
}

function formatSkillImportText(data: Record<string, any>): string {
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

async function listSkillsApi(
  config: LorePluginConfig,
  context: ToolContext,
  includeDisabled = true,
): Promise<{ project_id: string; catalog_revision: string; skills: SkillSummary[] }> {
  const data = await request<Record<string, unknown>>(config, context, '/skills', {
    search: new URLSearchParams({ include_disabled: includeDisabled ? 'true' : 'false' }),
  });
  return {
    project_id: String(data?.project_id || ''),
    catalog_revision: String(data?.catalog_revision || ''),
    skills: Array.isArray(data?.skills)
      ? (data.skills as unknown[]).map((item) => normalizeSkillSummary(item))
      : [],
  };
}

export function createLoreTools(
  config: LorePluginConfig,
  opts: { skillsEnabled?: boolean } = {},
): NonNullable<Hooks['tool']> {
  const tools: NonNullable<Hooks['tool']> = {
    lore_guidance: tool({
      description: contract('lore_guidance').description,
      args: {},
      async execute(_args, context) {
        const data = await request<{ guidance?: string }>(config, context, '/lifecycle/guidance');
        return result(context, 'Lore guidance', data.guidance ?? '');
      },
    }),

    lore_status: tool({
      description: contract('lore_status').description,
      args: {},
      async execute(_args, context) {
        const data = await request<unknown>(config, context, '/health');
        return result(context, 'Lore status', `Lore online\n\n${JSON.stringify(data, null, 2)}`);
      },
    }),

    lore_boot: tool({
      description: contract('lore_boot').description,
      args: {},
      async execute(_args, context) {
        const data = await request<unknown>(config, context, '/browse/boot');
        return result(context, 'Lore boot', formatBootView(data));
      },
    }),

    lore_get_node: tool({
      description: contract('lore_get_node').description,
      args: {
        uri: tool.schema.string().describe(parameterDescription('lore_get_node', 'uri')),
        nav_only: tool.schema.boolean().optional().describe(parameterDescription('lore_get_node', 'nav_only')),
        session_id: tool.schema.string().optional().describe(parameterDescription('lore_get_node', 'session_id')),
        query_id: tool.schema.string().optional().describe(parameterDescription('lore_get_node', 'query_id')),
      },
      async execute(args, context) {
        const locator = resolveMemoryLocator(args, {
          defaultDomain: config.defaultDomain,
          pathKey: '__unused_path',
          allowEmptyPath: true,
          label: 'uri',
        });
        const data = await request<LoreNodePayload>(config, context, '/browse/node', {
          search: new URLSearchParams({
            domain: locator.domain,
            path: locator.path,
            nav_only: String(args.nav_only === true),
          }),
        });
        const sessionID = args.session_id?.trim() || context.sessionID;
        const queryID = args.query_id?.trim() || '';
        const nodeURI = data.node?.uri?.trim() || '';
        if (queryID && nodeURI) {
          try {
            await request(config, context, '/browse/recall/usage', {
              method: 'POST',
              body: {
                query_id: queryID,
                session_id: sessionID,
                node_uris: [nodeURI],
                source: 'tool:lore_get_node',
                success: true,
              },
            });
          } catch {
            // Best effort: opening the node remains successful if usage marking is unavailable.
          }
        }
        return result(context, 'Lore node', formatNode(data), { uri: nodeURI || `${locator.domain}://${locator.path}` });
      },
    }),

    lore_search: tool({
      description: contract('lore_search').description,
      args: {
        query: tool.schema.string().describe(parameterDescription('lore_search', 'query')),
        domain: tool.schema.string().optional().describe(parameterDescription('lore_search', 'domain')),
        limit: tool.schema.number().int().min(1).max(20).optional().describe(parameterDescription('lore_search', 'limit')),
        full: tool.schema.boolean().optional().describe(parameterDescription('lore_search', 'full')),
      },
      async execute(args, context) {
        const query = args.query.trim();
        const domain = args.domain?.trim() || null;
        if (domain && (!query || query === '*')) {
          const data = await request(config, context, '/browse/node', {
            search: new URLSearchParams({ domain, path: '', nav_only: 'true' }),
          });
          return result(context, 'Lore domain', `Domain root: ${domain}://\n\n${formatNode(data)}`);
        }
        const full = args.full === true;
        const data = await request(config, context, '/browse/search', {
          method: 'POST',
          body: {
            query,
            domain,
            limit: args.limit ?? 5,
            content_limit: full ? 1 : 0,
            full,
          },
        });
        return result(context, 'Lore search', formatSearchResults(data, domain, full));
      },
    }),

    lore_list_domains: tool({
      description: contract('lore_list_domains').description,
      args: {},
      async execute(_args, context) {
        const data = await request<unknown[]>(config, context, '/browse/domains');
        const output = Array.isArray(data) && data.length > 0
          ? data.map((item) => {
            const domain = String((item as Record<string, unknown>).domain ?? '');
            const count = String((item as Record<string, unknown>).root_count ?? '');
            return `- ${domain} (${count}) — open root with lore_get_node uri="${domain}://" nav_only=true`;
          }).join('\n')
          : 'No domains found.';
        return result(context, 'Lore domains', output);
      },
    }),

    lore_create_node: tool({
      description: contract('lore_create_node').description,
      args: {
        content: tool.schema.string().describe(parameterDescription('lore_create_node', 'content')),
        priority: tool.schema.number().int().min(0).describe(parameterDescription('lore_create_node', 'priority')),
        glossary: tool.schema.array(tool.schema.string().describe(parameterDescription('lore_create_node', 'glossary'))).max(12).describe(parameterDescription('lore_create_node', 'glossary')),
        uri: tool.schema.string().optional().describe(parameterDescription('lore_create_node', 'uri')),
        domain: tool.schema.string().optional().describe(parameterDescription('lore_create_node', 'domain')),
        parent_path: tool.schema.string().optional().describe(parameterDescription('lore_create_node', 'parent_path')),
        title: tool.schema.string().optional().describe(parameterDescription('lore_create_node', 'title')),
        disclosure: tool.schema.string().optional().describe(parameterDescription('lore_create_node', 'disclosure')),
      },
      async execute(args, context) {
        let domain = args.domain?.trim() || config.defaultDomain;
        let parentPath = args.parent_path?.trim().replace(/^\/+|\/+$/g, '') || '';
        let title = args.title?.trim() || '';
        if (args.uri?.trim()) {
          const target = resolveMemoryLocator(args, {
            defaultDomain: config.defaultDomain,
            pathKey: 'parent_path',
            allowEmptyPath: false,
            label: 'uri',
          });
          const derived = splitParentPathAndTitle(target.path);
          if (!derived.title) throw new Error('Create target URI must include a final path segment.');
          if (title && title !== derived.title) throw new Error(`Conflicting uri and title: ${derived.title} vs ${title}`);
          domain = target.domain;
          parentPath = derived.parentPath;
          title = derived.title;
        }
        if (args.glossary.length > 12) {
          throw new Error(`glossary accepts at most 12 keywords (got ${args.glossary.length})`);
        }
        const glossary = normalizeKeywordList(args.glossary);
        const data = await request<Record<string, unknown>>(config, context, '/browse/node', {
          method: 'POST',
          body: writeBody(context, {
            domain,
            parent_path: parentPath,
            title,
            content: args.content,
            priority: args.priority,
            glossary,
            ...(args.disclosure === undefined ? {} : { disclosure: args.disclosure }),
          }),
        });
        const uri = String(data.uri ?? `${domain}://${parentPath}/${title}`).replace(/\/+/g, '/').replace(':/', '://');
        return result(context, 'Lore create', `Created ${uri}${glossary.length > 0 ? `\nGlossary: ${glossary.join(', ')}` : ''}`);
      },
    }),

    lore_update_node: tool({
      description: contract('lore_update_node').description,
      args: {
        uri: tool.schema.string().describe(parameterDescription('lore_update_node', 'uri')),
        content: tool.schema.string().optional().describe(parameterDescription('lore_update_node', 'content')),
        old_text: tool.schema.string().optional().describe(parameterDescription('lore_update_node', 'old_text')),
        new_text: tool.schema.string().optional().describe(parameterDescription('lore_update_node', 'new_text')),
        priority: tool.schema.number().int().min(0).optional().describe(parameterDescription('lore_update_node', 'priority')),
        disclosure: tool.schema.string().optional().describe(parameterDescription('lore_update_node', 'disclosure')),
        glossary_add: tool.schema.array(tool.schema.string()).optional().describe(parameterDescription('lore_update_node', 'glossary_add')),
        glossary_remove: tool.schema.array(tool.schema.string()).optional().describe(parameterDescription('lore_update_node', 'glossary_remove')),
      },
      async execute(args, context) {
        const locator = resolveMemoryLocator(args, {
          defaultDomain: config.defaultDomain,
          pathKey: '__unused_path',
          allowEmptyPath: false,
          label: 'uri',
        });
        const glossaryAdd = normalizeKeywordList(args.glossary_add);
        const glossaryRemove = normalizeKeywordList(args.glossary_remove);
        const search = new URLSearchParams({ domain: locator.domain, path: locator.path });
        const body: Record<string, unknown> = { session_id: context.sessionID };
        if (args.old_text !== undefined) {
          if (args.old_text.length === 0) throw new Error('old_text must not be empty');
          if (args.content !== undefined) throw new Error('Pass either content or old_text/new_text, not both');
          const current = await request<LoreNodePayload>(config, context, '/browse/node', { search });
          const currentContent = typeof current.node?.content === 'string' ? current.node.content : '';
          const occurrences = currentContent.split(args.old_text).length - 1;
          if (occurrences === 0) throw new Error('old_text not found');
          if (occurrences > 1) throw new Error(`old_text found ${occurrences} times`);
          body.content = currentContent.replace(args.old_text, args.new_text ?? '');
        } else if (args.content !== undefined) {
          body.content = args.content;
        }
        if (args.priority !== undefined) body.priority = args.priority;
        if (args.disclosure !== undefined) body.disclosure = args.disclosure;
        if (glossaryAdd.length > 0) body.glossary_add = glossaryAdd;
        if (glossaryRemove.length > 0) body.glossary_remove = glossaryRemove;
        const data = await request<Record<string, unknown>>(config, context, '/browse/node', {
          method: 'PUT',
          search,
          body,
        });
        return result(context, 'Lore update', `Updated ${String(data.uri ?? args.uri)}`);
      },
    }),

    lore_delete_node: tool({
      description: contract('lore_delete_node').description,
      args: {
        uri: tool.schema.string().describe(parameterDescription('lore_delete_node', 'uri')),
      },
      async execute(args, context) {
        const locator = resolveMemoryLocator(args, {
          defaultDomain: config.defaultDomain,
          pathKey: '__unused_path',
          allowEmptyPath: false,
          label: 'uri',
        });
        const data = await request<Record<string, unknown>>(config, context, '/browse/node', {
          method: 'DELETE',
          search: new URLSearchParams({ domain: locator.domain, path: locator.path }),
          body: writeBody(context, {}),
        });
        return result(context, 'Lore delete', `Deleted ${String(data.deleted_uri ?? data.uri ?? args.uri)}`);
      },
    }),

    lore_move_node: tool({
      description: contract('lore_move_node').description,
      args: {
        old_uri: tool.schema.string().describe(parameterDescription('lore_move_node', 'old_uri')),
        new_uri: tool.schema.string().describe(parameterDescription('lore_move_node', 'new_uri')),
      },
      async execute(args, context) {
        const data = await request<Record<string, unknown>>(config, context, '/browse/move', {
          method: 'POST',
          body: writeBody(context, {
            old_uri: args.old_uri.trim(),
            new_uri: args.new_uri.trim(),
          }),
        });
        return result(context, 'Lore move', `Moved ${String(data.old_uri ?? args.old_uri)} → ${String(data.new_uri ?? data.uri ?? args.new_uri)}`);
      },
    }),

    lore_skill_list: tool({
      description: contract('lore_skill_list').description,
      args: {
        include_disabled: tool.schema.boolean().optional().describe(parameterDescription('lore_skill_list', 'include_disabled')),
      },
      async execute(args, context) {
        const includeDisabled = args.include_disabled !== false;
        const data = await listSkillsApi(config, context, includeDisabled);
        const lines = (data.skills || []).map((s) => {
          const enabled = s.enabled === false ? 'disabled' : 'enabled';
          return `- ${s.name} (${skillIdOf(s)}) ${enabled} v${skillVersionOf(s) ?? '?'}`;
        });
        const text = lines.length > 0
          ? `Project ${data.project_id} rev ${data.catalog_revision}\n${lines.join('\n')}`
          : `Project ${data.project_id || '?'} rev ${data.catalog_revision || '?'}\nNo skills.`;
        return result(context, 'Lore skill list', text, {
          project_id: data.project_id,
          catalog_revision: data.catalog_revision,
          skills: data.skills,
        });
      },
    }),

    lore_skill_search: tool({
      description: contract('lore_skill_search').description,
      args: {
        query: tool.schema.string().describe(parameterDescription('lore_skill_search', 'query')),
        limit: tool.schema.number().int().min(1).max(50).optional().describe(parameterDescription('lore_skill_search', 'limit')),
      },
      async execute(args, context) {
        const search = new URLSearchParams({ query: args.query.trim() });
        if (args.limit !== undefined) search.set('limit', String(args.limit));
        const data = await request<Record<string, unknown>>(config, context, '/skills/recall', { search });
        if (Array.isArray(data?.candidates)) {
          data.candidates = (data.candidates as unknown[]).map((item) => normalizeSkillCandidate(item));
        }
        return result(context, 'Lore skill search', JSON.stringify(data, null, 2));
      },
    }),

    lore_skill_create: tool({
      description: contract('lore_skill_create').description,
      args: {
        name: tool.schema.string().describe(parameterDescription('lore_skill_create', 'name')),
        enabled: tool.schema.boolean().optional().describe(parameterDescription('lore_skill_create', 'enabled')),
        files: tool.schema.array(skillFileSchema()).describe(parameterDescription('lore_skill_create', 'files')),
      },
      async execute(args, context) {
        const name = args.name.trim();
        if (!name) throw new Error('name is required');
        const body = {
          name,
          enabled: args.enabled !== false,
          files: args.files,
        };
        const data = normalizeSkillDetail(await request(config, context, '/skills', {
          method: 'POST',
          body,
        }));
        const createdId = skillIdOf(data) || '?';
        const createdVersion = skillVersionOf(data);
        const createdSuffix = createdVersion !== undefined && createdVersion !== null && createdVersion !== ''
          ? `skill_id: ${createdId}, version: ${createdVersion}`
          : `skill_id: ${createdId}`;
        return result(
          context,
          'Lore skill create',
          `Created skill ${data.name || name} (${createdSuffix})`,
          { skill: data },
        );
      },
    }),

    lore_skill_update: tool({
      description: contract('lore_skill_update').description,
      args: {
        skill_id: tool.schema.string().describe(parameterDescription('lore_skill_update', 'skill_id')),
        expected_version: tool.schema.number().int().min(1).describe(parameterDescription('lore_skill_update', 'expected_version')),
        enabled: tool.schema.boolean().optional().describe(parameterDescription('lore_skill_update', 'enabled')),
        upsert_files: tool.schema.array(skillFileSchema()).optional().describe(parameterDescription('lore_skill_update', 'upsert_files')),
        delete_paths: tool.schema.array(tool.schema.string().describe('Relative path to delete.')).optional()
          .describe(parameterDescription('lore_skill_update', 'delete_paths')),
      },
      async execute(args, context) {
        const skillId = args.skill_id.trim();
        if (!skillId) throw new Error('skill_id is required');
        if (!Number.isInteger(args.expected_version) || args.expected_version < 1) {
          throw new Error('expected_version is required and must be a positive integer');
        }
        const body: Record<string, unknown> = { expected_version: args.expected_version };
        if (typeof args.enabled === 'boolean') body.enabled = args.enabled;
        if (Array.isArray(args.upsert_files)) body.upsert_files = args.upsert_files;
        if (Array.isArray(args.delete_paths)) body.delete_paths = args.delete_paths;
        const data = normalizeSkillDetail(await request(config, context, `/skills/${encodeURIComponent(skillId)}`, {
          method: 'PATCH',
          body,
        }));
        const updatedId = skillIdOf(data) || skillId;
        const updatedVersion = skillVersionOf(data);
        const updatedSuffix = updatedVersion !== undefined && updatedVersion !== null && updatedVersion !== ''
          ? `skill_id: ${updatedId}, version: ${updatedVersion}`
          : `skill_id: ${updatedId}`;
        return result(
          context,
          'Lore skill update',
          `Updated skill ${data.name || skillId} (${updatedSuffix})`,
          { skill: data },
        );
      },
    }),

    lore_skill_delete: tool({
      description: contract('lore_skill_delete').description,
      args: {
        skill_id: tool.schema.string().describe(parameterDescription('lore_skill_delete', 'skill_id')),
      },
      async execute(args, context) {
        const skillId = args.skill_id.trim();
        if (!skillId) throw new Error('skill_id is required');
        const data = await request<Record<string, unknown>>(config, context, `/skills/${encodeURIComponent(skillId)}`, {
          method: 'DELETE',
        });
        return result(context, 'Lore skill delete', `Deleted skill ${skillId}`, { result: data });
      },
    }),

    lore_skill_import: tool({
      description: contract('lore_skill_import').description,
      args: {
        source: tool.schema.string().describe(parameterDescription('lore_skill_import', 'source')),
        skills: tool.schema.array(tool.schema.string()).optional().describe(parameterDescription('lore_skill_import', 'skills')),
        visibility_client_types: tool.schema.array(tool.schema.string()).optional()
          .describe(parameterDescription('lore_skill_import', 'visibility_client_types')),
        dry_run: tool.schema.boolean().optional().describe(parameterDescription('lore_skill_import', 'dry_run')),
      },
      async execute(args, context) {
        const source = args.source.trim();
        if (!source) throw new Error('source is required');
        const body: Record<string, unknown> = { source };
        if (args.skills !== undefined) {
          body.skills = args.skills.map((name) => name.trim()).filter(Boolean);
        }
        if (args.visibility_client_types !== undefined) {
          body.visibility_client_types = args.visibility_client_types.map((type) => type.trim()).filter(Boolean);
        }
        if (args.dry_run === true) body.dry_run = true;
        const data = await request<Record<string, any>>(config, context, '/skills/import', {
          method: 'POST',
          body,
        });
        return result(
          context,
          'Lore skill import',
          `${formatSkillImportText(data)}\n\n${JSON.stringify(data, null, 2)}`,
          { result: data },
        );
      },
    }),

  };

  if (opts.skillsEnabled === false) {
    for (const name of SKILL_TOOL_NAMES) delete tools[name];
  }
  return tools;
}
