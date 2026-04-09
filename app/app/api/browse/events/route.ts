import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { getWriteEventStats } from '../../../../server/lore/memory/writeEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const days = Number(searchParams.get('days') || 7);
  const limit = Number(searchParams.get('limit') || 20);
  const eventType = searchParams.get('event_type') || '';
  const nodeUri = searchParams.get('node_uri') || '';
  const source = searchParams.get('source') || '';

  try {
    const stats = await getWriteEventStats({ days, limit, eventType, nodeUri, source });
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Write event stats failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
