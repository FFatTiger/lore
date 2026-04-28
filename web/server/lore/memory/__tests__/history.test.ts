import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormattedEvent } from '../writeEvents';

vi.mock('../../../db', () => ({
  sql: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('../browseNodeData', () => ({
  getMemoryByPath: vi.fn(),
  getGlossaryKeywords: vi.fn(),
}));

vi.mock('../writeEvents', () => ({
  getNodeWriteHistory: vi.fn(),
  logMemoryEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../writeArtifactScheduling', () => ({
  scheduleWriteArtifactsRefresh: vi.fn(),
}));

import { getPool, sql } from '../../../db';
import { getMemoryByPath, getGlossaryKeywords } from '../browseNodeData';
import { getNodeWriteHistory, logMemoryEvent } from '../writeEvents';
import { scheduleWriteArtifactsRefresh } from '../writeArtifactScheduling';
import { getNodeHistory, normalizeHistoryEvent, rollbackNodeToEvent } from '../history';

const mockSql = vi.mocked(sql);
const mockGetPool = vi.mocked(getPool);
const mockGetMemoryByPath = vi.mocked(getMemoryByPath);
const mockGetGlossaryKeywords = vi.mocked(getGlossaryKeywords);
const mockGetNodeWriteHistory = vi.mocked(getNodeWriteHistory);
const mockLogMemoryEvent = vi.mocked(logMemoryEvent);
const mockScheduleWriteArtifactsRefresh = vi.mocked(scheduleWriteArtifactsRefresh);

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

function currentNode(overrides = {}) {
  return {
    id: 11,
    node_uuid: 'uuid-1',
    content: 'current content',
    priority: 2,
    disclosure: 'current disclosure',
    deprecated: false,
    created_at: '2026-04-28T01:00:00.000Z',
    domain: 'core',
    path: 'agent/prefs',
    alias_count: 0,
    ...overrides,
  };
}

function makeClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
}

function makeRollbackClient() {
  const client = makeClient();
  client.query.mockImplementation((query: string) => {
    if (query.includes('SELECT id, content')) {
      return Promise.resolve({ rows: [{ id: 11, content: 'current content' }] });
    }
    if (query.includes('RETURNING id')) {
      return Promise.resolve({ rows: [{ id: 12 }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return client;
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

describe('getNodeHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects root or empty paths with status 404', async () => {
    await expect(getNodeHistory({ path: '' })).rejects.toMatchObject({ status: 404 });
    await expect(getNodeHistory({ path: '/' })).rejects.toMatchObject({ status: 404 });
    expect(mockGetMemoryByPath).not.toHaveBeenCalled();
  });

  it('resolves the current node and queries write history by node uuid', async () => {
    mockGetMemoryByPath.mockResolvedValue(currentNode());
    mockGetGlossaryKeywords.mockResolvedValue(['alpha', 'beta']);
    mockGetNodeWriteHistory.mockResolvedValue({
      node_uri: null,
      node_uuid: 'uuid-1',
      events: [event({ id: 5, before_snapshot: { content: 'old' }, after_snapshot: { content: 'new' } })],
    });

    const result = await getNodeHistory({ domain: 'core', path: 'agent/prefs', limit: 25 });

    expect(mockGetMemoryByPath).toHaveBeenCalledWith('core', 'agent/prefs');
    expect(mockGetNodeWriteHistory).toHaveBeenCalledWith({ nodeUuid: 'uuid-1', limit: 25 });
    expect(result).toMatchObject({
      uri: 'core://agent/prefs',
      domain: 'core',
      path: 'agent/prefs',
      node_uuid: 'uuid-1',
      content: 'current content',
      disclosure: 'current disclosure',
      priority: 2,
      glossary_keywords: ['alpha', 'beta'],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ id: 5, summary: 'update', rollback_supported: true });
  });
});

describe('rollbackNodeToEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMemoryByPath.mockResolvedValue(currentNode());
    mockSql.mockResolvedValue({ rows: [event({
      id: 42,
      event_type: 'update',
      node_uuid: 'uuid-1',
      node_uri: 'core://agent/prefs',
      after_snapshot: { content: 'target content', disclosure: 'target disclosure', priority: 1 },
      created_at: '2026-04-28T02:00:00.000Z',
    })] });
  });

  it('rejects invalid or missing event ids', async () => {
    await expect(rollbackNodeToEvent({ path: 'agent/prefs', eventId: 0 })).rejects.toMatchObject({ status: 422 });
    await expect(rollbackNodeToEvent({ path: 'agent/prefs', eventId: Number.NaN })).rejects.toMatchObject({ status: 422 });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects target events from a different node uuid with status 422', async () => {
    mockSql.mockResolvedValueOnce({ rows: [event({ id: 42, node_uuid: 'other-uuid', after_snapshot: { content: 'x' } })] });

    await expect(rollbackNodeToEvent({ path: 'agent/prefs', eventId: 42 })).rejects.toMatchObject({ status: 422 });
  });

  it('rejects unsupported event types with status 422', async () => {
    mockSql.mockResolvedValueOnce({ rows: [event({ id: 42, event_type: 'move', after_snapshot: { uri: 'core://agent/prefs' } })] });

    await expect(rollbackNodeToEvent({ path: 'agent/prefs', eventId: 42 })).rejects.toMatchObject({ status: 422 });
  });

  it('rejects target events with no usable after snapshot with status 422', async () => {
    mockSql.mockResolvedValueOnce({ rows: [event({ id: 42, after_snapshot: null })] });

    await expect(rollbackNodeToEvent({ path: 'agent/prefs', eventId: 42 })).rejects.toMatchObject({ status: 422 });
  });

  it('updates current node content and edge metadata and writes a rollback update event', async () => {
    const client = makeRollbackClient();
    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) } as never);

    const result = await rollbackNodeToEvent(
      { domain: 'core', path: 'agent/prefs', eventId: 42 },
      { source: 'test', session_id: 'session-rollback' },
    );

    expect(result).toEqual({
      success: true,
      operation: 'update',
      uri: 'core://agent/prefs',
      path: 'agent/prefs',
      node_uuid: 'uuid-1',
    });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, content'),
      ['uuid-1'],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO memories'),
      ['uuid-1', 'target content'],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE memories'),
      [11, 12],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE edges'),
      ['core', 'agent/prefs', 1, 'target disclosure', true],
    );
    expect(mockLogMemoryEvent).toHaveBeenCalledWith(expect.objectContaining({
      client,
      event_type: 'update',
      node_uri: 'core://agent/prefs',
      node_uuid: 'uuid-1',
      domain: 'core',
      path: 'agent/prefs',
      source: 'test',
      session_id: 'session-rollback',
      before_snapshot: { content: 'current content', disclosure: 'current disclosure', priority: 2 },
      after_snapshot: { content: 'target content', disclosure: 'target disclosure', priority: 1 },
      details: {
        rollback_from_event_id: 42,
        rollback_from_created_at: '2026-04-28T02:00:00.000Z',
        rollback_from_node_uri: 'core://agent/prefs',
      },
    }));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(mockScheduleWriteArtifactsRefresh).toHaveBeenCalledWith({ domain: 'core', path: 'agent/prefs' });
  });

  it('transactionally replaces glossary keywords when the target snapshot includes them', async () => {
    const client = makeClient();
    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) } as never);
    mockSql.mockResolvedValueOnce({ rows: [event({
      id: 42,
      node_uuid: 'uuid-1',
      after_snapshot: {
        content: 'target content',
        disclosure: 'target disclosure',
        priority: 1,
        glossary_keywords: ['beta', 'alpha'],
      },
    })] });

    await rollbackNodeToEvent({ path: 'agent/prefs', eventId: 42 });

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM glossary_keywords'),
      ['uuid-1'],
    );
    const insertCalls = client.query.mock.calls.filter(([query]) => String(query).includes('INSERT INTO glossary_keywords'));
    expect(insertCalls).toEqual([
      [expect.stringContaining('INSERT INTO glossary_keywords (keyword, node_uuid, created_at)'), ['beta', 'uuid-1']],
      [expect.stringContaining('INSERT INTO glossary_keywords (keyword, node_uuid, created_at)'), ['alpha', 'uuid-1']],
    ]);
    for (const [query] of insertCalls) {
      expect(String(query)).toContain('ON CONFLICT DO NOTHING');
    }
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('normalizes and dedupes target snapshot glossary keywords before insert', async () => {
    const client = makeClient();
    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) } as never);
    mockSql.mockResolvedValueOnce({ rows: [event({
      id: 42,
      node_uuid: 'uuid-1',
      after_snapshot: {
        glossary_keywords: [' beta ', '', 'alpha', 'beta', 'alpha'],
      },
    })] });

    await rollbackNodeToEvent({ path: 'agent/prefs', eventId: 42 });

    const insertCalls = client.query.mock.calls.filter(([query]) => String(query).includes('INSERT INTO glossary_keywords'));
    expect(insertCalls).toEqual([
      [expect.stringContaining('ON CONFLICT DO NOTHING'), ['beta', 'uuid-1']],
      [expect.stringContaining('ON CONFLICT DO NOTHING'), ['alpha', 'uuid-1']],
    ]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('does not replace content when target snapshot content is null', async () => {
    const client = makeClient();
    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) } as never);
    mockSql.mockResolvedValueOnce({ rows: [event({
      id: 42,
      node_uuid: 'uuid-1',
      after_snapshot: { content: null, priority: 1 },
    })] });

    await rollbackNodeToEvent({ path: 'agent/prefs', eventId: 42 });

    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO memories'), expect.anything());
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE edges'),
      ['core', 'agent/prefs', 1, null, false],
    );
    expect(mockLogMemoryEvent).toHaveBeenCalledWith(expect.objectContaining({
      after_snapshot: { content: 'current content', disclosure: 'current disclosure', priority: 1 },
    }));
  });

  it('does not replace content when target snapshot content is non-string metadata', async () => {
    const client = makeClient();
    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) } as never);
    mockSql.mockResolvedValueOnce({ rows: [event({
      id: 42,
      node_uuid: 'uuid-1',
      after_snapshot: { content: { unchanged: true }, disclosure: 'target disclosure' },
    })] });

    await rollbackNodeToEvent({ path: 'agent/prefs', eventId: 42 });

    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO memories'), expect.anything());
    expect(mockLogMemoryEvent).toHaveBeenCalledWith(expect.objectContaining({
      after_snapshot: { content: 'current content', disclosure: 'target disclosure', priority: 2 },
    }));
  });
});
