import { NextRequest, NextResponse } from 'next/server';
import { normalizeClientType, requireBearerAuth } from '../../../../server/auth';
import { moveNode } from '../../../../server/lore/memory/write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const clientType = normalizeClientType(request.nextUrl.searchParams.get('client_type'));
    return NextResponse.json(
      await moveNode(body || {}, { source: 'api:POST /browse/move', client_type: clientType }),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: (error as Error)?.message || 'Failed to move node' },
      { status: Number((error as { status?: number })?.status || 500) },
    );
  }
}
