import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec, runChecked } from '../core/exec.js';
import { ensureDir, readJsonFileStrict, writeJsonAtomic } from '../core/fs.js';
import { channelDir } from '../core/paths.js';
import { removeTomlSection, setTomlSectionKeys } from '../core/toml.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';
import type { ChannelContext, ChannelInstaller, UninstallContext } from './types.js';

function codexHome(homeDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME?.trim() || path.join(homeDir, '.codex');
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
  await fs.cp(src, dest, { recursive: true });
}

function replaceStrings(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, from, to));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceStrings(item, from, to)]),
    );
  }
  return value;
}

async function patchBundledHooks(
  pluginRoot: string,
  staleRoots: string[] = [],
): Promise<void> {
  const hooksPath = path.join(pluginRoot, 'hooks', 'hooks.json');
  let hooks = await readJsonFileStrict<unknown>(hooksPath);
  if (hooks === undefined) return;
  const portablePluginRoot = pluginRoot.replace(/\\/g, '/');
  const staleRootVariants = staleRoots.flatMap((value) => [value, value.replace(/\\/g, '/')]);
  const replacements = ['__LORE_CODEX_PLUGIN_ROOT__', ...staleRootVariants]
    .filter((value, index, values) => value && value !== portablePluginRoot && values.indexOf(value) === index);
  const serialized = JSON.stringify(hooks);
  if (!replacements.some((value) => serialized.includes(value))) return;
  for (const staleRoot of replacements) {
    hooks = replaceStrings(hooks, staleRoot, portablePluginRoot);
  }
  await writeJsonAtomic(hooksPath, hooks, { mode: 0o644 });
}

async function patchCachedLoreHooks(
  cHome: string,
  staleRoots: string[],
): Promise<void> {
  const cacheRoot = path.join(cHome, 'plugins', 'cache', 'lore', 'lore');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(cacheRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await patchBundledHooks(path.join(cacheRoot, entry.name), staleRoots);
  }
}

function isLoreLegacyCommand(command: string): boolean {
  return command.includes('/hooks/lore/hooks/rules-inject.') ||
    command.includes('/hooks/lore/hooks/recall-inject.') ||
    (command.includes('LORE_CODEX_PLUGIN_ROOT=') &&
      (command.includes('rules-inject.') || command.includes('recall-inject.')));
}

type LegacyHook = { command?: unknown; [key: string]: unknown };
type LegacyEntry = { hooks?: unknown; [key: string]: unknown };
type LegacyHooksDocument = { hooks?: unknown; [key: string]: unknown };

async function readLegacyHooks(hooksJson: string): Promise<LegacyHooksDocument | undefined> {
  const data = await readJsonFileStrict<unknown>(hooksJson);
  if (data === undefined) return undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid JSON object in ${hooksJson}`);
  }
  return data as LegacyHooksDocument;
}

async function removeLegacyLoreHooks(
  cHome: string,
  data: LegacyHooksDocument | undefined,
): Promise<void> {
  const hooksJson = path.join(cHome, 'hooks.json');
  let changed = false;
  if (data?.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)) {
    const events = data.hooks as Record<string, unknown>;
    for (const [eventName, rawEntries] of Object.entries(events)) {
      if (!Array.isArray(rawEntries)) continue;
      const nextEntries: unknown[] = [];
      for (const rawEntry of rawEntries) {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
          nextEntries.push(rawEntry);
          continue;
        }
        const entry = rawEntry as LegacyEntry;
        if (!Array.isArray(entry.hooks)) {
          nextEntries.push(rawEntry);
          continue;
        }
        const nextHooks = entry.hooks.filter((rawHook) => {
          if (!rawHook || typeof rawHook !== 'object' || Array.isArray(rawHook)) return true;
          const command = String((rawHook as LegacyHook).command ?? '');
          return !isLoreLegacyCommand(command);
        });
        if (nextHooks.length !== entry.hooks.length) changed = true;
        if (nextHooks.length > 0) {
          nextEntries.push(nextHooks.length === entry.hooks.length ? rawEntry : { ...entry, hooks: nextHooks });
        } else if (entry.hooks.length === 0) {
          nextEntries.push(rawEntry);
        }
      }
      if (nextEntries.length !== rawEntries.length) changed = true;
      if (nextEntries.length > 0) events[eventName] = nextEntries;
      else {
        delete events[eventName];
        changed = true;
      }
    }
    if (Object.keys(events).length === 0) {
      delete data.hooks;
      changed = true;
    }
  }
  if (data && changed) await writeJsonAtomic(hooksJson, data);
  await fs.rm(path.join(cHome, 'hooks', 'lore'), { recursive: true, force: true });
}

function failure(err: unknown): ChannelResult {
  return {
    id: 'codex',
    status: 'failed',
    message: err instanceof Error ? err.message : String(err),
  };
}

export const codexInstaller: ChannelInstaller = {
  id: 'codex',

  async detectCli(): Promise<boolean> {
    return haveCommand('codex');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('codex', ctx.env ?? process.env))) {
      return { id: 'codex', status: 'skipped', message: 'codex CLI not found' };
    }

    const marketDir = channelDir(ctx.loreHome, 'codex');
    const download = await downloadOrSkipDetailed({
      channel: 'codex',
      dest: marketDir,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.artifactRun,
    });
    if (!download.ok) {
      return { id: 'codex', status: 'failed', message: download.reason ?? 'codex artifact download failed' };
    }

    const homeDir = ctx.homeDir ?? os.homedir();
    const env = ctx.env ?? process.env;
    const cHome = codexHome(homeDir, env);
    const pluginRoot = path.join(cHome, 'plugins', 'cache', 'lore', 'lore', 'local');
    const sourcePlugin = path.join(marketDir, 'plugins', 'lore');
    try {
      await fs.access(sourcePlugin);
    } catch {
      return {
        id: 'codex',
        status: 'failed',
        message: 'Codex artifact missing plugins/lore layout',
      };
    }

    try {
      const hooksJson = path.join(cHome, 'hooks.json');
      const legacyHooks = await readLegacyHooks(hooksJson);

      await ensureDir(path.dirname(pluginRoot));
      const tmp = `${pluginRoot}.tmp`;
      await copyDir(sourcePlugin, tmp);
      await fs.rm(pluginRoot, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(tmp, pluginRoot);
      await patchBundledHooks(pluginRoot, [sourcePlugin]);
      await patchBundledHooks(sourcePlugin);

      const run = ctx.run ?? createExec();
      const commandOpts = { quiet: true, env };
      const redact = [ctx.apiToken ?? ''];
      await run(
        ['codex', 'plugin', 'marketplace', 'remove', 'lore'],
        commandOpts,
      ).catch(() => undefined);
      await runChecked(
        run,
        'Codex marketplace registration',
        ['codex', 'plugin', 'marketplace', 'add', marketDir],
        commandOpts,
        { redact },
      );
      await patchCachedLoreHooks(cHome, [sourcePlugin, pluginRoot]);

      const mcpUrl = `${ctx.baseUrl.replace(/\/$/, '')}/api/mcp?client_type=codex`;
      await run(['codex', 'mcp', 'remove', 'lore'], commandOpts).catch(() => undefined);
      await runChecked(
        run,
        'Codex MCP registration',
        ['codex', 'mcp', 'add', 'lore', '--url', mcpUrl],
        commandOpts,
        { redact },
      );

      const cfgPath = path.join(cHome, 'config.toml');
      await ensureDir(path.dirname(cfgPath));
      let cfg = '';
      try {
        cfg = await fs.readFile(cfgPath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      cfg = setTomlSectionKeys(cfg, '[plugins."lore@lore"]', { enabled: 'true' });
      const mcpKeys: Record<string, string> = { url: JSON.stringify(mcpUrl) };
      if (ctx.apiToken) {
        mcpKeys.http_headers = `{ Authorization = ${JSON.stringify(`Bearer ${ctx.apiToken}`)} }`;
      }
      cfg = setTomlSectionKeys(cfg, '[mcp_servers.lore]', mcpKeys, [
        'bearer_token_env_var',
        'http_headers',
        'env_http_headers',
        'url',
      ]);
      cfg = setTomlSectionKeys(cfg, '[features]', { hooks: 'true' }, ['hooks', 'codex_hooks']);
      await fs.writeFile(cfgPath, cfg, { encoding: 'utf8', mode: 0o600 });
      await fs.chmod(cfgPath, 0o600);

      await removeLegacyLoreHooks(cHome, legacyHooks);

      if (env.LORE_CODEX_INSTALL_USER_HOOKS === '1') {
        const installHooks = path.join(pluginRoot, 'scripts', 'install-hooks.sh');
        await runChecked(
          run,
          'Codex legacy hook installation',
          ['bash', installHooks],
          {
            quiet: true,
            env: {
              ...env,
              LORE_CODEX_PLUGIN_ROOT: pluginRoot,
              LORE_BASE_URL: ctx.baseUrl,
              LORE_API_TOKEN: ctx.apiToken ?? '',
              HOME: homeDir,
              CODEX_HOME: cHome,
            },
          },
          { redact },
        );
      }

      return { id: 'codex', status: 'ok', message: 'Codex configured' };
    } catch (err) {
      return failure(err);
    }
  },

  async uninstall(ctx: UninstallContext): Promise<ChannelResult> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const cHome = codexHome(homeDir);
    const run = ctx.run ?? createExec();

    if (await haveCommand('codex')) {
      await run(['codex', 'plugin', 'marketplace', 'remove', 'lore'], { quiet: true });
      await run(['codex', 'mcp', 'remove', 'lore'], { quiet: true });
    }

    await fs.rm(path.join(cHome, 'plugins', 'lore-local-marketplace'), { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(path.join(cHome, 'plugins', 'cache', 'lore'), { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(path.join(cHome, 'hooks', 'lore'), { recursive: true, force: true }).catch(() => undefined);

    const hooksJson = path.join(cHome, 'hooks.json');
    try {
      const data = await readLegacyHooks(hooksJson);
      await removeLegacyLoreHooks(cHome, data);
    } catch {
      // preserve malformed/unreadable user hooks during best-effort uninstall
    }

    const cfgPath = path.join(cHome, 'config.toml');
    try {
      const cfg = await fs.readFile(cfgPath, 'utf8');
      let next = removeTomlSection(cfg, '[plugins."lore@lore"]');
      next = removeTomlSection(next, '[mcp_servers.lore]');
      await fs.writeFile(cfgPath, next, 'utf8');
    } catch {
      // ignore
    }

    await fs.rm(channelDir(ctx.loreHome, 'codex'), { recursive: true, force: true }).catch(() => undefined);
    return { id: 'codex', status: 'ok', message: 'Codex uninstall complete' };
  },

  async status(ctx = {}): Promise<ChannelStatus> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const loreHome = ctx.loreHome ?? path.join(homeDir, '.lore');
    const cHome = codexHome(homeDir);
    const details: string[] = [];
    const pluginRoot = path.join(cHome, 'plugins', 'cache', 'lore', 'lore', 'local');
    try {
      await fs.access(pluginRoot);
      details.push(pluginRoot);
    } catch {
      // missing
    }
    try {
      await fs.access(channelDir(loreHome, 'codex'));
      details.push(channelDir(loreHome, 'codex'));
    } catch {
      // missing
    }
    if (details.length >= 2) return { id: 'codex', state: 'installed', details };
    if (details.length) return { id: 'codex', state: 'partial', details };
    return { id: 'codex', state: 'missing', details: [] };
  },
};
