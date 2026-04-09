import { describe, it, expect } from 'vitest';
import {
  parseMemoryUri,
  resolveMemoryLocator,
  splitParentPathAndTitle,
  trimSlashes,
  sameLocator,
} from '../index.ts';

describe('trimSlashes', () => {
  it('trims leading and trailing slashes', () => {
    expect(trimSlashes('///path/to///node///')).toBe('path/to///node');
  });

  it('trims whitespace', () => {
    expect(trimSlashes('  hello  ')).toBe('hello');
  });

  it('handles empty/null', () => {
    expect(trimSlashes('')).toBe('');
    expect(trimSlashes(null)).toBe('');
    expect(trimSlashes(undefined)).toBe('');
  });
});

describe('parseMemoryUri', () => {
  it('parses domain://path format', () => {
    expect(parseMemoryUri('core://path/to/node')).toEqual({ domain: 'core', path: 'path/to/node' });
  });

  it('parses custom domain', () => {
    expect(parseMemoryUri('preferences://theme')).toEqual({ domain: 'preferences', path: 'theme' });
  });

  it('defaults to fallback domain for bare paths', () => {
    expect(parseMemoryUri('some/path')).toEqual({ domain: 'core', path: 'some/path' });
  });

  it('uses custom fallback domain', () => {
    expect(parseMemoryUri('some/path', 'custom')).toEqual({ domain: 'custom', path: 'some/path' });
  });

  it('handles empty input', () => {
    expect(parseMemoryUri('')).toEqual({ domain: 'core', path: '' });
    expect(parseMemoryUri(null)).toEqual({ domain: 'core', path: '' });
  });

  it('defaults empty domain to fallback', () => {
    expect(parseMemoryUri('://some/path')).toEqual({ domain: 'core', path: 'some/path' });
  });

  it('strips slashes from path', () => {
    expect(parseMemoryUri('core:///leading/trailing//')).toEqual({ domain: 'core', path: 'leading/trailing' });
  });
});

describe('sameLocator', () => {
  it('returns true for matching locators', () => {
    expect(sameLocator({ domain: 'core', path: 'a' }, { domain: 'core', path: 'a' })).toBe(true);
  });

  it('returns false for different domains', () => {
    expect(sameLocator({ domain: 'core', path: 'a' }, { domain: 'other', path: 'a' })).toBe(false);
  });

  it('returns false for different paths', () => {
    expect(sameLocator({ domain: 'core', path: 'a' }, { domain: 'core', path: 'b' })).toBe(false);
  });
});

describe('resolveMemoryLocator', () => {
  it('resolves from path only', () => {
    const result = resolveMemoryLocator({ path: 'hello/world' });
    expect(result).toEqual({ domain: 'core', path: 'hello/world' });
  });

  it('resolves from uri only', () => {
    const result = resolveMemoryLocator({ uri: 'custom://deep/path' });
    expect(result).toEqual({ domain: 'custom', path: 'deep/path' });
  });

  it('resolves from domain + path', () => {
    const result = resolveMemoryLocator({ domain: 'prefs', path: 'theme' });
    expect(result).toEqual({ domain: 'prefs', path: 'theme' });
  });

  it('throws on conflicting uri and path', () => {
    expect(() =>
      resolveMemoryLocator({ uri: 'core://a', path: 'b' })
    ).toThrow(/Conflicting/);
  });

  it('throws on conflicting uri and domain', () => {
    expect(() =>
      resolveMemoryLocator({ uri: 'other://a', domain: 'core' })
    ).toThrow(/Conflicting/);
  });

  it('throws when path contains ://', () => {
    expect(() =>
      resolveMemoryLocator({ path: 'core://bad' })
    ).toThrow(/Invalid/);
  });

  it('throws when path required but empty', () => {
    expect(() =>
      resolveMemoryLocator({}, { allowEmptyPath: false })
    ).toThrow(/required/);
  });

  it('allows empty path by default', () => {
    const result = resolveMemoryLocator({});
    expect(result).toEqual({ domain: 'core', path: '' });
  });

  it('uses custom default domain', () => {
    const result = resolveMemoryLocator({ path: 'x' }, { defaultDomain: 'custom' });
    expect(result).toEqual({ domain: 'custom', path: 'x' });
  });
});

describe('splitParentPathAndTitle', () => {
  it('splits a multi-segment path', () => {
    expect(splitParentPathAndTitle('parent/child/leaf')).toEqual({
      parentPath: 'parent/child',
      title: 'leaf',
    });
  });

  it('handles single segment', () => {
    expect(splitParentPathAndTitle('leaf')).toEqual({
      parentPath: '',
      title: 'leaf',
    });
  });

  it('handles empty path', () => {
    expect(splitParentPathAndTitle('')).toEqual({
      parentPath: '',
      title: '',
    });
  });

  it('strips leading/trailing slashes', () => {
    expect(splitParentPathAndTitle('/a/b/')).toEqual({
      parentPath: 'a',
      title: 'b',
    });
  });
});
