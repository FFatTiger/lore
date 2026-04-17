export interface PathEntry {
  domain: string;
  path: string;
}

export interface Breadcrumb {
  path: string;
  label: string;
}

export function pickBestPath(
  paths: PathEntry[],
  contextDomain: string | null | undefined,
  prefix: string | null | undefined,
): PathEntry | null {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  if (paths.length === 1) return paths[0];

  if (contextDomain && prefix) {
    const tier1 = paths.find((item) => item.domain === contextDomain && item.path.startsWith(prefix));
    if (tier1) return tier1;
  }

  if (contextDomain) {
    const tier2 = paths.find((item) => item.domain === contextDomain);
    if (tier2) return tier2;
  }

  return paths[0];
}

export function buildBreadcrumbs(path: string | null | undefined): Breadcrumb[] {
  if (!path) return [{ path: '', label: 'root' }];
  const segments = path.split('/').filter(Boolean);
  const breadcrumbs: Breadcrumb[] = [{ path: '', label: 'root' }];
  let accumulated = '';
  for (const seg of segments) {
    accumulated = accumulated ? `${accumulated}/${seg}` : seg;
    breadcrumbs.push({ path: accumulated, label: seg });
  }
  return breadcrumbs;
}
