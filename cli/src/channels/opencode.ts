import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec, type ExecFn } from '../core/exec.js';
import { channelDir } from '../core/paths.js';
import { ensureDir } from '../core/fs.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';
import type { ChannelContext, ChannelInstaller, UninstallContext } from './types.js';

const MANAGED_MARKER = '@lore-managed-opencode-plugin';
const DEFAULT_REPO = 'FFatTiger/lore';

function pluginTarget(homeDir: string): string {
  return path.join(homeDir, '.config', 'opencode', 'plugins', 'lore-memory.js');
}

async function resolveCompatHelper(
  loreHome: string,
  releaseVersion: string | undefined,
  run: ExecFn,
): Promise<string | null> {
  const managed = path.join(loreHome, 'opencode-compat.py');
  try {
    const st = await fs.lstat(managed);
    if (st.isFile() && !st.isSymbolicLink()) return managed;
  } catch {
    // missing
  }

  let releaseRef = releaseVersion || 'main';
  if (releaseRef === 'dev') releaseRef = 'main';
  const tmp = path.join(os.tmpdir(), `lore-opencode-compat.${process.pid}.py`);
  const url = `https://raw.githubusercontent.com/${DEFAULT_REPO}/${releaseRef}/scripts/opencode-compat.py`;
  try {
    const res = await run(['curl', '-fsSL', url, '-o', tmp], { quiet: true });
    if (res.code !== 0) {
      await fs.rm(tmp, { force: true });
      return null;
    }
    await fs.chmod(tmp, 0o600);
    return tmp;
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    return null;
  }
}

async function configureCompatibility(
  loreHome: string,
  homeDir: string,
  releaseVersion: string | undefined,
  run: ExecFn,
): Promise<void> {
  if (!(await haveCommand('python3'))) return;
  const helper = await resolveCompatHelper(loreHome, releaseVersion, run);
  if (!helper) return;

  try {
    await run(
      ['python3', helper, 'install', '--home', homeDir, '--lore-home', loreHome],
      { quiet: true },
    );
    const state = path.join(loreHome, 'opencode-compat.json');
    try {
      await fs.access(state);
      const managed = path.join(loreHome, 'opencode-compat.py');
      const tmp = `${managed}.tmp.${process.pid}`;
      await fs.copyFile(helper, tmp);
      await fs.chmod(tmp, 0o600);
      await fs.rename(tmp, managed);
    } catch {
      await fs.rm(path.join(loreHome, 'opencode-compat.py'), { force: true }).catch(() => undefined);
    }
  } finally {
    if (helper.includes(`lore-opencode-compat.${process.pid}.py`)) {
      await fs.rm(helper, { force: true }).catch(() => undefined);
    }
  }
}

async function restoreCompatibility(
  loreHome: string,
  homeDir: string,
  run: ExecFn,
): Promise<void> {
  const state = path.join(loreHome, 'opencode-compat.json');
  try {
    await fs.access(state);
  } catch {
    return;
  }
  if (!(await haveCommand('python3'))) return;

  const managed = path.join(loreHome, 'opencode-compat.py');
  let helper: string | null = null;
  try {
    const st = await fs.lstat(managed);
    if (st.isFile() && !st.isSymbolicLink()) helper = managed;
  } catch {
    helper = null;
  }
  if (!helper) return;

  await run(
    ['python3', helper, 'uninstall', '--home', homeDir, '--lore-home', loreHome],
    { quiet: true },
  );
  try {
    await fs.access(state);
  } catch {
    await fs.rm(managed, { force: true }).catch(() => undefined);
  }
}

export const opencodeInstaller: ChannelInstaller = {
  id: 'opencode',

  async detectCli(): Promise<boolean> {
    return haveCommand('opencode');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('opencode'))) {
      return { id: 'opencode', status: 'skipped', message: 'opencode CLI not found' };
    }

    const dest = channelDir(ctx.loreHome, 'opencode');
    const download = await downloadOrSkipDetailed({
      channel: 'opencode',
      dest,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.run,
    });
    if (!download.ok) {
      return { id: 'opencode', status: 'failed', message: download.reason ?? 'opencode artifact download failed' };
    }

    const source = path.join(dest, 'lore-memory.js');
    try {
      await fs.access(source);
    } catch {
      return {
        id: 'opencode',
        status: 'failed',
        message: 'OpenCode artifact is missing lore-memory.js',
      };
    }

    const homeDir = ctx.homeDir ?? os.homedir();
    const target = pluginTarget(homeDir);
    try {
      const existing = await fs.readFile(target, 'utf8');
      if (!existing.includes(MANAGED_MARKER)) {
        return {
          id: 'opencode',
          status: 'skipped',
          message: `${target} is not managed by Lore. Preserving it.`,
        };
      }
    } catch {
      // missing target — ok to install
    }

    await ensureDir(path.dirname(target));
    const tmp = `${target}.tmp.${process.pid}`;
    await fs.copyFile(source, tmp);
    await fs.chmod(tmp, 0o644);
    await fs.rename(tmp, target);

    const run = ctx.run ?? createExec();
    await configureCompatibility(ctx.loreHome, homeDir, ctx.releaseVersion, run);

    const body = await fs.readFile(target, 'utf8');
    const match = body.match(/@lore-managed-opencode-plugin version=([^\s]+)/);
    const version = match?.[1] ?? 'unknown';
    return {
      id: 'opencode',
      status: 'ok',
      message: `OpenCode configured (${version})`,
    };
  },

  async uninstall(ctx: UninstallContext): Promise<ChannelResult> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const target = pluginTarget(homeDir);
    try {
      const body = await fs.readFile(target, 'utf8');
      if (body.includes(MANAGED_MARKER)) {
        await fs.rm(target, { force: true });
      }
    } catch {
      // missing
    }

    const run = ctx.run ?? createExec();
    await restoreCompatibility(ctx.loreHome, homeDir, run);

    try {
      await fs.rm(channelDir(ctx.loreHome, 'opencode'), { recursive: true, force: true });
    } catch {
      // ignore
    }

    return { id: 'opencode', status: 'ok', message: 'OpenCode uninstall complete' };
  },

  async status(ctx = {}): Promise<ChannelStatus> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const loreHome = ctx.loreHome ?? path.join(homeDir, '.lore');
    const target = pluginTarget(homeDir);
    const dest = channelDir(loreHome, 'opencode');
    const details: string[] = [];
    let managed = false;
    try {
      const body = await fs.readFile(target, 'utf8');
      details.push(target);
      managed = body.includes(MANAGED_MARKER);
    } catch {
      // missing
    }
    try {
      await fs.access(dest);
      details.push(dest);
    } catch {
      // missing
    }
    if (managed) return { id: 'opencode', state: 'installed', details };
    if (details.length) return { id: 'opencode', state: 'partial', details };
    return { id: 'opencode', state: 'missing', details: [] };
  },
};
