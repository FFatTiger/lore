import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeManifestHash,
  createSkillsSession,
  inspectLocalWorkCopy,
  LORE_SKILL_MARKER,
  LORE_SKILL_SCHEMA,
  materializeSkillWorkCopy,
  normalizeSkillSummary,
  registerSkillResourceDiscovery,
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
import lorePiExtension from '../index';

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

  it('materialize via re-export writes a writable work copy with read-only managed files under loreHome', () => {
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
    expect(marker.manifest_hash).toBe(detail.manifest_hash);
    expect(marker.readonly).toBe(true);
    expect(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      version: 1,
    }).state).toBe('ready');
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(installPath, 'SKILL.md')).mode & 0o777).toBe(0o444);
      // Skill directory stays writable (0755) for local outputs.
      expect(fs.statSync(installPath).mode & 0o777).toBe(0o755);
      expect(() => fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# edited\n', 'utf-8')).toThrow(/EACCES|EPERM/);
    }
    // Extra local files are writable directly inside the same copy.
    fs.mkdirSync(path.join(installPath, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'outputs', 'result.json'), '{"ok":true}\n', 'utf-8');
    expect(fs.readFileSync(path.join(installPath, 'outputs', 'result.json'), 'utf-8')).toBe('{"ok":true}\n');
    expect(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state).toBe('ready');
  });
});

describe('skills lifecycle discovery', () => {
  let loreHome: string;
  const pluginCfg = () => ({
    baseUrl: 'http://host',
    apiToken: '',
    timeoutMs: 1000,
    loreHome,
    injectPromptGuidance: true,
    recallEnabled: true,
    startupHealthcheck: false,
  });

  beforeEach(() => {
    loreHome = makeTempHome();
    process.env.LORE_HOME = loreHome;
  });

  afterEach(() => {
    delete process.env.LORE_HOME;
    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  function stubLifecycle(bodies: any[], apiCalls: string[]) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const u = String(url);
      if (u.includes('/api/skills')) {
        apiCalls.push(u);
        return { ok: false, status: 500, statusText: 'ERR', text: async () => 'should not sync' };
      }
      const body = JSON.parse(String(init?.body || '{}'));
      bodies.push(body);
      const payload = body?.event?.name === 'session.start'
        ? { host_output: { mode: 'return_value', value: { systemPromptAppend: 'SYS' } } }
        : {
          host_output: {
            mode: 'return_value',
            value: { message: { customType: 'lore-recall', content: '<recall>\n0.8 | core://a\n</recall>', display: false } },
          },
        };
      return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(payload) };
    }));
  }

  function makePi() {
    return {
      events: {} as Record<string, any>,
      on(event: string, handler: any) { this.events[event] = handler; },
      logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
    };
  }

  it('applies host output unchanged, never declares features.skills, and never downloads at session start', async () => {
    const bodies: any[] = [];
    const apiCalls: string[] = [];
    stubLifecycle(bodies, apiCalls);
    const pi = makePi();
    const skills = createSkillsSession(pluginCfg());
    registerHooks(pi as any, pluginCfg());

    const ctx = { sessionManager: { getSessionId: () => 'sess-s' } };
    await pi.events.session_start({ reason: 'startup' }, ctx);
    const turn = await pi.events.before_agent_start({ prompt: 'run $deploy', systemPrompt: 'base' }, ctx);

    // Skills discovery is host-native now: lifecycle requests must not ask for
    // the injected <available_skills> catalog, even with a skills session.
    expect(bodies.map((body) => body.features)).toEqual([undefined, { memory_recall: true }]);
    expect(turn.systemPrompt).toBe('base\n\nSYS');
    expect(turn.message.content).toBe('<recall>\n0.8 | core://a\n</recall>');
    expect(apiCalls).toEqual([]);
    expect(fs.existsSync(path.join(loreHome, 'skills'))).toBe(false);
    // Catalog identity comes from the resources_discover list request instead.
    expect(skills.state.projectId).toBeUndefined();
  });

  it('keeps lifecycle working without a skills session', async () => {
    const bodies: any[] = [];
    stubLifecycle(bodies, []);
    const pi = makePi();
    registerHooks(pi as any, pluginCfg());

    const ctx = { sessionManager: { getSessionId: () => 'sess-off' } };
    await pi.events.session_start({ reason: 'startup' }, ctx);
    await pi.events.before_agent_start({ prompt: 'hello', systemPrompt: 'base' }, ctx);

    expect(bodies.map((body) => body.features)).toEqual([undefined, { memory_recall: true }]);
  });
});

describe('resources_discover skill directory registration', () => {
  let loreHome: string;
  const projectId = 'proj-disc';
  const pluginCfg = () => ({
    baseUrl: 'http://host',
    apiToken: '',
    timeoutMs: 1000,
    loreHome,
    injectPromptGuidance: true,
    recallEnabled: true,
    startupHealthcheck: false,
  });

  beforeEach(() => {
    loreHome = makeTempHome();
    process.env.LORE_HOME = loreHome;
  });

  afterEach(() => {
    delete process.env.LORE_HOME;
    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  /** Server-side skill package used by the native-sync tests. */
  function syncedSkillFixture() {
    const content = '# Synced Skill\n\nDo it natively.\n';
    const sha256 = sha256Text(content);
    const size = Buffer.byteLength(content, 'utf-8');
    const manifest_hash = computeManifestHash([{ path: 'SKILL.md', sha256, size }]);
    return {
      detail: {
        skill_id: 'sk-disc-1',
        name: 'synced-skill',
        version: 3,
        manifest_hash,
        files: [{ path: 'SKILL.md', content, sha256, size }],
      },
      summary: { skill_id: 'sk-disc-1', name: 'synced-skill', version: 3, manifest_hash },
    };
  }

  function makePi() {
    return {
      events: {} as Record<string, any>,
      on(event: string, handler: any) { this.events[event] = handler; },
      logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
    };
  }

  it('returns the work-copy root immediately and records the background sync outcome', async () => {
    const fixture = syncedSkillFixture();
    const apiUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      apiUrls.push(u);
      if (u.includes(`/api/skills/${fixture.detail.skill_id}`)) {
        return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(fixture.detail) };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ project_id: projectId, catalog_revision: 'rev-9', skills: [fixture.summary] }),
      };
    }));

    const pi = makePi();
    const skills = createSkillsSession(pluginCfg());
    const discovery = registerSkillResourceDiscovery(pi as any, pluginCfg(), skills);

    const result = await pi.events.resources_discover({ type: 'resources_discover', cwd: loreHome, reason: 'startup' }, {});

    const root = path.join(loreHome, 'skills', projectId);
    expect(result).toEqual({ skillPaths: [root] });
    expect(apiUrls[0]).toBe('http://host/api/skills?client_type=pi');
    expect(skills.state.projectId).toBe(projectId);
    expect(skills.state.catalogRevision).toBe('rev-9');
    // The root exists (and is registered) before the sync finishes.
    expect(fs.existsSync(root)).toBe(true);

    await discovery.currentSync();

    // The background sync re-lists the catalog through the shared runner, then fetches details.
    expect(apiUrls[1]).toContain('/api/skills?');
    expect(apiUrls[1]).toContain('client_type=pi');
    expect(apiUrls[2]).toContain(`/api/skills/${fixture.detail.skill_id}`);
    expect(apiUrls[2]).toContain('client_type=pi');
    const skillDir = path.join(root, 'synced-skill');
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8')).toContain('# Synced Skill');
    const marker = JSON.parse(fs.readFileSync(path.join(skillDir, LORE_SKILL_MARKER), 'utf-8'));
    expect(marker.project_id).toBe(projectId);
    expect(marker.skill_id).toBe('sk-disc-1');
    const status = JSON.parse(fs.readFileSync(path.join(root, '.lore-sync-status.json'), 'utf-8'));
    expect(status.project_id).toBe(projectId);
    expect(status.catalog_revision).toBe('rev-9');
    expect(status.created).toEqual(['synced-skill']);
    expect(status.errors).toEqual([]);
    expect(status.finished_at).toBeTruthy();
  });

  it('syncs again on reload and reuses unchanged copies', async () => {
    const fixture = syncedSkillFixture();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes(`/api/skills/${fixture.detail.skill_id}`)) {
        throw new Error('detail should not be fetched for an unchanged skill');
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ project_id: projectId, catalog_revision: 'rev-9', skills: [fixture.summary] }),
      };
    }));

    const pi = makePi();
    const discovery = registerSkillResourceDiscovery(pi as any, pluginCfg());
    const root = path.join(loreHome, 'skills', projectId);

    // Seed the directory the way the previous session's sync left it.
    materializeSkillWorkCopy({ loreHome, projectId, detail: fixture.detail });
    await pi.events.resources_discover({ type: 'resources_discover', cwd: loreHome, reason: 'reload' }, {});
    await discovery.currentSync();

    const status = JSON.parse(fs.readFileSync(path.join(root, '.lore-sync-status.json'), 'utf-8'));
    expect(status.unchanged).toEqual(['synced-skill']);
    expect(status.created).toEqual([]);
  });

  it('returns nothing and stays silent when the skills server is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Down',
      text: async () => 'unavailable',
    })));

    const pi = makePi();
    const discovery = registerSkillResourceDiscovery(pi as any, pluginCfg());

    const result = await pi.events.resources_discover({ type: 'resources_discover', cwd: loreHome, reason: 'startup' }, {});

    expect(result).toBeUndefined();
    expect(pi.logger.debug).toHaveBeenCalledTimes(1);
    expect(pi.logger.warn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(loreHome, 'skills'))).toBe(false);
    expect(discovery.currentSync()).toBeUndefined();
  });

  it('treats a catalog timeout as unavailable without registering paths', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: any) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));

    const pi = makePi();
    // The discover request is capped independently of the plugin timeout.
    const discovery = registerSkillResourceDiscovery(pi as any, { ...pluginCfg(), timeoutMs: 50 });

    const result = await pi.events.resources_discover({ type: 'resources_discover', cwd: loreHome, reason: 'startup' }, {});

    expect(result).toBeUndefined();
    expect(fs.existsSync(path.join(loreHome, 'skills'))).toBe(false);
  });

  it('registers resources_discover from the extension entry only when skills are enabled', () => {
    const home = makeTempHome();
    process.env.LORE_HOME = home;
    const extensionPi = () => {
      const pi: any = makePi();
      pi.registerTool = (tool: any) => { pi.tools = { ...(pi.tools || {}), [tool.name]: tool }; };
      pi.pluginConfig = { baseUrl: 'http://host', loreHome: home, startupHealthcheck: false };
      return pi;
    };
    try {
      const enabled = extensionPi();
      enabled.pluginConfig.skillsEnabled = true;
      lorePiExtension(enabled);
      expect(typeof enabled.events.resources_discover).toBe('function');

      const disabled = extensionPi();
      disabled.pluginConfig.skillsEnabled = false;
      lorePiExtension(disabled);
      expect(disabled.events.resources_discover).toBeUndefined();
    } finally {
      delete process.env.LORE_HOME;
      rmTempHome(home);
    }
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
      skillsEnabled: true,
    });
    const skillTools = [
      'lore_skill_list',
      'lore_skill_search',
      'lore_skill_create',
      'lore_skill_update',
      'lore_skill_delete',
      'lore_skill_import',
    ];
    for (const name of skillTools) {
      expect(pi.tools[name]).toBeDefined();
      expect(pi.tools[name].promptSnippet).toBeUndefined();
      expect(pi.tools[name].promptGuidelines).toBeUndefined();
    }
    expect(pi.tools.lore_skill_artifact_create).toBeUndefined();
    expect(Object.keys(pi.tools)).toHaveLength(15);
  });

  it('uses the exact import and sync-timing descriptions', () => {
    const pi = makeMockPi();
    registerTools(pi as any, {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      defaultDomain: 'core',
      recallEnabled: true,
      skillsEnabled: true,
    });
    expect(pi.tools.lore_skill_import.description).toBe(
      'Import skills from a public GitHub repository (owner/repo, a GitHub URL, a tree URL to one skill, or a pasted npx skills add command) into Lore. '
      + 'Run with dry_run first to see what will be imported. Never overwrites existing skills.',
    );
    const syncNote = 'Changes sync to the local skills directory when the next session starts (Pi: /reload).';
    expect(pi.tools.lore_skill_create.description).toBe(`Create a Lore skill on the server. ${syncNote}`);
    expect(pi.tools.lore_skill_update.description).toBe(
      'Update a Lore skill on the server with optimistic concurrency via expected_version. '
      + syncNote,
    );
    expect(pi.tools.lore_skill_delete.description).toBe(`Archive/delete a Lore skill on the server. ${syncNote}`);
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

  it('lore_skill_import posts to the import endpoint and summarizes candidates and results', async () => {
    const loreHome = makeTempHome();
    const pi = makeMockPi();
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
      defaultDomain: 'core',
      recallEnabled: true,
    };
    registerSkillTools(pi as any, pluginCfg, createSkillsSession(pluginCfg));

    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
      const u = String(url);
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });
      if (method === 'POST' && u.includes('/api/skills/import')) {
        if (body?.dry_run === true) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify({
              repo: 'vercel-labs/agent-skills',
              ref: 'main',
              commit: 'b'.repeat(40),
              path: 'skills/frontend-design',
              candidates: [
                { name: 'frontend-design', description: 'Design', path: 'skills/frontend-design', file_count: 3, total_size: 4211, exists: false, selected: true, error: null },
                { name: 'legacy', description: 'Old', path: 'skills/legacy', file_count: 2, total_size: 900, exists: true, selected: true, error: null },
                { name: 'other', description: 'Other', path: 'skills/other', file_count: 1, total_size: 10, exists: false, selected: false, error: null },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({
            repo: 'vercel-labs/agent-skills',
            ref: 'main',
            commit: 'b'.repeat(40),
            path: 'skills/frontend-design',
            candidates: [],
            results: [
              { name: 'frontend-design', status: 'created', skill_id: 'skill-import-1', error: null },
              { name: 'legacy', status: 'exists', skill_id: 'skill-old', error: null },
              { name: 'broken', status: 'failed', skill_id: null, error: 'bad SKILL.md frontmatter' },
              { name: 'other', status: 'skipped', skill_id: null, error: null },
            ],
          }),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => `missing ${u}` };
    }));

    const dry = await pi.tools.lore_skill_import.execute('t1', {
      source: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/frontend-design',
      dry_run: true,
    });
    expect(dry.details.ok).toBe(true);
    expect(dry.content[0].text).toContain('Dry run from vercel-labs/agent-skills@main (path: skills/frontend-design): 3 candidate skill(s)');
    expect(dry.content[0].text).toContain('- frontend-design — will import — skills/frontend-design — 3 files — 4211 bytes');
    expect(dry.content[0].text).toContain('- legacy — already exists — skills/legacy');
    expect(dry.content[0].text).toContain('- other — not selected');
    expect(dry.content[0].text).toContain('"candidates"');

    const run = await pi.tools.lore_skill_import.execute('t2', {
      source: 'npx skills add vercel-labs/agent-skills --skill frontend-design -y',
      skills: ['legacy'],
      visibility_client_types: ['pi'],
    });
    expect(run.details.ok).toBe(true);
    expect(run.content[0].text).toContain('Import from vercel-labs/agent-skills@main (path: skills/frontend-design): 1 created, 1 exists, 1 failed, 1 skipped');
    expect(run.content[0].text).toContain('- frontend-design: created (skill_id: skill-import-1)');
    expect(run.content[0].text).toContain('- broken: failed — bad SKILL.md frontmatter');
    expect(run.details.result.repo).toBe('vercel-labs/agent-skills');

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.method).toBe('POST');
      expect(call.url).toContain('/api/skills/import?client_type=pi');
    }
    expect(calls[0].body).toEqual({
      source: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/frontend-design',
      dry_run: true,
    });
    expect(calls[1].body).toEqual({
      source: 'npx skills add vercel-labs/agent-skills --skill frontend-design -y',
      skills: ['legacy'],
      visibility_client_types: ['pi'],
    });

    const missing = await pi.tools.lore_skill_import.execute('t3', {});
    expect(missing.details.ok).toBe(false);
    expect(missing.details.error).toMatch(/source is required/);

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });
});
