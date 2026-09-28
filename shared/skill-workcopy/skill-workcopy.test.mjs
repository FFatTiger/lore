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
  hashLocalSkillFiles,
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

/** Recursively restore writable modes so tests can simulate local edits to managed files. */
function makeWritable(p) {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) {
    fs.chmodSync(p, 0o755);
    for (const entry of fs.readdirSync(p)) makeWritable(path.join(p, entry));
  } else if (st.isFile()) {
    fs.chmodSync(p, 0o644);
  }
}

/** Assert the installed layout: dirs writable (0755), managed files + marker 0444 (POSIX). */
function assertInstalledModes(dir, managedFiles = ['SKILL.md']) {
  if (process.platform === 'win32') return;
  assert.equal(fs.statSync(dir).mode & 0o777, 0o755, `skill dir mode ${dir}`);
  assert.equal(fs.statSync(path.join(dir, LORE_SKILL_MARKER)).mode & 0o777, 0o444, 'marker mode');
  for (const rel of managedFiles) {
    assert.equal(fs.statSync(path.join(dir, ...rel.split('/'))).mode & 0o777, 0o444, `managed file ${rel}`);
  }
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
    revision_hash: 'rev-demo',
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

describe('local work-copy lifecycle', () => {
  let loreHome;
  const projectId = 'proj-1';

  beforeEach(() => {
    loreHome = makeTempHome();
  });

  afterEach(() => {
    rmTempHome(loreHome);
  });

  function installPath() {
    return path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
  }

  it('first materialize writes marker, all files, writable dirs, managed files 0444', () => {
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
    assert.equal(marker.manifest_hash, detail.manifest_hash);
    assert.equal(marker.revision_hash, 'rev-demo');
    assert.equal(marker.readonly, true);
    assert.deepEqual(marker.managed_files, ['SKILL.md', 'refs/helper.md']);
    assert.ok(marker.synced_at);

    const status = inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      version: 1,
    });
    assert.equal(status.state, 'ready');
    assert.equal(status.revision_hash, 'rev-demo');

    assertInstalledModes(installPath, ['SKILL.md', 'refs/helper.md']);

    if (process.platform !== 'win32') {
      // Managed files are read-only: a direct edit fails without an explicit chmod.
      assert.throws(
        () => fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# edited\n', 'utf-8'),
        /EACCES|EPERM/,
      );
    }
  });

  it('the installed skill directory is writable: local outputs can be created in-place', () => {
    const detail = skillDetail();
    materializeSkillWorkCopy({ loreHome, projectId, detail });

    // No chmod needed: the skill directory itself is writable (0755 POSIX).
    fs.mkdirSync(path.join(installPath(), 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(installPath(), 'outputs', 'result.json'), '{"ok":true}\n', 'utf-8');
    fs.writeFileSync(path.join(installPath(), 'cache.tmp'), 'cache\n', 'utf-8');

    assert.equal(fs.readFileSync(path.join(installPath(), 'outputs', 'result.json'), 'utf-8'), '{"ok":true}\n');
    // Managed files remain read-only while outputs are writable.
    assertInstalledModes(installPath(), ['SKILL.md']);
  });

  it('extra local files do not trigger tamper and survive same-version get', async () => {
    const detail = skillDetail({ version: 1 });
    materializeSkillWorkCopy({ loreHome, projectId, detail });
    fs.mkdirSync(path.join(installPath(), 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(installPath(), 'outputs', 'result.json'), '{"ok":true}\n', 'utf-8');
    fs.writeFileSync(path.join(installPath(), 'extra-root.md'), 'extra\n', 'utf-8');

    // Extras never change integrity: still ready.
    assert.equal(
      inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state,
      'ready',
    );
    assert.equal(hashLocalSkillFiles(installPath()).manifest_hash, detail.manifest_hash);

    // Same-version get reuses the local copy; extras survive.
    const result = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(result.downloaded, false);
    assert.equal(fs.existsSync(path.join(installPath(), 'outputs', 'result.json')), true);
    assert.equal(fs.existsSync(path.join(installPath(), 'extra-root.md')), true);
    assert.equal(fs.readFileSync(path.join(installPath(), 'SKILL.md'), 'utf-8'), '# Demo Skill\n\nDo the thing.\n');
  });

  it('modified managed file is tampered and restored from server, preserving extras', async () => {
    const detail = skillDetail({ version: 1 });
    materializeSkillWorkCopy({ loreHome, projectId, detail });
    fs.writeFileSync(path.join(installPath(), 'local-output.txt'), 'agent\n', 'utf-8');

    makeWritable(installPath());
    fs.writeFileSync(path.join(installPath(), 'SKILL.md'), '# local edit\n', 'utf-8');

    // Hash over managed files differs → tampered.
    assert.notEqual(hashLocalSkillFiles(installPath()).manifest_hash, detail.manifest_hash);
    const status = inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', {
      skill_id: 'skill-1',
      version: 1,
    });
    assert.equal(status.state, 'tampered');

    const result = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(result.downloaded, true);
    assert.equal(result.skill_md, '# Demo Skill\n\nDo the thing.\n');
    assert.equal(result.skill_dir, path.resolve(installPath()));
    assert.equal(fs.readFileSync(path.join(installPath(), 'SKILL.md'), 'utf-8'), '# Demo Skill\n\nDo the thing.\n');
    // Extra local output preserved across the managed restore.
    assert.equal(fs.readFileSync(path.join(installPath(), 'local-output.txt'), 'utf-8'), 'agent\n');
    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state, 'ready');
    assertInstalledModes(installPath(), ['SKILL.md']);
  });

  it('version upgrade preserves extra local outputs, removes obsolete managed files', () => {
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
    // Extras are preserved across the upgrade.
    assert.equal(fs.readFileSync(path.join(installPath, 'agent-out', 'notes.txt'), 'utf-8'), 'local output\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'extra-root.md'), 'utf-8'), 'extra\n');
    assertInstalledModes(installPath, ['SKILL.md', 'keep-managed.md', 'new.md']);
  });

  it('failed upgrade preserves a valid previous copy with outputs', () => {
    const detail = skillDetail({ version: 1, content: '# original\n' });
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail });
    fs.writeFileSync(path.join(installPath, 'local.txt'), 'agent\n', 'utf-8');

    if (process.platform !== 'win32') {
      // Force the v2 materialize to fail at staging creation: remove the staging
      // area and make the mirror root read-only so mkdir/rename cannot proceed.
      fs.rmSync(path.join(loreHome, 'skill-artifacts', '.staging'), { recursive: true, force: true });
      fs.chmodSync(path.join(loreHome, 'skill-artifacts'), 0o555);
    }

    assert.throws(() => materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail({ version: 2, content: '# v2\n' }),
    }), /EACCES|EPERM|ENOTEMPTY|mkdir|rename/);

    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(loreHome, 'skill-artifacts'), 0o755);
    }

    // Previous copy intact, still valid, outputs preserved.
    assert.equal(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8'), '# original\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'local.txt'), 'utf-8'), 'agent\n');
    const marker = readWorkCopyMarker(installPath);
    assert.equal(marker?.version, 1);
    assertInstalledModes(installPath, ['SKILL.md']);
    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state, 'ready');
  });

  it('new managed path conflicting with a local extra fails atomically (file at same path)', () => {
    const v1 = skillDetail({
      version: 1,
      files: [
        {
          path: 'SKILL.md',
          content: '# v1\n',
          sha256: sha256Text('# v1\n'),
          size: Buffer.byteLength('# v1\n', 'utf-8'),
        },
      ],
    });
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail: v1 });
    // Local artifact occupies a path the next server version claims as managed.
    fs.writeFileSync(path.join(installPath, 'conflict.md'), 'my artifact\n', 'utf-8');

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
          path: 'conflict.md',
          content: 'server version\n',
          sha256: sha256Text('server version\n'),
          size: Buffer.byteLength('server version\n', 'utf-8'),
        },
      ],
    });

    assert.throws(() => materializeSkillWorkCopy({ loreHome, projectId, detail: v2 }), /conflicts with an existing local file|LOCAL_ARTIFACT_CONFLICT/);

    // Installed copy untouched: managed files still v1, artifact preserved.
    assert.equal(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8'), '# v1\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'conflict.md'), 'utf-8'), 'my artifact\n');
    assert.equal(readWorkCopyMarker(installPath)?.version, 1);
  });

  it('new managed file under a managed directory that contains extras fails atomically', () => {
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
          path: 'data/note.md',
          content: 'managed-note\n',
          sha256: sha256Text('managed-note\n'),
          size: Buffer.byteLength('managed-note\n', 'utf-8'),
        },
      ],
    });
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail: v1 });
    // Extra inside the managed directory.
    fs.writeFileSync(path.join(installPath, 'data', 'agent.txt'), 'agent\n', 'utf-8');

    // v2 turns `data` (managed dir with extras) into a managed file → shape conflict.
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
          path: 'data',
          content: 'now-a-file\n',
          sha256: sha256Text('now-a-file\n'),
          size: Buffer.byteLength('now-a-file\n', 'utf-8'),
        },
      ],
    });

    assert.throws(() => materializeSkillWorkCopy({ loreHome, projectId, detail: v2 }), /conflicts with an existing local directory|LOCAL_ARTIFACT_CONFLICT/);
    assert.equal(fs.readFileSync(path.join(installPath, 'data', 'note.md'), 'utf-8'), 'managed-note\n');
    assert.equal(fs.readFileSync(path.join(installPath, 'data', 'agent.txt'), 'utf-8'), 'agent\n');
    assert.equal(readWorkCopyMarker(installPath)?.version, 1);
  });

  it('unmanaged existing directory is not overwritten', () => {
    const dir = installPath();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# local unmanaged\n', 'utf-8');

    const status = inspectLocalWorkCopy(loreHome, projectId, 'demo-skill');
    assert.equal(status.state, 'unmanaged');

    assert.throws(() => materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail(),
    }), /unmanaged/);

    assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8'), '# local unmanaged\n');
  });

  it('rejects marker managed_files traversal and never uses unsafe marker', () => {
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail: skillDetail() });
    const markerPath = path.join(installPath, LORE_SKILL_MARKER);
    makeWritable(installPath);
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
    const dir = installPath();
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, 'not a directory\n', 'utf-8');

    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill').state, 'unmanaged');
    assert.throws(() => materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail(),
    }), /unmanaged local file/);
    assert.equal(fs.readFileSync(dir, 'utf-8'), 'not a directory\n');

    fs.unlinkSync(dir);
    if (process.platform !== 'win32') {
      const target = path.join(loreHome, 'elsewhere');
      fs.mkdirSync(target, { recursive: true });
      fs.symlinkSync(target, dir);
      assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill').state, 'unmanaged');
      assert.throws(() => materializeSkillWorkCopy({
        loreHome,
        projectId,
        detail: skillDetail(),
      }), /unmanaged local symlink/);
      assert.equal(fs.lstatSync(dir).isSymbolicLink(), true);
    }
  });

  it('symlinks in extra local files are safe; symlink at a managed path is tampered', async () => {
    if (process.platform === 'win32') return;
    const detail = skillDetail();
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail });
    const target = path.join(loreHome, 'symlink-target');
    fs.mkdirSync(target, { recursive: true });

    // Extra symlink (agent-created local content) does not break the copy.
    fs.symlinkSync(target, path.join(installPath, 'agent-link'));
    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state, 'ready');

    // Same-version get still reuses the local copy with the extra symlink intact.
    const result = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(result.downloaded, false);
    assert.equal(fs.lstatSync(path.join(installPath, 'agent-link')).isSymbolicLink(), true);

    // A symlink replacing a managed file is tampered, then get restores the managed
    // file from Core rather than misclassifying the symlink as a local artifact.
    makeWritable(installPath);
    fs.unlinkSync(path.join(installPath, 'agent-link'));
    fs.unlinkSync(path.join(installPath, 'SKILL.md'));
    fs.symlinkSync(target, path.join(installPath, 'SKILL.md'));
    const status = inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 });
    assert.equal(status.state, 'tampered');

    const restored = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(restored.downloaded, true);
    assert.equal(fs.lstatSync(path.join(installPath, 'SKILL.md')).isFile(), true);
    assert.equal(fs.lstatSync(path.join(installPath, 'SKILL.md')).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf-8'), '# Demo Skill\n\nDo the thing.\n');
  });

  it('refuses symlinked managed-path ancestors before external chmod or deletion', () => {
    if (process.platform === 'win32') return;
    const v1 = skillDetail({
      version: 1,
      files: [
        { path: 'SKILL.md', content: '# v1\n', sha256: sha256Text('# v1\n'), size: 5 },
        { path: 'data/note.md', content: 'managed\n', sha256: sha256Text('managed\n'), size: 8 },
      ],
    });
    const { installPath } = materializeSkillWorkCopy({ loreHome, projectId, detail: v1 });
    const external = path.join(loreHome, 'external-target');
    fs.mkdirSync(external, { recursive: true });
    fs.writeFileSync(path.join(external, 'note.md'), 'external\n', { mode: 0o600 });

    makeWritable(installPath);
    fs.rmSync(path.join(installPath, 'data'), { recursive: true, force: true });
    fs.symlinkSync(external, path.join(installPath, 'data'));

    const v2 = skillDetail({ version: 2, content: '# v2\n' });
    assert.throws(
      () => materializeSkillWorkCopy({ loreHome, projectId, detail: v2 }),
      /symlink ancestor|LOCAL_ARTIFACT_CONFLICT/,
    );
    assert.equal(fs.readFileSync(path.join(external, 'note.md'), 'utf-8'), 'external\n');
    assert.equal(fs.statSync(path.join(external, 'note.md')).mode & 0o777, 0o600);
    assert.equal(readWorkCopyMarker(installPath)?.version, 1);
    assert.equal(fs.lstatSync(path.join(installPath, 'data')).isSymbolicLink(), true);
  });

  it('migrates legacy same-version mirror to a managed_files workcopy', async () => {
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
      manifest_hash: sha256Text('legacy'),
      synced_at: new Date().toISOString(),
    }, null, 2), 'utf-8');
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(installPath, 'SKILL.md'), 0o444);
      fs.chmodSync(path.join(installPath, 'extra-managed.md'), 0o444);
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
    assert.equal(marker?.manifest_hash, detail.manifest_hash);
    assert.equal(marker?.readonly, true);
    // Legacy has no managed_files boundary, so it is rematerialized fresh from server.
    assert.equal(fs.existsSync(path.join(result.skill_dir, 'extra-managed.md')), false);
    assertInstalledModes(result.skill_dir, ['SKILL.md']);
  });

  it('workcopy marker without manifest_hash rematerializes once and preserves extras', async () => {
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), '# pre-manifest\n', 'utf-8');
    fs.writeFileSync(path.join(installPath, LORE_SKILL_MARKER), JSON.stringify({
      schema: LORE_SKILL_SCHEMA,
      project_id: projectId,
      skill_id: 'skill-1',
      name: 'demo-skill',
      version: 1,
      managed_files: ['SKILL.md'],
      synced_at: new Date().toISOString(),
    }, null, 2), 'utf-8');
    if (process.platform !== 'win32') {
      fs.chmodSync(installPath, 0o555);
      fs.chmodSync(path.join(installPath, 'SKILL.md'), 0o444);
    }

    // Integrity cannot be verified → tampered → rematerialize.
    assert.equal(
      inspectLocalWorkCopy(loreHome, projectId, 'demo-skill', { version: 1 }).state,
      'tampered',
    );

    const detail = skillDetail({ version: 1, content: '# Demo Skill\n\nDo the thing.\n' });
    const result = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(result.downloaded, true);
    const marker = readWorkCopyMarker(result.skill_dir);
    assert.equal(marker?.manifest_hash, detail.manifest_hash);
    assert.equal(marker?.readonly, true);
    // Subsequent ensure is ready without download.
    const again = await ensureSkillWorkCopy({
      loreHome,
      skillId: 'skill-1',
      projectId,
      loadSkill: async () => detail,
    });
    assert.equal(again.downloaded, false);
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
  });

  it('ensureSkillWorkCopy errors on wrong skill_id identity', async () => {
    materializeSkillWorkCopy({
      loreHome,
      projectId,
      detail: skillDetail({ id: 'skill-1', version: 1 }),
    });
    const installPath = path.join(loreHome, 'skill-artifacts', projectId, 'demo-skill');
    makeWritable(installPath);
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
    makeWritable(installPath);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    marker.project_id = 'other-project';
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    assert.equal(inspectLocalWorkCopy(loreHome, projectId, 'demo-skill').state, 'invalid');
  });

  it('lists mirrors across projects without server context', () => {
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
