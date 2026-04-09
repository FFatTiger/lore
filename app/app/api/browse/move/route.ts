import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { moveNode } from '../../../../server/lore/memory/write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    return NextResponse.json(
      await moveNode(body || {}, { source: 'api:POST /browse/move' }),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: (error as Error)?.message || 'Failed to move node' },
      { status: Number((error as { status?: number })?.status || 500) },
    );
  }
}
