import { describe, expect, it } from 'vitest';
import type { FormattedEvent } from '../writeEvents';
import { normalizeHistoryEvent } from '../history';

function event(overrides: Partial<FormattedEvent>): FormattedEvent {
  return {
    id: 1,
    event_type: 'update',
    node_uri: 'core://agent/prefs',
    node_uuid: 'uuid-1',
    source: 'test',
    session_id: 'session-1',
    before_snapshot: null,
    after_snapshot: null,
    details: {},
    created_at: '2026-04-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeHistoryEvent', () => {
  it('builds update diffs for content, disclosure, and priority and supports rollback', () => {
    const normalized = normalizeHistoryEvent(event({
      event_type: 'update',
      before_snapshot: { content: 'old content', disclosure: 'old disclosure', priority: 2 },
      after_snapshot: { content: 'new content', disclosure: 'new disclosure', priority: 1 },
    }));

    expect(normalized.summary).toBe('update');
    expect(normalized.rollback_supported).toBe(true);
    expect(normalized.is_rollback).toBe(false);
    expect(normalized.diffs).toEqual([
      { field: 'content', kind: 'text', before: 'old content', after: 'new content' },
      { field: 'disclosure', kind: 'text', before: 'old disclosure', after: 'new disclosure' },
      { field: 'priority', kind: 'value', before: 2, after: 1 },
    ]);
  });

  it('marks numeric rollback events and summarizes the source event id', () => {
    const normalized = normalizeHistoryEvent(event({
      event_type: 'update',
      before_snapshot: { content: 'rolled back' },
      after_snapshot: { content: 'current' },
      details: { rollback_from_event_id: 42 },
    }));

    expect(normalized.is_rollback).toBe(true);
    expect(normalized.rollback_supported).toBe(true);
    expect(normalized.summary).toBe('rollback from #42');
  });

  it('builds keyword diffs for glossary add and remove events', () => {
    const add = normalizeHistoryEvent(event({
      event_type: 'glossary_add',
      after_snapshot: { keyword: 'typescript' },
    }));
    const remove = normalizeHistoryEvent(event({
      event_type: 'glossary_remove',
      before_snapshot: { keyword: 'javascript' },
    }));

    expect(add.rollback_supported).toBe(false);
    expect(add.diffs).toEqual([
      { field: 'glossary_keywords', kind: 'keyword_add', before: null, after: 'typescript' },
    ]);
    expect(remove.rollback_supported).toBe(false);
    expect(remove.diffs).toEqual([
      { field: 'glossary_keywords', kind: 'keyword_remove', before: 'javascript', after: null },
    ]);
  });

  it('builds uri diff for move events and does not support rollback', () => {
    const normalized = normalizeHistoryEvent(event({
      event_type: 'move',
      node_uri: 'core://agent/new',
      before_snapshot: { uri: 'core://agent/old' },
      after_snapshot: { uri: 'core://agent/new' },
      details: { old_uri: 'core://agent/old', new_uri: 'core://agent/new' },
    }));

    expect(normalized.rollback_supported).toBe(false);
    expect(normalized.diffs).toEqual([
      { field: 'uri', kind: 'value', before: 'core://agent/old', after: 'core://agent/new' },
    ]);
  });
});
