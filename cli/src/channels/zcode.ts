import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec, runChecked } from '../core/exec.js';
import { channelDir } from '../core/paths.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';
import type { ChannelContext, ChannelInstaller, UninstallContext } from './types.js';

function failure(err: unknown): ChannelResult {
  return {
    id: 'zcode',
    status: 'failed',
    message: err instanceof Error ? err.message : String(err),
  };
}

export const zcodeInstaller: ChannelInstaller = {
  id: 'zcode',

  async detectCli(): Promise<boolean> {
    return haveCommand('zcode');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('zcode', ctx.env ?? process.env))) {
      return { id: 'zcode', status: 'skipped', message: 'zcode CLI not found' };
    }

    const dest = channelDir(ctx.loreHome, 'zcode');
    const download = await downloadOrSkipDetailed({
      channel: 'zcode',
      dest,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.artifactRun,
    });
    if (!download.ok) {
      return { id: 'zcode', status: 'failed', message: download.reason ?? 'zcode artifact download failed' };
    }

    const env = ctx.env ?? process.env;
    const run = ctx.run ?? createExec();
    const commandOpts = { quiet: true, env };
    const redact = [ctx.apiToken ?? ''];

    try {
      await run(['zcode', 'plugins', 'marketplace', 'remove', 'lore'], commandOpts).catch(() => undefined);
      await runChecked(
        run,
        'ZCode marketplace registration',
        ['zcode', 'plugins', 'marketplace', 'add', dest],
        commandOpts,
        { redact },
      );

      const list = await runChecked(
        run,
        'ZCode plugin listing',
        ['zcode', 'plugins', 'list'],
        commandOpts,
        { redact },
      );
      if (!list.stdout.includes('lore@lore')) {
        await runChecked(
          run,
          'ZCode plugin installation',
          ['zcode', 'plugins', 'install', 'lore@lore'],
          commandOpts,
          { redact },
        );
      }
      await runChecked(
        run,
        'ZCode plugin enable',
        ['zcode', 'plugins', 'enable', 'lore@lore'],
        commandOpts,
        { redact },
      );

      return { id: 'zcode', status: 'ok', message: 'ZCode configured' };
    } catch (err) {
      return failure(err);
    }
  },

  async uninstall(ctx: UninstallContext): Promise<ChannelResult> {
    const run = ctx.run ?? createExec();

    if (await haveCommand('zcode')) {
      await run(['zcode', 'plugins', 'uninstall', 'lore@lore'], { quiet: true });
      await run(['zcode', 'plugins', 'marketplace', 'remove', 'lore'], { quiet: true });
    }

    await fs.rm(channelDir(ctx.loreHome, 'zcode'), { recursive: true, force: true }).catch(() => undefined);
    return { id: 'zcode', status: 'ok', message: 'ZCode uninstall complete' };
  },

  async status(ctx = {}): Promise<ChannelStatus> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const loreHome = ctx.loreHome ?? path.join(homeDir, '.lore');
    const dest = channelDir(loreHome, 'zcode');
    try {
      await fs.access(path.join(dest, 'marketplace.json'));
      return { id: 'zcode', state: 'installed', details: [dest] };
    } catch {
      try {
        await fs.access(dest);
        return { id: 'zcode', state: 'partial', details: [dest] };
      } catch {
        return { id: 'zcode', state: 'missing', details: [] };
      }
    }
  },
};
