import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChannelId, ChannelResult } from '../core/types.js';
import type { Logger } from '../ui/log.js';
import { runSkillsSync } from '../../vendor/skill-workcopy/skills-sync.mjs';

const CHANNEL_LABELS: Record<ChannelId, string> = {
  claudecode: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  opencode: 'OpenCode',
  zcode: 'ZCode',
  dsh: 'DeepSeek Harness',
};

type SyncOptions = {
  clientType: string;
  root?: string;
  rootForProject?: (projectId: string) => string;
};

/**
 * The directory CLAUDE_PLUGIN_ROOT points at in a session. Archive-sourced
 * installs run from the installPath Claude Code records in
 * installed_plugins.json; a directory-sourced marketplace (no release
 * version, e.g. local builds) runs in place from the channel directory.
 */
async function claudecodeSkillsRoot(homeDir: string, loreHome: string): Promise<string> {
  const channelSkills = path.join(loreHome, 'claudecode', 'skills');
  try {
    const file = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
    // { version: 2, plugins: { 'lore@lore': [{ scope, installPath, ... }] } }
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as { plugins?: Record<string, unknown> };
    const entries = data.plugins?.['lore@lore'];
    if (!Array.isArray(entries)) return channelSkills;
    const records = entries.filter(
      (e): e is { scope?: unknown; installPath?: unknown } => Boolean(e) && typeof e === 'object',
    );
    const installPath = (records.find((e) => e.scope === 'user') ?? records[0])?.installPath;
    if (typeof installPath !== 'string' || !installPath.trim()) return channelSkills;
    const marketplace = await fs.readFile(
      path.join(loreHome, 'claudecode', '.claude-plugin', 'marketplace.json'), 'utf8',
    );
    return marketplace.includes('"archive"') ? path.join(installPath.trim(), 'skills') : channelSkills;
  } catch {
    return channelSkills;
  }
}

/**
 * OpenCode's global skills root, per OpenCode's own resolution:
 * $XDG_CONFIG_HOME/opencode/skills, else ~/.config/opencode/skills.
 * Single source of this rule for the CLI (first sync and uninstall).
 */
export function opencodeSkillsRoot(homeDir: string, env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.resolve(xdg, 'opencode', 'skills');
  return path.join(homeDir, '.config', 'opencode', 'skills');
}

function skillsRootFor(id: ChannelId, args: { loreHome: string; homeDir: string; env: NodeJS.ProcessEnv }): SyncOptions | undefined {
  switch (id) {
    case 'claudecode':
      // Resolved asynchronously below from installed_plugins.json.
      return undefined;
    case 'zcode':
      // zcode installs into a zcode-managed plugin root the CLI cannot see, so
      // it syncs from its own session hooks only.
      return undefined;
    case 'codex': {
      const codexHome = args.env.CODEX_HOME?.trim() || path.join(args.homeDir, '.codex');
      return { clientType: id, root: path.join(codexHome, 'plugins', 'cache', 'lore', 'lore', 'local', 'skills') };
    }
    case 'pi':
    case 'hermes':
    case 'dsh':
      // These hosts read the shared Lore work copies keyed by project identity.
      return {
        clientType: id,
        rootForProject: (projectId: string) => path.join(args.loreHome, 'skills', projectId),
      };
    case 'openclaw':
      return { clientType: id, root: path.join(args.homeDir, '.openclaw', 'extensions', 'lore', 'skills') };
    case 'opencode':
      return { clientType: id, root: opencodeSkillsRoot(args.homeDir, args.env) };
  }
}

/**
 * First skills sync after install/update: reconcile every successfully
 * installed channel's host-native skills directory so the first agent session
 * already sees the catalog, instead of waiting for the session-start hooks.
 * Failures never affect the install result; each prints at most one line.
 */
export async function runFirstSkillsSync(args: {
  results: ChannelResult[];
  loreHome: string;
  baseUrl: string;
  apiToken?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  log: Logger;
}): Promise<void> {
  const homeDir = args.homeDir ?? os.homedir();
  const env = args.env ?? process.env;
  const synced: string[] = [];
  const failed: string[] = [];
  let maxCount = 0;

  for (const result of args.results) {
    if (result.status !== 'ok') continue;
    const options = result.id === 'claudecode'
      ? { clientType: result.id, root: await claudecodeSkillsRoot(homeDir, args.loreHome) }
      : skillsRootFor(result.id, { loreHome: args.loreHome, homeDir, env });
    if (!options) continue;

    const status = await runSkillsSync({
      ...options,
      loreHome: args.loreHome,
      baseUrl: args.baseUrl,
      apiToken: args.apiToken,
    });
    if (status.errors.length > 0) {
      failed.push(CHANNEL_LABELS[result.id]);
      continue;
    }
    synced.push(CHANNEL_LABELS[result.id]);
    maxCount = Math.max(maxCount, status.created.length + status.updated.length + status.unchanged.length);
  }

  if (synced.length > 0) {
    args.log.info(`Skills: ${maxCount} synced → ${synced.join(', ')}`);
  }
  if (failed.length > 0) {
    args.log.warn(`Skills sync failed for ${failed.join(', ')}; retrying at the next session start`);
  }
}
