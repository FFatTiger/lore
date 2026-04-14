import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../memory/writeEvents', () => ({ logMemoryEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../glossarySemantic', () => ({
  upsertGeneratedGlossaryEmbeddingsForPath: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../view/viewCrud', () => ({
  upsertGeneratedMemoryViewsForPath: vi.fn().mockResolvedValue({}),
}));

import { sql } from '../../../db';
import { logMemoryEvent } from '../../memory/writeEvents';
import { upsertGeneratedGlossaryEmbeddingsForPath } from '../glossarySemantic';
import { upsertGeneratedMemoryViewsForPath } from '../../view/viewCrud';
import {
  getGlossary,
  addGlossaryKeyword,
  removeGlossaryKeyword,
  manageTriggers,
  scheduleGeneratedArtifactsRefresh,
} from '../glossary';

const mockSql = vi.mocked(sql);
const mockLogMemoryEvent = vi.mocked(logMemoryEvent);
const mockUpsertGlossaryEmbeddings = vi.mocked(upsertGeneratedGlossaryEmbeddingsForPath);
const mockUpsertMemoryViews = vi.mocked(upsertGeneratedMemoryViewsForPath);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

// ---------------------------------------------------------------------------
// getGlossary
// ---------------------------------------------------------------------------

describe('getGlossary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns glossary rows ordered by keyword', async () => {
    const rows = [
      { keyword: 'alpha', node_uuid: 'uuid-1' },
      { keyword: 'beta', node_uuid: 'uuid-2' },
    ];
    mockSql.mockResolvedValueOnce(makeResult(rows));

    const result = await getGlossary();
    expect(result.glossary).toHaveLength(2);
    expect(result.glossary[0].keyword).toBe('alpha');
    expect(result.glossary[1].keyword).toBe('beta');
  });

  it('returns empty glossary when table is empty', async () => {
    mockSql.mockResolvedValueOnce(makeResult([]));
    const result = await getGlossary();
    expect(result.glossary).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addGlossaryKeyword
// ---------------------------------------------------------------------------

describe('addGlossaryKeyword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts keyword and returns success with keyword/uuid', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult()) // INSERT glossary_keywords
      .mockResolvedValueOnce(makeResult([{ domain: 'core', path: 'agent/test' }])); // listPathsByNodeUuid

    const result = await addGlossaryKeyword({ keyword: 'alpha', node_uuid: 'uuid-1' });

    expect(result.success).toBe(true);
    expect(result.keyword).toBe('alpha');
    expect(result.node_uuid).toBe('uuid-1');

    const insertCall = mockSql.mock.calls.find((c) => String(c[0]).includes('INSERT INTO glossary_keywords'));
    expect(insertCall).toBeDefined();
  });

  it('logs a glossary_add memory event', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(makeResult([{ domain: 'core', path: 'agent/test' }]));

    await addGlossaryKeyword({ keyword: 'alpha', node_uuid: 'uuid-1' }, { source: 'mcp', session_id: 'sess-1' });

    // Give microtask queue a tick for queueMicrotask
    await new Promise((r) => queueMicrotask(r as any));

    expect(mockLogMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'glossary_add',
        node_uuid: 'uuid-1',
        source: 'mcp',
        session_id: 'sess-1',
        after_snapshot: { keyword: 'alpha' },
      }),
    );
  });

  it('falls back to uuid uri when node has no paths', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(makeResult([]));

    await addGlossaryKeyword({ keyword: 'alpha', node_uuid: 'uuid-1' });
    await new Promise((r) => queueMicrotask(r as any));

    expect(mockLogMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        node_uri: '[uuid]/uuid-1',
        domain: 'core',
        path: '',
      }),
    );
  });

  it('passes client_type through glossary event logging', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(makeResult([{ domain: 'core', path: 'agent/test' }]));

    await addGlossaryKeyword(
      { keyword: 'alpha', node_uuid: 'uuid-1' },
      { source: 'mcp', session_id: 'sess-1', client_type: 'hermes' },
    );

    await new Promise((r) => queueMicrotask(r as any));

    expect(mockLogMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'glossary_add',
        client_type: 'hermes',
      }),
    );
  });

  it('uses unknown source when eventContext is omitted', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(makeResult([]));

    await addGlossaryKeyword({ keyword: 'x', node_uuid: 'uuid-x' });

    expect(mockLogMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'unknown' }),
    );
  });
});

// ---------------------------------------------------------------------------
// removeGlossaryKeyword
// ---------------------------------------------------------------------------

describe('removeGlossaryKeyword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns success=true when row was deleted', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([], 1)) // DELETE returns rowCount=1
      .mockResolvedValueOnce(makeResult([{ domain: 'core', path: 'agent/test' }]));

    const result = await removeGlossaryKeyword({ keyword: 'alpha', node_uuid: 'uuid-1' });
    expect(result.success).toBe(true);
  });

  it('returns success=false when no row was deleted', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 0)); // rowCount=0

    const result = await removeGlossaryKeyword({ keyword: 'missing', node_uuid: 'uuid-1' });
    expect(result.success).toBe(false);
  });

  it('logs a glossary_remove event on successful delete', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([], 1))
      .mockResolvedValueOnce(makeResult([{ domain: 'core', path: 'agent/test' }]));

    await removeGlossaryKeyword({ keyword: 'alpha', node_uuid: 'uuid-1' }, { source: 'api' });

    expect(mockLogMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'glossary_remove',
        before_snapshot: { keyword: 'alpha' },
        source: 'api',
      }),
    );
  });

  it('does not log or call scheduleRefresh when rowCount=0', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 0));

    await removeGlossaryKeyword({ keyword: 'x', node_uuid: 'uuid-x' });

    expect(mockLogMemoryEvent).not.toHaveBeenCalled();
    // sql should only have been called once (the DELETE)
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// manageTriggers
// ---------------------------------------------------------------------------

describe('manageTriggers', () => {
  beforeEach(() => vi.clearAllMocks());

  function setupNodeLookup(nodeUuid: string | null, paths: { domain: string; path: string }[] = []) {
    mockSql
      .mockResolvedValueOnce(makeResult(nodeUuid ? [{ node_uuid: nodeUuid }] : [])); // getNodeUuidByPath
    if (nodeUuid) {
      // Any subsequent listPathsByNodeUuid call
      mockSql.mockResolvedValue(makeResult(paths));
    }
  }

  it('throws 404 when node not found', async () => {
    setupNodeLookup(null);

    await expect(manageTriggers({ uri: 'core://missing/path', add: ['x'] })).rejects.toThrow(
      "Memory at 'core://missing/path' not found.",
    );
  });

  it('thrown error has status 404', async () => {
    setupNodeLookup(null);

    try {
      await manageTriggers({ uri: 'core://nope' });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(404);
    }
  });

  it('adds new keywords and returns them in added array', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ node_uuid: 'uuid-1' }])) // getNodeUuidByPath
      .mockResolvedValueOnce(makeResult([])) // SELECT 1 check for 'alpha' — not exists
      .mockResolvedValueOnce(makeResult()) // INSERT 'alpha'
      .mockResolvedValueOnce(makeResult([{ keyword: 'alpha' }])) // SELECT current
      .mockResolvedValue(makeResult([{ domain: 'core', path: 'test' }])); // listPathsByNodeUuid

    const result = await manageTriggers({ uri: 'core://test', add: ['alpha'], remove: [] });

    expect(result.added).toContain('alpha');
    expect(result.skipped_add).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  it('skips keywords that already exist', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ node_uuid: 'uuid-1' }])) // getNodeUuidByPath
      .mockResolvedValueOnce(makeResult([{ '?column?': 1 }])) // SELECT 1 — exists
      .mockResolvedValueOnce(makeResult([{ keyword: 'alpha' }])) // current
      .mockResolvedValue(makeResult([{ domain: 'core', path: 'test' }]));

    const result = await manageTriggers({ uri: 'core://test', add: ['alpha'] });

    expect(result.added).toHaveLength(0);
    expect(result.skipped_add).toContain('alpha');
  });

  it('removes existing keywords and returns them in removed array', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ node_uuid: 'uuid-1' }])) // getNodeUuidByPath
      .mockResolvedValueOnce(makeResult([], 1)) // DELETE returns rowCount=1
      .mockResolvedValueOnce(makeResult([])) // current
      .mockResolvedValue(makeResult([{ domain: 'core', path: 'test' }]));

    const result = await manageTriggers({ uri: 'core://test', add: [], remove: ['alpha'] });

    expect(result.removed).toContain('alpha');
    expect(result.skipped_remove).toHaveLength(0);
  });

  it('puts keywords in skipped_remove when delete finds nothing', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ node_uuid: 'uuid-1' }])) // getNodeUuidByPath
      .mockResolvedValueOnce(makeResult([], 0)) // DELETE rowCount=0
      .mockResolvedValueOnce(makeResult([])) // current
      .mockResolvedValue(makeResult([{ domain: 'core', path: 'test' }]));

    const result = await manageTriggers({ uri: 'core://test', remove: ['missing'] });

    expect(result.removed).toHaveLength(0);
    expect(result.skipped_remove).toContain('missing');
  });

  it('returns current keyword list from db', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ node_uuid: 'uuid-1' }]))
      .mockResolvedValueOnce(makeResult([{ keyword: 'alpha' }, { keyword: 'beta' }])) // SELECT current
      .mockResolvedValue(makeResult([{ domain: 'core', path: 'test' }]));

    const result = await manageTriggers({ uri: 'core://test', add: [], remove: [] });

    expect(result.current).toEqual(['alpha', 'beta']);
  });

  it('ignores blank strings in add/remove arrays', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ node_uuid: 'uuid-1' }]))
      .mockResolvedValueOnce(makeResult([])) // current
      .mockResolvedValue(makeResult([{ domain: 'core', path: 'test' }]));

    const result = await manageTriggers({ uri: 'core://test', add: ['', '   '], remove: ['', '  '] });

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scheduleGeneratedArtifactsRefresh
// ---------------------------------------------------------------------------

describe('scheduleGeneratedArtifactsRefresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queues upsertGeneratedMemoryViewsForPath for each valid path', async () => {
    scheduleGeneratedArtifactsRefresh([
      { domain: 'core', path: 'agent/test' },
    ]);
    // Let microtasks drain
    await new Promise((r) => queueMicrotask(r as any));
    expect(mockUpsertMemoryViews).toHaveBeenCalledWith({ domain: 'core', path: 'agent/test' });
  });

  it('queues upsertGeneratedGlossaryEmbeddingsForPath for each valid path', async () => {
    scheduleGeneratedArtifactsRefresh([
      { domain: 'work', path: 'projects/alpha' },
    ]);
    await new Promise((r) => queueMicrotask(r as any));
    expect(mockUpsertGlossaryEmbeddings).toHaveBeenCalledWith({ domain: 'work', path: 'projects/alpha' });
  });

  it('skips rows with empty domain or path', async () => {
    scheduleGeneratedArtifactsRefresh([
      { domain: '', path: 'some/path' },
      { domain: 'core', path: '' },
    ] as any);
    await new Promise((r) => queueMicrotask(r as any));
    expect(mockUpsertMemoryViews).not.toHaveBeenCalled();
    expect(mockUpsertGlossaryEmbeddings).not.toHaveBeenCalled();
  });

  it('handles non-array input gracefully', () => {
    expect(() => scheduleGeneratedArtifactsRefresh(null as any)).not.toThrow();
    expect(() => scheduleGeneratedArtifactsRefresh(undefined as any)).not.toThrow();
  });
});
