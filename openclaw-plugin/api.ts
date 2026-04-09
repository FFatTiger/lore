const DEFAULT_BASE_URL = "http://127.0.0.1:18901";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_DOMAIN = "core";
const DEFAULT_RECALL_MIN_DISPLAY_SCORE = 0.4;
const DEFAULT_RECALL_MAX_DISPLAY_ITEMS = 3;
const DEFAULT_RECALL_SCORE_PRECISION = 2;

export function pickPluginConfig(api: any) {
  const cfg = api?.pluginConfig ?? {};

  return {
    baseUrl: typeof cfg.baseUrl === "string" && cfg.baseUrl.trim() ? cfg.baseUrl.trim().replace(/\/$/, "") : DEFAULT_BASE_URL,
    apiToken: typeof cfg.apiToken === "string" && cfg.apiToken.trim() ? cfg.apiToken.trim() : (process.env.LORE_API_TOKEN || process.env.API_TOKEN || ""),
    timeoutMs: Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS,
    defaultDomain: typeof cfg.defaultDomain === "string" && cfg.defaultDomain.trim() ? cfg.defaultDomain.trim() : DEFAULT_DOMAIN,
    injectPromptGuidance: cfg.injectPromptGuidance !== false,
    startupHealthcheck: cfg.startupHealthcheck !== false,
    recallEnabled: cfg.recallEnabled !== false,
    recallMinDisplayScore: Number.isFinite(cfg.minDisplayScore) ? Number(cfg.minDisplayScore) : DEFAULT_RECALL_MIN_DISPLAY_SCORE,
    recallMaxDisplayItems: Number.isFinite(cfg.maxDisplayItems) ? Number(cfg.maxDisplayItems) : DEFAULT_RECALL_MAX_DISPLAY_ITEMS,
    recallScorePrecision: Number.isFinite(cfg.scorePrecision) ? Number(cfg.scorePrecision) : DEFAULT_RECALL_SCORE_PRECISION,
    readNodeDisplayMode: cfg.readNodeDisplayMode === "hard" ? "hard" : "soft",
    excludeBootFromResults: cfg.excludeBootFromResults !== false,
  };
}

export function textResult(text: string, details?: any) {
  return { content: [{ type: "text", text }], details };
}

export function authHeaders(pluginCfg: any, includeJson = true) {
  const headers: Record<string, string> = {};
  if (includeJson) headers["content-type"] = "application/json";
  if (pluginCfg.apiToken) headers.authorization = `Bearer ${pluginCfg.apiToken}`;
  return headers;
}

export function buildApiUrl(pluginCfg: any, path: string) {
  const rawPath = String(path || "");
  const normalizedPath = `/api${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`;
  return `${pluginCfg.baseUrl}${normalizedPath}`;
}

export async function fetchJson(pluginCfg: any, path: string, options: any = {}) {
  const url = buildApiUrl(pluginCfg, path);
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(pluginCfg, options.method && options.method !== "GET"),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(pluginCfg.timeoutMs),
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
    const err: any = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function hasRecallConfig(pluginCfg: any) {
  return Boolean(pluginCfg.recallEnabled);
}
