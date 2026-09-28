import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeManifestHash,
  createSkillsSession,
  ensureSkillWorkCopy,
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

  it('ensureSkillWorkCopy reuses a same-version copy; extra local files never trigger tamper', async () => {
    const detail = skillDetail({ version: 1 });
    materializeSkillWorkCopy({ loreHome, projectId, detail });
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');

    // Extra local output inside the writable dir must not count as tamper.
    fs.mkdirSync(path.join(installPath, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'outputs', 'result.json'), '{"ok":true}\n', 'utf-8');
    expect(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state).toBe('ready');

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
    expect(result.skill_md).toBe('# Demo Skill\n\nDo the thing.\n');
    expect(result.skill_dir).toBe(path.resolve(installPath));
    // Extra local file survives the reused copy.
    expect(fs.readFileSync(path.join(installPath, 'outputs', 'result.json'), 'utf-8')).toBe('{"ok":true}\n');
    expect(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state).toBe('ready');
  });

  it('ensureSkillWorkCopy restores a managed-file edit (downloaded) while preserving extra local files', async () => {
    const detail = skillDetail({ version: 1 });
    materializeSkillWorkCopy({ loreHome, projectId, detail });
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');

    // Extra local output that must survive the managed-file restore.
    fs.mkdirSync(path.join(installPath, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'outputs', 'result.json'), '{"ok":true}\n', 'utf-8');

    // Managed-file modification: SKILL.md is read-only, so chmod it first.
    fs.chmodSync(path.join(installPath, 'SKILL.md'), 0o644);
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# local edit\n', 'utf-8');
    expect(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state).toBe('tampered');

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
    expect(result.skill_md).toBe('# Demo Skill\n\nDo the thing.\n');
    expect(result.skill_dir).toBe(path.resolve(installPath));
    expect(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8')).toBe('# Demo Skill\n\nDo the thing.\n');
    // Extra local file survives the restore.
    expect(fs.readFileSync(path.join(installPath, 'outputs', 'result.json'), 'utf-8')).toBe('{"ok":true}\n');
    expect(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state).toBe('ready');
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(installPath, 'SKILL.md')).mode & 0o777).toBe(0o444);
    }
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
    expect(marker?.manifest_hash).toBe(detail.manifest_hash);
    expect(marker?.readonly).toBe(true);
    if (process.platform !== 'win32') {
      expect(() => fs.writeFileSync(path.join(result.skill_dir, 'SKILL.md'), '# edited after migrate\n', 'utf-8')).toThrow(/EACCES|EPERM/);
    }
  });

  it('ensureSkillWorkCopy errors on wrong skill_id identity', async () => {
    materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail({ id: 'skill-1', version: 1 }),
    });
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    fs.chmodSync(path.join(loreHome, 'skill-artifacts', projectId), 0o755);
    const walk = (current: string) => {
      const st = fs.lstatSync(current);
      if (st.isDirectory()) {
        fs.chmodSync(current, 0o755);
        for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
      } else if (st.isFile()) fs.chmodSync(current, 0o644);
    };
    walk(installPath);
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

describe('skills lifecycle discovery', () => {
  let loreHome: string;
  const projectId = 'proj-life';
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
        ? {
          host_output: { mode: 'return_value', value: { systemPromptAppend: 'SYS\n<available_skills>catalog</available_skills>' } },
          skill_catalog: { project_id: projectId, catalog_revision: 'cat-1' },
        }
        : {
          host_output: {
            mode: 'return_value',
            value: { message: { customType: 'lore-recall', content: '<recall>\n0.8 | core://a\n</recall>\n\n<skill_invocation>x</skill_invocation>', display: false } },
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

  it('opts into Skills context, applies host output unchanged, and never downloads at session start', async () => {
    const bodies: any[] = [];
    const apiCalls: string[] = [];
    stubLifecycle(bodies, apiCalls);
    const pi = makePi();
    const skills = createSkillsSession(pluginCfg());
    registerHooks(pi as any, pluginCfg(), skills);

    const ctx = { sessionManager: { getSessionId: () => 'sess-s' } };
    await pi.events.session_start({ reason: 'startup' }, ctx);
    const turn = await pi.events.before_agent_start({ prompt: 'run $deploy', systemPrompt: 'base' }, ctx);

    expect(bodies.map((body) => body.features)).toEqual([{ skills: true }, { memory_recall: true, skills: true }]);
    expect(skills.state.projectId).toBe(projectId);
    expect(skills.state.catalogRevision).toBe('cat-1');
    expect(turn.systemPrompt).toBe('base\n\nSYS\n<available_skills>catalog</available_skills>');
    expect(turn.message.content).toBe('<recall>\n0.8 | core://a\n</recall>\n\n<skill_invocation>x</skill_invocation>');
    expect(apiCalls).toEqual([]);
    expect(fs.existsSync(path.join(loreHome, 'skill-artifacts'))).toBe(false);
  });

  it('does not opt into Skills context without a Skills session', async () => {
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
    expect(Object.keys(pi.tools)).toHaveLength(16);
  });

  it('uses the exact work-copy descriptions', () => {
    const pi = makeMockPi();
    registerTools(pi as any, {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      defaultDomain: 'core',
      recallEnabled: true,
      skillsEnabled: true,
    });
    expect(pi.tools.lore_skill_get.description).toBe(
      'Fetch a Lore skill into a local work copy. Downloads the complete server package when missing, '
      + 'updates managed package files when the server version differs, and reuses the local copy when the version matches. '
      + 'Managed package files are read-only; the skill directory stays writable for local outputs. '
      + 'Same-version local outputs are preserved across fetches and upgrades. '
      + 'Returns SKILL.md content and the absolute skill_dir.',
    );
    expect(pi.tools.lore_skill_status.description).toBe(
      'Report local skill work-copy states (ready/missing/outdated/tampered/unmanaged/invalid). '
      + 'Read-only: never mutates or reconciles copies.',
    );
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
    expect(result.content[0].text).toContain('Skill work copy ready:');
    expect(result.content[0].text).toContain('skill_dir:');
    expect(result.content[0].text).toContain('# Get Me');
    expect(fs.existsSync(path.join(result.details.skill_dir, LORE_SKILL_MARKER))).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(result.details.skill_dir, 'SKILL.md')).mode & 0o777).toBe(0o444);
    }

    // Extra local output inside the writable dir does not trigger tamper and survives a same-version get.
    const extraPath = path.join(result.details.skill_dir, 'outputs', 'extra.md');
    fs.mkdirSync(path.dirname(extraPath), { recursive: true });
    fs.writeFileSync(extraPath, 'local extra\n', 'utf-8');
    const reused = await pi.tools.lore_skill_get.execute('t2', { skill_id: 'skill-get' });
    expect(reused.details.downloaded).toBe(false);
    expect(reused.details.skill_md).toBe('# Get Me\n');
    expect(fs.readFileSync(extraPath, 'utf-8')).toBe('local extra\n');

    // Managed-file modification is restored (downloaded=true) while the extra survives.
    fs.chmodSync(path.join(result.details.skill_dir, 'SKILL.md'), 0o644);
    fs.writeFileSync(path.join(result.details.skill_dir, 'SKILL.md'), '# edited locally\n', 'utf-8');
    const restored = await pi.tools.lore_skill_get.execute('t3', { skill_id: 'skill-get' });
    expect(restored.details.downloaded).toBe(true);
    expect(restored.details.skill_md).toBe('# Get Me\n');
    expect(fs.readFileSync(extraPath, 'utf-8')).toBe('local extra\n');

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it('lore_skill_get upgrades managed files and preserves local outputs', async () => {
    const loreHome = makeTempHome();
    const projectId = 'proj-upgrade';
    const pi = makeMockPi();
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
    };
    const session = createSkillsSession(pluginCfg);
    registerSkillTools(pi as any, pluginCfg, session);

    let version = 1;
    const detailForVersion = () => {
      const skillMd = version === 1 ? '# Upgrade v1\n' : '# Upgrade v2\n';
      const helper = version === 1 ? 'old helper\n' : 'new helper\n';
      const files = [
        {
          path: 'SKILL.md',
          content: skillMd,
          sha256: sha256Text(skillMd),
          size: Buffer.byteLength(skillMd, 'utf-8'),
        },
        {
          path: version === 1 ? 'refs/old.md' : 'refs/new.md',
          content: helper,
          sha256: sha256Text(helper),
          size: Buffer.byteLength(helper, 'utf-8'),
        },
      ];
      return skillDetail({
        id: 'skill-upgrade',
        project_id: projectId,
        name: 'upgrade-skill',
        version,
        files,
        manifest_hash: computeManifestHash(files.map((file) => ({
          path: file.path,
          sha256: file.sha256,
          size: file.size,
        }))),
      });
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/skills/skill-upgrade')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(detailForVersion()),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const first = await pi.tools.lore_skill_get.execute('t1', { skill_id: 'skill-upgrade' });
    expect(first.details.downloaded).toBe(true);
    const skillDir = first.details.skill_dir;
    const outputPath = path.join(skillDir, 'outputs', 'note.txt');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'keep me\n', 'utf-8');

    version = 2;
    const upgraded = await pi.tools.lore_skill_get.execute('t2', { skill_id: 'skill-upgrade' });
    expect(upgraded.details.ok).toBe(true);
    expect(upgraded.details.downloaded).toBe(true);
    expect(upgraded.details.local_version).toBe(2);
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8')).toBe('# Upgrade v2\n');
    expect(fs.existsSync(path.join(skillDir, 'refs', 'old.md'))).toBe(false);
    expect(fs.readFileSync(path.join(skillDir, 'refs', 'new.md'), 'utf-8')).toBe('new helper\n');
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe('keep me\n');
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(skillDir, 'SKILL.md')).mode & 0o777).toBe(0o444);
      expect(fs.statSync(path.join(skillDir, 'refs', 'new.md')).mode & 0o777).toBe(0o444);
    }

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it('lore_skill_get visibility failure leaves local work copies untouched', async () => {
    const loreHome = makeTempHome();
    const projectId = 'proj-denied';
    const root = path.join(loreHome, 'skill-artifacts', projectId);
    const existingPath = path.join(root, 'existing-skill', 'outputs', 'note.txt');
    fs.mkdirSync(path.dirname(existingPath), { recursive: true });
    fs.writeFileSync(existingPath, 'existing output\n', 'utf-8');

    const pi = makeMockPi();
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
    };
    const session = createSkillsSession(pluginCfg);
    session.state.projectId = projectId;
    registerSkillTools(pi as any, pluginCfg, session);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({ detail: 'skill not found' }),
    })));

    const before = fs.readdirSync(root, { recursive: true }).map(String).sort();
    const result = await pi.tools.lore_skill_get.execute('t', { skill_id: 'other-agent-skill' });
    const after = fs.readdirSync(root, { recursive: true }).map(String).sort();

    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toContain('skill not found');
    expect(after).toEqual(before);
    expect(fs.readFileSync(existingPath, 'utf-8')).toBe('existing output\n');
    expect(fs.existsSync(path.join(root, 'other-agent-skill'))).toBe(false);

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
