import { describe, expect, it } from 'vitest';
import {
  parseMemoryURI,
  resolveMemoryLocator,
  splitParentPathAndTitle,
  trimSlashes,
} from '../uri.js';

describe('OpenCode memory URI helpers', () => {
  it('parses full URIs, domain roots, and bare default-domain paths', () => {
    expect(parseMemoryURI(' project://runtime/opencode ')).toEqual({
      domain: 'project',
      path: 'runtime/opencode',
    });
    expect(parseMemoryURI('project://')).toEqual({ domain: 'project', path: '' });
    expect(parseMemoryURI('/runtime/opencode/', 'core')).toEqual({
      domain: 'core',
      path: 'runtime/opencode',
    });
  });

  it('trims only surrounding whitespace and slashes', () => {
    expect(trimSlashes('  /runtime/opencode///  ')).toBe('runtime/opencode');
  });

  it('resolves URI and relative path locators without ambiguity', () => {
    expect(resolveMemoryLocator({ uri: 'project://runtime/opencode' }, {
      defaultDomain: 'core',
      uriKey: 'uri',
      pathKey: 'path',
      allowEmptyPath: false,
      label: 'uri',
    })).toEqual({ domain: 'project', path: 'runtime/opencode' });

    expect(resolveMemoryLocator({ domain: 'project', path: '/runtime/opencode/' })).toEqual({
      domain: 'project',
      path: 'runtime/opencode',
    });
  });

  it('rejects conflicting or invalid locator inputs', () => {
    expect(() => resolveMemoryLocator({
      domain: 'core',
      path: 'runtime/a',
      uri: 'project://runtime/b',
    })).toThrow('Conflicting uri and path');
    expect(() => resolveMemoryLocator({ path: 'project://runtime/a' })).toThrow('expected a relative path');
    expect(() => resolveMemoryLocator({}, { allowEmptyPath: false, label: 'uri' })).toThrow('uri is required');
  });

  it('splits the final title and rejects an empty create target at the caller boundary', () => {
    expect(splitParentPathAndTitle('/runtime/opencode/')).toEqual({
      parentPath: 'runtime',
      title: 'opencode',
    });
    expect(splitParentPathAndTitle('/')).toEqual({ parentPath: '', title: '' });
  });
});
