import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { channelDir } from '../core/paths.js';
import type { ChannelInstaller, ChannelContext, UninstallContext } from './types.js';
import type { ChannelResult, ChannelStatus } from '../core/types.js';

/** Best-effort project id for the skills.external_dirs hint (GET /api/skills?client_type=hermes). */
async function fetchSkillsProjectId(ctx: ChannelContext): Promise<string> {
  const baseUrl = (ctx.baseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl) return '';
  try {
    const url = new URL('/api/skills?client_type=hermes', `${baseUrl}/`);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (ctx.apiToken) headers.authorization = `Bearer ${ctx.apiToken}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return '';
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
    const projectId = (payload as { project_id?: unknown }).project_id;
    return typeof projectId === 'string' ? projectId.trim() : '';
  } catch {
    return '';
  }
}

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
      run: ctx.artifactRun,
    });
    if (!download.ok) {
      return { id: 'hermes', status: 'failed', message: download.reason ?? 'hermes artifact download failed' };
    }
    const memoryPath = path.join(dest, 'lore_memory');
    if (ctx.capabilities.skills) {
      await fs.writeFile(path.join(dest, '.lore-skills-enabled'), '1\n', { mode: 0o600 });
    } else {
      await fs.rm(path.join(dest, '.lore-skills-enabled'), { force: true });
    }
    let message = `Hermes files ready. Manual setup required: symlink ${memoryPath} into your Hermes plugin/skills path (e.g. ~/.hermes/skills/lore_memory).`;
    if (ctx.capabilities.skills) {
      const projectId = await fetchSkillsProjectId(ctx);
      const skillsDir = projectId
        ? `~/.lore/skills/${projectId}`
        : '~/.lore/skills/<project-id> (see the directory name under ~/.lore/skills/)';
      message += ` For Lore Skills, also add ${skillsDir} to skills.external_dirs in ~/.hermes/config.yaml; the plugin syncs it at session start.`;
    }
    return {
      id: 'hermes',
      status: 'ok',
      message,
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
