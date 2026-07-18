const DEFAULT_DOMAIN = 'core';

export interface MemoryLocator {
  domain: string;
  path: string;
}

export interface ResolveMemoryLocatorOptions {
  defaultDomain?: string;
  domainKey?: string;
  pathKey?: string;
  uriKey?: string;
  allowEmptyPath?: boolean;
  label?: string;
}

export function trimSlashes(value: unknown): string {
  return String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
}

export function parseMemoryURI(value: unknown, fallbackDomain = DEFAULT_DOMAIN): MemoryLocator {
  const raw = String(value ?? '').trim();
  if (!raw) return { domain: fallbackDomain, path: '' };
  if (raw.includes('://')) {
    const [domainPart, pathPart = ''] = raw.split('://', 2);
    return {
      domain: domainPart.trim() || fallbackDomain,
      path: trimSlashes(pathPart),
    };
  }
  return { domain: fallbackDomain, path: trimSlashes(raw) };
}

function sameLocator(first: MemoryLocator, second: MemoryLocator): boolean {
  return first.domain === second.domain && first.path === second.path;
}

export function resolveMemoryLocator(
  params: Record<string, unknown>,
  options: ResolveMemoryLocatorOptions = {},
): MemoryLocator {
  const {
    defaultDomain = DEFAULT_DOMAIN,
    domainKey = 'domain',
    pathKey = 'path',
    uriKey = 'uri',
    allowEmptyPath = true,
    label = 'path',
  } = options;
  const domainValue = params[domainKey];
  const pathValue = params[pathKey];
  const uriValue = params[uriKey];
  const explicitDomain = typeof domainValue === 'string' && domainValue.trim()
    ? domainValue.trim()
    : '';
  const fallbackDomain = explicitDomain || defaultDomain;
  const rawPath = typeof pathValue === 'string' ? pathValue.trim() : '';
  const rawURI = typeof uriValue === 'string' ? uriValue.trim() : '';

  if (rawPath.includes('://')) {
    throw new Error(
      `Invalid ${pathKey}: expected a relative path inside ${domainKey}, got a full URI. `
      + `Pass ${uriKey}="domain://path" instead.`,
    );
  }

  const pathLocator = { domain: fallbackDomain, path: trimSlashes(rawPath) };
  const uriLocator = rawURI ? parseMemoryURI(rawURI, fallbackDomain) : null;

  if (uriLocator && rawPath && !sameLocator(uriLocator, pathLocator)) {
    throw new Error(
      `Conflicting ${uriKey} and ${pathKey}: ${uriLocator.domain}://${uriLocator.path} `
      + `vs ${pathLocator.domain}://${pathLocator.path}`,
    );
  }
  if (uriLocator && explicitDomain && uriLocator.domain !== explicitDomain) {
    throw new Error(`Conflicting ${uriKey} and ${domainKey}: ${uriLocator.domain} vs ${explicitDomain}`);
  }

  const locator = uriLocator ?? pathLocator;
  if (!allowEmptyPath && !locator.path) {
    throw new Error(
      `${label} is required. Pass ${uriKey}="domain://path" or ${pathKey}="relative/path".`,
    );
  }
  return locator;
}

export function splitParentPathAndTitle(path: string): { parentPath: string; title: string } {
  const segments = trimSlashes(path).split('/').filter(Boolean);
  if (segments.length === 0) return { parentPath: '', title: '' };
  return {
    parentPath: segments.slice(0, -1).join('/'),
    title: segments.at(-1) ?? '',
  };
}
