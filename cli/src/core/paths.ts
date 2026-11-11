import os from 'node:os';
import path from 'node:path';
import type { ChannelId } from './types.js';

export function getLoreHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.LORE_HOME?.trim() || path.join(os.homedir(), '.lore');
}

export function dshHomeDir(env: NodeJS.ProcessEnv = process.env, homeDir: string = os.homedir()): string {
  return env.DSH_HOME?.trim() || path.join(homeDir, '.dsh');
}

export function getConfigPath(loreHome: string): string {
  return path.join(loreHome, 'config.json');
}

export function channelDir(loreHome: string, id: ChannelId): string {
  return path.join(loreHome, id);
}

export function dockerDir(loreHome: string): string {
  return path.join(loreHome, 'docker');
}
