import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendSkillBlockToRecallMessage,
  computeManifestHash,
  createSkillArtifactDir,
  createSkillsSession,
  formatSkillCandidateBlock,
  hashLocalSkillFiles,
  inspectLocalMirror,
  LORE_SKILL_MARKER,
  readyCandidateEntries,
  reconcileSkills,
  registerSkillTools,
  removeManagedMirror,
  resolveLoreHome,
  sha256Buffer,
  sha256Text,
  validateSafeRelativePath,
  writeSkillMirrorAtomic,
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
    name: 'demo-skill',
    description: 'A demo skill',
    enabled: true,
    version: '1',
    revision_hash: 'rev-1',
    ...rest,
    manifest_hash,
    files,
  };
}

describe('skills path and hash validation', () => {
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
});

describe('skills local mirror lifecycle', () => {
  let loreHome: string;
  const projectId = 'proj-1';

  beforeEach(() => {
    loreHome = makeTempHome();
  });

  afterEach(() => {
    rmTempHome(loreHome);
  });

  it('initial sync writes marker, SKILL.md, and chmod intent on POSIX', () => {
    const detail = skillDetail();
    const { installPath, marker } = writeSkillMirrorAtomic({ loreHome, projectId, detail });
    expect(fs.existsSync(path.join(installPath, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(installPath, LORE_SKILL_MARKER))).toBe(true);
    expect(marker.revision_hash).toBe('rev-1');
    expect(marker.manifest_hash).toBe(detail.manifest_hash);
    expect(marker.schema).toBe('lore.skill.mirror.v1');
    expect(marker.project_id).toBe(projectId);
    expect(marker.skill_id).toBe('skill-1');

    const status = inspectLocalMirror(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      revision_hash: 'rev-1',
    });
    expect(status.state).toBe('ready');

    if (process.platform !== 'win32') {
      const fileMode = fs.statSync(path.join(installPath, 'SKILL.md')).mode & 0o777;
      const dirMode = fs.statSync(installPath).mode & 0o777;
      expect(fileMode).toBe(0o444);
      expect(dirMode).toBe(0o555);
    }
  });

  it('update uses atomic replacement and refreshes version marker', () => {
    writeSkillMirrorAtomic({ loreHome, projectId, detail: skillDetail() });
    const v2Content = '# Demo Skill v2\n';
    const detailV2 = skillDetail({
      version: '2',
      revision_hash: 'rev-2',
      content: v2Content,
    });
    const { marker } = writeSkillMirrorAtomic({ loreHome, projectId, detail: detailV2 });
    expect(marker.version).toBe('2');
    expect(marker.revision_hash).toBe('rev-2');
    const installed = fs.readFileSync(
      path.join(loreHome, 'skills', projectId, 'installed', 'demo-skill', 'SKILL.md'),
      'utf-8',
    );
    expect(installed).toBe(v2Content);
    const status = inspectLocalMirror(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      revision_hash: 'rev-2',
    });
    expect(status.state).toBe('ready');
  });

  it('detects tampering and repair restores ready state', async () => {
    const detail = skillDetail();
    const { installPath } = writeSkillMirrorAtomic({ loreHome, projectId, detail });
    // Temporarily make writable to tamper
    if (process.platform !== 'win32') fs.chmodSync(installPath, 0o755);
    if (process.platform !== 'win32') fs.chmodSync(path.join(installPath, 'SKILL.md'), 0o644);
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# tampered\n', 'utf-8');

    const tampered = inspectLocalMirror(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      revision_hash: 'rev-1',
    });
    expect(tampered.state).toBe('tampered');

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/skills?')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({
            project_id: projectId,
            catalog_revision: 'cat-1',
            skills: [{ id: 'skill-1', name: 'demo-skill', enabled: true, version: '1', revision_hash: 'rev-1', manifest_hash: detail.manifest_hash }],
          }),
        };
      }
      if (u.includes('/api/skills/skill-1')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(detail),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const result = await reconcileSkills({
      pluginCfg: { baseUrl: 'http://host', apiToken: '', timeoutMs: 1000, loreHome },
      loreHome,
      catalog: { project_id: projectId, catalog_revision: 'cat-1' },
    });
    expect(result.installed).toContain('demo-skill');
    expect(inspectLocalMirror(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      revision_hash: 'rev-1',
    }).state).toBe('ready');
    vi.unstubAllGlobals();
  });

  it('preserves unmanaged same-name directories as conflicts', async () => {
    const installDir = path.join(loreHome, 'skills', projectId, 'installed', 'demo-skill');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'SKILL.md'), '# local unmanaged\n', 'utf-8');

    const status = inspectLocalMirror(loreHome, projectId, 'demo-skill');
    expect(status.state).toBe('unmanaged');

    expect(() => writeSkillMirrorAtomic({
      loreHome,
      projectId,
      detail: skillDetail(),
    })).toThrow(/unmanaged/);

    const before = fs.readFileSync(path.join(installDir, 'SKILL.md'), 'utf-8');
    const removal = removeManagedMirror(loreHome, projectId, 'demo-skill');
    expect(removal.conflict).toBe(true);
    expect(fs.existsSync(installDir)).toBe(true);
    expect(fs.readFileSync(path.join(installDir, 'SKILL.md'), 'utf-8')).toBe(before);
  });

  it('removes managed mirrors when skill is disabled/absent', async () => {
    const detail = skillDetail();
    writeSkillMirrorAtomic({ loreHome, projectId, detail });
    expect(inspectLocalMirror(loreHome, projectId, 'demo-skill').state).toBe('ready');

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/skills?')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({
            project_id: projectId,
            catalog_revision: 'cat-2',
            skills: [{ id: 'skill-1', name: 'demo-skill', enabled: false, version: '1', revision_hash: 'rev-1' }],
          }),
        };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const result = await reconcileSkills({
      pluginCfg: { baseUrl: 'http://host', apiToken: '', timeoutMs: 1000, loreHome },
      loreHome,
    });
    expect(result.removed).toContain('demo-skill');
    expect(inspectLocalMirror(loreHome, projectId, 'demo-skill').state).toBe('missing');
    vi.unstubAllGlobals();
  });

  it('detects marker identity mismatch and symlink tampering', () => {
    const detail = skillDetail();
    const { installPath } = writeSkillMirrorAtomic({ loreHome, projectId, detail });
    if (process.platform !== 'win32') fs.chmodSync(installPath, 0o755);
    const markerPath = path.join(installPath, LORE_SKILL_MARKER);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    marker.project_id = 'other-project';
    fs.chmodSync(markerPath, 0o644);
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    expect(inspectLocalMirror(loreHome, projectId, 'demo-skill').state).toBe('invalid');

    // Restore valid mirror, then add a symlink; special entries count as tampering.
    writeSkillMirrorAtomic({ loreHome, projectId, detail });
    if (process.platform !== 'win32') {
      fs.chmodSync(installPath, 0o755);
      fs.symlinkSync(path.join(installPath, 'SKILL.md'), path.join(installPath, 'linked.md'));
      expect(inspectLocalMirror(loreHome, projectId, 'demo-skill').state).toBe('invalid');
    }
  });

  it('artifact path stays outside installed mirror', () => {
    const artifact = createSkillArtifactDir({
      loreHome,
      projectId,
      skillName: 'demo-skill',
      artifactId: 'art-1',
    });
    expect(artifact.path).toContain(path.join('skill-artifacts', projectId, 'demo-skill', 'art-1'));
    expect(artifact.path.includes(`${path.sep}installed${path.sep}`)).toBe(false);
    expect(fs.existsSync(path.join(artifact.path, '.lore-artifact.json'))).toBe(true);
  });
});

describe('skills lifecycle candidate blocks', () => {
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

  it('emits candidate block only for ready matching revision', () => {
    const detail = skillDetail({ name: 'ready-skill', id: 's-ready', revision_hash: 'rev-ready' });
    writeSkillMirrorAtomic({
      loreHome,
      projectId,
      detail,
    });
    // outdated local for another candidate name not installed
    const ready = readyCandidateEntries({
      loreHome,
      projectId,
      candidates: [
        { name: 'ready-skill', id: 's-ready', revision_hash: 'rev-ready', manifest_hash: detail.manifest_hash, description: 'ok', version: '1' },
        { name: 'missing-skill', id: 's-missing', revision_hash: 'rev-x', manifest_hash: 'missing-manifest', description: 'nope' },
        { name: 'ready-skill', id: 's-ready', revision_hash: 'rev-other', manifest_hash: detail.manifest_hash, description: 'stale rev' },
      ],
    });
    expect(ready.map((r) => r.name)).toEqual(['ready-skill']);
    const block = formatSkillCandidateBlock(ready);
    expect(block).toContain('<lore-skills>');
    expect(block).toContain('ready-skill');
    expect(block).toContain(path.join(loreHome, 'skills', projectId, 'installed', 'ready-skill', 'SKILL.md'));
    expect(block).not.toContain('missing-skill');

    // Modifying both a file and the local marker cannot bypass the canonical
    // manifest carried by the Core recall candidate.
    const installPath = path.join(loreHome, 'skills', projectId, 'installed', 'ready-skill');
    if (process.platform !== 'win32') {
      fs.chmodSync(installPath, 0o755);
      fs.chmodSync(path.join(installPath, 'SKILL.md'), 0o644);
      fs.chmodSync(path.join(installPath, LORE_SKILL_MARKER), 0o644);
    }
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# forged local body\n', 'utf-8');
    const forgedMarker = JSON.parse(fs.readFileSync(path.join(installPath, LORE_SKILL_MARKER), 'utf-8'));
    forgedMarker.manifest_hash = hashLocalSkillFiles(installPath).manifest_hash;
    fs.writeFileSync(path.join(installPath, LORE_SKILL_MARKER), JSON.stringify(forgedMarker), 'utf-8');
    const forged = readyCandidateEntries({
      loreHome,
      projectId,
      candidates: [{
        skill_id: 's-ready',
        name: 'ready-skill',
        expected_version: '1',
        expected_revision_hash: 'rev-ready',
        manifest_hash: detail.manifest_hash,
      }],
    });
    expect(forged).toHaveLength(0);
  });

  it('appends skill block to existing hidden recall message or creates one', () => {
    const block = formatSkillCandidateBlock([{
      name: 'ready-skill',
      version: '1',
      description: 'ok',
      skillMdPath: '/tmp/SKILL.md',
    }]);
    const withRecall = appendSkillBlockToRecallMessage({
      customType: 'lore-recall',
      content: '<recall session_id="s">\n0.9 | core://x\n</recall>',
      display: false,
    }, block);
    expect(withRecall.content).toContain('<recall');
    expect(withRecall.content).toContain('<lore-skills>');
    expect(withRecall.display).toBe(false);

    const created = appendSkillBlockToRecallMessage(undefined, block);
    expect(created.customType).toBe('lore-recall');
    expect(created.content).toContain('<lore-skills>');
    expect(created.display).toBe(false);
  });

  it('session_start syncs catalog and prompt path injects ready candidate block', async () => {
    const detail = skillDetail({ name: 'prompt-skill', id: 's-prompt', revision_hash: 'rev-p' });
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
      injectPromptGuidance: true,
      recallEnabled: true,
      startupHealthcheck: false,
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
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
              expected_version: '1',
              expected_revision_hash: 'rev-p',
              manifest_hash: detail.manifest_hash,
            }],
          }),
        };
      }
      if (u.includes('/api/skills?')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({
            project_id: projectId,
            catalog_revision: 'cat-1',
            skills: [{
              id: 's-prompt',
              name: 'prompt-skill',
              enabled: true,
              version: '1',
              revision_hash: 'rev-p',
              manifest_hash: detail.manifest_hash,
            }],
          }),
        };
      }
      if (u.includes('/api/skills/s-prompt')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(detail),
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
    registerHooks(pi as any, pluginCfg, skills);

    const ctx = { sessionManager: { getSessionId: () => 'sess-s' } };
    await pi.events.session_start({ reason: 'startup' }, ctx);
    expect(inspectLocalMirror(loreHome, projectId, 'prompt-skill', {
      skill_id: 's-prompt',
      revision_hash: 'rev-p',
    }).state).toBe('ready');

    const turn = await pi.events.before_agent_start({ prompt: 'use skill', systemPrompt: 'base' }, ctx);
    expect(turn.systemPrompt).toContain('SYS');
    expect(turn.message.content).toContain('<recall');
    expect(turn.message.content).toContain('<lore-skills>');
    expect(turn.message.content).toContain('prompt-skill');
    expect(turn.message.content).toContain(path.join(loreHome, 'skills', projectId, 'installed', 'prompt-skill', 'SKILL.md'));
  });

  it('failed skill sync fails open and still returns memory recall', async () => {
    const pluginCfg = {
      baseUrl: 'http://host',
      apiToken: '',
      timeoutMs: 1000,
      loreHome,
      injectPromptGuidance: true,
      recallEnabled: true,
      startupHealthcheck: false,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
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
            skill_candidates: [{ skill_id: 's-x', name: 'broken', expected_revision_hash: 'r', manifest_hash: 'missing-manifest' }],
          }),
        };
      }
      if (u.includes('/api/skills')) {
        return { ok: false, status: 500, statusText: 'ERR', text: async () => 'boom' };
      }
      return { ok: false, status: 404, statusText: 'NO', text: async () => 'missing' };
    }));

    const pi = {
      events: {} as Record<string, any>,
      on(event: string, handler: any) { this.events[event] = handler; },
      logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
    };
    registerHooks(pi as any, pluginCfg, createSkillsSession(pluginCfg));
    const ctx = { sessionManager: { getSessionId: () => 'sess-fail' } };
    const turn = await pi.events.before_agent_start({ prompt: 'hello', systemPrompt: 'base' }, ctx);
    expect(turn.message.content).toContain('<recall>');
    expect(turn.message.content).not.toContain('<lore-skills>');
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

  it('registers skill tools without prompt guidance fields', () => {
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
      'lore_skill_artifact_create',
    ];
    for (const name of skillTools) {
      expect(pi.tools[name]).toBeDefined();
      expect(pi.tools[name].promptSnippet).toBeUndefined();
      expect(pi.tools[name].promptGuidelines).toBeUndefined();
    }
  });

  it('create/update/delete send expected request bodies and reconcile after write', async () => {
    const loreHome = makeTempHome();
    const projectId = 'proj-tools';
    const detail = skillDetail({ name: 'tool-skill', id: 'skill-tool', revision_hash: 'rev-t1' });
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

      if (u.includes('/api/skills?') || (u.endsWith('/api/skills?client_type=pi') && method === 'GET')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({
            project_id: projectId,
            catalog_revision: 'cat-t',
            skills: [{
              id: 'skill-tool',
              name: 'tool-skill',
              enabled: true,
              version: '1',
              revision_hash: 'rev-t1',
              manifest_hash: detail.manifest_hash,
            }],
          }),
        };
      }
      if (method === 'POST' && u.includes('/api/skills?')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ id: 'skill-tool', name: 'tool-skill', revision_hash: 'rev-t1' }),
        };
      }
      if (method === 'PATCH' && u.includes('/api/skills/skill-tool')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ id: 'skill-tool', name: 'tool-skill', revision_hash: 'rev-t2' }),
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
    const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/skills'));
    expect(createCall?.body).toMatchObject(createBody);

    const updateBody = {
      id: 'skill-tool',
      expected_revision_hash: 'rev-t1',
      enabled: false,
      upsert_files: [{ path: 'SKILL.md', content: '# Tool v2\n' }],
      delete_paths: ['old.md'],
    };
    const updated = await pi.tools.lore_skill_update.execute('t2', updateBody);
    expect(updated.details.ok).toBe(true);
    const updateCall = calls.find((c) => c.method === 'PATCH');
    expect(updateCall?.body).toMatchObject({
      expected_revision_hash: 'rev-t1',
      enabled: false,
      upsert_files: updateBody.upsert_files,
      delete_paths: ['old.md'],
    });

    const deleted = await pi.tools.lore_skill_delete.execute('t3', { id: 'skill-tool' });
    expect(deleted.details.ok).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/api/skills/skill-tool'))).toBe(true);

    // writes never touch installed path directly without reconcile API path
    expect(calls.some((c) => c.method === 'GET' && c.url.includes('/api/skills?'))).toBe(true);

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });

  it('artifact create stays outside installed mirror and does not upload', async () => {
    const loreHome = makeTempHome();
    const projectId = 'proj-art';
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

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('should not upload artifact');
    }));

    const result = await pi.tools.lore_skill_artifact_create.execute('t', {
      skill_name: 'demo-skill',
      artifact_id: 'a1',
    });
    expect(result.details.ok).toBe(true);
    expect(result.details.path).toBe(path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill', 'a1'));
    expect(result.details.path.includes(`${path.sep}installed${path.sep}`)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();

    rmTempHome(loreHome);
    vi.unstubAllGlobals();
  });
});

describe('hashLocalSkillFiles ignores marker', () => {
  it('hashes only skill payload files', () => {
    const dir = makeTempHome();
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# x\n');
    fs.writeFileSync(path.join(dir, LORE_SKILL_MARKER), JSON.stringify({ schema: 'x' }));
    const hashed = hashLocalSkillFiles(dir);
    expect(hashed.files.map((f) => f.path)).toEqual(['SKILL.md']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
