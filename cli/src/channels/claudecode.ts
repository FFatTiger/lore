import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec, runChecked } from '../core/exec.js';
import { readJsonFile, readJsonFileStrict, writeJsonAtomic, ensureDir } from '../core/fs.js';
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

function asSettings(value: unknown, filePath: string): ClaudeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid JSON object in ${filePath}`);
  }
  return value as ClaudeSettings;
}

function failure(err: unknown): ChannelResult {
  return {
    id: 'claudecode',
    status: 'failed',
    message: err instanceof Error ? err.message : String(err),
  };
}

async function removeLegacyGuidance(homeDir: string): Promise<void> {
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
}

export const claudecodeInstaller: ChannelInstaller = {
  id: 'claudecode',

  async detectCli(): Promise<boolean> {
    return haveCommand('claude');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('claude', ctx.env ?? process.env))) {
      return { id: 'claudecode', status: 'skipped', message: 'claude CLI not found' };
    }

    const dest = channelDir(ctx.loreHome, 'claudecode');
    const download = await downloadOrSkipDetailed({
      channel: 'claudecode',
      dest,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.artifactRun,
    });
    if (!download.ok) {
      return { id: 'claudecode', status: 'failed', message: download.reason ?? 'claudecode artifact download failed' };
    }

    const homeDir = ctx.homeDir ?? os.homedir();
    const env = ctx.env ?? process.env;
    const run = ctx.run ?? createExec();
    const sf = settingsPath(homeDir);

    try {
      const existingSettings = await readJsonFileStrict<unknown>(sf);
      if (existingSettings !== undefined) asSettings(existingSettings, sf);
      const commandOpts = { quiet: true, env };
      const redact = [ctx.apiToken ?? ''];

      await fs.rm(path.join(homeDir, '.claude', 'plugins', 'cache', 'lore'), {
        recursive: true,
        force: true,
      }).catch(() => undefined);

      await runChecked(
        run,
        'Claude marketplace registration',
        ['claude', 'plugin', 'marketplace', 'add', dest],
        commandOpts,
        { redact },
      );

      const list = await runChecked(
        run,
        'Claude plugin listing',
        ['claude', 'plugin', 'list'],
        commandOpts,
        { redact },
      );
      if (!list.stdout.includes('lore@lore')) {
        await runChecked(
          run,
          'Claude plugin installation',
          ['claude', 'plugin', 'install', 'lore@lore'],
          commandOpts,
          { redact },
        );
      }

      const mcpUrl = `${ctx.baseUrl.replace(/\/$/, '')}/api/mcp?client_type=claudecode`;
      await run(['claude', 'mcp', 'remove', 'lore'], commandOpts).catch(() => undefined);
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
      await runChecked(run, 'Claude MCP registration', mcpArgs, commandOpts, { redact });

      await ensureDir(path.dirname(sf));
      const latestSettings = await readJsonFileStrict<unknown>(sf);
      const settings = latestSettings === undefined ? {} : asSettings(latestSettings, sf);
      const settingsEnv = (settings.env ??= {});
      settingsEnv.LORE_BASE_URL = ctx.baseUrl.replace(/\/$/, '');
      if (ctx.apiToken) settingsEnv.LORE_API_TOKEN = ctx.apiToken;
      else if (ctx.tokenAction === 'clear') delete settingsEnv.LORE_API_TOKEN;
      await writeJsonAtomic(sf, settings);

      await removeLegacyGuidance(homeDir);

      return { id: 'claudecode', status: 'ok', message: 'Claude Code configured' };
    } catch (err) {
      return failure(err);
    }
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

    await removeLegacyGuidance(homeDir);
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
