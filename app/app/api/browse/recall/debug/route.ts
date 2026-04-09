import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import { debugRecallMemories } from '../../../../../server/lore/recall/recall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    return NextResponse.json(await debugRecallMemories(body));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Recall debug failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
