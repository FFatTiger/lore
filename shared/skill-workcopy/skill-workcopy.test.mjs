/**
 * Shared skill-workcopy tests (node:test, dependency-free).
 * Run: node --test shared/skill-workcopy/skill-workcopy.test.mjs
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  computeManifestHash,
  ensureSkillWorkCopy,
  inspectLocalWorkCopy,
  LEGACY_MIRROR_SCHEMA,
  listAllLocalWorkCopyStatuses,
  listLocalWorkCopyStatuses,
  LORE_SKILL_MARKER,
  LORE_SKILL_SCHEMA,
  materializeSkillWorkCopy,
  normalizeSkillSummary,
  readWorkCopyMarker,
  resolveLoreHome,
  sha256Buffer,
  sha256Text,
  skillRevisionOf,
  skillVersionOf,
  validateManagedFileList,
  validateSafeRelativePath,
  validateSkillPayload,
} from './index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lore-skill-workcopy-'));
}

function rmTempHome(dir) {
  const walk = (current) => {
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

function skillDetail(overrides = {}) {
  const content = String(overrides.content ?? '# Demo Skill\n\nDo the thing.\n');
  const sha = sha256Text(content);
  const files = overrides.files || [
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

describe('path and hash validation', () => {
  it('accepts safe relative paths and rejects traversal/absolute', () => {
    assert.equal(validateSafeRelativePath('SKILL.md'), 'SKILL.md');
    assert.equal(validateSafeRelativePath('refs/notes.md'), 'refs/notes.md');
    assert.throws(() => validateSafeRelativePath('refs/../SKILL.md'), /traversal/);
    assert.throws(() => validateSafeRelativePath('../SKILL.md'), /traversal/);
    assert.throws(() => validateSafeRelativePath('/abs/SKILL.md'), /absolute/);
    assert.throws(() => validateSafeRelativePath('C:/abs/SKILL.md'), /absolute/);
    assert.throws(() => validateSafeRelativePath('refs\\notes.md'), /backslashes/);
    assert.throws(() => validateSafeRelativePath('a//b.md'), /empty path segments/);
    assert.throws(() => validateSafeRelativePath(''), /required/);
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
    assert.equal(a, b);
    assert.equal(a, sha256Text('a.md\naa\n1\nb.md\nbb\n2\n'));
  });

  it('resolves LORE_HOME', () => {
    const dir = makeTempHome();
    assert.equal(resolveLoreHome({ LORE_HOME: dir }), path.resolve(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('validateManagedFileList rejects duplicates, marker, collisions, missing SKILL.md', () => {
    assert.throws(() => validateManagedFileList(['SKILL.md', '../x']), /traversal/);
    assert.throws(() => validateManagedFileList(['SKILL.md', 'SKILL.md']), /duplicate/);
    assert.throws(() => validateManagedFileList(['SKILL.md', LORE_SKILL_MARKER]), /managed_files/);
    assert.throws(() => validateManagedFileList(['a.md', 'a.md/b.md']), /conflicts with parent/);
    assert.throws(() => validateManagedFileList(['refs/notes.md']), /SKILL\.md/);
    assert.deepEqual(validateManagedFileList(['refs/a.md', 'SKILL.md']), ['SKILL.md', 'refs/a.md']);
  });

  it('prefers canonical version/revision_hash over expected_* aliases', () => {
    assert.equal(skillVersionOf({ version: 5, expected_version: 9 }), 5);
    assert.equal(skillVersionOf({ expected_version: 3 }), 3);
    assert.equal(skillRevisionOf({ revision_hash: 'rev-a', expected_revision_hash: 'rev-b' }), 'rev-a');
    assert.equal(skillRevisionOf({ expected_revision_hash: 'rev-b' }), 'rev-b');
    const norm = normalizeSkillSummary({
      id: 's',
      name: 'n',
      version: 2,
      expected_version: 99,
      revision_hash: 'r1',
      expected_revision_hash: 'r2',
    });
    assert.equal(norm.version, 2);
    assert.equal(norm.revision_hash, 'r1');
  });

  it('validateSkillPayload requires SKILL.md and checks hashes', () => {
    const detail = skillDetail();
    const { files, manifest_hash } = validateSkillPayload(detail);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'SKILL.md');
    assert.equal(manifest_hash, detail.manifest_hash);

    assert.throws(() => validateSkillPayload(skillDetail({
      files: [{ path: 'other.md', content: 'x', sha256: sha256Text('x') }],
    })), /SKILL\.md/);

    assert.throws(() => validateSkillPayload(skillDetail({
      files: [{
        path: 'SKILL.md',
        content: '# bad\n',
        sha256: '0'.repeat(64),
        size: Buffer.byteLength('# bad\n', 'utf-8'),
      }],
      manifest_hash: undefined,
    })), /sha256 mismatch/);
  });
});

describe('local work copy lifecycle', () => {
  let loreHome;
  const projectId = 'proj-1';

  beforeEach(() => {
    loreHome = makeTempHome();
  });

  afterEach(() => {
    rmTempHome(loreHome);
  });

  it('first materialize writes marker, all files, and is writable', () => {
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
    assert.equal(fs.existsSync(path.join(installPath, 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(installPath, 'refs', 'helper.md')), true);
    assert.equal(fs.existsSync(path.join(installPath, LORE_SKILL_MARKER)), true);
    assert.equal(marker.schema, LORE_SKILL_SCHEMA);
    assert.equal(marker.project_id, projectId);
    assert.equal(marker.skill_id, 'skill-1');
    assert.equal(marker.version, 1);
    assert.deepEqual(marker.managed_files, ['SKILL.md', 'refs/helper.md']);
    assert.ok(marker.synced_at);

    const status = inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      version: 1,
    });
    assert.equal(status.state, 'ready');

    if (process.platform !== 'win32') {
      const fileMode = fs.statSync(path.join(installPath, 'SKILL.md')).mode & 0o777;
      const dirMode = fs.statSync(installPath).mode & 0o777;
      assert.equal(fileMode, 0o644);
      assert.equal(dirMode, 0o755);
    }

    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# edited\n', 'utf-8');
    assert.equal(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8'), '# edited\n');
  });

  it('same-version ensure preserves local edits and extra outputs', async () => {
    const detail = skillDetail({ version: 1 });
    materializeSkillWorkCopy({ loreHome, projectId, detail });
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# local edit\n', 'utf-8');
    fs.mkdirSync(path.join(installPath, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'outputs', 'result.json'), '{"ok":true}\n', 'utf-8');

    const result = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(result.downloaded, false);
    assert.equal(result.skill_md, '# local edit\n');
    assert.equal(result.skill_dir, path.resolve(installPath));
    assert.equal(fs.readFileSync(path.join(installPath, 'outputs', 'result.json'), 'utf-8'), '{"ok":true}\n');
    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state, 'ready');
  });

  it('version upgrade replaces managed files, removes obsolete managed, preserves extra output', () => {
    const v1Files = [
      {
        path: 'SKILL.md',
        content: '# v1\n',
        sha256: sha256Text('# v1\n'),
        size: Buffer.byteLength('# v1\n', 'utf-8'),
      },
      {
        path: 'old.md',
        content: 'old\n',
        sha256: sha256Text('old\n'),
        size: Buffer.byteLength('old\n', 'utf-8'),
      },
      {
        path: 'keep-managed.md',
        content: 'keep-v1\n',
        sha256: sha256Text('keep-v1\n'),
        size: Buffer.byteLength('keep-v1\n', 'utf-8'),
      },
    ];
    const v1 = skillDetail({ version: 1, files: v1Files });
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail: v1 });
    fs.mkdirSync(path.join(installPath, 'agent-out'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'agent-out', 'notes.txt'), 'local output\n', 'utf-8');
    fs.writeFileSync(path.join(installPath, 'extra-root.md'), 'extra\n', 'utf-8');

    const v2Files = [
      {
        path: 'SKILL.md',
        content: '# v2\n',
        sha256: sha256Text('# v2\n'),
        size: Buffer.byteLength('# v2\n', 'utf-8'),
      },
      {
        path: 'keep-managed.md',
        content: 'keep-v2\n',
        sha256: sha256Text('keep-v2\n'),
        size: Buffer.byteLength('keep-v2\n', 'utf-8'),
      },
      {
        path: 'new.md',
        content: 'new\n',
        sha256: sha256Text('new\n'),
        size: Buffer.byteLength('new\n', 'utf-8'),
      },
    ];
    const v2 = skillDetail({ version: 2, files: v2Files });
    const { marker } = materializeSkillWorkCopy({ loreHome, projectId, detail: v2 });
    assert.equal(marker.version, 2);
    assert.deepEqual(marker.managed_files, ['SKILL.md', 'keep-managed.md', 'new.md']);
    assert.equal(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8'), '# v2\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'keep-managed.md'), 'utf-8'), 'keep-v2\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'new.md'), 'utf-8'), 'new\n');
    assert.equal(fs.existsSync(path.join(installPath, 'old.md')), false);
    assert.equal(fs.readFileSync(path.join(installPath, 'agent-out', 'notes.txt'), 'utf-8'), 'local output\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'extra-root.md'), 'utf-8'), 'extra\n');
  });

  it('failed upgrade rolls back and leaves existing work copy intact', () => {
    const detail = skillDetail({ version: 1, content: '# original\n' });
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail });
    fs.writeFileSync(path.join(installPath, 'local-note.txt'), 'keep me\n', 'utf-8');

    fs.mkdirSync(path.join(installPath, 'conflict-path'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'conflict-path', 'nested.txt'), 'nested\n', 'utf-8');

    const conflicting = skillDetail({
      version: 2,
      files: [
        {
          path: 'SKILL.md',
          content: '# v2\n',
          sha256: sha256Text('# v2\n'),
          size: Buffer.byteLength('# v2\n', 'utf-8'),
        },
        {
          path: 'conflict-path',
          content: 'file body\n',
          sha256: sha256Text('file body\n'),
          size: Buffer.byteLength('file body\n', 'utf-8'),
        },
      ],
    });

    assert.throws(
      () => materializeSkillWorkCopy({ loreHome, projectId, detail: conflicting }),
      /still contains local files|non-file managed path/,
    );
    assert.equal(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8'), '# original\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'local-note.txt'), 'utf-8'), 'keep me\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'conflict-path', 'nested.txt'), 'utf-8'), 'nested\n');
    const marker = readWorkCopyMarker(installPath);
    assert.equal(marker?.version, 1);
  });

  it('unmanaged existing directory is not overwritten', () => {
    const installDir = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'SKILL.md'), '# local unmanaged\n', 'utf-8');

    const status = inspectLocalWorkCopy(loreHome, projectId, 'demo-skill');
    assert.equal(status.state, 'unmanaged');

    assert.throws(() => materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail(),
    }), /unmanaged/);

    assert.equal(fs.readFileSync(path.join(installDir, 'SKILL.md'), 'utf-8'), '# local unmanaged\n');
  });

  it('rejects marker managed_files traversal and never uses unsafe marker', () => {
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail: skillDetail() });
    const markerPath = path.join(installPath, LORE_SKILL_MARKER);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    marker.managed_files = ['SKILL.md', '../../etc/passwd'];
    fs.writeFileSync(markerPath, JSON.stringify(marker), 'utf-8');

    assert.equal(readWorkCopyMarker(installPath), null);
    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill').state, 'invalid');

    const outside = path.join(loreHome, 'skill-artifacts', 'should-not-delete.txt');
    fs.writeFileSync(outside, 'safe\n', 'utf-8');
    assert.throws(() => materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail({ version: 2, content: '# v2\n' }),
    }), /invalid work-copy marker|unmanaged|invalid/);
    assert.equal(fs.readFileSync(outside, 'utf-8'), 'safe\n');
    assert.match(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8'), /Demo Skill/);
  });

  it('refuses unmanaged file or symlink at install path', () => {
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    fs.mkdirSync(path.dirname(installPath), { recursive: true });
    fs.writeFileSync(installPath, 'not a directory\n', 'utf-8');

    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill').state, 'unmanaged');
    assert.throws(() => materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail(),
    }), /unmanaged local file/);
    assert.equal(fs.readFileSync(installPath, 'utf-8'), 'not a directory\n');

    fs.unlinkSync(installPath);
    if (process.platform !== 'win32') {
      const target = path.join(loreHome, 'elsewhere');
      fs.mkdirSync(target, { recursive: true });
      fs.symlinkSync(target, installPath);
      assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill').state, 'unmanaged');
      assert.throws(() => materializeSkillWorkCopy({
        loreHome,
        projectId,
        detail: skillDetail(),
      }), /unmanaged local symlink/);
      assert.equal(fs.lstatSync(installPath).isSymbolicLink(), true);
    }
  });

  it('migrates legacy same-version mirror to writable workcopy', async () => {
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# legacy\n', 'utf-8');
    fs.writeFileSync(path.join(installPath, 'extra-managed.md'), 'extra\n', 'utf-8');
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
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(installPath, 'SKILL.md'), 0o444);
      fs.chmodSync(path.join(installPath, 'extra-managed.md'), 0o444);
      fs.chmodSync(installPath, 0o555);
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(installPath, 0o755);
    }
    fs.mkdirSync(path.join(installPath, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'outputs', 'note.txt'), 'agent\n', 'utf-8');
    if (process.platform !== 'win32') {
      fs.chmodSync(installPath, 0o555);
    }

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

    const result = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(result.downloaded, true);
    const marker = readWorkCopyMarker(result.skill_dir);
    assert.equal(marker?.schema, LORE_SKILL_SCHEMA);
    assert.deepEqual(marker?.managed_files, ['SKILL.md']);
    assert.equal(marker?.version, 1);
    assert.equal(fs.readFileSync(path.join(result.skill_dir, 'extra-managed.md'), 'utf-8'), 'extra\n');
    assert.equal(fs.readFileSync(path.join(result.skill_dir, 'outputs', 'note.txt'), 'utf-8'), 'agent\n');

    if (process.platform !== 'win32') {
      const fileMode = fs.statSync(path.join(result.skill_dir, 'SKILL.md')).mode & 0o777;
      const dirMode = fs.statSync(result.skill_dir).mode & 0o777;
      assert.equal(fileMode, 0o644);
      assert.equal(dirMode, 0o755);
    }
    fs.writeFileSync(path.join(result.skill_dir, 'SKILL.md'), '# edited after migrate\n', 'utf-8');
    assert.equal(fs.readFileSync(path.join(result.skill_dir, 'SKILL.md'), 'utf-8'), '# edited after migrate\n');
  });

  it('supports managed path shape transitions file→directory and directory→file', () => {
    const v1 = skillDetail({
      version: 1,
      files: [
        {
          path: 'SKILL.md',
          content: '# v1\n',
          sha256: sha256Text('# v1\n'),
          size: Buffer.byteLength('# v1\n', 'utf-8'),
        },
        {
          path: 'data',
          content: 'flat\n',
          sha256: sha256Text('flat\n'),
          size: Buffer.byteLength('flat\n', 'utf-8'),
        },
      ],
    });
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail: v1 });
    fs.writeFileSync(path.join(installPath, 'keep-extra.txt'), 'extra\n', 'utf-8');

    const v2 = skillDetail({
      version: 2,
      files: [
        {
          path: 'SKILL.md',
          content: '# v2\n',
          sha256: sha256Text('# v2\n'),
          size: Buffer.byteLength('# v2\n', 'utf-8'),
        },
        {
          path: 'data/nested.md',
          content: 'nested\n',
          sha256: sha256Text('nested\n'),
          size: Buffer.byteLength('nested\n', 'utf-8'),
        },
      ],
    });
    materializeSkillWorkCopy({ loreHome, projectId, detail: v2 });
    assert.equal(fs.statSync(path.join(installPath, 'data')).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(installPath, 'data', 'nested.md'), 'utf-8'), 'nested\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'keep-extra.txt'), 'utf-8'), 'extra\n');

    const v3 = skillDetail({
      version: 3,
      files: [
        {
          path: 'SKILL.md',
          content: '# v3\n',
          sha256: sha256Text('# v3\n'),
          size: Buffer.byteLength('# v3\n', 'utf-8'),
        },
        {
          path: 'data',
          content: 'flat-again\n',
          sha256: sha256Text('flat-again\n'),
          size: Buffer.byteLength('flat-again\n', 'utf-8'),
        },
      ],
    });
    materializeSkillWorkCopy({ loreHome, projectId, detail: v3 });
    assert.equal(fs.statSync(path.join(installPath, 'data')).isFile(), true);
    assert.equal(fs.readFileSync(path.join(installPath, 'data'), 'utf-8'), 'flat-again\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'keep-extra.txt'), 'utf-8'), 'extra\n');
  });

  it('fails upgrade when obsolete managed dir still holds local extras', () => {
    const v1 = skillDetail({
      version: 1,
      files: [
        {
          path: 'SKILL.md',
          content: '# v1\n',
          sha256: sha256Text('# v1\n'),
          size: Buffer.byteLength('# v1\n', 'utf-8'),
        },
        {
          path: 'bundle/item.md',
          content: 'item\n',
          sha256: sha256Text('item\n'),
          size: Buffer.byteLength('item\n', 'utf-8'),
        },
      ],
    });
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail: v1 });
    fs.writeFileSync(path.join(installPath, 'bundle', 'local-out.txt'), 'mine\n', 'utf-8');

    const v2 = skillDetail({
      version: 2,
      files: [
        {
          path: 'SKILL.md',
          content: '# v2\n',
          sha256: sha256Text('# v2\n'),
          size: Buffer.byteLength('# v2\n', 'utf-8'),
        },
        {
          path: 'bundle',
          content: 'now-a-file\n',
          sha256: sha256Text('now-a-file\n'),
          size: Buffer.byteLength('now-a-file\n', 'utf-8'),
        },
      ],
    });
    assert.throws(() => materializeSkillWorkCopy({ loreHome, projectId, detail: v2 }), /local files/);
    assert.equal(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8'), '# v1\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'bundle', 'local-out.txt'), 'utf-8'), 'mine\n');
    assert.equal(readWorkCopyMarker(installPath)?.version, 1);
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
    await assert.rejects(
      () => ensureSkillWorkCopy({
        loreHome,
        skillId: 'skill-1',
        projectId,
        loadSkill: async () => detail,
      }),
      /skill_id mismatch|invalid/,
    );
  });

  it('first get downloads all files and returns skill_md + absolute skill_dir', async () => {
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

    const result = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(result.downloaded, true);
    assert.equal(result.skill_md, '# Get Skill\n');
    assert.equal(
      result.skill_dir,
      path.resolve(path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill')),
    );
    assert.equal(fs.existsSync(path.join(result.skill_dir, 'lib', 'util.md')), true);
    assert.equal(result.server_version, 3);
    assert.equal(result.local_version, 3);
  });

  it('detects marker identity mismatch as invalid', () => {
    const detail = skillDetail();
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail });
    const markerPath = path.join(installPath, LORE_SKILL_MARKER);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    marker.project_id = 'other-project';
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill').state, 'invalid');
  });

  it('lists work copies across projects without server context', () => {
    const otherProject = 'project-2';
    materializeSkillWorkCopy({ loreHome, projectId, detail: skillDetail() });
    materializeSkillWorkCopy({ loreHome, projectId: otherProject, detail: skillDetail({ name: 'other-skill', skill_id: 'skill-2' }) });
    const statuses = listAllLocalWorkCopyStatuses(loreHome);
    assert.deepEqual(
      statuses.map((item) => `${item.project_id}:${item.name}`).sort(),
      [`${projectId}:demo-skill`, `${otherProject}:other-skill`],
    );
  });

  it('listLocalWorkCopyStatuses reports installed skills', () => {
    materializeSkillWorkCopy({ loreHome, projectId, detail: skillDetail() });
    const statuses = listLocalWorkCopyStatuses(loreHome, projectId);
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].name, 'demo-skill');
    assert.equal(statuses[0].state, 'ready');
  });

  it('loadCatalog resolves project_id when detail omits it', async () => {
    const detail = skillDetail({ project_id: undefined });
    delete detail.project_id;
    const result = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      loadSkill: async () => detail,
      loadCatalog: async () => ({ project_id: projectId, catalog_revision: 'rev-1' }),
    });
    assert.equal(result.project_id, projectId);
    assert.equal(result.downloaded, true);
  });
});

describe('module packaging', () => {
  it('shared source exists for vendoring', () => {
    const src = path.join(__dirname, 'index.mjs');
    const dts = path.join(__dirname, 'index.d.mts');
    assert.equal(fs.existsSync(src), true);
    assert.equal(fs.existsSync(dts), true);
    // Sanity: schema constant present in source.
    const text = fs.readFileSync(src, 'utf-8');
    assert.match(text, /lore\.skill\.workcopy\.v1/);
  });
});
