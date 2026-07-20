import type { NeedInstall } from './types.js';

export type CompareResult = 'same' | 'older' | 'newer' | 'downgrade' | 'unknown';

/** [major, minor, patch, pre-release string, has 'pre' in pre-release] */
type ParsedVersion = [number, number, number, string, boolean];

/**
 * Port of scripts/install.sh check_release python parse():
 *   v = v.lstrip('v')
 *   m = re.match(r'(\d+)\.(\d+)\.(\d+)(?:-(.*))?', v)
 *   return (maj, min, pat, pre or '', 'pre' in (pre or ''))
 */
function parseVersion(v: string): ParsedVersion {
  // Python str.lstrip('v') strips any leading characters in the set {'v'}
  let s = v;
  while (s.startsWith('v')) s = s.slice(1);

  const m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/);
  if (!m) return [0, 0, 0, '', false];
  const pre = m[4] ?? '';
  return [Number(m[1]), Number(m[2]), Number(m[3]), pre, pre.includes('pre')];
}

/** Python 3 tuple comparison for ParsedVersion shape. */
function cmpTuple(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 5; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av < bv ? -1 : 1;
    if (typeof av === 'string' && typeof bv === 'string') {
      if (av < bv) return -1;
      if (av > bv) return 1;
      continue;
    }
    if (typeof av === 'boolean' && typeof bv === 'boolean') {
      // Python: False < True
      return av === false ? -1 : 1;
    }
    return 0;
  }
  return 0;
}

/**
 * Port of scripts/install.sh check_release python compare block.
 * Returns relation of *installed* relative to *release*:
 * - 'older'  → installed is behind release (upgrade available)
 * - 'newer'  → installed ahead of release
 * - 'same'   → equal
 * - 'downgrade' → installed stable, release is pre at same x.y.z
 * - 'unknown' → parse/compare failure
 */
export function compareRelease(installed: string, release: string): CompareResult {
  try {
    const a = parseVersion(installed);
    const b = parseVersion(release);

    // pre-release < stable at same version
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) {
      if (a[4] && !b[4]) return 'older'; // installed pre, release stable → upgrade
      if (!a[4] && b[4]) return 'downgrade'; // installed stable, release pre → skip
      if (a[3] === b[3] && a[4] === b[4]) return 'same';
      return cmpTuple(a, b) > 0 ? 'newer' : 'older';
    }
    return cmpTuple(a, b) > 0 ? 'newer' : 'older';
  } catch {
    return 'unknown';
  }
}

/**
 * Shell NEED_INSTALL matrix (when release tag is known):
 * - force + installed present → 0
 * - cmp same | newer | downgrade → 2 (skip)
 * - else (older | unknown) → 0
 * - no installed → 0
 */
export function resolveNeedInstall(args: {
  installed?: string;
  release: string;
  force: boolean;
}): NeedInstall {
  const installed = args.installed?.trim() || '';
  if (!installed) return 0;
  if (args.force) return 0;

  const cmp = compareRelease(installed, args.release);
  if (cmp === 'same' || cmp === 'newer' || cmp === 'downgrade') return 2;
  return 0;
}

const DEFAULT_REPO = 'FFatTiger/lore';
const DEFAULT_UA = 'loremem-cli (@loremem/cli)';

function githubHeaders(): HeadersInit {
  return {
    'User-Agent': DEFAULT_UA,
    Accept: 'application/vnd.github+json',
  };
}

/** Extract tag from a GitHub release URL / Location header. */
export function tagFromGithubReleaseUrl(url: string): string | null {
  // https://github.com/org/repo/releases/tag/v1.2.3
  const m = url.match(/\/releases\/tag\/([^/?#]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/**
 * Resolve latest stable tag without API quota:
 * GET/HEAD https://github.com/{repo}/releases/latest → redirect to .../tag/vX.Y.Z
 */
export async function fetchLatestTagViaRedirect(opts: {
  repo?: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const repo = opts.repo || DEFAULT_REPO;
  const fetchFn = opts.fetchImpl ?? fetch;
  const url = `https://github.com/${repo}/releases/latest`;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': DEFAULT_UA },
    });
    const loc = res.headers.get('location') || res.headers.get('Location');
    if (loc) {
      const tag = tagFromGithubReleaseUrl(loc);
      if (tag) return tag;
    }
    // Some environments auto-follow redirects; try final URL
    if (res.url) {
      const tag = tagFromGithubReleaseUrl(res.url);
      if (tag) return tag;
    }
    // Follow one hop if we got a redirect status but no location (rare)
    if (res.status >= 300 && res.status < 400) {
      return null;
    }
    // If auto-followed, body/url may still include tag in url
    return tagFromGithubReleaseUrl(String(res.url || ''));
  } catch {
    return null;
  }
}

/**
 * Pre-release: try API list first; if rate-limited, fall back to latest redirect
 * (best-effort — may return stable when pre list is unavailable).
 */
async function fetchPreTag(opts: {
  repo: string;
  fetchImpl: typeof fetch;
}): Promise<string | null> {
  try {
    const res = await opts.fetchImpl(
      `https://api.github.com/repos/${opts.repo}/releases?per_page=10`,
      { headers: githubHeaders() },
    );
    if (res.ok) {
      const data: unknown = await res.json();
      if (Array.isArray(data)) {
        // Prefer first prerelease, else first item (shell used per_page=1)
        for (const item of data) {
          const row = item as { tag_name?: string; prerelease?: boolean };
          if (row.prerelease && row.tag_name) return row.tag_name;
        }
        const first = data[0] as { tag_name?: string } | undefined;
        if (first?.tag_name) return first.tag_name;
      }
    }
  } catch {
    // fall through
  }
  return fetchLatestTagViaRedirect({ repo: opts.repo, fetchImpl: opts.fetchImpl });
}

async function fetchStableTag(opts: {
  repo: string;
  fetchImpl: typeof fetch;
}): Promise<string | null> {
  // 1) Prefer non-API redirect (no rate limit)
  const viaRedirect = await fetchLatestTagViaRedirect({
    repo: opts.repo,
    fetchImpl: opts.fetchImpl,
  });
  if (viaRedirect) return viaRedirect;

  // 2) API fallback with UA
  try {
    const res = await opts.fetchImpl(
      `https://api.github.com/repos/${opts.repo}/releases/latest`,
      { headers: githubHeaders() },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    return data.tag_name ?? null;
  } catch {
    return null;
  }
}

export async function fetchReleaseTag(opts: {
  pre: boolean;
  dev: boolean;
  fetchImpl?: typeof fetch;
  repo?: string;
}): Promise<{ tag: string | null; needInstallHint: NeedInstall; error?: string }> {
  if (opts.dev) {
    return { tag: 'dev', needInstallHint: 0 };
  }

  const repo = opts.repo || DEFAULT_REPO;
  const fetchFn = opts.fetchImpl ?? fetch;

  const tag = opts.pre
    ? await fetchPreTag({ repo, fetchImpl: fetchFn })
    : await fetchStableTag({ repo, fetchImpl: fetchFn });

  if (!tag) {
    return {
      tag: null,
      needInstallHint: 1,
      error:
        'Could not resolve GitHub release tag (API rate limit or network). Try again, use --pre/--dev, or set a reachable network path to github.com.',
    };
  }
  return { tag, needInstallHint: 0 };
}
