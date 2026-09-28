/**
 * Lore Skill work-copy core.
 * dependency-free Node ESM (Node 20+). Schema: lore.skill.workcopy.v1
 *
 * Contract:
 * - The Core/server skill package is the source of truth.
 * - getSkill ensures a local work copy: it downloads the complete server package
 *   when missing, updates the server-managed package files when the server version
 *   differs, and reuses the local copy when the version matches and the managed
 *   files are intact.
 * - Server-managed package files (those listed in marker.managed_files) are
 *   read-only (0444 on POSIX). The installed skill directory itself stays writable
 *   (0755) so agents can create local outputs, artifacts, and cache files directly
 *   inside the same copy. Those extra local files are valid, local-only, never
 *   uploaded, and survive getSkill calls and version upgrades.
 * - Integrity/tamper checks cover ONLY the server-managed paths from the marker;
 *   extra local files never make a copy tampered.
 * - On upgrade, only obsolete server-managed paths are removed and incoming
 *   server-managed files are written; extra local files are preserved. If an
 *   obsolete managed path or a new managed path conflicts with a local artifact
 *   (file/dir shape or same path), the upgrade fails safely with no damage.
 * - No separate artifact directory and no artifact-create tool.
 * - No session-start bulk reconcile/download; all download/update is on-demand
 *   via getSkill. Recall is identity-only and never injects local paths.
 * - Server-managed files are chmod 0444 on POSIX (the package model has no
 *   executable bit, so managed scripts are invoked through their interpreter).
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

const WORK_FILE_MODE = 0o644; // staging / backup trees (writable)
const WORK_DIR_MODE = 0o755; // installed directories (writable for local outputs)
const READONLY_FILE_MODE = 0o444; // installed server-managed files + marker

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
 * Validate a list of managed relative paths for a mirror marker/payload.
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

// ---- marker / local work-copy inspection ----

/**
 * Read and validate a mirror marker. Invalid / unsafe markers return null so callers never
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
      readonly: data.readonly === true,
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
 * Hash ONLY the server-managed files listed in the work-copy marker.
 * Extra local files are never hashed, so they cannot trigger tamper.
 * Throws when a managed file is missing or is not a regular file.
 */
export function hashLocalSkillFiles(dir) {
  const marker = readWorkCopyMarker(dir);
  if (!marker) throw new Error(`missing or invalid work-copy marker: ${dir}`);
  const files = [];
  for (const rel of marker.managed_files) {
    const full = path.join(dir, ...rel.split('/'));
    const st = lstatOrNull(full);
    if (!st) throw new Error(`missing managed file: ${rel}`);
    if (st.isSymbolicLink() || !st.isFile()) {
      throw new Error(`managed path is not a regular file: ${rel}`);
    }
    const buf = fs.readFileSync(full);
    files.push({ path: rel, sha256: sha256Buffer(buf), size: buf.length });
  }
  return { files, manifest_hash: computeManifestHash(files) };
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
 * Apply installed permissions (POSIX only):
 * - Installed skill directory and managed-file ancestors stay writable (0755) so
 *   agents can create local outputs directly inside the same copy.
 * - Server-managed files and the marker are chmod 0444 (read-only).
 * - Extra local files/directories keep whatever mode they were created with.
 */
function applyInstalledModes(dir, managedFiles) {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(dir, WORK_DIR_MODE); } catch { /* ignore */ }
  try { fs.chmodSync(path.join(dir, LORE_SKILL_MARKER), READONLY_FILE_MODE); } catch { /* ignore */ }
  const ancestorDirs = new Set();
  for (const rel of managedFiles) {
    try { fs.chmodSync(path.join(dir, ...rel.split('/')), READONLY_FILE_MODE); } catch { /* ignore */ }
    const segments = rel.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      ancestorDirs.add(segments.slice(0, i).join('/'));
    }
  }
  for (const rel of ancestorDirs) {
    try { fs.chmodSync(path.join(dir, ...rel.split('/')), WORK_DIR_MODE); } catch { /* ignore */ }
  }
}

/**
 * Copy a directory tree (used to seed a fresh stage from an existing valid work copy).
 * Symlinks inside extra local files are copied verbatim; managed files are overwritten
 * or removed during materialization regardless.
 */
function copyTree(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    errorOnExist: false,
    verbatimSymlinks: true,
  });
}

/** Set of directory paths that are strict ancestors of managed files. */
function managedDirPrefixes(managedSet) {
  const prefixes = new Set();
  for (const rel of managedSet) {
    const segments = rel.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      prefixes.add(segments.slice(0, i).join('/'));
    }
  }
  return prefixes;
}

function conflictError(message, code = 'LOCAL_ARTIFACT_CONFLICT') {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Validate ancestors of marker-owned paths before copying, chmodding, or deleting.
 * An intermediate symlink would make ordinary path operations escape the work-copy
 * root; a non-directory ancestor is structural tamper. Exact managed paths are not
 * checked here because materialization restores those safely from server state.
 */
function assertManagedPathAncestorsSafe(root, managedFiles) {
  for (const rel of managedFiles) {
    const segments = rel.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const ancestor = segments.slice(0, i).join('/');
      const st = lstatOrNull(path.join(root, ...segments.slice(0, i)));
      if (!st) continue;
      if (st.isSymbolicLink()) {
        throw conflictError(
          `managed path ${rel} has symlink ancestor ${ancestor}; refusing out-of-copy access`,
        );
      }
      if (!st.isDirectory()) {
        throw conflictError(
          `managed path ${rel} has non-directory ancestor ${ancestor}`,
        );
      }
    }
  }
}

/**
 * Remove obsolete managed files from the staged tree (files that were managed in the
 * old marker but are not part of the incoming package). The marker owns these exact
 * paths, so regular files and symlinks at them are removed. An empty directory at a
 * formerly-managed file path is structural tamper and is removed; a non-empty directory
 * may contain local outputs, so it fails safely instead of deleting them.
 */
function removeObsoleteManaged(stageRoot, oldManaged, newManagedSet) {
  const obsolete = oldManaged.filter((rel) => !newManagedSet.has(rel));
  if (obsolete.length === 0) return;
  // Remove deepest first so nested obsolete files disappear before their parents.
  obsolete
    .sort((a, b) => b.split('/').length - a.split('/').length)
    .forEach((rel) => {
      const full = path.join(stageRoot, ...rel.split('/'));
      const st = lstatOrNull(full);
      if (!st) return;
      if (st.isDirectory()) {
        if (fs.readdirSync(full).length > 0) {
          throw conflictError(
            `obsolete managed path ${rel} is now a non-empty local directory (local artifact)`,
          );
        }
        fs.rmdirSync(full);
        return;
      }
      // The old marker owns this exact path. A symlink here is tamper, not an extra.
      fs.rmSync(full, { force: true });
    });

  // Prune empty directories that were managed ancestors (never extras).
  const prefixes = managedDirPrefixes(new Set(oldManaged));
  const sorted = [...prefixes].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const rel of sorted) {
    const full = path.join(stageRoot, ...rel.split('/'));
    const st = lstatOrNull(full);
    if (!st || !st.isDirectory()) continue;
    try {
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } catch { /* ignore */ }
  }
}

/**
 * Detect conflicts between incoming managed files and preserved local extras in the
 * staged tree. Throws (leaving the stage untouched and the install intact) when:
 * - a new managed path already exists as an extra file/dir/symlink, or
 * - a new managed path must live under an ancestor that is a file/symlink.
 * Managed paths already owned by the old marker are restored from server state: regular
 * files are overwritten, symlinks are unlinked, and empty replacement directories are
 * removed. A non-empty replacement directory fails safely because it may contain outputs.
 */
function assertNoManagedExtraConflicts(stageRoot, newManagedFiles, oldManagedSet) {
  for (const rel of newManagedFiles) {
    const full = path.join(stageRoot, ...rel.split('/'));
    const st = lstatOrNull(full);
    if (st) {
      if (oldManagedSet.has(rel)) {
        if (st.isSymbolicLink()) {
          fs.unlinkSync(full);
        } else if (st.isDirectory()) {
          if (fs.readdirSync(full).length > 0) {
            throw conflictError(
              `managed path ${rel} is now a non-empty local directory (local artifact)`,
            );
          }
          fs.rmdirSync(full);
        } else if (!st.isFile()) {
          throw conflictError(`managed path ${rel} is an unsupported local filesystem entry`);
        }
        // A regular file at an old managed path is overwritten below.
      } else if (st.isDirectory()) {
        throw conflictError(
          `new managed path ${rel} conflicts with an existing local directory (local artifact)`,
        );
      } else {
        throw conflictError(
          `new managed path ${rel} conflicts with an existing local file (local artifact)`,
        );
      }
    }
    const segments = rel.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const ancestor = segments.slice(0, i).join('/');
      const ancSt = lstatOrNull(path.join(stageRoot, ...ancestor.split('/')));
      if (ancSt && !ancSt.isDirectory()) {
        throw conflictError(
          `new managed path ${rel} must live under ${ancestor}, which is a local file (local artifact)`,
        );
      }
    }
  }
}

/**
 * Assert installPath is either absent, or a valid managed mirror directory.
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
 * Materialize (or upgrade/migrate) a local work copy from server detail.
 *
 * - Missing install: full stage + atomic move.
 * - Existing managed work copy (marker with managed_files): the stage is seeded from
 *   the existing copy so extra local files are preserved. Obsolete managed files are
 *   removed, incoming managed files are written, and the marker is refreshed.
 * - Legacy markers (no managed_files boundary) have no preserved extras: they are
 *   rematerialized fresh from server state.
 * - A new managed path that conflicts with a preserved local artifact (file/dir shape
 *   or same path) fails safely with no damage to the installed copy.
 * - Unmanaged file/symlink/directory or invalid marker: refused.
 * - Installed directories are writable (0755, POSIX); server-managed files and the
 *   marker are 0444. Stage and backup stay writable internally.
 */
export function materializeSkillWorkCopy(opts) {
  const { loreHome, projectId, detail } = opts;
  const skillName = sanitizeSegment(String(detail.name || ''));
  const { files, manifest_hash } = validateSkillPayload(detail);
  const managedFiles = validateManagedFileList(files.map((f) => f.path), { requireSkillMd: true });
  const serverVersion = skillVersionOf(detail) ?? '';
  const serverRevision = skillRevisionOf(detail) || undefined;
  const skillId = skillIdOf(detail);

  const installPath = skillInstallPath(loreHome, projectId, skillName);
  const existingMarker = assertInstallPathReplaceable(installPath);
  const existingManaged = existingMarker && existingMarker.schema === LORE_SKILL_SCHEMA
    ? existingMarker.managed_files
    : [];

  // This must happen before copyTree, chmod, or obsolete-path removal: path operations
  // must never traverse a symlinked ancestor outside the installed work copy.
  if (existingManaged.length > 0) {
    assertManagedPathAncestorsSafe(installPath, existingManaged);
  }

  const stagingBase = stagingRoot(loreHome, projectId);
  ensureDir(stagingBase, WORK_DIR_MODE);
  const stageId = `${skillName}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const stagePath = path.join(stagingBase, stageId);
  const finalStage = path.join(stagingBase, `${stageId}.final`);

  try {
    ensureDir(stagePath, WORK_DIR_MODE);

    // Seed the stage from the existing valid managed copy (preserves local extras).
    // Legacy markers have no managed_files boundary, so build fresh instead.
    if (existingMarker && existingMarker.schema === LORE_SKILL_SCHEMA && pathExists(installPath)) {
      copyTree(installPath, stagePath);
      // Seeded server-managed files + marker are 0444; make them writable in the stage
      // so they can be replaced/removed. Extra local files keep their original modes.
      for (const rel of [...existingManaged, LORE_SKILL_MARKER]) {
        const seeded = path.join(stagePath, ...rel.split('/'));
        const seededStat = lstatOrNull(seeded);
        if (seededStat && seededStat.isFile()) {
          try { fs.chmodSync(seeded, WORK_FILE_MODE); } catch { /* ignore */ }
        }
      }
    }

    const newManagedSet = new Set(managedFiles);
    removeObsoleteManaged(stagePath, existingManaged, newManagedSet);
    assertNoManagedExtraConflicts(stagePath, managedFiles, new Set(existingManaged));

    // Write incoming managed files.
    for (const file of files) {
      const dest = path.join(stagePath, ...file.path.split('/'));
      ensureDir(path.dirname(dest), WORK_DIR_MODE);
      fs.writeFileSync(dest, file.buffer, { mode: WORK_FILE_MODE });
    }

    const marker = {
      schema: LORE_SKILL_SCHEMA,
      project_id: projectId,
      skill_id: skillId,
      name: skillName,
      version: serverVersion,
      managed_files: managedFiles,
      revision_hash: serverRevision,
      manifest_hash,
      readonly: true,
      synced_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(stagePath, LORE_SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`, {
      mode: WORK_FILE_MODE,
      encoding: 'utf-8',
    });

    if (pathExists(finalStage)) rmrf(finalStage);
    fs.renameSync(stagePath, finalStage);

    const installedBase = projectWorkCopyRoot(loreHome, projectId);
    ensureDir(installedBase, WORK_DIR_MODE);
    const backupPath = path.join(stagingBase, `${skillName}.backup-${Date.now()}`);
    if (pathExists(installPath)) {
      // Only rename a previously validated managed directory. Make it writable first
      // so legacy 0555 read-only installs can be renamed/rolled back on all POSIX.
      makeTreeWritable(installPath);
      fs.renameSync(installPath, backupPath);
    }
    try {
      fs.renameSync(finalStage, installPath);
    } catch (error) {
      if (pathExists(backupPath) && !pathExists(installPath)) {
        try {
          fs.renameSync(backupPath, installPath);
        } catch { /* ignore */ }
      }
      throw error;
    }
    if (pathExists(backupPath)) rmrf(backupPath);
    applyInstalledModes(installPath, managedFiles);
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
 * Inspect a local work copy. Returns 'tampered' only when a server-managed file
 * (from marker.managed_files) is missing, is not a regular file, or its hash does not
 * match the marker manifest_hash. Extra local files never trigger tamper.
 */
export function inspectLocalWorkCopy(loreHome, projectId, skillName, expected) {
  const dir = skillInstallPath(loreHome, projectId, skillName);
  const rootStat = lstatOrNull(dir);
  if (!rootStat) {
    return { name: skillName, skill_id: expected?.skill_id, state: 'missing', message: 'mirror not installed' };
  }
  // Symlinks at install root are never treated as mirror directories.
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
      message: 'install path exists and is not a managed mirror directory',
    };
  }

  const marker = readWorkCopyMarker(dir);
  if (!marker) {
    const markerPath = path.join(dir, LORE_SKILL_MARKER);
    if (pathExists(markerPath)) {
      return {
        name: skillName,
        state: 'invalid',
        path: dir,
        message: 'mirror marker is missing, corrupt, or contains unsafe managed_files',
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
      message: `unsupported mirror marker schema: ${marker.schema}`,
    };
  }
  if (marker.project_id !== projectId || marker.name !== skillName) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'invalid',
      path: dir,
      version: marker.version,
      message: 'mirror marker identity does not match its managed path',
    };
  }

  const skillMd = path.join(dir, SKILL_MD);
  const skillMdStat = lstatOrNull(skillMd);
  if (!skillMdStat || skillMdStat.isSymbolicLink() || !skillMdStat.isFile()) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'tampered',
      path: dir,
      version: marker.version,
      revision_hash: marker.revision_hash,
      message: 'SKILL.md missing',
    };
  }

  // Integrity: hash ONLY the managed files from the marker (extras are ignored).
  if (marker.manifest_hash) {
    let localHash;
    try {
      localHash = hashLocalSkillFiles(dir).manifest_hash;
    } catch (error) {
      return {
        name: skillName,
        skill_id: marker.skill_id,
        state: 'tampered',
        path: dir,
        version: marker.version,
        revision_hash: marker.revision_hash,
        message: error?.message || 'failed to verify managed files',
      };
    }
    if (localHash !== marker.manifest_hash) {
      return {
        name: skillName,
        skill_id: marker.skill_id,
        state: 'tampered',
        path: dir,
        version: marker.version,
        revision_hash: marker.revision_hash,
        message: 'managed file hashes do not match marker manifest_hash',
      };
    }
  } else {
    // Pre-manifest workcopy markers cannot be integrity-checked; rematerialize once.
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'tampered',
      path: dir,
      version: marker.version,
      message: 'mirror marker missing manifest_hash; rematerialize required',
    };
  }

  if (expected?.skill_id && marker.skill_id !== expected.skill_id) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'invalid',
      path: dir,
      version: marker.version,
      revision_hash: marker.revision_hash,
      message: `skill_id mismatch: local ${marker.skill_id} vs expected ${expected.skill_id}`,
    };
  }

  if (expected?.revision_hash && marker.revision_hash !== expected.revision_hash) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'outdated',
      path: dir,
      version: marker.version,
      revision_hash: marker.revision_hash,
      message: `revision outdated: local ${marker.revision_hash} vs expected ${expected.revision_hash}`,
    };
  }

  if (expected?.version !== undefined && String(marker.version) !== String(expected.version)) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'outdated',
      path: dir,
      version: marker.version,
      revision_hash: marker.revision_hash,
      message: `version outdated: local ${marker.version} vs expected ${expected.version}`,
    };
  }

  if (expected?.manifest_hash && marker.manifest_hash !== expected.manifest_hash) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'outdated',
      path: dir,
      version: marker.version,
      revision_hash: marker.revision_hash,
      message: 'manifest_hash outdated',
    };
  }

  return {
    name: skillName,
    skill_id: marker.skill_id,
    state: 'ready',
    path: dir,
    version: marker.version,
    revision_hash: marker.revision_hash,
  };
}

/** @deprecated Prefer inspectLocalWorkCopy. */
export const inspectLocalMirror = inspectLocalWorkCopy;

// ---- transport validation ----

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
 * Ensure a local work copy for the skill and return local SKILL.md + absolute skill_dir.
 *
 * - Missing, outdated (version/revision/manifest differs), tampered (managed files
 *   modified), or legacy copies are rematerialized from the fetched server detail.
 *   Rematerialization preserves extra local files in the same copy.
 * - Same version with intact managed files reuses the local copy (no overwrite);
 *   extra local files survive.
 * - Unmanaged / invalid roots error (fail-closed).
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
      throw new Error('unable to determine project_id for skill mirror');
    }
    const catalog = await opts.loadCatalog();
    projectId = String(catalog?.project_id || '').trim();
    if (!projectId) throw new Error('unable to determine project_id for skill mirror');
    return ensureSkillWorkCopy({ ...opts, projectId, loreHome });
  }

  const skillName = sanitizeSegment(String(detail.name || ''));
  const serverVersion = skillVersionOf(detail);
  const serverRevision = skillRevisionOf(detail) || undefined;
  const serverManifest = typeof detail.manifest_hash === 'string' ? detail.manifest_hash : undefined;
  const skillId = skillIdOf(detail) || opts.skillId;
  const installPath = skillInstallPath(loreHome, projectId, skillName);

  const status = inspectLocalWorkCopy(loreHome, projectId, skillName, {
    skill_id: skillId,
    version: serverVersion,
    revision_hash: serverRevision,
    manifest_hash: serverManifest,
  });

  if (status.state === 'unmanaged') {
    const err = new Error(status.message || `unmanaged path blocks skill mirror: ${installPath}`);
    err.code = 'UNMANAGED_CONFLICT';
    throw err;
  }
  if (status.state === 'invalid') {
    const err = new Error(status.message || `invalid local mirror: ${installPath}`);
    err.code = 'INVALID_WORK_COPY';
    throw err;
  }

  let downloaded = false;
  let skillDir = installPath;
  let activeMarker = null;

  if (status.state === 'ready' && status.path) {
    // Inspect verified identity/version/integrity. Legacy same-version mirrors migrate.
    const marker = readWorkCopyMarker(status.path);
    if (!marker) {
      const err = new Error(`invalid local mirror marker: ${status.path}`);
      err.code = 'INVALID_WORK_COPY';
      throw err;
    }
    if (marker.schema === LEGACY_MIRROR_SCHEMA) {
      // Same version legacy → rematerialize to managed_files workcopy.
      const result = materializeSkillWorkCopy({ loreHome, projectId, detail });
      skillDir = result.installPath;
      activeMarker = result.marker;
      downloaded = true;
    } else if (marker.schema === LORE_SKILL_SCHEMA) {
      skillDir = status.path;
      activeMarker = marker;
      downloaded = false;
    } else {
      const err = new Error(`unsupported local mirror schema: ${marker.schema}`);
      err.code = 'INVALID_WORK_COPY';
      throw err;
    }
  } else {
    // missing, outdated, or tampered → rematerialize from server state (extras preserved).
    const result = materializeSkillWorkCopy({ loreHome, projectId, detail });
    skillDir = result.installPath;
    activeMarker = result.marker;
    downloaded = true;
  }

  if (!activeMarker) {
    throw new Error('failed to materialize skill mirror');
  }

  // Final identity check after materialize/return path.
  if (activeMarker.project_id !== projectId || activeMarker.skill_id !== skillId || activeMarker.name !== skillName) {
    throw new Error(
      `mirror identity mismatch after ensure: project=${activeMarker.project_id} skill=${activeMarker.skill_id} name=${activeMarker.name}`,
    );
  }

  const skillMdPath = path.join(skillDir, SKILL_MD);
  const skillMdStat = lstatOrNull(skillMdPath);
  if (!skillMdStat || skillMdStat.isSymbolicLink() || !skillMdStat.isFile()) {
    throw new Error(`SKILL.md missing or not a regular file in mirror: ${skillDir}`);
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
  return listDirectoryNames(projectWorkCopyRoot(loreHome, projectId)).map((name) =>
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
