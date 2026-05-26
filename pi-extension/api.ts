import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_DOMAIN = 'core';
const CLIENT_TYPE = 'pi';

interface SharedLoreConfig {
  base_url?: string;
  api_token?: string;
}

function readSharedLoreConfig(): SharedLoreConfig {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.lore', 'config.json'), 'utf-8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function pickString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function pickBaseUrl(cfg: any) {
  const shared = readSharedLoreConfig();
  const raw = pickString(cfg.baseUrl)
    || pickString(shared.base_url)
    || pickString(process.env.LORE_BASE_URL)
    || DEFAULT_BASE_URL;
  return raw.trim().replace(/\/+$/, '');
}

export function pickPluginConfig(pi: any) {
  const cfg = pi?.pluginConfig ?? {};
  const shared = readSharedLoreConfig();
  return {
    baseUrl: pickBaseUrl(cfg),
    apiToken: pickString(cfg.apiToken)
      || pickString(shared.api_token)
      || pickString(process.env.LORE_API_TOKEN)
      || pickString(process.env.API_TOKEN),
    timeoutMs: Number.isFinite(cfg.timeoutMs) ? Number(cfg.timeoutMs) : DEFAULT_TIMEOUT_MS,
    defaultDomain: typeof cfg.defaultDomain === 'string' && cfg.defaultDomain.trim() ? cfg.defaultDomain.trim() : DEFAULT_DOMAIN,
    injectPromptGuidance: cfg.injectPromptGuidance !== false,
    startupHealthcheck: cfg.startupHealthcheck !== false,
    recallEnabled: cfg.recallEnabled !== false,
  };
}

export function textResult(text: string, details?: unknown) {
  return { content: [{ type: 'text', text }], details };
}

export function authHeaders(pluginCfg: any, includeJson = true) {
  const headers: Record<string, string> = {};
  if (includeJson) headers['content-type'] = 'application/json';
  if (pluginCfg.apiToken) headers.authorization = `Bearer ${pluginCfg.apiToken}`;
  return headers;
}

export function buildApiUrl(pluginCfg: any, path: string) {
  const rawPath = String(path || '');
  const normalizedPath = `/api${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`;
  const url = new URL(normalizedPath, `${pluginCfg.baseUrl}/`);
  url.searchParams.set('client_type', CLIENT_TYPE);
  return url.toString();
}

export async function fetchJson(pluginCfg: any, path: string, options: any = {}) {
  const url = buildApiUrl(pluginCfg, path);
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(pluginCfg, options.method && options.method !== 'GET'),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(pluginCfg.timeoutMs || DEFAULT_TIMEOUT_MS),
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail = data?.detail || data?.error || text || `${response.status} ${response.statusText}`;
    const err: any = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function hasRecallConfig(pluginCfg: any) {
  return Boolean(pluginCfg.recallEnabled);
}
