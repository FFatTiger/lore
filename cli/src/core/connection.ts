import type { TokenAction } from './types.js';

export function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Lore base URL must be a valid http or https URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Lore base URL must use http or https');
  }
  parsed.hash = '';
  parsed.search = '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

export function resolveTokenDecision(input: {
  savedBaseUrl?: string;
  savedToken?: string;
  targetBaseUrl: string;
  requestedToken?: string;
  explicitToken: boolean;
  forceClear?: boolean;
}): { action: TokenAction; apiToken?: string } {
  if (input.forceClear) return { action: 'clear', apiToken: undefined };
  if (input.explicitToken) {
    const token = input.requestedToken?.trim();
    return token
      ? { action: 'set', apiToken: token }
      : { action: 'clear', apiToken: undefined };
  }

  const same = Boolean(input.savedBaseUrl) &&
    normalizeBaseUrl(input.savedBaseUrl!) === normalizeBaseUrl(input.targetBaseUrl);
  return same && input.savedToken
    ? { action: 'keep', apiToken: input.savedToken }
    : { action: 'clear', apiToken: undefined };
}

export function isInsecureHttpTokenTransport(baseUrl: string, apiToken?: string): boolean {
  if (!apiToken) return false;
  const parsed = new URL(normalizeBaseUrl(baseUrl));
  if (parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  const loopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host);
  return !loopback;
}

export function assertTokenTransport(
  baseUrl: string,
  apiToken?: string,
  opts: { allowInsecureHttp?: boolean } = {},
): void {
  if (isInsecureHttpTokenTransport(baseUrl, apiToken) && !opts.allowInsecureHttp) {
    throw new Error(
      'API tokens require HTTPS for non-loopback Lore servers (pass --allow-insecure-http to explicitly accept the risk for this run)',
    );
  }
}
