import { describe, it, expect, vi } from 'vitest';

// Mock external dependencies that mcpFormatters imports
vi.mock('../lore/glossary', () => ({
  addGlossaryKeyword: vi.fn(),
  removeGlossaryKeyword: vi.fn(),
}));

import {
  ok,
  fail,
  formatPolicyResult,
  trimSlashes,
  normalizeKeywordList,
  resolveUri,
  formatNode,
  formatBootView,
} from '../mcpFormatters';

// ── ok / fail ─────────────────────────────────────────────────────

describe('ok', () => {
  it('wraps text in MCP content format', () => {
    const result = ok('hello');
    expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('does not set isError', () => {
    const result = ok('msg');
    expect(result.isError).toBeUndefined();
  });
});

describe('fail', () => {
  it('wraps error message with prefix', () => {
    const result = fail('Op failed', new Error('boom'));
    expect(result.content[0].text).toBe('Op failed: boom');
    expect(result.isError).toBe(true);
  });

  it('handles string error', () => {
    const result = fail('Op failed', 'string error');
    expect(result.content[0].text).toBe('Op failed: string error');
  });

  it('handles null/undefined error', () => {
    const result = fail('Op failed', null);
    expect(result.content[0].text).toBe('Op failed: null');
    expect(result.isError).toBe(true);
  });
});

// ── trimSlashes ───────────────────────────────────────────────────

describe('trimSlashes', () => {
  it('strips leading and trailing slashes', () => {
    expect(trimSlashes('/foo/bar/')).toBe('foo/bar');
  });

  it('trims whitespace', () => {
    expect(trimSlashes('  /path/  ')).toBe('path');
  });

  it('handles empty/null input', () => {
    expect(trimSlashes('')).toBe('');
    expect(trimSlashes(null)).toBe('');
    expect(trimSlashes(undefined)).toBe('');
  });

  it('handles multiple leading slashes', () => {
    expect(trimSlashes('///multi///')).toBe('multi');
  });
});

// ── normalizeKeywordList ──────────────────────────────────────────

describe('normalizeKeywordList', () => {
  it('deduplicates case-insensitively', () => {
    expect(normalizeKeywordList(['Foo', 'foo', 'FOO'])).toEqual(['Foo']);
  });

  it('filters empty strings', () => {
    expect(normalizeKeywordList(['', ' ', 'a'])).toEqual(['a']);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeKeywordList(null)).toEqual([]);
    expect(normalizeKeywordList(undefined)).toEqual([]);
    expect(normalizeKeywordList('string')).toEqual([]);
  });

  it('preserves order of first occurrence', () => {
    expect(normalizeKeywordList(['b', 'a', 'B', 'c'])).toEqual(['b', 'a', 'c']);
  });
});

// ── resolveUri ────────────────────────────────────────────────────

describe('resolveUri', () => {
  it('parses domain://path format', () => {
    expect(resolveUri({ uri: 'core://soul/identity' })).toEqual({
      domain: 'core',
      path: 'soul/identity',
    });
  });

  it('uses default domain for bare path', () => {
    expect(resolveUri({ uri: 'some/path' }, 'mydom')).toEqual({
      domain: 'mydom',
      path: 'some/path',
    });
  });

  it('returns empty path when uri is empty', () => {
    expect(resolveUri({ uri: '' })).toEqual({ domain: 'core', path: '' });
    expect(resolveUri(undefined)).toEqual({ domain: 'core', path: '' });
  });

  it('strips slashes from path part', () => {
    expect(resolveUri({ uri: 'core:///path/' })).toEqual({
      domain: 'core',
      path: 'path',
    });
  });

  it('falls back to default domain for empty domain part', () => {
    expect(resolveUri({ uri: '://path' }, 'fallback')).toEqual({
      domain: 'fallback',
      path: 'path',
    });
  });
});

// ── formatPolicyResult ────────────────────────────────────────────

describe('formatPolicyResult', () => {
  it('returns base text when no warnings', () => {
    expect(formatPolicyResult('Created node')).toBe('Created node');
    expect(formatPolicyResult('Created node', [])).toBe('Created node');
  });

  it('appends warnings', () => {
    const result = formatPolicyResult('Created node', ['warn1', 'warn2']);
    expect(result).toContain('Policy warnings:');
    expect(result).toContain('warn1');
    expect(result).toContain('warn2');
  });
});

// ── formatNode ────────────────────────────────────────────────────

describe('formatNode', () => {
  it('formats node with all fields', () => {
    const text = formatNode({
      node: {
        uri: 'core://soul',
        node_uuid: 'uuid-1',
        priority: 0,
        disclosure: 'always',
        aliases: ['alt://agent'],
        content: 'I am an agent.',
        glossary_keywords: ['identity', 'agent'],
      },
      children: [
        { uri: 'core://agent/sub', priority: 1, content_snippet: 'child content' },
      ],
    });
    expect(text).toContain('URI: core://soul');
    expect(text).toContain('Node UUID: uuid-1');
    expect(text).toContain('Priority: 0');
    expect(text).toContain('Disclosure: always');
    expect(text).toContain('Aliases: alt://agent');
    expect(text).toContain('I am an agent.');
    expect(text).toContain('Children:');
    expect(text).toContain('- core://agent/sub (priority: 1)');
    expect(text).toContain('  child content');
    expect(text).toContain('Glossary keywords: identity, agent');
  });

  it('handles empty/undefined data', () => {
    const text = formatNode(undefined);
    expect(text).toContain('URI: ');
    expect(text).toContain('(empty)');
  });

  it('omits optional fields when absent', () => {
    const text = formatNode({ node: { uri: 'core://x', content: 'stuff' } });
    expect(text).not.toContain('Disclosure:');
    expect(text).not.toContain('Aliases:');
    expect(text).not.toContain('Children:');
    expect(text).not.toContain('Glossary keywords:');
  });
});

// ── formatBootView ────────────────────────────────────────────────

describe('formatBootView', () => {
  it('formats core and recent memories', () => {
    const text = formatBootView({
      core_memories: [
        {
          uri: 'core://soul',
          priority: 0,
          content: 'identity',
          node_uuid: 'u1',
          boot_role_label: 'style / persona / self-definition',
          boot_purpose: 'Agent style, persona, and self-cognition baseline.',
        },
      ],
      recent_memories: [
        { uri: 'log://entry', priority: 2, created_at: '2025-01-01' },
      ],
      loaded: 1,
      total: 3,
    });
    expect(text).toContain('# Core Memories');
    expect(text).toContain('# Loaded: 1/3 memories');
    expect(text).toContain('## Fixed boot baseline:');
    expect(text).toContain('core://agent — workflow constraints');
    expect(text).toContain('Role: style / persona / self-definition');
    expect(text).toContain('Purpose: Agent style, persona, and self-cognition baseline.');
    expect(text).toContain('identity');
    expect(text).toContain('# Recent Memories');
    expect(text).toContain('- log://entry (priority: 2, created: 2025-01-01)');
  });

  it('shows placeholder when no core memories', () => {
    const text = formatBootView({ core_memories: [] });
    expect(text).toContain('(No core memories loaded.)');
  });

  it('shows failed entries', () => {
    const text = formatBootView({ failed: ['core://broken'] });
    expect(text).toContain('## Failed to load:');
    expect(text).toContain('core://broken');
  });

  it('handles undefined data', () => {
    const text = formatBootView(undefined);
    expect(text).toContain('# Core Memories');
    expect(text).toContain('(No core memories loaded.)');
  });
});
