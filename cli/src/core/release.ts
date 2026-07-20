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

export async function fetchReleaseTag(opts: {
  pre: boolean;
  dev: boolean;
  fetchImpl?: typeof fetch;
  repo?: string;
}): Promise<{ tag: string | null; needInstallHint: NeedInstall }> {
  if (opts.dev) {
    return { tag: 'dev', needInstallHint: 0 };
  }

  const repo = opts.repo || DEFAULT_REPO;
  const fetchFn = opts.fetchImpl ?? fetch;
  const apiUrl = opts.pre
    ? `https://api.github.com/repos/${repo}/releases?per_page=1`
    : `https://api.github.com/repos/${repo}/releases/latest`;

  try {
    const res = await fetchFn(apiUrl);
    if (!res.ok) {
      return { tag: null, needInstallHint: 1 };
    }
    const data: unknown = await res.json();
    let tag = '';
    if (opts.pre) {
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0] as { tag_name?: string };
        tag = first?.tag_name ?? '';
      }
    } else {
      const obj = data as { tag_name?: string };
      tag = obj?.tag_name ?? '';
    }
    if (!tag) {
      return { tag: null, needInstallHint: 1 };
    }
    // needInstallHint here is only network/tag discovery; install decision is resolveNeedInstall
    return { tag, needInstallHint: 0 };
  } catch {
    return { tag: null, needInstallHint: 1 };
  }
}
