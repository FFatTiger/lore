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
      // Claude Code loads a directory-sourced marketplace plugin straight from
      // the marketplace directory (the channel dir), and that is where
      // CLAUDE_PLUGIN_ROOT points at session start. The installPath recorded in
      // installed_plugins.json is only the copy `claude plugin update` manages.
      return { clientType: id, root: path.join(args.loreHome, 'claudecode', 'skills') };
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
    const options = skillsRootFor(result.id, { loreHome: args.loreHome, homeDir, env });
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
