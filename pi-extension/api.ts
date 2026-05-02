const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_DOMAIN = 'core';
const CLIENT_TYPE = 'pi';

function pickBaseUrl(cfg: any) {
  const raw = typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim() ? cfg.baseUrl : (process.env.LORE_BASE_URL || DEFAULT_BASE_URL);
  return raw.trim().replace(/\/$/, '');
}

export function pickPluginConfig(pi: any) {
  const cfg = pi?.pluginConfig ?? {};
  return {
    baseUrl: pickBaseUrl(cfg),
    apiToken: typeof cfg.apiToken === 'string' && cfg.apiToken.trim() ? cfg.apiToken.trim() : (process.env.LORE_API_TOKEN || process.env.API_TOKEN || ''),
    timeoutMs: Number.isFinite(cfg.timeoutMs) ? Number(cfg.timeoutMs) : DEFAULT_TIMEOUT_MS,
    defaultDomain: typeof cfg.defaultDomain === 'string' && cfg.defaultDomain.trim() ? cfg.defaultDomain.trim() : DEFAULT_DOMAIN,
    injectPromptGuidance: cfg.injectPromptGuidance !== false,
    startupHealthcheck: cfg.startupHealthcheck !== false,
    recallEnabled: cfg.recallEnabled !== false,
    readNodeDisplayMode: cfg.readNodeDisplayMode === 'hard' ? 'hard' : 'soft',
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
