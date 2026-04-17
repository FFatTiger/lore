import { describe, it, expect } from 'vitest';

import { buildBreadcrumbs, pickBestPath } from '../browsePaths';

// ---------------------------------------------------------------------------
// pickBestPath
// ---------------------------------------------------------------------------

describe('pickBestPath', () => {
  it('returns null for empty array', () => {
    expect(pickBestPath([], 'core', 'foo/')).toBeNull();
  });

  it('returns null for non-array input', () => {
    // @ts-expect-error testing invalid input
    expect(pickBestPath(null, 'core', 'foo/')).toBeNull();
  });

  it('returns the single element when only one path', () => {
    const paths = [{ domain: 'core', path: 'a/b' }];
    expect(pickBestPath(paths, 'core', 'a/')).toEqual({ domain: 'core', path: 'a/b' });
  });

  it('prefers path matching domain AND prefix (tier 1)', () => {
    const paths = [
      { domain: 'other', path: 'x/child' },
      { domain: 'core', path: 'foo/child' },
      { domain: 'core', path: 'bar/child' },
    ];
    expect(pickBestPath(paths, 'core', 'foo/')).toEqual({ domain: 'core', path: 'foo/child' });
  });

  it('falls back to domain match when no prefix match (tier 2)', () => {
    const paths = [
      { domain: 'other', path: 'x/child' },
      { domain: 'core', path: 'baz/child' },
    ];
    expect(pickBestPath(paths, 'core', 'nope/')).toEqual({ domain: 'core', path: 'baz/child' });
  });

  it('falls back to first element when no domain match', () => {
    const paths = [
      { domain: 'alpha', path: 'a/b' },
      { domain: 'beta', path: 'c/d' },
    ];
    expect(pickBestPath(paths, 'gamma', 'x/')).toEqual({ domain: 'alpha', path: 'a/b' });
  });

  it('returns first element when contextDomain is null', () => {
    const paths = [
      { domain: 'alpha', path: 'a/b' },
      { domain: 'beta', path: 'c/d' },
    ];
    expect(pickBestPath(paths, null, null)).toEqual({ domain: 'alpha', path: 'a/b' });
  });
});

// ---------------------------------------------------------------------------
// buildBreadcrumbs
// ---------------------------------------------------------------------------

describe('buildBreadcrumbs', () => {
  it('returns root-only crumb for empty path', () => {
    expect(buildBreadcrumbs('')).toEqual([{ path: '', label: 'root' }]);
  });

  it('returns root-only crumb for null/undefined', () => {
    expect(buildBreadcrumbs(null)).toEqual([{ path: '', label: 'root' }]);
    expect(buildBreadcrumbs(undefined)).toEqual([{ path: '', label: 'root' }]);
  });

  it('builds single-segment breadcrumb', () => {
    expect(buildBreadcrumbs('animals')).toEqual([
      { path: '', label: 'root' },
      { path: 'animals', label: 'animals' },
    ]);
  });

  it('builds multi-segment breadcrumbs with accumulated paths', () => {
    expect(buildBreadcrumbs('a/b/c')).toEqual([
      { path: '', label: 'root' },
      { path: 'a', label: 'a' },
      { path: 'a/b', label: 'b' },
      { path: 'a/b/c', label: 'c' },
    ]);
  });

  it('ignores leading/trailing slashes via filter', () => {
    const crumbs = buildBreadcrumbs('/a/b/');
    expect(crumbs.length).toBe(3);
    expect(crumbs[1].label).toBe('a');
    expect(crumbs[2].label).toBe('b');
  });
});
