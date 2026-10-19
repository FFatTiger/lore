import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { channelDir } from '../core/paths.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';
import type { ChannelContext, ChannelInstaller, UninstallContext } from './types.js';

const BEGIN_MARKER = '# >>> lore (managed) >>>';
const END_MARKER = '# <<< lore (managed) <<<';
const PATCH_FILE = 'cordis.patch.yml';
const BACKUP_FILE = `${PATCH_FILE}.lore-bak`;

function failure(err: unknown): ChannelResult {
  return {
    id: 'dsh',
    status: 'failed',
    message: err instanceof Error ? err.message : String(err),
  };
}

export function dshHomeDir(env: NodeJS.ProcessEnv = process.env, homeDir: string = os.homedir()): string {
  return env.DSH_HOME?.trim() || path.join(homeDir, '.dsh');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The two Lore rows for the home-level cordis.patch.yml. Absolute plugin
 * paths are resolved by dsh itself (converted to file:// module URLs), so no
 * profile-local install is needed and every profile picks the rows up.
 */
export function renderLoreRows(args: { pluginPath: string; bridgePath: string }): string {
  return [
    `- insert:`,
    `    - id: lore-lifecycle`,
    `      name: ${args.pluginPath}`,
    `    - id: lore-mcp`,
    `      name: '@deepseek-ai/dsh-mcp-client'`,
    `      config:`,
    `        serverName: lore`,
    `        transport: stdio`,
    `        command: node`,
    `        args:`,
    `          - ${args.bridgePath}`,
  ].join('\n');
}

function meaningfulLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Insert or replace the managed Lore block in a home patch file's content,
 * preserving every other row and comment. An existing `[]` placeholder (the
 * dsh template) is replaced in place instead of appended to.
 */
export function upsertManagedPatch(content: string | null, block: string): string {
  const rows = `${BEGIN_MARKER}\n${block}\n${END_MARKER}\n`;
  const current = content ?? '';
  if (current.includes(BEGIN_MARKER) && current.includes(END_MARKER)) {
    const start = current.indexOf(BEGIN_MARKER);
    const end = current.indexOf(END_MARKER) + END_MARKER.length;
    return current.slice(0, start) + rows.trimEnd() + current.slice(end);
  }

  const meaningful = meaningfulLines(current);
  if (meaningful.length === 0) {
    const comments = current
      .split('\n')
      .filter((line) => line.trim().startsWith('#') || line.trim() === '')
      .join('\n')
      .replace(/\n+$/, '\n');
    return `${comments}${rows}`;
  }
  if (meaningful.length === 1 && meaningful[0] === '[]') {
    return current.replace(/\[\]\s*$/, rows.trimEnd());
  }
  return `${current.replace(/\s+$/, '')}\n\n${rows}`;
}

/** Remove the managed Lore block, leaving the file a valid (possibly empty) patch list. */
export function removeManagedPatch(content: string): string {
  if (!(content.includes(BEGIN_MARKER) && content.includes(END_MARKER))) return content;
  const start = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER) + END_MARKER.length;
  let remaining = content.slice(0, start) + content.slice(end);
  // Trim blank runs left behind around the removed block.
  remaining = remaining.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
  if (meaningfulLines(remaining).length === 0) {
    const comments = remaining
      .split('\n')
      .filter((line) => line.trim().startsWith('#') || line.trim() === '')
      .join('\n')
      .replace(/\n+$/, '\n');
    return `${comments}[]\n`;
  }
  return `${remaining.replace(/\s+$/, '')}\n`;
}

async function readPatch(home: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(home, PATCH_FILE), 'utf8');
  } catch {
    return null;
  }
}

async function writePatchAtomic(home: string, next: string, keepBackup: boolean): Promise<void> {
  const file = path.join(home, PATCH_FILE);
  const previous = await readPatch(home);
  if (keepBackup && previous !== null) {
    await fs.writeFile(path.join(home, BACKUP_FILE), previous, 'utf8');
  }
  const tmp = `${file}.lore-tmp`;
  await fs.writeFile(tmp, next, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, file);
}

function hasLoreRows(content: string | null): boolean {
  return content !== null && content.includes(BEGIN_MARKER) && content.includes(END_MARKER);
}

async function hasDshBinaryAndHome(env: NodeJS.ProcessEnv, homeDir: string): Promise<boolean> {
  if (await haveCommand('dsh', env)) return true;
  return pathExists(dshHomeDir(env, homeDir));
}

export const dshInstaller: ChannelInstaller = {
  id: 'dsh',

  async detectCli(): Promise<boolean> {
    return hasDshBinaryAndHome(process.env, os.homedir());
  },

  async install(ctx: ChannelContext): Promise<ChannelResult> {
    const env = ctx.env ?? process.env;
    const homeDir = ctx.homeDir ?? os.homedir();
    const dshHome = dshHomeDir(env, homeDir);
    if (!(await hasDshBinaryAndHome(env, homeDir))) {
      return { id: 'dsh', status: 'skipped', message: 'dsh CLI not found and no ~/.dsh directory exists' };
    }

    const dest = channelDir(ctx.loreHome, 'dsh');
    const download = await downloadOrSkipDetailed({
      channel: 'dsh',
      dest,
      releaseVersion: ctx.releaseVersion,
      needInstall: ctx.needInstall,
      run: ctx.artifactRun,
    });
    if (!download.ok) {
      return { id: 'dsh', status: 'failed', message: download.reason ?? 'dsh artifact download failed' };
    }

    try {
      const pluginPath = path.join(dest, 'plugin', 'lifecycle.mjs');
      const bridgePath = path.join(dest, 'mcp', 'lore-mcp.mjs');
      for (const file of [pluginPath, bridgePath]) {
        await fs.access(file, fsConstants.R_OK);
      }

      await fs.mkdir(dshHome, { recursive: true });
      const previous = await readPatch(dshHome);
      const next = upsertManagedPatch(previous, renderLoreRows({ pluginPath, bridgePath }));
      await writePatchAtomic(dshHome, next, previous !== null);

      return { id: 'dsh', status: 'ok', message: `DeepSeek Harness configured (${path.join(dshHome, PATCH_FILE)})` };
    } catch (err) {
      return failure(err);
    }
  },

  async uninstall(ctx: UninstallContext): Promise<ChannelResult> {
    const dshHome = dshHomeDir(process.env, ctx.homeDir ?? os.homedir());
    try {
      const previous = await readPatch(dshHome);
      if (previous !== null && hasLoreRows(previous)) {
        await writePatchAtomic(dshHome, removeManagedPatch(previous), true);
      }
    } catch {
      // A missing or unreadable home patch never blocks the rest of uninstall.
    }
    await fs.rm(channelDir(ctx.loreHome, 'dsh'), { recursive: true, force: true }).catch(() => undefined);
    return { id: 'dsh', status: 'ok', message: 'DeepSeek Harness uninstall complete' };
  },

  async status(ctx = {}): Promise<ChannelStatus> {
    const homeDir = ctx.homeDir ?? os.homedir();
    const loreHome = ctx.loreHome ?? path.join(homeDir, '.lore');
    const dest = channelDir(loreHome, 'dsh');
    const details: string[] = [];
    let hasFiles = false;
    try {
      await fs.access(path.join(dest, 'plugin', 'lifecycle.mjs'));
      await fs.access(path.join(dest, 'mcp', 'lore-mcp.mjs'));
      hasFiles = true;
      details.push(dest);
    } catch {
      try {
        await fs.access(dest);
        details.push(dest);
      } catch {}
    }
    const patched = hasLoreRows(await readPatch(dshHomeDir(process.env, homeDir)));
    if (patched) details.unshift(path.join(dshHomeDir(process.env, homeDir), PATCH_FILE));
    if (hasFiles && patched) return { id: 'dsh', state: 'installed', details };
    if (hasFiles || patched) return { id: 'dsh', state: 'partial', details };
    return { id: 'dsh', state: 'missing', details: [] };
  },
};
