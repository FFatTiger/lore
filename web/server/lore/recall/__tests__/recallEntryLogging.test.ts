import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../recallPipeline', () => ({ runRecallPipeline: vi.fn() }));
vi.mock('../recallEventDispatch', () => ({ startRecallEventLog: vi.fn() }));
vi.mock('../recallConfig', () => ({
  getRecallRuntimeConfig: vi.fn(),
  loadRecallSafetyConfig: vi.fn(),
}));

import { recallMemories } from '../recall';
import { runRecallPipeline } from '../recallPipeline';
import { startRecallEventLog } from '../recallEventDispatch';

const mockRunRecallPipeline = vi.mocked(runRecallPipeline);
const mockStartRecallEventLog = vi.mocked(startRecallEventLog);

function pipelineResult() {
  return {
    query: 'dream recall',
    retrieval_query: 'dream recall',
    session_id: null,
    resolved_embedding: {},
    index: {},
    exact_rows: [],
    glossary_semantic_rows: [],
    dense_rows: [],
    lexical_rows: [],
    ranked: [],
    candidates: [],
    items: [],
    suppressed: { boot: 0, score: 0 },
    boot_uris: [],
    retrieval_meta: {},
  } as any;
}

describe('recallMemories event logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunRecallPipeline.mockResolvedValue(pipelineResult());
    mockStartRecallEventLog.mockReturnValue({ query_id: 'q-1', enabled: true });
  });

  it('logs recall events by default', async () => {
    await recallMemories({ query: 'dream recall' });
    expect(mockStartRecallEventLog).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when logging is explicitly disabled', async () => {
    const result = await recallMemories({ query: 'dream recall' }, { logEvents: false });
    expect(mockStartRecallEventLog).not.toHaveBeenCalled();
    expect(result.event_log).toEqual({ query_id: '', enabled: false });
    expect(mockRunRecallPipeline).toHaveBeenCalledTimes(1);
  });
});
