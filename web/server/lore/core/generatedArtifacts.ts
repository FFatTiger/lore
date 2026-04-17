import {
  deleteGeneratedGlossaryEmbeddingsByPrefix,
  upsertGeneratedGlossaryEmbeddingsForPath,
} from '../search/glossarySemantic';
import {
  deleteGeneratedMemoryViewsByPrefix,
  upsertGeneratedMemoryViewsForPath,
} from '../view/viewCrud';

interface GeneratedArtifactPath {
  domain?: unknown;
  path?: unknown;
}

interface NormalizedGeneratedArtifactPath {
  domain: string;
  path: string;
}

interface ScheduleGeneratedArtifactsOptions {
  defaultDomain?: string | null;
}

function normalizeGeneratedArtifactPaths(
  paths: GeneratedArtifactPath[] | null | undefined,
  { defaultDomain = 'core' }: ScheduleGeneratedArtifactsOptions = {},
): NormalizedGeneratedArtifactPath[] {
  return (Array.isArray(paths) ? paths : [])
    .map((row) => {
      const domain = String(row?.domain || '').trim();
      const path = String(row?.path || '')
        .trim()
        .replace(/^\/+|\/+$/g, '');
      return {
        domain: domain || String(defaultDomain || '').trim(),
        path,
      };
    })
    .filter((row) => Boolean(row.domain) && Boolean(row.path));
}

function scheduleGeneratedArtifacts(
  paths: GeneratedArtifactPath[] | null | undefined,
  {
    logLabel,
    updateMemoryViews,
    updateGlossaryEmbeddings,
  }: {
    logLabel: string;
    updateMemoryViews: (path: NormalizedGeneratedArtifactPath) => Promise<unknown>;
    updateGlossaryEmbeddings: (path: NormalizedGeneratedArtifactPath) => Promise<unknown>;
  },
  options?: ScheduleGeneratedArtifactsOptions,
): void {
  for (const row of normalizeGeneratedArtifactPaths(paths, options)) {
    queueMicrotask(() => {
      updateMemoryViews(row).catch((error: unknown) => {
        console.error(`[memory_views] ${logLabel} failed`, row.domain, row.path, error);
      });
      updateGlossaryEmbeddings(row).catch((error: unknown) => {
        console.error(`[glossary_embeddings] ${logLabel} failed`, row.domain, row.path, error);
      });
    });
  }
}

export function scheduleGeneratedArtifactsRefresh(
  paths: GeneratedArtifactPath[] | null | undefined,
  logLabel = 'refresh',
  options?: ScheduleGeneratedArtifactsOptions,
): void {
  scheduleGeneratedArtifacts(paths, {
    logLabel,
    updateMemoryViews: upsertGeneratedMemoryViewsForPath,
    updateGlossaryEmbeddings: upsertGeneratedGlossaryEmbeddingsForPath,
  }, options);
}

export function scheduleGeneratedArtifactsDelete(
  paths: GeneratedArtifactPath[] | null | undefined,
  logLabel = 'delete',
  options?: ScheduleGeneratedArtifactsOptions,
): void {
  scheduleGeneratedArtifacts(paths, {
    logLabel,
    updateMemoryViews: deleteGeneratedMemoryViewsByPrefix,
    updateGlossaryEmbeddings: deleteGeneratedGlossaryEmbeddingsByPrefix,
  }, options);
}
