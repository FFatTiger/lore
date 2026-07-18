import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const DEFAULT_DOMAIN = 'core';
const STARTUP_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 30_000;

interface SharedLoreConfig {
  base_url?: unknown;
  api_token?: unknown;
}

export interface LorePluginConfig {
  baseUrl: string;
  apiToken: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  defaultDomain: string;
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

export function loadLorePluginConfig(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): LorePluginConfig {
  const shared = readSharedLoreConfig(homeDir);
  const baseUrl = firstNonBlank(shared.base_url, env.LORE_BASE_URL, DEFAULT_BASE_URL)
    .replace(/\/+$/, '');

  return {
    baseUrl,
    apiToken: firstNonBlank(shared.api_token, env.LORE_API_TOKEN),
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    defaultDomain: firstNonBlank(env.LORE_DEFAULT_DOMAIN, DEFAULT_DOMAIN),
  };
}
