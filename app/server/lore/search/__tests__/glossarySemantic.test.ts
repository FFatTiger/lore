import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../view/embeddings', () => ({
  embedTexts: vi.fn(),
  vectorLiteral: vi.fn((v: unknown) => (Array.isArray(v) ? `[${v.join(',')}]` : '[]')),
  resolveEmbeddingConfig: vi.fn(),
}));
vi.mock('../../view/retrieval', () => ({
  loadNormalizedDocuments: vi.fn(),
}));
import { sql } from '../../../db';
import { embedTexts, resolveEmbeddingConfig, vectorLiteral } from '../../view/embeddings';
import { loadNormalizedDocuments } from '../../view/retrieval';
import {
  normalizeKeyword,
  buildGlossaryRecords,
  upsertGeneratedGlossaryEmbeddingsForPath,
  deleteGeneratedGlossaryEmbeddingsByPrefix,
  fetchGlossarySemanticRows,
  ensureGlossaryEmbeddingsIndex,
} from '../glossarySemantic';

const mockSql = vi.mocked(sql);
const mockEmbedTexts = vi.mocked(embedTexts);
const mockResolveEmbeddingConfig = vi.mocked(resolveEmbeddingConfig);
const mockLoadNormalizedDocuments = vi.mocked(loadNormalizedDocuments);
const mockVectorLiteral = vi.mocked(vectorLiteral);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

function makeEmbeddingConfig(model = 'text-embed-3') {
  return { base_url: 'http://localhost', api_key: 'key', model };
}

function makeSourceDoc(overrides: Partial<{
  domain: string;
  path: string;
  node_uuid: string;
  memory_id: number;
  uri: string;
  priority: number;
  disclosure: string;
  glossary_keywords: string[];
}> = {}) {
  return {
    domain: 'core',
    path: 'agent/test',
    node_uuid: 'uuid-test',
    memory_id: 1,
    uri: 'core://agent/test',
    priority: 0,
    disclosure: '',
    glossary_keywords: ['alpha', 'beta'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeKeyword
// ---------------------------------------------------------------------------

describe('normalizeKeyword', () => {
  it('replaces slashes, underscores, hyphens with spaces', () => {
    expect(normalizeKeyword('foo/bar_baz-qux')).toBe('foo bar baz qux');
  });

  it('collapses multiple separators', () => {
    expect(normalizeKeyword('a__b--c//d')).toBe('a b c d');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeKeyword('  hello  ')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeKeyword('')).toBe('');
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizeKeyword(null)).toBe('');
    expect(normalizeKeyword(undefined)).toBe('');
  });

  it('handles plain words without separators unchanged', () => {
    expect(normalizeKeyword('plainword')).toBe('plainword');
  });
});

// ---------------------------------------------------------------------------
// buildGlossaryRecords
// ---------------------------------------------------------------------------

describe('buildGlossaryRecords', () => {
  it('returns one record per unique keyword', () => {
    const doc = makeSourceDoc({ glossary_keywords: ['alpha', 'beta', 'gamma'] });
    const records = buildGlossaryRecords(doc);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.keyword)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('deduplicates keywords', () => {
    const doc = makeSourceDoc({ glossary_keywords: ['alpha', 'alpha', 'beta'] });
    const records = buildGlossaryRecords(doc);
    expect(records).toHaveLength(2);
    expect(records[0].keyword).toBe('alpha');
    expect(records[1].keyword).toBe('beta');
  });

  it('returns empty array when no keywords', () => {
    const doc = makeSourceDoc({ glossary_keywords: [] });
    expect(buildGlossaryRecords(doc)).toEqual([]);
  });

  it('filters out blank keyword strings', () => {
    const doc = makeSourceDoc({ glossary_keywords: ['', '  ', 'valid'] });
    const records = buildGlossaryRecords(doc);
    expect(records).toHaveLength(1);
    expect(records[0].keyword).toBe('valid');
  });

  it('sets match_text to normalized keyword', () => {
    const doc = makeSourceDoc({ glossary_keywords: ['foo/bar'] });
    const [record] = buildGlossaryRecords(doc);
    expect(record.match_text).toBe('foo bar');
  });

  it('sets source_signature as consistent hash for same inputs', () => {
    const doc = makeSourceDoc({ glossary_keywords: ['alpha'] });
    const [r1] = buildGlossaryRecords(doc);
    const [r2] = buildGlossaryRecords(doc);
    expect(r1.source_signature).toBe(r2.source_signature);
  });

  it('changes source_signature when keyword changes', () => {
    const doc1 = makeSourceDoc({ glossary_keywords: ['alpha'] });
    const doc2 = makeSourceDoc({ glossary_keywords: ['beta'] });
    const [r1] = buildGlossaryRecords(doc1);
    const [r2] = buildGlossaryRecords(doc2);
    expect(r1.source_signature).not.toBe(r2.source_signature);
  });

  it('sets status=active and source=generated', () => {
    const [record] = buildGlossaryRecords(makeSourceDoc({ glossary_keywords: ['x'] }));
    expect(record.status).toBe('active');
    expect(record.source).toBe('generated');
  });
});

// ---------------------------------------------------------------------------
// upsertGeneratedGlossaryEmbeddingsForPath
// ---------------------------------------------------------------------------

describe('upsertGeneratedGlossaryEmbeddingsForPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult());
    mockResolveEmbeddingConfig.mockResolvedValue(makeEmbeddingConfig());
    mockVectorLiteral.mockImplementation((v: unknown) => (Array.isArray(v) ? `[${v.join(',')}]` : '[]'));
  });

  it('returns zero counts and deletes when no docs exist', async () => {
    mockLoadNormalizedDocuments.mockResolvedValue([]);

    const result = await upsertGeneratedGlossaryEmbeddingsForPath({ domain: 'core', path: 'empty' });

    expect(result).toEqual({ source_count: 0, updated_count: 0, deleted_count: 0 });
    const deleteSql = mockSql.mock.calls.find((c) => String(c[0]).includes('DELETE FROM glossary_term_embeddings') && String(c[0]).includes('path'));
    expect(deleteSql).toBeDefined();
  });

  it('upserts stale records with fresh embeddings', async () => {
    mockLoadNormalizedDocuments.mockResolvedValue([makeSourceDoc({ glossary_keywords: ['alpha'] })] as any);
    // existing: empty — all are stale (table init is mocked to no-op)
    mockSql
      .mockResolvedValueOnce(makeResult([])) // existing query
      .mockResolvedValue(makeResult()); // upsert

    mockEmbedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);

    const result = await upsertGeneratedGlossaryEmbeddingsForPath({ domain: 'core', path: 'agent/test' });

    expect(result.source_count).toBe(1);
    expect(result.updated_count).toBe(1);
    expect(mockEmbedTexts).toHaveBeenCalledOnce();
  });

  it('skips embedding call when all records are fresh', async () => {
    const doc = makeSourceDoc({ glossary_keywords: ['alpha'] });
    mockLoadNormalizedDocuments.mockResolvedValue([doc] as any);

    const [record] = buildGlossaryRecords(doc);
    const cfg = makeEmbeddingConfig();

    // All reset to return table-init no-ops then existing row matches signature+model+active
    mockSql.mockResolvedValue(makeResult([{
      node_uuid: record.node_uuid,
      keyword: record.keyword,
      source_signature: record.source_signature,
      embedding_model: cfg.model,
      status: 'active',
    }]));

    const result = await upsertGeneratedGlossaryEmbeddingsForPath({ domain: 'core', path: 'agent/test' });

    expect(result.updated_count).toBe(0);
    expect(mockEmbedTexts).not.toHaveBeenCalled();
  });

  it('deletes rows whose keys are no longer in source', async () => {
    // source has 'alpha'; db also has orphaned 'old-term'
    const doc = makeSourceDoc({ glossary_keywords: ['alpha'] });
    mockLoadNormalizedDocuments.mockResolvedValue([doc] as any);
    const [record] = buildGlossaryRecords(doc);
    const cfg = makeEmbeddingConfig();

    mockSql
      .mockResolvedValueOnce(makeResult([
        { node_uuid: record.node_uuid, keyword: record.keyword, source_signature: record.source_signature, embedding_model: cfg.model, status: 'active' },
        { node_uuid: 'uuid-test', keyword: 'old-term', source_signature: 'stale', embedding_model: cfg.model, status: 'active' },
      ])) // existing
      .mockResolvedValueOnce(makeResult([], 1)); // DELETE for old-term

    const result = await upsertGeneratedGlossaryEmbeddingsForPath({ domain: 'core', path: 'agent/test' });
    expect(result.deleted_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// deleteGeneratedGlossaryEmbeddingsByPrefix
// ---------------------------------------------------------------------------

describe('deleteGeneratedGlossaryEmbeddingsByPrefix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult([], 3));
  });

  it('returns deleted_count from sql rowCount', async () => {
    const result = await deleteGeneratedGlossaryEmbeddingsByPrefix({ domain: 'core', path: 'agent' });
    expect(result.deleted_count).toBe(3);
  });

  it('issues DELETE with prefix LIKE clause', async () => {
    await deleteGeneratedGlossaryEmbeddingsByPrefix({ domain: 'core', path: 'agent' });
    const deleteCall = mockSql.mock.calls.find((c) => String(c[0]).includes('DELETE FROM glossary_term_embeddings'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toContain('agent/%');
  });
});

// ---------------------------------------------------------------------------
// fetchGlossarySemanticRows
// ---------------------------------------------------------------------------

describe('fetchGlossarySemanticRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult());
    mockVectorLiteral.mockImplementation((v: unknown) => (Array.isArray(v) ? `[${v.join(',')}]` : '[]'));
  });

  it('returns rows from sql query', async () => {
    const rows = [
      { domain: 'core', path: 'a', uri: 'core://a', node_uuid: 'u1', memory_id: 1, priority: 0, disclosure: null, keyword: 'alpha', metadata: {}, glossary_semantic_score: 0.9, updated_at: '2025-01-01' },
    ];
    mockSql.mockResolvedValue(makeResult(rows));

    const cfg = makeEmbeddingConfig();
    const result = await fetchGlossarySemanticRows({ embedding: cfg, queryVector: [0.1, 0.2], limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('alpha');
  });

  it('adds domain filter when domain is provided', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const cfg = makeEmbeddingConfig();
    await fetchGlossarySemanticRows({ embedding: cfg, queryVector: [0.1], limit: 5, domain: 'work' });

    const selectCall = mockSql.mock.calls.find((c) => String(c[0]).includes('glossary_term_embeddings'));
    expect(selectCall).toBeDefined();
    const queryText = String(selectCall![0]);
    expect(queryText).toContain('domain');
    expect((selectCall![1] as unknown[]).includes('work')).toBe(true);
  });

  it('does not add domain clause when domain is null', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const cfg = makeEmbeddingConfig();
    await fetchGlossarySemanticRows({ embedding: cfg, queryVector: [0.1], limit: 5, domain: null });

    const selectCall = mockSql.mock.calls.find((c) => String(c[0]).includes('FROM glossary_term_embeddings'));
    expect(selectCall).toBeDefined();
    // domain param would be the 3rd element (after vectorLiteral and model); with no domain it shouldn't be present
    const params = selectCall![1] as unknown[];
    expect(params.includes('core')).toBe(false);
  });
});
