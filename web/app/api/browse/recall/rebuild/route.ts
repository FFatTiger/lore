import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import type { EmbeddingConfig } from '../../../../../server/lore/core/types';
import { ensureRecallIndex } from '../../../../../server/lore/recall/recall';
import { upsertGeneratedGlossaryEmbeddingsForPath } from '../../../../../server/lore/search/glossarySemantic';
import { upsertGeneratedMemoryViewsForPath } from '../../../../../server/lore/view/viewCrud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readOptionalJson(request: NextRequest): Promise<Record<string, unknown>> {
  const text = await request.text();
  return text.trim() ? JSON.parse(text) as Record<string, unknown> : {};
}

function trimSlashes(value: unknown): string {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function extractScopedRebuild(body: Record<string, unknown>): {
  domain: string;
  path: string;
  embedding: Partial<EmbeddingConfig>;
} | null {
  const domain = String(body.domain || '').trim();
  const path = trimSlashes(body.path);
  if (!domain || !path) return null;

  const embedding = { ...body };
  delete embedding.domain;
  delete embedding.path;
  return { domain, path, embedding: embedding as Partial<EmbeddingConfig> };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readOptionalJson(request);
    const scoped = extractScopedRebuild(body);
    if (scoped) {
      const [memoryViews, glossaryEmbeddings] = await Promise.all([
        upsertGeneratedMemoryViewsForPath(scoped),
        upsertGeneratedGlossaryEmbeddingsForPath(scoped),
      ]);
      return NextResponse.json({
        success: true,
        memory_views: memoryViews,
        glossary_embeddings: glossaryEmbeddings,
      });
    }

    const data = await ensureRecallIndex(body);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Recall rebuild failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
