import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/server/auth', () => ({
  requireBearerAuth: vi.fn(),
}));
vi.mock('@/server/lore/recall/recall', () => ({
  ensureRecallIndex: vi.fn(),
}));
vi.mock('@/server/lore/view/viewCrud', () => ({
  upsertGeneratedMemoryViewsForPath: vi.fn(),
}));
vi.mock('@/server/lore/search/glossarySemantic', () => ({
  upsertGeneratedGlossaryEmbeddingsForPath: vi.fn(),
}));

import { requireBearerAuth } from '@/server/auth';
import { ensureRecallIndex } from '@/server/lore/recall/recall';
import { upsertGeneratedGlossaryEmbeddingsForPath } from '@/server/lore/search/glossarySemantic';
import { upsertGeneratedMemoryViewsForPath } from '@/server/lore/view/viewCrud';
import { POST } from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockEnsureRecallIndex = vi.mocked(ensureRecallIndex);
const mockUpsertGeneratedMemoryViewsForPath = vi.mocked(upsertGeneratedMemoryViewsForPath);
const mockUpsertGeneratedGlossaryEmbeddingsForPath = vi.mocked(upsertGeneratedGlossaryEmbeddingsForPath);

describe('/api/browse/recall/rebuild route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBearerAuth.mockReturnValue(null);
    mockEnsureRecallIndex.mockResolvedValue({ updated_count: 0 } as any);
    mockUpsertGeneratedMemoryViewsForPath.mockResolvedValue({ source_count: 2, updated_count: 2, deleted_count: 0, llm_refined_docs: 0 } as any);
    mockUpsertGeneratedGlossaryEmbeddingsForPath.mockResolvedValue({ source_count: 1, updated_count: 1, deleted_count: 0 } as any);
  });

  it('accepts an empty POST body', async () => {
    const response = await POST(new Request('http://localhost/api/browse/recall/rebuild', {
      method: 'POST',
    }) as any);
    const body = await response.json();

    expect(mockEnsureRecallIndex).toHaveBeenCalledWith({});
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.updated_count).toBe(0);
  });

  it('passes JSON POST body through to rebuild', async () => {
    const response = await POST(new Request('http://localhost/api/browse/recall/rebuild', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'embed-model' }),
    }) as any);

    expect(mockEnsureRecallIndex).toHaveBeenCalledWith({ model: 'embed-model' });
    expect(response.status).toBe(200);
  });

  it('rebuilds only the requested node artifacts when domain and path are provided', async () => {
    const response = await POST(new Request('http://localhost/api/browse/recall/rebuild', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'project', path: 'parent/child', model: 'embed-model' }),
    }) as any);
    const body = await response.json();

    expect(mockEnsureRecallIndex).not.toHaveBeenCalled();
    expect(mockUpsertGeneratedMemoryViewsForPath).toHaveBeenCalledWith({
      domain: 'project',
      path: 'parent/child',
      embedding: { model: 'embed-model' },
    });
    expect(mockUpsertGeneratedGlossaryEmbeddingsForPath).toHaveBeenCalledWith({
      domain: 'project',
      path: 'parent/child',
      embedding: { model: 'embed-model' },
    });
    expect(response.status).toBe(200);
    expect(body.memory_views.updated_count).toBe(2);
    expect(body.glossary_embeddings.updated_count).toBe(1);
  });
});
