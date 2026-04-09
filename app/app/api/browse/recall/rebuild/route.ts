import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import { ensureRecallIndex } from '../../../../../server/lore/recall/recall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const data = await ensureRecallIndex(await request.json());
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Recall rebuild failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
