import type { LorePluginConfig } from './config.js';

const CLIENT_TYPE = 'opencode';

export interface LoreRequestInit {
  method?: string;
  body?: unknown;
  search?: URLSearchParams;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class LoreApiError extends Error {
  status?: number;
  code: string;

  constructor(message: string, options: { status?: number; code: string; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LoreApiError';
    this.status = options.status;
    this.code = options.code;
  }
}

function normalizeApiPath(pathname: string): string {
  const normalized = `/${String(pathname || '').replace(/^\/+/, '')}`;
  return normalized === '/api' || normalized.startsWith('/api/')
    ? normalized
    : `/api${normalized}`;
}

export function buildLoreApiUrl(
  config: LorePluginConfig,
  pathname: string,
  search?: URLSearchParams,
): URL {
  const url = new URL(normalizeApiPath(pathname), `${config.baseUrl}/`);
  for (const [key, value] of search ?? []) url.searchParams.append(key, value);
  if (url.pathname !== '/api/health') url.searchParams.set('client_type', CLIENT_TYPE);
  return url;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['detail', 'error', 'message']) {
      if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
    }
  }
  return fallback;
}

function errorCode(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const code = (payload as Record<string, unknown>).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return fallback;
}

export async function loreFetchJson<T>(
  config: LorePluginConfig,
  pathname: string,
  init: LoreRequestInit = {},
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(init.timeoutMs ?? config.requestTimeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  const hasBody = init.body !== undefined;
  const headers = new Headers();
  if (config.apiToken) headers.set('authorization', `Bearer ${config.apiToken}`);
  if (hasBody) headers.set('content-type', 'application/json');

  const response = await fetch(buildLoreApiUrl(config, pathname, init.search).toString(), {
    method: init.method ?? 'GET',
    headers,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal,
  });
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (cause) {
      if (response.ok) {
        throw new LoreApiError('Lore returned invalid JSON.', {
          status: response.status,
          code: 'invalid_json',
          cause,
        });
      }
      payload = text;
    }
  }

  if (!response.ok) {
    throw new LoreApiError(
      errorMessage(payload, `${response.status} ${response.statusText}`.trim()),
      {
        status: response.status,
        code: errorCode(payload, 'http_error'),
      },
    );
  }

  return payload as T;
}
