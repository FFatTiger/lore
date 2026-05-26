import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:18901";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_DOMAIN = "core";
const DEFAULT_RECALL_MIN_DISPLAY_SCORE = 0.4;
const DEFAULT_RECALL_MAX_DISPLAY_ITEMS = 3;
const DEFAULT_RECALL_SCORE_PRECISION = 2;
const CLIENT_TYPE = "openclaw";

interface SharedLoreConfig {
  base_url?: string;
  api_token?: string;
}

function readSharedLoreConfig(): SharedLoreConfig {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), ".lore", "config.json"), "utf-8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function pickString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function pickPluginConfig(api: any) {
  const cfg = api?.pluginConfig ?? {};
  const shared = readSharedLoreConfig();
  const baseUrl = pickString(cfg.baseUrl)
    || pickString(shared.base_url)
    || pickString(process.env.LORE_BASE_URL)
    || DEFAULT_BASE_URL;
  const apiToken = pickString(cfg.apiToken)
    || pickString(shared.api_token)
    || pickString(process.env.LORE_API_TOKEN)
    || pickString(process.env.API_TOKEN);

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiToken,
    timeoutMs: Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS,
    defaultDomain: typeof cfg.defaultDomain === "string" && cfg.defaultDomain.trim() ? cfg.defaultDomain.trim() : DEFAULT_DOMAIN,
    injectPromptGuidance: cfg.injectPromptGuidance !== false,
    startupHealthcheck: cfg.startupHealthcheck !== false,
    recallEnabled: cfg.recallEnabled !== false,
    recallMinDisplayScore: Number.isFinite(cfg.minDisplayScore) ? Number(cfg.minDisplayScore) : DEFAULT_RECALL_MIN_DISPLAY_SCORE,
    recallMaxDisplayItems: Number.isFinite(cfg.maxDisplayItems) ? Number(cfg.maxDisplayItems) : DEFAULT_RECALL_MAX_DISPLAY_ITEMS,
    recallScorePrecision: Number.isFinite(cfg.scorePrecision) ? Number(cfg.scorePrecision) : DEFAULT_RECALL_SCORE_PRECISION,
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
  const url = new URL(normalizedPath, `${pluginCfg.baseUrl}/`);
  url.searchParams.set("client_type", CLIENT_TYPE);
  return url.toString();
}

export async function fetchJson(pluginCfg: any, path: string, options: any = {}) {
  const url = buildApiUrl(pluginCfg, path);
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(pluginCfg, options.method && options.method !== "GET"),
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
