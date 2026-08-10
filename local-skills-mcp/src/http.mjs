/**
 * Thin HTTP client for ${LORE_BASE_URL}/api/skills* with Bearer auth + client_type.
 */

export function authHeaders(config, includeJson = true) {
  const headers = {};
  if (includeJson) headers['content-type'] = 'application/json';
  if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`;
  return headers;
}

export function buildSkillsUrl(config, skillPath = '') {
  const raw = String(skillPath || '');
  const normalized = raw.startsWith('/') ? raw : raw ? `/${raw}` : '';
  const url = new URL(`/api/skills${normalized}`, `${config.baseUrl}/`);
  url.searchParams.set('client_type', config.clientType);
  return url.toString();
}

export async function fetchSkillsJson(config, skillPath, options = {}) {
  const url = buildSkillsUrl(config, skillPath);
  const method = options.method || 'GET';
  const response = await fetch(url, {
    ...options,
    method,
    headers: {
      ...authHeaders(config, method !== 'GET'),
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(config.timeoutMs || 30000),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail = data?.detail || data?.error || text || `${response.status} ${response.statusText}`;
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}
