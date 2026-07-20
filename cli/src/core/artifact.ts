import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChannelId, NeedInstall } from './types.js';
import type { ExecFn } from './exec.js';
import { createExec } from './exec.js';

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
  const run = opts.run ?? createExec();

  const tmpRoot = `${opts.dest}.tmp`;
  const zipPath = path.join(tmpRoot, artifact);
  const extracted = path.join(tmpRoot, 'extracted');

  try {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });

    let curlRes;
    try {
      curlRes = await run(['curl', '-fsSL', url, '-o', zipPath]);
    } catch (err) {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      return {
        ok: false,
        url,
        reason: `curl failed to start: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (curlRes.code !== 0) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      const detail = [curlRes.stderr, curlRes.stdout].filter(Boolean).join(' ').trim();
      return {
        ok: false,
        url,
        reason: `Download failed (curl exit ${curlRes.code}) from ${url}${detail ? `: ${detail}` : ''}`,
      };
    }

    let unzipRes;
    try {
      unzipRes = await run(['unzip', '-qo', zipPath, '-d', extracted]);
    } catch (err) {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      return {
        ok: false,
        url,
        reason: `unzip failed to start: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (unzipRes.code !== 0) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      const detail = [unzipRes.stderr, unzipRes.stdout].filter(Boolean).join(' ').trim();
      return {
        ok: false,
        url,
        reason: `Extract failed for ${artifact}${detail ? `: ${detail}` : ''}`,
      };
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
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
