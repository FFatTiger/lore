import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec } from '../core/exec.js';
import { readJsonFile, writeJsonAtomic, ensureDir } from '../core/fs.js';
import { channelDir } from '../core/paths.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';
import type { ChannelContext, ChannelInstaller, UninstallContext } from './types.js';

type ClaudeSettings = {
  env?: Record<string, string>;
  [k: string]: unknown;
};

function settingsPath(homeDir: string): string {
  return path.join(homeDir, '.claude', 'settings.json');
}

export const claudecodeInstaller: ChannelInstaller = {
  id: 'claudecode',

  async detectCli(): Promise<boolean> {
    return haveCommand('claude');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('claude'))) {
      return { id: 'claudecode', status: 'skipped', message: 'claude CLI not found' };
    }

    const dest = channelDir(ctx.loreHome, 'claudecode');
    const download = await downloadOrSkipDetailed({
      channel: 'claudecode',
      dest,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.run,
    });
    if (!download.ok) {
      return { id: 'claudecode', status: 'failed', message: download.reason ?? 'claudecode artifact download failed' };
    }

    const homeDir = ctx.homeDir ?? os.homedir();
    const run = ctx.run ?? createExec();

    await fs.rm(path.join(homeDir, '.claude', 'plugins', 'cache', 'lore'), {
      recursive: true,
      force: true,
    }).catch(() => undefined);

    await run(['claude', 'plugin', 'marketplace', 'add', dest], { quiet: true });

    const list = await run(['claude', 'plugin', 'list'], { quiet: true });
    if (!list.stdout.includes('lore@lore')) {
      await run(['claude', 'plugin', 'install', 'lore@lore'], { quiet: true });
    }

    const sf = settingsPath(homeDir);
    await ensureDir(path.dirname(sf));
    const settings = await readJsonFile<ClaudeSettings>(sf, {});
    const env = (settings.env ??= {});
    env.LORE_BASE_URL = ctx.baseUrl.replace(/\/$/, '');
    if (ctx.apiToken) env.LORE_API_TOKEN = ctx.apiToken;
    await writeJsonAtomic(sf, settings);

    const mcpUrl = `${ctx.baseUrl.replace(/\/$/, '')}/api/mcp?client_type=claudecode`;
    await run(['claude', 'mcp', 'remove', 'lore'], { quiet: true });
    const mcpArgs = [
      'claude',
      'mcp',
      'add',
      '--transport',
      'http',
      '--scope',
      'user',
      'lore',
      mcpUrl,
    ];
    if (ctx.apiToken) {
      mcpArgs.push('--header', `Authorization: Bearer ${ctx.apiToken}`);
    }
    await run(mcpArgs, { quiet: true });

    await fs.rm(path.join(homeDir, '.claude', 'lore-guidance.md'), { force: true }).catch(() => undefined);
    const claudeMd = path.join(homeDir, '.claude', 'CLAUDE.md');
    try {
      const body = await fs.readFile(claudeMd, 'utf8');
      const filtered = body
        .split(/\r?\n/)
        .filter(
          (line) =>
            line !== '@~/.claude/lore-guidance.md' &&
            line !== '@import ~/.claude/lore-guidance.md',
        )
        .join('\n')
        .replace(/^\n+/, '');
      if (filtered !== body) {
        await fs.writeFile(claudeMd, filtered.endsWith('\n') ? filtered : `${filtered}\n`, 'utf8');
      }
    } catch {
      // missing
    }

    return { id: 'claudecode', status: 'ok', message: 'Claude Code configured' };
  },

  async uninstall(ctx: UninstallContext): Promise<ChannelResult> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const run = ctx.run ?? createExec();

    if (await haveCommand('claude')) {
      await run(['claude', 'plugins', 'uninstall', 'lore@lore'], { quiet: true });
      await run(['claude', 'mcp', 'remove', 'lore'], { quiet: true });
    }

    const sf = settingsPath(homeDir);
    try {
      const settings = await readJsonFile<ClaudeSettings>(sf, {});
      if (settings.env) {
        delete settings.env.LORE_BASE_URL;
        delete settings.env.LORE_API_TOKEN;
        if (Object.keys(settings.env).length === 0) delete settings.env;
        await writeJsonAtomic(sf, settings);
      }
    } catch {
      // ignore
    }

    await fs.rm(path.join(homeDir, '.claude', 'lore-guidance.md'), { force: true }).catch(() => undefined);
    await fs.rm(path.join(homeDir, '.claude', 'plugins', 'cache', 'lore'), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await fs.rm(channelDir(ctx.loreHome, 'claudecode'), { recursive: true, force: true }).catch(() => undefined);

    return { id: 'claudecode', status: 'ok', message: 'Claude Code uninstall complete' };
  },

  async status(ctx = {}): Promise<ChannelStatus> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const loreHome = ctx.loreHome ?? path.join(homeDir, '.lore');
    const details: string[] = [];
    const dest = channelDir(loreHome, 'claudecode');
    try {
      await fs.access(dest);
      details.push(dest);
    } catch {
      // missing
    }
    try {
      const settings = await readJsonFile<ClaudeSettings>(settingsPath(homeDir), {});
      if (settings.env?.LORE_BASE_URL) details.push(settingsPath(homeDir));
    } catch {
      // missing
    }
    if (details.length >= 2) return { id: 'claudecode', state: 'installed', details };
    if (details.length) return { id: 'claudecode', state: 'partial', details };
    return { id: 'claudecode', state: 'missing', details: [] };
  },
};
