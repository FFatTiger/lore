import { describe, it, expect } from 'vitest';
import {
  formatNode,
  formatBootView,
  formatRecallBlock,
  readCueList,
  normalizeSearchResults,
  normalizeKeywordList,
  normalizeUriList,
} from '../index.ts';

describe('formatNode', () => {
  it('formats a basic node', () => {
    const result = formatNode({
      node: { uri: 'core://test', priority: 0, content: 'Hello world' },
    });
    expect(result).toContain('URI: core://test');
    expect(result).toContain('Priority: 0');
    expect(result).toContain('Hello world');
  });

  it('includes children', () => {
    const result = formatNode({
      node: { uri: 'core://parent', priority: 0, content: 'parent' },
      children: [
        { uri: 'core://parent/child', priority: 1, content_snippet: 'snippet' },
      ],
    });
    expect(result).toContain('Children:');
    expect(result).toContain('core://parent/child');
    expect(result).toContain('snippet');
  });

  it('includes aliases', () => {
    const result = formatNode({
      node: { uri: 'core://a', priority: 0, content: '', aliases: ['core://b', 'core://c'] },
    });
    expect(result).toContain('Aliases: core://b, core://c');
  });

  it('includes glossary keywords', () => {
    const result = formatNode({
      node: { uri: 'core://a', priority: 0, content: '', glossary_keywords: ['kw1', 'kw2'] },
    });
    expect(result).toContain('Glossary keywords: kw1, kw2');
  });

  it('shows (empty) for no content', () => {
    const result = formatNode({
      node: { uri: 'core://a', priority: 0, content: '' },
    });
    expect(result).toContain('(empty)');
  });

  it('handles null/undefined data', () => {
    expect(formatNode(null)).toContain('URI:');
    expect(formatNode({})).toContain('(empty)');
  });

  it('includes node_uuid when present', () => {
    const result = formatNode({
      node: { uri: 'core://a', node_uuid: 'abc-123', priority: 0, content: '' },
    });
    expect(result).toContain('Node UUID: abc-123');
  });

  it('includes disclosure when present', () => {
    const result = formatNode({
      node: { uri: 'core://a', priority: 0, content: '', disclosure: 'secret' },
    });
    expect(result).toContain('Disclosure: secret');
  });
});

describe('formatBootView', () => {
  it('formats boot view with core memories', () => {
    const result = formatBootView({
      loaded: 2,
      total: 2,
      failed: [],
      core_memories: [
        { uri: 'core://identity', priority: 0, content: 'I am AI', node_uuid: 'uuid-1' },
        { uri: 'core://prefs', priority: 1, content: 'User likes dark mode' },
      ],
      recent_memories: [],
    });
    expect(result).toContain('# Core Memories');
    expect(result).toContain('Loaded: 2/2');
    expect(result).toContain('### core://identity');
    expect(result).toContain('I am AI');
    expect(result).toContain('### core://prefs');
  });

  it('shows failed URIs', () => {
    const result = formatBootView({
      loaded: 0,
      total: 1,
      failed: ['- core://missing: not found'],
      core_memories: [],
      recent_memories: [],
    });
    expect(result).toContain('Failed to load');
    expect(result).toContain('core://missing: not found');
  });

  it('shows recent memories', () => {
    const result = formatBootView({
      loaded: 0,
      total: 0,
      failed: [],
      core_memories: [],
      recent_memories: [
        { uri: 'core://recent', priority: 0, created_at: '2024-01-01T00:00:00Z' },
      ],
    });
    expect(result).toContain('Recent Memories');
    expect(result).toContain('core://recent');
  });

  it('handles empty data', () => {
    const result = formatBootView({});
    expect(result).toContain('No core memories loaded');
  });

  it('handles null', () => {
    const result = formatBootView(null);
    expect(result).toContain('Loaded: 0/0');
  });
});

describe('formatRecallBlock', () => {
  it('formats recall items', () => {
    const result = formatRecallBlock([
      { uri: 'core://a', score_display: 0.85, cues: ['hello', 'world'] },
      { uri: 'core://b', score_display: 0.72, cues: ['test'] },
    ]);
    expect(result).toContain('<recall>');
    expect(result).toContain('</recall>');
    expect(result).toContain('core://a');
    expect(result).toContain('core://b');
    expect(result).toContain('hello');
  });

  it('returns empty string for empty/null items', () => {
    expect(formatRecallBlock([])).toBe('');
    expect(formatRecallBlock(null)).toBe('');
  });

  it('respects precision', () => {
    const result = formatRecallBlock(
      [{ uri: 'core://a', score_display: 0.123456, cues: [] }],
      3,
    );
    expect(result).toContain('0.123');
  });

  it('marks read items', () => {
    const result = formatRecallBlock([
      { uri: 'core://a', score_display: 0.9, read: true, cues: ['term'] },
    ]);
    expect(result).toContain('read');
  });
});

describe('readCueList', () => {
  it('extracts and cleans cues', () => {
    expect(readCueList({ cues: ['hello', 'world'] })).toEqual(['hello', 'world']);
  });

  it('limits to 3 items', () => {
    expect(readCueList({ cues: ['a', 'b', 'c', 'd'] })).toHaveLength(3);
  });

  it('collapses whitespace', () => {
    expect(readCueList({ cues: ['hello  world'] })).toEqual(['hello world']);
  });

  it('filters empty values', () => {
    expect(readCueList({ cues: ['a', '', null, 'b'] })).toEqual(['a', 'b']);
  });

  it('handles missing cues', () => {
    expect(readCueList({})).toEqual([]);
    expect(readCueList(null)).toEqual([]);
  });
});

describe('normalizeSearchResults', () => {
  it('returns array as-is', () => {
    expect(normalizeSearchResults([1, 2])).toEqual([1, 2]);
  });

  it('extracts results property', () => {
    expect(normalizeSearchResults({ results: [3, 4] })).toEqual([3, 4]);
  });

  it('returns empty for other types', () => {
    expect(normalizeSearchResults('string')).toEqual([]);
    expect(normalizeSearchResults(null)).toEqual([]);
  });
});

describe('normalizeKeywordList', () => {
  it('deduplicates case-insensitively', () => {
    expect(normalizeKeywordList(['Hello', 'hello', 'HELLO'])).toEqual(['Hello']);
  });

  it('filters empty values', () => {
    expect(normalizeKeywordList(['a', '', null, 'b'])).toEqual(['a', 'b']);
  });

  it('returns empty for non-array', () => {
    expect(normalizeKeywordList(null)).toEqual([]);
    expect(normalizeKeywordList('string')).toEqual([]);
  });
});

describe('normalizeUriList', () => {
  it('deduplicates URIs', () => {
    expect(normalizeUriList([{ uri: 'a' }, { uri: 'b' }, { uri: 'a' }])).toEqual(['a', 'b']);
  });

  it('handles string items', () => {
    expect(normalizeUriList(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('filters empty values', () => {
    expect(normalizeUriList(['a', '', null])).toEqual(['a']);
  });

  it('returns empty for non-array', () => {
    expect(normalizeUriList(null)).toEqual([]);
  });
});
