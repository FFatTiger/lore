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

  it('formats search results and provides an explicit empty result', () => {
    expect(formatSearchResults({ results: [] })).toBe('No matching memories found.');
    expect(formatSearchResults({
      results: [{
        uri: 'project://runtime/opencode',
        priority: 1,
        score_display: 0.875,
        cues: ['OpenCode', 'native tools'],
        content: 'Full memory content.',
      }],
    })).toBe([
      '1. project://runtime/opencode (priority: 1, score: 0.875)',
      '   via: OpenCode, native tools',
      '   ---',
      'Full memory content.',
    ].join('\n'));
  });

  it('normalizes keyword lists with trim and case-insensitive deduplication', () => {
    expect(normalizeKeywordList([' OpenCode ', 'opencode', '', null, 'Native Tools']))
      .toEqual(['OpenCode', 'Native Tools']);
    expect(normalizeKeywordList('OpenCode')).toEqual([]);
  });
});
