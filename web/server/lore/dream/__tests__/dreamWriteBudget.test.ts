import { describe, it, expect } from 'vitest';
import {
  DREAM_HYGIENE_WRITE_CAP,
  DREAM_CONTENT_WRITE_CAP,
  dreamHygieneCapBlockedResult,
  dreamWriteCapBlockedResult,
  isDreamHygieneWrite,
  isDreamWriteTool,
} from '../dreamWriteBudget';

describe('isDreamWriteTool', () => {
  it('covers every mutation tool Dream can call', () => {
    for (const name of ['create_node', 'update_node', 'delete_node', 'move_node']) {
      expect(isDreamWriteTool(name)).toBe(true);
    }
    expect(isDreamWriteTool('replay_recall')).toBe(false);
    expect(isDreamWriteTool('hygiene_audit')).toBe(false);
  });
});

describe('isDreamHygieneWrite', () => {
  it('classifies glossary-only updates as hygiene operations', () => {
    expect(isDreamHygieneWrite('update_node', {
      uri: 'project://lore/dream',
      glossary_remove: ['duplicate', 'generic'],
    })).toBe(true);
  });

  it('treats any content, priority, disclosure, or glossary addition as a content change', () => {
    const base = { uri: 'project://lore/dream', glossary_remove: ['duplicate'] };
    expect(isDreamHygieneWrite('update_node', { ...base, content: 'new body' })).toBe(false);
    expect(isDreamHygieneWrite('update_node', { ...base, priority: 1 })).toBe(false);
    expect(isDreamHygieneWrite('update_node', { ...base, disclosure: 'when editing dream' })).toBe(false);
    expect(isDreamHygieneWrite('update_node', { ...base, glossary_add: ['new keyword'] })).toBe(false);
  });

  it('requires a glossary removal for a hygiene update', () => {
    expect(isDreamHygieneWrite('update_node', { uri: 'project://lore/dream' })).toBe(false);
    expect(isDreamHygieneWrite('update_node', { uri: 'project://lore/dream', glossary_remove: [] })).toBe(false);
  });

  it('classifies moves out of a legacy domain into a canonical domain as hygiene operations', () => {
    expect(isDreamHygieneWrite('move_node', {
      old_uri: 'work://notes/dream',
      new_uri: 'project://lore/dream',
    })).toBe(true);
  });

  it('treats other moves as content changes', () => {
    expect(isDreamHygieneWrite('move_node', {
      old_uri: 'project://lore/dream',
      new_uri: 'project://lore/dream_review',
    })).toBe(false);
    expect(isDreamHygieneWrite('move_node', {
      old_uri: 'core://agent',
      new_uri: 'work://agent',
    })).toBe(false);
    expect(isDreamHygieneWrite('move_node', {
      old_uri: 'work://notes/dream',
      new_uri: 'notes://dream',
    })).toBe(false);
  });

  it('does not classify non-write tools as hygiene operations', () => {
    expect(isDreamHygieneWrite('replay_recall', { glossary_remove: ['x'] })).toBe(false);
  });
});

describe('budget blocked results', () => {
  it('returns the documented content-write cap shape', () => {
    expect(dreamWriteCapBlockedResult()).toMatchObject({
      code: 'dream_write_cap',
      blocked: true,
      detail: expect.stringContaining(String(DREAM_CONTENT_WRITE_CAP)),
    });
  });

  it('returns the documented hygiene cap shape', () => {
    expect(dreamHygieneCapBlockedResult()).toMatchObject({
      code: 'dream_hygiene_cap',
      blocked: true,
      detail: expect.stringContaining(String(DREAM_HYGIENE_WRITE_CAP)),
    });
  });
});
