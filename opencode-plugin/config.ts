import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const DEFAULT_DOMAIN = 'core';
const STARTUP_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 30_000;

interface SharedLoreConfig {
  base_url?: unknown;
  api_token?: unknown;
  server_profile?: unknown;
}

export interface LorePluginConfig {
  baseUrl: string;
  apiToken: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  defaultDomain: string;
  /** Whether the connected server explicitly advertises Skills support. */
  skillsEnabled: boolean;
  /** Writable skill work-copy root: LORE_HOME, else <home>/.lore. */
  loreHome: string;
}

function firstNonBlank(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readSharedLoreConfig(homeDir: string): SharedLoreConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(homeDir, '.lore', 'config.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as SharedLoreConfig
      : {};
  } catch {
    return {};
  }
}

function resolveLoreHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  const fromEnv = firstNonBlank(env.LORE_HOME);
  if (fromEnv) return resolve(fromEnv);
  return resolve(join(homeDir, '.lore'));
}

function resolveSkillsEnabled(
  env: NodeJS.ProcessEnv,
  shared: SharedLoreConfig,
  baseUrl: string,
  loreHome: string,
): boolean {
  if (env.LORE_SKILLS_ENABLED === '0') return false;
  const profile = shared.server_profile;
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    const record = profile as Record<string, unknown>;
    const profileBase = firstNonBlank(record.base_url).replace(/\/+$/, '').toLowerCase();
    const capabilities = record.capabilities;
    if (profileBase === baseUrl.toLowerCase()) {
      return Boolean(capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
        && (capabilities as Record<string, unknown>).skills === true);
    }
  }
  if (env.LORE_SKILLS_ENABLED === '1') return true;
  try {
    return readFileSync(join(loreHome, 'opencode', '.lore-skills-enabled'), 'utf8').trim() === '1';
  } catch {
    return false;
  }
}

export function loadLorePluginConfig(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): LorePluginConfig {
  const shared = readSharedLoreConfig(homeDir);
  const baseUrl = firstNonBlank(shared.base_url, env.LORE_BASE_URL, DEFAULT_BASE_URL)
    .replace(/\/+$/, '');
  const loreHome = resolveLoreHome(env, homeDir);

  return {
    baseUrl,
    apiToken: firstNonBlank(shared.api_token, env.LORE_API_TOKEN),
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    defaultDomain: firstNonBlank(env.LORE_DEFAULT_DOMAIN, DEFAULT_DOMAIN),
    skillsEnabled: resolveSkillsEnabled(env, shared, baseUrl, loreHome),
    loreHome,
  };
}
