import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { channelDir } from '../core/paths.js';
import type { ChannelInstaller, ChannelContext, UninstallContext } from './types.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';

export const hermesInstaller: ChannelInstaller = {
  id: 'hermes',

  async detectCli(): Promise<boolean> {
    // Hermes has no required CLI on PATH for install (shell never checks).
    return false;
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    const dest = channelDir(ctx.loreHome, 'hermes');
    const download = await downloadOrSkipDetailed({
      channel: 'hermes',
      dest,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.run,
    });
    if (!download.ok) {
      return { id: 'hermes', status: 'failed', message: download.reason ?? 'hermes artifact download failed' };
    }
    const memoryPath = path.join(dest, 'lore_memory');
    return {
      id: 'hermes',
      status: 'ok',
      message: `Hermes files ready. Symlink ${memoryPath} into your Hermes plugin/skills path (e.g. ~/.hermes/skills/lore_memory).`,
    };
  },

  async uninstall(ctx: UninstallContext): Promise<ChannelResult> {
    const dest = channelDir(ctx.loreHome, 'hermes');
    try {
      await fs.rm(dest, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return {
      id: 'hermes',
      status: 'ok',
      message: 'Hermes channel files removed. Remove any manual lore_memory symlink/env vars yourself.',
    };
  },

  async status(ctx = {}): Promise<ChannelStatus> {
    const loreHome = ctx.loreHome ?? path.join(os.homedir(), '.lore');
    const dest = channelDir(loreHome, 'hermes');
    const memory = path.join(dest, 'lore_memory');
    try {
      await fs.access(memory);
      return { id: 'hermes', state: 'installed', details: [memory] };
    } catch {
      try {
        await fs.access(dest);
        return { id: 'hermes', state: 'partial', details: [dest] };
      } catch {
        return { id: 'hermes', state: 'missing', details: [] };
      }
    }
  },
};
