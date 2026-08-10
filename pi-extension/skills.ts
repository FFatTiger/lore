import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fetchJson, textResult } from './api';

export const LORE_SKILL_MARKER = '.lore-skill.json';
export const LORE_SKILL_SCHEMA = 'lore.skill.mirror.v1';
export const SKILL_MD = 'SKILL.md';

export type MirrorState =
  | 'ready'
  | 'missing'
  | 'outdated'
  | 'tampered'
  | 'unmanaged'
  | 'invalid'
  | 'sync_error';

export interface SkillSummary {
  project_id?: string;
  id: string;
  skill_id?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  version?: string | number;
  expected_version?: string | number;
  revision_hash?: string;
  expected_revision_hash?: string;
  manifest_hash?: string;
  [key: string]: unknown;
}

export interface SkillFile {
  path: string;
  media_type?: string;
  size?: number;
  size_bytes?: number;
  sha256?: string;
  content_sha256?: string;
  content?: string;
  content_base64?: string;
}

export interface SkillDetail extends SkillSummary {
  files?: SkillFile[];
}

export interface SkillCatalog {
  project_id: string;
  catalog_revision: string;
}

export interface SkillCandidate {
  id?: string;
  skill_id?: string;
  name?: string;
  description?: string;
  version?: string | number;
  expected_version?: string | number;
  revision_hash?: string;
  expected_revision_hash?: string;
  manifest_hash?: string;
  [key: string]: unknown;
}

export interface MirrorMarker {
  schema: string;
  project_id: string;
  skill_id: string;
  name: string;
  version: string | number;
  revision_hash: string;
  manifest_hash: string;
  synced_at: string;
}

export interface MirrorStatus {
  name: string;
  skill_id?: string;
  state: MirrorState;
  path?: string;
  version?: string | number;
  revision_hash?: string;
  message?: string;
}

export interface SyncResult {
  ok: boolean;
  project_id?: string;
  catalog_revision?: string;
  installed: string[];
  removed: string[];
  conflicts: string[];
  errors: Array<{ name?: string; skill_id?: string; error: string }>;
  states: MirrorStatus[];
}

export interface SkillsClientState {
  projectId?: string;
  catalogRevision?: string;
  lastSync?: SyncResult;
  lastError?: string;
}

const DEFAULT_FILE_MODE = 0o444;
const DEFAULT_DIR_MODE = 0o555;
const ARTIFACT_DIR_MODE = 0o755;
const ARTIFACT_FILE_MODE = 0o644;

// ---- path / home helpers ----

export function resolveLoreHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = typeof env.LORE_HOME === 'string' ? env.LORE_HOME.trim() : '';
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), '.lore');
}

export function skillsRoot(loreHome: string, projectId: string): string {
  return path.join(loreHome, 'skills', sanitizeSegment(projectId));
}

export function installedRoot(loreHome: string, projectId: string): string {
  return path.join(skillsRoot(loreHome, projectId), 'installed');
}

export function stagingRoot(loreHome: string, projectId: string): string {
  return path.join(skillsRoot(loreHome, projectId), '.staging');
}

export function skillInstallPath(loreHome: string, projectId: string, skillName: string): string {
  return path.join(installedRoot(loreHome, projectId), sanitizeSegment(skillName));
}

export function skillArtifactsRoot(loreHome: string, projectId: string, skillName: string): string {
  return path.join(loreHome, 'skill-artifacts', sanitizeSegment(projectId), sanitizeSegment(skillName));
}

export function sanitizeSegment(value: string): string {
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
export function validateSafeRelativePath(rawPath: string): string {
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

export function skillIdOf(value: SkillSummary | SkillCandidate | SkillDetail | null | undefined): string {
  return String(value?.skill_id || value?.id || '').trim();
}

export function skillVersionOf(value: SkillSummary | SkillCandidate | SkillDetail | null | undefined): string | number | undefined {
  return value?.expected_version ?? value?.version;
}

export function skillRevisionOf(value: SkillSummary | SkillCandidate | SkillDetail | null | undefined): string {
  return String(value?.expected_revision_hash || value?.revision_hash || '').trim();
}

function normalizeSkillFile(file: SkillFile): SkillFile {
  return {
    ...file,
    size: Number.isFinite(file.size_bytes) ? Number(file.size_bytes) : file.size,
    sha256: String(file.content_sha256 || file.sha256 || '').trim() || undefined,
  };
}

export function normalizeSkillSummary(value: any): SkillSummary {
  return {
    ...value,
    id: skillIdOf(value),
    version: skillVersionOf(value),
    revision_hash: skillRevisionOf(value),
    manifest_hash: typeof value?.manifest_hash === 'string' ? value.manifest_hash : undefined,
  };
}

export function normalizeSkillDetail(value: any): SkillDetail {
  return {
    ...normalizeSkillSummary(value),
    files: Array.isArray(value?.files) ? value.files.map(normalizeSkillFile) : [],
  };
}

export function normalizeSkillCandidate(value: any): SkillCandidate {
  return {
    ...value,
    id: skillIdOf(value),
    version: skillVersionOf(value),
    revision_hash: skillRevisionOf(value),
    manifest_hash: typeof value?.manifest_hash === 'string' ? value.manifest_hash : undefined,
  };
}

export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256Text(text: string): string {
  return sha256Buffer(Buffer.from(text, 'utf-8'));
}

export function decodeSkillFileContent(file: SkillFile): Buffer {
  if (typeof file.content_base64 === 'string') {
    return Buffer.from(file.content_base64, 'base64');
  }
  if (typeof file.content === 'string') {
    return Buffer.from(file.content, 'utf-8');
  }
  throw new Error(`skill file missing content: ${file.path || '(unknown)'}`);
}

export function computeManifestHash(files: Array<{ path: string; sha256: string; size?: number }>): string {
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

// ---- marker / local mirror inspection ----

export function readMirrorMarker(dir: string): MirrorMarker | null {
  const markerPath = path.join(dir, LORE_SKILL_MARKER);
  try {
    const raw = fs.readFileSync(markerPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (typeof data.schema !== 'string') return null;
    if (typeof data.project_id !== 'string') return null;
    if (typeof data.skill_id !== 'string') return null;
    if (typeof data.name !== 'string') return null;
    if (typeof data.revision_hash !== 'string') return null;
    if (typeof data.manifest_hash !== 'string') return null;
    return data as MirrorMarker;
  } catch {
    return null;
  }
}

function listDirectoryNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function pathExists(target: string): boolean {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function collectRelativeFiles(root: string, current = root, out: string[] = []): string[] {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === LORE_SKILL_MARKER) continue;
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in managed skill mirrors: ${path.relative(root, full)}`);
    }
    if (entry.isDirectory()) {
      collectRelativeFiles(root, full, out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    } else {
      throw new Error(`unsupported filesystem entry in managed skill mirror: ${path.relative(root, full)}`);
    }
  }
  return out;
}

export function hashLocalSkillFiles(dir: string): { files: Array<{ path: string; sha256: string; size: number }>; manifest_hash: string } {
  const relPaths = collectRelativeFiles(dir).sort();
  const files = relPaths.map((rel) => {
    const buf = fs.readFileSync(path.join(dir, ...rel.split('/')));
    return { path: rel, sha256: sha256Buffer(buf), size: buf.length };
  });
  return { files, manifest_hash: computeManifestHash(files) };
}

export function inspectLocalMirror(
  loreHome: string,
  projectId: string,
  skillName: string,
  expected?: { skill_id?: string; revision_hash?: string; version?: string | number; manifest_hash?: string },
): MirrorStatus {
  const dir = skillInstallPath(loreHome, projectId, skillName);
  if (!pathExists(dir)) {
    return { name: skillName, skill_id: expected?.skill_id, state: 'missing', message: 'mirror not installed' };
  }
  if (!isDirectory(dir)) {
    return { name: skillName, skill_id: expected?.skill_id, state: 'invalid', path: dir, message: 'install path is not a directory' };
  }

  const marker = readMirrorMarker(dir);
  if (!marker) {
    return {
      name: skillName,
      state: 'unmanaged',
      path: dir,
      message: 'directory exists without .lore-skill.json; left untouched',
    };
  }

  if (marker.schema !== LORE_SKILL_SCHEMA) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'invalid',
      path: dir,
      version: marker.version,
      revision_hash: marker.revision_hash,
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
      revision_hash: marker.revision_hash,
      message: 'mirror marker identity does not match its managed path',
    };
  }

  const skillMd = path.join(dir, SKILL_MD);
  if (!pathExists(skillMd)) {
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

  let localHash: string;
  try {
    localHash = hashLocalSkillFiles(dir).manifest_hash;
  } catch (error: any) {
    return {
      name: skillName,
      skill_id: marker.skill_id,
      state: 'invalid',
      path: dir,
      version: marker.version,
      revision_hash: marker.revision_hash,
      message: error?.message || 'failed to hash local files',
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
      message: 'local file hashes do not match marker manifest_hash',
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

// ---- install / atomic replace ----

function chmodTree(root: string, fileMode: number, dirMode: number) {
  if (process.platform === 'win32') return;
  const walk = (current: string) => {
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      fs.chmodSync(current, dirMode);
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
    } else if (st.isFile()) {
      fs.chmodSync(current, fileMode);
    }
  };
  walk(root);
}

function makeTreeWritable(root: string) {
  if (!pathExists(root)) return;
  const walk = (current: string) => {
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink()) return;
      if (st.isDirectory()) {
        try { fs.chmodSync(current, 0o755); } catch { /* ignore */ }
        for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
      } else if (st.isFile()) {
        try { fs.chmodSync(current, 0o644); } catch { /* ignore */ }
      }
    } catch {
      // ignore unreadable nodes
    }
  };
  walk(root);
}

function rmrf(target: string) {
  // Installed/staging trees are intentionally mode 0555/0444; restore write bits first.
  makeTreeWritable(target);
  fs.rmSync(target, { recursive: true, force: true });
}

function ensureDir(dir: string, mode = 0o755) {
  fs.mkdirSync(dir, { recursive: true, mode });
}

export function validateSkillPayload(detail: SkillDetail): {
  files: Array<{ path: string; buffer: Buffer; sha256: string; media_type?: string }>;
  manifest_hash: string;
} {
  const name = String(detail.name || '').trim();
  if (!name) throw new Error('skill detail missing name');
  const skillId = skillIdOf(detail);
  if (!skillId) throw new Error('skill detail missing skill_id');
  const revision = skillRevisionOf(detail);
  if (!revision) throw new Error('skill detail missing expected_revision_hash');

  const rawFiles = Array.isArray(detail.files) ? detail.files : [];
  if (rawFiles.length === 0) throw new Error('skill detail has no files');

  const files: Array<{ path: string; buffer: Buffer; sha256: string; media_type?: string }> = [];
  const seenPaths = new Set<string>();
  let hasSkillMd = false;
  for (const file of rawFiles) {
    const rel = validateSafeRelativePath(String(file.path || ''));
    if (seenPaths.has(rel)) throw new Error(`duplicate skill file path: ${rel}`);
    seenPaths.add(rel);
    if (rel === SKILL_MD) hasSkillMd = true;
    if (rel === LORE_SKILL_MARKER) {
      throw new Error(`${LORE_SKILL_MARKER} may not be supplied as a skill file`);
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

export function writeSkillMirrorAtomic(opts: {
  loreHome: string;
  projectId: string;
  detail: SkillDetail;
  fileMode?: number;
  dirMode?: number;
}): { installPath: string; marker: MirrorMarker } {
  const { loreHome, projectId, detail } = opts;
  const fileMode = opts.fileMode ?? DEFAULT_FILE_MODE;
  const dirMode = opts.dirMode ?? DEFAULT_DIR_MODE;
  const skillName = sanitizeSegment(String(detail.name || ''));
  const { files, manifest_hash } = validateSkillPayload(detail);

  const installPath = skillInstallPath(loreHome, projectId, skillName);
  if (pathExists(installPath) && isDirectory(installPath) && !readMirrorMarker(installPath)) {
    const err: any = new Error(`unmanaged local directory blocks install: ${installPath}`);
    err.code = 'UNMANAGED_CONFLICT';
    throw err;
  }

  const stagingBase = stagingRoot(loreHome, projectId);
  ensureDir(stagingBase, 0o755);
  const stageId = `${skillName}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const stagePath = path.join(stagingBase, stageId);
  const finalStage = path.join(stagingBase, `${stageId}.final`);

  try {
    ensureDir(stagePath, 0o755);
    for (const file of files) {
      const dest = path.join(stagePath, ...file.path.split('/'));
      ensureDir(path.dirname(dest), 0o755);
      // Write staging files writable; lock modes after the final atomic move.
      fs.writeFileSync(dest, file.buffer, { mode: 0o644 });
    }

    const marker: MirrorMarker = {
      schema: LORE_SKILL_SCHEMA,
      project_id: projectId,
      skill_id: skillIdOf(detail),
      name: skillName,
      version: skillVersionOf(detail) ?? '',
      revision_hash: skillRevisionOf(detail),
      manifest_hash,
      synced_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(stagePath, LORE_SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`, {
      mode: 0o644,
      encoding: 'utf-8',
    });

    // Atomic-ish replacement: rename stage to final name in staging, then swap into installed.
    // Keep the tree writable until after rename so POSIX rename/cleanup cannot EACCES.
    if (pathExists(finalStage)) rmrf(finalStage);
    fs.renameSync(stagePath, finalStage);

    const installedBase = installedRoot(loreHome, projectId);
    ensureDir(installedBase, 0o755);
    if (process.platform !== 'win32') {
      try { fs.chmodSync(installedBase, 0o755); } catch { /* ignore */ }
    }
    const backupPath = path.join(stagingBase, `${skillName}.backup-${Date.now()}`);
    if (pathExists(installPath)) {
      // Parent must stay writable; unlock the old tree before moving it aside.
      makeTreeWritable(installPath);
      fs.renameSync(installPath, backupPath);
    }
    try {
      fs.renameSync(finalStage, installPath);
    } catch (error) {
      // best-effort rollback
      if (pathExists(backupPath) && !pathExists(installPath)) {
        try { fs.renameSync(backupPath, installPath); } catch { /* ignore */ }
      }
      throw error;
    }
    if (pathExists(backupPath)) rmrf(backupPath);
    chmodTree(installPath, fileMode, dirMode);
    return { installPath, marker };
  } finally {
    if (pathExists(stagePath)) rmrf(stagePath);
    if (pathExists(finalStage)) rmrf(finalStage);
  }
}

export function removeManagedMirror(loreHome: string, projectId: string, skillName: string): { removed: boolean; conflict?: boolean } {
  const installPath = skillInstallPath(loreHome, projectId, skillName);
  if (!pathExists(installPath)) return { removed: false };
  if (!isDirectory(installPath)) return { removed: false };
  const marker = readMirrorMarker(installPath);
  if (!marker) return { removed: false, conflict: true };
  rmrf(installPath);
  return { removed: true };
}

// ---- API + reconcile ----

export async function listSkillsApi(pluginCfg: any, includeDisabled = true): Promise<{
  project_id: string;
  catalog_revision: string;
  skills: SkillSummary[];
}> {
  const qs = new URLSearchParams({ include_disabled: includeDisabled ? 'true' : 'false' });
  const data = await fetchJson(pluginCfg, `/skills?${qs.toString()}`, { method: 'GET' });
  return {
    project_id: String(data?.project_id || ''),
    catalog_revision: String(data?.catalog_revision || ''),
    skills: Array.isArray(data?.skills) ? data.skills.map(normalizeSkillSummary) : [],
  };
}

export async function getSkillApi(pluginCfg: any, skillId: string): Promise<SkillDetail> {
  const data = await fetchJson(pluginCfg, `/skills/${encodeURIComponent(skillId)}`, { method: 'GET' });
  return normalizeSkillDetail(data);
}

export async function searchSkillsApi(pluginCfg: any, query: string, limit?: number): Promise<any> {
  const qs = new URLSearchParams({ query: query || '' });
  if (Number.isFinite(limit)) qs.set('limit', String(limit));
  const data = await fetchJson(pluginCfg, `/skills/recall?${qs.toString()}`, { method: 'GET' });
  if (Array.isArray(data?.candidates)) {
    return { ...data, candidates: data.candidates.map(normalizeSkillCandidate) };
  }
  return data;
}

export async function createSkillApi(pluginCfg: any, body: Record<string, unknown>): Promise<any> {
  return fetchJson(pluginCfg, '/skills', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateSkillApi(pluginCfg: any, skillId: string, body: Record<string, unknown>): Promise<any> {
  return fetchJson(pluginCfg, `/skills/${encodeURIComponent(skillId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteSkillApi(pluginCfg: any, skillId: string): Promise<any> {
  return fetchJson(pluginCfg, `/skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' });
}

export async function installSkillFromDetail(
  loreHome: string,
  projectId: string,
  detail: SkillDetail,
): Promise<MirrorStatus> {
  try {
    const { installPath, marker } = writeSkillMirrorAtomic({ loreHome, projectId, detail });
    return {
      name: marker.name,
      skill_id: marker.skill_id,
      state: 'ready',
      path: installPath,
      version: marker.version,
      revision_hash: marker.revision_hash,
    };
  } catch (error: any) {
    if (error?.code === 'UNMANAGED_CONFLICT') {
      return {
        name: String(detail.name || ''),
        skill_id: skillIdOf(detail),
        state: 'unmanaged',
        path: skillInstallPath(loreHome, projectId, String(detail.name || '')),
        message: error.message,
      };
    }
    return {
      name: String(detail.name || ''),
      skill_id: skillIdOf(detail),
      state: 'sync_error',
      message: error?.message || String(error),
    };
  }
}

export async function reconcileSkills(opts: {
  pluginCfg: any;
  loreHome?: string;
  catalog?: SkillCatalog | null;
  ensureSkillIds?: string[];
  ensureSkills?: Array<{ id?: string; name?: string; revision_hash?: string; version?: string | number }>;
}): Promise<SyncResult> {
  const loreHome = opts.loreHome || resolveLoreHome();
  const result: SyncResult = {
    ok: true,
    installed: [],
    removed: [],
    conflicts: [],
    errors: [],
    states: [],
  };

  try {
    const catalog = await listSkillsApi(opts.pluginCfg, true);
    const projectId = opts.catalog?.project_id || catalog.project_id;
    const catalogRevision = opts.catalog?.catalog_revision || catalog.catalog_revision;
    result.project_id = projectId;
    result.catalog_revision = catalogRevision;
    if (!projectId) {
      result.ok = false;
      result.errors.push({ error: 'skills catalog missing project_id' });
      return result;
    }

    const enabled = catalog.skills.filter((s) => s && s.enabled !== false);
    const enabledByName = new Map<string, SkillSummary>();
    const enabledById = new Map<string, SkillSummary>();
    for (const skill of enabled) {
      const name = String(skill.name || '').trim();
      const id = skillIdOf(skill);
      if (name) enabledByName.set(name, skill);
      if (id) enabledById.set(id, skill);
    }

    // Ensure specific skills from candidates are considered even if catalog list lags.
    for (const ensure of opts.ensureSkills || []) {
      const id = String(ensure.id || '').trim();
      const name = String(ensure.name || '').trim();
      if (id && !enabledById.has(id)) {
        enabledById.set(id, {
          id,
          name: name || id,
          enabled: true,
          revision_hash: ensure.revision_hash,
          version: ensure.version,
        });
      }
    }
    for (const id of opts.ensureSkillIds || []) {
      const skillId = String(id || '').trim();
      if (skillId && !enabledById.has(skillId)) {
        enabledById.set(skillId, { id: skillId, name: skillId, enabled: true });
      }
    }

    const desired = new Map<string, SkillSummary>();
    for (const skill of enabledById.values()) {
      const name = String(skill.name || '').trim();
      if (name) desired.set(name, skill);
    }
    for (const [name, skill] of enabledByName) {
      if (!desired.has(name)) desired.set(name, skill);
    }

    // Remove managed mirrors that are no longer enabled / archived.
    for (const existing of listDirectoryNames(installedRoot(loreHome, projectId))) {
      if (desired.has(existing)) continue;
      const removal = removeManagedMirror(loreHome, projectId, existing);
      if (removal.conflict) {
        result.conflicts.push(existing);
        result.states.push({
          name: existing,
          state: 'unmanaged',
          path: skillInstallPath(loreHome, projectId, existing),
          message: 'unmanaged local directory preserved',
        });
      } else if (removal.removed) {
        result.removed.push(existing);
      }
    }

    // Install / repair / update desired skills.
    for (const [name, summary] of desired) {
      const expected = {
        skill_id: skillIdOf(summary),
        revision_hash: skillRevisionOf(summary) || undefined,
        version: skillVersionOf(summary),
        manifest_hash: typeof summary.manifest_hash === 'string' ? summary.manifest_hash : undefined,
      };
      const status = inspectLocalMirror(loreHome, projectId, name, expected);
      if (status.state === 'ready') {
        result.states.push(status);
        continue;
      }
      if (status.state === 'unmanaged') {
        result.conflicts.push(name);
        result.states.push(status);
        continue;
      }

      const skillId = skillIdOf(summary) || status.skill_id || '';
      if (!skillId) {
        result.ok = false;
        result.errors.push({ name, error: 'missing skill id for sync' });
        result.states.push({ ...status, state: 'sync_error', message: 'missing skill id' });
        continue;
      }

      try {
        const detail = await getSkillApi(opts.pluginCfg, skillId);
        // Prefer server name if present.
        if (!detail.name) detail.name = name;
        const installed = await installSkillFromDetail(loreHome, projectId, detail);
        result.states.push(installed);
        if (installed.state === 'ready') {
          result.installed.push(installed.name);
        } else if (installed.state === 'unmanaged') {
          result.conflicts.push(name);
        } else {
          result.ok = false;
          result.errors.push({ name, skill_id: skillId, error: installed.message || 'install failed' });
        }
      } catch (error: any) {
        result.ok = false;
        result.errors.push({ name, skill_id: skillId, error: error?.message || String(error) });
        result.states.push({
          name,
          skill_id: skillId,
          state: 'sync_error',
          message: error?.message || String(error),
        });
      }
    }

    return result;
  } catch (error: any) {
    result.ok = false;
    result.errors.push({ error: error?.message || String(error) });
    return result;
  }
}

export function listLocalMirrorStatuses(loreHome: string, projectId: string): MirrorStatus[] {
  if (!projectId) return [];
  return listDirectoryNames(installedRoot(loreHome, projectId)).map((name) => inspectLocalMirror(loreHome, projectId, name));
}

export function formatSkillCandidateBlock(candidates: Array<{
  name: string;
  version?: string | number;
  description?: string;
  skillMdPath: string;
}>): string {
  if (!candidates.length) return '';
  const lines = ['<lore-skills>'];
  lines.push('Matched Lore skills are available locally. Read only the listed SKILL.md paths progressively as needed.');
  for (const c of candidates) {
    const version = c.version === undefined || c.version === '' ? '' : ` v${c.version}`;
    const desc = c.description ? ` — ${String(c.description).replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`- ${c.name}${version}${desc}`);
    lines.push(`  SKILL.md: ${c.skillMdPath}`);
  }
  lines.push('</lore-skills>');
  return lines.join('\n');
}

export function appendSkillBlockToRecallMessage(message: any, skillBlock: string): any {
  const block = String(skillBlock || '').trim();
  if (!block) return message;

  if (!message || typeof message !== 'object') {
    return {
      customType: 'lore-recall',
      content: block,
      display: false,
      details: { source: 'lore-skills' },
    };
  }

  const existing = typeof message.content === 'string' ? message.content : '';
  const content = existing.trim() ? `${existing.trim()}\n\n${block}` : block;
  return {
    ...message,
    content,
    display: false,
    customType: message.customType || 'lore-recall',
  };
}

export function readyCandidateEntries(opts: {
  loreHome: string;
  projectId: string;
  candidates: SkillCandidate[];
}): Array<{ name: string; version?: string | number; description?: string; skillMdPath: string; revision_hash?: string }> {
  const out: Array<{ name: string; version?: string | number; description?: string; skillMdPath: string; revision_hash?: string }> = [];
  for (const candidate of opts.candidates || []) {
    const name = String(candidate.name || '').trim();
    const skillId = skillIdOf(candidate);
    const serverManifest = typeof candidate.manifest_hash === 'string' ? candidate.manifest_hash.trim() : '';
    if (!name || !skillId || !serverManifest) continue;
    const expected = {
      skill_id: skillId || undefined,
      revision_hash: skillRevisionOf(candidate) || undefined,
      version: skillVersionOf(candidate),
      manifest_hash: serverManifest,
    };
    const status = inspectLocalMirror(opts.loreHome, opts.projectId, name, expected);
    if (status.state !== 'ready' || !status.path) continue;
    out.push({
      name,
      version: status.version ?? skillVersionOf(candidate),
      description: typeof candidate.description === 'string' ? candidate.description : undefined,
      skillMdPath: path.join(status.path, SKILL_MD),
      revision_hash: status.revision_hash,
    });
  }
  return out;
}

export function createSkillArtifactDir(opts: {
  loreHome?: string;
  projectId: string;
  skillName: string;
  artifactId?: string;
}): { artifact_id: string; path: string; metadata_path: string } {
  const loreHome = opts.loreHome || resolveLoreHome();
  const projectId = sanitizeSegment(opts.projectId);
  const skillName = sanitizeSegment(opts.skillName);
  const artifactId = sanitizeSegment(opts.artifactId || crypto.randomBytes(8).toString('hex'));
  const dir = path.join(skillArtifactsRoot(loreHome, projectId, skillName), artifactId);
  // Guard: never place artifacts under installed mirrors.
  const installed = path.resolve(installedRoot(loreHome, projectId));
  if (path.resolve(dir) === installed || path.resolve(dir).startsWith(`${installed}${path.sep}`)) {
    throw new Error('artifact path must stay outside installed skill mirrors');
  }
  ensureDir(dir, ARTIFACT_DIR_MODE);
  const metadata = {
    schema: 'lore.skill.artifact.v1',
    project_id: projectId,
    skill_name: skillName,
    artifact_id: artifactId,
    created_at: new Date().toISOString(),
    path: dir,
  };
  const metadataPath = path.join(dir, '.lore-artifact.json');
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: ARTIFACT_FILE_MODE,
  });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, ARTIFACT_DIR_MODE); } catch { /* ignore */ }
  }
  return { artifact_id: artifactId, path: dir, metadata_path: metadataPath };
}

// ---- session-scoped skills client used by hooks ----

export function createSkillsSession(pluginCfg: any) {
  const state: SkillsClientState = {};
  const loreHome = () => (typeof pluginCfg?.loreHome === 'string' && pluginCfg.loreHome.trim()
    ? pluginCfg.loreHome.trim()
    : resolveLoreHome());

  async function syncFromCatalog(catalog?: SkillCatalog | null, ensure?: SkillCandidate[]): Promise<SyncResult> {
    const ensureSkills = (ensure || []).map((c) => ({
      id: skillIdOf(c),
      name: String(c.name || ''),
      revision_hash: skillRevisionOf(c) || undefined,
      version: skillVersionOf(c),
    }));
    const result = await reconcileSkills({
      pluginCfg,
      loreHome: loreHome(),
      catalog: catalog || (state.projectId ? { project_id: state.projectId, catalog_revision: state.catalogRevision || '' } : null),
      ensureSkills,
    });
    if (result.project_id) state.projectId = result.project_id;
    if (result.catalog_revision) state.catalogRevision = result.catalog_revision;
    state.lastSync = result;
    state.lastError = result.ok ? undefined : result.errors.map((e) => e.error).join('; ');
    return result;
  }

  async function onSessionStart(lifecycleResponse: any): Promise<void> {
    const catalog = readSkillCatalog(lifecycleResponse);
    if (!catalog?.project_id) return;
    state.projectId = catalog.project_id;
    state.catalogRevision = catalog.catalog_revision;
    try {
      await syncFromCatalog(catalog);
    } catch (error: any) {
      // fail open
      state.lastError = error?.message || String(error);
    }
  }

  async function onPromptLifecycle(lifecycleResponse: any): Promise<{ messagePatch?: any; skillBlock?: string }> {
    const catalog = readSkillCatalog(lifecycleResponse);
    const candidates = readSkillCandidates(lifecycleResponse);

    try {
      if (catalog?.project_id) {
        const revisionChanged = !state.catalogRevision || state.catalogRevision !== catalog.catalog_revision
          || state.projectId !== catalog.project_id;
        const needsCandidate = candidates.some((c) => {
          const name = String(c.name || '').trim();
          if (!name || !catalog.project_id) return false;
          const status = inspectLocalMirror(loreHome(), catalog.project_id, name, {
            skill_id: skillIdOf(c) || undefined,
            revision_hash: skillRevisionOf(c) || undefined,
          });
          return status.state !== 'ready';
        });
        if (revisionChanged || needsCandidate) {
          await syncFromCatalog(catalog, candidates);
        } else {
          state.projectId = catalog.project_id;
          state.catalogRevision = catalog.catalog_revision;
        }
      } else if (candidates.length > 0 && state.projectId) {
        await syncFromCatalog(
          { project_id: state.projectId, catalog_revision: state.catalogRevision || '' },
          candidates,
        );
      }
    } catch (error: any) {
      state.lastError = error?.message || String(error);
    }

    const projectId = catalog?.project_id || state.projectId;
    if (!projectId || candidates.length === 0) return {};

    const ready = readyCandidateEntries({
      loreHome: loreHome(),
      projectId,
      candidates,
    });
    const skillBlock = formatSkillCandidateBlock(ready);
    if (!skillBlock) return {};

    const hostMessage = lifecycleResponse?.host_output?.mode === 'return_value'
      ? lifecycleResponse.host_output?.value?.message
      : undefined;
    return {
      skillBlock,
      messagePatch: appendSkillBlockToRecallMessage(hostMessage, skillBlock),
    };
  }

  function getStatus(): { project_id?: string; catalog_revision?: string; mirrors: MirrorStatus[]; last_error?: string } {
    const projectId = state.projectId;
    return {
      project_id: projectId,
      catalog_revision: state.catalogRevision,
      mirrors: projectId ? listLocalMirrorStatuses(loreHome(), projectId) : [],
      last_error: state.lastError,
    };
  }

  return {
    state,
    loreHome,
    syncFromCatalog,
    onSessionStart,
    onPromptLifecycle,
    getStatus,
    reconcile: () => syncFromCatalog(
      state.projectId ? { project_id: state.projectId, catalog_revision: state.catalogRevision || '' } : null,
    ),
  };
}

export type SkillsSession = ReturnType<typeof createSkillsSession>;

export function readSkillCatalog(lifecycleResponse: any): SkillCatalog | null {
  const catalog = lifecycleResponse?.skill_catalog;
  if (!catalog || typeof catalog !== 'object') return null;
  const project_id = String(catalog.project_id || '').trim();
  if (!project_id) return null;
  return {
    project_id,
    catalog_revision: String(catalog.catalog_revision || ''),
  };
}

export function readSkillCandidates(lifecycleResponse: any): SkillCandidate[] {
  const raw = lifecycleResponse?.skill_candidates;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map(normalizeSkillCandidate);
}

// ---- tool registration ----

const Type = {
  String: (meta?: Record<string, unknown>) => ({ type: 'string', ...meta }),
  Number: (meta?: Record<string, unknown>) => ({ type: 'number', ...meta }),
  Boolean: (meta?: Record<string, unknown>) => ({ type: 'boolean', ...meta }),
  Array: (items: Record<string, unknown>) => ({ type: 'array', items }),
  Optional: (schema: Record<string, unknown>) => ({ ...schema }),
  Object: (properties: Record<string, unknown>, rest?: Record<string, unknown>) => ({
    type: 'object',
    properties,
    ...rest,
  }),
};

function skillFileParamSchema() {
  return Type.Object({
    path: Type.String({ description: 'Relative path inside the skill (must include SKILL.md).' }),
    content: Type.Optional(Type.String({ description: 'UTF-8 file content.' })),
    content_base64: Type.Optional(Type.String({ description: 'Base64 file content for binary files.' })),
    media_type: Type.Optional(Type.String({ description: 'Optional media type.' })),
  });
}

export function registerSkillTools(pi: any, pluginCfg: any, skillsSession?: SkillsSession) {
  const session = skillsSession || createSkillsSession(pluginCfg);
  const afterWrite = async () => {
    try {
      await session.reconcile();
    } catch {
      // fail open for local mirror
    }
  };

  pi.registerTool({
    name: 'lore_skill_list',
    label: 'Lore skill list',
    description: 'List Lore skills for the active project, including disabled skills when requested.',
    parameters: Type.Object({
      include_disabled: Type.Optional(Type.Boolean({ description: 'Include disabled skills (default true).' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const includeDisabled = params?.include_disabled !== false;
        const data = await listSkillsApi(pluginCfg, includeDisabled);
        if (data.project_id) session.state.projectId = data.project_id;
        if (data.catalog_revision) session.state.catalogRevision = data.catalog_revision;
        const lines = (data.skills || []).map((s) => {
          const enabled = s.enabled === false ? 'disabled' : 'enabled';
          return `- ${s.name} (${skillIdOf(s)}) ${enabled} v${skillVersionOf(s) ?? '?'} rev=${skillRevisionOf(s) || '?'}`;
        });
        const text = lines.length > 0
          ? `Project ${data.project_id} rev ${data.catalog_revision}\n${lines.join('\n')}`
          : `Project ${data.project_id || '?'} rev ${data.catalog_revision || '?'}\nNo skills.`;
        return textResult(text, { ok: true, ...data });
      } catch (error: any) {
        return textResult(`Lore skill list failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_search',
    label: 'Lore skill search',
    description: 'Search or recall Lore skills by query.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query.' }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: 'Max candidates.' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const query = String(params?.query || '');
        const limit = Number.isFinite(params?.limit) ? params.limit : undefined;
        const data = await searchSkillsApi(pluginCfg, query, limit);
        return textResult(JSON.stringify(data, null, 2), { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill search failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_get',
    label: 'Lore skill get',
    description: 'Fetch full Lore skill detail, including files.',
    parameters: Type.Object({
      id: Type.String({ description: 'Skill id.' }),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const id = String(params?.id || '').trim();
        if (!id) throw new Error('id is required');
        const data = await getSkillApi(pluginCfg, id);
        return textResult(JSON.stringify(data, null, 2), { ok: true, skill: data });
      } catch (error: any) {
        return textResult(`Lore skill get failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_create',
    label: 'Lore skill create',
    description: 'Create a Lore skill on the server, then reconcile the local managed mirror.',
    parameters: Type.Object({
      name: Type.String({ description: 'Skill name.' }),
      enabled: Type.Optional(Type.Boolean({ description: 'Whether the skill is enabled (default true).' })),
      files: Type.Array(skillFileParamSchema(), { description: 'Skill files; must include SKILL.md.' }),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      const body = {
        name: String(params?.name || '').trim(),
        enabled: params?.enabled !== false,
        files: Array.isArray(params?.files) ? params.files : [],
      };
      try {
        if (!body.name) throw new Error('name is required');
        const data = normalizeSkillDetail(await createSkillApi(pluginCfg, body));
        if (data?.project_id && !session.state.projectId) {
          session.state.projectId = String(data.project_id);
        }
        try {
          const catalog = await listSkillsApi(pluginCfg, true);
          if (catalog.project_id) session.state.projectId = catalog.project_id;
          if (catalog.catalog_revision) session.state.catalogRevision = catalog.catalog_revision;
        } catch {
          // server mutation already succeeded; mirror reconciliation remains fail-open
        }
        await afterWrite();
        return textResult(`Created skill ${data?.name || body.name} (${skillIdOf(data) || '?'})`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill create failed: ${error.message}`, { ok: false, error: error.message, body });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_update',
    label: 'Lore skill update',
    description: 'Update a Lore skill on the server with optimistic concurrency, then reconcile the local managed mirror.',
    parameters: Type.Object({
      id: Type.String({ description: 'Skill id.' }),
      expected_revision_hash: Type.String({ description: 'Expected current revision hash.' }),
      enabled: Type.Optional(Type.Boolean({ description: 'Enable or disable the skill.' })),
      upsert_files: Type.Optional(Type.Array(skillFileParamSchema(), { description: 'Files to create or replace.' })),
      delete_paths: Type.Optional(Type.Array(Type.String({ description: 'Relative path to delete.' }), { description: 'Paths to delete.' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      const id = String(params?.id || '').trim();
      const body: Record<string, unknown> = {
        expected_revision_hash: String(params?.expected_revision_hash || ''),
      };
      if (typeof params?.enabled === 'boolean') body.enabled = params.enabled;
      if (Array.isArray(params?.upsert_files)) body.upsert_files = params.upsert_files;
      if (Array.isArray(params?.delete_paths)) body.delete_paths = params.delete_paths;
      try {
        if (!id) throw new Error('id is required');
        if (!body.expected_revision_hash) throw new Error('expected_revision_hash is required');
        const data = normalizeSkillDetail(await updateSkillApi(pluginCfg, id, body));
        try {
          const catalog = await listSkillsApi(pluginCfg, true);
          if (catalog.project_id) session.state.projectId = catalog.project_id;
          if (catalog.catalog_revision) session.state.catalogRevision = catalog.catalog_revision;
        } catch {
          // server mutation already succeeded; mirror reconciliation remains fail-open
        }
        await afterWrite();
        return textResult(`Updated skill ${data?.name || id}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill update failed: ${error.message}`, { ok: false, error: error.message, id, body });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_delete',
    label: 'Lore skill delete',
    description: 'Archive/delete a Lore skill on the server, then reconcile the local managed mirror.',
    parameters: Type.Object({
      id: Type.String({ description: 'Skill id.' }),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const id = String(params?.id || '').trim();
        if (!id) throw new Error('id is required');
        const data = await deleteSkillApi(pluginCfg, id);
        if (data?.project_id) session.state.projectId = String(data.project_id);
        if (data?.catalog_revision !== undefined) session.state.catalogRevision = String(data.catalog_revision);
        await afterWrite();
        return textResult(`Deleted skill ${id}`, { ok: true, result: data });
      } catch (error: any) {
        return textResult(`Lore skill delete failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_status',
    label: 'Lore skill status',
    description: 'Report local managed skill mirror states (ready/missing/outdated/tampered/unmanaged/invalid/sync_error).',
    parameters: Type.Object({
      reconcile: Type.Optional(Type.Boolean({ description: 'If true, reconcile from server before reporting.' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        if (params?.reconcile === true) {
          await session.reconcile();
        }
        let status = session.getStatus();
        if (!status.project_id) {
          try {
            const catalog = await listSkillsApi(pluginCfg, true);
            if (catalog.project_id) {
              session.state.projectId = catalog.project_id;
              session.state.catalogRevision = catalog.catalog_revision;
              status = session.getStatus();
            }
          } catch {
            // keep local-only status
          }
        }
        const lines = status.mirrors.map((m) => {
          const rev = m.revision_hash ? ` rev=${m.revision_hash}` : '';
          const msg = m.message ? ` — ${m.message}` : '';
          return `- ${m.name}: ${m.state}${rev}${msg}`;
        });
        const header = `project=${status.project_id || '?'} catalog_revision=${status.catalog_revision || '?'}`;
        const text = [header, ...(lines.length ? lines : ['(no local mirrors)']), status.last_error ? `last_error: ${status.last_error}` : '']
          .filter(Boolean)
          .join('\n');
        return textResult(text, { ok: true, ...status });
      } catch (error: any) {
        return textResult(`Lore skill status failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  pi.registerTool({
    name: 'lore_skill_artifact_create',
    label: 'Lore skill artifact create',
    description: 'Create a local writable skill artifact directory. Never uploads to the server.',
    parameters: Type.Object({
      skill_name: Type.String({ description: 'Skill name for organizing artifacts.' }),
      project_id: Type.Optional(Type.String({ description: 'Project id; defaults to last known project.' })),
      artifact_id: Type.Optional(Type.String({ description: 'Optional artifact id; generated when omitted.' })),
    }),
    async execute(_toolCallId: string, params: any = {}) {
      try {
        const skillName = String(params?.skill_name || '').trim();
        if (!skillName) throw new Error('skill_name is required');
        let projectId = String(params?.project_id || session.state.projectId || '').trim();
        if (!projectId) {
          const catalog = await listSkillsApi(pluginCfg, true);
          projectId = catalog.project_id;
          if (catalog.project_id) {
            session.state.projectId = catalog.project_id;
            session.state.catalogRevision = catalog.catalog_revision;
          }
        }
        if (!projectId) throw new Error('project_id is required');
        const artifact = createSkillArtifactDir({
          loreHome: session.loreHome(),
          projectId,
          skillName,
          artifactId: typeof params?.artifact_id === 'string' ? params.artifact_id : undefined,
        });
        return textResult(
          `Artifact directory ready (local only, not uploaded):\n${artifact.path}`,
          { ok: true, ...artifact, project_id: projectId, skill_name: skillName },
        );
      } catch (error: any) {
        return textResult(`Lore skill artifact create failed: ${error.message}`, { ok: false, error: error.message });
      }
    },
  });

  return session;
}
