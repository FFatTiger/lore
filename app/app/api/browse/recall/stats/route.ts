import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import { getRecallStats } from '../../../../../server/lore/recall/recallAnalytics';
import { getRecallRuntimeConfig } from '../../../../../server/lore/recall/recall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const days = Number(searchParams.get('days') || 7);
  const limit = Number(searchParams.get('limit') || 12);
  const queryId = searchParams.get('query_id') || '';
  const queryText = searchParams.get('query_text') || '';
  const nodeUri = searchParams.get('node_uri') || '';

  try {
    const stats = await getRecallStats({ days, limit, queryId, queryText, nodeUri });
    return NextResponse.json({
      ...stats,
      runtime: await getRecallRuntimeConfig(),
    });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Recall stats failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
