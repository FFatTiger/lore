import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MAX_SKILL_FILES = 256;
export const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024;

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_FILES = new Set(['.DS_Store']);

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

export type SkillFilePayload = {
  path: string;
  content?: string;
  content_base64?: string;
  media_type?: string;
};

export type SkillSource = {
  type: 'github' | 'local';
  repo?: string;
  url?: string;
  path?: string;
  ref?: string;
  folder_hash?: string;
  imported_from?: string;
  imported_at: string;
};

export type SkillPackage = {
  name: string;
  enabled: true;
  files: SkillFilePayload[];
  source: SkillSource;
  symlinks: string[];
};

export type SkillSkip = {
  name: string;
  reason: string;
};

export type ScannedSkill =
  | { kind: 'import'; skill: SkillPackage }
  | { kind: 'skip'; skip: SkillSkip };

const NAME_RE = /^[a-z0-9-]{1,64}$/;

export function defaultSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME?.trim() || os.homedir();
  return path.join(home, '.agents', 'skills');
}

export function isValidSkillName(name: string): boolean {
  return NAME_RE.test(name);
}

function mediaTypeFor(filePath: string): string | undefined {
  return MEDIA_TYPES[path.extname(filePath).toLowerCase()];
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  return sample.includes(0);
}

type LockEntry = {
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  skillPath?: string;
  skillFolderHash?: string;
  ref?: string;
};

async function readLock(skillsDir: string): Promise<Record<string, LockEntry>> {
  const lockPath = path.join(skillsDir, '..', '.skill-lock.json');
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const data = JSON.parse(raw) as { skills?: Record<string, LockEntry> };
    return data && typeof data === 'object' && data.skills && typeof data.skills === 'object'
      ? data.skills
      : {};
  } catch {
    return {};
  }
}

function sourceFor(name: string, realDir: string, lock: Record<string, LockEntry>, importedAt: string): SkillSource {
  const entry = lock[name];
  if (entry && (entry.sourceType === 'github' || entry.source || entry.sourceUrl)) {
    const source: SkillSource = { type: 'github', imported_at: importedAt };
    if (entry.source) source.repo = entry.source;
    if (entry.sourceUrl) source.url = entry.sourceUrl;
    if (entry.skillPath) source.path = entry.skillPath;
    if (entry.ref) source.ref = entry.ref;
    if (entry.skillFolderHash) source.folder_hash = entry.skillFolderHash;
    if (Buffer.byteLength(JSON.stringify(source)) <= 4096) return source;
  }
  return { type: 'local', imported_from: realDir, imported_at: importedAt };
}

async function collectFiles(root: string): Promise<{ files: string[]; symlinks: string[] }> {
  const files: string[] = [];
  const symlinks: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_FILES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        symlinks.push(rel);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile()) files.push(rel);
    }
  }

  await walk(root);
  return { files, symlinks };
}

async function buildPackage(
  name: string,
  realDir: string,
  lock: Record<string, LockEntry>,
  importedAt: string,
): Promise<ScannedSkill> {
  const skillMd = path.join(realDir, 'SKILL.md');
  let text: string;
  try {
    text = await fs.readFile(skillMd, 'utf8');
  } catch {
    return { kind: 'skip', skip: { name, reason: 'missing SKILL.md' } };
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const nameLine = match?.[1]?.split(/\r?\n/).find((line) => /^name\s*:/.test(line));
  const declared = nameLine?.replace(/^name\s*:\s*/, '').trim().replace(/^["']|["']$/g, '');
  if (!declared || declared !== name) {
    return {
      kind: 'skip',
      skip: { name, reason: `SKILL.md name ${declared ? `"${declared}" ` : ''}does not match directory "${name}"` },
    };
  }
  if (!isValidSkillName(name)) {
    return { kind: 'skip', skip: { name, reason: `invalid skill name "${name}"` } };
  }

  const { files, symlinks } = await collectFiles(realDir);
  if (files.length > MAX_SKILL_FILES) {
    return {
      kind: 'skip',
      skip: { name, reason: `${files.length} files exceeds the ${MAX_SKILL_FILES} file limit` },
    };
  }

  const payload: SkillFilePayload[] = [];
  for (const rel of files) {
    const buf = await fs.readFile(path.join(realDir, rel));
    if (buf.length > MAX_SKILL_FILE_BYTES) {
      return {
        kind: 'skip',
        skip: { name, reason: `${rel} exceeds the 5 MiB file limit` },
      };
    }
    if (looksBinary(buf)) {
      const file: SkillFilePayload = { path: rel, content_base64: buf.toString('base64') };
      const media = mediaTypeFor(rel);
      if (media) file.media_type = media;
      payload.push(file);
    } else {
      payload.push({ path: rel, content: buf.toString('utf8') });
    }
  }

  return {
    kind: 'import',
    skill: {
      name,
      enabled: true,
      files: payload,
      source: sourceFor(name, realDir, lock, importedAt),
      symlinks,
    },
  };
}

/** Read-only scan. Never creates, moves, or deletes anything under dir. */
export async function scanSkillsDir(dir: string, importedAt = new Date().toISOString()): Promise<ScannedSkill[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const lock = await readLock(dir);
  const out: ScannedSkill[] = [];

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(abs);
        if (!stat.isDirectory()) continue;
      } catch {
        out.push({ kind: 'skip', skip: { name: entry.name, reason: 'broken symlink' } });
        continue;
      }
    } else if (!entry.isDirectory()) {
      continue;
    }

    let realDir: string;
    try {
      realDir = await fs.realpath(abs);
    } catch {
      out.push({ kind: 'skip', skip: { name: entry.name, reason: 'broken symlink' } });
      continue;
    }
    const marker = await fs.lstat(path.join(realDir, 'SKILL.md')).catch(() => undefined);
    if (!marker || marker.isSymbolicLink() || !marker.isFile()) continue;
    out.push(await buildPackage(entry.name, realDir, lock, importedAt));
  }
  return out;
}
