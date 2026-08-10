import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendSkillBlockToRecallMessage,
  computeManifestHash,
  createSkillsSession,
  discoveryCandidateEntries,
  ensureSkillWorkCopy,
  formatSkillCandidateBlock,
  inspectLocalWorkCopy,
  LEGACY_MIRROR_SCHEMA,
  LORE_SKILL_MARKER,
  LORE_SKILL_SCHEMA,
  materializeSkillWorkCopy,
  normalizeSkillSummary,
  readWorkCopyMarker,
  registerSkillTools,
  resolveLoreHome,
  sha256Buffer,
  sha256Text,
  skillRevisionOf,
  skillVersionOf,
  validateManagedFileList,
  validateSafeRelativePath,
} from '../skills';
import { registerHooks } from '../hooks';
import { registerTools } from '../tools';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lore-skills-'));
}

function rmTempHome(dir: string) {
  const walk = (current: string) => {
    try {
      const st = fs.lstatSync(current);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        try { fs.chmodSync(current, 0o755); } catch { /* ignore */ }
        for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
      } else if (st.isFile()) {
        try { fs.chmodSync(current, 0o644); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  };
  walk(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

function skillDetail(overrides: Record<string, unknown> = {}) {
  const content = String(overrides.content ?? '# Demo Skill\n\nDo the thing.\n');
  const sha = sha256Text(content);
  const files = (overrides.files as any[]) || [
    {
      path: 'SKILL.md',
      content,
      sha256: sha,
      size: Buffer.byteLength(content, 'utf-8'),
      media_type: 'text/markdown',
    },
  ];
  const manifest_hash = typeof overrides.manifest_hash === 'string'
    ? overrides.manifest_hash
    : computeManifestHash(
      files.map((f) => {
        const buf = f.content_base64
          ? Buffer.from(f.content_base64, 'base64')
          : Buffer.from(String(f.content || ''), 'utf-8');
        return { path: f.path, sha256: f.sha256 || sha256Buffer(buf), size: buf.length };
      }),
    );
  const { content: _content, files: _files, manifest_hash: _mh, ...rest } = overrides;
  return {
    id: 'skill-1',
    project_id: 'proj-1',
    name: 'demo-skill',
    description: 'A demo skill',
    enabled: true,
    version: 1,
    ...rest,
    manifest_hash,
    files,
  };
}

describe('skills re-export surface (shared core via vendor)', () => {
  it('accepts safe relative paths and rejects traversal/absolute', () => {
    expect(validateSafeRelativePath('SKILL.md')).toBe('SKILL.md');
    expect(validateSafeRelativePath('refs/notes.md')).toBe('refs/notes.md');
    expect(() => validateSafeRelativePath('refs/../SKILL.md')).toThrow(/traversal/);
    expect(() => validateSafeRelativePath('../SKILL.md')).toThrow(/traversal/);
    expect(() => validateSafeRelativePath('/abs/SKILL.md')).toThrow(/absolute/);
    expect(() => validateSafeRelativePath('C:/abs/SKILL.md')).toThrow(/absolute/);
    expect(() => validateSafeRelativePath('refs\\notes.md')).toThrow(/backslashes/);
    expect(() => validateSafeRelativePath('a//b.md')).toThrow(/empty path segments/);
    expect(() => validateSafeRelativePath('')).toThrow(/required/);
  });

  it('computes deterministic manifest hashes', () => {
    const a = computeManifestHash([
      { path: 'b.md', sha256: 'bb', size: 2 },
      { path: 'a.md', sha256: 'aa', size: 1 },
    ]);
    const b = computeManifestHash([
      { path: 'a.md', sha256: 'aa', size: 1 },
      { path: 'b.md', sha256: 'bb', size: 2 },
    ]);
    expect(a).toBe(b);
    expect(a).toBe(sha256Text('a.md\naa\n1\nb.md\nbb\n2\n'));
  });

  it('resolves LORE_HOME', () => {
    const dir = makeTempHome();
    expect(resolveLoreHome({ LORE_HOME: dir } as any)).toBe(path.resolve(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prefers canonical version/revision_hash over expected_* aliases', () => {
    expect(skillVersionOf({ version: 5, expected_version: 9 } as any)).toBe(5);
    expect(skillVersionOf({ expected_version: 3 } as any)).toBe(3);
    expect(skillRevisionOf({ revision_hash: 'rev-a', expected_revision_hash: 'rev-b' } as any)).toBe('rev-a');
    expect(skillRevisionOf({ expected_revision_hash: 'rev-b' } as any)).toBe('rev-b');
    const norm = normalizeSkillSummary({
      id: 's',
      name: 'n',
      version: 2,
      expected_version: 99,
      revision_hash: 'r1',
      expected_revision_hash: 'r2',
    });
    expect(norm.version).toBe(2);
    expect(norm.revision_hash).toBe('r1');
  });

  it('validateManagedFileList rejects unsafe lists', () => {
    expect(() => validateManagedFileList(['SKILL.md', '../x'])).toThrow(/traversal/);
    expect(() => validateManagedFileList(['SKILL.md', 'SKILL.md'])).toThrow(/duplicate/);
    expect(() => validateManagedFileList(['SKILL.md', LORE_SKILL_MARKER])).toThrow(/managed_files/);
    expect(() => validateManagedFileList(['a.md', 'a.md/b.md'])).toThrow(/conflicts with parent/);
    expect(() => validateManagedFileList(['refs/notes.md'])).toThrow(/SKILL\.md/);
    expect(validateManagedFileList(['refs/a.md', 'SKILL.md'])).toEqual(['SKILL.md', 'refs/a.md']);
  });
});

describe('skills adapter ensure DI + work-copy smoke', () => {
  let loreHome: string;
  const projectId = 'proj-1';

  beforeEach(() => {
    loreHome = makeTempHome();
  });

  afterEach(() => {
    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it('materialize via re-export writes writable work copy under loreHome', () => {
    const helperContent = '# helper\n';
    const detail = skillDetail({
      files: [
        {
          path: 'SKILL.md',
          content: '# Demo Skill\n',
          sha256: sha256Text('# Demo Skill\n'),
          size: Buffer.byteLength('# Demo Skill\n', 'utf-8'),
        },
        {
          path: 'refs/helper.md',
          content: helperContent,
          sha256: sha256Text(helperContent),
          size: Buffer.byteLength(helperContent, 'utf-8'),
        },
      ],
    });
    const { installPath, marker } = materializeSkillWorkCopy({ loreHome, projectId, detail });
    expect(fs.existsSync(path.join(installPath, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(installPath, 'refs', 'helper.md'))).toBe(true);
    expect(marker.schema).toBe(LORE_SKILL_SCHEMA);
    expect(marker.managed_files).toEqual(['SKILL.md', 'refs/helper.md']);
    expect(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      version: 1,
    }).state).toBe('ready');
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# edited\n', 'utf-8');
    expect(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8')).toBe('# edited\n');
  });

  it('ensureSkillWorkCopy uses pluginCfg loadSkill path and preserves same-version edits', async () => {
    const detail = skillDetail({ version: 1 });
    materializeSkillWorkCopy({ loreHome, projectId, detail });
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# local edit\n', 'utf-8');
    fs.mkdirSync(path.join(installPath, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'outputs', 'result.json'), '{"ok":true}\n', 'utf-8');

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/skills/skill-1')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const result = await ensureSkillWorkCopy({
      pluginCfg: { baseUrl: 'http://host', apiToken: '', timeoutMs: 1000, loreHome },
      loreHome,
      skillId: 'skill-1',
      projectId,
    });
    expect(result.downloaded).toBe(false);
    expect(result.skill_md).toBe('# local edit\n');
    expect(result.skill_dir).toBe(path.resolve(installPath));
    expect(fs.readFileSync(path.join(installPath, 'outputs', 'result.json'), 'utf-8')).toBe('{"ok":true}\n');
  });

  it('ensureSkillWorkCopy first get downloads files and returns skill_md + absolute skill_dir', async () => {
    const helper = 'helper body\n';
    const detail = skillDetail({
      version: 3,
      files: [
        {
          path: 'SKILL.md',
          content: '# Get Skill\n',
          sha256: sha256Text('# Get Skill\n'),
          size: Buffer.byteLength('# Get Skill\n', 'utf-8'),
        },
        {
          path: 'lib/util.md',
          content: helper,
          sha256: sha256Text(helper),
          size: Buffer.byteLength(helper, 'utf-8'),
        },
      ],
    });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/skills/skill-1')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const result = await ensureSkillWorkCopy({
      pluginCfg: { baseUrl: 'http://host', apiToken: '', timeoutMs: 1000, loreHome },
      loreHome,
      skillId: 'skill-1',
      projectId,
    });
    expect(result.downloaded).toBe(true);
    expect(result.skill_md).toBe('# Get Skill\n');
    expect(result.skill_dir).toBe(path.resolve(path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill')));
    expect(fs.existsSync(path.join(result.skill_dir, 'lib', 'util.md'))).toBe(true);
    expect(result.server_version).toBe(3);
    expect(result.local_version).toBe(3);
  });

  it('ensureSkillWorkCopy migrates legacy same-version mirror', async () => {
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# legacy\n', 'utf-8');
    fs.writeFileSync(path.join(installPath, LORE_SKILL_MARKER), JSON.stringify({
      schema: LEGACY_MIRROR_SCHEMA,
      project_id: projectId,
      skill_id: 'skill-1',
      name: 'demo-skill',
      version: 1,
      revision_hash: 'rev-legacy',
      manifest_hash: 'mh',
      synced_at: new Date().toISOString(),
    }, null, 2), 'utf-8');

    const detail = skillDetail({
      version: 1,
      content: '# legacy\n',
      files: [
        {
          path: 'SKILL.md',
          content: '# legacy\n',
          sha256: sha256Text('# legacy\n'),
          size: Buffer.byteLength('# legacy\n', 'utf-8'),
        },
      ],
    });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/skills/skill-1')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const result = await ensureSkillWorkCopy({
      pluginCfg: { baseUrl: 'http://host', apiToken: '', timeoutMs: 1000, loreHome },
      loreHome,
      skillId: 'skill-1',
      projectId,
    });
    expect(result.downloaded).toBe(true);
    const marker = readWorkCopyMarker(result.skill_dir);
    expect(marker?.schema).toBe(LORE_SKILL_SCHEMA);
    expect(marker?.managed_files).toEqual(['SKILL.md']);
    fs.writeFileSync(path.join(result.skill_dir, 'SKILL.md'), '# edited after migrate\n', 'utf-8');
    expect(fs.readFileSync(path.join(result.skill_dir, 'SKILL.md'), 'utf-8')).toBe('# edited after migrate\n');
  });

  it('ensureSkillWorkCopy errors on wrong skill_id identity', async () => {
    materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail({ id: 'skill-1', version: 1 }),
    });
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    const marker = JSON.parse(fs.readFileSync(path.join(installPath, LORE_SKILL_MARKER), 'utf-8'));
    marker.skill_id = 'other-skill';
    fs.writeFileSync(path.join(installPath, LORE_SKILL_MARKER), JSON.stringify(marker));

    const detail = skillDetail({ id: 'skill-1', version: 1 });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(detail),
    })));

    await expect(ensureSkillWorkCopy({
      pluginCfg: { baseUrl: 'http://host', apiToken: '', timeoutMs: 1000, loreHome },
      loreHome,
      skillId: 'skill-1',
      projectId,
    })).rejects.toThrow(/skill_id mismatch|invalid/);
  });
});

describe('skills lifecycle candidate discovery', () => {
  let loreHome: string;
  const projectId = 'proj-life';

  beforeEach(() => {
    loreHome = makeTempHome();
    process.env.LORE_HOME = loreHome;
  });

  afterEach(() => {
    delete process.env.LORE_HOME;
    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it('recall candidate block has IDs/version and no local path/download', () => {
    const discovered = discoveryCandidateEntries([
      {
        skill_id: 's-ready',
        name: 'ready-skill',
        version: 2,
        description: 'ok',
      },
      {
        id: 's-two',
        name: 'second',
        expected_version: 1,
        description: 'also',
      },
      {
        name: 'no-id',
      },
    ]);
    expect(discovered).toHaveLength(2);
    expect(discovered[0]).toMatchObject({ skill_id: 's-ready', name: 'ready-skill', version: 2 });

    const block = formatSkillCandidateBlock(discovered);
    expect(block).toContain('<lore-skills>');
    expect(block).toContain('skill_id: s-ready');
    expect(block).toContain('version: 2');
    expect(block).toContain('ready-skill');
    expect(block).toContain('lore_skill_get');
    expect(block).not.toContain('SKILL.md:');
    expect(block).not.toContain(path.join(loreHome, 'skill-artifacts'));
    expect(block).not.toContain('/installed/');
  });

  it('appends skill block to existing hidden recall message or creates one', () => {
    const block = formatSkillCandidateBlock([{
      skill_id: 's-ready',
      name: 'ready-skill',
      version: 1,
      description: 'ok',
    }]);
    const withRecall = appendSkillBlockToRecallMessage({
      customType: 'lore-recall',
      content: '<recall session_id="s">\n0.9 | core://x\n</recall>',
      display: false,
    }, block);
    expect(withRecall.content).toContain('<recall');
    expect(withRecall.content).toContain('<lore-skills>');
    expect(withRecall.content).toContain('skill_id: s-ready');
    expect(withRecall.display).toBe(false);

    const created = appendSkillBlockToRecallMessage(undefined, block);
    expect(created.customType).toBe('lore-recall');
    expect(created.content).toContain('<lore-skills>');
    expect(created.display).toBe(false);
  });

  it('session_start records catalog identity without downloading; prompt only discovers candidates', async () => {
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
      injectPromptGuidance: true,
      recallEnabled: true,
      startupHealthcheck: false,
    };

    const fetchMock = vi.fn(async (url: string, init: any) => {
      const u = String(url);
      if (u.includes('/lifecycle/event')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body?.event?.name === 'session.start') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify({
              host_output: { mode: 'return_value', value: { systemPromptAppend: 'SYS' } },
              skill_catalog: { project_id: projectId, catalog_revision: 'cat-1' },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({
            host_output: {
              mode: 'return_value',
              value: {
                message: {
                  customType: 'lore-recall',
                  content: '<recall session_id="sess-s">\n0.8 | core://a\n</recall>',
                  display: false,
                },
              },
            },
            skill_catalog: { project_id: projectId, catalog_revision: 'cat-1' },
            skill_candidates: [{
              skill_id: 's-prompt',
              name: 'prompt-skill',
              description: 'for prompts',
              expected_version: 1,
            }],
          }),
        };
      }
      if (u.includes('/api/skills')) {
        return { ok: false, status: 500, statusText: 'ERR', text: async () => 'should not sync' };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const pi = {
      events: {} as Record<string, any>,
      on(event: string, handler: any) { this.events[event] = handler; },
      logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
    };
    const skills = createSkillsSession(pluginCfg);
    registerHooks(pi as any, pluginCfg, skills);

    const ctx = { sessionManager: { getSessionId: () => 'sess-s' } };
    await pi.events.session_start({ reason: 'startup' }, ctx);
    expect(fs.existsSync(path.join(loreHome, 'skill-artifacts', projectId, 'prompt-skill'))).toBe(false);
    expect(skills.state.projectId).toBe(projectId);
    expect(skills.state.catalogRevision).toBe('cat-1');

    const turn = await pi.events.before_agent_start({ prompt: 'use skill', systemPrompt: 'base' }, ctx);
    expect(turn.systemPrompt).toContain('SYS');
    expect(turn.message.content).toContain('<recall');
    expect(turn.message.content).toContain('<lore-skills>');
    expect(turn.message.content).toContain('prompt-skill');
    expect(turn.message.content).toContain('skill_id: s-prompt');
    expect(turn.message.content).not.toContain(path.join(loreHome, 'skill-artifacts'));
    expect(fs.existsSync(path.join(loreHome, 'skill-artifacts', projectId, 'prompt-skill'))).toBe(false);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('/api/skills'))).toBe(true);
  });

  it('failed skill discovery fails open and still returns memory recall', async () => {
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
      injectPromptGuidance: true,
      recallEnabled: true,
      startupHealthcheck: false,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/lifecycle/event')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({
            host_output: {
              mode: 'return_value',
              value: {
                message: {
                  customType: 'lore-recall',
                  content: '<recall>\n0.5 | core://x\n</recall>',
                  display: false,
                },
              },
            },
            skill_catalog: { project_id: projectId, catalog_revision: 'cat-x' },
            skill_candidates: [{ skill_id: 's-x', name: 'broken', expected_version: 1 }],
          }),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const pi = {
      events: {} as Record<string, any>,
      on(event: string, handler: any) { this.events[event] = handler; },
      logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
    };
    const skills = createSkillsSession(pluginCfg);
    const original = skills.onPromptLifecycle.bind(skills);
    skills.onPromptLifecycle = async (resp: any) => {
      try {
        return await original(resp);
      } catch {
        throw new Error('discovery boom');
      }
    };
    registerHooks(pi as any, pluginCfg, skills);
    const ctx = { sessionManager: { getSessionId: () => 'sess-fail' } };
    const turn = await pi.events.before_agent_start({ prompt: 'hello', systemPrompt: 'base' }, ctx);
    expect(turn.message.content).toContain('<recall>');
    expect(turn.message.content).toContain('<lore-skills>');
  });
});

describe('skills CRUD tools', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function makeMockPi() {
    const tools: Record<string, any> = {};
    return {
      tools,
      registerTool(tool: any) {
        tools[tool.name] = tool;
      },
    };
  }

  it('registers skill tools without prompt guidance fields; artifact tool absent', () => {
    const pi = makeMockPi();
    registerTools(pi as any, {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      defaultDomain: 'core',
      recallEnabled: true,
    });
    const skillTools = [
      'lore_skill_list',
      'lore_skill_search',
      'lore_skill_get',
      'lore_skill_create',
      'lore_skill_update',
      'lore_skill_delete',
      'lore_skill_status',
    ];
    for (const name of skillTools) {
      expect(pi.tools[name]).toBeDefined();
      expect(pi.tools[name].promptSnippet).toBeUndefined();
      expect(pi.tools[name].promptGuidelines).toBeUndefined();
    }
    expect(pi.tools.lore_skill_artifact_create).toBeUndefined();
  });

  it('create/update/delete send expected request bodies and do not auto-reconcile', async () => {
    const loreHome = makeTempHome();
    const projectId = 'proj-tools';
    const detail = skillDetail({ name: 'tool-skill', id: 'skill-tool', version: 1, project_id: projectId });
    const pi = makeMockPi();
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
      defaultDomain: 'core',
      recallEnabled: true,
    };
    const session = createSkillsSession(pluginCfg);
    registerSkillTools(pi as any, pluginCfg, session);

    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
      const u = String(url);
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });

      if (method === 'POST' && u.includes('/api/skills?')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ id: 'skill-tool', name: 'tool-skill', version: 1, project_id: projectId }),
        };
      }
      if (method === 'PATCH' && u.includes('/api/skills/skill-tool')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ id: 'skill-tool', name: 'tool-skill', version: 2, project_id: projectId }),
        };
      }
      if (method === 'DELETE' && u.includes('/api/skills/skill-tool')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ ok: true, id: 'skill-tool' }),
        };
      }
      if (method === 'GET' && u.includes('/api/skills/skill-tool')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => `missing ${u}` };
    }));

    const createBody = {
      name: 'tool-skill',
      enabled: true,
      files: [{ path: 'SKILL.md', content: '# Tool\n' }],
    };
    const created = await pi.tools.lore_skill_create.execute('t1', createBody);
    expect(created.details.ok).toBe(true);
    expect(created.content[0].text).toContain('skill_id: skill-tool');
    expect(created.content[0].text).toContain('version: 1');
    const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/skills'));
    expect(createCall?.body).toMatchObject(createBody);

    const updateBody = {
      skill_id: 'skill-tool',
      expected_version: 1,
      enabled: false,
      upsert_files: [{ path: 'SKILL.md', content: '# Tool v2\n' }],
      delete_paths: ['old.md'],
    };
    const updated = await pi.tools.lore_skill_update.execute('t2', updateBody);
    expect(updated.details.ok).toBe(true);
    expect(updated.content[0].text).toContain('skill_id: skill-tool');
    expect(updated.content[0].text).toContain('version: 2');
    const updateCall = calls.find((c) => c.method === 'PATCH');
    expect(updateCall?.body).toMatchObject({
      expected_version: 1,
      enabled: false,
      upsert_files: updateBody.upsert_files,
      delete_paths: ['old.md'],
    });
    expect(updateCall?.body).not.toHaveProperty('expected_revision_hash');

    const deleted = await pi.tools.lore_skill_delete.execute('t3', { skill_id: 'skill-tool' });
    expect(deleted.details.ok).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/api/skills/skill-tool'))).toBe(true);
    expect(calls.filter((c) => c.method === 'GET' && c.url.includes('/api/skills?'))).toHaveLength(0);

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it('expected_version is required positive integer on update', async () => {
    const pi = makeMockPi();
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome: makeTempHome(),
    };
    registerSkillTools(pi as any, pluginCfg, createSkillsSession(pluginCfg));
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('should not call server without expected_version');
    }));

    const missing = await pi.tools.lore_skill_update.execute('t', {
      skill_id: 'skill-tool',
      upsert_files: [{ path: 'SKILL.md', content: '# x\n' }],
    });
    expect(missing.details.ok).toBe(false);
    expect(missing.details.error).toMatch(/expected_version/);

    const nonInt = await pi.tools.lore_skill_update.execute('t', {
      skill_id: 'skill-tool',
      expected_version: '1',
    });
    expect(nonInt.details.ok).toBe(false);
    expect(nonInt.details.error).toMatch(/expected_version/);

    const zero = await pi.tools.lore_skill_update.execute('t', {
      skill_id: 'skill-tool',
      expected_version: 0,
    });
    expect(zero.details.ok).toBe(false);
    expect(zero.details.error).toMatch(/positive integer/);

    const negative = await pi.tools.lore_skill_update.execute('t', {
      skill_id: 'skill-tool',
      expected_version: -3,
    });
    expect(negative.details.ok).toBe(false);
    expect(negative.details.error).toMatch(/positive integer/);

    rmTempHome(pluginCfg.loreHome);
    vi.unstubAllGlobals();
  });

  it('lore_skill_get returns skill_md and absolute skill_dir', async () => {
    const loreHome = makeTempHome();
    const projectId = 'proj-get';
    const detail = skillDetail({
      name: 'get-skill',
      id: 'skill-get',
      project_id: projectId,
      version: 1,
      content: '# Get Me\n',
    });
    detail.files = [{
      path: 'SKILL.md',
      content: '# Get Me\n',
      sha256: sha256Text('# Get Me\n'),
      size: Buffer.byteLength('# Get Me\n', 'utf-8'),
    }];
    detail.manifest_hash = computeManifestHash(
      detail.files.map((f: any) => ({
        path: f.path,
        sha256: f.sha256,
        size: f.size,
      })),
    );

    const pi = makeMockPi();
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
    };
    const session = createSkillsSession(pluginCfg);
    registerSkillTools(pi as any, pluginCfg, session);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/skills/skill-get')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const result = await pi.tools.lore_skill_get.execute('t', { skill_id: 'skill-get' });
    expect(result.details.ok).toBe(true);
    expect(result.details.skill_md).toBe('# Get Me\n');
    expect(result.details.skill_dir).toBe(
      path.resolve(path.join(loreHome, 'skill-artifacts', projectId, 'get-skill')),
    );
    expect(result.details.downloaded).toBe(true);
    expect(result.content[0].text).toContain('skill_dir:');
    expect(result.content[0].text).toContain('# Get Me');
    expect(fs.existsSync(path.join(result.details.skill_dir, LORE_SKILL_MARKER))).toBe(true);

    fs.writeFileSync(path.join(result.details.skill_dir, 'SKILL.md'), '# edited locally\n', 'utf-8');
    const again = await pi.tools.lore_skill_get.execute('t2', { skill_id: 'skill-get' });
    expect(again.details.downloaded).toBe(false);
    expect(again.details.skill_md).toBe('# edited locally\n');

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it('status is read-only and describes work copies', async () => {
    const loreHome = makeTempHome();
    const projectId = 'proj-status';
    materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail({ name: 'status-skill', id: 's-status', project_id: projectId, version: 4 }),
    });
    const pi = makeMockPi();
    const pluginCfg = { baseUrl: 'http://host', apiToken: '', timeoutMs: 1000, loreHome };
    const session = createSkillsSession(pluginCfg);
    session.state.projectId = projectId;
    registerSkillTools(pi as any, pluginCfg, session);

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('status should not hit network when project known');
    }));

    const result = await pi.tools.lore_skill_status.execute('t', {});
    expect(result.details.ok).toBe(true);
    expect(result.details.work_copies).toBeDefined();
    expect(result.content[0].text).toContain('status-skill');
    expect(result.content[0].text).toContain('ready');
    session.state.projectId = undefined;
    const localOnly = await pi.tools.lore_skill_status.execute('t-local', {});
    expect(localOnly.content[0].text).toContain('status-skill');

    expect(pi.tools.lore_skill_status.parameters.properties?.reconcile).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });
});
