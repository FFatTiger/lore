import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { listOrphans } from '../../../../server/lore/ops/maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    return NextResponse.json(await listOrphans());
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to load orphans' }, { status: 500 });
  }
}
