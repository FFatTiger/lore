import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../../server/auth';
import { getReviewGroupDiff } from '../../../../../../server/lore/ops/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { nodeUuid: string } }): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await getReviewGroupDiff(params.nodeUuid));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to load review diff' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
