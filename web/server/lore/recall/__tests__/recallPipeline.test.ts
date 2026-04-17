import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../memory/boot', () => ({
  getBootUriSet: vi.fn(),
}));
vi.mock('../../search/glossarySemantic', () => ({
  fetchGlossarySemanticRows: vi.fn(),
}));
vi.mock('../../view/viewBuilders', () => ({
  countQueryTokens: vi.fn(),
}));
vi.mock('../../view/embeddings', () => ({
  embedTexts: vi.fn(),
  resolveEmbeddingConfig: vi.fn(),
}));
vi.mock('../../view/memoryViewQueries', () => ({
  fetchDenseMemoryViewRows: vi.fn(),
  fetchExactMemoryRows: vi.fn(),
  fetchLexicalMemoryViewRows: vi.fn(),
}));
vi.mock('../../view/viewCrud', () => ({
  ensureMemoryViewsReady: vi.fn(),
}));
vi.mock('../recallConfig', () => ({
  loadRecallDisplayConfig: vi.fn(),
  loadRecallScoringConfig: vi.fn(),
}));
vi.mock('../recallDisplay', () => ({
  buildRecallDisplay: vi.fn(),
}));
vi.mock('../recallSessionReads', () => ({
  getSessionReadUris: vi.fn(),
}));

import { getBootUriSet } from '../../memory/boot';
import { fetchGlossarySemanticRows } from '../../search/glossarySemantic';
import { countQueryTokens } from '../../view/viewBuilders';
import { embedTexts, resolveEmbeddingConfig } from '../../view/embeddings';
import {
  fetchDenseMemoryViewRows,
  fetchExactMemoryRows,
  fetchLexicalMemoryViewRows,
} from '../../view/memoryViewQueries';
import { ensureMemoryViewsReady } from '../../view/viewCrud';
import {
  loadRecallDisplayConfig,
  loadRecallScoringConfig,
} from '../recallConfig';
import { buildRecallDisplay } from '../recallDisplay';
import { runRecallPipeline } from '../recallPipeline';
import { getSessionReadUris } from '../recallSessionReads';

const mockGetBootUriSet = vi.mocked(getBootUriSet);
const mockFetchGlossarySemanticRows = vi.mocked(fetchGlossarySemanticRows);
const mockCountQueryTokens = vi.mocked(countQueryTokens);
const mockEmbedTexts = vi.mocked(embedTexts);
const mockResolveEmbeddingConfig = vi.mocked(resolveEmbeddingConfig);
const mockFetchDenseMemoryViewRows = vi.mocked(fetchDenseMemoryViewRows);
const mockFetchExactMemoryRows = vi.mocked(fetchExactMemoryRows);
const mockFetchLexicalMemoryViewRows = vi.mocked(fetchLexicalMemoryViewRows);
const mockEnsureMemoryViewsReady = vi.mocked(ensureMemoryViewsReady);
const mockLoadRecallDisplayConfig = vi.mocked(loadRecallDisplayConfig);
const mockLoadRecallScoringConfig = vi.mocked(loadRecallScoringConfig);
const mockBuildRecallDisplay = vi.mocked(buildRecallDisplay);
const mockGetSessionReadUris = vi.mocked(getSessionReadUris);

describe('runRecallPipeline', () => {
  const bootUriSet = new Set(['core://boot/z', 'core://boot/a']);
  const resolvedEmbedding = { model: 'text-embedding-3-large', base_url: 'http://embed', dimensions: 3072 };
  const scoringConfig = {
    strategy: 'raw_plus_lex_damp',
    rrf_k: 20,
    dense_floor: 0.5,
    gs_floor: 0.4,
    w_exact: 0.3,
    w_glossary_semantic: 0.25,
    w_dense: 0.3,
    w_lexical: 0.03,
    priority_base: 0.05,
    priority_step: 0.01,
    multi_view_step: 0.015,
    multi_view_cap: 0.05,
    recency_enabled: true,
    recency_half_life_days: 180,
    recency_max_bonus: 0.04,
    recency_priority_exempt: 1,
    view_priors: { gist: 0.03, question: 0.02 },
  };
  const displayConfig = {
    min_display_score: 0.33,
    max_display_items: 4,
    read_node_display_mode: 'soft',
  };
  const exactRows = [{ uri: 'core://exact', exact_score: 0.9 }];
  const glossaryRows = [{ uri: 'core://glossary', glossary_semantic_score: 0.7 }];
  const denseRows = [{ uri: 'core://dense', semantic_score: 0.8, view_type: 'gist' }];
  const lexicalRows = [{ uri: 'core://lexical', lexical_score: 0.6, view_type: 'question' }];
  const aggregated = [
    {
      uri: 'core://ranked',
      score: 0.93,
      matched_on: ['dense'],
      cues: ['alpha'],
      priority: 1,
      exact_score: 0,
      glossary_semantic_score: 0,
      dense_score: 0.93,
      lexical_score: 0,
      score_breakdown: {},
    },
  ];
  const displayResult = {
    ranked: [
      {
        ...aggregated[0],
        score_display: 0.93,
        read: false,
        boot: false,
      },
    ],
    candidates: [
      {
        ...aggregated[0],
        score_display: 0.93,
        read: false,
        boot: false,
      },
    ],
    items: [
      {
        ...aggregated[0],
        score_display: 0.93,
        read: false,
        boot: false,
      },
    ],
    suppressed: { boot: 1, read: 2, score: 3 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBootUriSet.mockReturnValue(bootUriSet);
    mockResolveEmbeddingConfig.mockResolvedValue(resolvedEmbedding as any);
    mockEnsureMemoryViewsReady.mockResolvedValue({ ready: true } as any);
    mockLoadRecallScoringConfig.mockResolvedValue({ ...scoringConfig } as any);
    mockLoadRecallDisplayConfig.mockResolvedValue({ ...displayConfig } as any);
    mockCountQueryTokens.mockResolvedValue(7);
    mockEmbedTexts.mockResolvedValue([[0.1, 0.2, 0.3]] as any);
    mockFetchExactMemoryRows.mockResolvedValue(exactRows as any);
    mockFetchGlossarySemanticRows.mockResolvedValue(glossaryRows as any);
    mockFetchDenseMemoryViewRows.mockResolvedValue(denseRows as any);
    mockFetchLexicalMemoryViewRows.mockResolvedValue(lexicalRows as any);
    mockGetSessionReadUris.mockResolvedValue(new Set(['core://read']));
    mockBuildRecallDisplay.mockReturnValue(displayResult as any);
  });

  it('orchestrates sanitized recall fan-out and display shaping without changing semantics', async () => {
    const aggregateCandidates = vi.fn().mockReturnValue(aggregated);

    const result = await runRecallPipeline(
      {
        query: 'Conversation info (untrusted metadata): ```json {"channel":"general"}```\nactual query',
        strategy: 'rrf',
        session_id: 'session-1',
        domain: 'project',
        limit: 2,
        max_display_items: 5,
        min_display_score: 0.4,
        min_score: 0.2,
        score_precision: 3,
        read_node_display_mode: 'hard',
      },
      { aggregateCandidates },
    );

    expect(mockCountQueryTokens).toHaveBeenCalledWith('actual query');
    expect(mockEmbedTexts).toHaveBeenCalledWith(resolvedEmbedding, ['actual query']);
    expect(mockFetchExactMemoryRows).toHaveBeenCalledWith({
      query: 'actual query',
      limit: 40,
      domain: 'project',
    });
    expect(mockFetchGlossarySemanticRows).toHaveBeenCalledWith({
      embedding: resolvedEmbedding,
      queryVector: [0.1, 0.2, 0.3],
      limit: 40,
      domain: 'project',
    });
    expect(mockFetchDenseMemoryViewRows).toHaveBeenCalledWith({
      embedding: resolvedEmbedding,
      queryVector: [0.1, 0.2, 0.3],
      limit: 40,
      domain: 'project',
    });
    expect(mockFetchLexicalMemoryViewRows).toHaveBeenCalledWith({
      query: 'actual query',
      limit: 40,
      domain: 'project',
    });
    expect(mockGetSessionReadUris).toHaveBeenCalledWith('session-1');
    expect(aggregateCandidates).toHaveBeenCalledWith({
      exactRows,
      glossarySemanticRows: glossaryRows,
      denseRows,
      lexicalRows,
      scoringConfig: expect.objectContaining({
        strategy: 'rrf',
        query_tokens: 7,
        recency_enabled: true,
      }),
    });
    expect(mockBuildRecallDisplay).toHaveBeenCalledWith({
      ranked: aggregated,
      readUris: new Set(['core://read']),
      bootUris: bootUriSet,
      scorePrecision: 3,
      minScore: 0.2,
      candidateCount: 5,
      maxDisplayItems: 5,
      minDisplayScore: 0.4,
      readNodeDisplayMode: 'hard',
    });
    expect(result.query).toBe('actual query');
    expect(result.session_id).toBe('session-1');
    expect(result.exact_rows).toBe(exactRows);
    expect(result.glossary_semantic_rows).toBe(glossaryRows);
    expect(result.dense_rows).toBe(denseRows);
    expect(result.lexical_rows).toBe(lexicalRows);
    expect(result.ranked).toBe(displayResult.ranked);
    expect(result.candidates).toBe(displayResult.candidates);
    expect(result.items).toBe(displayResult.items);
    expect(result.suppressed).toBe(displayResult.suppressed);
    expect(result.boot_uris).toEqual(['core://boot/a', 'core://boot/z']);
    expect(result.read_node_display_mode).toBe('hard');
    expect(result.retrieval_meta).toEqual({
      exact_candidates: 1,
      glossary_semantic_candidates: 1,
      dense_candidates: 1,
      lexical_candidates: 1,
      model: 'text-embedding-3-large',
      strategy: 'rrf',
      query_tokens: 7,
      recency_enabled: true,
      view_types: ['gist', 'question'],
    });
  });

  it('falls back to the original query and disables boot suppression when requested', async () => {
    const aggregateCandidates = vi.fn().mockReturnValue([]);
    mockGetSessionReadUris.mockResolvedValueOnce(new Set());
    mockBuildRecallDisplay.mockReturnValueOnce({
      ranked: [],
      candidates: [],
      items: [],
      suppressed: { boot: 0, read: 0, score: 0 },
    } as any);

    const rawQuery = 'Sender (untrusted metadata): ```json {"name":"bot"}```';
    const result = await runRecallPipeline(
      {
        query: rawQuery,
        exclude_boot_from_results: false,
      },
      { aggregateCandidates },
    );

    expect(mockCountQueryTokens).toHaveBeenCalledWith(rawQuery);
    expect(mockFetchExactMemoryRows).toHaveBeenCalledWith({
      query: rawQuery,
      limit: 96,
      domain: null,
    });
    expect(mockFetchLexicalMemoryViewRows).toHaveBeenCalledWith({
      query: rawQuery,
      limit: 96,
      domain: null,
    });
    expect(mockGetSessionReadUris).toHaveBeenCalledWith(undefined);
    expect(mockBuildRecallDisplay).toHaveBeenCalledWith(expect.objectContaining({
      bootUris: expect.any(Set),
      candidateCount: 12,
      maxDisplayItems: 4,
      minDisplayScore: 0.33,
      minScore: 0,
      readNodeDisplayMode: 'soft',
    }));
    const buildDisplayArg = mockBuildRecallDisplay.mock.calls.at(-1)?.[0];
    expect(buildDisplayArg?.bootUris.size).toBe(0);
    expect(result.query).toBe(rawQuery);
    expect(result.boot_uris).toEqual([]);
  });
});
