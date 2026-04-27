import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../../server/auth';
import { jsonContractError } from '../../../../../../server/lore/contracts';
import { getReviewGroupDiff } from '../../../../../../server/lore/ops/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ nodeUuid: string }> }): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const { nodeUuid } = await params;
    return NextResponse.json(await getReviewGroupDiff(nodeUuid));
  } catch (error) {
    return jsonContractError(error, 'Failed to load review diff');
  }
}
