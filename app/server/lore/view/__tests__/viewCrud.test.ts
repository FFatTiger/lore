import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../embeddings', () => ({
  embedTexts: vi.fn(),
  vectorLiteral: vi.fn((v: number[]) => `[${v.join(',')}]`),
  resolveEmbeddingConfig: vi.fn(),
}));
vi.mock('../retrieval', () => ({
  NORMALIZED_DOCUMENTS_CTE: '',
  loadNormalizedDocuments: vi.fn(),
}));
vi.mock('../../config/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock('../viewBuilders', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getFtsConfig: vi.fn().mockResolvedValue('simple'),
    getFtsQueryConfig: vi.fn().mockResolvedValue('simple'),
    loadViewWeights: vi.fn().mockResolvedValue({}),
  };
});
vi.mock('../viewLlm', () => ({
  resolveViewLlmConfig: vi.fn().mockResolvedValue(null),
  refineDocumentsWithLlm: vi.fn((docs: unknown[]) => Promise.resolve(docs)),
}));

import { sql } from '../../../db';
import { embedTexts, resolveEmbeddingConfig } from '../embeddings';
import { loadNormalizedDocuments } from '../retrieval';
import {
  buildViewRecords,
  buildViewMap,
  upsertViewRecord,
  ensureMemoryViewsReady,
  ensureMemoryViewsIndex,
  deleteGeneratedMemoryViewsByPrefix,
  loadSourceDocuments,
} from '../viewCrud';
import { getFtsConfig, loadViewWeights } from '../viewBuilders';

const mockSql = vi.mocked(sql);
const mockEmbedTexts = vi.mocked(embedTexts);
const mockResolveEmbeddingConfig = vi.mocked(resolveEmbeddingConfig);
const mockLoadNormalizedDocuments = vi.mocked(loadNormalizedDocuments);
const mockGetFtsConfig = vi.mocked(getFtsConfig);
const mockLoadViewWeights = vi.mocked(loadViewWeights);

// ---------------------------------------------------------------------------
// buildViewRecords
// ---------------------------------------------------------------------------

describe('buildViewRecords', () => {
  const baseDoc: Record<string, unknown> = {
    domain: 'core',
    path: 'agent/test',
    uri: 'core://agent/test',
    node_uuid: 'uuid-1',
    memory_id: 42,
    priority: 5,
    disclosure: 'when testing',
    glossary_terms: ['keyword1'],
    body_preview: 'Preview text here.',
    source_signature: 'base-sig',
  };

  it('generates two records (gist + question)', () => {
    const records = buildViewRecords(baseDoc);
    expect(records).toHaveLength(2);
    expect(records[0].view_type).toBe('gist');
    expect(records[1].view_type).toBe('question');
  });

  it('sets domain, path, uri, node_uuid, memory_id from doc', () => {
    const records = buildViewRecords(baseDoc);
    for (const rec of records) {
      expect(rec.domain).toBe('core');
      expect(rec.path).toBe('agent/test');
      expect(rec.uri).toBe('core://agent/test');
      expect(rec.node_uuid).toBe('uuid-1');
      expect(rec.memory_id).toBe(42);
    }
  });

  it('uses default weights when no weights provided', () => {
    const records = buildViewRecords(baseDoc);
    expect(records[0].weight).toBe(1.0);   // gist
    expect(records[1].weight).toBe(0.96);  // question
  });

  it('uses custom weights when provided', () => {
    const records = buildViewRecords(baseDoc, { gist: 0.8, question: 0.5 });
    expect(records[0].weight).toBe(0.8);
    expect(records[1].weight).toBe(0.5);
  });

  it('includes metadata with generator_version and glossary_terms', () => {
    const records = buildViewRecords(baseDoc);
    const meta = records[0].metadata as Record<string, unknown>;
    expect(meta.generator_version).toBeTruthy();
    expect(meta.glossary_terms).toEqual(['keyword1']);
    expect(meta.llm_refined).toBe(false);
  });

  it('uses LLM views when present', () => {
    const docWithLlm = {
      ...baseDoc,
      llm_views: {
        gist: 'LLM-generated gist text',
        question: ['Q1?', 'Q2?', 'Q3?'],
        model: 'test-model',
      },
    };
    const records = buildViewRecords(docWithLlm);
    expect(records[0].text_content).toContain('LLM-generated gist text');
    expect(records[1].text_content).toBe('Q1?\nQ2?\nQ3?');
    const meta = records[0].metadata as Record<string, unknown>;
    expect(meta.llm_refined).toBe(true);
    expect(meta.llm_model).toBe('test-model');
  });

  it('generates unique source_signatures for different view types', () => {
    const records = buildViewRecords(baseDoc);
    expect(records[0].source_signature).not.toBe(records[1].source_signature);
  });

  it('sets source to generated and status to active', () => {
    const records = buildViewRecords(baseDoc);
    for (const rec of records) {
      expect(rec.source).toBe('generated');
      expect(rec.status).toBe('active');
    }
  });
});

// ---------------------------------------------------------------------------
// buildViewMap
// ---------------------------------------------------------------------------

describe('buildViewMap', () => {
  it('creates a map keyed by domain::path::view_type', () => {
    const views = [
      { domain: 'core', path: 'test', view_type: 'gist', text: 'a' },
      { domain: 'core', path: 'test', view_type: 'question', text: 'b' },
    ];
    const map = buildViewMap(views);
    expect(map.size).toBe(2);
    expect(map.get('core::test::gist')).toBe(views[0]);
    expect(map.get('core::test::question')).toBe(views[1]);
  });

  it('returns empty map for empty input', () => {
    expect(buildViewMap([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// upsertViewRecord
// ---------------------------------------------------------------------------

describe('upsertViewRecord', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls sql with correct parameters', async () => {
    mockGetFtsConfig.mockResolvedValueOnce('simple');
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const view = {
      domain: 'core',
      path: 'test',
      uri: 'core://test',
      node_uuid: 'uuid-1',
      memory_id: 1,
      priority: 0,
      disclosure: '',
      view_type: 'gist',
      source: 'generated',
      weight: 1.0,
      text_content: 'test text',
      metadata: {},
      source_signature: 'sig-1',
    };

    await upsertViewRecord(view);
    expect(mockSql).toHaveBeenCalledTimes(1);
    const params = mockSql.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe('core');   // domain
    expect(params[1]).toBe('test');   // path
    expect(params[2]).toBe('core://test'); // uri
  });

  it('passes embedding vector when provided', async () => {
    mockGetFtsConfig.mockResolvedValueOnce('simple');
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const view = {
      domain: 'core', path: 'test', uri: 'core://test',
      node_uuid: 'u', memory_id: 1, priority: 0, disclosure: '',
      view_type: 'gist', source: 'generated', weight: 1.0,
      text_content: 'text', metadata: {}, source_signature: 'sig',
    };

    await upsertViewRecord(view, {
      embeddingModel: 'test-model',
      vector: [0.1, 0.2, 0.3],
      status: 'active',
    });

    const params = mockSql.mock.calls[0][1] as unknown[];
    expect(params[12]).toBe('test-model'); // embeddingModel
    expect(params[13]).toBe(3);            // embeddingDim
    expect(params[14]).toBe('[0.1,0.2,0.3]'); // embeddingLiteral
  });
});

// ---------------------------------------------------------------------------
// deleteGeneratedMemoryViewsByPrefix
// ---------------------------------------------------------------------------

describe('deleteGeneratedMemoryViewsByPrefix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue({ rows: [], rowCount: 0 } as any);
  });

  it('deletes views matching exact path and prefix', async () => {
    mockSql.mockResolvedValue({ rows: [], rowCount: 3 } as any);
    const result = await deleteGeneratedMemoryViewsByPrefix({ domain: 'core', path: 'agent/test' });
    expect(result.deleted_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ensureMemoryViewsReady
// ---------------------------------------------------------------------------

describe('ensureMemoryViewsReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue({ rows: [], rowCount: 0 } as any);
  });

  it('returns ready: true after table init', async () => {
    const result = await ensureMemoryViewsReady();
    expect(result).toEqual({ ready: true });
  });
});

// ---------------------------------------------------------------------------
// loadSourceDocuments
// ---------------------------------------------------------------------------

describe('loadSourceDocuments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transforms rows via buildSourceDocument', async () => {
    mockLoadNormalizedDocuments.mockResolvedValueOnce([
      {
        domain: 'core', path: 'test', node_uuid: 'u', memory_id: 1,
        uri: 'core://test', priority: 0, disclosure: '', glossary_keywords: [],
        glossary_text: '', latest_content: 'hello',
      },
    ] as any);

    const docs = await loadSourceDocuments({ domain: 'core' });
    expect(docs).toHaveLength(1);
    expect(docs[0].domain).toBe('core');
    expect(docs[0].body_preview).toBe('hello');
    expect(docs[0].source_signature).toBeTruthy();
  });

  it('returns empty array when no documents', async () => {
    mockLoadNormalizedDocuments.mockResolvedValueOnce([]);
    const docs = await loadSourceDocuments();
    expect(docs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ensureMemoryViewsIndex
// ---------------------------------------------------------------------------

describe('ensureMemoryViewsIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Table creation and general SQL mocks
    mockSql.mockResolvedValue({ rows: [], rowCount: 0 } as any);
    mockLoadNormalizedDocuments.mockResolvedValue([]);
    mockLoadViewWeights.mockResolvedValue({});
    mockEmbedTexts.mockResolvedValue([]);
  });

  it('returns stats object with expected shape', async () => {
    const embedding = { base_url: 'http://embed', api_key: 'key', model: 'test-model' };
    const result = await ensureMemoryViewsIndex(embedding);
    expect(result).toHaveProperty('source_count');
    expect(result).toHaveProperty('updated_count');
    expect(result).toHaveProperty('deleted_count');
    expect(result).toHaveProperty('view_types');
    expect(result.view_types).toEqual(['gist', 'question']);
    expect(result).toHaveProperty('llm_model');
    expect(result).toHaveProperty('llm_refined_docs');
  });

  it('returns zero counts when no documents exist', async () => {
    const embedding = { base_url: 'http://embed', api_key: 'key', model: 'test-model' };
    const result = await ensureMemoryViewsIndex(embedding);
    expect(result.source_count).toBe(0);
    expect(result.updated_count).toBe(0);
    expect(result.deleted_count).toBe(0);
    expect(result.llm_refined_docs).toBe(0);
  });
});
