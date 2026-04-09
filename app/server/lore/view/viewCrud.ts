import { sql } from '../../db';
import { embedTexts, vectorLiteral, resolveEmbeddingConfig } from './embeddings';
import { NORMALIZED_DOCUMENTS_CTE, loadNormalizedDocuments } from './retrieval';
import { truncate } from '../core/utils';
import { getSettings as getSettingsBatch } from '../config/settings';
import {
  getFtsConfig,
  hashPayload,
  buildSourceDocument,
  buildRuleBasedViewText,
  buildGlossaryTerms,
  viewWeight,
  loadViewWeights,
  VIEW_GENERATOR_VERSION,
  GENERATED_SOURCE,
} from './viewBuilders';
import { resolveViewLlmConfig, refineDocumentsWithLlm } from './viewLlm';
import type { EmbeddingConfig } from '../core/types';

// ---------------------------------------------------------------------------
// View record builder
// ---------------------------------------------------------------------------

export function buildViewRecords(
  doc: Record<string, unknown>,
  weights: Record<string, unknown> | null = null,
): Record<string, unknown>[] {
  const llmViews = (doc.llm_views as { gist?: string; question?: string[]; model?: string }) || null;
  const glossaryTerms = (doc.glossary_terms as string[]) || [];
  const weightOf = (vt: string): number => {
    if (weights && weights[vt] !== undefined) return Number(weights[vt]);
    return viewWeight(vt);
  };

  return ['gist', 'question'].map((viewType) => {
    let text_content = buildRuleBasedViewText(doc as Record<string, string>, viewType);
    if (llmViews) {
      if (viewType === 'gist') {
        text_content = [
          llmViews.gist,
          doc.disclosure ? truncate(doc.disclosure, 140) : '',
        ].filter(Boolean).join('\n');
      } else if (viewType === 'question') {
        text_content = (llmViews.question || []).join('\n');
      }
    }

    const w = weightOf(viewType);
    return {
      domain: doc.domain,
      path: doc.path,
      uri: doc.uri,
      node_uuid: doc.node_uuid,
      memory_id: doc.memory_id,
      priority: doc.priority,
      disclosure: doc.disclosure,
      view_type: viewType,
      source: GENERATED_SOURCE,
      status: 'active',
      weight: w,
      text_content,
      metadata: {
        generator_version: VIEW_GENERATOR_VERSION,
        cue_terms: glossaryTerms,
        glossary_terms: glossaryTerms,
        disclosure: truncate(doc.disclosure, 140),
        llm_refined: Boolean(llmViews),
        llm_model: llmViews?.model || null,
      },
      source_signature: hashPayload({
        base: doc.source_signature as string,
        view_type: viewType,
        text_content,
        weight: w,
        llm_model: llmViews?.model || null,
        llm_gist: llmViews?.gist || null,
        llm_question: llmViews?.question || null,
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Source document loading and view map
// ---------------------------------------------------------------------------

export async function loadSourceDocuments(filters: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  const rows = await loadNormalizedDocuments(filters);
  return (rows as unknown as Record<string, unknown>[]).map(buildSourceDocument);
}

export function buildViewMap(views: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  return new Map(views.map((view) => [`${view.domain}::${view.path}::${view.view_type}`, view]));
}

export async function loadSourceViewRecords(filters: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  const docs = await loadSourceDocuments(filters);
  const weights = await loadViewWeights();
  return docs.flatMap((doc) => buildViewRecords(doc, weights));
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

export async function upsertViewRecord(
  view: Record<string, unknown>,
  { embeddingModel = '', vector = null as number[] | null, status = (view.status as string) || 'active' } = {},
): Promise<void> {
  const embeddingLiteral = Array.isArray(vector) ? vectorLiteral(vector) : null;
  const embeddingDim = Array.isArray(vector) ? vector.length : 0;
  const fts = await getFtsConfig();
  await sql(
    `
      INSERT INTO memory_views (
        domain, path, uri, node_uuid, memory_id, priority, disclosure,
        view_type, source, status, weight, text_content, fts,
        embedding_model, embedding_dim, embedding_vector, metadata, source_signature,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, to_tsvector('${fts}', $12),
        $13, $14, CASE WHEN $15::text IS NULL THEN NULL ELSE CAST($15 AS vector) END, $16::jsonb, $17,
        NOW(), NOW()
      )
      ON CONFLICT (domain, path, view_type) DO UPDATE SET
        uri = EXCLUDED.uri,
        node_uuid = EXCLUDED.node_uuid,
        memory_id = EXCLUDED.memory_id,
        priority = EXCLUDED.priority,
        disclosure = EXCLUDED.disclosure,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        weight = EXCLUDED.weight,
        text_content = EXCLUDED.text_content,
        fts = EXCLUDED.fts,
        embedding_model = EXCLUDED.embedding_model,
        embedding_dim = EXCLUDED.embedding_dim,
        embedding_vector = EXCLUDED.embedding_vector,
        metadata = EXCLUDED.metadata,
        source_signature = EXCLUDED.source_signature,
        updated_at = NOW()
    `,
    [
      view.domain,
      view.path,
      view.uri,
      view.node_uuid,
      view.memory_id,
      view.priority,
      view.disclosure,
      view.view_type,
      view.source || GENERATED_SOURCE,
      status,
      view.weight,
      view.text_content,
      embeddingModel,
      embeddingDim,
      embeddingLiteral,
      JSON.stringify((view.metadata as Record<string, unknown>) || {}),
      view.source_signature,
    ],
  );
}

// ---------------------------------------------------------------------------
// High-level upsert/delete for a single path
// ---------------------------------------------------------------------------

export async function upsertGeneratedMemoryViewsForPath({
  domain,
  path,
  embedding = null,
}: {
  domain: string;
  path: string;
  embedding?: Partial<EmbeddingConfig> | null;
}): Promise<{ source_count: number; updated_count: number; deleted_count: number; llm_refined_docs: number }> {
  const resolvedEmbedding = await resolveEmbeddingConfig(embedding);
  const docs = await loadSourceDocuments({ domain, path });

  if (!docs.length) {
    await sql(`DELETE FROM memory_views WHERE domain = $1 AND path = $2 AND source = $3`, [domain, path, GENERATED_SOURCE]);
    return { source_count: 0, updated_count: 0, deleted_count: 0, llm_refined_docs: 0 };
  }

  const existing = await sql(
    `
      SELECT domain, path, view_type, source_signature, embedding_model, status, metadata
      FROM memory_views
      WHERE source = $1 AND domain = $2 AND path = $3
    `,
    [GENERATED_SOURCE, domain, path],
  );
  const existingMap = new Map(existing.rows.map((row: Record<string, unknown>) => [`${row.domain}::${row.path}::${row.view_type}`, row]));

  const llmConfig = await resolveViewLlmConfig(resolvedEmbedding);
  const weights = await loadViewWeights();
  let llmRefinedDocs = 0;
  let docsForViews = docs;

  if (llmConfig) {
    const refinedDocs = await refineDocumentsWithLlm(docs, llmConfig);
    llmRefinedDocs = refinedDocs.filter((doc) => Boolean(doc.llm_views)).length;
    docsForViews = refinedDocs;
  }

  const sourceViews = docsForViews.flatMap((doc) => buildViewRecords(doc, weights));
  const stale = sourceViews.filter((view) => {
    const key = `${view.domain}::${view.path}::${view.view_type}`;
    const row = existingMap.get(key);
    return !row || row.source_signature !== view.source_signature || row.embedding_model !== resolvedEmbedding.model || row.status !== 'active';
  });

  if (stale.length) {
    const vectors = await embedTexts(resolvedEmbedding, stale.map((view) => view.text_content as string));
    for (let i = 0; i < stale.length; i += 1) {
      await upsertViewRecord(stale[i], { embeddingModel: resolvedEmbedding.model, vector: vectors[i], status: 'active' });
    }
  }

  const sourceKeys = new Set(sourceViews.map((view) => `${view.domain}::${view.path}::${view.view_type}`));
  let deletedCount = 0;
  for (const row of existing.rows) {
    const key = `${row.domain}::${row.path}::${row.view_type}`;
    if (!sourceKeys.has(key)) {
      const result = await sql(
        `DELETE FROM memory_views WHERE domain = $1 AND path = $2 AND view_type = $3 AND source = $4`,
        [row.domain, row.path, row.view_type, GENERATED_SOURCE],
      );
      deletedCount += result.rowCount || 0;
    }
  }

  return { source_count: sourceViews.length, updated_count: stale.length, deleted_count: deletedCount, llm_refined_docs: llmRefinedDocs };
}

export async function deleteGeneratedMemoryViewsByPrefix({
  domain,
  path,
}: {
  domain: string;
  path: string;
}): Promise<{ deleted_count: number }> {
  const result = await sql(
    `DELETE FROM memory_views WHERE domain = $1 AND source = $2 AND (path = $3 OR path LIKE $4)`,
    [domain, GENERATED_SOURCE, path, `${path}/%`],
  );
  return { deleted_count: result.rowCount || 0 };
}

// ---------------------------------------------------------------------------
// Index-level operations
// ---------------------------------------------------------------------------

export async function ensureMemoryViewsReady(): Promise<{ ready: boolean }> {
  return { ready: true };
}

export async function ensureMemoryViewsIndex(
  embedding: EmbeddingConfig,
): Promise<{
  source_count: number;
  updated_count: number;
  deleted_count: number;
  view_types: string[];
  llm_model: string | null;
  llm_refined_docs: number;
}> {
  const docs = await loadSourceDocuments();
  const existing = await sql(`
    SELECT domain, path, view_type, source_signature, embedding_model, status, source, metadata
    FROM memory_views
    WHERE source = $1
  `, [GENERATED_SOURCE]);

  const existingMap = new Map(existing.rows.map((row: Record<string, unknown>) => [`${row.domain}::${row.path}::${row.view_type}`, row]));

  const weights = await loadViewWeights();
  const sourceViewMap = buildViewMap(docs.flatMap((doc) => buildViewRecords(doc, weights)));
  const llmConfig = await resolveViewLlmConfig(embedding);
  let llmRefinedDocs = 0;

  if (llmConfig) {
    const maxDocsSetting = await getSettingsBatch(['view_llm.max_docs_per_run']);
    const maxDocsPerRun = Math.max(0, Number(maxDocsSetting['view_llm.max_docs_per_run'] || 0));
    const docsNeedingLlm = docs.filter((doc) => {
      const rows = ['gist', 'question'].map((viewType) => existingMap.get(`${doc.domain}::${doc.path}::${viewType}`));
      return rows.some((row) => {
        const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
        return !row || metadata.llm_refined !== true || metadata.llm_model !== llmConfig.model;
      });
    });

    if (maxDocsPerRun > 0 && docsNeedingLlm.length > 0) {
      const refinedDocs = await refineDocumentsWithLlm(docsNeedingLlm.slice(0, maxDocsPerRun), llmConfig);
      llmRefinedDocs = refinedDocs.filter((doc) => Boolean(doc.llm_views)).length;
      const refinedViewMap = buildViewMap(refinedDocs.flatMap((doc) => buildViewRecords(doc, weights)));
      for (const [key, view] of refinedViewMap.entries()) {
        sourceViewMap.set(key, view);
      }
    }
  }

  const sourceViews = [...sourceViewMap.values()];
  const sourceMap = new Map(sourceViews.map((view) => [`${view.domain}::${view.path}::${view.view_type}`, view]));

  const stale = sourceViews.filter((view) => {
    const key = `${view.domain}::${view.path}::${view.view_type}`;
    const row = existingMap.get(key);
    return !row || row.source_signature !== view.source_signature || row.embedding_model !== embedding.model || row.status !== 'active';
  });

  if (stale.length) {
    const vectors = await embedTexts(embedding, stale.map((view) => view.text_content as string));
    for (let i = 0; i < stale.length; i += 1) {
      await upsertViewRecord(stale[i], { embeddingModel: embedding.model, vector: vectors[i], status: 'active' });
    }
  }

  let deletedCount = 0;
  for (const row of existing.rows) {
    const key = `${row.domain}::${row.path}::${row.view_type}`;
    if (!sourceMap.has(key)) {
      const result = await sql(
        `DELETE FROM memory_views WHERE domain = $1 AND path = $2 AND view_type = $3 AND source = $4`,
        [row.domain, row.path, row.view_type, GENERATED_SOURCE],
      );
      deletedCount += result.rowCount || 0;
    }
  }

  return {
    source_count: sourceViews.length,
    updated_count: stale.length,
    deleted_count: deletedCount,
    view_types: ['gist', 'question'],
    llm_model: llmConfig?.model || null,
    llm_refined_docs: llmRefinedDocs,
  };
}

// ---------------------------------------------------------------------------
// Re-export query functions from memoryViewQueries for backward compatibility
// ---------------------------------------------------------------------------

export {
  fetchDenseMemoryViewRows,
  fetchLexicalMemoryViewRows,
  fetchExactMemoryRows,
  buildCandidateKey,
  extractCueTerms,
  getViewPrior,
  getMemoryViewRuntimeConfig,
  listMemoryViewsByNode,
} from './memoryViewQueries';

// Re-export from viewBuilders for backward compatibility
export { viewWeight, viewPrior, getFtsConfig, getFtsQueryConfig, countQueryTokens } from './viewBuilders';
export { dedupeTerms, truncate } from '../core/utils';
