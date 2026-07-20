import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec } from '../core/exec.js';
import { ensureDir, readJsonFile, writeJsonAtomic } from '../core/fs.js';
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

export const codexInstaller: ChannelInstaller = {
  id: 'codex',

  async detectCli(): Promise<boolean> {
    return haveCommand('codex');
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    if (!(await haveCommand('codex'))) {
      return { id: 'codex', status: 'skipped', message: 'codex CLI not found' };
    }

    const marketDir = channelDir(ctx.loreHome, 'codex');
    const download = await downloadOrSkipDetailed({
      channel: 'codex',
      dest: marketDir,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.run,
    });
    if (!download.ok) {
      return { id: 'codex', status: 'failed', message: download.reason ?? 'codex artifact download failed' };
    }

    const homeDir = ctx.homeDir ?? os.homedir();
    const cHome = codexHome(homeDir);
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

    await ensureDir(path.dirname(pluginRoot));
    const tmp = `${pluginRoot}.tmp`;
    await copyDir(sourcePlugin, tmp);
    await fs.rm(pluginRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.rename(tmp, pluginRoot);

    const hooksPath = path.join(pluginRoot, 'hooks', 'hooks.json');
    try {
      const hooks = await fs.readFile(hooksPath, 'utf8');
      await fs.writeFile(hooksPath, hooks.replaceAll('__LORE_CODEX_PLUGIN_ROOT__', pluginRoot), 'utf8');
    } catch {
      // optional
    }

    const run = ctx.run ?? createExec();
    await run(['codex', 'plugin', 'marketplace', 'add', marketDir], { quiet: true });

    const cfgPath = path.join(cHome, 'config.toml');
    await ensureDir(path.dirname(cfgPath));
    let cfg = '';
    try {
      cfg = await fs.readFile(cfgPath, 'utf8');
    } catch {
      cfg = '';
    }
    cfg = setTomlSectionKeys(cfg, '[plugins."lore@lore"]', { enabled: 'true' });
    const mcpUrl = `${ctx.baseUrl.replace(/\/$/, '')}/api/mcp?client_type=codex`;
    const mcpKeys: Record<string, string> = { url: JSON.stringify(mcpUrl) };
    if (ctx.apiToken) {
      mcpKeys['http_headers'] = `{ Authorization = ${JSON.stringify(`Bearer ${ctx.apiToken}`)} }`;
    }
    cfg = setTomlSectionKeys(cfg, '[mcp_servers.lore]', mcpKeys, [
      'bearer_token_env_var',
      'http_headers',
      'env_http_headers',
      'url',
    ]);
    cfg = setTomlSectionKeys(cfg, '[features]', { hooks: 'true' }, ['hooks', 'codex_hooks']);
    await fs.writeFile(cfgPath, cfg, 'utf8');

    await run(['codex', 'mcp', 'remove', 'lore'], { quiet: true });
    await run(['codex', 'mcp', 'add', 'lore', '--url', mcpUrl], { quiet: true });

    const installHooks = path.join(pluginRoot, 'scripts', 'install-hooks.sh');
    try {
      await fs.access(installHooks);
      await run(['bash', installHooks], {
        quiet: true,
        env: {
          ...process.env,
          LORE_CODEX_PLUGIN_ROOT: pluginRoot,
          LORE_BASE_URL: ctx.baseUrl,
          LORE_API_TOKEN: ctx.apiToken ?? '',
          HOME: homeDir,
          CODEX_HOME: cHome,
        },
      });
    } catch {
      // optional
    }

    return { id: 'codex', status: 'ok', message: 'Codex configured' };
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
      const data = await readJsonFile<{ hooks?: Record<string, unknown[]> }>(hooksJson, {});
      if (data.hooks) {
        for (const [event, entries] of Object.entries(data.hooks)) {
          if (!Array.isArray(entries)) continue;
          const filtered = entries.filter((entry) => {
            const hooks = (entry as { hooks?: Array<{ command?: string }> }).hooks;
            if (!Array.isArray(hooks)) return true;
            return !hooks.some((h) => String(h.command ?? '').includes('/hooks/lore/hooks/recall-inject'));
          });
          if (filtered.length) data.hooks[event] = filtered;
          else delete data.hooks[event];
        }
        if (Object.keys(data.hooks).length === 0) delete data.hooks;
        await writeJsonAtomic(hooksJson, data);
      }
    } catch {
      // ignore
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
