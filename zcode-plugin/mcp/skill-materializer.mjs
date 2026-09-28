import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MARKER_NAME = '.lore-skill-marker.json';
const LEGACY_MARKER_NAME = '.lore-skill.json';
const SKILL_MARKDOWN = 'SKILL.md';
const MAX_FILES = 256;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

function fail(message) {
  throw new Error(`Lore Skill materialization failed: ${message}`);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} is required`);
  return value.trim();
}

function requiredHash(value, field) {
  const hash = requiredString(value, field).toLowerCase();
  if (!HASH_PATTERN.test(hash)) fail(`${field} must be a lowercase SHA-256 digest`);
  return hash;
}

function safeDirectorySegment(value, field) {
  const segment = requiredString(value, field);
  if (segment === '.' || segment === '..' || !SEGMENT_PATTERN.test(segment)) {
    fail(`${field} is not a safe directory segment`);
  }
  return segment;
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) fail('file path is required');
  const relative = value.trim();
  if (relative.includes('\\') || relative.includes('\0') || relative.startsWith('/') || /^[A-Za-z]:\//.test(relative)) {
    fail(`unsafe file path ${JSON.stringify(value)}`);
  }
  const parts = relative.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail(`unsafe file path ${JSON.stringify(value)}`);
  }
  if (relative === MARKER_NAME || relative === LEGACY_MARKER_NAME) {
    fail(`package contains reserved marker ${relative}`);
  }
  return relative;
}

function decodeBase64(value, filePath) {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0) {
    fail(`invalid content_base64 for ${JSON.stringify(filePath)}`);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail(`invalid content_base64 for ${JSON.stringify(filePath)}`);
  }
  const content = Buffer.from(value, 'base64');
  if (content.toString('base64') !== value) {
    fail(`non-canonical content_base64 for ${JSON.stringify(filePath)}`);
  }
  return content;
}

function decodeFile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('each file must be an object');
  const filePath = normalizeRelativePath(raw.path);
  const hasText = typeof raw.content === 'string';
  const hasBase64 = typeof raw.content_base64 === 'string';
  if (hasText === hasBase64) fail(`file ${JSON.stringify(filePath)} must contain exactly one content field`);
  const content = hasText ? Buffer.from(raw.content, 'utf8') : decodeBase64(raw.content_base64, filePath);
  if (content.length > MAX_FILE_BYTES) fail(`file ${JSON.stringify(filePath)} exceeds the size limit`);
  if (!Number.isSafeInteger(raw.size_bytes) || raw.size_bytes < 0 || raw.size_bytes !== content.length) {
    fail(`size mismatch for ${JSON.stringify(filePath)}`);
  }
  const contentHash = requiredHash(raw.content_sha256, `content_sha256 for ${filePath}`);
  if (sha256(content) !== contentHash) fail(`SHA-256 mismatch for ${JSON.stringify(filePath)}`);
  return {
    path: filePath,
    content,
    sha256: contentHash,
    size_bytes: content.length,
  };
}

function validateFileTree(files) {
  const paths = new Set(files.map((file) => file.path));
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join('/');
      if (paths.has(parent)) fail(`file path ${JSON.stringify(file.path)} conflicts with parent file ${JSON.stringify(parent)}`);
    }
  }
}

function comparePaths(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function manifestHash(files) {
  const lines = [...files]
    .sort((left, right) => comparePaths(left.path, right.path))
    .map((file) => `${file.path}\n${file.sha256}\n${file.size_bytes}\n`)
    .join('');
  return sha256(Buffer.from(lines, 'utf8'));
}

function revisionHash(skill, computedManifestHash) {
  const input = [
    `name=${skill.name}`,
    `description=${skill.description}`,
    `enabled=${skill.enabled ? 'true' : 'false'}`,
    `manifest=${computedManifestHash}`,
    '',
  ].join('\n');
  return sha256(Buffer.from(input, 'utf8'));
}

export function validateSkillPackage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Skill detail must be an object');
  const projectId = safeDirectorySegment(raw.project_id, 'project_id');
  const skillId = requiredString(raw.skill_id, 'skill_id');
  const name = requiredString(raw.name, 'name');
  if (!NAME_PATTERN.test(name)) fail('name is not a valid Skill name');
  if (typeof raw.description !== 'string') fail('description must be a string');
  if (typeof raw.enabled !== 'boolean') fail('enabled must be a boolean');
  if (!Number.isSafeInteger(raw.version) || raw.version <= 0) fail('version must be a positive integer');
  if (!Number.isSafeInteger(raw.catalog_revision) || raw.catalog_revision < 0) fail('catalog_revision must be a non-negative integer');
  const expectedManifest = requiredHash(raw.manifest_hash, 'manifest_hash');
  const expectedRevision = requiredHash(raw.revision_hash, 'revision_hash');
  if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > MAX_FILES) {
    fail(`files must contain between 1 and ${MAX_FILES} entries`);
  }
  const files = raw.files.map(decodeFile);
  const seen = new Set();
  let totalBytes = 0;
  for (const file of files) {
    if (seen.has(file.path)) fail(`duplicate file path ${JSON.stringify(file.path)}`);
    seen.add(file.path);
    totalBytes += file.size_bytes;
    if (totalBytes > MAX_TOTAL_BYTES) fail('package exceeds the total size limit');
  }
  validateFileTree(files);
  if (!seen.has(SKILL_MARKDOWN)) fail(`package must include ${SKILL_MARKDOWN}`);
  const computedManifest = manifestHash(files);
  if (computedManifest !== expectedManifest) fail('manifest_hash does not match package files');
  const skill = {
    project_id: projectId,
    skill_id: skillId,
    name,
    description: raw.description,
    enabled: raw.enabled,
    version: raw.version,
    revision_hash: expectedRevision,
    manifest_hash: expectedManifest,
    catalog_revision: raw.catalog_revision,
    files: files.sort((left, right) => comparePaths(left.path, right.path)),
  };
  if (revisionHash(skill, computedManifest) !== expectedRevision) {
    fail('revision_hash does not match package metadata and files');
  }
  return skill;
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function assertDirectoryChain(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('target escaped the Skill directory');
  let current = root;
  const rootStat = lstatOrNull(root);
  if (rootStat?.isSymbolicLink()) fail(`symlink directory is not allowed: ${root}`);
  if (rootStat && !rootStat.isDirectory()) fail(`expected directory: ${root}`);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) fail(`symlink path is not allowed: ${current}`);
    if (!stat.isDirectory()) fail(`file blocks directory path: ${current}`);
  }
}

function parseMarker(markerPath, skill) {
  const stat = lstatOrNull(markerPath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) fail('managed marker must be a regular file');
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    fail('managed marker is invalid JSON');
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) fail('managed marker is invalid');
  if (marker.skill_id !== skill.skill_id || marker.project_id !== skill.project_id || marker.name !== skill.name) {
    fail('managed marker belongs to a different Skill');
  }
  if (!Array.isArray(marker.files)) fail('managed marker files are invalid');
  const files = marker.files.map((file) => ({
    path: normalizeRelativePath(file?.path),
    sha256: requiredHash(file?.sha256, 'marker file sha256'),
    size_bytes: file?.size_bytes,
  }));
  if (files.some((file) => !Number.isSafeInteger(file.size_bytes) || file.size_bytes < 0)) {
    fail('managed marker file size is invalid');
  }
  return { ...marker, files };
}

function assertNoSymlinkAncestors(skillDirectory, relativePath, removableManagedFiles) {
  const parts = relativePath.split('/');
  let current = skillDirectory;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    const relative = parts.slice(0, index + 1).join('/');
    const stat = lstatOrNull(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) fail(`symlink path is not allowed: ${relative}`);
    if (!stat.isDirectory() && !removableManagedFiles.has(relative)) {
      fail(`local artifact blocks managed path: ${relative}`);
    }
  }
}

function directoryContainsOnlyRemovableManaged(skillDirectory, directory, removableManagedFiles) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const relative = path.relative(skillDirectory, target).split(path.sep).join('/');
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (![...removableManagedFiles].some((filePath) => filePath.startsWith(`${relative}/`))) return false;
        pending.push(target);
        continue;
      }
      if (!entry.isFile() || !removableManagedFiles.has(relative)) return false;
    }
  }
  return true;
}

function preflight(skillDirectory, skill, marker) {
  const oldManaged = new Set((marker?.files || []).map((file) => file.path));
  const incoming = new Set(skill.files.map((file) => file.path));
  const removableManagedFiles = new Set([...oldManaged].filter((filePath) => !incoming.has(filePath)));

  for (const filePath of oldManaged) {
    const target = path.join(skillDirectory, ...filePath.split('/'));
    const stat = lstatOrNull(target);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail(`old managed path is no longer a regular file: ${filePath}`);
    }
  }

  for (const file of skill.files) {
    assertNoSymlinkAncestors(skillDirectory, file.path, removableManagedFiles);
    const target = path.join(skillDirectory, ...file.path.split('/'));
    const stat = lstatOrNull(target);
    if (!stat) continue;
    if (stat.isSymbolicLink()) fail(`symlink path is not allowed: ${file.path}`);
    if (stat.isDirectory()) {
      if (!directoryContainsOnlyRemovableManaged(skillDirectory, target, removableManagedFiles)) {
        fail(`local artifact blocks managed file: ${file.path}`);
      }
      continue;
    }
    if (!stat.isFile()) fail(`non-file blocks managed file: ${file.path}`);
    if (!oldManaged.has(file.path)) fail(`local artifact conflicts with new managed file: ${file.path}`);
  }
  return { oldManaged, incoming };
}

function managedFilesAreCurrent(skillDirectory, skill, marker) {
  if (!marker || marker.manifest_hash !== skill.manifest_hash) {
    return false;
  }
  const markerFiles = new Map(marker.files.map((file) => [file.path, file]));
  if (markerFiles.size !== skill.files.length) return false;
  for (const file of skill.files) {
    const markerFile = markerFiles.get(file.path);
    if (!markerFile || markerFile.sha256 !== file.sha256 || markerFile.size_bytes !== file.size_bytes) return false;
    const target = path.join(skillDirectory, ...file.path.split('/'));
    const stat = lstatOrNull(target);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== file.size_bytes) return false;
    if (sha256(fs.readFileSync(target)) !== file.sha256) return false;
  }
  return true;
}

function atomicWrite(target, content) {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function removeEmptyParents(skillDirectory, filePath) {
  let current = path.dirname(path.join(skillDirectory, ...filePath.split('/')));
  while (current !== skillDirectory) {
    try {
      fs.rmdirSync(current);
    } catch (error) {
      if (error?.code === 'ENOTEMPTY' || error?.code === 'ENOENT') return;
      throw error;
    }
    current = path.dirname(current);
  }
}

function markerValueFor(skill) {
  return {
    skill_id: skill.skill_id,
    project_id: skill.project_id,
    name: skill.name,
    version: skill.version,
    revision_hash: skill.revision_hash,
    manifest_hash: skill.manifest_hash,
    catalog_revision: skill.catalog_revision,
    files: skill.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      size_bytes: file.size_bytes,
    })),
  };
}

function resultFor(skillDirectory, skill, reused) {
  const skillMarkdown = skill.files.find((file) => file.path === SKILL_MARKDOWN);
  return {
    project_id: skill.project_id,
    skill_id: skill.skill_id,
    name: skill.name,
    version: skill.version,
    revision_hash: skill.revision_hash,
    manifest_hash: skill.manifest_hash,
    catalog_revision: skill.catalog_revision,
    skill_markdown: skillMarkdown.content.toString('utf8'),
    local_directory: skillDirectory,
    managed_files: skill.files.map((file) => file.path),
    reused,
  };
}

export function materializeSkill(raw, options = {}) {
  const skill = validateSkillPackage(raw);
  const loreHome = path.resolve(requiredString(options.loreHome, 'loreHome'));
  const root = path.join(loreHome, 'skill-artifacts');
  const projectDirectory = path.join(root, skill.project_id);
  const skillDirectory = path.join(projectDirectory, skill.name);
  const markerPath = path.join(skillDirectory, MARKER_NAME);
  assertDirectoryChain(loreHome, skillDirectory);
  const marker = parseMarker(markerPath, skill);
  const { oldManaged, incoming } = preflight(skillDirectory, skill, marker);

  if (managedFilesAreCurrent(skillDirectory, skill, marker)) {
    if (marker.version !== skill.version
      || marker.revision_hash !== skill.revision_hash
      || marker.catalog_revision !== skill.catalog_revision) {
      atomicWrite(markerPath, Buffer.from(`${JSON.stringify(markerValueFor(skill), null, 2)}\n`, 'utf8'));
    }
    return resultFor(skillDirectory, skill, true);
  }

  fs.mkdirSync(skillDirectory, { recursive: true, mode: 0o700 });
  for (const oldPath of oldManaged) {
    if (incoming.has(oldPath)) continue;
    const target = path.join(skillDirectory, ...oldPath.split('/'));
    const stat = lstatOrNull(target);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) fail(`old managed path is no longer a regular file: ${oldPath}`);
    fs.unlinkSync(target);
    removeEmptyParents(skillDirectory, oldPath);
  }
  for (const file of skill.files) {
    const target = path.join(skillDirectory, ...file.path.split('/'));
    atomicWrite(target, file.content);
  }

  const markerValue = markerValueFor(skill);
  atomicWrite(markerPath, Buffer.from(`${JSON.stringify(markerValue, null, 2)}\n`, 'utf8'));
  return resultFor(skillDirectory, skill, false);
}
