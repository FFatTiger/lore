import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec, runChecked, type ExecFn } from '../core/exec.js';
import { channelDir } from '../core/paths.js';
import { ensureDir } from '../core/fs.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';
import type { ChannelContext, ChannelInstaller, UninstallContext } from './types.js';

const MANAGED_MARKER = '@lore-managed-opencode-plugin';
const DEFAULT_REPO = 'FFatTiger/lore';

type CompatibilityResult = { ok: true } | { ok: false; error: string };
type CompatHelper = { path: string; temporary: boolean };

function pluginTarget(homeDir: string): string {
  return path.join(homeDir, '.config', 'opencode', 'plugins', 'lore-memory.js');
}

async function resolveCompatHelper(
  loreHome: string,
  releaseVersion: string | undefined,
  run: ExecFn,
): Promise<CompatHelper | null> {
  const managed = path.join(loreHome, 'opencode-compat.py');
  try {
    const st = await fs.lstat(managed);
    if (st.isFile() && !st.isSymbolicLink()) return { path: managed, temporary: false };
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
    return { path: tmp, temporary: true };
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
  env: NodeJS.ProcessEnv,
): Promise<CompatibilityResult> {
  if (!(await haveCommand('python3', env))) return { ok: true };
  const helper = await resolveCompatHelper(loreHome, releaseVersion, run);
  if (!helper) return { ok: true };

  try {
    await runChecked(
      run,
      'OpenCode compatibility installation',
      ['python3', helper.path, 'install', '--home', homeDir, '--lore-home', loreHome],
      { quiet: true },
    );
    const state = path.join(loreHome, 'opencode-compat.json');
    try {
      await fs.access(state);
      const managed = path.join(loreHome, 'opencode-compat.py');
      if (helper.path !== managed) {
        const tmp = `${managed}.tmp.${process.pid}`;
        try {
          await fs.copyFile(helper.path, tmp);
          await fs.chmod(tmp, 0o600);
          await fs.rename(tmp, managed);
        } finally {
          await fs.rm(tmp, { force: true }).catch(() => undefined);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      await fs.rm(path.join(loreHome, 'opencode-compat.py'), { force: true }).catch(() => undefined);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (helper.temporary) {
      await fs.rm(helper.path, { force: true }).catch(() => undefined);
    }
  }
}

async function restoreCompatibility(
  loreHome: string,
  homeDir: string,
  run: ExecFn,
): Promise<CompatibilityResult> {
  const state = path.join(loreHome, 'opencode-compat.json');
  try {
    await fs.access(state);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!(await haveCommand('python3'))) {
    return { ok: false, error: 'OpenCode compatibility restore requires python3' };
  }

  const managed = path.join(loreHome, 'opencode-compat.py');
  try {
    const st = await fs.lstat(managed);
    if (!st.isFile() || st.isSymbolicLink()) {
      return { ok: false, error: 'OpenCode compatibility restore helper is unavailable' };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: 'OpenCode compatibility restore helper is unavailable' };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    await runChecked(
      run,
      'OpenCode compatibility restore',
      ['python3', managed, 'uninstall', '--home', homeDir, '--lore-home', loreHome],
      { quiet: true },
    );
    try {
      await fs.access(state);
      return { ok: false, error: 'OpenCode compatibility restore did not clear its recovery state' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.rm(managed, { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const opencodeInstaller: ChannelInstaller = {
  id: 'opencode',

  async detectCli(): Promise<boolean> {
    return haveCommand('opencode');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('opencode', ctx.env ?? process.env))) {
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
    const compatibility = await configureCompatibility(
      ctx.loreHome,
      homeDir,
      ctx.releaseVersion,
      run,
      ctx.env ?? process.env,
    );
    if (!compatibility.ok) {
      return { id: 'opencode', status: 'failed', message: compatibility.error };
    }

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
    const run = ctx.run ?? createExec();
    const compatibility = await restoreCompatibility(ctx.loreHome, homeDir, run);
    if (!compatibility.ok) {
      return { id: 'opencode', status: 'failed', message: compatibility.error };
    }

    const target = pluginTarget(homeDir);
    try {
      const body = await fs.readFile(target, 'utf8');
      if (body.includes(MANAGED_MARKER)) {
        await fs.rm(target, { force: true });
      }
    } catch {
      // missing
    }

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
