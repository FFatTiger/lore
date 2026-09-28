export type LoreCapabilities = Record<string, boolean>;

export type LoreServerProfile = {
  base_url: string;
  edition?: string;
  capabilities: LoreCapabilities;
};

function normalizeCapabilities(value: unknown): LoreCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: LoreCapabilities = {};
  for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (enabled === true) out[key] = true;
  }
  return out;
}

/**
 * Probe the authenticated Lore health endpoint for optional product capabilities.
 * Missing fields, 404s, auth errors, unsupported OSS servers, and network failures
 * all fail closed to an empty capability set while preserving Memory installation.
 */
export async function fetchServerProfile(opts: {
  baseUrl: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<LoreServerProfile> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const url = new URL('/api/health', `${baseUrl}/`);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.apiToken) headers.authorization = `Bearer ${opts.apiToken}`;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    if (!response.ok) return { base_url: baseUrl, capabilities: {} };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { base_url: baseUrl, capabilities: {} };
    }
    const record = payload as Record<string, unknown>;
    const edition = typeof record.edition === 'string' && record.edition.trim()
      ? record.edition.trim()
      : undefined;
    return {
      base_url: baseUrl,
      ...(edition ? { edition } : {}),
      capabilities: normalizeCapabilities(record.capabilities),
    };
  } catch {
    return { base_url: baseUrl, capabilities: {} };
  }
}

export function hasCapability(
  profile: LoreServerProfile | undefined,
  baseUrl: string | undefined,
  name: string,
): boolean {
  if (!profile || !baseUrl) return false;
  return profile.base_url.replace(/\/+$/, '').toLowerCase() === baseUrl.replace(/\/+$/, '').toLowerCase()
    && profile.capabilities?.[name] === true;
}
