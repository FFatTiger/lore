/**
 * Lore Skill writable work-copy core.
 * dependency-free Node ESM (Node 20+). Schema: lore.skill.workcopy.v1
 *
 * Canonical source of truth lives in shared/skill-workcopy/.
 * Plugin adapters import generated copies under <plugin>/vendor/skill-workcopy/.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const LORE_SKILL_MARKER = '.lore-skill-marker.json';
export const LEGACY_LORE_SKILL_MARKER = '.lore-skill.json';
export const LORE_SKILL_SCHEMA = 'lore.skill.workcopy.v1';
export const LEGACY_MIRROR_SCHEMA = 'lore.skill.mirror.v1';
export const SKILL_MD = 'SKILL.md';

const WORK_FILE_MODE = 0o644;
const WORK_DIR_MODE = 0o755;

// ---- path / home helpers ----

export function resolveLoreHome(env = process.env) {
  const fromEnv = typeof env.LORE_HOME === 'string' ? env.LORE_HOME.trim() : '';
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), '.lore');
}

export function workCopiesRoot(loreHome) {
  return path.join(loreHome, 'skill-artifacts');
}

export function projectWorkCopyRoot(loreHome, projectId) {
  return path.join(workCopiesRoot(loreHome), sanitizeSegment(projectId));
}

/** @deprecated Prefer projectWorkCopyRoot. */
export function skillsRoot(loreHome, projectId) {
  return projectWorkCopyRoot(loreHome, projectId);
}

/** @deprecated Prefer projectWorkCopyRoot. */
export function installedRoot(loreHome, projectId) {
  return projectWorkCopyRoot(loreHome, projectId);
}

export function stagingRoot(loreHome, projectId) {
  return path.join(workCopiesRoot(loreHome), '.staging', sanitizeSegment(projectId));
}

export function skillInstallPath(loreHome, projectId, skillName) {
  return path.join(projectWorkCopyRoot(loreHome, projectId), sanitizeSegment(skillName));
}

export function sanitizeSegment(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) throw new Error('path segment is required');
  if (cleaned === '.' || cleaned === '..') throw new Error(`invalid path segment: ${cleaned}`);
  if (!/^[A-Za-z0-9._-]+$/.test(cleaned) || cleaned.includes('\0')) {
    throw new Error(`invalid path segment: ${cleaned}`);
  }
  return cleaned;
}

/**
 * Validate a skill-relative file path. Rejects absolute paths, traversal, and empty segments.
 * Returns the normalized relative path using forward slashes.
 */
export function validateSafeRelativePath(rawPath) {
  const raw = String(rawPath || '').trim();
  if (raw.includes('\\')) throw new Error(`backslashes are not allowed in file paths: ${rawPath}`);
  const input = raw;
  if (!input) throw new Error('file path is required');
  if (path.isAbsolute(input) || input.startsWith('/') || /^[A-Za-z]:\//.test(input)) {
    throw new Error(`absolute paths are not allowed: ${rawPath}`);
  }
  if (input.includes('\0')) throw new Error('null bytes are not allowed in file paths');
  const segments = input.split('/');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error(`empty path segments are not allowed: ${rawPath}`);
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`path traversal is not allowed: ${rawPath}`);
    }
    if (segment.includes('\0')) throw new Error('null bytes are not allowed in file paths');
  }
  return segments.join('/');
}

export function skillIdOf(value) {
  return String(value?.skill_id || value?.id || '').trim();
}

export function skillVersionOf(value) {
  // Prefer canonical version; fall back to legacy expected_version aliases only when absent.
  if (value?.version !== undefined && value?.version !== null && value?.version !== '') {
    return value.version;
  }
  return value?.expected_version;
}

export function skillRevisionOf(value) {
  // Prefer canonical revision_hash over legacy expected_revision_hash.
  const canonical = String(value?.revision_hash || '').trim();
  if (canonical) return canonical;
  return String(value?.expected_revision_hash || '').trim();
}

/**
 * Validate a list of managed relative paths for a work-copy marker/payload.
 * Rejects unsafe paths, duplicates, marker self-reference, and parent/child tree collisions.
 */
export function validateManagedFileList(rawPaths, opts) {
  if (!Array.isArray(rawPaths)) {
    throw new Error('managed_files must be an array');
  }
  const seen = new Set();
  const out = [];
  let hasSkillMd = false;
  for (const item of rawPaths) {
    if (typeof item !== 'string') {
      throw new Error('managed_files entries must be strings');
    }
    const rel = validateSafeRelativePath(item);
    if (rel === LORE_SKILL_MARKER || rel === LEGACY_LORE_SKILL_MARKER) {
      throw new Error(`${rel} may not appear in managed_files`);
    }
    if (seen.has(rel)) {
      throw new Error(`duplicate managed file path: ${rel}`);
    }
    seen.add(rel);
    if (rel === SKILL_MD) hasSkillMd = true;
    out.push(rel);
  }
  for (const rel of seen) {
    const segments = rel.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const parent = segments.slice(0, i).join('/');
      if (seen.has(parent)) {
        throw new Error(`managed file path ${rel} conflicts with parent path ${parent}`);
      }
    }
  }
  if (opts?.requireSkillMd !== false && !hasSkillMd) {
    throw new Error('managed_files must include SKILL.md');
  }
  return out.sort();
}

function normalizeSkillFile(file) {
  return {
    ...file,
    size: Number.isFinite(file.size_bytes) ? Number(file.size_bytes) : file.size,
    sha256: String(file.content_sha256 || file.sha256 || '').trim() || undefined,
  };
}

export function normalizeSkillSummary(value) {
  return {
    ...value,
    id: skillIdOf(value),
    version: skillVersionOf(value),
    revision_hash: skillRevisionOf(value) || undefined,
    manifest_hash: typeof value?.manifest_hash === 'string' ? value.manifest_hash : undefined,
  };
}

export function normalizeSkillDetail(value) {
  return {
    ...normalizeSkillSummary(value),
    files: Array.isArray(value?.files) ? value.files.map(normalizeSkillFile) : [],
  };
}

export function normalizeSkillCandidate(value) {
  return {
    ...value,
    id: skillIdOf(value),
    version: skillVersionOf(value),
    revision_hash: skillRevisionOf(value) || undefined,
    manifest_hash: typeof value?.manifest_hash === 'string' ? value.manifest_hash : undefined,
  };
}

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256Text(text) {
  return sha256Buffer(Buffer.from(text, 'utf-8'));
}

export function decodeSkillFileContent(file) {
  if (typeof file.content_base64 === 'string') {
    return Buffer.from(file.content_base64, 'base64');
  }
  if (typeof file.content === 'string') {
    return Buffer.from(file.content, 'utf-8');
  }
  throw new Error(`skill file missing content: ${file.path || '(unknown)'}`);
}

export function computeManifestHash(files) {
  const normalized = files
    .map((f) => ({
      path: validateSafeRelativePath(f.path),
      sha256: String(f.sha256 || '').toLowerCase(),
      size: Number.isFinite(f.size) ? Number(f.size) : 0,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const payload = normalized.map((f) => `${f.path}\n${f.sha256}\n${f.size}\n`).join('');
  return sha256Text(payload);
}

// ---- marker / local work copy inspection ----

/**
 * Read and validate a work-copy marker. Invalid / unsafe markers return null so callers never
 * act on traversal paths or corrupt managed_files lists.
 */
export function readWorkCopyMarker(dir) {
  const markerPath = path.join(dir, LORE_SKILL_MARKER);
  try {
    // Marker itself must be a regular file (not a symlink).
    const markerStat = fs.lstatSync(markerPath);
    if (markerStat.isSymbolicLink() || !markerStat.isFile()) return null;

    const raw = fs.readFileSync(markerPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (typeof data.schema !== 'string') return null;
    if (typeof data.project_id !== 'string' || !data.project_id.trim()) return null;
    if (typeof data.skill_id !== 'string' || !data.skill_id.trim()) return null;
    if (typeof data.name !== 'string' || !data.name.trim()) return null;
    if (data.version === undefined || data.version === null || data.version === '') return null;

    const isLegacy = data.schema === LEGACY_MIRROR_SCHEMA;
    const isWorkcopy = data.schema === LORE_SKILL_SCHEMA;
    if (!isLegacy && !isWorkcopy) return null;

    let managed_files = [];
    if (isWorkcopy) {
      // New schema: managed_files is authoritative and must be fully validated.
      try {
        managed_files = validateManagedFileList(data.managed_files, { requireSkillMd: true });
      } catch {
        return null;
      }
    } else {
      // Legacy schema may omit managed_files; do not invent unsafe paths from the marker.
      // If present, still validate when provided; invalid legacy managed_files => null.
      if (data.managed_files !== undefined) {
        try {
          managed_files = validateManagedFileList(data.managed_files, { requireSkillMd: false });
        } catch {
          return null;
        }
      }
    }

    return {
      schema: data.schema,
      project_id: data.project_id,
      skill_id: data.skill_id,
      name: data.name,
      version: data.version,
      managed_files,
      synced_at: typeof data.synced_at === 'string' ? data.synced_at : '',
      revision_hash: typeof data.revision_hash === 'string' ? data.revision_hash : undefined,
      manifest_hash: typeof data.manifest_hash === 'string' ? data.manifest_hash : undefined,
    };
  } catch {
    return null;
  }
}

/** @deprecated Prefer readWorkCopyMarker. */
export const readMirrorMarker = readWorkCopyMarker;

function listDirectoryNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Collect relative regular-file paths under root (no symlink follow).
 * Rejects symlinks and special entries. Skips the marker file.
 */
function collectRegularRelativeFiles(root, current = root, out = []) {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === LORE_SKILL_MARKER && current === root) continue;
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in skill work copies: ${path.relative(root, full)}`);
    }
    if (entry.isDirectory()) {
      collectRegularRelativeFiles(root, full, out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    } else {
      throw new Error(`unsupported filesystem entry in skill work copy: ${path.relative(root, full)}`);
    }
  }
  return out;
}

function ensureDir(dir, mode = WORK_DIR_MODE) {
  fs.mkdirSync(dir, { recursive: true, mode });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, mode); } catch { /* ignore */ }
  }
}

function makeTreeWritable(root) {
  if (!pathExists(root)) return;
  const walk = (current) => {
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink()) return;
      if (st.isDirectory()) {
        try { fs.chmodSync(current, WORK_DIR_MODE); } catch { /* ignore */ }
        for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
      } else if (st.isFile()) {
        try { fs.chmodSync(current, WORK_FILE_MODE); } catch { /* ignore */ }
      }
    } catch {
      // ignore unreadable nodes
    }
  };
  walk(root);
}

function rmrf(target) {
  makeTreeWritable(target);
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * Copy a directory tree without following symlinks. Rejects symlinks and special entries.
 */
function copyTreeNoFollow(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) {
    throw new Error(`symbolic links are not allowed in skill work copies: ${src}`);
  }
  if (st.isDirectory()) {
    ensureDir(dest, WORK_DIR_MODE);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic links are not allowed in skill work copies: ${path.join(src, entry.name)}`);
      }
      if (entry.isDirectory()) {
        copyTreeNoFollow(path.join(src, entry.name), path.join(dest, entry.name));
      } else if (entry.isFile()) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        fs.copyFileSync(from, to);
        if (process.platform !== 'win32') {
          try { fs.chmodSync(to, WORK_FILE_MODE); } catch { /* ignore */ }
        }
      } else {
        throw new Error(`unsupported filesystem entry in skill work copy: ${path.join(src, entry.name)}`);
      }
    }
  } else if (st.isFile()) {
    ensureDir(path.dirname(dest), WORK_DIR_MODE);
    fs.copyFileSync(src, dest);
    if (process.platform !== 'win32') {
      try { fs.chmodSync(dest, WORK_FILE_MODE); } catch { /* ignore */ }
    }
  } else {
    throw new Error(`unsupported filesystem entry in skill work copy: ${src}`);
  }
}

function chmodTreeWritable(root) {
  if (process.platform === 'win32') return;
  const walk = (current) => {
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      fs.chmodSync(current, WORK_DIR_MODE);
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
    } else if (st.isFile()) {
      fs.chmodSync(current, WORK_FILE_MODE);
    }
  };
  walk(root);
}

/** Remove empty parent directories under root after deleting a managed file. Never recurse into non-empty dirs. */
function pruneEmptyParents(root, relativeFile) {
  const segments = relativeFile.split('/');
  for (let i = segments.length - 1; i >= 1; i -= 1) {
    const dir = path.join(root, ...segments.slice(0, i));
    try {
      const entries = fs.readdirSync(dir);
      if (entries.length > 0) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
  }
}

export function inspectLocalWorkCopy(loreHome, projectId, skillName, expected) {
  const dir = skillInstallPath(loreHome, projectId, skillName);
  const rootStat = lstatOrNull(dir);
  if (!rootStat) {
    return { name: skillName, skill_id: expected?.skill_id, state: 'missing', message: 'work copy not installed' };
  }
  // Symlinks at install root are never treated as work-copy directories.
  if (rootStat.isSymbolicLink()) {
    return {
      name: skillName,
      skill_id: expected?.skill_id,
      state: 'unmanaged',
      path: dir,
      message: 'install path is a symlink; left untouched',
    };
  }
  if (!rootStat.isDirectory()) {
    return {
      name: skillName,
      skill_id: expected?.skill_id,
      state: 'unmanaged',
      path: dir,
      message: 'install path exists and is not a managed work-copy directory',
    };
  }

  const marker = readWorkCopyMarker(dir);
  if (!marker) {
    // Distinguishes missing/corrupt marker vs unsupported schema that failed validation.
    const markerPath = path.join(dir, LORE_SKILL_MARKER);
    if (pathExists(markerPath)) {
      return {
        name: skillName,
        state: 'invalid',
        path: dir,
        message: 'work-copy marker is missing, corrupt, or contains unsafe managed_files',
      };
    }
    return {
      name: skillName,
      state: 'unmanaged',
      path: dir,
      message: `directory exists without ${LORE_SKILL_MARKER}; left untouched`,
    };
  }

  if (marker.schema !== LORE_SKILL_SCHEMA && marker.schema !== LEGACY_MIRROR_SCHEMA) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'invalid',
      path: dir,
      version: marker.version,
      message: `unsupported work-copy marker schema: ${marker.schema}`,
    };
  }
  if (marker.project_id !== projectId || marker.name !== skillName) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'invalid',
      path: dir,
      version: marker.version,
      message: 'work-copy marker identity does not match its managed path',
    };
  }

  const skillMd = path.join(dir, SKILL_MD);
  const skillMdStat = lstatOrNull(skillMd);
  if (!skillMdStat || skillMdStat.isSymbolicLink() || !skillMdStat.isFile()) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'invalid',
      path: dir,
      version: marker.version,
      message: 'SKILL.md missing',
    };
  }

  if (expected?.skill_id && marker.skill_id !== expected.skill_id) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'invalid',
      path: dir,
      version: marker.version,
      message: `skill_id mismatch: local ${marker.skill_id} vs expected ${expected.skill_id}`,
    };
  }

  if (expected?.version !== undefined && String(marker.version) !== String(expected.version)) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'outdated',
      path: dir,
      version: marker.version,
      message: `version outdated: local ${marker.version} vs expected ${expected.version}`,
    };
  }

  // Same-version local edits are intentional work-copy state, never "tampered".
  // Legacy mirrors still report ready when identity/version match; ensureSkillWorkCopy migrates them.
  return {
    name: skillName,
    skill_id: marker.skill_id,
    state: 'ready',
    path: dir,
    version: marker.version,
  };
}

/** @deprecated Prefer inspectLocalWorkCopy. */
export const inspectLocalMirror = inspectLocalWorkCopy;

// ---- transport validation + materialize ----

export function validateSkillPayload(detail) {
  const name = String(detail.name || '').trim();
  if (!name) throw new Error('skill detail missing name');
  const skillId = skillIdOf(detail);
  if (!skillId) throw new Error('skill detail missing skill_id');

  const rawFiles = Array.isArray(detail.files) ? detail.files : [];
  if (rawFiles.length === 0) throw new Error('skill detail has no files');

  const files = [];
  const seenPaths = new Set();
  let hasSkillMd = false;
  for (const file of rawFiles) {
    const rel = validateSafeRelativePath(String(file.path || ''));
    if (seenPaths.has(rel)) throw new Error(`duplicate skill file path: ${rel}`);
    seenPaths.add(rel);
    if (rel === SKILL_MD) hasSkillMd = true;
    if (rel === LORE_SKILL_MARKER || rel === LEGACY_LORE_SKILL_MARKER) {
      throw new Error(`${rel} may not be supplied as a skill file`);
    }
    const buffer = decodeSkillFileContent(file);
    const sha = sha256Buffer(buffer);
    if (file.sha256) {
      const expected = String(file.sha256).toLowerCase();
      if (expected !== sha) {
        throw new Error(`sha256 mismatch for ${rel}: expected ${expected}, got ${sha}`);
      }
    }
    if (Number.isFinite(file.size) && Number(file.size) !== buffer.length) {
      throw new Error(`size mismatch for ${rel}: expected ${file.size}, got ${buffer.length}`);
    }
    files.push({ path: rel, buffer, sha256: sha, media_type: file.media_type });
  }
  if (!hasSkillMd) throw new Error('skill must include SKILL.md');
  for (const rel of seenPaths) {
    const segments = rel.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const parent = segments.slice(0, i).join('/');
      if (seenPaths.has(parent)) throw new Error(`skill file path ${rel} conflicts with parent file ${parent}`);
    }
  }

  const serverManifest = typeof detail.manifest_hash === 'string' ? detail.manifest_hash.toLowerCase() : '';
  const manifest_hash = computeManifestHash(files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.buffer.length })));
  if (serverManifest && serverManifest !== manifest_hash) {
    throw new Error(`manifest_hash mismatch: expected ${serverManifest}, got ${manifest_hash}`);
  }
  return { files, manifest_hash };
}

/**
 * Resolve previous managed file list for an existing install.
 * - Valid workcopy marker: use validated managed_files.
 * - Legacy mirror: treat every regular file except the marker as previously managed.
 * - Rejects trees containing symlinks/special entries (caller must not act on them).
 */
function previousManagedFilesForInstall(installPath, marker, nextManagedFiles = []) {
  if (marker.schema === LORE_SKILL_SCHEMA) {
    return validateManagedFileList(marker.managed_files, { requireSkillMd: true });
  }
  if (marker.schema === LEGACY_MIRROR_SCHEMA) {
    // Legacy read-only mirrors did not record managed_files. Preserve unknown
    // paths rather than guessing that every regular file belongs to Core: a
    // user may already have placed outputs in the directory. Only paths that
    // are also present in the incoming server package are safe to classify as
    // managed during migration.
    const incoming = new Set(nextManagedFiles);
    const files = collectRegularRelativeFiles(installPath).filter((rel) => incoming.has(rel));
    return validateManagedFileList(files, { requireSkillMd: false });
  }
  throw new Error(`unsupported marker schema for upgrade: ${marker.schema}`);
}

/**
 * Assert installPath is either absent, or a valid managed work-copy directory.
 * Refuses files, symlinks, special entries, and unmanaged directories.
 */
function assertInstallPathReplaceable(installPath) {
  const st = lstatOrNull(installPath);
  if (!st) return null;

  if (st.isSymbolicLink()) {
    const err = new Error(`unmanaged local symlink blocks install: ${installPath}`);
    err.code = 'UNMANAGED_CONFLICT';
    throw err;
  }
  if (!st.isDirectory()) {
    const err = new Error(`unmanaged local file blocks install: ${installPath}`);
    err.code = 'UNMANAGED_CONFLICT';
    throw err;
  }

  const marker = readWorkCopyMarker(installPath);
  if (!marker) {
    const markerPath = path.join(installPath, LORE_SKILL_MARKER);
    if (pathExists(markerPath)) {
      const err = new Error(`invalid work-copy marker blocks install: ${installPath}`);
      err.code = 'INVALID_MARKER';
      throw err;
    }
    const err = new Error(`unmanaged local directory blocks install: ${installPath}`);
    err.code = 'UNMANAGED_CONFLICT';
    throw err;
  }
  return marker;
}

/**
 * Remove a managed path in staging before writing the new package.
 * Files are unlinked; empty directories are rmdir'd. Non-empty directories that still
 * contain local extras fail rather than recursively deleting agent outputs.
 */
function removeObsoleteManagedPath(stagePath, oldPath) {
  const full = path.join(stagePath, ...oldPath.split('/'));
  const st = lstatOrNull(full);
  if (!st) return;
  if (st.isSymbolicLink()) {
    throw new Error(`refusing to delete symlink managed path: ${oldPath}`);
  }
  if (st.isFile()) {
    fs.unlinkSync(full);
    pruneEmptyParents(stagePath, oldPath);
    return;
  }
  if (st.isDirectory()) {
    const entries = fs.readdirSync(full);
    if (entries.length === 0) {
      fs.rmdirSync(full);
      pruneEmptyParents(stagePath, oldPath);
      return;
    }
    throw new Error(
      `cannot remove obsolete managed directory ${oldPath}: still contains local files`,
    );
  }
  throw new Error(`unsupported filesystem entry at obsolete managed path: ${oldPath}`);
}

/**
 * Prepare destination for writing a managed file. If a directory occupies the path
 * (e.g. file→directory or directory→file transition after obsolete cleanup), remove it
 * only when empty; otherwise fail so local extras are preserved.
 */
function prepareManagedFileDestination(stagePath, relPath) {
  const dest = path.join(stagePath, ...relPath.split('/'));
  const st = lstatOrNull(dest);
  if (!st) {
    ensureDir(path.dirname(dest), WORK_DIR_MODE);
    return dest;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`refusing to overwrite symlink managed path: ${relPath}`);
  }
  if (st.isFile()) {
    return dest;
  }
  if (st.isDirectory()) {
    const entries = fs.readdirSync(dest);
    if (entries.length === 0) {
      fs.rmdirSync(dest);
      ensureDir(path.dirname(dest), WORK_DIR_MODE);
      return dest;
    }
    throw new Error(
      `cannot replace managed directory ${relPath} with a file: still contains local files`,
    );
  }
  throw new Error(`refusing to overwrite non-file managed path: ${relPath}`);
}

/**
 * Materialize (or upgrade/migrate) a writable local work copy from server detail.
 * - Missing install: full stage + atomic move.
 * - Existing managed install: copy tree (no symlink follow), delete obsolete managed paths first,
 *   write new managed files, preserve extra local outputs, atomic swap. Failed write rolls back.
 * - Unmanaged file/symlink/directory: refused.
 * - Invalid marker (including unsafe managed_files): refused.
 */
export function materializeSkillWorkCopy(opts) {
  const { loreHome, projectId, detail } = opts;
  const skillName = sanitizeSegment(String(detail.name || ''));
  const { files } = validateSkillPayload(detail);
  const managedFiles = validateManagedFileList(files.map((f) => f.path), { requireSkillMd: true });
  const serverVersion = skillVersionOf(detail) ?? '';
  const skillId = skillIdOf(detail);

  const installPath = skillInstallPath(loreHome, projectId, skillName);
  const existingMarker = assertInstallPathReplaceable(installPath);

  let previousManaged = [];
  if (existingMarker) {
    previousManaged = previousManagedFilesForInstall(installPath, existingMarker, managedFiles);
  }

  const stagingBase = stagingRoot(loreHome, projectId);
  ensureDir(stagingBase, WORK_DIR_MODE);
  const stageId = `${skillName}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const stagePath = path.join(stagingBase, stageId);
  const finalStage = path.join(stagingBase, `${stageId}.final`);

  try {
    ensureDir(stagePath, WORK_DIR_MODE);

    // Seed stage from existing work copy (preserve Agent-produced outputs).
    if (existingMarker && pathExists(installPath)) {
      copyTreeNoFollow(installPath, stagePath);
    }

    const nextManaged = new Set(managedFiles);

    // 1) Delete obsolete managed paths FIRST so file↔directory shape transitions work.
    for (const oldPath of previousManaged) {
      if (nextManaged.has(oldPath)) continue;
      if (oldPath === LORE_SKILL_MARKER) continue;
      // Validate each previous path again before touching the filesystem.
      const safe = validateSafeRelativePath(oldPath);
      removeObsoleteManagedPath(stagePath, safe);
    }

    // 2) Write/overwrite server-managed files.
    for (const file of files) {
      const dest = prepareManagedFileDestination(stagePath, file.path);
      fs.writeFileSync(dest, file.buffer, { mode: WORK_FILE_MODE });
      if (process.platform !== 'win32') {
        try { fs.chmodSync(dest, WORK_FILE_MODE); } catch { /* ignore */ }
      }
    }

    const marker = {
      schema: LORE_SKILL_SCHEMA,
      project_id: projectId,
      skill_id: skillId,
      name: skillName,
      version: serverVersion,
      managed_files: managedFiles,
      synced_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(stagePath, LORE_SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`, {
      mode: WORK_FILE_MODE,
      encoding: 'utf-8',
    });
    if (process.platform !== 'win32') {
      try { fs.chmodSync(path.join(stagePath, LORE_SKILL_MARKER), WORK_FILE_MODE); } catch { /* ignore */ }
    }

    chmodTreeWritable(stagePath);

    if (pathExists(finalStage)) rmrf(finalStage);
    fs.renameSync(stagePath, finalStage);

    const installedBase = installedRoot(loreHome, projectId);
    ensureDir(installedBase, WORK_DIR_MODE);
    const backupPath = path.join(stagingBase, `${skillName}.backup-${Date.now()}`);
    if (pathExists(installPath)) {
      // Only rename a previously validated managed directory.
      makeTreeWritable(installPath);
      fs.renameSync(installPath, backupPath);
    }
    try {
      fs.renameSync(finalStage, installPath);
    } catch (error) {
      if (pathExists(backupPath) && !pathExists(installPath)) {
        try { fs.renameSync(backupPath, installPath); } catch { /* ignore */ }
      }
      throw error;
    }
    if (pathExists(backupPath)) rmrf(backupPath);
    chmodTreeWritable(installPath);
    return { installPath, marker };
  } catch (error) {
    // Failed staging never damages the existing copy (still at installPath or restored).
    throw error;
  } finally {
    if (pathExists(stagePath)) rmrf(stagePath);
    if (pathExists(finalStage)) rmrf(finalStage);
  }
}

/** @deprecated Prefer materializeSkillWorkCopy. */
export function writeSkillMirrorAtomic(opts) {
  return materializeSkillWorkCopy(opts);
}

/**
 * Ensure a writable work copy for the skill and return local SKILL.md + absolute skill_dir.
 * Downloads when missing, outdated, legacy (needs migration), or identity mismatch that is
 * rematerializable. Unmanaged / invalid roots error. Same-version current work copies preserve edits.
 *
 * Transport is injected:
 *   loadSkill(skillId) → Promise<SkillDetail>
 *   loadCatalog?.() → Promise<{ project_id: string, catalog_revision?: string }>
 */
export async function ensureSkillWorkCopy(opts) {
  const loreHome = opts.loreHome || resolveLoreHome();
  if (typeof opts.loadSkill !== 'function') {
    throw new Error('ensureSkillWorkCopy requires async loadSkill(skillId)');
  }
  const detail = normalizeSkillDetail(await opts.loadSkill(opts.skillId));
  let projectId = String(
    opts.projectId
    || detail.project_id
    || '',
  ).trim();
  if (!projectId) {
    if (typeof opts.loadCatalog !== 'function') {
      throw new Error('unable to determine project_id for skill work copy');
    }
    const catalog = await opts.loadCatalog();
    projectId = String(catalog?.project_id || '').trim();
    if (!projectId) throw new Error('unable to determine project_id for skill work copy');
    return ensureSkillWorkCopy({ ...opts, projectId, loreHome });
  }

  const skillName = sanitizeSegment(String(detail.name || ''));
  const serverVersion = skillVersionOf(detail);
  const skillId = skillIdOf(detail) || opts.skillId;
  const installPath = skillInstallPath(loreHome, projectId, skillName);

  const status = inspectLocalWorkCopy(loreHome, projectId, skillName, {
    skill_id: skillId,
    version: serverVersion,
  });

  if (status.state === 'unmanaged') {
    const err = new Error(status.message || `unmanaged path blocks skill work copy: ${installPath}`);
    err.code = 'UNMANAGED_CONFLICT';
    throw err;
  }
  if (status.state === 'invalid') {
    const err = new Error(status.message || `invalid local work copy: ${installPath}`);
    err.code = 'INVALID_WORK_COPY';
    throw err;
  }

  let downloaded = false;
  let skillDir = installPath;
  let activeMarker = null;

  if (status.state === 'ready' && status.path) {
    // Inspect only checks identity/version. Also migrate legacy same-version mirrors.
    const marker = readWorkCopyMarker(status.path);
    if (!marker) {
      const err = new Error(`invalid local work copy marker: ${status.path}`);
      err.code = 'INVALID_WORK_COPY';
      throw err;
    }
    if (marker.schema === LEGACY_MIRROR_SCHEMA) {
      // Same version legacy → rematerialize to writable workcopy + managed_files.
      const result = materializeSkillWorkCopy({ loreHome, projectId, detail });
      skillDir = result.installPath;
      activeMarker = result.marker;
      downloaded = true;
    } else if (marker.schema === LORE_SKILL_SCHEMA) {
      skillDir = status.path;
      activeMarker = marker;
      downloaded = false;
    } else {
      const err = new Error(`unsupported local work copy schema: ${marker.schema}`);
      err.code = 'INVALID_WORK_COPY';
      throw err;
    }
  } else {
    // missing or outdated → materialize
    const result = materializeSkillWorkCopy({ loreHome, projectId, detail });
    skillDir = result.installPath;
    activeMarker = result.marker;
    downloaded = true;
  }

  if (!activeMarker) {
    throw new Error('failed to materialize skill work copy');
  }

  // Final identity check after materialize/return path.
  if (activeMarker.project_id !== projectId || activeMarker.skill_id !== skillId || activeMarker.name !== skillName) {
    throw new Error(
      `work copy identity mismatch after ensure: project=${activeMarker.project_id} skill=${activeMarker.skill_id} name=${activeMarker.name}`,
    );
  }

  const skillMdPath = path.join(skillDir, SKILL_MD);
  const skillMdStat = lstatOrNull(skillMdPath);
  if (!skillMdStat || skillMdStat.isSymbolicLink() || !skillMdStat.isFile()) {
    throw new Error(`SKILL.md missing or not a regular file in work copy: ${skillDir}`);
  }
  const skill_md = fs.readFileSync(skillMdPath, 'utf-8');
  return {
    skill_dir: path.resolve(skillDir),
    skill_md,
    skill_md_path: path.resolve(skillMdPath),
    marker: activeMarker,
    project_id: projectId,
    skill: detail,
    server_version: serverVersion,
    local_version: activeMarker.version,
    downloaded,
  };
}

export function listLocalWorkCopyStatuses(loreHome, projectId) {
  if (!projectId) return [];
  return listDirectoryNames(installedRoot(loreHome, projectId)).map((name) =>
    inspectLocalWorkCopy(loreHome, projectId, name),
  );
}

/**
 * List work copies from every project under LORE_HOME. This is intentionally
 * local-only and never calls Core, so status remains useful before a session
 * has established project identity.
 */
export function listAllLocalWorkCopyStatuses(loreHome) {
  const root = workCopiesRoot(loreHome);
  const out = [];
  for (const projectId of listDirectoryNames(root)) {
    if (projectId === '.staging') continue;
    for (const status of listLocalWorkCopyStatuses(loreHome, projectId)) {
      out.push({ project_id: projectId, ...status });
    }
  }
  return out;
}

/** @deprecated Prefer listLocalWorkCopyStatuses. */
export const listLocalMirrorStatuses = listLocalWorkCopyStatuses;
