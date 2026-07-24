import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec, runChecked } from '../core/exec.js';
import { readJsonFile, readJsonFileStrict, writeJsonAtomic } from '../core/fs.js';
import { channelDir } from '../core/paths.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';
import type { ChannelContext, ChannelInstaller, UninstallContext } from './types.js';

function openclawConfigPath(homeDir: string): string {
  return path.join(homeDir, '.openclaw', 'openclaw.json');
}

function openclawExtPath(homeDir: string): string {
  return path.join(homeDir, '.openclaw', 'extensions', 'lore');
}

type OpenClawConfig = {
  plugins?: {
    entries?: Record<
      string,
      {
        enabled?: boolean;
        config?: { baseUrl?: string; apiToken?: string; [k: string]: unknown };
        [k: string]: unknown;
      }
    >;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

function asConfig(value: unknown, filePath: string): OpenClawConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid JSON object in ${filePath}`);
  }
  return value as OpenClawConfig;
}

function failure(err: unknown): ChannelResult {
  return {
    id: 'openclaw',
    status: 'failed',
    message: err instanceof Error ? err.message : String(err),
  };
}

export const openclawInstaller: ChannelInstaller = {
  id: 'openclaw',

  async detectCli(): Promise<boolean> {
    return haveCommand('openclaw');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('openclaw', ctx.env ?? process.env))) {
      return { id: 'openclaw', status: 'skipped', message: 'openclaw CLI not found' };
    }

    const dest = channelDir(ctx.loreHome, 'openclaw');
    const download = await downloadOrSkipDetailed({
      channel: 'openclaw',
      dest,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.artifactRun,
    });
    if (!download.ok) {
      return { id: 'openclaw', status: 'failed', message: download.reason ?? 'openclaw artifact download failed' };
    }

    const homeDir = ctx.homeDir ?? os.homedir();
    const env = ctx.env ?? process.env;
    const run = ctx.run ?? createExec();
    const cfgPath = openclawConfigPath(homeDir);

    try {
      const existing = await readJsonFileStrict<unknown>(cfgPath);
      if (existing !== undefined) asConfig(existing, cfgPath);
      const commandOpts = { quiet: true, env };
      const redact = [ctx.apiToken ?? ''];

      await fs.rm(openclawExtPath(homeDir), { recursive: true, force: true }).catch(() => undefined);

      let installError: unknown;
      let installed = false;
      for (let attempt = 0; attempt < 2 && !installed; attempt += 1) {
        try {
          await runChecked(
            run,
            'OpenClaw dependency installation',
            ['npm', 'install', '--silent'],
            { cwd: dest, quiet: true, env },
            { redact },
          );
          installed = true;
        } catch (err) {
          installError = err;
        }
      }
      if (!installed) throw installError;

      await runChecked(
        run,
        'OpenClaw build',
        ['npm', 'run', 'build'],
        { cwd: dest, quiet: true, env },
        { redact },
      );
      await runChecked(
        run,
        'OpenClaw plugin installation',
        ['openclaw', 'plugins', 'install', '.', '--force', '--dangerously-force-unsafe-install'],
        { cwd: dest, quiet: true, env },
        { redact },
      );
      await runChecked(
        run,
        'OpenClaw plugin enable',
        ['openclaw', 'plugins', 'enable', 'lore'],
        commandOpts,
        { redact },
      );

      const latest = await readJsonFileStrict<unknown>(cfgPath);
      if (latest !== undefined) {
        const data = asConfig(latest, cfgPath);
        const plugins = (data.plugins ??= {});
        const entries = (plugins.entries ??= {});
        const lore = (entries.lore ??= {});
        const config = (lore.config ??= {});
        config.baseUrl = ctx.baseUrl.replace(/\/$/, '');
        if (ctx.apiToken) config.apiToken = ctx.apiToken;
        else if (ctx.tokenAction === 'clear') delete config.apiToken;
        if (lore.enabled === undefined) lore.enabled = true;
        await writeJsonAtomic(cfgPath, data);
      }

      return { id: 'openclaw', status: 'ok', message: 'OpenClaw configured' };
    } catch (err) {
      return failure(err);
    }
  },

  async uninstall(ctx: UninstallContext): Promise<ChannelResult> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const run = ctx.run ?? createExec();

    if (await haveCommand('openclaw')) {
      await run(['openclaw', 'plugins', 'disable', 'lore'], { quiet: true });
      await run(['openclaw', 'plugins', 'uninstall', 'lore'], { quiet: true });
    }

    const cfgPath = openclawConfigPath(homeDir);
    try {
      await fs.access(cfgPath);
      const data = await readJsonFile<OpenClawConfig>(cfgPath, {});
      if (data.plugins?.entries && 'lore' in data.plugins.entries) {
        delete data.plugins.entries.lore;
        await writeJsonAtomic(cfgPath, data);
      }
    } catch {
      // ignore
    }

    await fs.rm(channelDir(ctx.loreHome, 'openclaw'), { recursive: true, force: true }).catch(() => undefined);

    return { id: 'openclaw', status: 'ok', message: 'OpenClaw uninstall complete' };
  },

  async status(ctx = {}): Promise<ChannelStatus> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const loreHome = ctx.loreHome ?? path.join(homeDir, '.lore');
    const details: string[] = [];
    const dest = channelDir(loreHome, 'openclaw');
    const cfgPath = openclawConfigPath(homeDir);

    try {
      await fs.access(dest);
      details.push(dest);
    } catch {
      // missing
    }

    let enabled = false;
    try {
      const data = await readJsonFile<OpenClawConfig>(cfgPath, {});
      const lore = data.plugins?.entries?.lore;
      if (lore) {
        details.push(cfgPath);
        enabled = lore.enabled !== false;
      }
    } catch {
      // missing
    }

    if (enabled) return { id: 'openclaw', state: 'installed', details };
    if (details.length) return { id: 'openclaw', state: 'partial', details };
    return { id: 'openclaw', state: 'missing', details: [] };
  },
};
