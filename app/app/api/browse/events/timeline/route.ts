import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import { getNodeWriteHistory } from '../../../../../server/lore/memory/writeEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const nodeUri = searchParams.get('node_uri') || '';
  const nodeUuid = searchParams.get('node_uuid') || '';
  const limit = Number(searchParams.get('limit') || 50);

  try {
    const history = await getNodeWriteHistory({ nodeUri, nodeUuid, limit });
    return NextResponse.json(history);
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Write event timeline failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
