import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../recall/recall', () => ({ recallMemories: vi.fn() }));
vi.mock('../dreamSessionFilter', () => ({
  loadDreamSessionFilter: vi.fn(),
  dreamSessionMatches: vi.fn(),
}));

import { sql } from '../../../db';
import { recallMemories } from '../../recall/recall';
import { dreamSessionMatches, loadDreamSessionFilter } from '../dreamSessionFilter';
import { MAX_DREAM_REPLAY_QUERIES, replayRecall } from '../dreamReplayRecall';

const mockSql = vi.mocked(sql);
const mockRecallMemories = vi.mocked(recallMemories);
const mockLoadFilter = vi.mocked(loadDreamSessionFilter);
const mockMatches = vi.mocked(dreamSessionMatches);

function makeResult(rows: Record<string, unknown>[] = []) {
  return { rows, rowCount: rows.length } as any;
}

describe('replayRecall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFilter.mockResolvedValue({ patterns: [] });
    mockMatches.mockReturnValue(false);
    mockRecallMemories.mockResolvedValue({
      items: [
        { uri: 'project://lore/dream', score_display: 0.82 },
        { uri: 'core://agent', score_display: 0.41 },
      ],
    } as any);
  });

  it('replays query_ids and raw queries through the normal recall path', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ query_text: 'why did dream skip hygiene' }]));

    const result = await replayRecall({
      query_ids: ['q-1'],
      queries: ['how does recall score glossary keywords'],
    }) as { replays: Array<Record<string, unknown>> };

    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(mockRecallMemories).toHaveBeenCalledTimes(2);
    expect(mockRecallMemories).toHaveBeenCalledWith({ query: 'why did dream skip hygiene' }, { logEvents: false });
    expect(result.replays[0]).toEqual({
      source: 'query_id',
      query_id: 'q-1',
      query_text: 'why did dream skip hygiene',
      items: [
        { uri: 'project://lore/dream', score: 0.82 },
        { uri: 'core://agent', score: 0.41 },
      ],
    });
    expect(result.replays[1]).toMatchObject({ source: 'raw', query_text: 'how does recall score glossary keywords' });
  });

  it('reports unknown query_ids without replaying them', async () => {
    mockSql.mockResolvedValueOnce(makeResult([]));
    const result = await replayRecall({ query_ids: ['missing'] }) as { replays: Array<Record<string, unknown>> };
    expect(result.replays[0]).toEqual({ source: 'query_id', query_id: 'missing', error: 'query_id not found' });
    expect(mockRecallMemories).not.toHaveBeenCalled();
  });

  it('skips query_ids from excluded sessions', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ query_text: 'e2e smoke run' }]));
    mockMatches.mockReturnValue(true);
    const result = await replayRecall({ query_ids: ['q-bot'] }) as { replays: Array<Record<string, unknown>> };
    expect(result.replays[0].error).toBe('query_id belongs to an excluded session');
    expect(mockRecallMemories).not.toHaveBeenCalled();
  });

  it('caps replays at ten unique queries', async () => {
    const queryIds = Array.from({ length: 15 }, (_, i) => `q-${i}`);
    mockSql.mockResolvedValue(makeResult([{ query_text: 'shared query' }]));
    const result = await replayRecall({ query_ids: queryIds }) as { replays: unknown[] };
    expect(MAX_DREAM_REPLAY_QUERIES).toBe(10);
    expect(result.replays).toHaveLength(10);
    expect(mockRecallMemories).toHaveBeenCalledTimes(10);
  });

  it('deduplicates repeated queries', async () => {
    await replayRecall({ queries: ['same query', 'same query'] });
    expect(mockRecallMemories).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty replay request', async () => {
    const result = await replayRecall({}) as Record<string, unknown>;
    expect(result).toMatchObject({ blocked: true, code: 'validation' });
    expect(mockRecallMemories).not.toHaveBeenCalled();
  });
});
