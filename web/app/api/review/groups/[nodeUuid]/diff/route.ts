import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../../server/auth';
import { jsonContractError } from '../../../../../../server/lore/contracts';
import { getReviewGroupDiff } from '../../../../../../server/lore/ops/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { nodeUuid: string } }): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await getReviewGroupDiff(params.nodeUuid));
  } catch (error) {
    return jsonContractError(error, 'Failed to load review diff');
  }
}
