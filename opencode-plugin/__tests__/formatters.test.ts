import { describe, expect, it } from 'vitest';
import {
  formatBootView,
  formatNode,
  formatSearchResults,
  normalizeKeywordList,
} from '../formatters.js';

describe('OpenCode REST output formatters', () => {
  it('formats a memory node with children and glossary keywords', () => {
    expect(formatNode({
      node: {
        uri: 'project://runtime/opencode',
        node_uuid: 'node-1',
        priority: 1,
        disclosure: 'when integrating OpenCode',
        aliases: ['OpenCode runtime'],
        content: 'Native integration contract.',
        glossary_keywords: ['OpenCode', 'native tools'],
      },
      children: [{
        uri: 'project://runtime/opencode/hooks',
        priority: 2,
        content_snippet: 'System and prompt hooks.',
      }],
    })).toContain([
      'URI: project://runtime/opencode',
      'Node UUID: node-1',
      'Priority: 1',
      'Disclosure: when integrating OpenCode',
      'Aliases: OpenCode runtime',
      '',
      'Native integration contract.',
      '',
      'Children:',
      '- project://runtime/opencode/hooks (priority: 2)',
      '  System and prompt hooks.',
      '',
      'Glossary keywords: OpenCode, native tools',
    ].join('\n'));
  });

  it('formats the fixed Boot view and active OpenCode client node', () => {
    const text = formatBootView({
      loaded: 1,
      total: 1,
      core_memories: [{
        uri: 'core://agent/opencode',
        scope: 'client',
        boot_role_label: 'opencode runtime constraints',
        boot_purpose: 'Native tools and lifecycle hooks.',
        priority: 0,
        content: 'Use native Lore tools.',
      }],
    });

    expect(text).toContain('# Loaded: 1/1 memories');
    expect(text).toContain('active client-specific agent node');
    expect(text).toContain('core://agent/opencode — opencode runtime constraints');
    expect(text).toContain('Use native Lore tools.');
  });

  it('formats search results with score, date, disclosure, snippet, and closing cue', () => {
    expect(formatSearchResults({ results: [] })).toBe('No matching memories found.');
    expect(formatSearchResults({
      results: [
        {
          uri: 'project://runtime/opencode',
          score_display: 0.875,
          updated_at: '2026-10-15T10:43:56Z',
          disclosure: 'when integrating OpenCode',
          snippet: 'best matching passage',
          cues: ['OpenCode', 'native tools'],
        },
        {
          uri: 'core://c',
          score: 0.5,
          content: 'Full   content with\nspacing',
        },
      ],
    })).toBe([
      '1. project://runtime/opencode  (0.88 · 2026-10-15)',
      '   when: when integrating OpenCode',
      '   > best matching passage',
      '2. core://c  (0.50)',
      '   > Full content with spacing',
      '',
      'Open a node with lore_get_node for full content.',
    ].join('\n'));
  });

  it('appends result 1 content after --- when full is requested', () => {
    expect(formatSearchResults({
      results: [
        { uri: 'project://runtime/opencode', score_display: 0.875, snippet: 'passage', content: 'Full memory content.' },
        { uri: 'core://c', score_display: 0.4 },
      ],
    }, null, true)).toBe([
      '1. project://runtime/opencode  (0.88)',
      '   > passage',
      '2. core://c  (0.40)',
      '',
      '---',
      '',
      'Full memory content.',
      '',
      'Open a node with lore_get_node for full content.',
    ].join('\n'));
  });

  it('omits absent score, date, disclosure, and passage', () => {
    expect(formatSearchResults({ results: [{ uri: 'core://c' }] })).toBe([
      '1. core://c',
      '',
      'Open a node with lore_get_node for full content.',
    ].join('\n'));
  });

  it('normalizes keyword lists with trim and case-insensitive deduplication', () => {
    expect(normalizeKeywordList([' OpenCode ', 'opencode', '', null, 'Native Tools']))
      .toEqual(['OpenCode', 'Native Tools']);
    expect(normalizeKeywordList('OpenCode')).toEqual([]);
  });
});
