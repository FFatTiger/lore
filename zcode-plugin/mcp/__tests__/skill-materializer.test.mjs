import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { materializeSkill, validateSkillPackage } from '../skill-materializer.mjs';

const temporaryHomes = [];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function comparePaths(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function packageValue({ version = 1, catalogRevision = version, files, description = 'Test Skill', enabled = true } = {}) {
  const sourceFiles = files ?? {
    'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n\n# Test Skill\n',
    'scripts/run.sh': 'echo one\n',
  };
  const normalizedFiles = Array.isArray(sourceFiles)
    ? sourceFiles
    : Object.entries(sourceFiles).map(([filePath, value]) => ({ path: filePath, value }));
  const records = normalizedFiles.map(({ path: filePath, value, binary = false }) => {
    const content = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    return {
      path: filePath,
      ...(binary ? { content_base64: content.toString('base64') } : { content: content.toString('utf8') }),
      content_sha256: sha256(content),
      size_bytes: content.length,
      media_type: binary ? 'application/octet-stream' : 'text/plain',
    };
  }).sort((left, right) => comparePaths(left.path, right.path));
  const manifestInput = records.map((file) => `${file.path}\n${file.content_sha256}\n${file.size_bytes}\n`).join('');
  const manifestHash = sha256(Buffer.from(manifestInput, 'utf8'));
  const revisionInput = [
    'name=test-skill',
    `description=${description}`,
    `enabled=${enabled ? 'true' : 'false'}`,
    `manifest=${manifestHash}`,
    '',
  ].join('\n');
  return {
    project_id: 'project-1',
    skill_id: 'skill-1',
    name: 'test-skill',
    description,
    enabled,
    version,
    revision_hash: sha256(Buffer.from(revisionInput, 'utf8')),
    manifest_hash: manifestHash,
    catalog_revision: catalogRevision,
    files: records,
  };
}

function newHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-skill-materializer-'));
  temporaryHomes.push(home);
  return home;
}

function skillDirectory(home) {
  return path.join(home, 'skill-artifacts', 'project-1', 'test-skill');
}

afterEach(() => {
  while (temporaryHomes.length) fs.rmSync(temporaryHomes.pop(), { recursive: true, force: true });
});

test('materializes a validated package and reuses an intact version', () => {
  const home = newHome();
  const skill = packageValue();
  const first = materializeSkill(skill, { loreHome: home });
  assert.equal(first.reused, false);
  assert.equal(first.skill_markdown, skill.files.find((file) => file.path === 'SKILL.md').content);
  assert.deepEqual(first.managed_files, ['SKILL.md', 'scripts/run.sh']);
  assert.equal(fs.readFileSync(path.join(first.local_directory, 'scripts/run.sh'), 'utf8'), 'echo one\n');
  assert.equal(fs.statSync(path.join(first.local_directory, '.lore-skill-marker.json')).isFile(), true);

  const mtime = fs.statSync(path.join(first.local_directory, 'scripts/run.sh')).mtimeMs;
  const second = materializeSkill({ ...skill, version: 2, catalog_revision: 99 }, { loreHome: home });
  assert.equal(second.reused, true);
  assert.equal(fs.statSync(path.join(first.local_directory, 'scripts/run.sh')).mtimeMs, mtime);
  const marker = JSON.parse(fs.readFileSync(path.join(first.local_directory, '.lore-skill-marker.json'), 'utf8'));
  assert.equal(marker.version, 2);
  assert.equal(marker.catalog_revision, 99);
});

test('upgrades managed files while preserving local artifacts and removing retired managed files', () => {
  const home = newHome();
  const initial = packageValue();
  const first = materializeSkill(initial, { loreHome: home });
  fs.mkdirSync(path.join(first.local_directory, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(first.local_directory, 'artifacts', 'result.json'), '{"ok":true}\n');
  fs.writeFileSync(path.join(first.local_directory, 'scripts', 'run.sh'), 'locally changed\n');

  const upgraded = packageValue({
    version: 2,
    files: {
      'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n\n# Version 2\n',
      'references/api.md': '# API\n',
    },
  });
  const second = materializeSkill(upgraded, { loreHome: home });
  assert.equal(second.reused, false);
  assert.equal(fs.existsSync(path.join(second.local_directory, 'scripts', 'run.sh')), false);
  assert.equal(fs.readFileSync(path.join(second.local_directory, 'references', 'api.md'), 'utf8'), '# API\n');
  assert.equal(fs.readFileSync(path.join(second.local_directory, 'artifacts', 'result.json'), 'utf8'), '{"ok":true}\n');
});

test('restores a modified managed file even when version metadata is unchanged', () => {
  const home = newHome();
  const skill = packageValue();
  const first = materializeSkill(skill, { loreHome: home });
  fs.writeFileSync(path.join(first.local_directory, 'scripts', 'run.sh'), 'tampered\n');
  const result = materializeSkill(skill, { loreHome: home });
  assert.equal(result.reused, false);
  assert.equal(fs.readFileSync(path.join(first.local_directory, 'scripts', 'run.sh'), 'utf8'), 'echo one\n');
});

test('rejects a new managed path that conflicts with a local artifact without changing files', () => {
  const home = newHome();
  const initial = packageValue({ files: { 'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n' } });
  const first = materializeSkill(initial, { loreHome: home });
  fs.writeFileSync(path.join(first.local_directory, 'notes.txt'), 'local artifact\n');
  const upgraded = packageValue({ version: 2, files: {
    'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n\nchanged\n',
    'notes.txt': 'managed now\n',
  } });
  assert.throws(() => materializeSkill(upgraded, { loreHome: home }), /local artifact conflicts/);
  assert.equal(fs.readFileSync(path.join(first.local_directory, 'notes.txt'), 'utf8'), 'local artifact\n');
  assert.equal(fs.readFileSync(path.join(first.local_directory, 'SKILL.md'), 'utf8'), initial.files[0].content);
});

test('rejects symlink paths before writing any incoming file', { skip: process.platform === 'win32' }, () => {
  const home = newHome();
  const initial = packageValue({ files: { 'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n' } });
  const first = materializeSkill(initial, { loreHome: home });
  fs.symlinkSync(os.tmpdir(), path.join(first.local_directory, 'scripts'));
  const upgraded = packageValue({ version: 2, files: {
    'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n\nchanged\n',
    'scripts/run.sh': 'echo unsafe\n',
  } });
  assert.throws(() => materializeSkill(upgraded, { loreHome: home }), /symlink path is not allowed/);
  assert.equal(fs.readFileSync(path.join(first.local_directory, 'SKILL.md'), 'utf8'), initial.files[0].content);
});

test('converts managed files and directory trees without overwriting local artifacts', () => {
  const home = newHome();
  const asFile = packageValue({ files: {
    'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n',
    docs: 'managed file\n',
  } });
  const first = materializeSkill(asFile, { loreHome: home });
  const asDirectory = packageValue({ version: 2, files: {
    'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n',
    'docs/api.md': '# API\n',
  } });
  materializeSkill(asDirectory, { loreHome: home });
  assert.equal(fs.readFileSync(path.join(first.local_directory, 'docs', 'api.md'), 'utf8'), '# API\n');

  const backToFile = packageValue({ version: 3, files: {
    'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n',
    docs: 'managed again\n',
  } });
  materializeSkill(backToFile, { loreHome: home });
  assert.equal(fs.readFileSync(path.join(first.local_directory, 'docs'), 'utf8'), 'managed again\n');

  materializeSkill(asDirectory, { loreHome: home });
  fs.mkdirSync(path.join(first.local_directory, 'docs', 'empty-output'));
  assert.throws(() => materializeSkill(backToFile, { loreHome: home }), /local artifact blocks managed file/);
  fs.rmdirSync(path.join(first.local_directory, 'docs', 'empty-output'));
  fs.writeFileSync(path.join(first.local_directory, 'docs', 'local.txt'), 'local artifact\n');
  assert.throws(() => materializeSkill(backToFile, { loreHome: home }), /local artifact blocks managed file/);
  assert.equal(fs.readFileSync(path.join(first.local_directory, 'docs', 'local.txt'), 'utf8'), 'local artifact\n');
});

test('rejects malformed base64, content hash, manifest hash, and revision hash', () => {
  const binary = packageValue({ files: [{ path: 'SKILL.md', value: Buffer.from([0, 1, 2]), binary: true }] });
  for (const mutate of [
    (value) => { value.files[0].content_base64 = '@@@='; },
    (value) => { value.files[0].content_sha256 = '0'.repeat(64); },
    (value) => { value.manifest_hash = '0'.repeat(64); },
    (value) => { value.revision_hash = '0'.repeat(64); },
  ]) {
    const value = structuredClone(binary);
    mutate(value);
    assert.throws(() => validateSkillPackage(value), /materialization failed/);
  }
});

test('rejects unsafe paths, duplicate paths, and file-directory collisions', () => {
  const base = packageValue();
  const unsafe = structuredClone(base);
  unsafe.files[0].path = '../SKILL.md';
  assert.throws(() => validateSkillPackage(unsafe), /unsafe file path/);

  const duplicate = structuredClone(base);
  duplicate.files = [duplicate.files[0], duplicate.files[0]];
  assert.throws(() => validateSkillPackage(duplicate), /duplicate file path/);

  const collision = packageValue({ files: {
    'SKILL.md': '---\nname: test-skill\ndescription: Test Skill\n---\n',
    references: 'file\n',
    'references/api.md': 'child\n',
  } });
  assert.throws(() => validateSkillPackage(collision), /conflicts with parent file/);
});
