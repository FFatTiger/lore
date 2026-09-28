/**
 * Lore Skill work-copy core type declarations.
 * Schema: lore.skill.workcopy.v1
 */

export const LORE_SKILL_MARKER: '.lore-skill-marker.json';
export const LEGACY_LORE_SKILL_MARKER: '.lore-skill.json';
export const LORE_SKILL_SCHEMA: 'lore.skill.workcopy.v1';
export const LEGACY_MIRROR_SCHEMA: 'lore.skill.mirror.v1';
export const SKILL_MD: 'SKILL.md';

export type WorkCopyState =
  | 'ready'
  | 'missing'
  | 'outdated'
  | 'tampered'
  | 'unmanaged'
  | 'invalid'
  | 'sync_error';

/** @deprecated Prefer WorkCopyState. */
export type MirrorState = WorkCopyState;

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

export interface WorkCopyMarker {
  schema: string;
  project_id: string;
  skill_id: string;
  name: string;
  version: string | number;
  /** Relative paths of the server-managed files owned by Core (ownership boundary). */
  managed_files: string[];
  synced_at: string;
  revision_hash?: string;
  manifest_hash?: string;
  /** Server-managed package files are read-only; the directory itself is writable for local outputs. */
  readonly?: boolean;
}

/** @deprecated Prefer WorkCopyMarker. */
export type MirrorMarker = WorkCopyMarker;

export interface WorkCopyStatus {
  name: string;
  skill_id?: string;
  state: WorkCopyState;
  path?: string;
  version?: string | number;
  revision_hash?: string;
  message?: string;
}

/** @deprecated Prefer WorkCopyStatus. */
export type MirrorStatus = WorkCopyStatus;

export interface SkillCatalog {
  project_id: string;
  catalog_revision: string;
}

export function resolveLoreHome(env?: NodeJS.ProcessEnv): string;
export function workCopiesRoot(loreHome: string): string;
export function projectWorkCopyRoot(loreHome: string, projectId: string): string;
/** @deprecated Prefer projectWorkCopyRoot. */
export function skillsRoot(loreHome: string, projectId: string): string;
/** @deprecated Prefer projectWorkCopyRoot. */
export function installedRoot(loreHome: string, projectId: string): string;
export function stagingRoot(loreHome: string, projectId: string): string;
export function skillInstallPath(loreHome: string, projectId: string, skillName: string): string;
export function sanitizeSegment(value: string): string;
export function validateSafeRelativePath(rawPath: string): string;

export function skillIdOf(
  value: SkillSummary | SkillCandidate | SkillDetail | null | undefined,
): string;
export function skillVersionOf(
  value: SkillSummary | SkillCandidate | SkillDetail | null | undefined,
): string | number | undefined;
export function skillRevisionOf(
  value: SkillSummary | SkillCandidate | SkillDetail | null | undefined,
): string;

export function validateManagedFileList(
  rawPaths: unknown,
  opts?: { requireSkillMd?: boolean },
): string[];

export function normalizeSkillSummary(value: any): SkillSummary;
export function normalizeSkillDetail(value: any): SkillDetail;
export function normalizeSkillCandidate(value: any): SkillCandidate;

export function sha256Buffer(buf: Buffer): string;
export function sha256Text(text: string): string;
export function decodeSkillFileContent(file: SkillFile): Buffer;
export function computeManifestHash(
  files: Array<{ path: string; sha256: string; size?: number }>,
): string;

/**
 * Hash ONLY the server-managed files listed in the work-copy marker.
 * Extra local files are never hashed, so they cannot trigger tamper.
 * Throws when a managed file is missing or is not a regular file.
 */
export function hashLocalSkillFiles(dir: string): {
  files: Array<{ path: string; sha256: string; size: number }>;
  manifest_hash: string;
};

export function readWorkCopyMarker(dir: string): WorkCopyMarker | null;
/** @deprecated Prefer readWorkCopyMarker. */
export const readMirrorMarker: typeof readWorkCopyMarker;

/**
 * Inspect a local work copy. Returns 'tampered' only when a server-managed file
 * (from marker.managed_files) is missing, is not a regular file, or its hash does not
 * match the marker manifest_hash. Extra local files never trigger tamper.
 */
export function inspectLocalWorkCopy(
  loreHome: string,
  projectId: string,
  skillName: string,
  expected?: {
    skill_id?: string;
    version?: string | number;
    revision_hash?: string;
    manifest_hash?: string;
  },
): WorkCopyStatus;
/** @deprecated Prefer inspectLocalWorkCopy. */
export const inspectLocalMirror: typeof inspectLocalWorkCopy;

export function validateSkillPayload(detail: SkillDetail): {
  files: Array<{ path: string; buffer: Buffer; sha256: string; media_type?: string }>;
  manifest_hash: string;
};

/**
 * Materialize (or upgrade/migrate) a local work copy from server detail.
 * Existing managed work copies are seeded so extra local files are preserved;
 * obsolete managed files are removed and incoming managed files written. A new
 * managed path that conflicts with a preserved local artifact fails safely.
 * Installed directories are writable (0755 POSIX); server-managed files and the
 * marker are 0444.
 */
export function materializeSkillWorkCopy(opts: {
  loreHome: string;
  projectId: string;
  detail: SkillDetail;
}): { installPath: string; marker: WorkCopyMarker };

/** @deprecated Prefer materializeSkillWorkCopy. */
export function writeSkillMirrorAtomic(opts: {
  loreHome: string;
  projectId: string;
  detail: SkillDetail;
  fileMode?: number;
  dirMode?: number;
}): { installPath: string; marker: WorkCopyMarker };

/**
 * Ensure a local work copy for the skill and return local SKILL.md + absolute skill_dir.
 * Missing/outdated/tampered/legacy copies are rematerialized from server detail
 * (preserving extra local files). Same version with intact managed files reuses the
 * local copy. Installed directories are writable; server-managed files are read-only.
 */
export function ensureSkillWorkCopy(opts: {
  loreHome?: string;
  skillId: string;
  projectId?: string;
  loadSkill: (skillId: string) => Promise<SkillDetail>;
  loadCatalog?: () => Promise<SkillCatalog>;
}): Promise<{
  skill_dir: string;
  skill_md: string;
  skill_md_path: string;
  marker: WorkCopyMarker;
  project_id: string;
  skill: SkillDetail;
  server_version: string | number | undefined;
  local_version: string | number;
  downloaded: boolean;
}>;

export function listLocalWorkCopyStatuses(loreHome: string, projectId: string): WorkCopyStatus[];
export function listAllLocalWorkCopyStatuses(loreHome: string): Array<WorkCopyStatus & { project_id: string }>;
/** @deprecated Prefer listLocalWorkCopyStatuses. */
export const listLocalMirrorStatuses: typeof listLocalWorkCopyStatuses;
