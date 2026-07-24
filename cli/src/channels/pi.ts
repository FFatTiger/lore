import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { channelDir } from '../core/paths.js';
import { haveCommand } from '../core/detect.js';
import type { ChannelInstaller, ChannelContext, UninstallContext } from './types.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';

function piExtensionPath(homeDir: string): string {
  return path.join(homeDir, '.pi', 'agent', 'extensions', 'lore');
}

async function installPiExtension(source: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    const st = await fs.lstat(target);
    if (!st.isSymbolicLink()) {
      throw new Error(`Target exists and is not a symbolic link: ${target}`);
    }
    await fs.unlink(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(source, target, type);
}

export const piInstaller: ChannelInstaller = {
  id: 'pi',

  async detectCli(): Promise<boolean> {
    return haveCommand('pi');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('pi', ctx.env ?? process.env))) {
      return { id: 'pi', status: 'skipped', message: 'pi CLI not found' };
    }

    const dest = channelDir(ctx.loreHome, 'pi');
    const download = await downloadOrSkipDetailed({
      channel: 'pi',
      dest,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.artifactRun,
    });
    if (!download.ok) {
      return { id: 'pi', status: 'failed', message: download.reason ?? 'pi artifact download failed' };
    }

    const homeDir = ctx.homeDir ?? os.homedir();
    try {
      await installPiExtension(dest, piExtensionPath(homeDir));
    } catch (err) {
      return {
        id: 'pi',
        status: 'failed',
        message: err instanceof Error ? `Pi local installation failed: ${err.message}` : String(err),
      };
    }

    return { id: 'pi', status: 'ok', message: 'Pi configured' };
  },

  async uninstall(ctx: UninstallContext): Promise<ChannelResult> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const ext = piExtensionPath(homeDir);
    try {
      const st = await fs.lstat(ext);
      if (st.isSymbolicLink()) {
        await fs.unlink(ext);
      }
      // non-symlink directory: preserve (shell warns and skips)
    } catch {
      // missing — fine
    }

    const dest = channelDir(ctx.loreHome, 'pi');
    try {
      await fs.rm(dest, { recursive: true, force: true });
    } catch {
      // ignore
    }

    return { id: 'pi', status: 'ok', message: 'Pi uninstall complete' };
  },

  async status(ctx = {}): Promise<ChannelStatus> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const loreHome = ctx.loreHome ?? path.join(homeDir, '.lore');
    const details: string[] = [];
    const dest = channelDir(loreHome, 'pi');
    const ext = piExtensionPath(homeDir);

    let hasDest = false;
    let hasExt = false;
    try {
      await fs.access(dest);
      hasDest = true;
      details.push(dest);
    } catch {
      // missing
    }
    try {
      const st = await fs.lstat(ext);
      hasExt = true;
      details.push(st.isSymbolicLink() ? `${ext} (symlink)` : ext);
    } catch {
      // missing
    }

    if (hasDest && hasExt) return { id: 'pi', state: 'installed', details };
    if (hasDest || hasExt) return { id: 'pi', state: 'partial', details };
    return { id: 'pi', state: 'missing', details: [] };
  },
};
