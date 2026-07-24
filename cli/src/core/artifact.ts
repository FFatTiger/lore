import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { ChannelId, NeedInstall } from './types.js';
import type { ExecFn } from './exec.js';

const DEFAULT_REPO = 'FFatTiger/lore';

const ARTIFACT_MAP: Record<ChannelId, string> = {
  claudecode: 'lore-claudecode.zip',
  codex: 'lore-codex.zip',
  pi: 'lore-pi.zip',
  openclaw: 'lore-openclaw.zip',
  hermes: 'lore-hermes.zip',
  opencode: 'lore-opencode.zip',
};

export function artifactName(id: ChannelId): string {
  return ARTIFACT_MAP[id];
}

export type DownloadResult = {
  ok: boolean;
  /** Machine-oriented reason when ok=false */
  reason?: string;
  url?: string;
};

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Port of scripts/install.sh download_artifact + download_or_skip.
 *
 * needInstall:
 * - 0 → always download
 * - 2 (and other non-0) → reuse dest if it exists as a directory; else download
 *   when releaseVersion is set, else fail
 */
export async function downloadOrSkip(opts: {
  channel: ChannelId;
  dest: string;
  releaseVersion?: string;
  needInstall: NeedInstall;
  repo?: string;
  run?: ExecFn;
}): Promise<boolean> {
  const res = await downloadOrSkipDetailed(opts);
  return res.ok;
}

export async function downloadOrSkipDetailed(opts: {
  channel: ChannelId;
  dest: string;
  releaseVersion?: string;
  needInstall: NeedInstall;
  repo?: string;
  run?: ExecFn;
}): Promise<DownloadResult> {
  const { channel, dest, needInstall } = opts;
  const releaseVersion = opts.releaseVersion?.trim() || '';

  if (needInstall !== 0) {
    if (await isDirectory(dest)) {
      return { ok: true };
    }
    if (!releaseVersion) {
      return {
        ok: false,
        reason:
          'No local files and release version is unknown (GitHub tag resolution failed). Cannot download artifacts.',
      };
    }
  }

  return downloadArtifact({
    channel,
    dest,
    releaseVersion,
    repo: opts.repo,
    run: opts.run,
  });
}

async function downloadArtifact(opts: {
  channel: ChannelId;
  dest: string;
  releaseVersion: string;
  repo?: string;
  run?: ExecFn;
}): Promise<DownloadResult> {
  const artifact = artifactName(opts.channel);
  if (!artifact) {
    return { ok: false, reason: `No artifact mapping for channel ${opts.channel}` };
  }
  if (!opts.releaseVersion) {
    return {
      ok: false,
      reason:
        'Release version is empty/unknown. Resolve a GitHub release tag before downloading.',
    };
  }

  const repo = opts.repo || DEFAULT_REPO;
  const url = `https://github.com/${repo}/releases/download/${opts.releaseVersion}/${artifact}`;
  const tmpRoot = `${opts.dest}.tmp`;
  const zipPath = path.join(tmpRoot, artifact);
  const extracted = path.join(tmpRoot, 'extracted');

  try {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(extracted, { recursive: true });

    if (opts.run) {
      const download = await opts.run(['curl', '-fsSL', url, '-o', zipPath]);
      if (download.code !== 0) {
        const detail = [download.stderr, download.stdout].filter(Boolean).join(' ').trim();
        throw new Error(`Download failed (curl exit ${download.code})${detail ? `: ${detail}` : ''}`);
      }
      const extract = await opts.run(['unzip', '-qo', zipPath, '-d', extracted]);
      if (extract.code !== 0) {
        const detail = [extract.stderr, extract.stdout].filter(Boolean).join(' ').trim();
        throw new Error(`Extract failed for ${artifact}${detail ? `: ${detail}` : ''}`);
      }
    } else {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
      await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));

      const archive = unzipSync(new Uint8Array(await fs.readFile(zipPath)));
      for (const [entryName, contents] of Object.entries(archive)) {
        const normalized = entryName.replace(/\\/g, '/');
        const target = path.resolve(extracted, normalized);
        const relative = path.relative(extracted, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`Unsafe archive entry: ${entryName}`);
        }
        if (normalized.endsWith('/')) {
          await fs.mkdir(target, { recursive: true });
        } else {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, contents);
        }
      }
    }

    await fs.rm(opts.dest, { recursive: true, force: true });
    await fs.rename(extracted, opts.dest);
    await fs.rm(tmpRoot, { recursive: true, force: true });
    return { ok: true, url };
  } catch (err) {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      url,
      reason: err instanceof Error ? `${err.message} from ${url}` : String(err),
    };
  }
}
