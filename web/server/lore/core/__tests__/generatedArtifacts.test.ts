import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../view/viewCrud', () => ({
  upsertGeneratedMemoryViewsForPath: vi.fn().mockResolvedValue(undefined),
  deleteGeneratedMemoryViewsByPrefix: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../search/glossarySemantic', () => ({
  upsertGeneratedGlossaryEmbeddingsForPath: vi.fn().mockResolvedValue(undefined),
  deleteGeneratedGlossaryEmbeddingsByPrefix: vi.fn().mockResolvedValue(undefined),
}));

import {
  scheduleGeneratedArtifactsRefresh,
  scheduleGeneratedArtifactsDelete,
} from '../generatedArtifacts';
import {
  upsertGeneratedMemoryViewsForPath,
  deleteGeneratedMemoryViewsByPrefix,
} from '../../view/viewCrud';
import {
  upsertGeneratedGlossaryEmbeddingsForPath,
  deleteGeneratedGlossaryEmbeddingsByPrefix,
} from '../../search/glossarySemantic';

const mockUpsertGeneratedMemoryViews = vi.mocked(upsertGeneratedMemoryViewsForPath);
const mockDeleteGeneratedMemoryViews = vi.mocked(deleteGeneratedMemoryViewsByPrefix);
const mockUpsertGeneratedGlossaryEmbeddings = vi.mocked(upsertGeneratedGlossaryEmbeddingsForPath);
const mockDeleteGeneratedGlossaryEmbeddings = vi.mocked(deleteGeneratedGlossaryEmbeddingsByPrefix);

describe('scheduleGeneratedArtifactsRefresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queues refresh for normalized valid paths', async () => {
    scheduleGeneratedArtifactsRefresh([
      { domain: '', path: '/agent/test/' },
    ]);

    await new Promise((resolve) => queueMicrotask(resolve as any));

    expect(mockUpsertGeneratedMemoryViews).toHaveBeenCalledWith({ domain: 'core', path: 'agent/test' });
    expect(mockUpsertGeneratedGlossaryEmbeddings).toHaveBeenCalledWith({ domain: 'core', path: 'agent/test' });
  });

  it('skips empty and non-array input', async () => {
    scheduleGeneratedArtifactsRefresh([
      { domain: 'core', path: '' },
      { domain: '', path: '   ' },
    ] as any);
    scheduleGeneratedArtifactsRefresh(null);
    scheduleGeneratedArtifactsRefresh(undefined);

    await new Promise((resolve) => queueMicrotask(resolve as any));

    expect(mockUpsertGeneratedMemoryViews).not.toHaveBeenCalled();
    expect(mockUpsertGeneratedGlossaryEmbeddings).not.toHaveBeenCalled();
  });
});

describe('scheduleGeneratedArtifactsDelete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queues delete for normalized valid paths', async () => {
    scheduleGeneratedArtifactsDelete([
      { domain: 'work', path: '/projects/alpha/' },
    ]);

    await new Promise((resolve) => queueMicrotask(resolve as any));

    expect(mockDeleteGeneratedMemoryViews).toHaveBeenCalledWith({ domain: 'work', path: 'projects/alpha' });
    expect(mockDeleteGeneratedGlossaryEmbeddings).toHaveBeenCalledWith({ domain: 'work', path: 'projects/alpha' });
  });
});
